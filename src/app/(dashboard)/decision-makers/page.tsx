import Link from "next/link";
import { connection } from "next/server";
import { Avatar } from "@/components/avatar";
import { CopyButton } from "@/components/copy-button";
import { FilterInput, FilterSegmented } from "@/components/table-filters";
import { TableResults, TableTransition } from "@/components/table-transition";
import { Card, EmptyState, ExternalLink, linkClass, PageHeader, Pagination, shortDate, Tag } from "@/components/ui";
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
  const all = await listDecisionMakersWithCompanies(DATABASE_URL);
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
                      <p className="flex items-center text-sm text-muted">
                        <span className="truncate">
                          <ExternalLink href={person.companyLinkedinUrl} className="hover:text-fg hover:underline">
                            {person.companyName}
                          </ExternalLink>
                          {" · "}
                          {person.email ?? "No email"}
                          {(() => {
                            const emails = person.applications.filter(({ sentAt }) => sentAt).length;
                            return emails > 0 && <> · {emails} email{emails === 1 ? "" : "s"}</>;
                          })()}
                          {person.lastEmailedAt && <> · last {shortDate(person.lastEmailedAt, TIMEZONE)}</>}
                        </span>
                        {person.email && <CopyButton text={person.email} label={`Copy ${person.name}'s email`} />}
                      </p>
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
