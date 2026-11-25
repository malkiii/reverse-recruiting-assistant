import type { GmailReader, Reply, ReplyStore, TelegramGateway } from "./gateways";
import { escapeHtml } from "./telegram";

export const REPLY_CHECK_TIME_LIMIT_MS = 10 * 60_000;

/** How long a sent email's thread is watched for replies, the same as the Cooldown. */
export const REPLY_WATCH_DAYS = 30;

const PREVIEW_LENGTH = 200;
const DAY_MS = 24 * 60 * 60_000;

export type ReplyCheckDeps = {
  replies: ReplyStore;
  /** Only asked for when there is a thread to read. */
  gmailReader: () => Promise<GmailReader>;
  telegram: TelegramGateway;
  dashboardUrl: string;
  now: () => Date;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const preview = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH)}…` : flat;
};

const replyAlert = ({ fromName, fromEmail, jobTitle, companyName, text }: Reply) =>
  [
    "💬 <b>New reply</b>",
    `👤 ${escapeHtml(fromName)} (${escapeHtml(fromEmail)})\n💼 ${escapeHtml(jobTitle)}\n🏢 ${escapeHtml(companyName)}`,
    `<i>${escapeHtml(preview(text))}</i>`,
  ].join("\n\n");

/**
 * The Reply Check: reads the Gmail thread of every email sent in the last 30 days, saves each recipient's latest reply,
 * then alerts the Admin of each new one. A failed thread or alert doesn't stop the others; it fails the run once all are
 * done, and an unsent alert is retried on the next run.
 */
export async function runReplyCheck(deps: ReplyCheckDeps) {
  const { replies, now } = deps;
  const errors: string[] = [];
  const watched = await replies.listWatched(new Date(now().getTime() - REPLY_WATCH_DAYS * DAY_MS));
  console.log(`Checking ${watched.length} Gmail thread(s) for replies`);

  if (watched.length > 0) {
    const gmail = await deps.gmailReader();
    for (const thread of watched) {
      try {
        const messages = await gmail.readThread(thread.gmailThreadId);
        const latest = messages
          .filter(({ fromAdmin }) => !fromAdmin)
          .reduce<(typeof messages)[number] | undefined>(
            (newest, message) => (!newest || message.receivedAt > newest.receivedAt ? message : newest),
            undefined,
          );
        if (!latest || latest.gmailMessageId === thread.latestReplyMessageId) continue;
        const { fromAdmin: _fromAdmin, ...reply } = latest;
        await replies.save(thread.applicationId, thread.decisionMakerId, reply);
        console.log(`Application ${thread.applicationId}: new reply from ${reply.fromEmail}`);
      } catch (error) {
        console.error(`Gmail thread ${thread.gmailThreadId}: failed:`, error);
        errors.push(`Gmail thread ${thread.gmailThreadId}: ${message(error)}`);
      }
    }
  }

  await sendReplyAlerts(deps, errors);

  console.log(`Reply Check finished with ${errors.length} error(s)`);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

async function sendReplyAlerts({ replies, telegram, dashboardUrl, now }: ReplyCheckDeps, errors: string[]) {
  const link = { label: "💬 See Replies", url: new URL("/replies", dashboardUrl).toString() };
  const pending = await replies.listPendingAlerts();
  for (const reply of pending) {
    try {
      await telegram.sendHtml(replyAlert(reply), link);
    } catch (error) {
      // Left pending, so the next Reply Check retries it.
      console.error(`Reply Alert for ${reply.fromEmail}: failed:`, error);
      errors.push(`Reply Alert for ${reply.fromEmail}: ${message(error)}`);
      continue;
    }
    await replies.markAlerted(reply.applicationId, reply.decisionMakerId, reply.gmailMessageId, now());
  }
}
