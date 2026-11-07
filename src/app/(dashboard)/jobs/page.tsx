import { AutoRefresh } from "@/components/auto-refresh";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SidePanel, SidePanelToggle } from "@/components/side-panel";
import { SubmitButton } from "@/components/submit-button";
import { sourceName } from "@/components/status";
import { FilterInput, FilterSegmented, FilterSelect } from "@/components/table-filters";
import { TableResults, TableTransition } from "@/components/table-transition";
import {
  Alert,
  Card,
  cx,
  EmptyState,
  ExternalLink,
  linkClass,
  PageHeader,
  Pagination,
  percent,
  shortDate,
  SourceBadge,
  StatTile,
  StatusBadge,
} from "@/components/ui";
import { startFunction } from "@/lib/dashboard-functions";
import { loadStatsRows } from "@/lib/dashboard-data";
import { jobsStrip } from "@/lib/dashboard-stats";
import {
  drizzleFunctionRunStore,
  findApplicationIdForJob,
  listJobFilterOptions,
  listJobsWithApplications,
} from "@/lib/drizzle";
import { parseDashboardEnv } from "@/lib/env";
import { isCollectionActive } from "@/lib/job-collection";
import {
  APPLICATION_FILTERS,
  type ApplicationFilter,
  hasJobFilters,
  type JobFilters,
  parseJobFilters,
  parsePage,
  type SearchParams,
  withParams,
} from "@/lib/table-filters";
import { COLLECT_JOBS, PREPARE_APPLICATION } from "@/lib/schema";
import { CollectionSettings } from "./collection-settings";

async function startCollection() {
  "use server";

  // 409 means one is already active, which the page shows after this refresh.
  await startFunction(COLLECT_JOBS);
  revalidatePath("/jobs");
}

async function prepareJob(formData: FormData) {
  "use server";

  const jobId = Number(formData.get("jobId"));
  const response = await startFunction(PREPARE_APPLICATION, { jobId });
  // A 409 means the Job already has its one Application, so the Admin is shown that one.
  const applicationId =
    response.status === 202
      ? response.applicationId
      : await findApplicationIdForJob(parseDashboardEnv(process.env).DATABASE_URL, jobId);
  if (applicationId === undefined) throw new Error(`Job ${jobId} couldn't be Prepared`);
  redirect(`/applications/${applicationId}`);
}

type JobRow = Awaited<ReturnType<typeof listJobsWithApplications>>["rows"][number];

function ApplicationCell({ job, block }: { job: JobRow; block?: boolean }) {
  if (job.applicationId && job.applicationStatus) {
    return (
      <Link
        href={`/applications/${job.applicationId}`}
        className="inline-flex items-center gap-1 py-1 after:absolute after:inset-0"
      >
        <StatusBadge status={job.applicationStatus} />
        <span aria-hidden="true" className="text-faint">
          ›
        </span>
      </Link>
    );
  }
  return (
    <form action={prepareJob}>
      <input type="hidden" name="jobId" value={job.id} />
      <SubmitButton variant="secondary" pendingText="Preparing…" block={block}>
        Prepare
      </SubmitButton>
    </form>
  );
}

/** A Job with an Application opens it from anywhere on its row or card. */
const hasApplication = (job: JobRow) => Boolean(job.applicationId && job.applicationStatus);

function CompanyName({ job }: { job: JobRow }) {
  return job.companyLinkedinUrl ? (
    <ExternalLink href={job.companyLinkedinUrl} className="relative z-10 hover:underline">
      {job.companyName}
    </ExternalLink>
  ) : (
    <>{job.companyName}</>
  );
}

const APPLICATION_LABELS: Record<ApplicationFilter, string> = {
  any: "Any",
  none: "Not prepared",
  prepared: "Prepared",
};

/** The Jobs page with these filters, back on page 1. */
const jobsHref = (filters: JobFilters, page?: number) =>
  withParams("/jobs", {
    q: filters.q,
    source: filters.sources,
    location: filters.location,
    application: filters.application === "any" ? undefined : filters.application,
    company: filters.company,
    page: page && page > 1 ? String(page) : undefined,
  });

function JobFilterBar({ filters, sources, companies }: { filters: JobFilters; sources: string[]; companies: string[] }) {
  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <FilterInput name="q" label="Search Jobs" placeholder="Search title or Company" />
        <FilterInput name="location" label="Location" placeholder="Location" />
        <FilterSelect name="company" label="Company" emptyLabel="All Companies" options={companies} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {sources.length > 1 && (
          <FilterSegmented
            name="source"
            label="Filter by source"
            multiple
            options={[
              { value: "", label: "All sources" },
              ...sources.map((source) => ({ value: source, label: sourceName(source) })),
            ]}
          />
        )}
        <FilterSegmented
          name="application"
          label="Filter by Application"
          options={APPLICATION_FILTERS.map((application) => ({
            value: application === "any" ? "" : application,
            label: APPLICATION_LABELS[application],
          }))}
        />
        {hasJobFilters(filters) && (
          <Link href="/jobs" className={cx(linkClass, "text-sm")}>
            Clear filters
          </Link>
        )}
      </div>
    </div>
  );
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection();
  const params = await searchParams;
  const filters = parseJobFilters(params);
  const { DATABASE_URL, TIMEZONE } = parseDashboardEnv(process.env);
  const now = new Date();
  const [{ rows: jobs, total, page, pages }, options, runs, statsRows] = await Promise.all([
    listJobsWithApplications(DATABASE_URL, filters, parsePage(params.page)),
    listJobFilterOptions(DATABASE_URL),
    drizzleFunctionRunStore(DATABASE_URL).list(),
    loadStatsRows(DATABASE_URL, now),
  ]);
  const filtered = hasJobFilters(filters);
  const running = isCollectionActive(runs, now);
  const strip = jobsStrip(statsRows, now, TIMEZONE);

  return (
    <>
      {running && <AutoRefresh seconds={5} />}
      <PageHeader
        title="Jobs"
        subtitle={filtered ? `${total} matching, newest first` : `${total} Jobs, newest first`}
        action={
          <div className="flex items-center gap-2">
            <form action={startCollection}>
              <SubmitButton pendingText="Starting…" disabled={running}>
                {running ? "Collecting…" : "Run Job Collection"}
              </SubmitButton>
            </form>
            <SidePanelToggle label="Collection settings" />
          </div>
        }
      />
      <SidePanel title="Collection settings">
        <CollectionSettings />
      </SidePanel>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="New Jobs today" value={strip.newJobsToday} />
        <StatTile label="In Review" value={strip.inReview} href="/applications?status=in-review" />
        <StatTile label="Sent this week" value={strip.sentThisWeek} />
        <StatTile label="Email-Found Rate" value={percent(strip.emailFoundRate)} href="/stats" />
      </div>

      {running && (
        <div className="mb-4">
          <Alert tone="info">A Job Collection is running. This page refreshes until it&apos;s done.</Alert>
        </div>
      )}

      <TableTransition>
        {(filtered || jobs.length > 0) && (
          <JobFilterBar filters={filters} sources={options.sources} companies={options.companies} />
        )}

        <TableResults>
          {jobs.length === 0 ? (
            filtered ? (
              <EmptyState title="No matching Jobs">
                <Link href="/jobs" className={linkClass}>
                  Clear filters
                </Link>
              </EmptyState>
            ) : (
              <EmptyState title="No Jobs yet">
                Run a Job Collection, or turn on a Job Board or Job Feed in Collection settings, the side panel.
              </EmptyState>
            )
          ) : (
            <>
              <ul className="space-y-3 md:hidden">
                {jobs.map((job) => (
                  <li key={job.url}>
                    <Card className={cx("p-4", hasApplication(job) && "relative active:bg-subtle")}>
                      <ExternalLink href={job.url} className="relative z-10 block text-base leading-snug font-semibold">
                        {job.title}
                      </ExternalLink>
                      <p className="mt-1 text-sm text-fg-2">
                        <CompanyName job={job} />
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
                        {job.location} · {shortDate(job.postDay, TIMEZONE)} <SourceBadge source={job.source} />
                      </p>
                      <div className="mt-3">
                        <ApplicationCell job={job} block />
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>

              <Card className="hidden md:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line text-[11px] tracking-wide text-muted uppercase">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Job</th>
                      <th className="px-4 py-2.5 font-medium">Location</th>
                      <th className="px-4 py-2.5 font-medium">Posted</th>
                      <th className="px-4 py-2.5 font-medium">Source</th>
                      <th className="px-4 py-2.5 text-right font-medium">Application</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {jobs.map((job) => (
                      <tr
                        key={job.url}
                        className={cx("hover:bg-subtle", hasApplication(job) && "relative cursor-pointer")}
                      >
                        <td className="max-w-80 px-4 py-3">
                          <ExternalLink href={job.url} className="relative z-10 font-medium hover:underline">
                            {job.title}
                          </ExternalLink>
                          <div className="text-muted">
                            <CompanyName job={job} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-fg-2">{job.location}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-fg-2">
                          {shortDate(job.postDay, TIMEZONE)}
                        </td>
                        <td className="px-4 py-3">
                          <SourceBadge source={job.source} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ApplicationCell job={job} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
              <Pagination page={page} pages={pages} href={(target) => jobsHref(filters, target)} />
            </>
          )}
        </TableResults>
      </TableTransition>
    </>
  );
}
