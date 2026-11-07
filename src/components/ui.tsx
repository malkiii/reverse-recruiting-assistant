import Link from "next/link";
import type { ReactNode } from "react";
import type { ApplicationStatus } from "@/lib/gateways";
import { sourceName, sourceTone, STATUS_LABELS, statusTone } from "./status";
import { TableLink } from "./table-transition";

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

export const linkClass = "font-medium text-accent underline-offset-4 hover:underline";

/** A link off the dashboard. Opens in a new browser tab. */
export function ExternalLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

export const inputClass =
  "block w-full rounded-sm border border-line-strong bg-bg px-3 py-2 text-base text-fg outline-none transition placeholder:text-faint hover:border-faint focus:border-accent focus:ring-2 focus:ring-accent-soft sm:text-sm";

export const labelClass = "mb-1.5 block text-xs font-medium text-muted";

export const checkboxClass = "size-4 rounded-xs accent-accent";

export const percent = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

/** A calendar day such as a post day (YYYY-MM-DD), or the day a moment falls on in the timezone. */
export const shortDate = (date: Date | string, timeZone: string) =>
  typeof date === "string"
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`))
    : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone }).format(date);

export const dateTime = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone }).format(date);

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cx(
        "overflow-hidden rounded-md border border-line bg-surface",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2">
      <h2 className="text-[13px] font-medium">{title}</h2>
      {action}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("px-4 py-4", className)}>{children}</div>;
}

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-xs px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        statusTone(status).badge,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** A Job's source as a rounded label. */
export function SourceBadge({ source }: { source: string }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        sourceTone(source),
      )}
    >
      {sourceName(source)}
    </span>
  );
}

export function Tag({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "amber" | "emerald" }) {
  const tones = {
    slate: "bg-subtle text-fg-2",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  };
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded-xs px-1.5 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

export function Alert({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "warning" | "info" }) {
  const tones = {
    error: "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300",
    warning:
      "border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-200",
    info: "border-accent/30 bg-accent-soft text-fg",
  };
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={cx("rounded-md border px-4 py-3 text-sm break-words", tones[tone])}
    >
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line-strong px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function StatTile({ label, value, href }: { label: string; value: ReactNode; href?: string }) {
  const body = (
    <>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-2 font-mono text-2xl font-medium tracking-tight tabular-nums">{value}</p>
    </>
  );
  const className =
    "block rounded-md border border-line bg-surface p-4";
  return href ? (
    <Link
      href={href}
      className={cx(className, "transition hover:border-line-strong hover:bg-subtle")}
    >
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** Label and value rows, such as a Company's details. */
export function DetailList({ items }: { items: [label: string, value: ReactNode][] }) {
  return (
    <dl className="divide-y divide-line">
      {items.map(([label, value]) => (
        <div key={label} className="grid grid-cols-3 gap-3 px-4 py-3 text-sm">
          <dt className="text-muted">{label}</dt>
          <dd className="col-span-2 min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Previous and Next links under a table, with where the page is. Hidden when everything fits on one page. */
export function Pagination({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  if (pages <= 1) return null;
  const linkClassName =
    "inline-flex h-8 items-center rounded-sm border border-line bg-surface px-3 text-[13px] font-medium transition hover:border-line-strong hover:bg-subtle";
  const disabledClassName = "inline-flex h-8 items-center rounded-sm border border-line px-3 text-[13px] font-medium text-faint";
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3">
      {page > 1 ? (
        <TableLink href={href(page - 1)} className={linkClassName}>
          ‹ Previous
        </TableLink>
      ) : (
        <span aria-disabled="true" className={disabledClassName}>
          ‹ Previous
        </span>
      )}
      <span className="text-sm text-muted tabular-nums">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <TableLink href={href(page + 1)} className={linkClassName}>
          Next ›
        </TableLink>
      ) : (
        <span aria-disabled="true" className={disabledClassName}>
          Next ›
        </span>
      )}
    </nav>
  );
}

export const segmentClass = (active: boolean) =>
  cx(
    "inline-flex h-8 items-center gap-1.5 rounded-xs px-3 text-[13px] font-medium whitespace-nowrap transition",
    active ? "bg-subtle text-fg ring-1 ring-line-strong" : "text-muted hover:text-fg",
  );

/** A horizontal row of options, each a link, such as status filters or stats ranges. */
export function Segmented({
  options,
  label,
  inline = false,
}: {
  label: string;
  options: { href: string; label: ReactNode; active: boolean }[];
  /** Sits inside a row, such as a page header's action, instead of on its own line. */
  inline?: boolean;
}) {
  return (
    <nav
      aria-label={label}
      className={inline ? undefined : "-mx-4 mb-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0"}
    >
      <ul className="flex w-max gap-0.5 rounded-sm border border-line bg-surface p-0.5">
        {/* Keyed by position: two options can share an href, such as "All sources" and the only chosen source. */}
        {options.map((option, index) => (
          <li key={index}>
            <Link
              href={option.href}
              replace
              scroll={false}
              aria-current={option.active ? "page" : undefined}
              className={segmentClass(option.active)}
            >
              {option.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
