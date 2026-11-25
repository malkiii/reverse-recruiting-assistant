import type { FunctionRun } from "./gateways";
import { PREPARE_TIME_LIMIT_MS, SEND_TIME_LIMIT_MS } from "./application-lifecycle";
import { COLLECTION_TIME_LIMIT_MS } from "./job-collection";
import { REPLY_CHECK_TIME_LIMIT_MS } from "./reply-check";
import { CHECK_REPLIES, COLLECT_JOBS, PASSED_TIME_LIMIT_ERROR, PREPARE_APPLICATION, SEND_APPLICATION } from "./schema";

export const FUNCTION_TIME_LIMITS_MS: Record<string, number> = {
  noop: 60_000,
  [COLLECT_JOBS]: COLLECTION_TIME_LIMIT_MS,
  [PREPARE_APPLICATION]: PREPARE_TIME_LIMIT_MS,
  [SEND_APPLICATION]: SEND_TIME_LIMIT_MS,
  [CHECK_REPLIES]: REPLY_CHECK_TIME_LIMIT_MS,
};

/**
 * A Function killed by Modal can't record its own end and sends no alert, so its run stays "running"
 * in the database until the next start of that Function. This shows it as failed in the meantime.
 */
export function runAsOf(run: FunctionRun, now: Date): FunctionRun {
  const limitMs = FUNCTION_TIME_LIMITS_MS[run.functionName];
  if (run.status !== "running" || limitMs === undefined) return run;

  const deadline = run.startedAt.getTime() + limitMs;
  if (now.getTime() < deadline) return run;
  return { ...run, status: "failed", finishedAt: new Date(deadline), error: PASSED_TIME_LIMIT_ERROR };
}
