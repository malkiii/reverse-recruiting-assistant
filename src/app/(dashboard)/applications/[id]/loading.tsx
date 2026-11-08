import Link from "next/link";
import type { ReactNode } from "react";

const block = "animate-pulse rounded-md bg-subtle";

function CardSkeleton({ rows, children }: { rows?: number; children?: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex min-h-12 items-center border-b border-line px-4">
        <div className={`${block} h-4 w-32`} />
      </div>
      {children ?? (
        <ul className="divide-y divide-line">
          {Array.from({ length: rows ?? 2 }, (_, index) => (
            <li key={index} className="flex items-start gap-3 px-4 py-3">
              <div className={`${block} size-10 shrink-0 rounded-full`} />
              <div className="flex-1 space-y-2">
                <div className={`${block} h-4 w-40`} />
                <div className={`${block} h-3 w-56 max-w-full`} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Shown the moment the Admin opens an Application, shaped like its page, until its data is in. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Link href="/applications" className="inline-flex min-h-9 items-center text-sm text-muted hover:text-fg">
        ‹ Applications
      </Link>

      <header className="space-y-2">
        <div className={`${block} h-6 w-24 rounded-full`} />
        <div className={`${block} h-7 w-3/4 sm:h-8`} />
        <div className={`${block} h-4 w-1/2`} />
      </header>

      <CardSkeleton>
        <div className="space-y-3 px-4 py-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex gap-4">
              <div className={`${block} h-4 w-24`} />
              <div className={`${block} h-4 w-40`} />
            </div>
          ))}
        </div>
      </CardSkeleton>

      <CardSkeleton>
        <div className="space-y-2 px-4 py-3">
          <div className={`${block} mb-4 h-4 w-2/3`} />
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className={`${block} h-3 ${index === 4 ? "w-1/2" : "w-full"}`} />
          ))}
        </div>
      </CardSkeleton>

      <CardSkeleton rows={2} />
    </div>
  );
}
