import type { FunctionRun, GmailReader, ReplyStore, WatchedThread } from "./gateways";
import { GoogleConnectionError } from "./google-connection";
import { CHECK_REPLIES } from "./schema";

export const REPLY_CHECK_TIME_LIMIT_MS = 10 * 60_000;

/** How long a sent email's thread is watched for replies, the same as the Cooldown. */
export const REPLY_WATCH_DAYS = 30;

const DAY_MS = 24 * 60 * 60_000;

export type ReplyCheckDeps = {
  replies: ReplyStore;
  /** Only asked for when there is a thread to read. */
  gmailReader: () => Promise<GmailReader>;
  now: () => Date;
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The Reply Check, run by the Admin: reads the Gmail thread of every email sent in the last 30 days and saves each
 * recipient's latest reply. A failed thread doesn't stop the others; it fails the run once all are done. When Google
 * needs reconnecting, no thread is read and the run doesn't fail.
 */
export async function runReplyCheck(deps: ReplyCheckDeps) {
  const { replies, now } = deps;
  const errors: string[] = [];
  const watched = await replies.listWatched(new Date(now().getTime() - REPLY_WATCH_DAYS * DAY_MS));
  console.log(`Checking ${watched.length} Gmail thread(s) for replies`);

  const gmail = watched.length > 0 ? await gmailReaderUnlessDisconnected(deps) : undefined;
  if (gmail) {
    for (const thread of watched) {
      try {
        await checkThread(gmail, replies, thread);
      } catch (error) {
        console.error(`Gmail thread ${thread.gmailThreadId}: failed:`, error);
        errors.push(`Gmail thread ${thread.gmailThreadId}: ${message(error)}`);
      }
    }
  }

  console.log(`Reply Check finished with ${errors.length} error(s)`);
  if (errors.length > 0) throw new Error(errors.join("; "));
}

export function isReplyCheckActive(runs: FunctionRun[], now: Date) {
  return runs.some(
    ({ functionName, status, startedAt }) =>
      functionName === CHECK_REPLIES &&
      status === "running" &&
      now.getTime() - startedAt.getTime() < REPLY_CHECK_TIME_LIMIT_MS,
  );
}

/** Undefined when Google needs reconnecting, such as for a missing scope. */
async function gmailReaderUnlessDisconnected(deps: ReplyCheckDeps) {
  try {
    return await deps.gmailReader();
  } catch (error) {
    if (!(error instanceof GoogleConnectionError)) throw error;
    console.warn(`Skipping the Gmail threads, Google needs reconnecting: ${error.message}`);
    return undefined;
  }
}

/** Saves the thread's latest message not sent by the Admin, unless it is already the saved Reply. */
async function checkThread(gmail: GmailReader, replies: ReplyStore, thread: WatchedThread) {
  // Oldest first, so the last one is the latest.
  const latest = (await gmail.readThread(thread.gmailThreadId)).filter(({ fromAdmin }) => !fromAdmin).at(-1);
  if (!latest || latest.gmailMessageId === thread.latestReplyMessageId) return;
  const { fromAdmin: _fromAdmin, ...reply } = latest;
  await replies.save(thread, reply);
  console.log(`Application ${thread.applicationId}: new reply from ${reply.fromEmail}`);
}
