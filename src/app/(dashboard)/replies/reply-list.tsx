import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { Card, dateTime, EmptyState } from "@/components/ui";
import type { RecipientKey, Reply } from "@/lib/gateways";

/** The id of a recipient's Reply on the Replies page, so other pages can link to `/replies#<id>`. */
export const replyAnchor = ({ applicationId, decisionMakerId }: RecipientKey) => `reply-${applicationId}-${decisionMakerId}`;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether someone else, or the Decision Maker from another address, sent the Reply. */
const sentByOther = ({ fromName, fromEmail, decisionMakerName, decisionMakerEmail }: Reply) =>
  (fromName !== "" && !same(fromName, decisionMakerName)) || (decisionMakerEmail !== null && !same(fromEmail, decisionMakerEmail));

/**
 * Each Reply with its Decision Maker, its sender when that's someone else, the Application it replies to and the latest
 * message, in the order given.
 */
export function ReplyList({ replies, timeZone }: { replies: Reply[]; timeZone: string }) {
  if (replies.length === 0) {
    return (
      <EmptyState title="No Replies yet">The hourly Reply Check saves them as Decision Makers reply to your emails.</EmptyState>
    );
  }

  return (
    <Card>
      <ul className="divide-y divide-line">
        {replies.map((reply) => (
          <li key={replyAnchor(reply)} id={replyAnchor(reply)} className="flex scroll-mt-4 gap-3 px-4 py-3 target:bg-accent-soft">
            <Avatar name={reply.decisionMakerName} photo={reply.decisionMakerPhoto} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate font-medium">{reply.decisionMakerName}</p>
                <time dateTime={reply.receivedAt.toISOString()} className="shrink-0 text-xs text-faint">
                  {dateTime(reply.receivedAt, timeZone)}
                </time>
              </div>
              <p className="truncate text-sm text-muted">
                {sentByOther(reply) ? `Replied by ${reply.fromName || reply.fromEmail} (${reply.fromEmail})` : reply.fromEmail}
                {reply.decisionMakerHeadline && <> · {reply.decisionMakerHeadline}</>}
              </p>
              <Link
                href={`/applications/${reply.applicationId}`}
                className="block truncate text-sm text-muted hover:text-fg hover:underline"
              >
                {reply.jobTitle} at {reply.companyName}
              </Link>
              {/* Plain text: React escapes it, so HTML in an email never renders. */}
              <p className="mt-2 text-sm break-words whitespace-pre-wrap text-fg-2">{reply.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
