import { runAsOf } from "./function-runs";
import type { FunctionRun, StepLog } from "./gateways";
import { PASSED_TIME_LIMIT_ERROR } from "./schema";

export const ACTIVITY_KINDS = ["all", "function", "step", "email"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const parseActivityKind = (value: string | string[] | undefined): ActivityKind =>
  ACTIVITY_KINDS.find((kind) => kind === (Array.isArray(value) ? value[0] : value)) ?? "all";

export type EmailSent = { applicationId: number; decisionMakerId: number; name: string; email: string | null; sentAt: Date };

export type ActivityEntry =
  | { kind: "function"; key: string; at: Date; run: FunctionRun }
  | { kind: "step"; key: string; at: Date; log: StepLog }
  | { kind: "email"; key: string; at: Date; send: EmailSent };

/**
 * Function runs, Step Logs and emails sent as one timeline, newest first. A run that passed its time limit shows as
 * failed, as does a running attempt on an Application no Function is working on any more.
 */
export function activityTimeline(
  { runs, stepLogs, sends }: { runs: FunctionRun[]; stepLogs: StepLog[]; sends: EmailSent[] },
  isWorking: (applicationId: number) => boolean,
  now: Date,
): ActivityEntry[] {
  const entries: ActivityEntry[] = [
    ...runs.map((run) => ({ kind: "function" as const, key: `run-${run.id}`, at: run.startedAt, run: runAsOf(run, now) })),
    ...stepLogs.map((log) => ({
      kind: "step" as const,
      key: `step-${log.id}`,
      at: log.startedAt,
      log:
        log.status === "running" && !isWorking(log.applicationId)
          ? { ...log, status: "failed" as const, error: log.error ?? PASSED_TIME_LIMIT_ERROR }
          : log,
    })),
    ...sends.map((send) => ({
      kind: "email" as const,
      key: `email-${send.applicationId}-${send.decisionMakerId}`,
      at: send.sentAt,
      send,
    })),
  ];
  return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
}
