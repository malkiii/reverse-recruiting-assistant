import { expect, test } from "vitest";
import { acceptFunctionRequest } from "../functions/accept-function-request";
import {
  FakeActorRunStore,
  FakeExcludedKeywordStore,
  FakeFunctionRunStore,
  FakeImages,
  FakeJobBoard,
  FakeJobBoardSettingsStore,
  FakeJobFeedReader,
  FakeJobFeedStore,
  FakeJobStore,
  FakeSkippedApifyTokenStore,
  FakeTelegram,
} from "./fake-gateways";
import { ApifyTokenUsedUpError } from "./apify-tokens";
import type { CollectedJob } from "./gateways";
import { COLLECTION_TIME_LIMIT_MS, excludedTitleMatcher, runCollection } from "./job-collection";
import { COLLECT_JOBS } from "./schema";

const now = new Date("2026-11-01T22:00:00Z");

const job = {
  source: "LinkedIn",
  title: "Software Engineer",
  companyName: "Acme",
  location: "Remote",
  url: "https://www.linkedin.com/jobs/view/1",
  postDay: "2026-11-01",
  description: "Build things",
  companyLinkedinUrl: "https://www.linkedin.com/company/acme",
  companyLogoUrl: null as string | null,
};

const search = { keywords: "engineer", location: "Remote" };

function setup({
  jobs = [job] as CollectedJob[],
  enabled = true,
  searches = [search],
  remoteOnly = false,
  apifyTokens = "token",
  excludedKeywords = [] as string[],
} = {}) {
  const board = new FakeJobBoard(jobs);
  const delays: number[] = [];
  return {
    board,
    delays,
    deps: {
      jobBoards: [board],
      jobBoardSettings: new FakeJobBoardSettingsStore([{ source: board.source, enabled, searches, remoteOnly }]),
      excludedKeywords: new FakeExcludedKeywordStore(excludedKeywords),
      actorRuns: new FakeActorRunStore(),
      jobs: new FakeJobStore(),
      jobFeeds: new FakeJobFeedStore(),
      feedReader: new FakeJobFeedReader(),
      apifyTokens,
      skippedApifyTokens: new FakeSkippedApifyTokenStore(),
      telegram: new FakeTelegram(),
      images: new FakeImages(),
      now: () => now,
      sleep: async (ms: number) => void delays.push(ms),
    },
  };
}

test("a Job Collection saves the Jobs found, with the Company's LinkedIn page", async () => {
  const { deps } = setup();

  await runCollection(deps);

  expect(await deps.jobs.list()).toEqual([job]);
});

test("a Job whose title has an Excluded Keyword isn't saved", async () => {
  const senior = { ...job, title: "Senior Software Engineer", url: "https://www.linkedin.com/jobs/view/2" };
  const { deps } = setup({ jobs: [senior, job], excludedKeywords: ["senior"] });

  await runCollection(deps);

  expect(await deps.jobs.list()).toEqual([job]);
});

test("a Job Feed Job whose title has an Excluded Keyword isn't saved", async () => {
  const { deps } = setup({ enabled: false, excludedKeywords: ["Lead"] });
  const url = "https://example.com/jobs";
  await deps.jobFeeds.add(url);
  const lead = { ...job, title: "Tech Lead", url: "https://example.com/jobs/2" };
  deps.feedReader.jobs.set(url, [lead, job]);

  await runCollection(deps);

  expect(await deps.jobs.list()).toEqual([job]);
});

test("Excluded Keywords match whole words and phrases, ignoring case", () => {
  const isExcluded = excludedTitleMatcher(["senior", "Sr.", "team lead", "C++"]);

  expect(isExcluded("SENIOR Engineer")).toBe(true);
  expect(isExcluded("Sr. Developer")).toBe(true);
  expect(isExcluded("Team Lead, Payments")).toBe(true);
  expect(isExcluded("C++ Developer")).toBe(true);
  expect(isExcluded("Seniority Analyst")).toBe(false);
  expect(isExcluded("Lead Engineer")).toBe(false);
  expect(excludedTitleMatcher([])("Senior Engineer")).toBe(false);
});

test("a disabled Job Board starts no actor run", async () => {
  const { board, deps } = setup({ enabled: false });

  await runCollection(deps);

  expect(board.started).toEqual([]);
  expect(await deps.jobs.list()).toEqual([]);
});

test("only Jobs posted today are saved", async () => {
  const yesterday = { ...job, url: "https://www.linkedin.com/jobs/view/2", postDay: "2026-10-31" };
  const { deps } = setup({ jobs: [yesterday, job] });

  await runCollection(deps);

  expect(await deps.jobs.list()).toEqual([job]);
});

test("a Job with an already-saved URL is a Duplicate Job", async () => {
  const { deps } = setup();

  await runCollection(deps);
  await runCollection(deps);

  expect(await deps.jobs.list()).toEqual([job]);
});

test("searches share the limit and a Job Collection saves at most 20 Jobs", async () => {
  const searches = ["a", "b", "c"].map((keywords) => ({ keywords, location: "Remote" }));
  const { board, deps } = setup({ searches });
  board.results = async ({ runId }) =>
    Array.from({ length: 30 }, (_, index) => ({
      ...job,
      url: `https://example.com/${runId}/${index}`,
      title: `Job ${runId}/${index}`,
    }));

  await runCollection(deps);

  expect(board.started.map(({ limit }) => limit)).toEqual([7, 7, 6]);
  expect(await deps.jobs.list()).toHaveLength(20);
});

test("an actor run is polled with a delay until it finishes", async () => {
  const { board, delays, deps } = setup();
  board.statuses = ["running", "running", "succeeded"];

  await runCollection(deps);

  expect(delays).toHaveLength(2);
  expect(await deps.jobs.list()).toEqual([job]);
});

test("an unfinished actor run is saved with its own token and no replacement is started", async () => {
  const { board, deps } = setup();
  const tokens: string[] = [];
  board.results = async ({ token }) => {
    tokens.push(token);
    return [job];
  };
  await deps.actorRuns.save({
    runId: "left-over",
    actor: board.actor,
    token: "old-token",
    search,
    startedAt: new Date("2026-11-01T21:00:00Z"),
  });

  await runCollection(deps);

  expect(board.started).toEqual([]);
  expect(tokens).toEqual(["old-token"]);
  expect(await deps.jobs.list()).toEqual([job]);
  expect(await deps.actorRuns.listUnfinished()).toEqual([]);
});

test("an actor run left from an earlier day keeps that day's Jobs and today's search still runs", async () => {
  const lastNight = { ...job, url: "https://www.linkedin.com/jobs/view/2", postDay: "2026-10-31" };
  const { board, deps } = setup({ jobs: [lastNight, job] });
  await deps.actorRuns.save({
    runId: "left-over",
    actor: board.actor,
    token: "token",
    search,
    startedAt: new Date("2026-10-31T22:00:00Z"),
  });

  await runCollection(deps);

  expect(board.started).toHaveLength(1);
  expect(await deps.jobs.list()).toEqual([lastNight, job]);
});

test("an actor run still going after polling stops is left for the next Job Collection", async () => {
  const { board, deps } = setup();
  board.statuses = ["running"];

  await runCollection(deps);

  expect(await deps.jobs.list()).toEqual([]);
  expect(await deps.actorRuns.listUnfinished()).toHaveLength(1);

  board.statuses = ["succeeded"];
  await runCollection(deps);

  expect(board.started).toHaveLength(1);
  expect(await deps.jobs.list()).toEqual([job]);
});

test("a failed actor run is closed and reported, and the other searches are still saved", async () => {
  const searches = ["a", "b"].map((keywords) => ({ keywords, location: "Remote" }));
  const { board, deps } = setup({ searches });
  board.status = async ({ runId }) => (runId === "LinkedIn-run-1" ? "failed" : "succeeded");

  await expect(runCollection(deps)).rejects.toThrow(/LinkedIn-run-1/);

  expect(await deps.jobs.list()).toEqual([job]);
  expect(await deps.actorRuns.listUnfinished()).toEqual([]);
});

test("a search that can't start doesn't stop the others", async () => {
  const searches = ["a", "b"].map((keywords) => ({ keywords, location: "Remote" }));
  const { board, deps } = setup({ searches });
  const start = board.start.bind(board);
  board.start = async (search, limit, token, options) => {
    if (search.keywords === "a") throw new Error("Apify refused");
    return start(search, limit, token, options);
  };

  await expect(runCollection(deps)).rejects.toThrow(/Apify refused/);

  expect(await deps.jobs.list()).toEqual([job]);
});

test("tokens rotate round-robin and each actor run stores the token that started it", async () => {
  const searches = ["a", "b", "c"].map((keywords) => ({ keywords, location: "Remote" }));
  const { board, deps } = setup({ searches, apifyTokens: " first, second," });
  const stored: string[] = [];
  const save = deps.actorRuns.save.bind(deps.actorRuns);
  deps.actorRuns.save = async (run) => {
    stored.push(run.token);
    await save(run);
  };

  await runCollection(deps);

  expect(board.started.map(({ token }) => token)).toEqual(["first", "second", "first"]);
  expect(stored).toEqual(["first", "second", "first"]);
});

test("a Job Collection with no Apify tokens fails before starting an actor", async () => {
  const { board, deps } = setup({ apifyTokens: " , " });

  await expect(runCollection(deps)).rejects.toThrow(/Apify tokens/);

  expect(board.started).toEqual([]);
});

function requestCollection(runs: FakeFunctionRunStore, at: Date, start: () => void) {
  return acceptFunctionRequest(
    { functionName: COLLECT_JOBS, authorization: "Bearer secret", timeLimitMs: COLLECTION_TIME_LIMIT_MS },
    { runs, secret: "secret", now: () => at, start },
  );
}

test("a Job Collection isn't started while one is active", async () => {
  const runs = new FakeFunctionRunStore();
  await requestCollection(runs, now, () => {});

  const response = await requestCollection(runs, now, () => expect.unreachable());

  expect(response).toEqual({ status: 409 });
  expect(await runs.list()).toHaveLength(1);
});

test("a Job Collection past its time limit doesn't block the next one", async () => {
  const runs = new FakeFunctionRunStore();
  await requestCollection(runs, now, () => {});

  const later = new Date(now.getTime() + COLLECTION_TIME_LIMIT_MS);
  const response = await requestCollection(runs, later, () => {});

  expect(response).toEqual({ status: 202, runId: 2 });
  expect(await runs.list()).toMatchObject([{ status: "failed", finishedAt: later }, { status: "running" }]);
});

test("a large actor run left from an earlier day doesn't use up today's cap", async () => {
  const { board, deps } = setup();
  board.results = async ({ runId, startedAt }) =>
    Array.from({ length: 50 }, (_, index) => ({
      ...job,
      url: `https://example.com/${runId}/${index}`,
      title: `Job ${runId}/${index}`,
      postDay: startedAt.toISOString().slice(0, 10),
    }));
  await deps.actorRuns.save({
    runId: "left-over",
    actor: board.actor,
    token: "token",
    search,
    startedAt: new Date("2026-10-31T22:00:00Z"),
  });

  await runCollection(deps);

  expect(await deps.jobs.list()).toHaveLength(40);
});

test("Jobs that were already saved don't count towards the cap", async () => {
  const searches = ["a", "b"].map((keywords) => ({ keywords, location: "Remote" }));
  const { board, deps } = setup({ searches });
  const alreadySaved = Array.from({ length: 20 }, (_, index) => ({
    ...job,
    url: `https://example.com/old/${index}`,
    title: `Job old/${index}`,
  }));
  await deps.jobs.save(alreadySaved);
  await deps.actorRuns.save({
    runId: "left-over",
    actor: board.actor,
    token: "token",
    search: searches[0],
    startedAt: new Date("2026-11-01T21:00:00Z"),
  });
  await deps.actorRuns.save({
    runId: "left-over-2",
    actor: board.actor,
    token: "token",
    search: searches[1],
    startedAt: new Date("2026-11-01T21:00:00Z"),
  });
  board.results = async ({ runId }) =>
    runId === "left-over"
      ? alreadySaved
      : Array.from({ length: 25 }, (_, index) => ({
          ...job,
          url: `https://example.com/new/${index}`,
          title: `Job new/${index}`,
        }));

  await runCollection(deps);

  expect(await deps.jobs.list()).toHaveLength(40);
});

function glassdoorBoard(jobs: CollectedJob[]) {
  return new FakeJobBoard(jobs, "Glassdoor", "valig/glassdoor-jobs-scraper");
}

const glassdoorJob = {
  source: "Glassdoor",
  title: "Backend Engineer",
  companyName: "Globex",
  location: "New York, NY",
  url: "https://www.glassdoor.com/job-listing/j?jl=1",
  description: "<div>Build APIs</div>",
  companyLinkedinUrl: null,
  companyLogoUrl: null as string | null,
};

test("a Glassdoor Job's post day is calculated from its age in days", async () => {
  const { deps } = setup({ jobs: [] });
  const old = { ...glassdoorJob, url: "https://www.glassdoor.com/job-listing/j?jl=2", ageInDays: 1 };
  const glassdoor = glassdoorBoard([{ ...glassdoorJob, ageInDays: 0 }, old]);
  deps.jobBoards.push(glassdoor);
  await deps.jobBoardSettings.save({ source: "Glassdoor", enabled: true, searches: [search], remoteOnly: false });

  await runCollection(deps);

  expect(glassdoor.started.map(({ limit }) => limit)).toEqual([20]);
  expect(await deps.jobs.list()).toEqual([{ ...glassdoorJob, postDay: "2026-11-01" }]);
});

test("a Job with the same title, Company and post day on another source is a Duplicate Job", async () => {
  const { deps } = setup();
  const sameJob = { ...glassdoorJob, title: "software engineer", companyName: "ACME", ageInDays: 0 };
  deps.jobBoards.push(glassdoorBoard([sameJob, { ...glassdoorJob, ageInDays: 0 }]));
  await deps.jobBoardSettings.save({ source: "Glassdoor", enabled: true, searches: [search], remoteOnly: false });

  await runCollection(deps);

  expect(await deps.jobs.list()).toEqual([job, { ...glassdoorJob, postDay: "2026-11-01" }]);
});

const feedUrl = "https://jobs.example.com/search?q=engineer";

const feedJob = {
  source: "Feed: jobs.example.com",
  title: "Platform Engineer",
  companyName: "Initech",
  location: "Remote",
  url: "https://jobs.example.com/jobs/1",
  description: null,
  companyLinkedinUrl: null,
  companyLogoUrl: null as string | null,
};

test("a Job Feed's Jobs are saved, and one with no post date counts as posted the day it was first seen", async () => {
  const { deps } = setup({ jobs: [] });
  await deps.jobFeeds.add(feedUrl);
  deps.feedReader.jobs.set(feedUrl, [{ ...feedJob, postDay: null }]);

  await runCollection(deps);
  await runCollection({ ...deps, now: () => new Date("2026-11-02T22:00:00Z") });

  expect(deps.feedReader.urlsRead).toEqual([feedUrl, feedUrl]);
  expect(await deps.jobs.list()).toEqual([{ ...feedJob, postDay: "2026-11-01" }]);
});

test("a disabled Job Feed isn't read", async () => {
  const { deps } = setup({ jobs: [] });
  const feed = await deps.jobFeeds.add(feedUrl);
  await deps.jobFeeds.update({ ...feed, enabled: false });
  deps.feedReader.jobs.set(feedUrl, [feedJob]);

  await runCollection(deps);

  expect(deps.feedReader.urlsRead).toEqual([]);
  expect(await deps.jobs.list()).toEqual([]);
});

test("a failing Job Feed doesn't stop the other sources", async () => {
  const { deps } = setup();
  const otherFeed = "https://other.example.com/jobs";
  await deps.jobFeeds.add(feedUrl);
  await deps.jobFeeds.add(otherFeed);
  deps.feedReader.jobs.set(feedUrl, new Error("Firecrawl refused"));
  deps.feedReader.jobs.set(otherFeed, [{ ...feedJob, postDay: "2026-11-01" }]);

  await expect(runCollection(deps)).rejects.toThrow(/Firecrawl refused/);

  expect(await deps.jobs.list()).toEqual([{ ...feedJob, postDay: "2026-11-01" }, job]);
});

test("a disabled Glassdoor Job Board starts no actor run while LinkedIn still runs", async () => {
  const { board, deps } = setup();
  const glassdoor = glassdoorBoard([{ ...glassdoorJob, ageInDays: 0 }]);
  deps.jobBoards.push(glassdoor);
  await deps.jobBoardSettings.save({ source: "Glassdoor", enabled: false, searches: [search], remoteOnly: false });

  await runCollection(deps);

  expect(glassdoor.started).toEqual([]);
  expect(board.started).toHaveLength(1);
  expect(await deps.jobs.list()).toEqual([job]);
});

test("a Job Board's Remote only setting goes to each of its actor runs", async () => {
  const { board, deps } = setup({ searches: [search, { keywords: "data engineer", location: "Berlin" }], remoteOnly: true });

  await runCollection(deps);

  expect(board.started.map(({ remoteOnly }) => remoteOnly)).toEqual([true, true]);
});

test("a failing Glassdoor Job Board doesn't stop LinkedIn or the Job Feeds", async () => {
  const { deps } = setup();
  const glassdoor = glassdoorBoard([{ ...glassdoorJob, ageInDays: 0 }]);
  glassdoor.statuses = ["failed"];
  deps.jobBoards.push(glassdoor);
  await deps.jobBoardSettings.save({ source: "Glassdoor", enabled: true, searches: [search], remoteOnly: false });
  await deps.jobFeeds.add(feedUrl);
  deps.feedReader.jobs.set(feedUrl, [{ ...feedJob, postDay: "2026-11-01" }]);

  await expect(runCollection(deps)).rejects.toThrow(/Glassdoor-run-1/);

  expect(await deps.jobs.list()).toEqual([{ ...feedJob, postDay: "2026-11-01" }, job]);
});

const image = (name: string) => ({ bytes: new TextEncoder().encode(name), type: "image/png" });

test("each new Job is sent as its own Job Alert, with the Company logo and a button to its page", async () => {
  const logoUrl = "https://media.licdn.com/acme.png";
  const other = { ...job, url: "https://www.linkedin.com/jobs/view/2", title: "R&D <Lead>", companyLogoUrl: logoUrl };
  const { deps } = setup({ jobs: [job, other] });
  deps.images.images.set(logoUrl, image("acme"));

  await runCollection(deps);

  const link = { label: "📄 See Details", url: job.url };
  expect(deps.telegram.messages).toEqual([
    { text: "💼 <b>Software Engineer</b>\n\n🏢 Acme\n\n📍 Remote\n\n<i>(LinkedIn)</i>", link, html: true },
    {
      text: "💼 <b>R&amp;D &lt;Lead&gt;</b>\n\n🏢 Acme\n\n📍 Remote\n\n<i>(LinkedIn)</i>",
      link: { ...link, url: other.url },
      html: true,
      photo: image("acme"),
    },
  ]);
});

test("a Job Alert shows the salary after the location, without saving it", async () => {
  const { deps } = setup({ jobs: [{ ...job, salary: "$120,000 – $160,000 / year" }] });

  await runCollection(deps);

  expect(deps.telegram.messages.map(({ text }) => text)).toEqual([
    "💼 <b>Software Engineer</b>\n\n🏢 Acme\n\n📍 Remote\n\n💰 $120,000 – $160,000 / year\n\n<i>(LinkedIn)</i>",
  ]);
  expect(await deps.jobs.list()).toEqual([job]);
});

test("a Job Alert left from an earlier Job Collection goes out without the salary", async () => {
  const { deps } = setup({ jobs: [{ ...job, salary: "$120,000 / year" }] });
  const send = deps.telegram.sendHtml.bind(deps.telegram);
  deps.telegram.sendHtml = async () => {
    throw new Error("Telegram is down");
  };
  await expect(runCollection(deps)).rejects.toThrow(/Telegram is down/);
  deps.telegram.sendHtml = send;
  deps.jobBoards = [];

  await runCollection(deps);

  expect(deps.telegram.messages.map(({ text }) => text)).toEqual([
    "💼 <b>Software Engineer</b>\n\n🏢 Acme\n\n📍 Remote\n\n<i>(LinkedIn)</i>",
  ]);
});

test("a Job Alert whose logo fails to fetch shows its source's placeholder", async () => {
  const { deps } = setup({ jobs: [{ ...job, companyLogoUrl: "https://media.licdn.com/broken.png" }] });
  deps.images.placeholders.set("linkedin", image("linkedin"));
  deps.images.placeholders.set("glassdoor", image("glassdoor"));

  await runCollection(deps);

  expect(deps.telegram.messages.map(({ photo }) => photo)).toEqual([image("linkedin")]);
});

test("a Job Alert whose photo Telegram refuses falls back to the next photo", async () => {
  const logoUrl = "https://media.licdn.com/huge.png";
  const { deps } = setup({ jobs: [{ ...job, companyLogoUrl: logoUrl }] });
  deps.images.images.set(logoUrl, image("huge"));
  deps.images.placeholders.set("linkedin", image("linkedin"));
  const sendHtml = deps.telegram.sendHtml.bind(deps.telegram);
  deps.telegram.sendHtml = async (html, link, photo) => {
    if (photo && new TextDecoder().decode(photo.bytes) === "huge") throw new Error("Telegram refused the message: 400");
    await sendHtml(html, link, photo);
  };

  await runCollection(deps);

  expect(deps.telegram.messages.map(({ photo }) => photo)).toEqual([image("linkedin")]);
});

test("a Job Alert with no photo at all still goes out as text", async () => {
  const { deps } = setup();

  await runCollection(deps);

  expect(deps.telegram.messages).toHaveLength(1);
  expect(deps.telegram.messages[0].photo).toBeUndefined();
});

test("a Job Feed's Job with no logo shows its page's OG image, then the Job Feed placeholder", async () => {
  const { deps } = setup({ jobs: [] });
  await deps.jobFeeds.add(feedUrl);
  const withOgImage = { ...feedJob, postDay: "2026-11-01" };
  const withBrokenOgImage = { ...withOgImage, url: "https://jobs.example.com/jobs/2", title: "Other" };
  deps.feedReader.jobs.set(feedUrl, [withOgImage, withBrokenOgImage]);
  deps.images.pageImages.set(withOgImage.url, "https://jobs.example.com/og.png");
  deps.images.pageImages.set(withBrokenOgImage.url, "https://jobs.example.com/broken.png");
  deps.images.images.set("https://jobs.example.com/og.png", image("og"));
  deps.images.images.set(
    "https://placehold.co/800x400/EBEBEB/B5B5B5/png?text=jobs.example.com",
    image("job-feed"),
  );

  await runCollection(deps);

  expect(deps.telegram.messages.map(({ text, photo }) => [text.split("\n")[0], photo])).toEqual([
    ["💼 <b>Platform Engineer</b>", image("og")],
    ["💼 <b>Other</b>", image("job-feed")],
  ]);
});

test("a Glassdoor Job Alert with no logo shows the Glassdoor placeholder", async () => {
  const { deps } = setup({ jobs: [] });
  deps.jobBoards.push(glassdoorBoard([{ ...glassdoorJob, ageInDays: 0 }]));
  await deps.jobBoardSettings.save({ source: "Glassdoor", enabled: true, searches: [search], remoteOnly: false });
  deps.images.placeholders.set("glassdoor", image("glassdoor"));
  deps.images.placeholders.set("linkedin", image("linkedin"));

  await runCollection(deps);

  expect(deps.telegram.messages.map(({ photo }) => photo)).toEqual([image("glassdoor")]);
});

test("every new Job is alerted, however many a Job Collection saves", async () => {
  const { deps } = setup({ jobs: [] });
  await deps.jobFeeds.add(feedUrl);
  const jobs = Array.from({ length: 25 }, (_, index) => ({
    ...feedJob,
    url: `https://jobs.example.com/jobs/${index}`,
    title: `Job ${index}`,
    postDay: "2026-11-01",
  }));
  deps.feedReader.jobs.set(feedUrl, jobs);

  await runCollection(deps);
  await runCollection(deps);

  expect(deps.telegram.messages.map(({ link }) => link?.url)).toEqual(jobs.map(({ url }) => url));
});

test("a Job Alert that failed to send is retried on the next Job Collection and never repeated", async () => {
  const { deps } = setup();
  deps.telegram.failing = true;

  await expect(runCollection(deps)).rejects.toThrow(/Telegram is down/);
  deps.telegram.failing = false;
  await runCollection(deps);
  await runCollection(deps);

  expect(deps.telegram.messages.map(({ link }) => link?.url)).toEqual([job.url]);
});

test("pending Job Alerts from an earlier run are sent first", async () => {
  const { deps } = setup({ jobs: [] });
  await deps.jobFeeds.add(feedUrl);
  const jobs = Array.from({ length: 21 }, (_, index) => ({
    ...feedJob,
    url: `https://jobs.example.com/jobs/${index}`,
    title: `Job ${index}`,
    postDay: "2026-11-01",
  }));
  deps.feedReader.jobs.set(feedUrl, jobs.slice(0, 1));
  deps.telegram.failing = true;
  await expect(runCollection(deps)).rejects.toThrow();

  deps.telegram.failing = false;
  deps.feedReader.jobs.set(feedUrl, jobs.slice(1));
  await runCollection(deps);

  expect(deps.telegram.messages.map(({ link }) => link?.url)).toEqual(jobs.map(({ url }) => url));
});

test("a Job Alert that fails to send doesn't stop the others", async () => {
  const other = { ...job, url: "https://www.linkedin.com/jobs/view/2", title: "Data Engineer" };
  const { deps } = setup({ jobs: [job, other] });
  const sendHtml = deps.telegram.sendHtml.bind(deps.telegram);
  deps.telegram.sendHtml = async (html, link, photo) => {
    if (link.url === job.url) throw new Error("Telegram refused the message: 400");
    await sendHtml(html, link, photo);
  };

  await expect(runCollection(deps)).rejects.toThrow(/Telegram refused/);

  expect(deps.telegram.messages.map(({ link }) => link?.url)).toEqual([other.url]);
});

test("when all Apify tokens are used up, the Job Collection fails and the Admin is alerted once", async () => {
  const searches = ["a", "b"].map((keywords) => ({ keywords, location: "Remote" }));
  const { board, deps } = setup({ jobs: [], searches, apifyTokens: "first,second" });
  board.start = async () => {
    throw new ApifyTokenUsedUpError(402);
  };
  await deps.jobFeeds.add(feedUrl);
  deps.feedReader.jobs.set(feedUrl, [{ ...feedJob, postDay: "2026-11-01" }]);

  await expect(runCollection(deps)).rejects.toThrow(/All Apify tokens are used up/);

  expect(deps.telegram.sent).toEqual([
    "🪫 <b>Apify tokens used up</b>\n\nAll tokens are out of credit until the next UTC day.\nJob Feeds still run; Job Board searches are skipped.",
    "💼 <b>Platform Engineer</b>\n\n🏢 Initech\n\n📍 Remote\n\n<i>(Feed: jobs.example.com)</i>",
  ]);
});
