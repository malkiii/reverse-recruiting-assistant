import type { ApplicationStatus, ApplicationStep, RecipientKey } from "./gateways";
import { APPLICATION_STEPS } from "./schema";

export type StatsRange = "24h" | "7d" | "30d" | "all";

export type StatsRows = {
  jobs: { source: string; foundAt: Date }[];
  applications: { status: ApplicationStatus; currentStep: ApplicationStep; createdAt: Date }[];
  /** Each recipient emailed, and when the email went out. */
  sent: (RecipientKey & { sentAt: Date })[];
  /** At most one per recipient. */
  replies: (RecipientKey & { receivedAt: Date })[];
};

export type Stats = {
  /** Most first. */
  jobsPerSource: { source: string; count: number }[];
  /** Most first. */
  applicationsByStatus: { status: ApplicationStatus; count: number }[];
  emailsSent: number;
  /** Null when no Application got past the Decision Maker search. */
  emailFoundRate: number | null;
  /** Received in the range. */
  replies: number;
  /** Null when no email was sent in the range. */
  replyRatePerDecisionMaker: number | null;
  /** Null when no email was sent in the range. */
  replyRatePerApplication: number | null;
};

const SEARCH_STEP = APPLICATION_STEPS.indexOf("find-decision-makers");
const NOBODY_TO_EMAIL: ApplicationStatus[] = ["no-contacts", "direct-apply"];

type StatsApplication = StatsRows["applications"][number];

const pastSearch = ({ status, currentStep }: StatsApplication) =>
  status === "all-in-cooldown" ||
  NOBODY_TO_EMAIL.includes(status) ||
  APPLICATION_STEPS.indexOf(currentStep) > SEARCH_STEP;

function emailFoundRate(applications: StatsApplication[]) {
  const searched = applications.filter(pastSearch);
  if (searched.length === 0) return null;
  return searched.filter(({ status }) => !NOBODY_TO_EMAIL.includes(status)).length / searched.length;
}

const recipientId = ({ applicationId, decisionMakerId }: RecipientKey) => `${applicationId}-${decisionMakerId}`;

/** The recipients emailed who replied, by the Application they replied to. */
function repliedRecipients(sent: RecipientKey[], replies: RecipientKey[]) {
  const replied = new Set(replies.map(recipientId));
  return sent.filter((recipient) => replied.has(recipientId(recipient)));
}

/** Of the Decision Makers emailed, the share who replied, each counted once. */
function replyRatePerDecisionMaker(sent: RecipientKey[], replies: RecipientKey[]) {
  const emailed = new Set(sent.map(({ decisionMakerId }) => decisionMakerId));
  if (emailed.size === 0) return null;
  return new Set(repliedRecipients(sent, replies).map(({ decisionMakerId }) => decisionMakerId)).size / emailed.size;
}

/** Of the Applications emailed, the share with at least one reply. */
function replyRatePerApplication(sent: RecipientKey[], replies: RecipientKey[]) {
  const emailed = new Set(sent.map(({ applicationId }) => applicationId));
  if (emailed.size === 0) return null;
  return new Set(repliedRecipients(sent, replies).map(({ applicationId }) => applicationId)).size / emailed.size;
}

const HOUR_MS = 60 * 60 * 1000;
const RANGE_MS: Record<StatsRange, number> = {
  "24h": 24 * HOUR_MS,
  "7d": 7 * 24 * HOUR_MS,
  "30d": 30 * 24 * HOUR_MS,
  all: Number.POSITIVE_INFINITY,
};

/** How many of each key, most first. */
function countBy<Key extends string>(keys: Key[]) {
  const counts = new Map<Key, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts].sort(([, a], [, b]) => b - a);
}

const inRange = (range: StatsRange, now: Date) => (date: Date) => now.getTime() - date.getTime() < RANGE_MS[range];

export function stats(rows: StatsRows, range: StatsRange, now: Date): Stats {
  const within = inRange(range, now);
  const applications = rows.applications.filter(({ createdAt }) => within(createdAt));
  const sent = rows.sent.filter(({ sentAt }) => within(sentAt));
  return {
    jobsPerSource: countBy(rows.jobs.filter(({ foundAt }) => within(foundAt)).map(({ source }) => source)).map(
      ([source, count]) => ({ source, count }),
    ),
    applicationsByStatus: countBy(applications.map(({ status }) => status)).map(([status, count]) => ({ status, count })),
    emailsSent: sent.length,
    emailFoundRate: emailFoundRate(applications),
    replies: rows.replies.filter(({ receivedAt }) => within(receivedAt)).length,
    replyRatePerDecisionMaker: replyRatePerDecisionMaker(sent, rows.replies),
    replyRatePerApplication: replyRatePerApplication(sent, rows.replies),
  };
}

export type JobsStrip = { newJobsToday: number; inReview: number; sentThisWeek: number; emailFoundRate: number | null };

/** The calendar day a moment falls on in the timezone, as YYYY-MM-DD. */
const dayIn = (date: Date, timeZone: string) => date.toLocaleDateString("en-CA", { timeZone });

/** The numbers at the top of Jobs. "Today" starts at midnight in the Admin's timezone. */
export function jobsStrip(rows: StatsRows, now: Date, timeZone: string): JobsStrip {
  const today = dayIn(now, timeZone);
  const lastMonth = stats(rows, "30d", now);
  return {
    newJobsToday: rows.jobs.filter(({ foundAt }) => dayIn(foundAt, timeZone) === today).length,
    inReview: rows.applications.filter(({ status }) => status === "in-review").length,
    sentThisWeek: stats(rows, "7d", now).emailsSent,
    emailFoundRate: lastMonth.emailFoundRate,
  };
}

export type ActivityPoint = { bucket: string; jobs: number; applications: number; emailsSent: number };

const DAY_MS = 24 * HOUR_MS;
const RANGE_DAYS: Partial<Record<StatsRange, number>> = { "7d": 7, "30d": 30 };

/** The hour a moment falls in in the timezone, as YYYY-MM-DDTHH. */
const hourIn = (date: Date, timeZone: string) => `${dayIn(date, timeZone)}T${date.toLocaleString("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone })}`;

/** The calendar day `days` before a YYYY-MM-DD day. */
const daysBefore = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

/**
 * Jobs found, Applications started and emails sent over time, oldest first: per hour over 24h, per calendar day in
 * the Admin's timezone otherwise. All starts on the day of the oldest record.
 */
export function activity(rows: StatsRows, range: StatsRange, now: Date, timeZone: string): ActivityPoint[] {
  const key = range === "24h" ? (date: Date) => hourIn(date, timeZone) : (date: Date) => dayIn(date, timeZone);
  const dates = [...rows.jobs.map(({ foundAt }) => foundAt), ...rows.applications.map(({ createdAt }) => createdAt), ...rows.sent.map(({ sentAt }) => sentAt)];

  let buckets: string[];
  if (range === "24h") {
    buckets = Array.from({ length: 24 }, (_, index) => key(new Date(now.getTime() - (23 - index) * HOUR_MS)));
  } else {
    const today = dayIn(now, timeZone);
    const oldest = dates.length ? dayIn(new Date(Math.min(...dates.map((date) => date.getTime()))), timeZone) : today;
    const days =
      RANGE_DAYS[range] ?? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / DAY_MS) + 1;
    buckets = Array.from({ length: days }, (_, index) => daysBefore(today, days - 1 - index));
  }

  const points = new Map(buckets.map((bucket) => [bucket, { bucket, jobs: 0, applications: 0, emailsSent: 0 }]));
  const add = (date: Date, field: "jobs" | "applications" | "emailsSent") => {
    const point = points.get(key(date));
    if (point) point[field] += 1;
  };
  for (const { foundAt } of rows.jobs) add(foundAt, "jobs");
  for (const { createdAt } of rows.applications) add(createdAt, "applications");
  for (const { sentAt } of rows.sent) add(sentAt, "emailsSent");
  return [...points.values()];
}

export const STATS_RANGES = ["24h", "7d", "30d", "all"] as const satisfies StatsRange[];

/** The range in the URL, 30d when it's missing or unknown. */
export const parseRange = (value: string | undefined): StatsRange =>
  STATS_RANGES.find((range) => range === value) ?? "30d";

export const STATUS_GROUPS = ["in-review", "working", "sent", "failed", "other"] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];
export type StatusFilter = StatusGroup | "all";

const GROUP_OF: Record<ApplicationStatus, StatusGroup> = {
  preparing: "working",
  sending: "working",
  "in-review": "in-review",
  sent: "sent",
  failed: "failed",
  cancelled: "other",
  "no-contacts": "other",
  "direct-apply": "other",
  "all-in-cooldown": "other",
};

export const statusGroup = (status: ApplicationStatus) => GROUP_OF[status];

/** The status filter in the URL, all when it's missing or unknown. */
export const parseStatusFilter = (value: string | undefined): StatusFilter =>
  STATUS_GROUPS.find((group) => group === value) ?? "all";

/** How many Applications each status filter shows. */
export function groupCounts(statuses: ApplicationStatus[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: statuses.length, "in-review": 0, working: 0, sent: 0, failed: 0, other: 0 };
  for (const status of statuses) counts[statusGroup(status)] += 1;
  return counts;
}
