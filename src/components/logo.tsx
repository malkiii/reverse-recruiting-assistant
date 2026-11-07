import { cx } from "./ui";

/** The app's mark: a solid white work bag on an accent tile. */
export function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span
      className={cx(
        "grid shrink-0 place-items-center bg-accent text-white",
        size === "sm" ? "size-6 rounded-xs" : "size-11 rounded-sm",
      )}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className={size === "sm" ? "size-4" : "size-7"} aria-hidden="true">
        <path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6h-1.8V4.8h-2.4V6Z" />
        <rect x="2" y="6.5" width="20" height="6.5" rx="2.5" />
        <rect x="3" y="14.5" width="18" height="6" rx="2" />
        <rect x="10.25" y="11.5" width="3.5" height="4.5" rx="1" />
      </svg>
    </span>
  );
}
