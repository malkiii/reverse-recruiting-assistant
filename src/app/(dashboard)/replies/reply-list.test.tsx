import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Reply } from "@/lib/gateways";
import { ReplyList } from "./reply-list";

const reply = (overrides: Partial<Reply> = {}): Reply => ({
  applicationId: 7,
  decisionMakerId: 10,
  gmailMessageId: "reply-1",
  fromName: "Jane Doe",
  fromEmail: "jane@acme.com",
  receivedAt: new Date("2026-11-24T09:30:00Z"),
  text: "Thanks, let's talk on Monday.",
  alertedAt: null,
  decisionMakerName: "Jane Doe",
  decisionMakerEmail: "jane@acme.com",
  decisionMakerHeadline: "CTO at Acme",
  decisionMakerPhoto: null,
  jobTitle: "Backend Engineer",
  companyName: "Acme",
  ...overrides,
});

const render = (replies: Reply[]) => renderToStaticMarkup(<ReplyList replies={replies} timeZone="UTC" />);

test("each Reply shows its sender, Job, Company and latest message, linked to its Application", () => {
  const html = render([reply()]);

  expect(html).toContain("Jane Doe");
  expect(html).toContain("jane@acme.com");
  expect(html).toContain("CTO at Acme");
  expect(html).toContain('href="/applications/7"');
  expect(html).toContain("Backend Engineer");
  expect(html).toContain("Acme");
  expect(html).toContain("Thanks, let&#x27;s talk on Monday.");
  expect(html).toContain("Nov 24");
  expect(html).not.toContain("Replied by");
});

test("a Reply sent by someone other than the Decision Maker shows both", () => {
  const html = render([reply({ fromName: "Sam Assistant", fromEmail: "sam@acme.com" })]);

  expect(html).toContain("Jane Doe");
  expect(html).toContain("Replied by Sam Assistant (sam@acme.com)");
});

test("a Reply from another address of the Decision Maker shows the sender", () => {
  const html = render([reply({ fromEmail: "jane.doe@gmail.com" })]);

  expect(html).toContain("Replied by Jane Doe (jane.doe@gmail.com)");
});

test("a Reply sent with no name still shows the Decision Maker's", () => {
  const html = render([reply({ fromName: "" })]);

  expect(html).toContain("Jane Doe");
  expect(html).not.toContain("Replied by");
});

test("each Reply can be linked to by its Application and Decision Maker", () => {
  expect(render([reply()])).toContain('id="reply-7-10"');
});

test("Replies keep the order they're given, newest first", () => {
  const html = render([
    reply({ applicationId: 2, jobTitle: "Newest Job" }),
    reply({ applicationId: 1, jobTitle: "Older Job", receivedAt: new Date("2026-11-20T09:00:00Z") }),
  ]);

  expect(html.indexOf("Newest Job")).toBeLessThan(html.indexOf("Older Job"));
});

test("HTML in an email's message or sender is shown as text, never rendered", () => {
  const html = render([reply({ text: '<script>alert("x")</script><b>hi</b>', fromName: "<img src=x onerror=alert(1)>" })]);

  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<b>");
  expect(html).not.toContain("<img src=x");
  expect(html).toContain("&lt;script&gt;");
});

test("with no Replies, an empty state says so", () => {
  expect(render([])).toContain("No Replies yet");
});
