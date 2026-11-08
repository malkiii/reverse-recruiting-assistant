"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/button";

/** Copies `text` to the clipboard, showing a check for a moment after. Icon-only unless `children` labels it. */
export function CopyButton({ text, label, children }: { text: string; label: string; children?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // The clipboard is blocked here (e.g. not a secure context): nothing to copy into.
    }
  };

  const icon = copied ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-4" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="1.5" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
    </svg>
  );

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={children ? undefined : copied ? "Copied" : label}
      title={label}
      className={
        children
          ? buttonClass("ghost")
          : "inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted transition hover:bg-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
      }
    >
      {icon}
      {children && (copied ? "Copied" : children)}
    </button>
  );
}
