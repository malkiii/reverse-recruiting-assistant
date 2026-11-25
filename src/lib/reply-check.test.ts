import { expect, test } from "vitest";
import { FakeGmailReader, FakeReplyStore, FakeTelegram } from "./fake-gateways";
import type { ThreadMessage, WatchedThread } from "./gateways";
import { runReplyCheck } from "./reply-check";

const now = new Date("2026-11-25T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000);

const thread = (overrides: Partial<WatchedThread> = {}): WatchedThread => ({
  applicationId: 1,
  decisionMakerId: 10,
  gmailThreadId: "thread-1",
  sentAt: daysAgo(2),
  decisionMakerName: "Jane Doe",
  jobTitle: "Backend Engineer",
  companyName: "Acme",
  latestReplyMessageId: null,
  ...overrides,
});

const adminMessage: ThreadMessage = {
  gmailMessageId: "sent-1",
  fromName: "Admin",
  fromEmail: "admin@example.com",
  receivedAt: daysAgo(2),
  text: "Hi Jane, here is my Application.",
  fromAdmin: true,
};

const reply = (overrides: Partial<ThreadMessage> = {}): ThreadMessage => ({
  gmailMessageId: "reply-1",
  fromName: "Jane Doe",
  fromEmail: "jane@acme.com",
  receivedAt: daysAgo(1),
  text: "Thanks, let's talk on Monday.",
  fromAdmin: false,
  ...overrides,
});

function setup(threads: WatchedThread[] = [thread()]) {
  const replies = new FakeReplyStore();
  replies.watched = threads;
  const gmail = new FakeGmailReader();
  return {
    replies,
    gmail,
    gmailReader: async () => gmail,
    telegram: new FakeTelegram(),
    dashboardUrl: "https://dashboard.example.com",
    now: () => now,
  };
}

test("a reply in a sent email's thread is saved as the recipient's Reply", async () => {
  const deps = setup();
  deps.gmail.threads.set("thread-1", [adminMessage, reply()]);

  await runReplyCheck(deps);

  expect(await deps.replies.list()).toMatchObject([
    {
      applicationId: 1,
      decisionMakerId: 10,
      fromName: "Jane Doe",
      fromEmail: "jane@acme.com",
      receivedAt: daysAgo(1),
      text: "Thanks, let's talk on Monday.",
      gmailMessageId: "reply-1",
      decisionMakerName: "Jane Doe",
      jobTitle: "Backend Engineer",
      companyName: "Acme",
    },
  ]);
});

test("the Admin's own messages in the thread are never counted as replies", async () => {
  const deps = setup();
  deps.gmail.threads.set("thread-1", [adminMessage, { ...adminMessage, gmailMessageId: "sent-2", receivedAt: daysAgo(1) }]);

  await runReplyCheck(deps);

  expect(await deps.replies.list()).toEqual([]);
  expect(deps.telegram.sent).toEqual([]);
});

test("only threads emailed in the last 30 days are checked", async () => {
  const deps = setup([thread({ sentAt: daysAgo(29) }), thread({ decisionMakerId: 11, gmailThreadId: "thread-2", sentAt: daysAgo(31) })]);
  deps.gmail.threads.set("thread-1", [adminMessage, reply()]);
  deps.gmail.threads.set("thread-2", [adminMessage, reply({ gmailMessageId: "reply-2" })]);

  await runReplyCheck(deps);

  expect(deps.gmail.read).toEqual(["thread-1"]);
  expect((await deps.replies.list()).map(({ decisionMakerId }) => decisionMakerId)).toEqual([10]);
});

test("a new reply alerts the Admin with who replied, the Job, a preview and a link to the Replies tab", async () => {
  const deps = setup();
  deps.gmail.threads.set("thread-1", [adminMessage, reply({ text: "Thanks <3,\n\n  let's   talk on Monday." })]);

  await runReplyCheck(deps);

  expect(deps.telegram.messages).toEqual([
    {
      text: "💬 <b>New reply</b>\n\n👤 Jane Doe (jane@acme.com)\n💼 Backend Engineer\n🏢 Acme\n\n<i>Thanks &lt;3, let's talk on Monday.</i>",
      link: { label: "💬 See Replies", url: "https://dashboard.example.com/replies" },
      html: true,
    },
  ]);
});

test("a long reply's preview is cut short", async () => {
  const deps = setup();
  deps.gmail.threads.set("thread-1", [adminMessage, reply({ text: "x".repeat(500) })]);

  await runReplyCheck(deps);

  const [{ text }] = deps.telegram.messages;
  expect(text).toContain(`<i>${"x".repeat(200)}…</i>`);
});

test("a reply is alerted once, never again on later runs", async () => {
  const deps = setup();
  deps.gmail.threads.set("thread-1", [adminMessage, reply()]);

  await runReplyCheck(deps);
  await runReplyCheck(deps);

  expect(deps.telegram.sent).toHaveLength(1);
});

test("a newer reply in the thread replaces the stored one and is alerted", async () => {
  const deps = setup();
  deps.gmail.threads.set("thread-1", [adminMessage, reply()]);
  await runReplyCheck(deps);

  deps.gmail.threads.set("thread-1", [
    adminMessage,
    reply(),
    reply({ gmailMessageId: "reply-2", receivedAt: daysAgo(0.5), text: "Monday 10am works." }),
  ]);
  await runReplyCheck(deps);

  expect(await deps.replies.list()).toMatchObject([{ gmailMessageId: "reply-2", text: "Monday 10am works." }]);
  expect(deps.telegram.sent).toHaveLength(2);
  expect(deps.telegram.sent[1]).toContain("Monday 10am works.");
});

test("a Gmail error on one thread doesn't stop the others, and fails the run", async () => {
  const deps = setup([thread(), thread({ decisionMakerId: 11, gmailThreadId: "thread-2" })]);
  deps.gmail.failing.add("thread-1");
  deps.gmail.threads.set("thread-2", [adminMessage, reply({ gmailMessageId: "reply-2" })]);

  await expect(runReplyCheck(deps)).rejects.toThrow("thread-1");

  expect((await deps.replies.list()).map(({ decisionMakerId }) => decisionMakerId)).toEqual([11]);
  expect(deps.telegram.sent).toHaveLength(1);
});

test("a reply whose alert failed is alerted on the next run", async () => {
  const deps = setup();
  deps.gmail.threads.set("thread-1", [adminMessage, reply()]);
  deps.telegram.failing = true;
  await expect(runReplyCheck(deps)).rejects.toThrow("Telegram is down");

  deps.telegram.failing = false;
  await runReplyCheck(deps);

  expect(deps.telegram.sent).toHaveLength(1);
});

test("with no thread to check, Google isn't asked for access", async () => {
  const deps = setup([]);
  deps.gmailReader = async () => {
    throw new Error("Google isn't connected");
  };

  await runReplyCheck(deps);

  expect(deps.telegram.sent).toEqual([]);
});
