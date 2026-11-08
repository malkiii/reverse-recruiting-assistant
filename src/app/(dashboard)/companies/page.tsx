import Link from "next/link";
import { connection } from "next/server";
import { FilterInput } from "@/components/table-filters";
import { TableResults, TableTransition } from "@/components/table-transition";
import { Card, cx, EmptyState, linkClass, PageHeader, Pagination } from "@/components/ui";
import { listCompaniesWithCounts } from "@/lib/drizzle";
import { parseDashboardEnv } from "@/lib/env";
import {
  type CompanyFilters,
  filterCompanies,
  paginate,
  parseCompanyFilters,
  parsePage,
  type SearchParams,
  withParams,
} from "@/lib/table-filters";

const companiesHref = ({ q }: CompanyFilters, page?: number) =>
  withParams("/companies", { q, page: page && page > 1 ? String(page) : undefined });

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection();
  const params = await searchParams;
  const filters = parseCompanyFilters(params);
  const { DATABASE_URL } = parseDashboardEnv(process.env);
  const all = await listCompaniesWithCounts(DATABASE_URL);
  const { rows, page, pages } = paginate(filterCompanies(all, filters), parsePage(params.page));

  return (
    <>
      <PageHeader title="Companies" subtitle="The Companies your Applications found on LinkedIn, A to Z" />
      <TableTransition>
        {all.length > 0 && (
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <FilterInput name="q" label="Search Companies" placeholder="Search Companies" />
            {filters.q && (
              <Link href="/companies" className={cx(linkClass, "text-sm")}>
                Clear search
              </Link>
            )}
          </div>
        )}
        <TableResults>
          {rows.length === 0 ? (
            <EmptyState title={filters.q ? "No matching Companies" : "No Companies yet"}>
              {filters.q ? (
                <Link href="/companies" className={linkClass}>
                  Clear search
                </Link>
              ) : (
                "A Company is added once Prepare finds its LinkedIn page."
              )}
            </EmptyState>
          ) : (
            <Card>
              <ul className="divide-y divide-line">
                {rows.map((company) => (
                  <li key={company.id}>
                    <Link
                      href={`/companies/${company.id}`}
                      className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-subtle active:bg-subtle"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{company.name}</p>
                        <p className="truncate text-sm text-muted">
                          {plural(company.jobs, "Job")} · {plural(company.applications, "Application")} ·{" "}
                          {plural(company.decisionMakers, "Decision Maker")} ({company.withEmail} with email)
                        </p>
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
          <Pagination page={page} pages={pages} href={(target) => companiesHref(filters, target)} />
        </TableResults>
      </TableTransition>
    </>
  );
}
