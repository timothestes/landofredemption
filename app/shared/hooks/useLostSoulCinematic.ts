'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EMPTY_CINEMATIC_QUEUE,
  advanceCinematicQueue,
  enqueueCinematicBatch,
  type SoulCinematicCard,
} from './lostSoulCinematicQueueCore';

export type { SoulCinematicBatch, SoulCinematicCard } from './lostSoulCinematicQueueCore';

/**
 * Time an active batch holds the screen before the next queued batch (or
 * nothing) replaces it. Matches the CSS timeline in globals.css
 * (`@keyframes lsc-card-in` et al). Reduced-motion uses the same wall-clock
 * duration so the queue advances at a predictable rate either way.
 */
const BATCH_HOLD_MS = 900;

/**
 * Plays Lost Soul cinematic batches one at a time. Arrival detection lives in
 * `useLostSoulDeals`; the canvas calls `enqueue` from that hook's `onArrive`,
 * so the cinematic starts as the deal flyers take off and plays over them.
 *
 * The hold timer lives here (not in the overlay component) so React
 * strict-mode's effect double-invocation can't dismiss a batch early.
 */
export function useLostSoulCinematic(enabled: boolean) {
  const [queue, setQueue] = useState(EMPTY_CINEMATIC_QUEUE);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const enqueue = useCallback((souls: SoulCinematicCard[]) => {
    if (!enabledRef.current || souls.length === 0) return;
    const batch = {
      id: `soul-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      souls,
    };
    setQueue(q => enqueueCinematicBatch(q, batch, true));
  }, []);

  useEffect(() => {
    if (!queue.active) return;
    const t = setTimeout(() => setQueue(advanceCinematicQueue), BATCH_HOLD_MS);
    return () => clearTimeout(t);
  }, [queue.active]);

  return { activeBatch: queue.active, enqueue };
}
