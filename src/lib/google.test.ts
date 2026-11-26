import { expect, test } from "vitest";
import { threadMessage, withoutQuotedReply } from "./google";

const data = (text: string) => Buffer.from(text, "utf8").toString("base64url");

test("a reply is read with its sender, received time and plain text body", () => {
  expect(
    threadMessage({
      id: "reply-1",
      labelIds: ["INBOX", "UNREAD"],
      internalDate: String(Date.parse("2026-11-24T09:30:00Z")),
      payload: {
        mimeType: "multipart/alternative",
        headers: [{ name: "From", value: '"Jane Doe" <jane@acme.com>' }],
        parts: [
          { mimeType: "text/plain", body: { data: data("Thanks, let's talk.\n") } },
          { mimeType: "text/html", body: { data: data("<p>Thanks, let's talk.</p>") } },
        ],
      },
    }),
  ).toEqual({
    gmailMessageId: "reply-1",
    fromName: "Jane Doe",
    fromEmail: "jane@acme.com",
    receivedAt: new Date("2026-11-24T09:30:00Z"),
    text: "Thanks, let's talk.",
    fromAdmin: false,
  });
});

test("an HTML-only reply is read as text, and a bare address names the sender", () => {
  const message = threadMessage({
    id: "reply-1",
    internalDate: "0",
    payload: {
      mimeType: "text/html",
      headers: [{ name: "from", value: "jane@acme.com" }],
      body: { data: data("<div>Hi&nbsp;there<br>Jane &amp; co</div>") },
    },
  });

  expect(message).toMatchObject({ fromName: "jane@acme.com", fromEmail: "jane@acme.com", text: "Hi there\nJane & co" });
});

test("the Admin's sent messages and drafts are marked as theirs", () => {
  const payload = { headers: [{ name: "From", value: "Admin <admin@example.com>" }] };

  expect(threadMessage({ id: "1", labelIds: ["SENT"], internalDate: "0", payload }).fromAdmin).toBe(true);
  expect(threadMessage({ id: "2", labelIds: ["DRAFT"], internalDate: "0", payload }).fromAdmin).toBe(true);
});

test("a Gmail reply leaves out the quoted email and its wrapped attribution", () => {
  const text = [
    "Yes, received.",
    "",
    "On Thu, 26 Nov 2026 at 11:18, Malki Abderrahmane <admin@example.com>",
    "wrote:",
    "",
    "> Hi,",
    ">",
    "> This is a test email.",
    ">",
  ].join("\r\n");

  expect(withoutQuotedReply(text)).toBe("Yes, received.");
});

test("a reply's own lines just above an attribution are kept", () => {
  expect(withoutQuotedReply("Thanks!\nSee you Monday.\nLe jeu. 26 nov. 2026, Admin a écrit :\n> Hi")).toBe(
    "Thanks!\nSee you Monday.",
  );
});

test("an Outlook reply leaves out the original message", () => {
  expect(withoutQuotedReply("Sounds good.\n\n-----Original Message-----\nFrom: Admin\nSent: Thursday")).toBe("Sounds good.");
  expect(withoutQuotedReply("Sounds good.\n\n________________________________\nFrom: Admin")).toBe("Sounds good.");
});

test("a reply that is only a quote, or has none, is kept whole", () => {
  expect(withoutQuotedReply("> Hi")).toBe("> Hi");
  expect(withoutQuotedReply("  Thanks, let's talk.\n")).toBe("Thanks, let's talk.");
});

test("an HTML-only reply leaves out its Gmail quote", () => {
  const message = threadMessage({
    id: "reply-1",
    internalDate: "0",
    payload: {
      mimeType: "text/html",
      headers: [{ name: "From", value: "jane@acme.com" }],
      body: {
        data: data('<div>Yes, received.</div><br><div class="gmail_quote"><div class="gmail_attr">On Thu wrote:</div><blockquote>Hi</blockquote></div>'),
      },
    },
  });

  expect(message.text).toBe("Yes, received.");
});
