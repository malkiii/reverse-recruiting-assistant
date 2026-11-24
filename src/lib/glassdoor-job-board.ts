import { NodeHtmlMarkdown } from "node-html-markdown";
import { z } from "zod";
import { actorRunItems, actorRunStatus, startActorRun } from "./apify-actor";
import type { ActorRun, JobBoardGateway, JobBoardRunOptions } from "./gateways";
import type { JobSearch } from "./schema";

const ACTOR = "valig/glassdoor-jobs-scraper";
const SOURCE = "Glassdoor";
// A real run confirmed that 1 means the last day, with ageInDays 0 for Jobs posted today.
const DAYS_OLD = 1;

const paySchema = z.object({
  currency: z.string().nullish(),
  period: z.string().nullish(),
  min: z.number().nullish(),
  max: z.number().nullish(),
});

const itemSchema = z.object({
  url: z.string(),
  title: z.string(),
  employer: z.object({ name: z.string(), logoUrl: z.string().nullish() }),
  location: z.object({ name: z.string().nullish() }).nullish(),
  ageInDays: z.number(),
  description: z.string().nullish(),
  // A pay that can't be read only loses the salary, not the Job.
  pay: paySchema.nullish().catch(null),
});

const PERIODS: Record<string, string> = { ANNUAL: "year", MONTHLY: "month", WEEKLY: "week", DAILY: "day", HOURLY: "hour" };

function money(amount: number, currency: string) {
  const fractionDigits = Number.isInteger(amount) ? 0 : 2;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    // Not a currency code Intl knows.
    return `${amount.toLocaleString("en-US")} ${currency}`;
  }
}

/** Glassdoor's pay as text, such as "$100,000 – $215,000 / year". Null when it has no amount. */
export function formatPay(pay: z.infer<typeof paySchema> | null | undefined) {
  const amounts = [pay?.min, pay?.max].filter((amount): amount is number => amount != null && amount > 0);
  if (!pay || amounts.length === 0) return null;
  const currency = pay.currency || "USD";
  const [low, high] = [Math.min(...amounts), Math.max(...amounts)];
  const range = low === high ? money(low, currency) : `${money(low, currency)} – ${money(high, currency)}`;
  const period = pay.period && (PERIODS[pay.period.toUpperCase()] ?? pay.period.toLowerCase());
  return period ? `${range} / ${period}` : range;
}

export const glassdoorJobBoard: JobBoardGateway = {
  source: SOURCE,
  actor: ACTOR,

  start({ keywords, location }: JobSearch, limit: number, token: string, { remoteOnly }: JobBoardRunOptions) {
    return startActorRun(ACTOR, { keywords, location, daysOld: DAYS_OLD, limit, remoteWorkType: remoteOnly }, token);
  },

  status: actorRunStatus,

  results(run: ActorRun) {
    return actorRunItems(run, itemSchema, ({ url, title, employer, location, ageInDays, description, pay }) => ({
      source: SOURCE,
      title,
      companyName: employer.name,
      location: location?.name ?? "",
      // The query is the Job's ID (?jl=), so it stays.
      url,
      ageInDays,
      // Glassdoor gives the description as HTML.
      description: description ? NodeHtmlMarkdown.translate(description) : null,
      companyLinkedinUrl: null,
      companyLogoUrl: employer.logoUrl || null,
      salary: formatPay(pay),
    }));
  },
};
