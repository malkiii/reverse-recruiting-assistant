import { expect, test } from "vitest";
import { activity, groupCounts, jobsStrip, parseRange, parseStatusFilter, stats, type StatsRows } from "./dashboard-stats";

const now = new Date("2026-11-06T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);
const daysAgo = (days: number) => hoursAgo(days * 24);

const rows = (overrides: Partial<StatsRows>): StatsRows => ({ jobs: [], applications: [], sent: [], replies: [], ...overrides });
/** Emails sent at these times, each to a different Decision Maker of Application 1. */
const emailsAt = (...dates: Date[]) => dates.map((sentAt, index) => ({ applicationId: 1, decisionMakerId: index + 1, sentAt }));

test("Reply Rate per Decision Maker is the share of Decision Makers emailed in the range who replied", () => {
  const result = stats(
    rows({
      sent: [
        { applicationId: 1, decisionMakerId: 1, sentAt: daysAgo(1) },
        { applicationId: 1, decisionMakerId: 2, sentAt: daysAgo(2) },
        { applicationId: 2, decisionMakerId: 3, sentAt: daysAgo(3) },
        { applicationId: 3, decisionMakerId: 4, sentAt: daysAgo(4) },
        // Emailed before the range.
        { applicationId: 4, decisionMakerId: 5, sentAt: daysAgo(10) },
      ],
      replies: [
        { applicationId: 1, decisionMakerId: 1, receivedAt: hoursAgo(1) },
        { applicationId: 2, decisionMakerId: 3, receivedAt: daysAgo(2) },
        { applicationId: 4, decisionMakerId: 5, receivedAt: daysAgo(6) },
      ],
    }),
    "7d",
    now,
  );

  expect(result.replyRatePerDecisionMaker).toBe(2 / 4);
});

test("Reply Rate per Decision Maker counts each Decision Maker once, however many Applications emailed them", () => {
  const result = stats(
    rows({
      sent: [
        // Emailed for two Applications, replied to one.
        { applicationId: 1, decisionMakerId: 1, sentAt: daysAgo(1) },
        { applicationId: 2, decisionMakerId: 1, sentAt: daysAgo(2) },
        // No reply.
        { applicationId: 3, decisionMakerId: 2, sentAt: daysAgo(3) },
      ],
      replies: [{ applicationId: 1, decisionMakerId: 1, receivedAt: hoursAgo(1) }],
    }),
    "7d",
    now,
  );

  expect(result.replyRatePerDecisionMaker).toBe(1 / 2);
});

test("Reply Rate per Application is the share of Applications emailed in the range with at least one reply", () => {
  const result = stats(
    rows({
      sent: [
        // Two replies, counted once.
        { applicationId: 1, decisionMakerId: 1, sentAt: daysAgo(1) },
        { applicationId: 1, decisionMakerId: 2, sentAt: daysAgo(1) },
        // One of two replied.
        { applicationId: 2, decisionMakerId: 3, sentAt: daysAgo(2) },
        { applicationId: 2, decisionMakerId: 4, sentAt: daysAgo(2) },
        // No reply.
        { applicationId: 3, decisionMakerId: 5, sentAt: daysAgo(3) },
        // Sent before the range.
        { applicationId: 4, decisionMakerId: 6, sentAt: daysAgo(10) },
      ],
      replies: [
        { applicationId: 1, decisionMakerId: 1, receivedAt: hoursAgo(5) },
        { applicationId: 1, decisionMakerId: 2, receivedAt: hoursAgo(4) },
        { applicationId: 2, decisionMakerId: 4, receivedAt: hoursAgo(3) },
        { applicationId: 4, decisionMakerId: 6, receivedAt: hoursAgo(2) },
      ],
    }),
    "7d",
    now,
  );

  expect(result.replyRatePerApplication).toBe(2 / 3);
});

test("Replies counts the replies received in the range", () => {
  const result = stats(
    rows({
      replies: [
        { applicationId: 1, decisionMakerId: 1, receivedAt: hoursAgo(2) },
        { applicationId: 2, decisionMakerId: 2, receivedAt: hoursAgo(20) },
        { applicationId: 3, decisionMakerId: 3, receivedAt: hoursAgo(30) },
      ],
    }),
    "24h",
    now,
  );

  expect(result.replies).toBe(2);
});

test("Reply rates are empty when no email was sent in the range", () => {
  const result = stats(
    rows({
      sent: [{ applicationId: 1, decisionMakerId: 1, sentAt: daysAgo(8) }],
      replies: [{ applicationId: 1, decisionMakerId: 1, receivedAt: daysAgo(1) }],
    }),
    "7d",
    now,
  );

  expect(result.replyRatePerDecisionMaker).toBeNull();
  expect(result.replyRatePerApplication).toBeNull();
});

test("Email-Found Rate counts only Applications that got past the Decision Maker search", () => {
  const result = stats(
    rows({
      applications: [
        // Past the search: found.
        { status: "in-review", currentStep: "check-sharing", createdAt: daysAgo(1) },
        { status: "sent", currentStep: "send", createdAt: daysAgo(1) },
        // Ended without anyone to email.
        { status: "no-contacts", currentStep: "find-decision-makers", createdAt: daysAgo(1) },
        { status: "direct-apply", currentStep: "find-company-page", createdAt: daysAgo(1) },
        // Emails existed, everyone was in Cooldown.
        { status: "all-in-cooldown", currentStep: "find-decision-makers", createdAt: daysAgo(1) },
        // Failed before the search ended: says nothing about emails.
        { status: "failed", currentStep: "find-decision-makers", createdAt: daysAgo(1) },
        { status: "preparing", currentStep: "read-job", createdAt: daysAgo(1) },
      ],
    }),
    "30d",
    now,
  );

  expect(result.emailFoundRate).toBe(3 / 5);
});

test("Email-Found Rate is empty when no Application in the range got past the search", () => {
  const result = stats(
    rows({ applications: [{ status: "sent", currentStep: "send", createdAt: daysAgo(8) }] }),
    "7d",
    now,
  );

  expect(result.emailFoundRate).toBeNull();
});

test("Jobs per source counts each Job Board and Job Feed found in the range, most first", () => {
  const result = stats(
    rows({
      jobs: [
        { source: "LinkedIn", foundAt: hoursAgo(2) },
        { source: "Feed: wellfound.com", foundAt: hoursAgo(3) },
        { source: "Feed: wellfound.com", foundAt: hoursAgo(20) },
        { source: "Glassdoor", foundAt: hoursAgo(30) },
      ],
    }),
    "24h",
    now,
  );

  expect(result.jobsPerSource).toEqual([
    { source: "Feed: wellfound.com", count: 2 },
    { source: "LinkedIn", count: 1 },
  ]);
});

test("Applications by status and emails sent count only what happened in the range", () => {
  const result = stats(
    rows({
      applications: [
        { status: "sent", currentStep: "send", createdAt: daysAgo(2) },
        { status: "sent", currentStep: "send", createdAt: daysAgo(3) },
        { status: "in-review", currentStep: "check-sharing", createdAt: daysAgo(1) },
        { status: "failed", currentStep: "read-job", createdAt: daysAgo(9) },
      ],
      sent: emailsAt(daysAgo(2), daysAgo(2), daysAgo(3), daysAgo(10)),
    }),
    "7d",
    now,
  );

  expect(result.applicationsByStatus).toEqual([
    { status: "sent", count: 2 },
    { status: "in-review", count: 1 },
  ]);
  expect(result.emailsSent).toBe(3);
});

test("All counts everything ever recorded", () => {
  const result = stats(rows({ sent: emailsAt(daysAgo(400), daysAgo(1)) }), "all", now);

  expect(result.emailsSent).toBe(2);
});

test("The Jobs strip counts Jobs found since midnight in the Admin's timezone", () => {
  const strip = jobsStrip(
    rows({
      jobs: [
        // 00:30 on 6 November in Algiers (UTC+1).
        { source: "LinkedIn", foundAt: new Date("2026-11-05T23:30:00Z") },
        // 23:30 on 5 November in Algiers.
        { source: "LinkedIn", foundAt: new Date("2026-11-05T22:30:00Z") },
      ],
    }),
    now,
    "Africa/Algiers",
  );

  expect(strip.newJobsToday).toBe(1);
});

test("The Jobs strip shows every Application In Review, emails sent this week and the 30-day Email-Found Rate", () => {
  const strip = jobsStrip(
    rows({
      applications: [
        { status: "in-review", currentStep: "check-sharing", createdAt: daysAgo(40) },
        { status: "in-review", currentStep: "check-sharing", createdAt: daysAgo(1) },
        { status: "no-contacts", currentStep: "find-decision-makers", createdAt: daysAgo(35) },
      ],
      sent: emailsAt(daysAgo(1), daysAgo(6), daysAgo(8)),
    }),
    now,
    "UTC",
  );

  expect(strip).toEqual({ newJobsToday: 0, inReview: 2, sentThisWeek: 2, emailFoundRate: 1 });
});

test("Each status filter counts its Applications, Working and Other grouping several statuses", () => {
  expect(
    groupCounts(["preparing", "sending", "in-review", "sent", "failed", "cancelled", "no-contacts", "direct-apply", "all-in-cooldown"]),
  ).toEqual({ all: 9, "in-review": 1, working: 2, sent: 1, failed: 1, other: 4 });
});

test("An unknown status filter or range in the URL falls back to the default", () => {
  expect(parseStatusFilter("working")).toBe("working");
  expect(parseStatusFilter("bogus")).toBe("all");
  expect(parseStatusFilter(undefined)).toBe("all");
  expect(parseRange("24h")).toBe("24h");
  expect(parseRange("1y")).toBe("30d");
});

test("Activity counts Jobs, Applications and emails per calendar day in the Admin's timezone, oldest first", () => {
  const result = activity(
    rows({
      jobs: [
        // 00:30 on 6 November in Algiers (UTC+1): today.
        { source: "LinkedIn", foundAt: new Date("2026-11-05T23:30:00Z") },
        { source: "LinkedIn", foundAt: daysAgo(2) },
        // Before the 7 days.
        { source: "LinkedIn", foundAt: daysAgo(9) },
      ],
      applications: [{ status: "sent", currentStep: "send", createdAt: daysAgo(2) }],
      sent: emailsAt(hoursAgo(1)),
    }),
    "7d",
    now,
    "Africa/Algiers",
  );

  expect(result.map(({ bucket }) => bucket)).toEqual([
    "2026-10-31",
    "2026-11-01",
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
  ]);
  expect(result.at(-1)).toMatchObject({ jobs: 1, applications: 0, emailsSent: 1 });
  expect(result.at(-3)).toMatchObject({ jobs: 1, applications: 1, emailsSent: 0 });
  expect(result.reduce((sum, point) => sum + point.jobs, 0)).toBe(2);
});

test("Activity over 24 hours counts per hour", () => {
  const result = activity(rows({ jobs: [{ source: "LinkedIn", foundAt: hoursAgo(3) }] }), "24h", now, "UTC");

  expect(result).toHaveLength(24);
  expect(result[0].bucket).toBe("2026-11-05T13");
  expect(result.at(-1)?.bucket).toBe("2026-11-06T12");
  expect(result.find(({ bucket }) => bucket === "2026-11-06T09")?.jobs).toBe(1);
});

test("Activity since the start begins on the day of the oldest record", () => {
  const result = activity(rows({ sent: emailsAt(daysAgo(3)) }), "all", now, "UTC");

  expect(result.map(({ bucket }) => bucket)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
  expect(result[0].emailsSent).toBe(1);
});
