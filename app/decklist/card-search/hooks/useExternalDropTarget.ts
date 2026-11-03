"use client";

import React from "react";

/**
 * MIME type used to encode card payloads for native HTML5 drag-and-drop from
 * the search-results column. The browser dispatches `dragstart`/`drop` events
 * separately from @dnd-kit's PointerSensor, so this bridge lets external drag
 * sources (search tiles) participate in the existing droppable zones without
 * lifting the @dnd-kit DndContext above the deck panel. See spec
 * `2026-05-15-card-search-dnd-progress-and-improvements.md` (P2 §4a).
 */
export const SEARCH_DRAG_MIME = "application/x-redemption-card";

/**
 * Subscribes to a global "an external (search-tile) drag is in progress" flag.
 * Used by deck-panel zones to surface a subtle "drop here" hint while the
 * user is dragging a card out of the search column — solves the discoverability
 * problem of "I have a card in flight, but where can I drop it?". The flag is
 * set/cleared by document-level dragstart/dragend listeners that look for our
 * MIME type in `dataTransfer.types`.
 */
export function useIsExternalDragActive(): boolean {
  const [active, setActive] = React.useState(false);
  React.useEffect(() => {
    const isOurDrag = (e: DragEvent) =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(SEARCH_DRAG_MIME);
    const onStart = (e: DragEvent) => {
      if (isOurDrag(e)) setActive(true);
    };
    // dragend fires on the source even if the drop was canceled. dragexit isn't
    // standard cross-browser; dragend is the universal "drag is done" signal.
    const onEnd = () => setActive(false);
    document.addEventListener("dragstart", onStart);
    document.addEventListener("dragend", onEnd);
    document.addEventListener("drop", onEnd);
    return () => {
      document.removeEventListener("dragstart", onStart);
      document.removeEventListener("dragend", onEnd);
      document.removeEventListener("drop", onEnd);
    };
  }, []);
  return active;
}

export interface SearchDragPayload {
  name: string;
  set: string;
}

function hasOurPayload(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes(SEARCH_DRAG_MIME);
}

function readPayload(e: DragEvent): SearchDragPayload | null {
  const raw = e.dataTransfer?.getData(SEARCH_DRAG_MIME);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as SearchDragPayload;
    if (payload && typeof payload.name === "string" && typeof payload.set === "string") {
      return payload;
    }
  } catch {
    // Malformed payload — silently ignore.
  }
  return null;
}

/**
 * Wires native HTML5 drop handlers (dragenter/dragover/dragleave/drop) to a
 * DOM node. Coexists with @dnd-kit because dnd-kit listens to PointerEvents,
 * not DragEvents — they don't fight.
 *
 * Use the returned `setRef` callback alongside dnd-kit's `setNodeRef` (combine
 * via a small helper). `isOver` is true while a payload of our MIME type is
 * hovering — use it to mirror dnd-kit's `isOver` ring/tint.
 */
export function useExternalDropTarget(
  onDrop: ((payload: SearchDragPayload) => void) | undefined,
) {
  const [isOver, setIsOver] = React.useState(false);
  const nodeRef = React.useRef<HTMLElement | null>(null);
  const onDropRef = React.useRef(onDrop);
  React.useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  // Counter approach handles dragenter/dragleave for nested children correctly:
  // dragenter fires once per descendant, dragleave fires when leaving each.
  // We only want isOver to flip false when the pointer truly leaves the node.
  const enterCountRef = React.useRef(0);

  const setRef = React.useCallback((node: HTMLElement | null) => {
    const prev = nodeRef.current;
    if (prev === node) return;
    if (prev) {
      prev.removeEventListener("dragenter", handleEnter);
      prev.removeEventListener("dragover", handleOver);
      prev.removeEventListener("dragleave", handleLeave);
      prev.removeEventListener("drop", handleDrop);
    }
    nodeRef.current = node;
    enterCountRef.current = 0;
    if (node) {
      node.addEventListener("dragenter", handleEnter);
      node.addEventListener("dragover", handleOver);
      node.addEventListener("dragleave", handleLeave);
      node.addEventListener("drop", handleDrop);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable handlers — read from refs so they don't need to re-bind.
  function handleEnter(e: DragEvent) {
    if (!hasOurPayload(e)) return;
    enterCountRef.current += 1;
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    setIsOver(true);
  }
  function handleOver(e: DragEvent) {
    if (!hasOurPayload(e)) return;
    e.preventDefault(); // required to allow `drop`
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }
  function handleLeave(e: DragEvent) {
    if (!hasOurPayload(e)) return;
    enterCountRef.current = Math.max(0, enterCountRef.current - 1);
    if (enterCountRef.current === 0) setIsOver(false);
  }
  function handleDrop(e: DragEvent) {
    if (!hasOurPayload(e)) return;
    e.preventDefault();
    enterCountRef.current = 0;
    setIsOver(false);
    const payload = readPayload(e);
    if (payload) onDropRef.current?.(payload);
  }

  // Cleanup on unmount.
  React.useEffect(() => {
    return () => {
      const node = nodeRef.current;
      if (node) {
        node.removeEventListener("dragenter", handleEnter);
        node.removeEventListener("dragover", handleOver);
        node.removeEventListener("dragleave", handleLeave);
        node.removeEventListener("drop", handleDrop);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { setRef, isOver };
}

/** Where the pointer sat inside the dragged element, captured at dragstart. */
export interface DragGrab {
  dx: number;
  dy: number;
  width: number;
  height: number;
}

/** Share of the dragged card that must be over the panel for a drop to count. */
export const NEAR_MISS_OVERLAP = 1 / 3;

/**
 * Whether a drop at (x, y) should land in `panel`: the pointer is inside it,
 * or at least NEAR_MISS_OVERLAP of the drag ghost is. Native DnD hit-tests
 * only the pointer, but the ghost (the card tile) hangs off the pointer
 * wherever it was grabbed — so a card can look like it is over the deck
 * panel while the pointer is still in the search column.
 */
export function isNearMissDrop(
  x: number,
  y: number,
  grab: DragGrab | null,
  panel: Pick<DOMRect, "left" | "top" | "right" | "bottom">,
): boolean {
  if (x >= panel.left && x <= panel.right && y >= panel.top && y <= panel.bottom) return true;
  if (!grab || grab.width <= 0 || grab.height <= 0) return false;
  const left = x - grab.dx;
  const top = y - grab.dy;
  const overlapX = Math.min(left + grab.width, panel.right) - Math.max(left, panel.left);
  const overlapY = Math.min(top + grab.height, panel.bottom) - Math.max(top, panel.top);
  if (overlapX <= 0 || overlapY <= 0) return false;
  return (overlapX * overlapY) / (grab.width * grab.height) >= NEAR_MISS_OVERLAP;
}

/**
 * Forgiving drop target for a whole panel: takes a search-tile drop that
 * missed every zone but passes `isNearMissDrop`, and hands it to `onDrop`.
 * Zones inside the panel still win — their drop handler calls
 * preventDefault, which this skips. Returns true while a drop would land
 * here and no zone has claimed it, so the caller can light up the zone the
 * card will go to. Pass `undefined` to switch it off.
 */
export function useNearMissDropTarget(
  panelRef: React.RefObject<HTMLElement | null>,
  onDrop: ((payload: SearchDragPayload) => void) | undefined,
): boolean {
  const [isNear, setIsNear] = React.useState(false);
  const onDropRef = React.useRef(onDrop);
  React.useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);
  const enabled = !!onDrop;

  React.useEffect(() => {
    if (!enabled) return;
    let grab: DragGrab | null = null;
    const near = (e: DragEvent) => {
      const panel = panelRef.current;
      return !!panel && isNearMissDrop(e.clientX, e.clientY, grab, panel.getBoundingClientRect());
    };
    const onStart = (e: DragEvent) => {
      if (!hasOurPayload(e) || !(e.target instanceof Element)) return;
      // The default ghost is a snapshot of the dragged element, held at the
      // point it was grabbed.
      const r = e.target.getBoundingClientRect();
      grab = { dx: e.clientX - r.left, dy: e.clientY - r.top, width: r.width, height: r.height };
    };
    const onOver = (e: DragEvent) => {
      if (!hasOurPayload(e)) return;
      // A zone under the pointer already took it and shows its own highlight.
      if (e.defaultPrevented || !near(e)) {
        setIsNear(false);
        return;
      }
      e.preventDefault(); // required to allow `drop`
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setIsNear(true);
    };
    const onDropEvent = (e: DragEvent) => {
      setIsNear(false);
      if (!hasOurPayload(e) || e.defaultPrevented || !near(e)) return;
      e.preventDefault();
      const payload = readPayload(e);
      if (payload) onDropRef.current?.(payload);
    };
    const onEnd = () => {
      grab = null;
      setIsNear(false);
    };
    document.addEventListener("dragstart", onStart);
    document.addEventListener("dragover", onOver);
    document.addEventListener("drop", onDropEvent);
    document.addEventListener("dragend", onEnd);
    return () => {
      document.removeEventListener("dragstart", onStart);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("drop", onDropEvent);
      document.removeEventListener("dragend", onEnd);
      setIsNear(false);
    };
  }, [enabled, panelRef]);

  return isNear;
}

/**
 * Combine @dnd-kit's `setNodeRef` with this hook's `setRef` so a single DOM
 * node participates in both drag systems.
 */
export function combineRefs<T extends HTMLElement>(
  ...refs: Array<((node: T | null) => void) | React.MutableRefObject<T | null> | null | undefined>
): (node: T | null) => void {
  return (node) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(node);
      else (ref as React.MutableRefObject<T | null>).current = node;
    }
  };
}
