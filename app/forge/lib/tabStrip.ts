"use client";

import { useLayoutEffect, useRef } from "react";

/** Where a sideways tab strip should scroll to so its active tab shows, or null to leave it alone.
 *  Pixels along the strip's content; fade is the part of the right edge that `.scroll-fade-x` hides. */
export function tabScrollLeft({ tabLeft, tabRight, stripWidth, scrollLeft, fade }: {
  tabLeft: number;
  tabRight: number;
  stripWidth: number;
  scrollLeft: number;
  fade: number;
}): number | null {
  const room = stripWidth - fade;
  if (tabLeft < scrollLeft) return tabLeft;
  if (tabRight <= scrollLeft + room) return null;
  return tabRight - tabLeft > room ? tabLeft : tabRight - room;
}

const FADE_PX = 28;

// For a strip whose tabs mark the current page with aria-current. Sets the strip's own scrollLeft:
// scrollIntoView would also scroll the window to reach the strip, and take a grid off the place
// useGridPlace has just put it back to.
export function useActiveTabInView(pathname: string) {
  const strip = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = strip.current;
    const tab = el?.querySelector('[aria-current="page"]');
    if (!el || !tab) return;
    const s = el.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    const left = tabScrollLeft({
      tabLeft: t.left - s.left + el.scrollLeft,
      tabRight: t.right - s.left + el.scrollLeft,
      stripWidth: el.clientWidth,
      scrollLeft: el.scrollLeft,
      fade: FADE_PX,
    });
    if (left !== null) el.scrollLeft = left;
  }, [pathname]);
  return strip;
}
