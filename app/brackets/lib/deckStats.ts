import type { BreakdownCard, BreakdownDeck, TournamentBreakdown } from '@/lib/tournament/breakdown';
import { BRIGADE_SWATCHES, brigadeRank } from '@/lib/tournament/brigadeColors';

/**
 * What a bracket's decklists share and what sets each apart.
 *
 * Derived on the client from a server-built `TournamentBreakdown`, so this
 * module imports only types from `breakdown.ts` (a value import would pull the
 * whole card index into the browser — see the note at the top of topCut.ts).
 * Everything is a count over a field of 2–16 decks; nothing here is a rate.
 */

export interface CoreRow {
  card: BreakdownCard;
  count: number;
  /** One flag per deck, in bracket order: does that deck run the card? */
  runs: boolean[];
}

/** Cards in at least two decks, most shared first. */
export function sharedCore(breakdown: TournamentBreakdown): CoreRow[] {
  return breakdown.cards
    .filter(card => card.deckIndexes.length >= 2)
    .map(card => ({
      card,
      count: card.deckIndexes.length,
      runs: breakdown.decks.map((_, index) => card.deckIndexes.includes(index)),
    }))
    .sort((a, b) => b.count - a.count || b.card.copies - a.card.copies || a.card.name.localeCompare(b.card.name));
}

export interface SignatureRow {
  index: number;
  deck: BreakdownDeck;
  /** Cards no other deck in the bracket plays, most copies first. */
  cards: BreakdownCard[];
}

export function signatureCards(breakdown: TournamentBreakdown): SignatureRow[] {
  return breakdown.decks.map((deck, index) => ({
    index,
    deck,
    cards: breakdown.cards
      .filter(card => card.deckIndexes.length === 1 && card.deckIndexes[0] === index)
      .sort((a, b) => b.copies - a.copies || a.name.localeCompare(b.name)),
  }));
}

export interface Twins {
  /** The two most alike decks; null when no two decks share a card. */
  pair: { a: BreakdownDeck; b: BreakdownDeck; similarity: number } | null;
  /** The deck furthest from every other; null below three decks or when nothing stands apart. */
  loner: { deck: BreakdownDeck; nearest: number } | null;
}

/**
 * The closest pair is the global maximum of every deck's nearest neighbour,
 * which `buildBreakdown` already computed (Jaccard on distinct cards).
 */
export function twinsAndLoners(breakdown: TournamentBreakdown): Twins {
  const byId = new Map(breakdown.decks.map(d => [d.participantId, d]));
  let pair: Twins['pair'] = null;
  let loner: Twins['loner'] = null;
  for (const deck of breakdown.decks) {
    const nearest = deck.neighbors[0];
    if (!nearest) continue;
    const other = byId.get(nearest.participantId);
    if (other && (!pair || nearest.similarity > pair.similarity)) {
      pair = { a: deck, b: other, similarity: nearest.similarity };
    }
    if (!loner || nearest.similarity < loner.nearest) loner = { deck, nearest: nearest.similarity };
  }
  if (pair && pair.similarity === 0) pair = null;
  // A loner is only a finding when it stands clearly apart from the twins.
  if (breakdown.decks.length < 3 || !pair || !loner || loner.nearest >= pair.similarity) loner = null;
  return { pair, loner };
}

/** Brigades no deck in the bracket plays, in reading order. "Multi" is not a brigade, and plain "Gold" is only neutral sites. */
export function unplayedBrigades(breakdown: TournamentBreakdown): string[] {
  const played = new Set(breakdown.brigades.map(slice => slice.label));
  return Object.keys(BRIGADE_SWATCHES)
    .filter(label => label !== 'Multi' && label !== 'Gold' && !played.has(label))
    .sort((a, b) => brigadeRank(a) - brigadeRank(b));
}
