import { startFunction } from "./dashboard-functions";
import { findApplicationIdForJob } from "./drizzle";
import { parseDashboardEnv } from "./env";
import { PREPARE_APPLICATION } from "./schema";

/** Prepares the Job, and returns its Application's ID: the one it already has when it has one. */
export async function prepareJob(jobId: number) {
  const response = await startFunction(PREPARE_APPLICATION, { jobId });
  // A 409 means the Job already has its one Application, so the Admin is shown that one.
  const applicationId =
    response.status === 202
      ? response.applicationId
      : await findApplicationIdForJob(parseDashboardEnv(process.env).DATABASE_URL, jobId);
  if (applicationId === undefined) throw new Error(`Job ${jobId} couldn't be Prepared`);
  return applicationId;
}
