'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  diffDeals,
  scheduleDeals,
  DEAL_OPENING_STAGGER_MS,
  type DealCardSnapshot,
} from './dealAnimationCore';

// The deal diff must run BEFORE the browser paints: with a plain useEffect
// there is one painted frame where freshly drawn cards sit fully laid out in
// the hand, then vanish when the sprites spawn — a visible flash. SSR guard
// only silences React's useLayoutEffect-on-server warning; both canvases are
// client-only.
const useBeforePaintEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface ActiveDeal {
  instanceId: string;
  /** performance.now()-based timestamp when this sprite should launch. */
  startAt: number;
}

/** How long the landing glow flag stays set (GameCardNode's tween is ~1.8s). */
const GLOW_DURATION_MS = 2000;
/**
 * Failsafe: a dealing card is force-revealed this long after its scheduled
 * launch even if the Konva tween never finishes (backgrounded tab, unmounted
 * sprite). A card must never be stuck invisible.
 */
const DEAL_FAILSAFE_MS = 8000;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Tracks deck→hand transitions for the local player's cards and exposes the
 * transient state driving "the deal": which cards currently have a sprite in
 * flight (render the real card hidden), and which just landed (render with
 * the arrival glow). `completeDeal` is called by the DealLayer sprite when it
 * lands — or by the failsafe timer, whichever comes first.
 *
 * `openingKey` triggers the opening-hand deal: when it changes to a new
 * non-null value, EVERY card currently in hand is dealt with the fast opening
 * stagger — regardless of previous zone. Callers pass a value that changes
 * exactly when a fresh game begins (goldfish: state.sessionId; multiplayer:
 * a key derived from playingStartedAtMicros), and null/undefined otherwise.
 *
 * `route` retargets the hook at another deck → pile movement. The mill
 * animation passes `{ toZone: 'discard', staggerMs: MILL_STAGGER_MS }` and no
 * openingKey; reserving from the deck passes `toZone: 'reserve'` the same way.
 */
export function useDealAnimation(
  cards: DealCardSnapshot[],
  enabled: boolean,
  openingKey?: string | null,
  route?: { toZone: string; staggerMs?: number },
) {
  const toZone = route?.toZone ?? 'hand';
  const routeStaggerMs = route?.staggerMs;
  const prevZonesRef = useRef<Map<string, string> | null>(null);
  const prevOpeningKeyRef = useRef<string | null>(null);
  const lastStartAtRef = useRef(-Infinity);
  const [deals, setDeals] = useState<ActiveDeal[]>([]);
  const [glowIds, setGlowIds] = useState<Set<string>>(new Set());
  const failsafeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const glowTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      for (const t of failsafeTimersRef.current.values()) clearTimeout(t);
      for (const t of glowTimersRef.current.values()) clearTimeout(t);
    };
  }, []);

  const completeDeal = useCallback((instanceId: string) => {
    const failsafe = failsafeTimersRef.current.get(instanceId);
    if (failsafe) {
      clearTimeout(failsafe);
      failsafeTimersRef.current.delete(instanceId);
    }
    setDeals(prev =>
      prev.some(d => d.instanceId === instanceId)
        ? prev.filter(d => d.instanceId !== instanceId)
        : prev,
    );
    setGlowIds(prev => {
      if (prev.has(instanceId)) return prev;
      const next = new Set(prev);
      next.add(instanceId);
      return next;
    });
    const existingGlow = glowTimersRef.current.get(instanceId);
    if (existingGlow) clearTimeout(existingGlow);
    glowTimersRef.current.set(
      instanceId,
      setTimeout(() => {
        glowTimersRef.current.delete(instanceId);
        setGlowIds(prev => {
          const next = new Set(prev);
          next.delete(instanceId);
          return next;
        });
      }, GLOW_DURATION_MS),
    );
  }, []);

  useBeforePaintEffect(() => {
    const { dealt, nextZones } = diffDeals(prevZonesRef.current, cards, toZone);
    prevZonesRef.current = nextZones;

    // Cancel deals whose card left the hand mid-flight (undo, direct play).
    setDeals(prev => {
      const stillDealing = prev.filter(d => nextZones.get(d.instanceId) === toZone);
      return stillDealing.length === prev.length ? prev : stillDealing;
    });

    // Opening-hand deal: a fresh game began — deal the whole hand, fast.
    // (dealt ⊆ hand, so the opening set supersedes the normal diff.)
    const openingChanged = openingKey != null && openingKey !== prevOpeningKeyRef.current;
    if (openingKey != null) prevOpeningKeyRef.current = openingKey;
    let toDeal = dealt;
    let staggerMs: number | undefined = routeStaggerMs;
    if (openingChanged) {
      const handIds = cards.filter(c => c.zone === toZone).map(c => c.id);
      if (handIds.length > 0) {
        toDeal = handIds;
        staggerMs = DEAL_OPENING_STAGGER_MS;
      }
    }

    if (!enabled || toDeal.length === 0) return;

    if (prefersReducedMotion()) {
      // No flight — just mark the new cards with the landing glow.
      for (const id of toDeal) completeDeal(id);
      return;
    }

    const now = performance.now();
    const { startAts } = scheduleDeals(now, lastStartAtRef.current, toDeal.length, staggerMs);
    lastStartAtRef.current = startAts[startAts.length - 1];

    setDeals(prev => [
      ...prev,
      ...toDeal.map((instanceId, i) => ({ instanceId, startAt: startAts[i] })),
    ]);
    toDeal.forEach((instanceId, i) => {
      const t = setTimeout(
        () => completeDeal(instanceId),
        Math.max(0, startAts[i] - now) + DEAL_FAILSAFE_MS,
      );
      const existing = failsafeTimersRef.current.get(instanceId);
      if (existing) clearTimeout(existing);
      failsafeTimersRef.current.set(instanceId, t);
    });
  }, [cards, enabled, openingKey, completeDeal, toZone, routeStaggerMs]);

  const dealingIds = useMemo(() => new Set(deals.map(d => d.instanceId)), [deals]);

  return { deals, dealingIds, glowIds, completeDeal };
}
