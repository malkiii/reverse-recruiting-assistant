"use client";

import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";
import { TableLink, useTableNavigation } from "./table-transition";
import { cx, inputClass, segmentClass } from "./ui";

/** The path with these params, back on page 1. */
function hrefWith(pathname: string, params: URLSearchParams) {
  const next = new URLSearchParams(params);
  next.delete("page");
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Sets a URL param, or removes it when empty, and goes back to page 1. */
function useSetParam(name: string) {
  const { params, pathname, navigate } = useTableNavigation();
  return (value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    navigate(hrefWith(pathname, next));
  };
}

/** A text filter that updates the URL when the Admin presses Enter. */
export function FilterInput({ name, label, placeholder }: { name: string; label: string; placeholder?: string }) {
  const value = useSearchParams().get(name) ?? "";
  const { params } = useTableNavigation();
  const setParam = useSetParam(name);
  const input = useRef<HTMLInputElement>(null);

  // Follows the URL when it changes elsewhere, such as Clear filters, but not under the Admin's typing.
  useEffect(() => {
    if (input.current && document.activeElement !== input.current) input.current.value = value;
  }, [value]);

  return (
    <input
      ref={input}
      type="search"
      aria-label={label}
      placeholder={placeholder}
      defaultValue={value}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const next = event.currentTarget.value.trim();
        if (next !== (params.get(name) ?? "")) setParam(next);
      }}
      className={cx(inputClass, "sm:w-56")}
    />
  );
}

/** A dropdown filter. The empty option removes the param. */
export function FilterSelect({
  name,
  label,
  emptyLabel,
  options,
}: {
  name: string;
  label: string;
  emptyLabel: string;
  options: string[];
}) {
  const value = useTableNavigation().params.get(name) ?? "";
  const setParam = useSetParam(name);
  // A value no longer offered, such as a cleaned-up Company, still shows as chosen.
  const shown = value && !options.includes(value) ? [value, ...options] : options;

  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => setParam(event.target.value)}
      className={cx(inputClass, "sm:w-56")}
    >
      <option value="">{emptyLabel}</option>
      {shown.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

/**
 * A row of filter options for one param. The option with an empty value removes the param.
 * With `multiple`, the other options toggle in and out of the param instead of replacing it.
 */
export function FilterSegmented({
  name,
  label,
  options,
  multiple = false,
}: {
  name: string;
  label: string;
  options: { value: string; label: ReactNode }[];
  multiple?: boolean;
}) {
  const { params, pathname } = useTableNavigation();
  const chosen = params.getAll(name);

  const hrefFor = (value: string) => {
    const next = new URLSearchParams(params);
    next.delete(name);
    const values = !value
      ? []
      : !multiple
        ? [value]
        : chosen.includes(value)
          ? chosen.filter((item) => item !== value)
          : [...chosen, value];
    for (const item of values) next.append(name, item);
    return hrefWith(pathname, next);
  };

  return (
    <nav aria-label={label}>
      <ul className="flex w-max gap-0.5 rounded-sm border border-line bg-surface p-0.5">
        {options.map((option) => {
          const active = option.value ? chosen.includes(option.value) : chosen.length === 0;
          return (
            <li key={option.value}>
              <TableLink
                href={hrefFor(option.value)}
                replace
                aria-current={active ? "page" : undefined}
                className={segmentClass(active)}
              >
                {option.label}
              </TableLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
