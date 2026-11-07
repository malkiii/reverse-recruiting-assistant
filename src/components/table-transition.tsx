"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, type MouseEvent, type ReactNode, useContext, useOptimistic, useTransition } from "react";

type TableNavigation = {
  /** True from the Admin's change until the new results are in. */
  pending: boolean;
  /** The URL's params as the Admin last chose them, ahead of the server. */
  params: URLSearchParams;
  pathname: string;
  navigate: (href: string, options?: { replace?: boolean }) => void;
};

const TableNavigationContext = createContext<TableNavigation | null>(null);

/** Wraps a table and its filters, so a filter or page change shows at once and the results show placeholders until they're in. */
export function TableTransition({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [pending, startTransition] = useTransition();
  const [optimisticSearch, setOptimisticSearch] = useOptimistic(search);

  const navigate = (href: string, { replace = true } = {}) =>
    startTransition(() => {
      setOptimisticSearch(new URL(href, window.location.origin).searchParams.toString());
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });

  return (
    <TableNavigationContext
      value={{
        pending,
        params: new URLSearchParams(optimisticSearch),
        pathname,
        navigate,
      }}
    >
      {children}
    </TableNavigationContext>
  );
}

export function useTableNavigation() {
  const navigation = useContext(TableNavigationContext);
  if (!navigation) throw new Error("useTableNavigation needs a TableTransition around it");
  return navigation;
}

/** The results, or placeholder rows while new ones load. */
export function TableResults({ children, rows = 8 }: { children: ReactNode; rows?: number }) {
  const { pending } = useTableNavigation();
  if (!pending) return children;
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-2">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-14 animate-pulse rounded-md bg-subtle" />
      ))}
    </div>
  );
}

const opensElsewhere = (event: MouseEvent) =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

/** A link that, inside a TableTransition, shows the table's placeholders until its page is in. Otherwise a plain link. */
export function TableLink({
  href,
  replace = false,
  ...props
}: {
  href: string;
  replace?: boolean;
  className?: string;
  children: ReactNode;
  "aria-current"?: "page";
}) {
  const navigation = useContext(TableNavigationContext);
  return (
    <Link
      href={href}
      replace={replace}
      scroll={false}
      onClick={(event) => {
        if (!navigation || opensElsewhere(event)) return;
        event.preventDefault();
        navigation.navigate(href, { replace });
      }}
      {...props}
    />
  );
}
