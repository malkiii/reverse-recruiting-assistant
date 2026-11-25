import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { Card, dateTime, EmptyState } from "@/components/ui";
import type { Reply } from "@/lib/gateways";

/** Each Reply with its sender, the Application it answers and their latest message, in the order given. */
export function ReplyList({ replies, timeZone }: { replies: Reply[]; timeZone: string }) {
  if (replies.length === 0) {
    return (
      <EmptyState title="No Replies yet">The hourly Reply Check saves them as Decision Makers answer your emails.</EmptyState>
    );
  }

  return (
    <Card>
      <ul className="divide-y divide-line">
        {replies.map((reply) => (
          <li
            key={`${reply.applicationId}-${reply.decisionMakerId}`}
            id={`reply-${reply.applicationId}-${reply.decisionMakerId}`}
            className="flex scroll-mt-4 gap-3 px-4 py-3 target:bg-accent-soft"
          >
            <Avatar name={reply.decisionMakerName} photo={reply.decisionMakerPhoto} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate font-medium">{reply.fromName || reply.decisionMakerName}</p>
                <time dateTime={reply.receivedAt.toISOString()} className="shrink-0 text-xs text-faint">
                  {dateTime(reply.receivedAt, timeZone)}
                </time>
              </div>
              <p className="truncate text-sm text-muted">
                {reply.fromEmail}
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
