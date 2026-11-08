import type { FunctionRunStore, TelegramGateway } from "../lib/gateways";
import { escapeHtml } from "../lib/telegram";

// Keeps the alert well under Telegram's 4096-character limit; the full error is on the dashboard.
const MAX_ALERT_ERROR_LENGTH = 1000;

const utcTime = (date: Date) =>
  `${date.toLocaleString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })}, ${date.toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" })} UTC`;

const truncate = (text: string) => (text.length > MAX_ALERT_ERROR_LENGTH ? `${text.slice(0, MAX_ALERT_ERROR_LENGTH)}…` : text);

const failureAlert = (functionName: string, runId: number, at: Date, error: string) =>
  [
    "🚨 <b>Function failed</b>",
    `⚙️ ${escapeHtml(functionName)}  ·  run #${runId}\n🕒 ${utcTime(at)}`,
    `❌ <code>${escapeHtml(truncate(error))}</code>`,
  ].join("\n\n");

type RunDeps = { runs: FunctionRunStore; telegram: TelegramGateway; dashboardUrl: string; now: () => Date };

export async function runFunction(runId: number, functionName: string, work: () => Promise<void>, deps: RunDeps) {
  const { runs, telegram, dashboardUrl, now } = deps;
  const startedAt = now();
  const elapsed = () => `${Math.round((now().getTime() - startedAt.getTime()) / 1000)}s`;
  console.log(`Function ${functionName} run ${runId} started`);
  try {
    await work();
    await runs.finish(runId, { status: "succeeded", finishedAt: now(), error: null });
    console.log(`Function ${functionName} run ${runId} succeeded after ${elapsed()}`);
  } catch (error) {
    console.error(`Function ${functionName} run ${runId} failed after ${elapsed()}:`, error);
    const message = error instanceof Error ? error.message : String(error);
    try {
      await runs.finish(runId, { status: "failed", finishedAt: now(), error: message });
    } finally {
      const link = new URL("/activity", dashboardUrl);
      // A Telegram outage only costs the alert, and must not replace the failure itself.
      await telegram
        .sendHtml(failureAlert(functionName, runId, now(), message), { label: "🔎 View Activity", url: link.toString() })
        .catch(console.error);
    }
  }
}
