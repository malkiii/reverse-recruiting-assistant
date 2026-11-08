import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Avatar } from "@/components/avatar";
import { Card, CardHeader, dateTime, DetailList, ExternalLink, linkClass, shortDate, SourceBadge, StatusBadge, Tag } from "@/components/ui";
import { loadApplications } from "@/lib/dashboard-data";
import { inCooldown } from "@/lib/decision-maker-search";
import { drizzleDecisionMakerStore, getCompanyWithJobs } from "@/lib/drizzle";
import { parseDashboardEnv } from "@/lib/env";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const { DATABASE_URL, TIMEZONE } = parseDashboardEnv(process.env);
  const now = new Date();
  const [found, applications, people] = await Promise.all([
    getCompanyWithJobs(DATABASE_URL, id),
    loadApplications(DATABASE_URL, now),
    drizzleDecisionMakerStore(DATABASE_URL).listForCompany(id),
  ]);
  if (!found) notFound();
  const { company, jobs } = found;
  const companyApplications = applications.filter(({ application }) => application.companyId === id);

  return (
    <div className="space-y-4">
      <Link href="/companies" className="inline-flex min-h-9 items-center text-sm text-muted hover:text-fg">
        ‹ Companies
      </Link>
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{company.name}</h1>
      </header>

      <Card>
        <DetailList
          items={[
            [
              "LinkedIn",
              <ExternalLink key="linkedin" href={company.linkedinUrl} className={linkClass}>
                {company.linkedinUrl.replace(/^https?:\/\/(www\.)?/, "")}
              </ExternalLink>,
            ],
            ["People searched", company.peopleFoundAt ? dateTime(company.peopleFoundAt, TIMEZONE) : "Never"],
          ]}
        />
      </Card>

      <Card>
        <CardHeader title={`Applications · ${companyApplications.length}`} />
        {companyApplications.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">No Applications yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {companyApplications.map(({ application, jobTitle }) => (
              <li key={application.id}>
                <Link
                  href={`/applications/${application.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-subtle"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{jobTitle}</span>
                  <StatusBadge status={application.status} />
                  <span className="text-xs text-muted">{shortDate(application.createdAt, TIMEZONE)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={`Jobs · ${jobs.length}`} />
        {jobs.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">No Jobs.</p>
        ) : (
          <ul className="divide-y divide-line">
            {jobs.map((job) => (
              <li key={job.id} className="flex items-center gap-3 px-4 py-3">
                <ExternalLink href={job.url} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                  {job.title}
                </ExternalLink>
                <SourceBadge source={job.source} />
                {job.applicationId && (
                  <Link href={`/applications/${job.applicationId}`} className={`text-xs ${linkClass}`}>
                    Application
                  </Link>
                )}
                <span className="text-xs text-muted">{shortDate(job.postDay, TIMEZONE)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title={`People · ${people.length}`} />
        {people.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted">No one found yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {people.map((person) => (
              <li key={person.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={person.name} photo={person.photo} />
                <div className="min-w-0 flex-1">
                  <ExternalLink href={person.profileUrl} className="block truncate text-sm font-medium hover:underline">
                    {person.name}
                  </ExternalLink>
                  <p className="truncate text-xs text-muted">{person.headline}</p>
                  <p className="truncate text-xs text-muted">{person.email ?? "No email"}</p>
                </div>
                {inCooldown(person, now) && <Tag tone="amber">In Cooldown</Tag>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
