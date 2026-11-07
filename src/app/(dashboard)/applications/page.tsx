import { AutoRefresh } from "@/components/auto-refresh";
import Link from "next/link";
import { connection } from "next/server";
import { FILTER_LABELS, STEP_NAMES } from "@/components/status";
import { FilterInput } from "@/components/table-filters";
import { TableResults, TableTransition } from "@/components/table-transition";
import { Card, cx, EmptyState, linkClass, PageHeader, Pagination, Segmented, shortDate, StatusBadge } from "@/components/ui";
import { loadApplications } from "@/lib/dashboard-data";
import { groupCounts, parseStatusFilter, STATUS_GROUPS, type StatusFilter, statusGroup } from "@/lib/dashboard-stats";
import { parseDashboardEnv } from "@/lib/env";
import {
  type ApplicationFilters,
  filterApplications,
  paginate,
  parseApplicationFilters,
  parsePage,
  type SearchParams,
  withParams,
} from "@/lib/table-filters";

const applicationsHref = (filters: ApplicationFilters, status: StatusFilter, page?: number) =>
  withParams("/applications", {
    q: filters.q,
    location: filters.location,
    status: status === "all" ? undefined : status,
    page: page && page > 1 ? String(page) : undefined,
  });

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection();
  const params = await searchParams;
  const filter = parseStatusFilter(typeof params.status === "string" ? params.status : undefined);
  const filters = parseApplicationFilters(params);
  const searching = Boolean(filters.q || filters.location);
  const { DATABASE_URL, TIMEZONE } = parseDashboardEnv(process.env);
  const all = await loadApplications(DATABASE_URL, new Date());
  // The status counts follow the search, so each tab says how many it would show.
  const matching = filterApplications(all, filters);
  const counts = groupCounts(matching.map(({ application }) => application.status));
  const inGroup =
    filter === "all" ? matching : matching.filter(({ application }) => statusGroup(application.status) === filter);
  const { rows: shown, page, pages } = paginate(inGroup, parsePage(params.page));
  const working = all.some(({ application }) => statusGroup(application.status) === "working");

  return (
    <>
      {working && <AutoRefresh seconds={5} />}
      <PageHeader title="Applications" subtitle="Everything you've Prepared, newest first" />

      <TableTransition>
        {all.length > 0 && (
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <FilterInput name="q" label="Search Applications" placeholder="Search title or Company" />
            <FilterInput name="location" label="Location" placeholder="Location" />
            {searching && (
              <Link href={applicationsHref({ q: "", location: "" }, filter)} className={cx(linkClass, "text-sm")}>
                Clear search
              </Link>
            )}
          </div>
        )}

        <Segmented
          label="Filter by status"
          options={(["all", ...STATUS_GROUPS] as const).map((group) => ({
            href: applicationsHref(filters, group),
            active: filter === group,
            label: (
              <>
                {FILTER_LABELS[group]}
                <span className="tabular-nums opacity-70">{counts[group]}</span>
              </>
            ),
          }))}
        />

        <TableResults>
          {shown.length === 0 ? (
            <EmptyState
              title={
                searching
                  ? "No matching Applications"
                  : filter === "all"
                    ? "No Applications yet"
                    : `No ${FILTER_LABELS[filter]} Applications`
              }
            >
              {searching ? (
                <Link href={applicationsHref({ q: "", location: "" }, filter)} className={linkClass}>
                  Clear search
                </Link>
              ) : filter === "all" ? (
                <>
                  Prepare a Job from{" "}
                  <Link href="/jobs" className={linkClass}>
                    Jobs
                  </Link>{" "}
                  to start one.
                </>
              ) : (
                <Link href="/applications" className={linkClass}>
                  Show all
                </Link>
              )}
            </EmptyState>
          ) : (
            <Card>
              <ul className="divide-y divide-line">
                {shown.map(({ application, jobTitle, companyName }) => (
                  <li key={application.id}>
                    <Link
                      href={`/applications/${application.id}`}
                      className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-subtle active:bg-subtle"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{jobTitle}</p>
                        <p className="truncate text-sm text-muted">
                          {companyName}
                          {statusGroup(application.status) === "working" && <> · {STEP_NAMES[application.currentStep]}…</>}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <StatusBadge status={application.status} />
                        <span className="text-xs text-muted">
                          {shortDate(application.createdAt, TIMEZONE)}
                        </span>
                      </div>
                      <span aria-hidden="true" className="text-faint">
                        ›
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Pagination page={page} pages={pages} href={(target) => applicationsHref(filters, filter, target)} />
        </TableResults>
      </TableTransition>
    </>
  );
}
