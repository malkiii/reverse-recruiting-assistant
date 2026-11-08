/** Filters and pagination for the dashboard's tables, read from the URL. */

import { inCooldown } from "./decision-maker-search";

export const PAGE_SIZE = 25;

export type SearchParams = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
const many = (value: string | string[] | undefined) =>
  (value === undefined ? [] : Array.isArray(value) ? value : [value]).map((item) => item.trim()).filter(Boolean);

export const APPLICATION_FILTERS = ["any", "none", "prepared"] as const;
export type ApplicationFilter = (typeof APPLICATION_FILTERS)[number];

export type JobFilters = {
  /** Matches the title or the Company name. */
  q: string;
  sources: string[];
  location: string;
  application: ApplicationFilter;
  company: string;
};

export function parseJobFilters(params: SearchParams): JobFilters {
  return {
    q: one(params.q),
    sources: [...new Set(many(params.source))],
    location: one(params.location),
    application: APPLICATION_FILTERS.find((filter) => filter === one(params.application)) ?? "any",
    company: one(params.company),
  };
}

export const hasJobFilters = (filters: JobFilters) =>
  Boolean(filters.q || filters.sources.length || filters.location || filters.application !== "any" || filters.company);

/** The page in the URL, 1 when it's missing or not a positive whole number. */
export function parsePage(value: string | string[] | undefined) {
  const page = Number(one(value));
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export const pageCount = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));

/** A page past the last one shows the last one. */
export const clampPage = (page: number, total: number) => Math.min(page, pageCount(total));

export function paginate<T>(rows: T[], page: number) {
  const shown = clampPage(page, rows.length);
  return { rows: rows.slice((shown - 1) * PAGE_SIZE, shown * PAGE_SIZE), page: shown, pages: pageCount(rows.length) };
}

const contains = (text: string, part: string) => text.toLowerCase().includes(part.toLowerCase());

export type ApplicationFilters = { q: string; location: string };

export const parseApplicationFilters = (params: SearchParams): ApplicationFilters => ({
  q: one(params.q),
  location: one(params.location),
});

/** Applications whose Job title or Company name has the search, and whose Job's location has the location. */
export const filterApplications = <T extends { jobTitle: string; companyName: string; jobLocation: string }>(
  rows: T[],
  { q, location }: ApplicationFilters,
) =>
  rows.filter(
    (row) =>
      (!q || contains(row.jobTitle, q) || contains(row.companyName, q)) && (!location || contains(row.jobLocation, location)),
  );

/** The path with these params; an empty or undefined value is left out, and an array repeats the param. */
export function withParams(path: string, params: SearchParams) {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : [value]) if (item) search.append(name, item);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export const DECISION_MAKER_EMAIL_FILTERS = ["any", "with", "without", "cooldown"] as const;
export type DecisionMakerEmailFilter = (typeof DECISION_MAKER_EMAIL_FILTERS)[number];

export type DecisionMakerFilters = { q: string; email: DecisionMakerEmailFilter };

export const parseDecisionMakerFilters = (params: SearchParams): DecisionMakerFilters => ({
  q: one(params.q),
  email: DECISION_MAKER_EMAIL_FILTERS.find((filter) => filter === one(params.email)) ?? "any",
});

type FilterableDecisionMaker = {
  name: string;
  headline: string;
  companyName: string;
  email: string | null;
  lastEmailedAt: Date | null;
};

/** Decision Makers whose name, headline, Company or email has the search, and that pass the email filter. */
export const filterDecisionMakers = <T extends FilterableDecisionMaker>(rows: T[], { q, email }: DecisionMakerFilters, now: Date) =>
  rows.filter(
    (row) =>
      (!q || [row.name, row.headline, row.companyName, row.email ?? ""].some((text) => contains(text, q))) &&
      (email === "any" ||
        (email === "with" && row.email !== null) ||
        (email === "without" && row.email === null) ||
        (email === "cooldown" && inCooldown(row, now))),
  );
