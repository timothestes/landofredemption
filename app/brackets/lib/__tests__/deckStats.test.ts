import { describe, it, expect } from 'vitest';
import type { BreakdownCard, BreakdownDeck, TournamentBreakdown } from '@/lib/tournament/breakdown';
import { sharedCore, signatureCards, twinsAndLoners, unplayedBrigades } from '../deckStats';

const card = (name: string, deckIndexes: number[], over: Partial<BreakdownCard> = {}): BreakdownCard => ({
  key: name, name, type: 'Hero', brigade: 'Gold', alignment: 'Good', imgFile: '', deckIndexes,
  copies: deckIndexes.length, mainCopies: deckIndexes.length, reserveCopies: 0, reserveDecks: 0, printings: [name],
  ...over,
});

const deck = (id: string, neighbors: { participantId: string; similarity: number }[]): BreakdownDeck => ({
  deckId: id, participantId: id, playerName: id, place: null, event: null,
  mainSize: 50, reserveSize: 0, lostSouls: 7, distinctCards: 10, uniqueCards: 0, spice: 0, brigades: [],
  neighbors: neighbors.map(n => ({ deckId: n.participantId, participantId: n.participantId, playerName: n.participantId, eventName: null, similarity: n.similarity })),
});

const breakdown = (
  decks: BreakdownDeck[], cards: BreakdownCard[], brigades: TournamentBreakdown['brigades'] = [],
): TournamentBreakdown => ({
  deckCount: decks.length, cardCount: cards.length, distinctCards: cards.length, totalCopies: 0,
  medianMainSize: 50, medianLostSouls: 7, decks, cards, brigades, types: [], alignments: [], events: [],
});

const threeDecks = [
  deck('e1', [{ participantId: 'e2', similarity: 0.6 }, { participantId: 'e3', similarity: 0.1 }]),
  deck('e2', [{ participantId: 'e1', similarity: 0.6 }, { participantId: 'e3', similarity: 0.2 }]),
  deck('e3', [{ participantId: 'e2', similarity: 0.2 }, { participantId: 'e1', similarity: 0.1 }]),
];

describe('sharedCore', () => {
  it('lists cards in two or more decks, most shared first, with one flag per deck', () => {
    const rows = sharedCore(breakdown(threeDecks, [
      card('Only e3', [2]),
      card('Pair', [0, 1]),
      card('Everyone', [0, 1, 2]),
    ]));
    expect(rows.map(r => r.card.name)).toEqual(['Everyone', 'Pair']);
    expect(rows[1].runs).toEqual([true, true, false]);
    expect(rows[1].count).toBe(2);
  });
});

describe('signatureCards', () => {
  it('gives each deck the cards nobody else runs, most copies first', () => {
    const rows = signatureCards(breakdown(threeDecks, [
      card('Everyone', [0, 1, 2]),
      card('One copy', [2]),
      card('Three copies', [2], { copies: 3 }),
      card('Only e1', [0]),
    ]));
    expect(rows[0].cards.map(c => c.name)).toEqual(['Only e1']);
    expect(rows[1].cards).toEqual([]);
    expect(rows[2].cards.map(c => c.name)).toEqual(['Three copies', 'One copy']);
  });
});

describe('twinsAndLoners', () => {
  it('finds the closest pair and the deck furthest from everyone', () => {
    const { pair, loner } = twinsAndLoners(breakdown(threeDecks, []));
    expect(pair).toMatchObject({ similarity: 0.6 });
    expect([pair!.a.participantId, pair!.b.participantId].sort()).toEqual(['e1', 'e2']);
    expect(loner).toMatchObject({ nearest: 0.2 });
    expect(loner!.deck.participantId).toBe('e3');
  });

  it('has no loner with two decks and no pair when nothing overlaps', () => {
    const two = breakdown([
      deck('e1', [{ participantId: 'e2', similarity: 0.3 }]),
      deck('e2', [{ participantId: 'e1', similarity: 0.3 }]),
    ], []);
    expect(twinsAndLoners(two)).toEqual({ pair: expect.objectContaining({ similarity: 0.3 }), loner: null });
    const apart = breakdown([
      deck('e1', [{ participantId: 'e2', similarity: 0 }]),
      deck('e2', [{ participantId: 'e1', similarity: 0 }]),
    ], []);
    expect(twinsAndLoners(apart)).toEqual({ pair: null, loner: null });
  });

  it('has no loner when every deck is equally close', () => {
    const even = breakdown([
      deck('e1', [{ participantId: 'e2', similarity: 0.4 }, { participantId: 'e3', similarity: 0.4 }]),
      deck('e2', [{ participantId: 'e1', similarity: 0.4 }, { participantId: 'e3', similarity: 0.4 }]),
      deck('e3', [{ participantId: 'e1', similarity: 0.4 }, { participantId: 'e2', similarity: 0.4 }]),
    ], []);
    expect(twinsAndLoners(even).loner).toBeNull();
  });
});

describe('unplayedBrigades', () => {
  it('lists the brigades nobody brought, good before evil, without Multi', () => {
    const unplayed = unplayedBrigades(breakdown(threeDecks, [], [
      { label: 'Gold', decks: 3, copies: 30 }, { label: 'Crimson', decks: 1, copies: 4 }, { label: 'Multi', decks: 1, copies: 1 },
    ]));
    expect(unplayed).toEqual([
      'Blue', 'Clay', 'Green', 'Purple', 'Red', 'Silver', 'Teal', 'White',
      'Black', 'Brown', 'Gray', 'Orange', 'Pale Green',
    ]);
    expect(unplayed).not.toContain('Multi');
  });
});
