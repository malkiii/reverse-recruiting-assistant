import { expect, test } from "vitest";
import { formatPay } from "./glassdoor-job-board";

test("Glassdoor's pay reads as a range with its period", () => {
  expect(formatPay({ currency: "USD", period: "ANNUAL", min: 100000, max: 215000 })).toBe("$100,000 – $215,000 / year");
  expect(formatPay({ currency: "EUR", period: "HOURLY", min: 25.5, max: 25.5 })).toBe("€25.50 / hour");
  expect(formatPay({ currency: "USD", min: 90000 })).toBe("$90,000");
});

test("Glassdoor's pay with no amount is no salary", () => {
  expect(formatPay(null)).toBeNull();
  expect(formatPay({ currency: "USD", period: "ANNUAL", min: 0, max: null })).toBeNull();
});
