"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type FilterStorage, saveFilters, tabHref } from "@/lib/saved-filters";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

const icon = (path: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="size-6 md:size-4"
    aria-hidden="true"
  >
    {path}
  </svg>
);

const TABS = [
  {
    href: "/jobs",
    label: "Jobs",
    icon: icon(
      <>
        <rect x="3" y="7" width="18" height="13" rx="1" />
        <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" />
      </>,
    ),
  },
  {
    href: "/applications",
    label: "Applications",
    icon: icon(
      <>
        <path d="M4 6l8 6 8-6" />
        <rect x="3" y="5" width="18" height="14" rx="1" />
      </>,
    ),
  },
  {
    href: "/stats",
    label: "Stats",
    icon: icon(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: icon(
      <>
        <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="10" cy="12" r="2" />
        <circle cx="18" cy="18" r="2" />
      </>,
    ),
  },
];

/** Google and Function runs live under Settings. */
const SECTION_OF: Record<string, string> = { "/google": "/settings", "/function-runs": "/settings" };

function activeTab(pathname: string) {
  const section = `/${pathname.split("/")[1]}`;
  return SECTION_OF[section] ?? section;
}

const HOW_IT_WORKS = "/how-it-works";

const NO_STORAGE: FilterStorage = { getItem: () => null, setItem: () => {} };

/** The browser's storage; reading it throws when site data is blocked. */
function browserStorage(): FilterStorage {
  try {
    return window.sessionStorage;
  } catch {
    return NO_STORAGE;
  }
}

/** Each tab's link, with the filters last used on it once the browser's storage has been read. */
function useTabHrefs(pathname: string) {
  const searchParams = useSearchParams();
  const [hrefs, setHrefs] = useState<Record<string, string>>({});
  const from = useRef<string | null>(null);
  useEffect(() => {
    const storage = browserStorage();
    saveFilters(storage, pathname, searchParams, from.current);
    from.current = pathname;
    setHrefs(Object.fromEntries(TABS.map(({ href }) => [href, tabHref(storage, href)])));
  }, [pathname, searchParams]);
  return (tab: string) => hrefs[tab] ?? tab;
}

/** A left sidebar on desktop and a bottom tab bar on phones. */
export function Nav({ dark }: { dark: boolean }) {
  const pathname = usePathname();
  const active = activeTab(pathname);
  const hrefOf = useTabHrefs(pathname);
  // Phones reach How it works from Settings.
  const activeOnPhone = active === HOW_IT_WORKS ? "/settings" : active;

  return (
    <>
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-line bg-bg px-3 py-4 md:flex">
        <Link href="/jobs" className="mb-6 flex items-center gap-2.5 px-2">
          <Logo />
          <span className="text-[13px] font-semibold tracking-tight">Reverse Recruiting</span>
        </Link>
        <nav aria-label="Main" className="flex-1">
          <ul className="space-y-0.5">
            {TABS.map((tab) => (
              <li key={tab.href}>
                <Link
                  href={hrefOf(tab.href)}
                  aria-current={active === tab.href ? "page" : undefined}
                  className={`relative flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-[13px] font-medium transition ${
                    active === tab.href ? "bg-subtle text-fg" : "text-muted hover:bg-subtle hover:text-fg"
                  }`}
                >
                  {active === tab.href && (
                    <span aria-hidden="true" className="absolute inset-y-1.5 -left-3 w-0.5 rounded-r-xs bg-accent" />
                  )}
                  {tab.icon}
                  {tab.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <Link
          href={HOW_IT_WORKS}
          aria-current={active === HOW_IT_WORKS ? "page" : undefined}
          className={`mb-2 flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-[13px] font-medium transition ${
            active === HOW_IT_WORKS ? "bg-subtle text-fg" : "text-muted hover:bg-subtle hover:text-fg"
          }`}
        >
          {icon(
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h0" />
            </>,
          )}
          How it works
        </Link>
        <div className="flex items-center justify-between border-t border-line px-2 pt-3 text-xs text-faint">
          <span>Theme</span>
          <ThemeToggle initialDark={dark} />
        </div>
      </aside>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="grid h-16 grid-cols-4">
          {TABS.map((tab) => (
            <li key={tab.href}>
              <Link
                href={hrefOf(tab.href)}
                aria-current={activeOnPhone === tab.href ? "page" : undefined}
                className={`flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition active:scale-95 ${
                  activeOnPhone === tab.href ? "text-fg" : "text-faint"
                }`}
              >
                {tab.icon}
                {tab.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
