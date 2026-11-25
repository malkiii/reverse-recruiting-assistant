import { revalidatePath } from "next/cache";
import { connection } from "next/server";
import { AutoRefresh } from "@/components/auto-refresh";
import { SubmitButton } from "@/components/submit-button";
import { Alert, PageHeader } from "@/components/ui";
import { startFunction } from "@/lib/dashboard-functions";
import { drizzleFunctionRunStore, drizzleReplyStore } from "@/lib/drizzle";
import { parseDashboardEnv } from "@/lib/env";
import { isReplyCheckActive } from "@/lib/reply-check";
import { CHECK_REPLIES } from "@/lib/schema";
import { ReplyList } from "./reply-list";

async function startReplyCheck() {
  "use server";

  // 409 means one is already active, which the page shows after this refresh.
  await startFunction(CHECK_REPLIES);
  revalidatePath("/replies");
}

/** Every Reply on one page, so the Application page's `#reply-…` links always find theirs. */
export default async function RepliesPage() {
  await connection();
  const { DATABASE_URL, TIMEZONE } = parseDashboardEnv(process.env);
  const [replies, runs] = await Promise.all([
    drizzleReplyStore(DATABASE_URL).list(),
    drizzleFunctionRunStore(DATABASE_URL).list(),
  ]);
  const running = isReplyCheckActive(runs, new Date());

  return (
    <>
      {running && <AutoRefresh seconds={5} />}
      <PageHeader
        title="Replies"
        subtitle="Who replied to your emails, with their latest message, the most recent first"
        action={
          <form action={startReplyCheck}>
            <SubmitButton pendingText="Starting…" disabled={running}>
              {running ? "Checking…" : "Check Replies"}
            </SubmitButton>
          </form>
        }
      />
      {running && (
        <div className="mb-4">
          <Alert tone="info">A Reply Check is running. This page refreshes until it&apos;s done.</Alert>
        </div>
      )}
      <ReplyList replies={replies} timeZone={TIMEZONE} />
    </>
  );
}
