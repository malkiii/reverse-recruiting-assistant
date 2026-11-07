import { expect, test } from "vitest";
import { groupPeople } from "./decision-maker-search";
import type { DecisionMaker } from "./gateways";

const now = new Date("2026-11-06T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

let nextId = 1;
const person = (name: string, overrides: Partial<DecisionMaker> = {}): DecisionMaker => ({
  id: nextId++,
  companyId: 1,
  name,
  headline: `${name}'s headline`,
  profileUrl: `https://linkedin.com/in/${name}`,
  photo: null,
  email: `${name}@acme.com`,
  jobFunction: "12",
  foundAt: daysAgo(10),
  lastEmailedAt: null,
  ...overrides,
});

test("The Decision Makers are the Recipients, and everyone else found at the Company says why they weren't chosen", () => {
  const ada = person("ada");
  const people = [
    ada,
    person("bob", { email: null }),
    person("cy", { lastEmailedAt: daysAgo(29) }),
    person("dee", { lastEmailedAt: daysAgo(31) }),
  ];

  const { decisionMakers, alsoFound } = groupPeople(people, [{ ...ada, sentAt: null }], now);

  expect(decisionMakers.map(({ name }) => name)).toEqual(["ada"]);
  expect(alsoFound.map(({ name, reason }) => [name, reason])).toEqual([
    ["bob", "no-email"],
    ["cy", "in-cooldown"],
    ["dee", "not-chosen"],
  ]);
});
