/**
 * Metagame aggregation for a tournament's published decklists.
 *
 * Pure functions over already-fetched rows — no Supabase, no React — so the
 * numbers can be tested directly.
 *
 * The payload deliberately ships a deck→card incidence list rather than
 * finished percentages. Top-cut representation is the one figure that depends
 * on where the cut is drawn, and that is a control the reader operates; sending
 * the incidence lets the client recompute for any cutoff without a round trip.
 * At tournament scale (62 decks, ~1000 distinct cards) that is a few thousand
 * integers.
 */

import { identityKeyForName, representativeCard, cardNameStem } from '@/lib/cards/cardIdentity';
import { cardBrigades } from './brigades';

// Importable from here as before; the implementation lives in a module with no card-index
// import so client components (the deck stats panels) can use it.
export { splitBrigades, cardBrigades } from './brigades';

export type DeckZone = 'main' | 'reserve' | 'maybeboard' | string;

export interface BreakdownCardInput {
  name: string;
  set: string | null;
  imgFile: string | null;
  quantity: number;
  zone: DeckZone;
}

/**
 * The event an entry came from.
 *
 * Absent when the whole pool is one tournament — the single-event page has
 * nothing to disambiguate. Present on the cross-event Metagame view, where a
 * placement is only readable next to the field it was earned in.
 */
export interface BreakdownEvent {
  id: string;
  name: string;
  endedAt: string | null;
}

export interface BreakdownDeckInput {
  deckId: string;
  /** Unique per entry — two players can bring the same deckId. */
  participantId: string;
  playerName: string | null;
  place: number | null;
  event?: BreakdownEvent | null;
  cards: BreakdownCardInput[];
}

/** One brigade's share of a single deck. */
export interface DeckBrigadeSlice {
  label: string;
  /** Distinct cards of this brigade in the deck. */
  cards: number;
  copies: number;
}

export interface BreakdownDeck {
  deckId: string;
  participantId: string;
  playerName: string | null;
  place: number | null;
  event: BreakdownEvent | null;
  mainSize: number;
  reserveSize: number;
  lostSouls: number;
  distinctCards: number;
  /** Cards in this deck that no other deck in the field played. */
  uniqueCards: number;
  /** Share of the deck's distinct cards that are unique to it, 0–1. */
  spice: number;
  /**
   * The deck's own cards by brigade, most copies first. A multi-brigade card
   * counts toward each brigade it names; brigadeless cards (Lost Souls, most
   * Dominants) are left out.
   */
  brigades: DeckBrigadeSlice[];
  /** Closest decks by Jaccard overlap on distinct cards, nearest first. */
  neighbors: {
    deckId: string;
    participantId: string;
    playerName: string | null;
    eventName: string | null;
    similarity: number;
  }[];
}

export interface BreakdownCard {
  key: string;
  name: string;
  type: string;
  brigade: string;
  alignment: string;
  imgFile: string;
  /** Indexes into `decks` for every deck playing this card. */
  deckIndexes: number[];
  copies: number;
  mainCopies: number;
  reserveCopies: number;
  /** Decks running at least one copy in the reserve. */
  reserveDecks: number;
  /** Distinct printings of this card that were actually played. */
  printings: string[];
}

export interface BreakdownSlice {
  label: string;
  decks: number;
  copies: number;
}

export interface TournamentBreakdown {
  deckCount: number;
  cardCount: number;
  distinctCards: number;
  totalCopies: number;
  medianMainSize: number;
  medianLostSouls: number;
  decks: BreakdownDeck[];
  cards: BreakdownCard[];
  brigades: BreakdownSlice[];
  types: BreakdownSlice[];
  alignments: BreakdownSlice[];
  /**
   * Events contributing entries, newest first. Empty when the pool carries no
   * event tags at all, which is the single-tournament case.
   */
  events: (BreakdownEvent & { deckCount: number })[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function isLostSoul(type: string): boolean {
  const lower = type.toLowerCase();
  // "Lost Soul Token" is not a deck card — only the real thing counts.
  return lower === 'lost soul';
}

export function buildBreakdown(input: BreakdownDeckInput[]): TournamentBreakdown {
  // Maybeboard is a scratchpad, never part of a submitted list.
  const decksInput = input.map((deck) => ({
    ...deck,
    cards: deck.cards.filter((c) => c.zone !== 'maybeboard' && c.quantity > 0),
  }));

  interface Accumulator {
    key: string;
    name: string;
    type: string;
    brigade: string;
    alignment: string;
    imgFile: string;
    deckIndexes: number[];
    copies: number;
    mainCopies: number;
    reserveCopies: number;
    reserveDecks: number;
    printings: Set<string>;
  }

  const byKey = new Map<string, Accumulator>();
  const deckCardKeys: Set<string>[] = [];
  const deckStats = decksInput.map(() => ({ mainSize: 0, reserveSize: 0, lostSouls: 0 }));
  const deckBrigades = decksInput.map(() => new Map<string, { cards: Set<string>; copies: number }>());

  decksInput.forEach((deck, deckIndex) => {
    const keysInDeck = new Set<string>();
    const reserveKeysInDeck = new Set<string>();

    for (const row of deck.cards) {
      const key = identityKeyForName(row.name, row.set ?? undefined, row.imgFile ?? undefined);
      const representative = representativeCard(key);
      const type = representative?.type ?? '';

      if (row.zone === 'reserve') {
        deckStats[deckIndex].reserveSize += row.quantity;
        reserveKeysInDeck.add(key);
      } else {
        deckStats[deckIndex].mainSize += row.quantity;
      }
      if (isLostSoul(type)) deckStats[deckIndex].lostSouls += row.quantity;

      for (const brigade of cardBrigades(representative?.brigade, representative?.alignment)) {
        let slice = deckBrigades[deckIndex].get(brigade);
        if (!slice) {
          slice = { cards: new Set<string>(), copies: 0 };
          deckBrigades[deckIndex].set(brigade, slice);
        }
        slice.cards.add(key);
        slice.copies += row.quantity;
      }

      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          key,
          name: representative
            ? cardNameStem(representative.name, representative.type)
            : cardNameStem(row.name),
          type,
          brigade: representative?.brigade ?? '',
          alignment: representative?.alignment ?? '',
          imgFile: representative?.imgFile ?? row.imgFile ?? '',
          deckIndexes: [],
          copies: 0,
          mainCopies: 0,
          reserveCopies: 0,
          reserveDecks: 0,
          printings: new Set<string>(),
        };
        byKey.set(key, entry);
      }

      entry.copies += row.quantity;
      if (row.zone === 'reserve') entry.reserveCopies += row.quantity;
      else entry.mainCopies += row.quantity;
      entry.printings.add(row.name);

      // A deck counts once toward a card no matter how many copies or zones it
      // spreads them across.
      if (!keysInDeck.has(key)) {
        keysInDeck.add(key);
        entry.deckIndexes.push(deckIndex);
      }
    }

    for (const key of reserveKeysInDeck) {
      const entry = byKey.get(key);
      if (entry) entry.reserveDecks += 1;
    }

    deckCardKeys.push(keysInDeck);
  });

  const cards: BreakdownCard[] = [...byKey.values()]
    .map((entry) => ({
      key: entry.key,
      name: entry.name,
      type: entry.type,
      brigade: entry.brigade,
      alignment: entry.alignment,
      imgFile: entry.imgFile,
      deckIndexes: entry.deckIndexes,
      copies: entry.copies,
      mainCopies: entry.mainCopies,
      reserveCopies: entry.reserveCopies,
      reserveDecks: entry.reserveDecks,
      printings: [...entry.printings].sort(),
    }))
    .sort((a, b) => b.deckIndexes.length - a.deckIndexes.length || a.name.localeCompare(b.name));

  // Cards played by exactly one deck — the raw material for a spice score.
  const singletonKeys = new Set(
    cards.filter((c) => c.deckIndexes.length === 1).map((c) => c.key),
  );

  const decks: BreakdownDeck[] = decksInput.map((deck, index) => {
    const keys = deckCardKeys[index];
    let uniqueCards = 0;
    for (const key of keys) if (singletonKeys.has(key)) uniqueCards += 1;

    const neighbors = decksInput
      .map((other, otherIndex) => {
        if (otherIndex === index) return null;
        const otherKeys = deckCardKeys[otherIndex];
        let shared = 0;
        for (const key of keys) if (otherKeys.has(key)) shared += 1;
        const union = keys.size + otherKeys.size - shared;
        return {
          deckId: other.deckId,
          participantId: other.participantId,
          playerName: other.playerName,
          eventName: other.event?.name ?? null,
          similarity: union === 0 ? 0 : shared / union,
        };
      })
      .filter((n): n is NonNullable<typeof n> => n !== null)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);

    return {
      deckId: deck.deckId,
      participantId: deck.participantId,
      playerName: deck.playerName,
      place: deck.place,
      event: deck.event ?? null,
      mainSize: deckStats[index].mainSize,
      reserveSize: deckStats[index].reserveSize,
      lostSouls: deckStats[index].lostSouls,
      distinctCards: keys.size,
      uniqueCards,
      spice: keys.size === 0 ? 0 : uniqueCards / keys.size,
      brigades: [...deckBrigades[index].entries()]
        .map(([label, slice]) => ({ label, cards: slice.cards.size, copies: slice.copies }))
        .sort((a, b) => b.copies - a.copies || a.label.localeCompare(b.label)),
      neighbors,
    };
  });

  const brigadeTally = new Map<string, { decks: Set<number>; copies: number }>();
  const typeTally = new Map<string, { decks: Set<number>; copies: number }>();
  const alignmentTally = new Map<string, { decks: Set<number>; copies: number }>();

  const tally = (
    target: Map<string, { decks: Set<number>; copies: number }>,
    label: string,
    card: BreakdownCard,
  ) => {
    let entry = target.get(label);
    if (!entry) {
      entry = { decks: new Set<number>(), copies: 0 };
      target.set(label, entry);
    }
    entry.copies += card.copies;
    for (const deckIndex of card.deckIndexes) entry.decks.add(deckIndex);
  };

  for (const card of cards) {
    for (const brigade of cardBrigades(card.brigade, card.alignment)) tally(brigadeTally, brigade, card);
    if (card.type) tally(typeTally, card.type, card);
    const alignment = card.alignment.trim();
    if (alignment) tally(alignmentTally, alignment, card);
  }

  // Which events fed this pool, and how much each contributed — the reader
  // needs that to judge whether "the metagame" is one big event or several.
  const eventTally = new Map<string, BreakdownEvent & { deckCount: number }>();
  for (const deck of decksInput) {
    if (!deck.event) continue;
    const existing = eventTally.get(deck.event.id);
    if (existing) existing.deckCount += 1;
    else eventTally.set(deck.event.id, { ...deck.event, deckCount: 1 });
  }
  const events = [...eventTally.values()].sort((a, b) => {
    const aTime = a.endedAt ? new Date(a.endedAt).getTime() : 0;
    const bTime = b.endedAt ? new Date(b.endedAt).getTime() : 0;
    return bTime - aTime || a.name.localeCompare(b.name);
  });

  const toSlices = (source: Map<string, { decks: Set<number>; copies: number }>): BreakdownSlice[] =>
    [...source.entries()]
      .map(([label, value]) => ({ label, decks: value.decks.size, copies: value.copies }))
      .sort((a, b) => b.copies - a.copies || a.label.localeCompare(b.label));

  return {
    deckCount: decksInput.length,
    cardCount: cards.length,
    distinctCards: cards.length,
    totalCopies: cards.reduce((sum, c) => sum + c.copies, 0),
    medianMainSize: median(deckStats.map((d) => d.mainSize)),
    medianLostSouls: median(deckStats.map((d) => d.lostSouls)),
    decks,
    cards,
    brigades: toSlices(brigadeTally),
    types: toSlices(typeTally),
    alignments: toSlices(alignmentTally),
    events,
  };
}
