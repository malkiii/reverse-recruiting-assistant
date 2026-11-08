import { revalidatePath } from "next/cache";
import Link from "next/link";
import { connection } from "next/server";
import { AutoRefresh } from "@/components/auto-refresh";
import { STEP_NAMES } from "@/components/status";
import { SubmitButton } from "@/components/submit-button";
import { TableResults, TableTransition } from "@/components/table-transition";
import { FilterSegmented } from "@/components/table-filters";
import { Card, dateTime, EmptyState, linkClass, PageHeader, Pagination } from "@/components/ui";
import { ACTIVITY_KINDS, type ActivityEntry, type ActivityKind, activityTimeline, parseActivityKind } from "@/lib/activity";
import { loadApplications } from "@/lib/dashboard-data";
import { listActivityRows } from "@/lib/drizzle";
import { parseDashboardEnv } from "@/lib/env";
import { WORKING_STATUSES } from "@/lib/schema";
import { paginate, parsePage, type SearchParams, withParams } from "@/lib/table-filters";

async function startNoop() {
  "use server";

  const { FUNCTIONS_BASE_URL, FUNCTIONS_SECRET } = parseDashboardEnv(process.env);
  const response = await fetch(new URL("/functions/noop", FUNCTIONS_BASE_URL), {
    method: "POST",
    headers: { authorization: `Bearer ${FUNCTIONS_SECRET}` },
  });
  if (!response.ok) throw new Error(`The Function was refused: ${response.status}`);
  revalidatePath("/activity");
}

const KIND_LABELS: Record<ActivityKind, string> = {
  all: "All",
  function: "Function runs",
  step: "Step Logs",
  email: "Emails sent",
};

const DOT_CLASSES = {
  running: "bg-blue-500",
  succeeded: "bg-emerald-500",
  stopped: "bg-amber-500",
  failed: "bg-red-500",
};

type ApplicationLabel = { jobTitle: string; companyName: string };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection();
  const params = await searchParams;
  const kind = parseActivityKind(params.kind);
  const { DATABASE_URL, TIMEZONE } = parseDashboardEnv(process.env);
  const now = new Date();
  const [rows, applications] = await Promise.all([listActivityRows(DATABASE_URL), loadApplications(DATABASE_URL, now)]);
  const byId = new Map(applications.map((row) => [row.application.id, row]));
  const isWorking = (id: number) =>
    (WORKING_STATUSES as readonly string[]).includes(byId.get(id)?.application.status ?? "");
  const timeline = activityTimeline(rows, isWorking, now).filter((entry) => !rows.since || entry.at >= rows.since);
  const shown = kind === "all" ? timeline : timeline.filter((entry) => entry.kind === kind);
  const { rows: page, page: current, pages } = paginate(shown, parsePage(params.page));
  const running = timeline.some(
    (entry) =>
      (entry.kind === "function" && entry.run.status === "running") || (entry.kind === "step" && entry.log.status === "running"),
  );

  return (
    <>
      {running && <AutoRefresh seconds={3} />}
      <PageHeader
        title="Activity"
        subtitle="Function runs, Step Logs and emails sent, newest first"
        action={
          <form action={startNoop}>
            <SubmitButton variant="secondary" pendingText="Starting…">
              Run no-op
            </SubmitButton>
          </form>
        }
      />
      <TableTransition>
        <div className="-mx-4 mb-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
          <FilterSegmented
            name="kind"
            label="Filter by kind"
            options={ACTIVITY_KINDS.map((option) => ({ value: option === "all" ? "" : option, label: KIND_LABELS[option] }))}
          />
        </div>
        <TableResults>
          {page.length === 0 ? (
            <EmptyState title={kind === "all" ? "No activity yet" : `No ${KIND_LABELS[kind]} yet`} />
          ) : (
            <Card>
              <ul className="divide-y divide-line">
                {page.map((entry) => (
                  <Entry key={entry.key} entry={entry} application={applicationOf(entry, byId)} timeZone={TIMEZONE} />
                ))}
              </ul>
            </Card>
          )}
          <Pagination
            page={current}
            pages={pages}
            href={(target) =>
              withParams("/activity", { kind: kind === "all" ? undefined : kind, page: target > 1 ? String(target) : undefined })
            }
          />
        </TableResults>
      </TableTransition>
    </>
  );
}

function applicationOf(entry: ActivityEntry, byId: Map<number, ApplicationLabel>) {
  const id = entry.kind === "function" ? entry.run.applicationId : entry.kind === "step" ? entry.log.applicationId : entry.send.applicationId;
  const label = id === null ? undefined : byId.get(id);
  return id !== null && label ? { id, ...label } : undefined;
}

function Entry({
  entry,
  application,
  timeZone,
}: {
  entry: ActivityEntry;
  application?: ApplicationLabel & { id: number };
  timeZone: string;
}) {
  const [dot, title, status, detail, error] =
    entry.kind === "function"
      ? [
          DOT_CLASSES[entry.run.status],
          entry.run.functionName,
          entry.run.status,
          entry.run.finishedAt && <> → {dateTime(entry.run.finishedAt, timeZone)}</>,
          entry.run.error,
        ]
      : entry.kind === "step"
        ? [
            DOT_CLASSES[entry.log.status],
            `${STEP_NAMES[entry.log.step]} · attempt ${entry.log.attempt}`,
            entry.log.status,
            entry.log.result && <> · {entry.log.result}</>,
            entry.log.error,
          ]
        : [
            "bg-emerald-500",
            `Emailed ${entry.send.name}`,
            "sent",
            entry.send.email && <> · {entry.send.email}</>,
            null,
          ];

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
          <span className="truncate">{title}</span>
        </span>
        <span className="shrink-0 text-xs text-muted">{status}</span>
      </div>
      <p className="text-xs break-words text-muted">
        {dateTime(entry.at, timeZone)}
        {detail}
      </p>
      {application && (
        <Link href={`/applications/${application.id}`} className={`mt-1 inline-block text-xs ${linkClass}`}>
          {application.jobTitle} · {application.companyName}
        </Link>
      )}
      {error && <p className="mt-1 text-xs break-words text-red-600 dark:text-red-400">{error}</p>}
    </li>
  );
}
