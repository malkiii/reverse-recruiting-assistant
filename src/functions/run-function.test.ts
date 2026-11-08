import { expect, test } from "vitest";
import { FakeFunctionRunStore, FakeTelegram } from "../lib/fake-gateways";
import { runFunction } from "./run-function";

const startedAt = new Date("2026-11-01T12:00:00Z");
const finishedAt = new Date("2026-11-01T12:00:05Z");

async function setup() {
  const runs = new FakeFunctionRunStore();
  const runId = await runs.start("noop", startedAt, 60_000);
  return {
    runs,
    runId: runId!,
    now: () => finishedAt,
    telegram: new FakeTelegram(),
    dashboardUrl: "https://dashboard.example.com",
  };
}

test("a finished Function is recorded as succeeded with its finish time", async () => {
  const { runId, ...deps } = await setup();

  await runFunction(runId, "noop", async () => {}, deps);

  expect(await deps.runs.list()).toMatchObject([{ status: "succeeded", startedAt, finishedAt, error: null }]);
});

test("a Function that throws is recorded as failed with its error", async () => {
  const { runId, ...deps } = await setup();

  await runFunction(runId, "noop", async () => { throw new Error("boom"); }, deps);

  expect(await deps.runs.list()).toMatchObject([{ status: "failed", finishedAt, error: "boom" }]);
});

test("a Function that throws alerts the Admin with its name and a dashboard link", async () => {
  const { runId, ...deps } = await setup();

  await runFunction(runId, "noop", async () => { throw new Error("boom"); }, deps);

  expect(deps.telegram.messages).toEqual([
    {
      text: "🚨 <b>Function failed</b>\n\n⚙️ noop  ·  run #1\n🕒 01 Nov, 12:00 UTC\n\n❌ <code>boom</code>",
      link: { label: "🔎 View Activity", url: "https://dashboard.example.com/activity" },
      html: true,
    },
  ]);
});

test("a failure alert escapes the error and cuts a long one short", async () => {
  const { runId, ...deps } = await setup();

  await runFunction(runId, "noop", async () => { throw new Error(`<${"x".repeat(2000)}`); }, deps);

  const [{ text }] = deps.telegram.messages;
  expect(text).toContain(`<code>&lt;${"x".repeat(999)}…</code>`);
});

test("a finished Function sends no alert", async () => {
  const { runId, ...deps } = await setup();

  await runFunction(runId, "noop", async () => {}, deps);

  expect(deps.telegram.sent).toEqual([]);
});

test("a failed alert leaves the failure recorded and doesn't throw", async () => {
  const { runId, ...deps } = await setup();
  deps.telegram.failing = true;

  await runFunction(runId, "noop", async () => { throw new Error("boom"); }, deps);

  expect(await deps.runs.list()).toMatchObject([{ status: "failed", error: "boom" }]);
});

test("a failure that can't be recorded still alerts the Admin", async () => {
  const { runId, ...deps } = await setup();
  deps.runs.finish = async () => { throw new Error("database down"); };

  await expect(runFunction(runId, "noop", async () => { throw new Error("boom"); }, deps)).rejects.toThrow("database down");

  expect(deps.telegram.sent).toHaveLength(1);
});
