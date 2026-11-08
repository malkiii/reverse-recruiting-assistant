/** The filters last used on each dashboard table tab, kept in the browser tab's session so the sidebar links bring them back. */

export type FilterStorage = Pick<Storage, "getItem" | "setItem">;

const FILTER_TABS = ["/jobs", "/applications", "/decision-makers", "/stats", "/activity"];

const keyOf = (tab: string) => `filters:${tab}`;

/**
 * Remembers the filters in the URL of a tab, leaving out the page. Other pages are ignored.
 * No filters only replaces the saved ones when the Admin cleared them on the tab itself (`from` is the path the
 * Admin came from, null on a fresh load), so a bare link or a reload doesn't forget them.
 */
export function saveFilters(storage: FilterStorage, pathname: string, search: URLSearchParams, from: string | null) {
  if (!FILTER_TABS.includes(pathname)) return;
  const params = new URLSearchParams(search);
  params.delete("page");
  if (params.size === 0 && from !== pathname) return;
  try {
    storage.setItem(keyOf(pathname), params.toString());
  } catch {
    // Blocked storage only means the filters aren't remembered.
  }
}

/** The tab's path with the filters last used on it. */
export function tabHref(storage: FilterStorage, tab: string) {
  if (!FILTER_TABS.includes(tab)) return tab;
  try {
    const query = storage.getItem(keyOf(tab));
    return query ? `${tab}?${query}` : tab;
  } catch {
    return tab;
  }
}
