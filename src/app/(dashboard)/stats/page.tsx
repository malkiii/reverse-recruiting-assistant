import { connection } from "next/server";
import { sourceName, STATUS_LABELS, statusTone } from "@/components/status";
import { Card, CardBody, CardHeader, PageHeader, percent, Segmented, StatTile } from "@/components/ui";
import { loadStatsRows } from "@/lib/dashboard-data";
import { activity, parseRange, stats, STATS_RANGES, type StatsRange } from "@/lib/dashboard-stats";
import { parseDashboardEnv } from "@/lib/env";
import { ActivityChart, BarsChart, DonutChart } from "./charts";

const RANGE_LABELS: Record<StatsRange, string> = { "24h": "24h", "7d": "7d", "30d": "30d", all: "All" };
const RANGE_PHRASES: Record<StatsRange, string> = {
  "24h": "in the last 24 hours",
  "7d": "in the last 7 days",
  "30d": "in the last 30 days",
  all: "since the start",
};

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await connection();
  const range = parseRange((await searchParams).range);
  const { DATABASE_URL, TIMEZONE } = parseDashboardEnv(process.env);
  const now = new Date();
  const rows = await loadStatsRows(DATABASE_URL, now);
  const result = stats(rows, range, now);
  const totalJobs = result.jobsPerSource.reduce((sum, { count }) => sum + count, 0);
  const totalApplications = result.applicationsByStatus.reduce((sum, { count }) => sum + count, 0);

  return (
    <>
      <PageHeader
        title="Stats"
        subtitle={`Activity ${RANGE_PHRASES[range]}`}
        action={
          <Segmented
            label="Time range"
            inline
            options={STATS_RANGES.map((option) => ({
              href: option === "30d" ? "/stats" : `/stats?range=${option}`,
              active: option === range,
              label: RANGE_LABELS[option],
            }))}
          />
        }
      />

      {/* The counts, then the rates side by side. */}
      <div className="mb-4 grid grid-cols-2 gap-3 [&>*:last-child]:col-span-2 md:grid-cols-12 md:*:col-span-3 md:[&>*:nth-child(n+5)]:col-span-4">
        <StatTile label="Jobs found" value={totalJobs} />
        <StatTile label="Applications" value={totalApplications} />
        <StatTile label="Emails sent" value={result.emailsSent} />
        <StatTile label="Replies" value={result.replies} href="/replies" />
        <StatTile label="Email-Found Rate" value={percent(result.emailFoundRate)} />
        <StatTile label="Reply Rate per Decision Maker" value={percent(result.replyRatePerDecisionMaker)} />
        <StatTile label="Reply Rate per Application" value={percent(result.replyRatePerApplication)} />
      </div>

      <Card className="mb-4">
        <CardHeader title={range === "24h" ? "Activity per hour" : "Activity per day"} />
        <CardBody>
          <ActivityChart points={activity(rows, range, now, TIMEZONE)} />
        </CardBody>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Jobs per Job Board and Job Feed" />
          <CardBody>
            <BarsChart
              empty="No Jobs found in this range."
              rows={result.jobsPerSource.map(({ source, count }) => ({ label: sourceName(source), count }))}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Applications by status" />
          <CardBody>
            <DonutChart
              empty="No Applications in this range."
              rows={result.applicationsByStatus.map(({ status, count }) => ({
                label: STATUS_LABELS[status],
                count,
                color: statusTone(status).chart,
              }))}
            />
          </CardBody>
        </Card>
      </div>

      <p className="mt-4 text-xs text-muted">
        Email-Found Rate: of the Applications that got past the search for Decision Makers, or ended in No Contacts or
        Direct Apply, the share that reached at least one Decision Maker with an email address.
      </p>
      <p className="mt-1 text-xs text-muted">
        Reply Rates count the emails sent in the range: per Decision Maker, the share of Decision Makers emailed who
        replied, each counted once; per Application, the share of sent Applications with at least one Reply.
      </p>
    </>
  );
}
