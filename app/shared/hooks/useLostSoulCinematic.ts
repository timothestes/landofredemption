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
 * `useLostSoulDeals`; the canvas calls `enqueue` from that hook's `onArrive`
 * with a delay so the cinematic starts once the deal flyers have landed.
 *
 * `enabled` is read when the delayed enqueue fires, so switching the setting
 * off mid-flight suppresses a cinematic that has not started yet.
 *
 * The hold timer lives here (not in the overlay component) so React
 * strict-mode's effect double-invocation can't dismiss a batch early.
 */
export function useLostSoulCinematic(enabled: boolean) {
  const [queue, setQueue] = useState(EMPTY_CINEMATIC_QUEUE);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const pendingRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // Drop any delayed enqueues still waiting when the canvas unmounts.
  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      for (const t of pending) clearTimeout(t);
      pending.clear();
    };
  }, []);

  const enqueue = useCallback((souls: SoulCinematicCard[], delayMs = 0) => {
    if (!enabledRef.current || souls.length === 0) return;
    const batch = {
      id: `soul-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      souls,
    };
    const t = setTimeout(() => {
      pendingRef.current.delete(t);
      setQueue(q => enqueueCinematicBatch(q, batch, enabledRef.current));
    }, delayMs);
    pendingRef.current.add(t);
  }, []);

  useEffect(() => {
    if (!queue.active) return;
    const t = setTimeout(() => setQueue(advanceCinematicQueue), BATCH_HOLD_MS);
    return () => clearTimeout(t);
  }, [queue.active]);

  return { activeBatch: queue.active, enqueue };
}
