import { expect, test } from "vitest";
import { saveFilters, tabHref } from "./saved-filters";

const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
};

test("a tab's link brings back the filters last used on it, without the page", () => {
  const storage = memoryStorage();
  saveFilters(storage, "/jobs", new URLSearchParams("q=engineer&source=LinkedIn&source=Indeed&page=3"), null);
  expect(tabHref(storage, "/jobs")).toBe("/jobs?q=engineer&source=LinkedIn&source=Indeed");
  expect(tabHref(storage, "/applications")).toBe("/applications");
});

test("clearing a tab's filters on that tab forgets them", () => {
  const storage = memoryStorage();
  saveFilters(storage, "/stats", new URLSearchParams("range=7d"), "/jobs");
  saveFilters(storage, "/stats", new URLSearchParams(), "/stats");
  expect(tabHref(storage, "/stats")).toBe("/stats");
});

test("opening a tab without filters from elsewhere, or on reload, keeps its filters", () => {
  const storage = memoryStorage();
  saveFilters(storage, "/jobs", new URLSearchParams("q=engineer"), null);
  saveFilters(storage, "/jobs", new URLSearchParams(), "/applications");
  saveFilters(storage, "/jobs", new URLSearchParams("page=2"), null);
  expect(tabHref(storage, "/jobs")).toBe("/jobs?q=engineer");
});

test("only the Jobs, Applications and Stats tabs keep filters", () => {
  const storage = memoryStorage();
  saveFilters(storage, "/applications/12", new URLSearchParams("tab=logs"), null);
  saveFilters(storage, "/settings", new URLSearchParams("q=x"), null);
  expect(tabHref(storage, "/applications")).toBe("/applications");
  expect(tabHref(storage, "/settings")).toBe("/settings");
});

test("tabs still work when the browser blocks storage", () => {
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  expect(() => saveFilters(blocked, "/jobs", new URLSearchParams("q=x"), null)).not.toThrow();
  expect(tabHref(blocked, "/jobs")).toBe("/jobs");
});
