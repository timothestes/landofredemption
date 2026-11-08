"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { filterQuery, gridReturnY, NO_FILTERS, parseCardFilters, TILE_ID_PREFIX, type CardFilters } from "./cardFilters";

const TYPING_URL_DELAY_MS = 300;
const ENTRY_Y = "forgeGridY";

// The grid's place when a tile was last opened. Coming back by breadcrumb is a forward navigation
// with its own new history entry, so that entry can't say where the grid was.
let lastPlace: { path: string; y: number } | null = null;

// A grid's filters and scroll position, kept across a trip to a card. Filtering stays in local
// state, so it is as instant as ever and never navigates; the URL follows it with no server
// request, a beat behind typing.
export function useGridPlace() {
  const params = useSearchParams();
  const urlQuery = filterQuery(parseCardFilters(params));
  const [filters, setFilters] = useState<CardFilters>(() => parseCardFilters(params));
  const latest = useRef(filters);
  const written = useRef(urlQuery);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeUrl = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const query = filterQuery(latest.current);
    if (query === written.current) return;
    written.current = query;
    // null, not history.state: only that tells Next's router the URL moved. Passing its own state
    // skips the router, and its next update (the refresh after a bulk action) puts the old URL back.
    window.history.replaceState(null, "", window.location.pathname + query);
  }, []);

  const set = useCallback((next: CardFilters) => {
    latest.current = next;
    setFilters(next);
  }, []);

  const update = useCallback((patch: Partial<CardFilters>) => {
    set({ ...latest.current, ...patch });
    writeUrl();
  }, [set, writeUrl]);

  const typeSearch = useCallback((q: string) => {
    set({ ...latest.current, q });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(writeUrl, TYPING_URL_DELAY_MS);
  }, [set, writeUrl]);

  const clear = useCallback(() => update(NO_FILTERS), [update]);

  // A link to this same page (the Cards tab) moves the URL without remounting. Follow it.
  useEffect(() => {
    if (urlQuery === written.current) return;
    written.current = urlQuery;
    set(parseCardFilters(params));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- urlQuery is params, normalised
  }, [urlQuery, set]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Before the click navigates. A write that lands during a navigation cancels it, and leaving
      // first would lose the last few letters typed from this entry's URL.
      writeUrl();
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // a new tab: this page stays
      if (!(e.target as Element).closest?.(`a[id^="${TILE_ID_PREFIX}"]`)) return;
      const y = window.scrollY;
      lastPlace = { path: window.location.pathname, y };
      // Read by the layout effect below on Back or Forward. Next keeps custom keys on a restore.
      window.history.replaceState({ ...window.history.state, [ENTRY_Y]: y }, "");
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [writeUrl]);

  // Layout effect, so the grid never paints at the wrong place. Back to a grid whose page was
  // dropped from the router's cache, as any save does, arrives too late for the browser's own
  // restore, which has already clamped to the shorter card page. A breadcrumb's Link has
  // scroll={false} for the same reason: Next would otherwise scroll to the top after this runs.
  // Each marker is used once and removed. Left in place, it would override the browser's own
  // restore the next time you came back to this entry from somewhere other than a card.
  useLayoutEffect(() => {
    const { [ENTRY_Y]: entryY, ...state } = window.history.state ?? {};
    if (typeof entryY === "number") {
      window.history.replaceState(state, "");
      window.scrollTo(0, entryY);
      return;
    }
    const hash = window.location.hash.slice(1);
    if (!hash.startsWith(TILE_ID_PREFIX)) return;
    const tile = document.getElementById(hash);
    const rect = tile?.getBoundingClientRect();
    window.scrollTo(0, gridReturnY({
      savedY: lastPlace?.path === window.location.pathname ? lastPlace.y : null,
      tile: rect ? { top: rect.top + window.scrollY, height: rect.height } : null,
      viewportHeight: window.innerHeight,
      chrome: tile ? parseFloat(getComputedStyle(tile).getPropertyValue("--forge-chrome")) || 0 : 0,
    }));
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  return { filters, query: filterQuery(filters), update, typeSearch, clear };
}
