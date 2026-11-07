"use client";

import { useState } from "react";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

/** A person's photo, or their initials when there's none or it fails to load, as LinkedIn photo URLs expire. */
export function Avatar({ name, photo }: { name: string; photo: string | null }) {
  const [failed, setFailed] = useState(false);
  const className = "size-10 shrink-0 rounded-full";

  if (photo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- LinkedIn's signed URLs gain nothing from Next's optimizer.
      <img
        src={photo}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${className} bg-subtle object-cover`}
      />
    );
  }
  return (
    <span aria-hidden className={`${className} flex items-center justify-center bg-subtle text-xs font-medium text-muted`}>
      {initials(name)}
    </span>
  );
}
