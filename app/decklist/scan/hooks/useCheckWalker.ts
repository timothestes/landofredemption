'use client';

import { useCallback, useRef } from 'react';
import { nextAmber } from '../lib/walker';

/** The row element for a row key (`data-row-id` on each decklist row). */
export const rowElement = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);

/**
 * The totals line's "N to check": each call scrolls to the next amber row after the last one it
 * visited (wrapping) and focuses it. A row fixed in between drops out of `ids`, so the walk restarts.
 */
export function useCheckWalker(ids: string[]): () => void {
  const current = useRef<string | null>(null);
  return useCallback(() => {
    const id = nextAmber(ids, current.current);
    current.current = id;
    if (id === null) return;
    const el = rowElement(id);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
  }, [ids]);
}
