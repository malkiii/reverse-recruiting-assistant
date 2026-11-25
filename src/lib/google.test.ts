import { expect, test } from "vitest";
import { threadMessage } from "./google";

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
