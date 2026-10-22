import { describe, it, expect } from 'vitest';
import {
  buildBreakdown,
  splitBrigades,
  cardBrigades,
  type BreakdownDeckInput,
} from '../breakdown';
import { topCutSize, cutIndexesByEvent, rankedDeckCount } from '../topCut';

function deck(
  deckId: string,
  place: number | null,
  cards: [name: string, zone: string, quantity: number][],
  event?: { id: string; name: string; endedAt: string | null },
): BreakdownDeckInput {
  return {
    deckId,
    participantId: deckId,
    playerName: deckId,
    place,
    event: event ?? null,
    cards: cards.map(([name, zone, quantity]) => ({
      name,
      set: null,
      imgFile: null,
      quantity,
      zone,
    })),
  };
}

const NATS = { id: 'nats', name: 'Nationals', endedAt: '2026-07-24T23:00:00Z' };
const LOCAL = { id: 'local', name: 'Local', endedAt: '2026-06-01T18:00:00Z' };

describe('splitBrigades', () => {
  it('splits a multi-brigade card into every colour it names', () => {
    expect(splitBrigades('Green/Gold').sort()).toEqual(['Gold', 'Green']);
  });

  it('treats a parenthesised qualifier as commentary, not a second brigade', () => {
    expect(splitBrigades('Gold (Green)')).toEqual(['Gold']);
  });

  it('falls back to the parenthesised content when nothing else is printed', () => {
    expect(splitBrigades('(Gold/Red)').sort()).toEqual(['Gold', 'Red']);
  });

  it('handles "and" as a separator', () => {
    expect(splitBrigades('Purple and Black').sort()).toEqual(['Black', 'Purple']);
  });

  it('returns nothing for a card with no brigade', () => {
    expect(splitBrigades('')).toEqual([]);
    expect(splitBrigades(undefined)).toEqual([]);
  });

  // The printed strings are messier than "Green/Gold". Each of these appears in
  // the card index and each produced a bogus brigade before the split widened.
  it('splits on "+"', () => {
    expect(splitBrigades('Black/Crimson+Gold').sort()).toEqual(['Black', 'Crimson', 'Gold']);
  });

  it('keeps two-word brigade names whole', () => {
    expect(splitBrigades('Brown/Pale Green').sort()).toEqual(['Brown', 'Pale Green']);
  });

  it('reads "Good Gold" as Gold rather than an alignment plus a brigade', () => {
    expect(splitBrigades('Good Gold')).toEqual(['Gold']);
  });

  it('splits a space-joined run of brigades', () => {
    expect(splitBrigades('Green/Teal Gold/Pale Green').sort()).toEqual([
      'Gold',
      'Green',
      'Pale Green',
      'Teal',
    ]);
  });

  it('drops tokens that do not name a brigade', () => {
    expect(splitBrigades('Good')).toEqual([]);
    expect(splitBrigades('Crimson and White/Purple').sort()).toEqual([
      'Crimson',
      'Purple',
      'White',
    ]);
  });
});

describe('topCutSize', () => {
  it('reads a value below 1 as a fraction of the field', () => {
    expect(topCutSize(62, 0.25)).toBe(16);
  });

  it('reads a value of 1 or more as a deck count', () => {
    expect(topCutSize(62, 8)).toBe(8);
  });

  it('never exceeds the field', () => {
    expect(topCutSize(6, 8)).toBe(6);
  });
});

describe('cutIndexesByEvent', () => {
  const ranked = (places: (number | null)[], eventIds?: (string | null)[]) =>
    places.map((place, i) => ({ place, eventId: eventIds?.[i] }));

  it('ranks the whole pool when no deck carries an event', () => {
    // The single-tournament page: one group, so this is a plain top-N.
    const cut = cutIndexesByEvent(ranked([3, 1, 4, 2]), 2);
    expect([...cut].sort()).toEqual([1, 3]);
  });

  it('leaves decks with no recorded finish out of the cut', () => {
    const cut = cutIndexesByEvent(ranked([1, null, 2]), 8);
    expect([...cut].sort()).toEqual([0, 2]);
  });

  it('draws the cut inside each event rather than across the pool', () => {
    // Two events; the local event's winner placed 1st there but would rank
    // below Nationals' top four if the pool were ranked as one field.
    const cut = cutIndexesByEvent(
      ranked([1, 2, 3, 4, 1, 2], ['n', 'n', 'n', 'n', 'l', 'l']),
      0.5,
    );
    // Top half of each: Nationals #1–2, local #1.
    expect([...cut].sort((a, b) => a - b)).toEqual([0, 1, 4]);
  });

  // The reason cross-event cuts are fractions and not counts. With "top 8"
  // applied per event, a 4-player event would contribute its entire field to
  // the cut and outweigh the larger event it is pooled with.
  it('does not let a small event flood the cut', () => {
    const places = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2];
    const events = [...Array(10).fill('big'), 'small', 'small'];
    const cut = cutIndexesByEvent(ranked(places, events), 0.25);

    const fromBig = [...cut].filter((i) => i < 10).length;
    const fromSmall = [...cut].filter((i) => i >= 10).length;
    expect(fromBig).toBe(3); // round(10 * 0.25)
    expect(fromSmall).toBe(1); // round(2 * 0.25) floors to 0, clamped to 1
    expect(fromSmall).toBeLessThan(fromBig);
  });

  it('counts only placed decks as rankable', () => {
    expect(rankedDeckCount(ranked([1, null, 3, null]))).toBe(2);
  });
});

describe('cardBrigades', () => {
  it('tells Gold apart by the card\'s alignment', () => {
    expect(cardBrigades('Gold', 'Good')).toEqual(['Good Gold']);
    expect(cardBrigades('Gold', 'Evil')).toEqual(['Evil Gold']);
    expect(cardBrigades('Crimson/Gold', 'Evil').sort()).toEqual(['Crimson', 'Evil Gold']);
    expect(cardBrigades('Gold/Red', 'Good').sort()).toEqual(['Good Gold', 'Red']);
  });

  it('leaves neutral Gold, and every other brigade, as printed', () => {
    expect(cardBrigades('Gold', 'Neutral')).toEqual(['Gold']);
    expect(cardBrigades('Gold', undefined)).toEqual(['Gold']);
    expect(cardBrigades('Green', 'Good')).toEqual(['Green']);
  });
});

describe('buildBreakdown', () => {
  it('splits Gold into good and evil in both the field and per-deck tallies', () => {
    const result = buildBreakdown([
      deck('a', 1, [['Abdon', 'main', 2], ['Abusive Taskmasters', 'main', 1], ['Chorazin', 'main', 1]]),
    ]);
    expect(result.brigades.map((b) => [b.label, b.copies]).sort()).toEqual([
      ['Evil Gold', 1], ['Gold', 1], ['Good Gold', 2],
    ]);
    expect(result.decks[0].brigades.map((b) => b.label).sort()).toEqual(['Evil Gold', 'Gold', 'Good Gold']);
  });

  it('counts a deck once per card however many copies it runs', () => {
    const result = buildBreakdown([
      deck('a', 1, [['Angel of the Lord (J)', 'main', 3]]),
      deck('b', 2, [['Angel of the Lord (J)', 'main', 1]]),
    ]);
    const card = result.cards.find((c) => c.name === 'Angel of the Lord');
    expect(card?.deckIndexes).toHaveLength(2);
    expect(card?.copies).toBe(4);
  });

  it('merges printings of one card into a single row', () => {
    const result = buildBreakdown([
      deck('a', 1, [['Son of God (J)', 'main', 1]]),
      deck('b', 2, [['Son of God [Fundraiser]', 'main', 1]]),
      deck('c', 3, [['Son of God "Manger" (Promo)', 'main', 1]]),
    ]);
    const sonOfGod = result.cards.filter((c) => c.name === 'Son of God');
    expect(sonOfGod).toHaveLength(1);
    expect(sonOfGod[0].deckIndexes).toHaveLength(3);
    expect(sonOfGod[0].printings).toHaveLength(3);
  });

  it('splits main and reserve copies of the same card', () => {
    const result = buildBreakdown([
      deck('a', 1, [
        ['Foreign Wives', 'main', 1],
        ['Foreign Wives', 'reserve', 2],
      ]),
    ]);
    const card = result.cards.find((c) => c.name === 'Foreign Wives');
    expect(card?.mainCopies).toBe(1);
    expect(card?.reserveCopies).toBe(2);
    expect(card?.reserveDecks).toBe(1);
    // Still one deck, not two.
    expect(card?.deckIndexes).toEqual([0]);
  });

  it('ignores the maybeboard, which is never part of a submitted list', () => {
    const result = buildBreakdown([
      deck('a', 1, [
        ['Angel of the Lord (J)', 'main', 1],
        ['The Second Coming', 'maybeboard', 1],
      ]),
    ]);
    expect(result.cards.map((c) => c.name)).toEqual(['Angel of the Lord']);
    expect(result.decks[0].mainSize).toBe(1);
  });

  it('scores spice from cards no other deck played', () => {
    const result = buildBreakdown([
      // Two shared cards, one card only this deck plays.
      deck('a', 1, [
        ['Angel of the Lord (J)', 'main', 1],
        ['The Second Coming', 'main', 1],
        ['Three Woes (RoJ)', 'main', 1],
      ]),
      deck('b', 2, [
        ['Angel of the Lord (J)', 'main', 1],
        ['The Second Coming', 'main', 1],
      ]),
    ]);
    const a = result.decks.find((d) => d.deckId === 'a');
    const b = result.decks.find((d) => d.deckId === 'b');
    expect(a?.uniqueCards).toBe(1);
    expect(a?.spice).toBeCloseTo(1 / 3);
    expect(b?.uniqueCards).toBe(0);
    expect(b?.spice).toBe(0);
  });

  it('ranks nearest neighbours by shared-card overlap', () => {
    const result = buildBreakdown([
      deck('a', 1, [
        ['Angel of the Lord (J)', 'main', 1],
        ['The Second Coming', 'main', 1],
      ]),
      // Identical to a.
      deck('b', 2, [
        ['Angel of the Lord (J)', 'main', 1],
        ['The Second Coming', 'main', 1],
      ]),
      // Shares nothing.
      deck('c', 3, [['Three Woes (RoJ)', 'main', 1]]),
    ]);
    const a = result.decks.find((d) => d.deckId === 'a');
    expect(a?.neighbors[0].deckId).toBe('b');
    expect(a?.neighbors[0].similarity).toBe(1);
    expect(a?.neighbors[a.neighbors.length - 1].similarity).toBe(0);
  });

  it('counts a multi-brigade card toward each of its brigades', () => {
    // A Royal Priesthood is Green/Purple/Teal — one card, three brigades.
    const result = buildBreakdown([deck('a', 1, [['A Royal Priesthood', 'main', 2]])]);
    expect(result.brigades.map((b) => b.label).sort()).toEqual(['Green', 'Purple', 'Teal']);
    for (const brigade of result.brigades) {
      expect(brigade.decks).toBe(1);
      expect(brigade.copies).toBe(2);
    }
  });

  it('tallies each deck\'s own cards by brigade', () => {
    const result = buildBreakdown([
      deck('a', 1, [['A Royal Priesthood', 'main', 2], ['Angel of the Lord (J)', 'main', 1]]),
      deck('b', 2, [['Angel of the Lord (J)', 'main', 1]]),
    ]);
    expect(result.decks[0].brigades).toEqual([
      { label: 'Green', cards: 1, copies: 2 },
      { label: 'Purple', cards: 1, copies: 2 },
      { label: 'Teal', cards: 1, copies: 2 },
    ]);
    expect(result.decks[1].brigades).toEqual([]);
  });

  it('leaves a brigade-less Dominant out of the brigade tally', () => {
    const result = buildBreakdown([deck('a', 1, [['Angel of the Lord (J)', 'main', 1]])]);
    expect(result.brigades).toEqual([]);
    expect(result.types.find((t) => t.label === 'Dominant')?.decks).toBe(1);
  });

  it('reports median main size and Lost Soul count', () => {
    const result = buildBreakdown([
      deck('a', 1, [
        ['Angel of the Lord (J)', 'main', 10],
        ['Lost Soul "Wicked" [Genesis 6:5]', 'main', 7],
      ]),
      deck('b', 2, [
        ['Angel of the Lord (J)', 'main', 20],
        ['Lost Soul "Wicked" [Genesis 6:5]', 'main', 9],
      ]),
    ]);
    expect(result.medianMainSize).toBe((17 + 29) / 2);
    expect(result.medianLostSouls).toBe(8);
  });

  it('keeps unknown cards distinct instead of pooling them', () => {
    const result = buildBreakdown([
      deck('a', 1, [
        ['Some Forge Card', 'main', 1],
        ['Another Forge Card', 'main', 1],
      ]),
    ]);
    expect(result.cards).toHaveLength(2);
  });

  // Two players can bring the same list — it happened at the 2026 Nationals.
  // That list occupied two seats in the field and can take two slots in a cut,
  // so it counts twice. The unit of analysis is the entry, not the distinct
  // list, and the two entries surface as 100% neighbours rather than one of
  // them being collapsed away.
  it('counts two players on one decklist as two entries', () => {
    const shared: [string, string, number][] = [
      ['Angel of the Lord (J)', 'main', 1],
      ['The Second Coming', 'main', 1],
    ];
    const result = buildBreakdown([
      { ...deck('luke', 4, shared), deckId: 'shared-deck', participantId: 'p-luke' },
      { ...deck('nic', 9, shared), deckId: 'shared-deck', participantId: 'p-nic' },
    ]);

    expect(result.deckCount).toBe(2);
    expect(result.decks.map((d) => d.participantId)).toEqual(['p-luke', 'p-nic']);
    // Both entries play it, so it is at 100% of the field, not 50%.
    const card = result.cards.find((c) => c.name === 'Angel of the Lord');
    expect(card?.deckIndexes).toHaveLength(2);
    expect(result.decks[0].neighbors[0].similarity).toBe(1);
  });

  // ─── Cross-event pooling (the Metagame view) ───────────────────────

  it('summarises the events feeding a pool, newest first', () => {
    const result = buildBreakdown([
      deck('a', 1, [['Angel of the Lord (J)', 'main', 1]], LOCAL),
      deck('b', 1, [['Angel of the Lord (J)', 'main', 1]], NATS),
      deck('c', 2, [['Angel of the Lord (J)', 'main', 1]], NATS),
    ]);

    expect(result.events.map((e) => [e.name, e.deckCount])).toEqual([
      ['Nationals', 2],
      ['Local', 1],
    ]);
  });

  it('reports no events for a single-tournament pool', () => {
    const result = buildBreakdown([deck('a', 1, [['Angel of the Lord (J)', 'main', 1]])]);
    expect(result.events).toEqual([]);
  });

  it('pools entries from different events into one card row', () => {
    const result = buildBreakdown([
      deck('a', 1, [['Son of God (J)', 'main', 1]], NATS),
      deck('b', 1, [['Son of God [Fundraiser]', 'main', 1]], LOCAL),
    ]);

    const card = result.cards.find((c) => c.name === 'Son of God');
    expect(card?.deckIndexes).toHaveLength(2);
    // Both events' entries count toward the same denominator.
    expect(result.deckCount).toBe(2);
  });

  it('names the event a neighbouring list came from', () => {
    const shared: [string, string, number][] = [
      ['Angel of the Lord (J)', 'main', 1],
      ['The Second Coming', 'main', 1],
    ];
    const result = buildBreakdown([
      deck('a', 1, shared, NATS),
      deck('b', 1, shared, LOCAL),
    ]);

    // A near-identical list from another event is the finding worth surfacing,
    // so the neighbour carries its origin rather than just a player name.
    expect(result.decks[0].neighbors[0]).toMatchObject({
      eventName: 'Local',
      similarity: 1,
    });
    expect(result.decks[0].event?.name).toBe('Nationals');
  });

  it('returns an empty shape for a field with no decks', () => {
    const result = buildBreakdown([]);
    expect(result.deckCount).toBe(0);
    expect(result.cards).toEqual([]);
    expect(result.medianMainSize).toBe(0);
  });
});
