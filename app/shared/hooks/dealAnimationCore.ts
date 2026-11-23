// Pure logic for "the deal" draw animation: detecting deck→hand transitions
// between renders and scheduling staggered launch times. Kept free of React
// and Konva so it can be unit-tested directly (same pattern as undoStackCore).

export interface DealCardSnapshot {
  id: string;
  zone: string;
}

/** Delay between consecutive card launches. */
export const DEAL_STAGGER_MS = 200;
/** Faster stagger for the opening-hand deal (8 cards shouldn't take 2s). */
export const DEAL_OPENING_STAGGER_MS = 90;
/** Stagger for cards milled deck → discard: quick, one after another. */
export const MILL_STAGGER_MS = 110;
/** Flight duration for one card, deck pile → hand slot. */
export const DEAL_FLIGHT_MS = 420;
/** A batch never spreads its launches over more than this (big draws compress). */
export const DEAL_MAX_SPREAD_MS = 1600;

export interface DealDiffResult {
  /** Instance IDs newly arrived in hand FROM THE DECK, in current hand order. */
  dealt: string[];
  /** Zone map to carry into the next diff. */
  nextZones: Map<string, string>;
}

/**
 * Diff the previous id→zone map against the current card list. Only a card
 * whose previous zone was 'deck' and whose current zone is 'hand' counts as a
 * deal — cards returning from territory/reserve/search-inserts don't animate.
 * A null prevZones means "first snapshot" (page load / reconnect): never deal.
 * `toZone` picks the destination watched: 'hand' for draws, 'discard' for
 * cards milled from the deck, 'reserve' for cards reserved from it.
 */
export function diffDeals(
  prevZones: Map<string, string> | null,
  cards: DealCardSnapshot[],
  toZone: string = 'hand',
): DealDiffResult {
  const nextZones = new Map<string, string>();
  for (const c of cards) nextZones.set(c.id, c.zone);
  if (prevZones === null) return { dealt: [], nextZones };

  const dealt: string[] = [];
  for (const c of cards) {
    if (c.zone === toZone && prevZones.get(c.id) === 'deck') dealt.push(c.id);
  }
  return { dealt, nextZones };
}

/**
 * Launch times for a batch of `count` deals. Starts at `nowMs`, or chains
 * after `prevLastStartAt` when a previous deal is still queued (rapid Draw
 * button presses keep the one-at-a-time rhythm instead of overlapping).
 */
export function scheduleDeals(
  nowMs: number,
  prevLastStartAt: number,
  count: number,
  staggerMs: number = DEAL_STAGGER_MS,
): { startAts: number[] } {
  const stagger =
    count > 1 ? Math.min(staggerMs, DEAL_MAX_SPREAD_MS / (count - 1)) : staggerMs;
  const first = Math.max(nowMs, prevLastStartAt + stagger);
  return {
    startAts: Array.from({ length: count }, (_, i) => first + i * stagger),
  };
}
