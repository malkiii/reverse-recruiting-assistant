import { AllApifyTokensUsedUpError, apifyTokenRouter } from "./apify-tokens";
import type {
  ActorRun,
  ActorRunStore,
  CollectedJob,
  ExcludedKeywordStore,
  FunctionRun,
  Image,
  ImageGateway,
  Job,
  JobBoardGateway,
  JobBoardSettingsStore,
  JobFeedReader,
  JobFeedStore,
  JobStore,
  PendingAlertJob,
  PlaceholderName,
  SkippedApifyTokenStore,
  TelegramGateway,
} from "./gateways";
import { FEED_SOURCE_PREFIX } from "./firecrawl-job-feed";
import { COLLECT_JOBS, type JobSearch } from "./schema";
import { escapeHtml } from "./telegram";

export const COLLECTION_TIME_LIMIT_MS = 30 * 60_000;

const JOBS_PER_COLLECTION = 20;
const POLL_DELAY_MS = 15_000;
// Stops well inside the time limit. Whatever is still going is picked up by the next Job Collection.
const MAX_POLLS = 80;

type CollectionDeps = {
  jobBoards: JobBoardGateway[];
  jobBoardSettings: JobBoardSettingsStore;
  excludedKeywords: ExcludedKeywordStore;
  actorRuns: ActorRunStore;
  jobs: JobStore;
  jobFeeds: JobFeedStore;
  feedReader: JobFeedReader;
  apifyTokens: string;
  skippedApifyTokens: SkippedApifyTokenStore;
  telegram: TelegramGateway;
  images: ImageGateway;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
};

const utcDay = (date: Date) => date.toISOString().slice(0, 10);

const DAY_MS = 24 * 60 * 60_000;

/** Salaries by Job URL, kept for this Job Collection's Job Alerts only, since they aren't saved. */
type Salaries = Map<string, string>;

/** A Job with no post date counts as posted on the day it was seen. Its salary is noted in salaries, not kept. */
function toJob({ postDay, ageInDays, salary, ...job }: CollectedJob, seenAt: Date, salaries: Salaries): Job {
  if (salary?.trim()) salaries.set(job.url, salary.trim());
  if (postDay) return { ...job, postDay };
  if (ageInDays != null) return { ...job, postDay: utcDay(new Date(seenAt.getTime() - ageInDays * DAY_MS)) };
  return { ...job, postDay: utcDay(seenAt) };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches any Excluded Keyword as a whole word or phrase in a title, ignoring case. */
export function excludedTitleMatcher(keywords: string[]) {
  const patterns = keywords.map((keyword) => keyword.trim()).filter(Boolean).map(escapeRegExp);
  if (patterns.length === 0) return () => false;
  const regex = new RegExp(`(?<![\\p{L}\\p{N}])(?:${patterns.join("|")})(?![\\p{L}\\p{N}])`, "iu");
  return (title: string) => regex.test(title);
}

type TitleFilter = (title: string) => boolean;

function withoutExcluded<T extends { title: string }>(jobs: T[], isExcluded: TitleFilter, label: string) {
  const kept = jobs.filter(({ title }) => !isExcluded(title));
  if (kept.length < jobs.length) console.log(`${label}: ${jobs.length - kept.length} Job(s) skipped by an Excluded Keyword`);
  return kept;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function shareLimit(index: number, searches: number) {
  const remainder = JOBS_PER_COLLECTION % searches;
  return Math.floor(JOBS_PER_COLLECTION / searches) + (index < remainder ? 1 : 0);
}

/** A run from an earlier day isn't a replacement for today's search, because its Jobs are a day old. */
function alreadyRunToday(search: JobSearch, unfinished: ActorRun[], actor: string, now: Date) {
  return unfinished.some(
    (run) =>
      run.actor === actor &&
      run.search?.keywords === search.keywords &&
      run.search.location === search.location &&
      utcDay(run.startedAt) === utcDay(now),
  );
}

async function startActorRuns(deps: CollectionDeps, unfinished: ActorRun[], errors: string[]) {
  const router = apifyTokenRouter({
    apifyTokens: deps.apifyTokens,
    skippedTokens: deps.skippedApifyTokens,
    lastToken: () => deps.actorRuns.lastToken(),
    now: deps.now,
  });
  const started: ActorRun[] = [];

  for (const jobBoard of deps.jobBoards) {
    const settings = await deps.jobBoardSettings.get(jobBoard.source);
    if (!settings?.enabled) {
      console.log(`${jobBoard.source}: disabled, skipped`);
      continue;
    }

    for (const [index, search] of settings.searches.entries()) {
      const limit = shareLimit(index, settings.searches.length);
      if (limit === 0 || alreadyRunToday(search, unfinished, jobBoard.actor, deps.now())) {
        console.log(`${jobBoard.source} search "${search.keywords}": skipped (limit ${limit} or already run today)`);
        continue;
      }

      try {
        const { token, result: runId } = await router.withToken((token) => jobBoard.start(search, limit, token, { remoteOnly: settings.remoteOnly }));
        const run = { runId, actor: jobBoard.actor, token, search, startedAt: deps.now() };
        // Saved before polling, so a Function killed from here on loses nothing.
        await deps.actorRuns.save(run);
        started.push(run);
        console.log(`${jobBoard.source} search "${search.keywords}" in ${search.location}: started actor run ${runId} (limit ${limit})`);
      } catch (error) {
        if (error instanceof AllApifyTokensUsedUpError) {
          // No other search can start either. Job Feeds and runs already started still go ahead.
          console.error(error.message);
          errors.push(error.message);
          await deps.telegram.sendHtml(APIFY_TOKENS_USED_UP_ALERT, APIFY_TOP_UP_LINK).catch(console.error);
          return started;
        }
        console.error(`${jobBoard.source} search "${search.keywords}": failed to start:`, error);
        errors.push(`${jobBoard.source} search "${search.keywords}": ${message(error)}`);
      }
    }
  }
  return started;
}

/** Each Job Feed is read once, so they are read while the actor runs are still going. */
async function readJobFeeds(deps: CollectionDeps, isExcluded: TitleFilter, errors: string[], salaries: Salaries) {
  const feeds = (await deps.jobFeeds.list()).filter(({ enabled }) => enabled);
  console.log(`Reading ${feeds.length} enabled Job Feed(s)`);

  for (const feed of feeds) {
    try {
      const seenAt = deps.now();
      const read = withoutExcluded(await deps.feedReader.read(feed.url), isExcluded, `Job Feed ${feed.url}`);
      const jobs = read.map((job) => toJob(job, seenAt, salaries));
      const saved = await deps.jobs.save(jobs);
      console.log(`Job Feed ${feed.url}: read ${jobs.length} Job(s), ${saved} new`);
    } catch (error) {
      console.error(`Job Feed ${feed.url}: failed:`, error);
      errors.push(`Job Feed ${feed.url}: ${message(error)}`);
    }
  }
}

export async function runCollection(deps: CollectionDeps) {
  const errors: string[] = [];
  const unfinished = await deps.actorRuns.listUnfinished();
  console.log(`Job Collection started, ${unfinished.length} unfinished actor run(s) from earlier`);
  const isExcluded = excludedTitleMatcher(await deps.excludedKeywords.list());
  const runs = [...unfinished, ...(await startActorRuns(deps, unfinished, errors))];
  const salaries: Salaries = new Map();
  await readJobFeeds(deps, isExcluded, errors, salaries);

  // Counted per Job Board and day: a run left from an earlier day has its own 20.
  const savedPerBoardDay = new Map<string, number>();
  let pollsLeft = MAX_POLLS;

  for (const run of runs) {
    const jobBoard = deps.jobBoards.find(({ actor }) => actor === run.actor);
    if (!jobBoard) {
      console.warn(`Actor run ${run.runId}: no Job Board for actor ${run.actor}, skipped`);
      continue;
    }

    try {
      let status = await jobBoard.status(run);
      console.log(`Actor run ${run.runId} (${run.actor}): ${status}`);
      while (status === "running" && pollsLeft > 0) {
        pollsLeft -= 1;
        await deps.sleep(POLL_DELAY_MS);
        status = await jobBoard.status(run);
        console.log(`Actor run ${run.runId}: ${status} (${pollsLeft} poll(s) left)`);
      }
      if (status === "running") {
        console.log(`Actor run ${run.runId}: still running, left for the next Job Collection`);
        continue;
      }

      if (status === "failed") {
        console.error(`Actor run ${run.runId} failed`);
        errors.push(`Actor run ${run.runId} failed`);
      } else {
        // "Today" is the day the run started, so a run saved after midnight keeps its Jobs.
        // Skipped before the cap, so an excluded Job doesn't take the place of a wanted one.
        const collected = withoutExcluded(await jobBoard.results(run), isExcluded, `Actor run ${run.runId}`).map(
          (job) => toJob(job, run.startedAt, salaries),
        );
        const postedToday = collected.filter(({ postDay }) => postDay === utcDay(run.startedAt));
        const boardDay = `${run.actor} ${utcDay(run.startedAt)}`;
        const saved = savedPerBoardDay.get(boardDay) ?? 0;
        const jobs = postedToday.slice(0, JOBS_PER_COLLECTION - saved);
        const newJobs = await deps.jobs.save(jobs);
        savedPerBoardDay.set(boardDay, saved + newJobs);
        console.log(
          `Actor run ${run.runId}: ${collected.length} result(s), ${postedToday.length} posted today, ${newJobs} new saved`,
        );
      }
      await deps.actorRuns.close(run.runId, deps.now());
    } catch (error) {
      console.error(`Actor run ${run.runId}: failed:`, error);
      errors.push(`Actor run ${run.runId}: ${message(error)}`);
    }
  }

  await sendJobAlerts(deps, errors, salaries);

  console.log(`Job Collection finished with ${errors.length} error(s)`);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

const APIFY_TOKENS_USED_UP_ALERT = [
  "🪫 <b>Apify tokens used up</b>",
  "All tokens are out of credit until the next UTC day.\nJob Feeds still run; Job Board searches are skipped.",
].join("\n\n");

const APIFY_TOP_UP_LINK = { label: "💳 Top up on Apify", url: "https://console.apify.com/billing" };

const jobAlertCaption = ({ title, companyName, location, source }: PendingAlertJob, salary?: string) =>
  [
    `💼 <b>${escapeHtml(title)}</b>`,
    `🏢 ${escapeHtml(companyName)}`,
    ...(location ? [`📍 ${escapeHtml(location)}`] : []),
    ...(salary ? [`💰 ${escapeHtml(salary)}`] : []),
    `<i>(${escapeHtml(source)})</i>`,
  ].join("\n\n");

const isFeedJob = ({ source }: PendingAlertJob) => source.startsWith(FEED_SOURCE_PREFIX);

const placeholderName = ({ source }: PendingAlertJob): PlaceholderName =>
  source === "Glassdoor" ? "glassdoor" : "linkedin";

/** A grey image naming the Job Feed's host. PNG, because placehold.co serves SVG by default and Telegram refuses it. */
const feedPlaceholderUrl = ({ source }: PendingAlertJob) =>
  `https://placehold.co/800x400/EBEBEB/B5B5B5/png?text=${encodeURIComponent(source.slice(FEED_SOURCE_PREFIX.length))}`;

/** The Company logo, then a Job Feed page's OG image, then the source's placeholder, each tried in turn. */
function alertPhotos({ images }: CollectionDeps, job: PendingAlertJob): (() => Promise<Image | null>)[] {
  const { companyLogoUrl } = job;
  const pageImage = async () => {
    const url = await images.pageImageUrl(job.url);
    return url ? images.download(url) : null;
  };
  return [
    ...(companyLogoUrl ? [() => images.download(companyLogoUrl)] : []),
    ...(isFeedJob(job)
      ? [pageImage, () => images.download(feedPlaceholderUrl(job))]
      : [() => images.placeholder(placeholderName(job))]),
  ];
}

async function sendJobAlert(deps: CollectionDeps, job: PendingAlertJob, salary?: string) {
  const caption = jobAlertCaption(job, salary);
  const link = { label: "📄 See Details", url: job.url };

  for (const photo of alertPhotos(deps, job)) {
    const image = await photo();
    if (!image) continue;
    try {
      return await deps.telegram.sendHtml(caption, link, image);
    } catch (error) {
      console.warn(`Job Alert for ${job.url}: photo refused, trying the next one:`, error);
    }
  }
  // No photo could be had, so the Job Alert still goes out as text.
  await deps.telegram.sendHtml(caption, link);
}

/** A Job Alert left from an earlier Job Collection goes out without its salary, which wasn't saved. */
async function sendJobAlerts(deps: CollectionDeps, errors: string[], salaries: Salaries) {
  const pending = await deps.jobs.listPendingAlerts();
  let sent = 0;

  for (const job of pending) {
    try {
      await sendJobAlert(deps, job, salaries.get(job.url));
    } catch (error) {
      // Left pending, so the next Job Collection retries it.
      console.error(`Job Alert for ${job.url}: failed:`, error);
      errors.push(`Job Alert for ${job.url}: ${message(error)}`);
      continue;
    }
    await deps.jobs.markAlertSent(job.id);
    sent += 1;
  }
  console.log(`Sent ${sent} of ${pending.length} pending Job Alert(s)`);
}

/** Matches the claim in FunctionRunStore.start: a run past its time limit no longer counts. */
export function isCollectionActive(runs: FunctionRun[], now: Date) {
  return runs.some(
    ({ functionName, status, startedAt }) =>
      functionName === COLLECT_JOBS &&
      status === "running" &&
      now.getTime() - startedAt.getTime() < COLLECTION_TIME_LIMIT_MS,
  );
}
