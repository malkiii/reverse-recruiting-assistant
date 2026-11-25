import { applicationAsOf } from "./application-lifecycle";
import type { StatsRows } from "./dashboard-stats";
import { listApplicationsWithJobs, listStatsRows } from "./drizzle";

/** Every Application as the dashboard shows it, newest first: one whose Function passed its time limit shows as failed. */
export async function loadApplications(databaseUrl: string, now: Date) {
  const rows = await listApplicationsWithJobs(databaseUrl);
  return rows.map(({ application, newestRun, ...job }) => ({
    ...job,
    application: applicationAsOf(application, newestRun ? [newestRun] : [], now),
  }));
}

export type DashboardApplication = Awaited<ReturnType<typeof loadApplications>>[number];

export async function loadStatsRows(databaseUrl: string, now: Date): Promise<StatsRows> {
  const applications = await loadApplications(databaseUrl, now);
  const { jobs, sent, replies } = await listStatsRows(databaseUrl);
  return { jobs, sent, replies, applications: applications.map(({ application }) => application) };
}
