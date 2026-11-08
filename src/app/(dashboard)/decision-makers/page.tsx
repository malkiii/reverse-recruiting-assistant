import Link from "next/link";
import { connection } from "next/server";
import { Avatar } from "@/components/avatar";
import { FilterInput, FilterSegmented } from "@/components/table-filters";
import { TableResults, TableTransition } from "@/components/table-transition";
import { Card, cx, EmptyState, ExternalLink, linkClass, PageHeader, Pagination, shortDate, Tag } from "@/components/ui";
import { loadApplications } from "@/lib/dashboard-data";
import { inCooldown } from "@/lib/decision-maker-search";
import { listDecisionMakersWithCompanies } from "@/lib/drizzle";
import { parseDashboardEnv } from "@/lib/env";
import {
  DECISION_MAKER_EMAIL_FILTERS,
  type DecisionMakerEmailFilter,
  type DecisionMakerFilters,
  filterDecisionMakers,
  paginate,
  parseDecisionMakerFilters,
  parsePage,
  type SearchParams,
  withParams,
} from "@/lib/table-filters";

const EMAIL_LABELS: Record<DecisionMakerEmailFilter, string> = {
  any: "All",
  with: "With email",
  without: "No email",
  cooldown: "In Cooldown",
};

const decisionMakersHref = ({ q, email }: DecisionMakerFilters, page?: number) =>
  withParams("/decision-makers", {
    q,
    email: email === "any" ? undefined : email,
    page: page && page > 1 ? String(page) : undefined,
  });

export default async function DecisionMakersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection();
  const params = await searchParams;
  const filters = parseDecisionMakerFilters(params);
  const { DATABASE_URL, TIMEZONE } = parseDashboardEnv(process.env);
  const now = new Date();
  const [all, applications] = await Promise.all([
    listDecisionMakersWithCompanies(DATABASE_URL),
    loadApplications(DATABASE_URL, now),
  ]);
  const jobTitles = new Map(applications.map(({ application, jobTitle }) => [application.id, jobTitle]));
  const { rows, page, pages } = paginate(filterDecisionMakers(all, filters, now), parsePage(params.page));
  const filtered = Boolean(filters.q || filters.email !== "any");

  return (
    <>
      <PageHeader title="Decision Makers" subtitle="Every Person found at your Companies, with or without an email, the most recently emailed first" />
      <TableTransition>
        {all.length > 0 && (
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <FilterInput name="q" label="Search Decision Makers" placeholder="Search name, Company or email" />
            <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
              <FilterSegmented
                name="email"
                label="Filter by email"
                options={DECISION_MAKER_EMAIL_FILTERS.map((option) => ({
                  value: option === "any" ? "" : option,
                  label: EMAIL_LABELS[option],
                }))}
              />
            </div>
          </div>
        )}
        <TableResults>
          {rows.length === 0 ? (
            <EmptyState title={filtered ? "No matching Decision Makers" : "No Decision Makers yet"}>
              {filtered ? (
                <Link href="/decision-makers" className={linkClass}>
                  Clear filters
                </Link>
              ) : (
                "Prepare finds them at each Application's Company."
              )}
            </EmptyState>
          ) : (
            <Card>
              <ul className="divide-y divide-line">
                {rows.map((person) => (
                  <li key={person.id} className="flex gap-3 px-4 py-3">
                    <Avatar name={person.name} photo={person.photo} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <ExternalLink href={person.profileUrl} className="truncate font-medium hover:underline">
                          {person.name}
                        </ExternalLink>
                        {inCooldown(person, now) && <Tag tone="amber">In Cooldown</Tag>}
                      </div>
                      <p className="truncate text-sm text-muted">{person.headline}</p>
                      <p className="truncate text-sm text-muted">
                        <Link href={`/companies/${person.companyId}`} className="hover:text-fg hover:underline">
                          {person.companyName}
                        </Link>
                        {" · "}
                        {person.email ?? "No email"}
                        {(() => {
                          const emails = person.applications.filter(({ sentAt }) => sentAt).length;
                          return emails > 0 && <> · {emails} email{emails === 1 ? "" : "s"}</>;
                        })()}
                        {person.lastEmailedAt && <> · last {shortDate(person.lastEmailedAt, TIMEZONE)}</>}
                      </p>
                      {person.applications.length > 0 && (
                        <ul className="mt-1.5 flex flex-wrap gap-1.5">
                          {person.applications.map(({ applicationId, sentAt }) => (
                            <li key={applicationId}>
                              <Link
                                href={`/applications/${applicationId}`}
                                className={cx(
                                  "inline-flex items-center rounded-xs px-1.5 py-0.5 text-xs font-medium transition hover:ring-1 hover:ring-line-strong",
                                  sentAt ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-subtle text-fg-2",
                                )}
                              >
                                {jobTitles.get(applicationId) ?? `Application ${applicationId}`}
                                {sentAt && " · Sent"}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Pagination page={page} pages={pages} href={(target) => decisionMakersHref(filters, target)} />
        </TableResults>
      </TableTransition>
    </>
  );
}
