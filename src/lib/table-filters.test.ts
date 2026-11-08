import { expect, test } from "vitest";
import {
  type DecisionMakerEmailFilter,
  filterApplications,
  filterDecisionMakers,
  parseDecisionMakerFilters,
  hasJobFilters,
  paginate,
  parseJobFilters,
  parsePage,
  PAGE_SIZE,
  withParams,
} from "./table-filters";

test("Job filters come from the URL, with unknown values dropped", () => {
  expect(parseJobFilters({ q: " engineer ", source: ["LinkedIn", "LinkedIn", ""], application: "nope" })).toEqual({
    q: "engineer",
    sources: ["LinkedIn"],
    location: "",
    application: "any",
    company: "",
  });
  expect(parseJobFilters({ source: "Glassdoor", application: "none" })).toMatchObject({
    sources: ["Glassdoor"],
    application: "none",
  });
  expect(hasJobFilters(parseJobFilters({}))).toBe(false);
  expect(hasJobFilters(parseJobFilters({ company: "Acme" }))).toBe(true);
});

test("A missing or bad page is page 1", () => {
  expect(parsePage(undefined)).toBe(1);
  expect(parsePage("0")).toBe(1);
  expect(parsePage("2.5")).toBe(1);
  expect(parsePage("abc")).toBe(1);
  expect(parsePage("3")).toBe(3);
});

test("Pagination shows the last page for a page past it", () => {
  const rows = Array.from({ length: PAGE_SIZE + 3 }, (_, index) => index);
  expect(paginate(rows, 1)).toMatchObject({ page: 1, pages: 2 });
  expect(paginate(rows, 9)).toEqual({ rows: [PAGE_SIZE, PAGE_SIZE + 1, PAGE_SIZE + 2], page: 2, pages: 2 });
  expect(paginate([], 4)).toEqual({ rows: [], page: 1, pages: 1 });
});

test("Applications match the search on title or Company, and the location, ignoring case", () => {
  const rows = [
    { jobTitle: "Frontend Engineer", companyName: "Acme", jobLocation: "Berlin, Germany" },
    { jobTitle: "Designer", companyName: "Engine Co", jobLocation: "Remote" },
  ];
  expect(filterApplications(rows, { q: "engine", location: "" })).toHaveLength(2);
  expect(filterApplications(rows, { q: "engine", location: "berlin" })).toEqual([rows[0]]);
  expect(filterApplications(rows, { q: "", location: "" })).toEqual(rows);
});

test("Links leave out empty params and repeat arrays", () => {
  expect(withParams("/jobs", { q: "", source: ["LinkedIn", "Glassdoor"], page: undefined })).toBe(
    "/jobs?source=LinkedIn&source=Glassdoor",
  );
  expect(withParams("/jobs", {})).toBe("/jobs");
});

const person = (name: string, changes: Partial<{ headline: string; companyName: string; email: string | null; lastEmailedAt: Date | null }> = {}) => ({
  name,
  headline: "Engineer",
  companyName: "Acme",
  email: null,
  lastEmailedAt: null,
  ...changes,
});

test("Decision Maker filters come from the URL, with an unknown email filter as any", () => {
  expect(parseDecisionMakerFilters({ q: " ada ", email: "cooldown" })).toEqual({ q: "ada", email: "cooldown" });
  expect(parseDecisionMakerFilters({ email: "nope" })).toEqual({ q: "", email: "any" });
});

test("Decision Makers match the search in their name, headline, Company or email, ignoring case", () => {
  const people = [
    person("Ada Lovelace"),
    person("Grace Hopper", { headline: "Head of Talent" }),
    person("Linus", { companyName: "Initech" }),
    person("Margaret", { email: "margaret@hamilton.dev" }),
  ];
  const now = new Date("2026-11-08T00:00:00Z");
  const names = (q: string) => filterDecisionMakers(people, { q, email: "any" }, now).map(({ name }) => name);
  expect(names("ada")).toEqual(["Ada Lovelace"]);
  expect(names("TALENT")).toEqual(["Grace Hopper"]);
  expect(names("initech")).toEqual(["Linus"]);
  expect(names("hamilton")).toEqual(["Margaret"]);
  expect(names("")).toHaveLength(4);
});

test("Decision Makers filter by whether they have an email, or are in Cooldown", () => {
  const now = new Date("2026-11-08T00:00:00Z");
  const people = [
    person("No email"),
    person("Emailed long ago", { email: "a@x.dev", lastEmailedAt: new Date("2026-09-01T00:00:00Z") }),
    person("Emailed last week", { email: "b@x.dev", lastEmailedAt: new Date("2026-11-01T00:00:00Z") }),
  ];
  const names = (email: DecisionMakerEmailFilter) => filterDecisionMakers(people, { q: "", email }, now).map(({ name }) => name);
  expect(names("with")).toEqual(["Emailed long ago", "Emailed last week"]);
  expect(names("without")).toEqual(["No email"]);
  expect(names("cooldown")).toEqual(["Emailed last week"]);
});

