import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const COLLECT_JOBS = "collect-jobs";
export const PREPARE_APPLICATION = "prepare-application";
export const SEND_APPLICATION = "send-application";

/** The error on a Function run that passed its time limit, as Modal killed it without a word. */
export const PASSED_TIME_LIMIT_ERROR = "Passed its time limit";
/** The error on a killed Function run once a Retry has dealt with its Application. */
export const RETRIED_AFTER_TIME_LIMIT_ERROR = "Passed its time limit, then retried";

export const LLM_PROVIDERS = ["claude", "gemini", "openai", "groq"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const APPLICATION_STATUSES = [
  "preparing",
  "in-review",
  "sending",
  "sent",
  "cancelled",
  "direct-apply",
  "no-contacts",
  "all-in-cooldown",
  "failed",
] as const;

/** The Application steps, in order: Prepare's, then Send's. A step is current until it finishes. */
export const APPLICATION_STEPS = [
  "read-job",
  "choose-resume",
  "find-company-page",
  "find-decision-makers",
  "write-cover-letter",
  "check-sharing",
  "send",
] as const;

/** A stopped attempt ended the Application without failing it, such as No Contacts. */
export const STEP_LOG_STATUSES = ["running", "succeeded", "stopped", "failed"] as const;

/** LinkedIn job function IDs the employees actor filters by, as its currentFunction input. */
export const JOB_FUNCTIONS = ["12", "9", "18", "19", "20", "any"] as const;
export type JobFunction = (typeof JOB_FUNCTIONS)[number];

export type JobSearch = { keywords: string; location: string };

export const functionRuns = pgTable(
  "function_runs",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    functionName: text("function_name").notNull(),
    status: text({ enum: ["running", "succeeded", "failed"] }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text(),
    /** The Application a prepare-application or send-application run served. */
    applicationId: bigint("application_id", { mode: "number" }),
  },
  // At most one Job Collection is active across both environments.
  (table) => [
    uniqueIndex("one_active_job_collection")
      .on(table.functionName)
      .where(sql`status = 'running' and function_name = 'collect-jobs'`),
  ],
).enableRLS();

export const jobs = pgTable(
  "jobs",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    source: text().notNull(),
    title: text().notNull(),
    companyName: text("company_name").notNull(),
    location: text().notNull(),
    url: text().notNull().unique(),
    postDay: date("post_day", { mode: "string" }).notNull(),
    description: text(),
    companyLinkedinUrl: text("company_linkedin_url"),
    companyLogoUrl: text("company_logo_url"),
    /** When Job Collection saved it, which the dashboard's stats count by. */
    foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
    // Jobs that existed at go-live, or that older code saves, are dashboard-only. Job Collection saves new Jobs as pending.
    alertState: text("alert_state", { enum: ["pending", "sent", "dashboard-only"] })
      .notNull()
      .default("dashboard-only"),
  },
  // The second Duplicate Job rule, so the same Job on two sources is saved once.
  (table) => [
    uniqueIndex("jobs_title_company_post_day_unique").on(
      sql`lower(${table.title})`,
      sql`lower(${table.companyName})`,
      table.postDay,
    ),
  ],
).enableRLS();

export const jobFeeds = pgTable("job_feeds", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  url: text().notNull(),
  enabled: boolean().notNull().default(true),
}).enableRLS();

export const jobBoardSettings = pgTable("job_board_settings", {
  source: text().primaryKey(),
  enabled: boolean().notNull().default(false),
  searches: jsonb().$type<JobSearch[]>().notNull().default([]),
  /** Only remote Jobs, for a Job Board whose actor can filter by it. */
  remoteOnly: boolean("remote_only").notNull().default(false),
}).enableRLS();

/** A word or phrase that, found in a Job's title, keeps the Job from being saved. */
export const excludedKeywords = pgTable("excluded_keywords", {
  keyword: text().primaryKey(),
}).enableRLS();

/** A rate-limited or out-of-credit Apify token, and when it can be used again. */
export const skippedApifyTokens = pgTable("skipped_apify_tokens", {
  token: text().primaryKey(),
  usableAt: timestamp("usable_at", { withTimezone: true }).notNull(),
}).enableRLS();

export const actorRuns = pgTable("actor_runs", {
  runId: text("run_id").primaryKey(),
  actor: text().notNull(),
  token: text().notNull(),
  search: jsonb().$type<JobSearch>(),
  /** The Application a Decision Maker search run belongs to. Job Collection runs have none. */
  applicationId: bigint("application_id", { mode: "number" }),
  /** What an Application's run was for, such as "employees:12" or "emails:12", so a Retry finds it again. */
  purpose: text(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  resultsSavedAt: timestamp("results_saved_at", { withTimezone: true }),
}).enableRLS();

// The table holds a single row, so the dashboard and Functions always read the same one.
const singleRow = () => [check("single_row", sql`id = 1`)];

/** The Admin's Google account, connected through OAuth, read by the dashboard and Functions. */
export const googleConnection = pgTable(
  "google_connection",
  {
    id: integer().primaryKey().default(1),
    refreshToken: text("refresh_token").notNull(),
    accessToken: text("access_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  singleRow,
).enableRLS();

/** An LLM provider's API key, added by the Admin in settings and read by Functions. */
export const llmApiKeys = pgTable("llm_api_keys", {
  provider: text({ enum: LLM_PROVIDERS }).primaryKey(),
  apiKey: text("api_key").notNull(),
}).enableRLS();

export const settings = pgTable(
  "settings",
  {
    id: integer().primaryKey().default(1),
    resumeFolderId: text("resume_folder_id"),
    resumeFolderName: text("resume_folder_name"),
    llmProvider: text("llm_provider", { enum: LLM_PROVIDERS }),
    llmModel: text("llm_model"),
    /** Whether the daily Modal schedule runs Job Collection. */
    scheduledCollectionEnabled: boolean("scheduled_collection_enabled").notNull().default(false),
    /** Whether Send may email Decision Makers. Off until the Admin turns it on. */
    sendingAllowed: boolean("sending_allowed").notNull().default(false),
  },
  singleRow,
).enableRLS();

/** The employer behind a Job, identified by its LinkedIn page. */
export const companies = pgTable("companies", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  linkedinUrl: text("linkedin_url").notNull().unique(),
  name: text().notNull(),
  /** When its Decision Makers were last searched for, which dates the next People Refresh. */
  peopleFoundAt: timestamp("people_found_at", { withTimezone: true }),
}).enableRLS();

/** A person found at a Company, saved even with no email so they aren't looked up again before a People Refresh. */
export const decisionMakers = pgTable(
  "decision_makers",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    companyId: bigint("company_id", { mode: "number" })
      .notNull()
      .references(() => companies.id),
    name: text().notNull(),
    headline: text().notNull(),
    profileUrl: text("profile_url").notNull(),
    email: text(),
    jobFunction: text("job_function", { enum: JOB_FUNCTIONS }).notNull(),
    foundAt: timestamp("found_at", { withTimezone: true }).notNull(),
    /** When they were last emailed, which starts their Cooldown. */
    lastEmailedAt: timestamp("last_emailed_at", { withTimezone: true }),
  },
  // People are kept unique by name within a Company.
  (table) => [unique("decision_makers_company_name_unique").on(table.companyId, table.name)],
).enableRLS();

/** At most one per Job, so a double click on Prepare claims only one, and a cancelled Job can't be Prepared again. */
export const applications = pgTable("applications", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  jobId: bigint("job_id", { mode: "number" })
    .notNull()
    .unique()
    .references(() => jobs.id),
  status: text({ enum: APPLICATION_STATUSES }).notNull(),
  currentStep: text("current_step", { enum: APPLICATION_STEPS }).notNull(),
  /** Why the Application stopped, when it did. */
  error: text(),
  /** The Job page as markdown, kept so a Retry doesn't pay to read it again. */
  jobPage: text("job_page"),
  industryKeywords: jsonb("industry_keywords").$type<string[]>(),
  jobLocation: text("job_location"),
  jobSummary: text("job_summary"),
  resumeFileId: text("resume_file_id"),
  resumeName: text("resume_name"),
  resumeLink: text("resume_link"),
  companyId: bigint("company_id", { mode: "number" }).references(() => companies.id),
  subject: text(),
  /** Contains {{name}} in its first line and {{resume_link}} at its end, filled in for each Decision Maker. */
  coverLetter: text("cover_letter"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}).enableRLS();

/** A Decision Maker an Application emails. */
export const applicationRecipients = pgTable(
  "application_recipients",
  {
    applicationId: bigint("application_id", { mode: "number" })
      .notNull()
      .references(() => applications.id),
    decisionMakerId: bigint("decision_maker_id", { mode: "number" })
      .notNull()
      .references(() => decisionMakers.id),
    /** When their email went out, so a Send never emails them twice. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.applicationId, table.decisionMakerId] })],
).enableRLS();

/** One attempt at one Application step, shown on the dashboard. */
export const stepLogs = pgTable("step_logs", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  applicationId: bigint("application_id", { mode: "number" })
    .notNull()
    .references(() => applications.id),
  step: text({ enum: APPLICATION_STEPS }).notNull(),
  /** Counted across the Admin's Retries, from 1. */
  attempt: integer().notNull(),
  status: text({ enum: STEP_LOG_STATUSES }).notNull(),
  /** What a finished step did. */
  result: text(),
  /** Why a stopped or failed attempt ended. */
  error: text(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}).enableRLS();
