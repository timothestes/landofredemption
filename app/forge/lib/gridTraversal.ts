// A grid's scroll position, saved on its history entry when a card is opened, and read back on
// Back or Forward. The entry is the right place to keep it: each visit to a grid has its own, so
// two grids can't share a position and a fresh link never finds one.
//
// The catch is that Next rewrites history.state without custom keys when it has to refetch the page,
// as it does on Back after any save, and it does that in the same commit that mounts the grid, before
// the grid's layout effect can look. So the position is read as the traversal happens and held here.

export const ENTRY_Y = "forgeGridY";

export type Traversal = { url: string; y: number };

let traversal: Traversal | null = null;

/** What a traversal to this entry found on it. */
export function traversalFrom(state: unknown, url: string): Traversal | null {
  const y = (state as Record<string, unknown> | null)?.[ENTRY_Y];
  return typeof y === "number" ? { url, y } : null;
}

/** The position a grid arriving at `here` should restore, or null to leave it to the browser. */
export function entryReturnY({ traversal, here, inState }: {
  traversal: Traversal | null;
  here: string;
  inState: unknown;
}): number | null {
  if (traversal?.url === here) return traversal.y;
  return typeof inState === "number" ? inState : null;
}

// Runs for as long as the Forge is on screen, because Back to a grid starts from a page with no grid
// on it. Reads history.state, not the event's copy: when the grid is still in the router's cache,
// Chromium can commit it and the grid can use the marker before this listener runs, and the event's
// copy would then leave a used marker waiting for the next fresh link.
export function watchGridTraversals(): () => void {
  const onPopState = () => {
    traversal = traversalFrom(window.history.state, window.location.pathname + window.location.search);
  };
  window.addEventListener("popstate", onPopState);
  return () => window.removeEventListener("popstate", onPopState);
}

/** Whether a traversal is to this page of grids, under any filters. */
export function traversalIsFor(traversal: Traversal | null, path: string): boolean {
  return traversal !== null && (traversal.url === path || traversal.url.startsWith(`${path}?`));
}

/** The traversal waiting for a grid, which it can use once. */
export function takeTraversal(): Traversal | null {
  const taken = traversal;
  traversal = null;
  return taken;
}

export function dropTraversalFor(path: string) {
  if (traversalIsFor(traversal, path)) traversal = null;
}
