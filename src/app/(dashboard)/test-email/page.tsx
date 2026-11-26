// Sends a test email and shows whether its reply is tracked. Reached from the Replies page.
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SubmitButton } from "@/components/submit-button";
import { Alert, Card, CardBody, DetailList, PageHeader, inputClass, labelClass } from "@/components/ui";
import { dashboardGoogle } from "@/lib/dashboard-google";
import { parseDashboardEnv } from "@/lib/env";
import { googleGmail } from "@/lib/google";
import { googleAccessToken } from "@/lib/google-connection";
import { deleteTestRecords, sendTestEmail, testEmailStatus } from "@/lib/test-email";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function send(formData: FormData) {
  "use server";

  const to = String(formData.get("to") ?? "").trim();
  let result = "sent=1";
  try {
    if (!to.includes("@")) throw new Error("Enter an email address");
    const { DATABASE_URL } = parseDashboardEnv(process.env);
    const gmail = googleGmail(await googleAccessToken(dashboardGoogle().connection));
    await sendTestEmail(DATABASE_URL, gmail, to);
  } catch (error) {
    result = `error=${encodeURIComponent(message(error))}`;
  }
  redirect(`/test-email?${result}`);
}

async function remove() {
  "use server";

  const { DATABASE_URL } = parseDashboardEnv(process.env);
  await deleteTestRecords(DATABASE_URL);
  redirect("/test-email?deleted=1");
}

export default async function TestEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; deleted?: string; error?: string }>;
}) {
  await connection();
  const { DATABASE_URL, TIMEZONE } = parseDashboardEnv(process.env);
  const [{ sent, deleted, error }, status] = await Promise.all([searchParams, testEmailStatus(DATABASE_URL)]);
  const time = (date: Date | null) => (date ? date.toLocaleString("en-GB", { timeZone: TIMEZONE }) : "—");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Test Email"
        subtitle="Sends a test email you can reply to, to check that Check Replies finds the reply"
      />
      {error && <Alert>{error}</Alert>}
      {sent && <Alert tone="info">Sent. Reply to it from that inbox, then click Check Replies on the Replies page.</Alert>}
      {deleted && <Alert tone="info">The test records are deleted.</Alert>}

      <Card>
        <CardBody>
          <form action={send} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="to" className={labelClass}>
                Send to
              </label>
              <input
                id="to"
                type="email"
                name="to"
                required
                defaultValue={status?.email ?? ""}
                placeholder="you@example.com"
                className={inputClass}
              />
            </div>
            <SubmitButton pendingText="Sending…">Send test email</SubmitButton>
          </form>
          <p className="mt-2 text-xs text-faint">Sends even while Sending is turned off in Settings.</p>
        </CardBody>
      </Card>

      {status && (
        <Card>
          <CardBody className="space-y-4">
            <DetailList
              items={[
                ["Sent to", status.email ?? "—"],
                ["Sent at", time(status.sentAt)],
                ["Gmail thread", status.gmailThreadId ?? "—"],
                ["Reply from", status.replyFrom ?? "No reply saved yet"],
                ["Reply at", time(status.replyAt)],
                ["Reply text", status.replyText ? <span className="whitespace-pre-wrap">{status.replyText}</span> : "—"],
                [
                  "Application",
                  <Link key="app" href={`/applications/${status.applicationId}`} className="text-accent hover:underline">
                    Open the test Application
                  </Link>,
                ],
              ]}
            />
            <form action={remove}>
              <SubmitButton variant="danger" pendingText="Deleting…" confirm="Delete the test Job, Application, Decision Maker and Reply?">
                Delete test records
              </SubmitButton>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
