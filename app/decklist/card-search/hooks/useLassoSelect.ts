"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { isOnScrollbar } from "@/app/shared/utils/scrollbarHit";

/** A rectangle in the scroll container's content coordinates. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Movement (px) before a press on empty space draws a box instead of being a click. */
const LASSO_THRESHOLD = 5;

/** A press on one of these starts its own interaction, never a lasso. */
const INTERACTIVE = "button, a, input, textarea, select, label, [role='menu'], [role='menuitem']";

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

function toContent(container: HTMLElement, clientX: number, clientY: number) {
  const origin = container.getBoundingClientRect();
  return {
    x: clientX - origin.left + container.scrollLeft,
    y: clientY - origin.top + container.scrollTop,
  };
}

/**
 * Rubber-band selection over a scroll container. A press on empty space (not
 * an item, a control, or the scrollbar) starts a lasso, and every
 * `[data-select-key]` element the box touches is selected. Shift/Cmd/Ctrl at
 * the press adds to the selection instead of replacing it; a plain press on
 * empty space clears it, like a desktop file view.
 *
 * The box lives in scroll-content coordinates so it stays anchored to the
 * cards while the container scrolls. It is drawn imperatively (one fixed div
 * on <body>) so a lasso re-renders the owner only when the hit set changes,
 * not on every pointer move.
 */
export function useLassoSelect(
  containerRef: React.RefObject<HTMLElement | null>,
  {
    enabled,
    selected,
    onChange,
  }: {
    enabled: boolean;
    selected: ReadonlySet<string>;
    onChange: (next: Set<string>) => void;
  }
) {
  const [isLassoing, setIsLassoing] = useState(false);
  const startRef = useRef<{ x: number; y: number; base: Set<string> } | null>(null);
  const selectedRef = useRef(selected);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    selectedRef.current = selected;
    onChangeRef.current = onChange;
  }, [selected, onChange]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const container = containerRef.current;
      if (!enabled || !container || e.button !== 0 || e.pointerType === "touch") return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-select-key]") || target.closest(INTERACTIVE)) return;
      if (isOnScrollbar(container, e.clientX, e.clientY)) return;
      // Suppresses the compat mousedown, so no text gets selected while the
      // box is drawn — and no focus change, hence the manual blur.
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      if (!additive && selectedRef.current.size > 0) onChangeRef.current(new Set());
      startRef.current = {
        ...toContent(container, e.clientX, e.clientY),
        base: additive ? new Set(selectedRef.current) : new Set(),
      };
      setIsLassoing(true);
    },
    [enabled, containerRef]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!isLassoing || !container) return;
    const overlay = document.createElement("div");
    overlay.className = "fixed z-[60] pointer-events-none rounded-sm border border-primary bg-primary/10";
    overlay.style.display = "none";
    document.body.appendChild(overlay);

    let lastHits: ReadonlySet<string> = startRef.current?.base ?? new Set();
    let lastPointer: { x: number; y: number } | null = null;
    let drawing = false;

    const update = () => {
      const start = startRef.current;
      if (!start || !lastPointer) return;
      const point = toContent(container, lastPointer.x, lastPointer.y);
      const box: Box = {
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        w: Math.abs(point.x - start.x),
        h: Math.abs(point.y - start.y),
      };
      if (!drawing && box.w < LASSO_THRESHOLD && box.h < LASSO_THRESHOLD) return;
      drawing = true;

      const origin = container.getBoundingClientRect();
      const hits = new Set(start.base);
      container.querySelectorAll<HTMLElement>("[data-select-key]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const item: Box = {
          x: r.left - origin.left + container.scrollLeft,
          y: r.top - origin.top + container.scrollTop,
          w: r.width,
          h: r.height,
        };
        if (boxesOverlap(box, item) && el.dataset.selectKey) hits.add(el.dataset.selectKey);
      });
      if (!sameKeys(hits, lastHits)) {
        lastHits = hits;
        onChangeRef.current(hits);
      }

      // Project back to the viewport, clipped to the container.
      const left = Math.max(box.x - container.scrollLeft + origin.left, origin.left);
      const top = Math.max(box.y - container.scrollTop + origin.top, origin.top);
      const right = Math.min(box.x + box.w - container.scrollLeft + origin.left, origin.right);
      const bottom = Math.min(box.y + box.h - container.scrollTop + origin.top, origin.bottom);
      Object.assign(overlay.style, {
        display: "block",
        left: `${left}px`,
        top: `${top}px`,
        width: `${Math.max(0, right - left)}px`,
        height: `${Math.max(0, bottom - top)}px`,
      });
    };

    const onMove = (e: PointerEvent) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      update();
    };
    const end = () => {
      startRef.current = null;
      setIsLassoing(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    // Wheel-scrolling mid-lasso grows the box without a pointer move.
    container.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      container.removeEventListener("scroll", update);
      overlay.remove();
    };
  }, [isLassoing, containerRef]);

  return { onPointerDown, isLassoing };
}
