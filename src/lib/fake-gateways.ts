import type {
  ActorGateway,
  ActorRun,
  ApplicationActorRun,
  DecisionMaker,
  DecisionMakerStore,
  FoundPerson,
  Application,
  ApplicationChanges,
  ApplicationStore,
  ApplicationStatus,
  RetryTarget,
  StepLog,
  StepLogEnd,
  StepLogStart,
  StepLogStore,
  ReviewChanges,
  Company,
  CompanyPageSearch,
  CompanyStore,
  DriveFile,
  DriveFolder,
  DriveGateway,
  Email,
  GmailGateway,
  PdfReader,
  JobPageReader,
  LlmApiKeys,
  LlmChoice,
  LlmGateway,
  LlmRequest,
  LlmSettingsStore,
  ResumeFolderStore,
  SearchResult,
  ActorRunStatus,
  ActorRunStore,
  AlertState,
  CollectedJob,
  ExcludedKeywordStore,
  FunctionRun,
  FunctionRunResult,
  FunctionRunStore,
  GoogleConnectionStore,
  GoogleOAuthGateway,
  GoogleTokens,
  GrantedTokens,
  Image,
  ImageGateway,
  Job,
  JobBoardGateway,
  JobBoardRunOptions,
  JobBoardSettings,
  JobBoardSettingsStore,
  JobFeed,
  JobFeedReader,
  JobFeedStore,
  JobStore,
  PlaceholderName,
  SkippedApifyTokenStore,
  TelegramGateway,
  TelegramLink,
} from "./gateways";
import { COLLECT_JOBS, type JobSearch, type LlmProvider, PASSED_TIME_LIMIT_ERROR, RETRIED_AFTER_TIME_LIMIT_ERROR } from "./schema";

export class FakeFunctionRunStore implements FunctionRunStore {
  private runs: FunctionRun[] = [];

  async start(functionName: string, startedAt: Date, timeLimitMs: number, applicationId?: number) {
    this.runs = this.runs.map((run) =>
      run.functionName === functionName &&
      run.status === "running" &&
      run.startedAt.getTime() <= startedAt.getTime() - timeLimitMs
        ? { ...run, status: "failed", finishedAt: startedAt, error: PASSED_TIME_LIMIT_ERROR }
        : run,
    );
    const active = this.runs.some((run) => run.functionName === COLLECT_JOBS && run.status === "running");
    if (functionName === COLLECT_JOBS && active) return null;

    const id = this.runs.length + 1;
    this.runs.push({
      id,
      functionName,
      status: "running",
      startedAt,
      finishedAt: null,
      error: null,
      applicationId: applicationId ?? null,
    });
    return id;
  }

  async finish(id: number, result: FunctionRunResult) {
    this.runs = this.runs.map((run) => (run.id === id ? { ...run, ...result } : run));
  }

  async list() {
    return this.runs;
  }

  async listForApplication(applicationId: number) {
    return this.runs.filter((run) => run.applicationId === applicationId).reverse();
  }

  async markRetried(id: number, at: Date) {
    const run = this.runs.find((saved) => saved.id === id);
    if (!run || (run.status !== "running" && run.error !== PASSED_TIME_LIMIT_ERROR)) return false;
    await this.finish(id, { status: "failed", finishedAt: run.finishedAt ?? at, error: RETRIED_AFTER_TIME_LIMIT_ERROR });
    return true;
  }
}

export class FakeTelegram implements TelegramGateway {
  messages: { text: string; link?: TelegramLink; html?: true; photo?: Image }[] = [];
  failing = false;

  get sent() {
    return this.messages.map(({ text }) => text);
  }

  async send(text: string, link?: TelegramLink) {
    if (this.failing) throw new Error("Telegram is down");
    this.messages.push(link ? { text, link } : { text });
  }

  async sendHtml(html: string, link: TelegramLink, photo?: Image) {
    if (this.failing) throw new Error("Telegram is down");
    this.messages.push(photo ? { text: html, link, html: true, photo } : { text: html, link, html: true });
  }
}

/** Serves the images, OG image URLs and placeholders set here. Anything else is null. */
export class FakeImages implements ImageGateway {
  images = new Map<string, Image>();
  pageImages = new Map<string, string>();
  placeholders = new Map<PlaceholderName, Image>();

  async download(url: string) {
    return this.images.get(url) ?? null;
  }

  async pageImageUrl(pageUrl: string) {
    return this.pageImages.get(pageUrl) ?? null;
  }

  async placeholder(name: PlaceholderName) {
    return this.placeholders.get(name) ?? null;
  }
}

export class FakeJobStore implements JobStore {
  private jobs: (Job & { id: number; alertState: AlertState })[] = [];

  async save(jobs: Job[]) {
    const before = this.jobs.length;
    for (const job of jobs) {
      const duplicate = this.jobs.some(
        (saved) =>
          saved.url === job.url ||
          (saved.title.toLowerCase() === job.title.toLowerCase() &&
            saved.companyName.toLowerCase() === job.companyName.toLowerCase() &&
            saved.postDay === job.postDay),
      );
      if (!duplicate) this.jobs.push({ ...job, id: this.jobs.length + 1, alertState: "pending" });
    }
    return this.jobs.length - before;
  }

  async list(): Promise<Job[]> {
    return this.jobs.map(({ id: _id, alertState: _alertState, ...job }) => job);
  }

  async get(id: number) {
    const saved = this.jobs.find((job) => job.id === id);
    if (!saved) return undefined;
    const { alertState: _, ...job } = saved;
    return job;
  }

  async listPendingAlerts() {
    return this.jobs.filter(({ alertState }) => alertState === "pending").map(({ alertState: _, ...job }) => job);
  }

  async markAlertSent(id: number) {
    this.jobs = this.jobs.map((job) => (job.id === id ? { ...job, alertState: "sent" } : job));
  }
}

export class FakeJobBoardSettingsStore implements JobBoardSettingsStore {
  constructor(private settings: JobBoardSettings[]) {}

  async get(source: string) {
    return this.settings.find((settings) => settings.source === source);
  }

  async save(settings: JobBoardSettings) {
    this.settings = [...this.settings.filter(({ source }) => source !== settings.source), settings];
  }
}

export class FakeExcludedKeywordStore implements ExcludedKeywordStore {
  constructor(private keywords: string[] = []) {}

  async list() {
    return this.keywords;
  }

  async replace(keywords: string[]) {
    this.keywords = [...new Set(keywords)];
  }
}

export class FakeActorRunStore implements ActorRunStore {
  private runs: ((ActorRun | ApplicationActorRun) & { closed: boolean })[] = [];

  async save(run: ActorRun | ApplicationActorRun) {
    this.runs.push({ ...run, closed: false });
  }

  async listUnfinished() {
    return this.runs
      .filter((run) => !run.closed && !("applicationId" in run))
      .map(({ closed: _, ...run }) => run);
  }

  async listForApplication(applicationId: number) {
    return this.runs.flatMap(({ closed, ...run }) =>
      !closed && "applicationId" in run && run.applicationId === applicationId ? [run] : [],
    );
  }

  async close(runId: string) {
    this.runs = this.runs.map((run) => (run.runId === runId ? { ...run, closed: true } : run));
  }

  async lastToken() {
    return this.runs.at(-1)?.token;
  }
}

export class FakeSkippedApifyTokenStore implements SkippedApifyTokenStore {
  usableAt = new Map<string, Date>();

  async listSkipped(at: Date) {
    return [...this.usableAt].filter(([, usableAt]) => usableAt > at).map(([token]) => token);
  }

  async skip(token: string, usableAt: Date) {
    this.usableAt.set(token, usableAt);
  }
}

export class FakeJobFeedStore implements JobFeedStore {
  private feeds: JobFeed[] = [];

  async list() {
    return this.feeds;
  }

  async add(url: string) {
    const feed = { id: this.feeds.length + 1, url, enabled: true };
    this.feeds.push(feed);
    return feed;
  }

  async update(feed: JobFeed) {
    this.feeds = this.feeds.map((saved) => (saved.id === feed.id ? feed : saved));
  }

  async remove(id: number) {
    this.feeds = this.feeds.filter((feed) => feed.id !== id);
  }
}

/** Returns the Jobs set for each Job Feed URL, or throws the error set for it. */
export class FakeJobFeedReader implements JobFeedReader {
  jobs = new Map<string, CollectedJob[] | Error>();
  urlsRead: string[] = [];

  async read(url: string) {
    this.urlsRead.push(url);
    const result = this.jobs.get(url) ?? [];
    if (result instanceof Error) throw result;
    return result;
  }
}

/** Each run reports the statuses queued here in turn, stays on the last, and returns the Jobs given. */
export class FakeJobBoard implements JobBoardGateway {
  started: { runId: string; search: JobSearch; limit: number; token: string; remoteOnly: boolean }[] = [];
  statuses: ActorRunStatus[] = ["succeeded"];
  private polls = new Map<string, number>();

  constructor(
    public jobs: CollectedJob[],
    public source = "LinkedIn",
    public actor = "worldunboxer/rapid-linkedin-scraper",
  ) {}

  async start(search: JobSearch, limit: number, token: string, { remoteOnly }: JobBoardRunOptions) {
    const runId = `${this.source}-run-${this.started.length + 1}`;
    this.started.push({ runId, search, limit, token, remoteOnly });
    return runId;
  }

  async status({ runId }: ActorRun) {
    const polls = this.polls.get(runId) ?? 0;
    this.polls.set(runId, polls + 1);
    return this.statuses[Math.min(polls, this.statuses.length - 1)];
  }

  async results(_run: ActorRun) {
    return this.jobs;
  }
}

export class FakeGoogleConnectionStore implements GoogleConnectionStore {
  constructor(public tokens?: GoogleTokens) {}

  async get() {
    return this.tokens;
  }

  async save(tokens: GoogleTokens) {
    this.tokens = tokens;
  }
}

/** Grants the tokens set here for any code, and for any refresh token in `accepted`, and null for the rest. */
export class FakeGoogleOAuth implements GoogleOAuthGateway {
  exchanged: { code: string; redirectUri: string }[] = [];
  refreshed: string[] = [];
  accepted = new Set(["refresh"]);
  grant: GrantedTokens = { accessToken: "renewed", expiresInSeconds: 3600 };

  async exchange(code: string, redirectUri: string) {
    this.exchanged.push({ code, redirectUri });
    return { refreshToken: "refresh", ...this.grant };
  }

  async refresh(refreshToken: string) {
    this.refreshed.push(refreshToken);
    return this.accepted.has(refreshToken) ? this.grant : null;
  }
}

export class FakeApplicationStore implements ApplicationStore {
  private applications: Application[] = [];

  /** Shares the Decision Makers' store, which holds each Application's recipients. */
  constructor(private decisionMakers = new FakeDecisionMakerStore()) {}

  async claim(jobId: number, createdAt: Date) {
    if (this.applications.some((application) => application.jobId === jobId)) return null;
    const id = this.applications.length + 1;
    this.applications.push({
      id,
      jobId,
      status: "preparing",
      currentStep: "read-job",
      error: null,
      jobPage: null,
      industryKeywords: null,
      jobLocation: null,
      jobSummary: null,
      resumeFileId: null,
      resumeName: null,
      resumeLink: null,
      companyId: null,
      subject: null,
      coverLetter: null,
      createdAt,
    });
    return id;
  }

  async get(id: number) {
    return this.applications.find((application) => application.id === id);
  }

  async retry(id: number, target: RetryTarget) {
    const application = this.applications.find((saved) => saved.id === id);
    if (application?.status !== "failed") return false;
    if ((application.currentStep === "send") !== (target === "send")) return false;
    await this.update(id, { status: target === "send" ? "sending" : "preparing", error: null });
    return true;
  }

  async fail(id: number, from: ApplicationStatus, error: string) {
    const application = this.applications.find((saved) => saved.id === id);
    if (application?.status !== from) return false;
    await this.update(id, { status: "failed", error });
    return true;
  }

  async cancel(id: number) {
    const application = this.applications.find((saved) => saved.id === id);
    if (application?.status !== "in-review") return false;
    await this.update(id, { status: "cancelled" });
    return true;
  }

  async edit(id: number, changes: ReviewChanges) {
    const application = this.applications.find((saved) => saved.id === id);
    if (application?.status !== "in-review") return false;
    await this.update(id, changes);
    return true;
  }

  async removeRecipient(id: number, decisionMakerId: number) {
    const application = this.applications.find((saved) => saved.id === id);
    if (application?.status !== "in-review") return false;
    this.decisionMakers.recipients = this.decisionMakers.recipients.filter(
      (recipient) => recipient.applicationId !== id || recipient.decisionMakerId !== decisionMakerId,
    );
    return true;
  }

  async addRecipient(id: number, decisionMakerId: number) {
    const application = this.applications.find((saved) => saved.id === id);
    if (application?.status !== "in-review") return false;
    const added = this.decisionMakers.recipients.some(
      (recipient) => recipient.applicationId === id && recipient.decisionMakerId === decisionMakerId,
    );
    if (added) return false;
    this.decisionMakers.recipients.push({ applicationId: id, decisionMakerId, sentAt: null });
    return true;
  }

  async claimSend(id: number) {
    const application = this.applications.find((saved) => saved.id === id);
    if (application?.status !== "in-review") return false;
    await this.update(id, { status: "sending", currentStep: "send" });
    return true;
  }

  async list() {
    return this.applications;
  }

  async update(id: number, changes: ApplicationChanges) {
    this.applications = this.applications.map((application) =>
      application.id === id ? { ...application, ...changes } : application,
    );
  }
}

export class FakeStepLogStore implements StepLogStore {
  logs: StepLog[] = [];

  async start(log: StepLogStart) {
    const id = this.logs.length + 1;
    this.logs.push({ ...log, id, status: "running", result: null, error: null, finishedAt: null });
    return id;
  }

  async finish(id: number, end: StepLogEnd) {
    this.logs = this.logs.map((log) => (log.id === id ? { ...log, ...end } : log));
  }

  async listForApplication(applicationId: number) {
    return this.logs.filter((log) => log.applicationId === applicationId);
  }

  async failRunning(applicationId: number, error: string, finishedAt: Date) {
    this.logs = this.logs.map((log) =>
      log.applicationId === applicationId && log.status === "running"
        ? { ...log, status: "failed", error, finishedAt }
        : log,
    );
  }
}

/** Returns the markdown set for each URL, and throws for any other. */
export class FakeJobPages implements JobPageReader {
  pages = new Map<string, string>();
  urlsRead: string[] = [];

  async read(url: string) {
    this.urlsRead.push(url);
    const page = this.pages.get(url);
    if (page === undefined) throw new Error(`Firecrawl couldn't read ${url}`);
    return page;
  }
}

export class FakeResumeFolderStore implements ResumeFolderStore {
  constructor(public folder?: DriveFolder) {}

  async get() {
    return this.folder;
  }

  async save(folder: DriveFolder) {
    this.folder = folder;
  }
}

/** One Drive: the folders, the files in each and the folders shared by link, as set here. */
export class FakeDrive implements DriveGateway {
  folders: DriveFolder[] = [];
  files = new Map<string, DriveFile[]>();
  sharedByLink = new Set<string>();

  async listFolders() {
    return this.folders;
  }

  async listFiles(folderId: string) {
    return this.files.get(folderId) ?? [];
  }

  async isSharedByLink(folderId: string) {
    return this.sharedByLink.has(folderId);
  }

  /** Each file's contents are its ID, as text, unless set here. */
  contents = new Map<string, string>();
  downloads: string[] = [];

  async download(fileId: string) {
    this.downloads.push(fileId);
    return new TextEncoder().encode(this.contents.get(fileId) ?? fileId);
  }
}

/** Reads a "PDF" as the text it encodes. */
export class FakePdfReader implements PdfReader {
  async toMarkdown(pdf: Uint8Array) {
    return new TextDecoder().decode(pdf);
  }
}

export class FakeLlmSettingsStore implements LlmSettingsStore {
  constructor(
    public choice?: LlmChoice,
    public keys: LlmApiKeys = {},
  ) {}

  async get() {
    return this.choice;
  }

  async save(choice: LlmChoice) {
    this.choice = choice;
  }

  async apiKeys() {
    return { ...this.keys };
  }

  async saveApiKey(provider: LlmProvider, apiKey: string) {
    this.keys[provider] = apiKey;
  }

  async removeApiKey(provider: LlmProvider) {
    delete this.keys[provider];
    if (this.choice?.provider === provider) this.choice = undefined;
  }
}

/** Answers each request with the next answer queued here, parsed with the request's schema, or throws it when it's an Error. */
export class FakeLlm implements LlmGateway {
  requests: LlmRequest<unknown>[] = [];
  answers: unknown[] = [];

  async generate<T>(request: LlmRequest<T>) {
    this.requests.push(request);
    if (this.answers.length === 0) throw new Error("The LLM has no answer queued");
    const answer = this.answers.shift();
    if (answer instanceof Error) throw answer;
    return request.schema.parse(answer);
  }
}

export class FakeCompanyStore implements CompanyStore {
  companies: (Company & { id: number })[] = [];

  async findOrCreate(company: Company) {
    const saved = this.companies.find(({ linkedinUrl }) => linkedinUrl === company.linkedinUrl);
    if (saved) return saved.id;
    const id = this.companies.length + 1;
    this.companies.push({ ...company, id });
    return id;
  }

  async get(id: number) {
    return this.companies.find((company) => company.id === id);
  }

  async findByLinkedinUrl(linkedinUrl: string) {
    return this.companies.find((company) => company.linkedinUrl === linkedinUrl);
  }
}

/** Returns the first result set for each query, and none for any other. */
export class FakeCompanyPageSearch implements CompanyPageSearch {
  results = new Map<string, SearchResult>();
  queries: string[] = [];

  async firstResult(query: string) {
    this.queries.push(query);
    return this.results.get(query) ?? null;
  }
}

/**
 * One actor: each run returns the results set for its input, or none, and reports the statuses queued for its
 * input in turn, staying on the last. Inputs are matched as JSON.
 */
export class FakeActor<Input, Result> implements ActorGateway<Input, Result> {
  started: { runId: string; input: Input; token: string }[] = [];
  private resultsByInput = new Map<string, Result[]>();
  statuses = new Map<string, ActorRunStatus[]>();
  /** Errors the next starts throw, in turn. */
  startErrors: Error[] = [];
  private polls = new Map<string, number>();

  constructor(public actor: string) {}

  /** Sets what a run with this input returns. */
  returns(input: Input, results: Result[]) {
    this.resultsByInput.set(JSON.stringify(input), results);
  }

  get inputs() {
    return this.started.map(({ input }) => input);
  }

  private inputOf(runId: string) {
    const run = this.started.find((started) => started.runId === runId);
    if (!run) throw new Error(`${this.actor} never started run ${runId}`);
    return JSON.stringify(run.input);
  }

  async start(input: Input, token: string) {
    const error = this.startErrors.shift();
    if (error) throw error;
    const runId = `${this.actor}-run-${this.started.length + 1}`;
    this.started.push({ runId, input, token });
    return runId;
  }

  async status({ runId }: ActorRun) {
    const statuses = this.statuses.get(this.inputOf(runId)) ?? ["succeeded"];
    const polls = this.polls.get(runId) ?? 0;
    this.polls.set(runId, polls + 1);
    return statuses[Math.min(polls, statuses.length - 1)];
  }

  async results({ runId }: ActorRun) {
    return this.resultsByInput.get(this.inputOf(runId)) ?? [];
  }
}

export class FakeDecisionMakerStore implements DecisionMakerStore {
  saved: DecisionMaker[] = [];
  private peopleFoundAtByCompany = new Map<number, Date>();
  recipients: { applicationId: number; decisionMakerId: number; sentAt: Date | null }[] = [];

  async save(companyId: number, people: FoundPerson[], foundAt: Date) {
    const result: DecisionMaker[] = [];
    for (const person of people) {
      const existing = this.saved.find((saved) => saved.companyId === companyId && saved.name === person.name);
      const email = person.email ?? existing?.email ?? null;
      const decisionMaker = {
        lastEmailedAt: null,
        ...existing,
        ...person,
        email,
        companyId,
        foundAt,
        id: existing?.id ?? this.saved.length + 1,
      };
      this.saved = existing
        ? this.saved.map((saved) => (saved.id === existing.id ? decisionMaker : saved))
        : [...this.saved, decisionMaker];
      result.push(decisionMaker);
    }
    this.peopleFoundAtByCompany.set(companyId, foundAt);
    return result;
  }

  async listForCompany(companyId: number) {
    return this.saved.filter((saved) => saved.companyId === companyId);
  }

  async peopleFoundAt(companyId: number) {
    return this.peopleFoundAtByCompany.get(companyId) ?? null;
  }

  /** Records an email to the named person, as Send will. */
  emailed(name: string, at: Date) {
    this.saved = this.saved.map((saved) => (saved.name === name ? { ...saved, lastEmailedAt: at } : saved));
  }

  async addToApplication(applicationId: number, decisionMakerIds: number[]) {
    this.recipients.push(
      ...decisionMakerIds.map((decisionMakerId) => ({ applicationId, decisionMakerId, sentAt: null })),
    );
  }

  async listForApplication(applicationId: number) {
    const ids = this.recipients.filter((recipient) => recipient.applicationId === applicationId);
    return ids.flatMap(({ decisionMakerId, sentAt }) =>
      this.saved.filter(({ id }) => id === decisionMakerId).map((saved) => ({ ...saved, sentAt })),
    );
  }

  async recordSent(applicationId: number, decisionMakerId: number, sentAt: Date) {
    this.recipients = this.recipients.map((recipient) =>
      recipient.applicationId === applicationId && recipient.decisionMakerId === decisionMakerId
        ? { ...recipient, sentAt }
        : recipient,
    );
    this.saved = this.saved.map((saved) => (saved.id === decisionMakerId ? { ...saved, lastEmailedAt: sentAt } : saved));
  }
}

/** Records each email sent, and fails from the email numbered `failFrom` on, counting from 1. */
export class FakeGmail implements GmailGateway {
  sent: Email[] = [];
  failFrom = Infinity;
  onSend: (email: Email) => void = () => {};

  async send(email: Email) {
    if (this.sent.length + 1 >= this.failFrom) throw new Error("Gmail refused the email");
    this.sent.push(email);
    this.onSend(email);
  }
}
