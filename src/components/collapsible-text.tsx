"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Plain text clamped to 4 lines, with Show more and Show less once it's measured as longer. React escapes it, so HTML
 * in it never renders.
 */
export function CollapsibleText({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  // Measured while clamped, and again when the width changes the wrapping.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, text]);

  return (
    <div className={className}>
      <p ref={ref} className={`text-sm break-words whitespace-pre-wrap text-fg-2 ${expanded ? "" : "line-clamp-4"}`}>
        {text}
      </p>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="mt-1 text-xs font-medium text-accent hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
