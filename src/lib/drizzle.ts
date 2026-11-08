import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  not,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { COOLDOWN_DAYS } from "./decision-maker-search";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type {
  ActorRun,
  ApplicationActorRun,
  DecisionMakerStore,
  FoundPerson,
  ApplicationChanges,
  ApplicationStatus,
  ApplicationStore,
  RetryTarget,
  ReviewChanges,
  StepLogEnd,
  StepLogStart,
  StepLogStore,
  Company,
  CompanyStore,
  LlmApiKeys,
  LlmChoice,
  LlmSettingsStore,
  ScheduleSettingsStore,
  SendSettingsStore,
  CoverLetterSettingsStore,
  ActorRunStore,
  ExcludedKeywordStore,
  FunctionRunResult,
  FunctionRunStore,
  GoogleConnectionStore,
  GoogleTokens,
  Job,
  JobBoardSettings,
  JobBoardSettingsStore,
  JobFeed,
  JobFeedStore,
  JobStore,
  ResumeFolderStore,
  SkippedApifyTokenStore,
} from "./gateways";
import {
  actorRuns,
  applicationRecipients,
  applications,
  companies,
  decisionMakers,
  excludedKeywords,
  functionRuns,
  googleConnection,
  jobBoardSettings,
  jobFeeds,
  jobs,
  llmApiKeys,
  type LlmProvider,
  PASSED_TIME_LIMIT_ERROR,
  RETRIED_AFTER_TIME_LIMIT_ERROR,
  settings,
  skippedApifyTokens,
  stepLogs,
  WORKING_STATUSES,
} from "./schema";
import { clampPage, type JobFilters, PAGE_SIZE, pageCount } from "./table-filters";

const RUNS_SHOWN = 20;
const JOBS_SHOWN = 200;
const OLD_DATA_MONTHS = 6;

let db: PostgresJsDatabase | undefined;

function client(databaseUrl: string) {
  // Pipelined queries hang forever through the Supabase transaction pooler.
  db ??= drizzle(postgres(databaseUrl, { prepare: false, max: 1, max_pipeline: 1 }));
  return db;
}

/** A saved Job's columns, without its alert state or when it was found. */
function savedJobColumns() {
  const { alertState: _alertState, foundAt: _foundAt, ...columns } = getTableColumns(jobs);
  return columns;
}

export function drizzleFunctionRunStore(databaseUrl: string): FunctionRunStore {
  return {
    async start(functionName: string, startedAt: Date, timeLimitMs: number, applicationId?: number) {
      await client(databaseUrl)
        .update(functionRuns)
        .set({ status: "failed", finishedAt: startedAt, error: PASSED_TIME_LIMIT_ERROR })
        .where(
          and(
            eq(functionRuns.functionName, functionName),
            eq(functionRuns.status, "running"),
            lte(functionRuns.startedAt, new Date(startedAt.getTime() - timeLimitMs)),
          ),
        );

      // The one_active_job_collection index makes this the atomic claim for a Job Collection.
      const [run] = await client(databaseUrl)
        .insert(functionRuns)
        .values({ functionName, status: "running", startedAt, applicationId })
        .onConflictDoNothing()
        .returning({ id: functionRuns.id });
      return run?.id ?? null;
    },

    async finish(id: number, result: FunctionRunResult) {
      await client(databaseUrl).update(functionRuns).set(result).where(eq(functionRuns.id, id));
    },

    list() {
      return client(databaseUrl).select().from(functionRuns).orderBy(desc(functionRuns.id)).limit(RUNS_SHOWN);
    },

    async markRetried(id: number, at: Date) {
      const marked = await client(databaseUrl)
        .update(functionRuns)
        .set({ status: "failed", error: RETRIED_AFTER_TIME_LIMIT_ERROR, finishedAt: sql`coalesce(${functionRuns.finishedAt}, ${at})` })
        .where(
          and(
            eq(functionRuns.id, id),
            or(eq(functionRuns.status, "running"), eq(functionRuns.error, PASSED_TIME_LIMIT_ERROR)),
          ),
        )
        .returning({ id: functionRuns.id });
      return marked.length > 0;
    },

    listForApplication(applicationId: number) {
      return client(databaseUrl)
        .select()
        .from(functionRuns)
        .where(eq(functionRuns.applicationId, applicationId))
        .orderBy(desc(functionRuns.id));
    },
  };
}

export function drizzleJobStore(databaseUrl: string): JobStore {
  return {
    async save(newJobs: Job[]) {
      if (newJobs.length === 0) return 0;
      const inserted = await client(databaseUrl)
        .insert(jobs)
        .values(newJobs.map((job) => ({ ...job, alertState: "pending" as const })))
        // No target, so both Duplicate Job rules are ignored: the URL and the title, Company and post day.
        .onConflictDoNothing()
        .returning({ id: jobs.id });
      return inserted.length;
    },

    list() {
      const { id: _id, alertState: _alertState, ...columns } = getTableColumns(jobs);
      return client(databaseUrl)
        .select(columns)
        .from(jobs)
        .orderBy(desc(jobs.id))
        .limit(JOBS_SHOWN);
    },

    async get(id: number) {
      const columns = savedJobColumns();
      const [job] = await client(databaseUrl).select(columns).from(jobs).where(eq(jobs.id, id));
      return job;
    },

    listPendingAlerts() {
      const columns = savedJobColumns();
      return client(databaseUrl)
        .select(columns)
        .from(jobs)
        .where(eq(jobs.alertState, "pending"))
        .orderBy(asc(jobs.id));
    },

    async markAlertSent(id: number) {
      await client(databaseUrl).update(jobs).set({ alertState: "sent" }).where(eq(jobs.id, id));
    },
  };
}

export function drizzleJobFeedStore(databaseUrl: string): JobFeedStore {
  return {
    list() {
      return client(databaseUrl).select().from(jobFeeds).orderBy(asc(jobFeeds.id));
    },

    async add(url: string) {
      const [feed] = await client(databaseUrl).insert(jobFeeds).values({ url }).returning();
      return feed;
    },

    async update({ id, url, enabled }: JobFeed) {
      await client(databaseUrl).update(jobFeeds).set({ url, enabled }).where(eq(jobFeeds.id, id));
    },

    async remove(id: number) {
      await client(databaseUrl).delete(jobFeeds).where(eq(jobFeeds.id, id));
    },
  };
}

export function drizzleJobBoardSettingsStore(databaseUrl: string): JobBoardSettingsStore {
  return {
    async get(source: string) {
      const [settings] = await client(databaseUrl)
        .select()
        .from(jobBoardSettings)
        .where(eq(jobBoardSettings.source, source));
      return settings;
    },

    async save(settings: JobBoardSettings) {
      await client(databaseUrl)
        .insert(jobBoardSettings)
        .values(settings)
        .onConflictDoUpdate({
          target: jobBoardSettings.source,
          set: { enabled: settings.enabled, searches: settings.searches, remoteOnly: settings.remoteOnly },
        });
    },
  };
}

export function drizzleExcludedKeywordStore(databaseUrl: string): ExcludedKeywordStore {
  return {
    async list() {
      const rows = await client(databaseUrl).select().from(excludedKeywords).orderBy(asc(excludedKeywords.keyword));
      return rows.map(({ keyword }) => keyword);
    },

    async replace(keywords: string[]) {
      await client(databaseUrl).transaction(async (tx) => {
        await tx.delete(excludedKeywords);
        if (keywords.length > 0) {
          await tx
            .insert(excludedKeywords)
            .values(keywords.map((keyword) => ({ keyword })))
            .onConflictDoNothing();
        }
      });
    },
  };
}

export function drizzleActorRunStore(databaseUrl: string): ActorRunStore {
  return {
    async save(run: ActorRun | ApplicationActorRun) {
      await client(databaseUrl).insert(actorRuns).values(run);
    },

    listUnfinished() {
      return client(databaseUrl)
        .select({
          runId: actorRuns.runId,
          actor: actorRuns.actor,
          token: actorRuns.token,
          search: actorRuns.search,
          startedAt: actorRuns.startedAt,
        })
        .from(actorRuns)
        .where(and(isNull(actorRuns.resultsSavedAt), isNull(actorRuns.applicationId)))
        .orderBy(asc(actorRuns.startedAt));
    },

    async listForApplication(applicationId: number) {
      const runs = await client(databaseUrl)
        .select({
          runId: actorRuns.runId,
          actor: actorRuns.actor,
          token: actorRuns.token,
          search: actorRuns.search,
          purpose: actorRuns.purpose,
          startedAt: actorRuns.startedAt,
        })
        .from(actorRuns)
        .where(and(eq(actorRuns.applicationId, applicationId), isNull(actorRuns.resultsSavedAt)))
        .orderBy(asc(actorRuns.startedAt));
      return runs.map((run) => ({ ...run, applicationId, purpose: run.purpose ?? "" }));
    },

    async close(runId: string, closedAt: Date) {
      await client(databaseUrl)
        .update(actorRuns)
        .set({ resultsSavedAt: closedAt })
        .where(eq(actorRuns.runId, runId));
    },

    async lastToken() {
      const [run] = await client(databaseUrl)
        .select({ token: actorRuns.token })
        .from(actorRuns)
        .orderBy(desc(actorRuns.startedAt))
        .limit(1);
      return run?.token;
    },
  };
}

export function drizzleSkippedApifyTokenStore(databaseUrl: string): SkippedApifyTokenStore {
  return {
    async listSkipped(at: Date) {
      const rows = await client(databaseUrl)
        .select({ token: skippedApifyTokens.token })
        .from(skippedApifyTokens)
        .where(gt(skippedApifyTokens.usableAt, at));
      return rows.map(({ token }) => token);
    },

    async skip(token: string, usableAt: Date) {
      await client(databaseUrl)
        .insert(skippedApifyTokens)
        .values({ token, usableAt })
        .onConflictDoUpdate({ target: skippedApifyTokens.token, set: { usableAt } });
    },
  };
}

export function drizzleGoogleConnectionStore(databaseUrl: string): GoogleConnectionStore {
  return {
    async get() {
      const [tokens] = await client(databaseUrl)
        .select({
          refreshToken: googleConnection.refreshToken,
          accessToken: googleConnection.accessToken,
          expiresAt: googleConnection.expiresAt,
        })
        .from(googleConnection);
      return tokens;
    },

    async save(tokens: GoogleTokens) {
      await client(databaseUrl)
        .insert(googleConnection)
        .values(tokens)
        .onConflictDoUpdate({ target: googleConnection.id, set: tokens });
    },
  };
}

export function drizzleResumeFolderStore(databaseUrl: string): ResumeFolderStore {
  return {
    async get() {
      const [row] = await client(databaseUrl)
        .select({ id: settings.resumeFolderId, name: settings.resumeFolderName })
        .from(settings);
      return row?.id ? { id: row.id, name: row.name ?? "" } : undefined;
    },

    async save({ id, name }) {
      const folder = { resumeFolderId: id, resumeFolderName: name };
      await client(databaseUrl)
        .insert(settings)
        .values(folder)
        .onConflictDoUpdate({ target: settings.id, set: folder });
    },
  };
}

export function drizzleLlmSettingsStore(databaseUrl: string): LlmSettingsStore {
  return {
    async get() {
      const [row] = await client(databaseUrl)
        .select({ provider: settings.llmProvider, model: settings.llmModel })
        .from(settings);
      return row?.provider && row.model ? { provider: row.provider, model: row.model } : undefined;
    },

    async save({ provider, model }: LlmChoice) {
      const choice = { llmProvider: provider, llmModel: model };
      await client(databaseUrl).insert(settings).values(choice).onConflictDoUpdate({ target: settings.id, set: choice });
    },

    async apiKeys() {
      const rows = await client(databaseUrl).select().from(llmApiKeys);
      return Object.fromEntries(rows.map(({ provider, apiKey }) => [provider, apiKey])) as LlmApiKeys;
    },

    async saveApiKey(provider: LlmProvider, apiKey: string) {
      await client(databaseUrl)
        .insert(llmApiKeys)
        .values({ provider, apiKey })
        .onConflictDoUpdate({ target: llmApiKeys.provider, set: { apiKey } });
    },

    async removeApiKey(provider: LlmProvider) {
      await client(databaseUrl).transaction(async (tx) => {
        await tx.delete(llmApiKeys).where(eq(llmApiKeys.provider, provider));
        await tx.update(settings).set({ llmProvider: null, llmModel: null }).where(eq(settings.llmProvider, provider));
      });
    },
  };
}

export function drizzleScheduleSettingsStore(databaseUrl: string): ScheduleSettingsStore {
  return {
    async collectionEnabled() {
      const [row] = await client(databaseUrl)
        .select({ enabled: settings.scheduledCollectionEnabled })
        .from(settings);
      return row?.enabled ?? false;
    },

    async saveCollectionEnabled(enabled: boolean) {
      const values = { scheduledCollectionEnabled: enabled };
      await client(databaseUrl).insert(settings).values(values).onConflictDoUpdate({ target: settings.id, set: values });
    },
  };
}

export function drizzleSendSettingsStore(databaseUrl: string): SendSettingsStore {
  return {
    async sendingAllowed() {
      const [row] = await client(databaseUrl).select({ allowed: settings.sendingAllowed }).from(settings);
      return row?.allowed ?? false;
    },

    async saveSendingAllowed(allowed: boolean) {
      const values = { sendingAllowed: allowed };
      await client(databaseUrl).insert(settings).values(values).onConflictDoUpdate({ target: settings.id, set: values });
    },
  };
}

export function drizzleCoverLetterSettingsStore(databaseUrl: string): CoverLetterSettingsStore {
  return {
    async instructions() {
      const [row] = await client(databaseUrl)
        .select({ instructions: settings.coverLetterInstructions })
        .from(settings);
      return row?.instructions ?? null;
    },

    async saveInstructions(instructions: string | null) {
      const values = { coverLetterInstructions: instructions };
      await client(databaseUrl).insert(settings).values(values).onConflictDoUpdate({ target: settings.id, set: values });
    },
  };
}

export function drizzleApplicationStore(databaseUrl: string): ApplicationStore {
  return {
    async claim(jobId: number, createdAt: Date) {
      // The unique job_id makes this the atomic claim: a second Prepare inserts nothing.
      const [application] = await client(databaseUrl)
        .insert(applications)
        .values({ jobId, status: "preparing", currentStep: "read-job", createdAt })
        .onConflictDoNothing({ target: applications.jobId })
        .returning({ id: applications.id });
      return application?.id ?? null;
    },

    async get(id: number) {
      const [application] = await client(databaseUrl).select().from(applications).where(eq(applications.id, id));
      return application;
    },

    async retry(id: number, target: RetryTarget) {
      // Only a failed Application matches, so a double click on Retry claims it once.
      const sendStep = eq(applications.currentStep, "send");
      const retried = await client(databaseUrl)
        .update(applications)
        .set({ status: target === "send" ? "sending" : "preparing", error: null })
        .where(
          and(eq(applications.id, id), eq(applications.status, "failed"), target === "send" ? sendStep : not(sendStep)),
        )
        .returning({ id: applications.id });
      return retried.length > 0;
    },

    async fail(id: number, from: ApplicationStatus, error: string) {
      const failed = await client(databaseUrl)
        .update(applications)
        .set({ status: "failed", error })
        .where(and(eq(applications.id, id), eq(applications.status, from)))
        .returning({ id: applications.id });
      return failed.length > 0;
    },

    async cancel(id: number) {
      // Only an Application in Review matches, so Cancel can't undo a Send or a Prepare.
      const cancelled = await client(databaseUrl)
        .update(applications)
        .set({ status: "cancelled" })
        .where(and(eq(applications.id, id), eq(applications.status, "in-review")))
        .returning({ id: applications.id });
      return cancelled.length > 0;
    },

    async edit(id: number, changes: ReviewChanges) {
      // Only an Application in Review matches, so nothing changes once Send has claimed it.
      const edited = await client(databaseUrl)
        .update(applications)
        .set(changes)
        .where(and(eq(applications.id, id), eq(applications.status, "in-review")))
        .returning({ id: applications.id });
      return edited.length > 0;
    },

    async removeRecipient(id: number, decisionMakerId: number) {
      // Only while the Application is in Review, so a Send that has started keeps every recipient.
      const removed = await client(databaseUrl)
        .delete(applicationRecipients)
        .where(
          and(
            eq(applicationRecipients.applicationId, id),
            eq(applicationRecipients.decisionMakerId, decisionMakerId),
            sql`exists (select 1 from ${applications} where ${applications.id} = ${id} and ${applications.status} = 'in-review')`,
          ),
        )
        .returning({ id: applicationRecipients.decisionMakerId });
      return removed.length > 0;
    },

    async addRecipient(id: number, decisionMakerId: number) {
      // Only while the Application is in Review, so a Send that has started never gains a recipient.
      const db = client(databaseUrl);
      const added = await db
        .insert(applicationRecipients)
        .select(
          db
            .select({
              applicationId: applications.id,
              decisionMakerId: sql<number>`${decisionMakerId}`.as("decision_maker_id"),
              sentAt: sql<Date | null>`null`.as("sent_at"),
            })
            .from(applications)
            .where(and(eq(applications.id, id), eq(applications.status, "in-review"))),
        )
        .onConflictDoNothing()
        .returning({ id: applicationRecipients.decisionMakerId });
      return added.length > 0;
    },

    async claimSend(id: number) {
      // Only an Application in Review matches, so a double click on Send claims it once.
      const claimed = await client(databaseUrl)
        .update(applications)
        .set({ status: "sending", currentStep: "send" })
        .where(and(eq(applications.id, id), eq(applications.status, "in-review")))
        .returning({ id: applications.id });
      return claimed.length > 0;
    },

    async remove(id: number) {
      return client(databaseUrl).transaction(async (tx) => {
        // Locked, so a Retry or Send can't start a Function on it while it's being deleted.
        const [removable] = await tx
          .select({ id: applications.id })
          .from(applications)
          .where(and(eq(applications.id, id), notInArray(applications.status, [...WORKING_STATUSES])))
          .for("update");
        if (!removable) return false;
        await tx.delete(applicationRecipients).where(eq(applicationRecipients.applicationId, id));
        await tx.delete(stepLogs).where(eq(stepLogs.applicationId, id));
        await tx.delete(applications).where(eq(applications.id, id));
        return true;
      });
    },

    async update(id: number, changes: ApplicationChanges) {
      await client(databaseUrl).update(applications).set(changes).where(eq(applications.id, id));
    },
  };
}

/** Each attempt at each Application step. */
export function drizzleStepLogStore(databaseUrl: string): StepLogStore {
  return {
    async start(log: StepLogStart) {
      const [started] = await client(databaseUrl)
        .insert(stepLogs)
        .values({ ...log, status: "running" })
        .returning({ id: stepLogs.id });
      return started.id;
    },

    async finish(id: number, end: StepLogEnd) {
      await client(databaseUrl).update(stepLogs).set(end).where(eq(stepLogs.id, id));
    },

    listForApplication(applicationId: number) {
      return client(databaseUrl)
        .select()
        .from(stepLogs)
        .where(eq(stepLogs.applicationId, applicationId))
        .orderBy(asc(stepLogs.id));
    },

    async failRunning(applicationId: number, error: string, finishedAt: Date) {
      await client(databaseUrl)
        .update(stepLogs)
        .set({ status: "failed", error, finishedAt })
        .where(and(eq(stepLogs.applicationId, applicationId), eq(stepLogs.status, "running")));
    },
  };
}

const companyColumns = { id: companies.id, name: companies.name, linkedinUrl: companies.linkedinUrl };

export function drizzleCompanyStore(databaseUrl: string): CompanyStore {
  return {
    async findOrCreate(company: Company) {
      // The no-op update makes the insert return the saved Company's ID when its LinkedIn page is already saved.
      const [saved] = await client(databaseUrl)
        .insert(companies)
        .values(company)
        .onConflictDoUpdate({ target: companies.linkedinUrl, set: { linkedinUrl: company.linkedinUrl } })
        .returning({ id: companies.id });
      return saved.id;
    },

    async get(id: number) {
      const [company] = await client(databaseUrl).select(companyColumns).from(companies).where(eq(companies.id, id));
      return company;
    },

    async findByLinkedinUrl(linkedinUrl: string) {
      const [company] = await client(databaseUrl)
        .select(companyColumns)
        .from(companies)
        .where(eq(companies.linkedinUrl, linkedinUrl));
      return company;
    },
  };
}

export function drizzleDecisionMakerStore(databaseUrl: string): DecisionMakerStore {
  return {
    async save(companyId: number, people: FoundPerson[], foundAt: Date) {
      return client(databaseUrl).transaction(async (tx) => {
        await tx.update(companies).set({ peopleFoundAt: foundAt }).where(eq(companies.id, companyId));
        if (people.length === 0) return [];
        return tx
          .insert(decisionMakers)
          .values(people.map((person) => ({ ...person, companyId, foundAt })))
          .onConflictDoUpdate({
            target: [decisionMakers.companyId, decisionMakers.name],
            set: {
              headline: sql`excluded.headline`,
              profileUrl: sql`excluded.profile_url`,
              photo: sql`excluded.photo`,
              // A person found again without an email lookup keeps the email already known.
              email: sql`coalesce(excluded.email, ${decisionMakers.email})`,
              jobFunction: sql`excluded.job_function`,
              foundAt: sql`excluded.found_at`,
            },
          })
          .returning();
      });
    },

    listForCompany(companyId: number) {
      return client(databaseUrl)
        .select()
        .from(decisionMakers)
        .where(eq(decisionMakers.companyId, companyId))
        .orderBy(asc(decisionMakers.id));
    },

    async peopleFoundAt(companyId: number) {
      const [company] = await client(databaseUrl)
        .select({ peopleFoundAt: companies.peopleFoundAt })
        .from(companies)
        .where(eq(companies.id, companyId));
      return company?.peopleFoundAt ?? null;
    },

    async addToApplication(applicationId: number, decisionMakerIds: number[]) {
      // Ignores any already added, so a Retry after a crash here adds each once.
      await client(databaseUrl)
        .insert(applicationRecipients)
        .values(decisionMakerIds.map((decisionMakerId) => ({ applicationId, decisionMakerId })))
        .onConflictDoNothing();
    },

    async listForApplication(applicationId: number) {
      const rows = await client(databaseUrl)
        .select({ decisionMaker: decisionMakers, sentAt: applicationRecipients.sentAt })
        .from(applicationRecipients)
        .innerJoin(decisionMakers, eq(decisionMakers.id, applicationRecipients.decisionMakerId))
        .where(eq(applicationRecipients.applicationId, applicationId))
        .orderBy(asc(decisionMakers.id));
      return rows.map(({ decisionMaker, sentAt }) => ({ ...decisionMaker, sentAt }));
    },

    async recordSent(applicationId: number, decisionMakerId: number, sentAt: Date) {
      await client(databaseUrl).transaction(async (tx) => {
        await tx
          .update(applicationRecipients)
          .set({ sentAt })
          .where(
            and(
              eq(applicationRecipients.applicationId, applicationId),
              eq(applicationRecipients.decisionMakerId, decisionMakerId),
            ),
          );
        await tx.update(decisionMakers).set({ lastEmailedAt: sentAt }).where(eq(decisionMakers.id, decisionMakerId));
      });
    },
  };
}

/** An ILIKE pattern matching text that contains the part. */
const containing = (part: string) => `%${part.replace(/[\\%_]/g, "\\$&")}%`;

function jobConditions(filters: JobFilters) {
  return and(
    filters.q ? or(ilike(jobs.title, containing(filters.q)), ilike(jobs.companyName, containing(filters.q))) : undefined,
    filters.sources.length ? inArray(jobs.source, filters.sources) : undefined,
    filters.location ? ilike(jobs.location, containing(filters.location)) : undefined,
    filters.company ? eq(jobs.companyName, filters.company) : undefined,
    filters.application === "none" ? isNull(applications.id) : undefined,
    filters.application === "prepared" ? isNotNull(applications.id) : undefined,
  );
}

/**
 * One page of the dashboard's Jobs that match the filters, newest first, each with its Application's ID and status
 * when it has one. A page past the last one is the last one.
 */
export async function listJobsWithApplications(databaseUrl: string, filters: JobFilters, page: number) {
  const db = client(databaseUrl);
  const where = jobConditions(filters);
  const [{ total }] = await db
    .select({ total: count() })
    .from(jobs)
    .leftJoin(applications, eq(applications.jobId, jobs.id))
    .where(where);
  const shown = clampPage(page, total);
  const rows = await db
    .select({ ...savedJobColumns(), applicationId: applications.id, applicationStatus: applications.status })
    .from(jobs)
    .leftJoin(applications, eq(applications.jobId, jobs.id))
    .where(where)
    .orderBy(desc(jobs.id))
    .limit(PAGE_SIZE)
    .offset((shown - 1) * PAGE_SIZE);
  return { rows, total, page: shown, pages: pageCount(total) };
}

/** The sources and Company names the Jobs filters offer, A to Z. */
export async function listJobFilterOptions(databaseUrl: string) {
  const db = client(databaseUrl);
  const sources = await db.selectDistinct({ source: jobs.source }).from(jobs).orderBy(asc(jobs.source));
  const companies = await db
    .selectDistinct({ companyName: jobs.companyName })
    .from(jobs)
    .orderBy(asc(jobs.companyName));
  return { sources: sources.map(({ source }) => source), companies: companies.map(({ companyName }) => companyName) };
}

/** Every Application, newest first, with its Job's title and Company name and its newest Function run. */
export async function listApplicationsWithJobs(databaseUrl: string) {
  const db = client(databaseUrl);
  const rows = await db
    .select({ application: applications, jobTitle: jobs.title, companyName: jobs.companyName, jobLocation: jobs.location })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .orderBy(desc(applications.createdAt), desc(applications.id));
  const newestRuns = await db
    .selectDistinctOn([functionRuns.applicationId])
    .from(functionRuns)
    .where(isNotNull(functionRuns.applicationId))
    .orderBy(functionRuns.applicationId, desc(functionRuns.id));
  const runByApplication = new Map(newestRuns.map((run) => [run.applicationId, run]));
  return rows.map((row) => ({ ...row, newestRun: runByApplication.get(row.application.id) }));
}

/** What the dashboard's stats count besides Applications: each Job's source and when it was found, and each email sent. */
export async function listStatsRows(databaseUrl: string) {
  const db = client(databaseUrl);
  const jobRows = await db.select({ source: jobs.source, foundAt: jobs.foundAt }).from(jobs);
  const sent = await db
    .select({ sentAt: applicationRecipients.sentAt })
    .from(applicationRecipients)
    .where(isNotNull(applicationRecipients.sentAt));
  return { jobs: jobRows, sentAt: sent.map(({ sentAt }) => sentAt!) };
}

/** Every Decision Maker with their Company's name and LinkedIn page, the most recently emailed first, then the most recently found. */
export async function listDecisionMakersWithCompanies(databaseUrl: string) {
  const db = client(databaseUrl);
  const rows = await db
    .select({ decisionMaker: decisionMakers, companyName: companies.name, companyLinkedinUrl: companies.linkedinUrl })
    .from(decisionMakers)
    .innerJoin(companies, eq(companies.id, decisionMakers.companyId))
    .orderBy(sql`${decisionMakers.lastEmailedAt} desc nulls last`, desc(decisionMakers.foundAt), desc(decisionMakers.id));
  const byDecisionMaker = new Map<number, { applicationId: number; sentAt: Date | null }[]>();
  for (const { decisionMakerId, applicationId, sentAt } of await db.select().from(applicationRecipients)) {
    byDecisionMaker.set(decisionMakerId, [...(byDecisionMaker.get(decisionMakerId) ?? []), { applicationId, sentAt }]);
  }
  return rows.map(({ decisionMaker, companyName, companyLinkedinUrl }) => ({
    ...decisionMaker,
    companyName,
    companyLinkedinUrl,
    applications: byDecisionMaker.get(decisionMaker.id) ?? [],
  }));
}

const ACTIVITY_SHOWN = 100;

/**
 * The newest Function runs, Step Logs and emails sent, up to 100 of each, for the dashboard's Activity. `since` is when
 * the rows are complete from: a kind cut at 100 may have older rows left out, so the timeline stops at its oldest one.
 */
export async function listActivityRows(databaseUrl: string) {
  const db = client(databaseUrl);
  const runs = await db.select().from(functionRuns).orderBy(desc(functionRuns.id)).limit(ACTIVITY_SHOWN);
  const logs = await db.select().from(stepLogs).orderBy(desc(stepLogs.id)).limit(ACTIVITY_SHOWN);
  const sends = await db
    .select({
      applicationId: applicationRecipients.applicationId,
      decisionMakerId: decisionMakers.id,
      name: decisionMakers.name,
      email: decisionMakers.email,
      sentAt: applicationRecipients.sentAt,
    })
    .from(applicationRecipients)
    .innerJoin(decisionMakers, eq(decisionMakers.id, applicationRecipients.decisionMakerId))
    .where(isNotNull(applicationRecipients.sentAt))
    .orderBy(desc(applicationRecipients.sentAt))
    .limit(ACTIVITY_SHOWN);
  const cutAt = [
    runs.length === ACTIVITY_SHOWN ? runs.at(-1)!.startedAt : null,
    logs.length === ACTIVITY_SHOWN ? logs.at(-1)!.startedAt : null,
    sends.length === ACTIVITY_SHOWN ? sends.at(-1)!.sentAt! : null,
  ].filter((at): at is Date => at !== null);
  const since = cutAt.length ? new Date(Math.max(...cutAt.map((at) => at.getTime()))) : null;
  return { runs, stepLogs: logs, sends: sends.map((send) => ({ ...send, sentAt: send.sentAt! })), since };
}

export async function findApplicationIdForJob(databaseUrl: string, jobId: number) {
  const [application] = await client(databaseUrl)
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.jobId, jobId));
  return application?.id;
}

/**
 * Deletes data 6+ months old: Jobs (with their Applications and recipients), Function runs, actor runs and Decision
 * Makers. Keeps a Job whose Application is newer or still in progress, running Function runs, and Decision Makers
 * still in Cooldown or a recipient of a kept Application.
 */
export async function cleanUpOldData(databaseUrl: string) {
  const cutoff = sql`now() - make_interval(months => ${OLD_DATA_MONTHS})`;
  const cooldownStart = sql`now() - make_interval(days => ${COOLDOWN_DAYS})`;

  return client(databaseUrl).transaction(async (tx) => {
    const oldApplicationIds = tx
      .select({ id: applications.id })
      .from(applications)
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(
        and(
          lte(applications.createdAt, cutoff),
          notInArray(applications.status, ["preparing", "sending"]),
          lte(jobs.postDay, sql`(${cutoff})::date`),
        ),
      );

    await tx.delete(stepLogs).where(inArray(stepLogs.applicationId, oldApplicationIds));
    const recipients = await tx
      .delete(applicationRecipients)
      .where(inArray(applicationRecipients.applicationId, oldApplicationIds))
      .returning({ applicationId: applicationRecipients.applicationId });
    const deletedApplications = await tx
      .delete(applications)
      .where(inArray(applications.id, oldApplicationIds))
      .returning({ id: applications.id });
    const deletedJobs = await tx
      .delete(jobs)
      .where(
        and(
          lte(jobs.postDay, sql`(${cutoff})::date`),
          notExists(tx.select({ id: applications.id }).from(applications).where(eq(applications.jobId, jobs.id))),
        ),
      )
      .returning({ id: jobs.id });
    const deletedFunctionRuns = await tx
      .delete(functionRuns)
      .where(and(lte(functionRuns.startedAt, cutoff), ne(functionRuns.status, "running")))
      .returning({ id: functionRuns.id });
    const deletedActorRuns = await tx
      .delete(actorRuns)
      .where(lte(actorRuns.startedAt, cutoff))
      .returning({ runId: actorRuns.runId });
    const deletedDecisionMakers = await tx
      .delete(decisionMakers)
      .where(
        and(
          lte(decisionMakers.foundAt, cutoff),
          or(isNull(decisionMakers.lastEmailedAt), lte(decisionMakers.lastEmailedAt, cooldownStart)),
          notExists(
            tx
              .select({ id: applicationRecipients.applicationId })
              .from(applicationRecipients)
              .where(eq(applicationRecipients.decisionMakerId, decisionMakers.id)),
          ),
        ),
      )
      .returning({ id: decisionMakers.id });

    return {
      jobs: deletedJobs.length,
      applications: deletedApplications.length,
      recipients: recipients.length,
      functionRuns: deletedFunctionRuns.length,
      actorRuns: deletedActorRuns.length,
      decisionMakers: deletedDecisionMakers.length,
    };
  });
}
