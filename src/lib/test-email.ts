// Backs the Test Email page, which checks email tracking end to end.
import { and, eq, inArray } from "drizzle-orm";
import { client } from "./drizzle";
import type { GmailGateway } from "./gateways";
import { applicationRecipients, applications, companies, decisionMakers, jobs, replies, stepLogs } from "./schema";

const TEST_JOB_URL = "https://example.com/test-email-job";
const TEST_COMPANY_URL = "https://www.linkedin.com/company/test-email-company";
const TEST_COMPANY = "Test Email Co";
const TEST_PERSON = "Test Recipient";

/** The test Job, Application and Decision Maker, created on first use, with the Decision Maker's email set to `to`. */
async function testRecipient(databaseUrl: string, to: string, now: Date) {
  return client(databaseUrl).transaction(async (tx) => {
    const [company] = await tx
      .insert(companies)
      .values({ linkedinUrl: TEST_COMPANY_URL, name: TEST_COMPANY })
      .onConflictDoUpdate({ target: companies.linkedinUrl, set: { name: TEST_COMPANY } })
      .returning({ id: companies.id });

    const [job] = await tx
      .insert(jobs)
      .values({
        source: "test",
        title: "Test Email Job",
        companyName: TEST_COMPANY,
        location: "Remote",
        url: TEST_JOB_URL,
        postDay: now.toISOString().slice(0, 10),
        companyLinkedinUrl: TEST_COMPANY_URL,
      })
      .onConflictDoUpdate({ target: jobs.url, set: { source: "test" } })
      .returning({ id: jobs.id });

    const [application] = await tx
      .insert(applications)
      .values({ jobId: job.id, status: "sent", currentStep: "send", companyId: company.id, createdAt: now })
      .onConflictDoUpdate({ target: applications.jobId, set: { status: "sent" } })
      .returning({ id: applications.id });

    const [person] = await tx
      .insert(decisionMakers)
      .values({
        companyId: company.id,
        name: TEST_PERSON,
        headline: "Test inbox for email tracking",
        profileUrl: "https://www.linkedin.com/in/test-recipient",
        email: to,
        jobFunction: "any",
        foundAt: now,
      })
      .onConflictDoUpdate({ target: [decisionMakers.companyId, decisionMakers.name], set: { email: to } })
      .returning({ id: decisionMakers.id });

    await tx
      .insert(applicationRecipients)
      .values({ applicationId: application.id, decisionMakerId: person.id })
      .onConflictDoNothing();
    // A new test email starts a new thread, so the old thread's Reply no longer applies.
    await tx
      .delete(replies)
      .where(and(eq(replies.applicationId, application.id), eq(replies.decisionMakerId, person.id)));

    return { applicationId: application.id, decisionMakerId: person.id };
  });
}

/** Sends a test email to `to` and records its Gmail thread, so Check Replies watches it like a real one. */
export async function sendTestEmail(databaseUrl: string, gmail: GmailGateway, to: string, now = new Date()) {
  const { applicationId, decisionMakerId } = await testRecipient(databaseUrl, to, now);
  const sent = await gmail.send({
    to,
    subject: `Email tracking test (${now.toISOString()})`,
    body: [
      "Hi,",
      "",
      "This is a test email from Reverse Recruiting, to check that replies are tracked.",
      "Reply to it, then click Check Replies on the Replies page.",
      "",
      `Sent at ${now.toISOString()}.`,
    ].join("\n"),
  });
  await client(databaseUrl).transaction(async (tx) => {
    await tx
      .update(applicationRecipients)
      .set({ sentAt: now, gmailMessageId: sent.messageId, gmailThreadId: sent.threadId })
      .where(
        and(
          eq(applicationRecipients.applicationId, applicationId),
          eq(applicationRecipients.decisionMakerId, decisionMakerId),
        ),
      );
    await tx.update(decisionMakers).set({ lastEmailedAt: now }).where(eq(decisionMakers.id, decisionMakerId));
  });
  return sent;
}

/** Deletes the test Company, Job, Application, Decision Maker and their Reply. */
export async function deleteTestRecords(databaseUrl: string) {
  await client(databaseUrl).transaction(async (tx) => {
    const [job] = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.url, TEST_JOB_URL));
    const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.linkedinUrl, TEST_COMPANY_URL));
    if (job) {
      const ids = (await tx.select({ id: applications.id }).from(applications).where(eq(applications.jobId, job.id))).map(
        ({ id }) => id,
      );
      if (ids.length > 0) {
        // Replies go with their recipients, by cascade.
        await tx.delete(applicationRecipients).where(inArray(applicationRecipients.applicationId, ids));
        await tx.delete(stepLogs).where(inArray(stepLogs.applicationId, ids));
        await tx.delete(applications).where(inArray(applications.id, ids));
      }
      await tx.delete(jobs).where(eq(jobs.id, job.id));
    }
    if (company) {
      await tx.delete(decisionMakers).where(eq(decisionMakers.companyId, company.id));
      await tx.delete(companies).where(eq(companies.id, company.id));
    }
  });
}

/** The test recipient's latest send, for the page. Undefined before the first send. */
export async function testEmailStatus(databaseUrl: string) {
  const [row] = await client(databaseUrl)
    .select({
      applicationId: applicationRecipients.applicationId,
      email: decisionMakers.email,
      sentAt: applicationRecipients.sentAt,
      gmailThreadId: applicationRecipients.gmailThreadId,
      replyFrom: replies.fromEmail,
      replyAt: replies.receivedAt,
      replyText: replies.text,
    })
    .from(applicationRecipients)
    .innerJoin(decisionMakers, eq(decisionMakers.id, applicationRecipients.decisionMakerId))
    .innerJoin(applications, eq(applications.id, applicationRecipients.applicationId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(
      replies,
      and(
        eq(replies.applicationId, applicationRecipients.applicationId),
        eq(replies.decisionMakerId, applicationRecipients.decisionMakerId),
      ),
    )
    .where(eq(jobs.url, TEST_JOB_URL));
  return row;
}
