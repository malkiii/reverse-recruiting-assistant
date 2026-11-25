import { connection } from "next/server";
import { PageHeader } from "@/components/ui";
import { drizzleReplyStore } from "@/lib/drizzle";
import { parseDashboardEnv } from "@/lib/env";
import { ReplyList } from "./reply-list";

/** Every Reply on one page, so the Application page's `#reply-…` links always find theirs. */
export default async function RepliesPage() {
  await connection();
  const { DATABASE_URL, TIMEZONE } = parseDashboardEnv(process.env);
  const replies = await drizzleReplyStore(DATABASE_URL).list();

  return (
    <>
      <PageHeader title="Replies" subtitle="Who answered your emails, with their latest message, the most recent first" />
      <ReplyList replies={replies} timeZone={TIMEZONE} />
    </>
  );
}
