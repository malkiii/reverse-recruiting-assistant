import { z } from "zod";
import { withWritingRules } from "./cover-letter-instructions";
import { NAME_PLACEHOLDER, RESUME_LINK_PLACEHOLDER } from "./cover-letter-placeholders";
import type {
  Application,
  ApplicationChanges,
  ApplicationStatus,
  ApplicationStep,
  ApplicationStore,
  CompanyPageSearch,
  CompanyStore,
  DriveFile,
  DecisionMakerStore,
  DriveGateway,
  FunctionRun,
  FunctionRunStore,
  GmailGateway,
  JobPageReader,
  JobStore,
  LlmGateway,
  PdfReader,
  ResumeFolderStore,
  ReviewChanges,
  SavedJob,
  StepLogStore,
} from "./gateways";
import {
  chooseDecisionMakers,
  type DecisionMakerSearchDeps,
  describePerson,
  inCooldown,
  newPollBudget,
  type PollBudget,
  savedPeopleCooldownReason,
  WaitForRetryError,
} from "./decision-maker-search";
import { APPLICATION_STEPS, PASSED_TIME_LIMIT_ERROR, PREPARE_APPLICATION, SEND_APPLICATION } from "./schema";
import { FEED_SOURCE_PREFIX } from "./firecrawl-job-feed";
import { resumesIn } from "./resumes";

export const PREPARE_TIME_LIMIT_MS = 30 * 60_000;
export const SEND_TIME_LIMIT_MS = 10 * 60_000;
/** The pause between two emails of one Send, so it doesn't look like a bulk blast. */
export const SEND_GAP_MS = 5_000;

type ClaimDeps = { jobs: JobStore; applications: ApplicationStore; now: () => Date };

export type PrepareDeps = ClaimDeps &
  DecisionMakerSearchDeps & {
    stepLogs: StepLogStore;
    jobPages: JobPageReader;
    resumeFolder: ResumeFolderStore;
    /** The Admin's Drive, reached through the Google connection. */
    drive: () => Promise<DriveGateway>;
    /** The LLM the Admin chose in settings. */
    llm: () => Promise<LlmGateway>;
    /** The Cover Letter instructions the Admin saved in settings, null for the default. */
    coverLetterInstructions: () => Promise<string | null>;
    /** Reads the chosen Resume PDF as markdown, without the LLM. */
    pdfs: PdfReader;
    companies: CompanyStore;
    companyPageSearch: CompanyPageSearch;
  };

/** The Admin's Prepare: atomically claims the Job's one Application. Null when the Job is unknown or already has one. */
export async function prepare({ jobs, applications, now }: ClaimDeps, jobId: number) {
  if (!(await jobs.get(jobId))) return null;
  return applications.claim(jobId, now());
}

const APPLICATION_TIME_LIMITS_MS: Record<string, number> = {
  [PREPARE_APPLICATION]: PREPARE_TIME_LIMIT_MS,
  [SEND_APPLICATION]: SEND_TIME_LIMIT_MS,
};
const PASSED_TIME_LIMIT = "Its Function passed its time limit: Retry to resume it";

const FUNCTION_FOR_STATUS: Partial<Record<ApplicationStatus, string>> = {
  preparing: PREPARE_APPLICATION,
  sending: SEND_APPLICATION,
};

/**
 * Whether Modal killed the Function preparing or sending the Application: its newest run is of that Function and
 * passed its time limit, whether still recorded as running or marked failed by a later start. A run that ended on its
 * own doesn't count, so an Application just claimed, whose run isn't recorded yet, isn't taken for a killed one.
 */
function isStalled(application: Application, runs: FunctionRun[], now: Date) {
  const [newest] = runs;
  const functionName = FUNCTION_FOR_STATUS[application.status];
  if (!functionName || newest?.functionName !== functionName) return false;
  if (newest.status === "failed") return newest.error === PASSED_TIME_LIMIT_ERROR;
  const elapsedMs = now.getTime() - newest.startedAt.getTime();
  return newest.status === "running" && elapsedMs >= APPLICATION_TIME_LIMITS_MS[functionName];
}

/**
 * The Application as the dashboard shows it. Modal can't report a Function it killed, so an Application whose
 * Function passed its time limit shows as failed, as its Retry marks it.
 */
export function applicationAsOf(application: Application, runs: FunctionRun[], now: Date): Application {
  return isStalled(application, runs, now) ? { ...application, status: "failed", error: PASSED_TIME_LIMIT } : application;
}

export type RetryDeps = Pick<ClaimDeps, "applications" | "now"> & {
  runs: Pick<FunctionRunStore, "listForApplication" | "markRetried">;
  stepLogs: StepLogStore;
};

/**
 * Marks the Application failed, at the step its Function was killed in, when that Function passed its time limit.
 * Marking the killed run retried is the atomic claim, so a double click on Retry fails it once and starts one Function.
 */
async function failIfStalled(deps: RetryDeps, applicationId: number) {
  const application = await deps.applications.get(applicationId);
  const [newest] = await deps.runs.listForApplication(applicationId);
  if (!application || !newest || !isStalled(application, [newest], deps.now())) return;
  if (!(await deps.runs.markRetried(newest.id, deps.now()))) return;
  await deps.stepLogs.failRunning(applicationId, PASSED_TIME_LIMIT, deps.now());
  await deps.applications.fail(applicationId, application.status, PASSED_TIME_LIMIT);
}

/**
 * The Admin's Retry of an Application that failed while being prepared, resumed from its current step.
 * Null when it isn't failed, or failed at the send step, which retrySend resumes.
 */
export async function retry(deps: RetryDeps, applicationId: number) {
  await failIfStalled(deps, applicationId);
  return (await deps.applications.retry(applicationId, "prepare")) ? applicationId : null;
}

/** The Admin's Cancel at Review: final, and the Job's one Application stays, so the Job can't be Prepared again. */
export async function cancel({ applications }: Pick<ClaimDeps, "applications">, applicationId: number) {
  return applications.cancel(applicationId);
}

/**
 * The Admin's Delete: removes an Application no Function is working on, so its Job can be Prepared again.
 * One whose Function passed its time limit is marked failed first, so it can be deleted too.
 */
export async function deleteApplication(deps: RetryDeps, applicationId: number) {
  await failIfStalled(deps, applicationId);
  return deps.applications.remove(applicationId);
}

export type EditResult = { saved: true } | { saved: false; error: string };

export type ReviewEdit = { subject?: string; coverLetter?: string; resumeFileId?: string };

export type EditDeps = Pick<ClaimDeps, "applications"> & Pick<PrepareDeps, "resumeFolder" | "drive">;

/** The Admin's edit in Review. Refused once the Application has left Review. */
export async function edit(deps: EditDeps, applicationId: number, { subject, coverLetter, resumeFileId }: ReviewEdit) {
  const changes: ReviewChanges = {};
  if (subject !== undefined) {
    if (!subject.trim()) return refused(EMPTY_SUBJECT);
    changes.subject = subject.trim();
  }
  if (coverLetter !== undefined) {
    if (!hasPlaceholders(coverLetter)) return refused(MISSING_PLACEHOLDERS);
    changes.coverLetter = coverLetter.trim();
  }
  if (resumeFileId !== undefined) {
    // Looked up again rather than trusted from the form, so only a listed Resume is ever sent.
    const folder = await deps.resumeFolder.get();
    const resumes = folder ? resumesIn(await (await deps.drive()).listFiles(folder.id)) : [];
    const resume = resumes.find(({ id }) => id === resumeFileId);
    if (!resume) return refused(NOT_A_RESUME);
    Object.assign(changes, { resumeFileId: resume.id, resumeName: resume.name, resumeLink: resume.webViewLink });
  }
  // An empty change saves nothing, but is still refused outside Review.
  const saved =
    Object.keys(changes).length === 0
      ? (await deps.applications.get(applicationId))?.status === "in-review"
      : await deps.applications.edit(applicationId, changes);
  return saved ? SAVED : refused(NOT_IN_REVIEW);
}

export type RemoveDeps = Pick<ClaimDeps, "applications" | "now"> & Pick<PrepareDeps, "decisionMakers">;

/** The Admin's removal of a Decision Maker in Review. They stay at the Company, so they can be added back. */
export async function removeDecisionMaker(deps: RemoveDeps, applicationId: number, decisionMakerId: number) {
  const application = await deps.applications.get(applicationId);
  if (application?.status !== "in-review") return refused(NOT_IN_REVIEW);
  const recipients = await deps.decisionMakers.listForApplication(applicationId);
  if (!recipients.some(({ id }) => id === decisionMakerId)) return refused(NOT_A_RECIPIENT);
  if (recipients.length === 1) return refused(LAST_RECIPIENT);
  return (await deps.applications.removeRecipient(applicationId, decisionMakerId)) ? SAVED : refused(NOT_IN_REVIEW);
}

/**
 * The Admin's addition of a Decision Maker in Review: anyone found at the Application's Company with an email who
 * isn't in Cooldown, beyond the 5 it chose on its own.
 */
export async function addDecisionMaker(deps: RemoveDeps, applicationId: number, decisionMakerId: number) {
  const application = await deps.applications.get(applicationId);
  if (application?.status !== "in-review" || application.companyId === null) return refused(NOT_IN_REVIEW);
  const recipients = await deps.decisionMakers.listForApplication(applicationId);
  if (recipients.some(({ id }) => id === decisionMakerId)) return refused(ALREADY_A_RECIPIENT);
  const people = await deps.decisionMakers.listForCompany(application.companyId);
  const person = people.find(({ id }) => id === decisionMakerId);
  if (!person) return refused(NOT_AT_COMPANY);
  if (!person.email) return refused(NO_EMAIL);
  if (inCooldown(person, deps.now())) return refused(IN_COOLDOWN);
  return (await deps.applications.addRecipient(applicationId, decisionMakerId)) ? SAVED : refused(NOT_IN_REVIEW);
}

const SAVED: EditResult = { saved: true };
const refused = (error: string): EditResult => ({ saved: false, error });
const NOT_IN_REVIEW = "Only an Application in Review can be edited";
const NOT_A_RECIPIENT = "That person isn't one of this Application's Decision Makers";
const LAST_RECIPIENT = "An Application needs a Decision Maker: Cancel it instead";
const ALREADY_A_RECIPIENT = "That person is already one of this Application's Decision Makers";
const NOT_AT_COMPANY = "That person wasn't found at this Application's Company";
const NO_EMAIL = "That person has no email";
const IN_COOLDOWN = "That person is in Cooldown";
const EMPTY_SUBJECT = "The subject can't be empty";
const NOT_A_RESUME = "That file isn't one of the Resumes in your Resume Folder";
const MISSING_PLACEHOLDERS = "The Cover Letter needs {{name}} in its first line and {{resume_link}} at its end";

const xml = (tag: string, content: string) => `<${tag}>\n${content}\n</${tag}>`;

const CHOOSE_RESUME_INSTRUCTIONS = [
  "You help a job seeker apply to a job.",
  "Read the job page and choose the one resume, by filename, whose target role fits the job best.",
  "Also give the one main industry of the hiring company as a short keyword, the job's location as city and country",
  "(or 'Remote'), and a one-paragraph summary of the job's role, responsibilities and requirements.",
  "Copy resumeFilename exactly from the listed filenames.",
].join(" ");

const chooseResumeSchema = z.object({
  industry: z.string(),
  jobLocation: z.string(),
  resumeFilename: z.string(),
  jobSummary: z.string(),
});

/** How many times a step is tried before its Application is marked failed. */
export const STEP_ATTEMPTS = 3;
/** The wait before a step's next attempt, multiplied by the attempts so far. */
export const STEP_RETRY_DELAY_MS = 10_000;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

type StepDeps = { stepLogs: StepLogStore; now: () => Date; sleep: (ms: number) => Promise<void> };

/**
 * Runs one step, logging each attempt, and tries it again after an error, up to STEP_ATTEMPTS in all. A Stop isn't tried
 * again, as it's an expected end, nor is an error that waits for the Admin's Retry. Attempts are numbered across Retries.
 */
async function runStep(deps: StepDeps, applicationId: number, step: ApplicationStep, work: () => Promise<string>) {
  const earlier = (await deps.stepLogs.listForApplication(applicationId)).filter((log) => log.step === step).length;
  for (let attempt = 1; ; attempt += 1) {
    const logId = await deps.stepLogs.start({ applicationId, step, attempt: earlier + attempt, startedAt: deps.now() });
    try {
      const result = await work();
      await deps.stepLogs.finish(logId, { status: "succeeded", result, error: null, finishedAt: deps.now() });
      return;
    } catch (error) {
      const stopped = error instanceof Stop && error.status !== "failed";
      await deps.stepLogs.finish(logId, {
        status: stopped ? "stopped" : "failed",
        result: null,
        error: messageOf(error),
        finishedAt: deps.now(),
      });
      if (error instanceof Stop || error instanceof WaitForRetryError || attempt === STEP_ATTEMPTS) throw error;
      console.warn(`Application ${applicationId}: ${step} attempt ${earlier + attempt} failed, trying again:`, error);
      await deps.sleep(STEP_RETRY_DELAY_MS * attempt);
    }
  }
}

/** An expected end to Prepare, shown on the Application rather than failing the Function. */
class Stop extends Error {
  constructor(
    message: string,
    public status: ApplicationStatus = "failed",
  ) {
    super(message);
  }
}

/** The Resumes in the Resume Folder. Stops when there are none, before anything is paid for. */
async function listResumes(deps: PrepareDeps) {
  const folder = await deps.resumeFolder.get();
  if (!folder) throw new Stop("No Resume Folder is chosen: choose one on the dashboard's Google page");
  const resumes = resumesIn(await (await deps.drive()).listFiles(folder.id));
  if (resumes.length === 0) {
    throw new Stop('Your Resume Folder has no Resume: add a PDF whose name ends in "resume" or "CV"');
  }
  return resumes;
}

/**
 * The Job's content. A Job Board Job uses its collected description, as its actor already extracted it.
 * A Feed Job has none, so its Job page is read as markdown. Either ends as Direct Apply when there's nothing to read.
 */
async function readJob(deps: PrepareDeps, job: SavedJob) {
  if (!job.source.startsWith(FEED_SOURCE_PREFIX)) {
    const description = job.description?.trim();
    if (!description) throw new Stop("The Job has no description, so apply through the Job link", "direct-apply");
    return description;
  }
  try {
    const page = (await deps.jobPages.read(job.url)).trim();
    if (page) return page;
    console.warn(`Job page ${job.url}: empty`);
  } catch (error) {
    console.warn(`Job page ${job.url}: couldn't be read:`, error);
  }
  throw new Stop("The Job page couldn't be read, so apply through the Job link", "direct-apply");
}

/** LLM request 1: the Job page and the Resume filenames, for the industry, Job location, Resume and Job Summary. */
async function chooseResume(deps: PrepareDeps, job: SavedJob, jobPage: string, resumes: DriveFile[]) {
  const prompt = [
    xml("job_title", job.title),
    xml("company", job.companyName),
    xml("job_page", jobPage),
    xml("resume_filenames", resumes.map(({ name }) => `<resume_filename>${name}</resume_filename>`).join("\n")),
  ].join("\n\n");

  const chosen = await (await deps.llm()).generate({
    instructions: CHOOSE_RESUME_INSTRUCTIONS,
    prompt,
    schema: chooseResumeSchema,
  });
  // A wrong file must never be sent, so an unknown name stops the Application instead of being guessed at.
  const resume = resumes.find(({ name }) => name === chosen.resumeFilename);
  if (!resume) throw new Stop(`The LLM chose "${chosen.resumeFilename}", which isn't one of your Resumes`);

  return {
    industry: chosen.industry.trim() || null,
    jobLocation: chosen.jobLocation,
    jobSummary: chosen.jobSummary,
    resumeFileId: resume.id,
    resumeName: resume.name,
    resumeLink: resume.webViewLink,
  };
}

const COMPANY_SUFFIXES = /\b(corporation|limited|corp|gmbh|inc|llc|ltd|plc|co)\b/g;

/** A Company name for matching: lowercased, without "| LinkedIn", punctuation or suffixes such as Inc, LLC and Ltd. */
const matchableName = (name: string) =>
  name
    .toLowerCase()
    .replace("| linkedin", " ")
    .replace(/[^\p{L}\p{N}\s&]/gu, " ")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Whether a search result's title names the Company: one name contains the other. */
function namesMatch(companyName: string, title: string) {
  const company = matchableName(companyName);
  const found = matchableName(title);
  return company !== "" && found !== "" && (company.includes(found) || found.includes(company));
}

type CompanySearchDetails = Pick<Application, "industry" | "jobLocation">;

/**
 * The Company's LinkedIn page: the one saved on the Job, otherwise a search's first result when its title matches.
 * Ends as Direct Apply when the page can't be confirmed. Returns the Company's ID.
 */
async function findCompany(
  deps: PrepareDeps,
  id: number,
  job: SavedJob,
  { industry, jobLocation }: CompanySearchDetails,
) {
  let linkedinUrl = job.companyLinkedinUrl;
  if (!linkedinUrl) {
    // A remote Job's location doesn't narrow down where the Company is.
    const where = jobLocation && !/remote/i.test(jobLocation) ? ["in", jobLocation] : [];
    const query = [job.companyName, industry, ...where, "site:linkedin.com/company"].filter(Boolean).join(" ");
    console.log(`Application ${id}: searching for the Company page: "${query}"`);
    const result = await deps.companyPageSearch.firstResult(query);
    if (!result || !namesMatch(job.companyName, result.title)) {
      console.log(`Company page search "${query}": no match in ${JSON.stringify(result)}`);
      throw new Stop("The Company's LinkedIn page couldn't be confirmed, so apply through the Job link", "direct-apply");
    }
    linkedinUrl = result.url;
    console.log(`Application ${id}: search found "${result.title}" ${result.url}`);
  } else {
    console.log(`Application ${id}: Company page from the Job: ${linkedinUrl}`);
  }
  return { companyId: await deps.companies.findOrCreate({ name: job.companyName, linkedinUrl }), linkedinUrl };
}

/** Stops before anything is paid for when the Job's Company is already saved and all its people are in Cooldown. */
async function checkSavedPeopleCooldown(deps: PrepareDeps, job: SavedJob) {
  const company = job.companyLinkedinUrl ? await deps.companies.findByLinkedinUrl(job.companyLinkedinUrl) : undefined;
  const reason = company ? await savedPeopleCooldownReason(deps, company.id) : null;
  if (reason) throw new Stop(reason, "all-in-cooldown");
}

const writeCoverLetterSchema = z.object({ subject: z.string(), coverLetter: z.string() });

/** Whether a Cover Letter has {{name}} in its first line and ends with {{resume_link}}, so every email can be filled in. */
function hasPlaceholders(coverLetter: string) {
  const text = coverLetter.trim();
  return text.split("\n")[0].includes(NAME_PLACEHOLDER) && text.endsWith(RESUME_LINK_PLACEHOLDER);
}

/** The chosen Resume PDF, read as markdown without the LLM. */
async function readResume(deps: PrepareDeps, resumeFileId: string) {
  const pdf = await (await deps.drive()).download(resumeFileId);
  const markdown = (await deps.pdfs.toMarkdown(pdf)).trim();
  if (!markdown) throw new Stop("Your Resume has no text to read: export it as a PDF with selectable text");
  return markdown;
}

/** LLM request 2: the Job Summary and Resume markdown, for a subject and a Cover Letter with its placeholders. */
async function writeCoverLetter(deps: PrepareDeps, id: number) {
  const application = await deps.applications.get(id);
  const { jobSummary, resumeFileId } = application ?? {};
  if (!jobSummary || !resumeFileId) throw new Error(`Application ${id} has no Job Summary or Resume`);

  const prompt = [xml("job_summary", jobSummary), xml("resume", await readResume(deps, resumeFileId))].join("\n\n");
  const written = await (await deps.llm()).generate({
    instructions: withWritingRules(await deps.coverLetterInstructions()),
    prompt,
    schema: writeCoverLetterSchema,
  });
  const coverLetter = written.coverLetter.trim();
  if (!hasPlaceholders(coverLetter)) {
    throw new Stop(
      `The LLM's Cover Letter is missing ${NAME_PLACEHOLDER} in its first line or ${RESUME_LINK_PLACEHOLDER} at its end`,
    );
  }
  return { subject: written.subject.trim(), coverLetter };
}

/** Stops before Review when the Resume Folder isn't shared by link, so a recipient never gets a dead Resume link. */
async function checkSharing(deps: PrepareDeps) {
  const folder = await deps.resumeFolder.get();
  if (!folder) throw new Stop("No Resume Folder is chosen: choose one on the dashboard's Google page");
  const drive = await deps.drive();
  if (!(await drive.isSharedByLink(folder.id))) {
    throw new Stop(`Your Resume Folder "${folder.name}" isn't shared as "Anyone with the link": share it, then Retry`);
  }
}

type StepOutcome = { result: string; changes: ApplicationChanges };
type PrepareStep = Exclude<ApplicationStep, "send">;

/** What one prepare-application run shares between its steps. */
type PrepareRun = { job: SavedJob; polls: PollBudget };

/** What each Prepare step does, from the Application as the steps before it saved it. */
const PREPARE_STEP_WORK: Record<
  PrepareStep,
  (deps: PrepareDeps, application: Application, run: PrepareRun) => Promise<StepOutcome>
> = {
  async "read-job"(deps, _application, { job }) {
    await checkSavedPeopleCooldown(deps, job);
    await listResumes(deps);
    const jobPage = await readJob(deps, job);
    const isFeedJob = job.source.startsWith(FEED_SOURCE_PREFIX);
    return { result: isFeedJob ? "Read the Job page" : "Read the Job's collected description", changes: { jobPage } };
  },

  async "choose-resume"(deps, application, { job }) {
    const resumes = await listResumes(deps);
    const jobPage = application.jobPage ?? (await readJob(deps, job));
    const chosen = await chooseResume(deps, job, jobPage, resumes);
    return { result: `Chose ${chosen.resumeName}`, changes: { jobPage, ...chosen } };
  },

  async "find-company-page"(deps, application, { job }) {
    const { companyId, linkedinUrl } = await findCompany(deps, application.id, job, application);
    return { result: `Found the Company page ${linkedinUrl}`, changes: { companyId } };
  },

  async "find-decision-makers"(deps, { id, companyId }, { polls }) {
    const company = companyId === null ? undefined : await deps.companies.get(companyId);
    if (!company) throw new Error(`No Company ${companyId} for Application ${id}`);
    const choice = await chooseDecisionMakers(deps, id, company, polls);
    if (choice.outcome === "no-contacts") {
      throw new Stop("No Decision Maker with an email address was found", "no-contacts");
    }
    if (choice.outcome === "all-in-cooldown") throw new Stop(choice.reason, "all-in-cooldown");
    const people = choice.decisionMakers.map(describePerson).join(", ");
    return { result: `Chose ${choice.decisionMakers.length} Decision Maker(s): ${people}`, changes: {} };
  },

  async "write-cover-letter"(deps, { id }) {
    const written = await writeCoverLetter(deps, id);
    return { result: `Wrote "${written.subject}"`, changes: written };
  },

  async "check-sharing"(deps) {
    await checkSharing(deps);
    // The step stays current, as Send has its own.
    return { result: "The Resume Folder is shared by link: in Review", changes: { status: "in-review" } };
  },
};

const nextStep = (step: ApplicationStep) => APPLICATION_STEPS[APPLICATION_STEPS.indexOf(step) + 1];

/** Runs the Prepare steps from the current one, until the Application is in Review or stops. */
async function runSteps(deps: PrepareDeps, application: Application) {
  const { id } = application;
  const job = await deps.jobs.get(application.jobId);
  if (!job) throw new Error(`No Job ${application.jobId} for Application ${id}`);
  const run: PrepareRun = { job, polls: newPollBudget() };

  let current: Application | undefined = application;
  while (current?.status === "preparing") {
    const saved: Application = current;
    const step = saved.currentStep;
    if (step === "send") throw new Error(`Application ${id} is at the send step, so it can't be prepared`);
    await runStep(deps, id, step, async () => {
      const { result, changes } = await PREPARE_STEP_WORK[step](deps, saved, run);
      const advance = changes.status === undefined ? { currentStep: nextStep(step) } : {};
      await deps.applications.update(id, { ...changes, ...advance });
      console.log(`Application ${id}: ${step}: ${result}`);
      return result;
    });
    current = await deps.applications.get(id);
  }
}

/**
 * The prepare-application Function: runs the Application's Prepare steps from its current step.
 * A stop is saved on the Application. Any other error marks it failed and fails the Function.
 */
export async function runPreparation(deps: PrepareDeps, applicationId: number) {
  const application = await deps.applications.get(applicationId);
  if (!application) throw new Error(`No Application ${applicationId}`);
  if (application.status !== "preparing") {
    console.log(`Application ${applicationId}: ${application.status}, nothing to prepare`);
    return;
  }

  try {
    await runSteps(deps, application);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof Stop ? error.status : "failed";
    await deps.applications.update(applicationId, { status, error: message });
    console.log(`Application ${applicationId}: ${status}: ${message}`);
    if (!(error instanceof Stop)) throw error;
  }
}

export type SendDeps = Pick<ClaimDeps, "applications" | "now"> & {
  stepLogs: StepLogStore;
  decisionMakers: DecisionMakerStore;
  /** The Admin's Gmail, reached through the Google connection. */
  gmail: () => Promise<GmailGateway>;
  sleep: (ms: number) => Promise<void>;
  /** The Sending setting, read at each check. Compose's DISABLE_SEND forces it off. */
  sendingAllowed: () => Promise<boolean>;
};

export type SendClaim = { outcome: "claimed" } | { outcome: "not-in-review" } | { outcome: "refused"; error: string };
export type RetrySendClaim = { outcome: "claimed" } | { outcome: "not-failed" } | { outcome: "refused"; error: string };

const SEND_NOT_ALLOWED = "Sending is turned off: turn it on in Settings (DISABLE_SEND also keeps it off)";

/**
 * The Admin's Send: checks the Application can be sent, then atomically moves it from Review to sending, which locks it.
 * Nothing is emailed until the send-application Function runs.
 */
export async function send(deps: Pick<SendDeps, "applications" | "decisionMakers" | "sendingAllowed">, applicationId: number): Promise<SendClaim> {
  if (!(await deps.sendingAllowed())) return { outcome: "refused", error: SEND_NOT_ALLOWED };
  const application = await deps.applications.get(applicationId);
  if (application?.status !== "in-review") return { outcome: "not-in-review" };
  if (!application.subject?.trim() || !application.coverLetter || !hasPlaceholders(application.coverLetter)) {
    return { outcome: "refused", error: MISSING_PLACEHOLDERS };
  }
  if (!application.resumeLink) return { outcome: "refused", error: "The Application has no Resume link" };
  if ((await deps.decisionMakers.listForApplication(applicationId)).length === 0) {
    return { outcome: "refused", error: LAST_RECIPIENT };
  }
  return (await deps.applications.claimSend(applicationId)) ? { outcome: "claimed" } : { outcome: "not-in-review" };
}

/**
 * The Admin's Retry of an Application that failed at the send step: atomically moves it back to sending, still locked.
 * The send-application Function then emails only the recipients not emailed yet.
 */
export async function retrySend(
  deps: RetryDeps & Pick<SendDeps, "sendingAllowed">,
  applicationId: number,
): Promise<RetrySendClaim> {
  if (!(await deps.sendingAllowed())) return { outcome: "refused", error: SEND_NOT_ALLOWED };
  await failIfStalled(deps, applicationId);
  return (await deps.applications.retry(applicationId, "send")) ? { outcome: "claimed" } : { outcome: "not-failed" };
}

/** The Cover Letter for one recipient: {{name}} becomes their first name and {{resume_link}} the Resume's Drive link. */
function personalize(coverLetter: string, name: string, resumeLink: string) {
  const firstName = name.trim().split(/\s+/)[0];
  return coverLetter.replaceAll(NAME_PLACEHOLDER, firstName).replaceAll(RESUME_LINK_PLACEHOLDER, resumeLink);
}

/**
 * The send-application Function: emails each recipient not yet sent, a few seconds apart, recording each one
 * immediately after its email goes out, so no attempt or Retry emails anyone twice. An Application that still fails
 * is marked failed at the send step, staying locked until retrySend.
 */
export async function runSending(deps: SendDeps, applicationId: number) {
  if (!(await deps.sendingAllowed())) throw new Error(SEND_NOT_ALLOWED);
  const application = await deps.applications.get(applicationId);
  if (!application) throw new Error(`No Application ${applicationId}`);
  if (application.status !== "sending") {
    console.log(`Application ${applicationId}: ${application.status}, nothing to send`);
    return;
  }
  const { subject, coverLetter, resumeLink } = application;

  try {
    await runStep(deps, applicationId, "send", async () => {
      if (!subject || !coverLetter || !resumeLink) throw new Error(`Application ${applicationId} isn't ready to send`);
      const unsent = (await deps.decisionMakers.listForApplication(applicationId)).filter(({ sentAt }) => !sentAt);
      const gmail = await deps.gmail();
      const emailed: string[] = [];
      for (const [index, recipient] of unsent.entries()) {
        if (!recipient.email) throw new Error(`${recipient.name} has no email address`);
        if (index > 0) await deps.sleep(SEND_GAP_MS);
        await gmail.send({ to: recipient.email, subject, body: personalize(coverLetter, recipient.name, resumeLink) });
        await deps.decisionMakers.recordSent(applicationId, recipient.id, deps.now());
        emailed.push(describePerson(recipient));
        console.log(`Application ${applicationId}: emailed ${describePerson(recipient)}`);
      }
      await deps.applications.update(applicationId, { status: "sent", error: null });
      return emailed.length > 0 ? `Emailed ${emailed.join(", ")}` : "Everyone was already emailed";
    });
    console.log(`Application ${applicationId}: sent`);
  } catch (error) {
    await deps.applications.update(applicationId, { status: "failed", error: messageOf(error) });
    throw error;
  }
}
