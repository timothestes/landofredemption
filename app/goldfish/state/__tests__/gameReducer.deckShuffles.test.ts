// app/goldfish/state/__tests__/gameReducer.deckShuffles.test.ts
import { describe, it, expect } from 'vitest';
import { gameReducer } from '../gameReducer';
import { actions as gameActions } from '../gameActions';
import type { GameCard, GameState, GameAction } from '../../types';

// `deckShuffles` and `soulDeckShuffles` are what the canvas watches to play
// the shuffle animation. Every shuffle counts. When the same action also
// deals cards from the deck, the canvas holds the animation until they land.

function makeCard(overrides: Partial<GameCard>): GameCard {
  return {
    instanceId: 'c',
    cardName: 'Filler',
    cardSet: 'X',
    cardImgFile: '',
    type: 'Hero',
    brigade: '',
    strength: '',
    toughness: '',
    specialAbility: '',
    identifier: '',
    reference: '',
    alignment: '',
    isMeek: false,
    counters: [],
    isFlipped: false,
    isToken: false,
    zone: 'deck',
    ownerId: 'player1',
    notes: '',
    ...overrides,
  };
}

function makeState(cards: GameCard[]): GameState {
  const zones: GameState['zones'] = {
    deck: [], hand: [], reserve: [], discard: [], paragon: [],
    'land-of-bondage': [], 'soul-deck': [], territory: [], 'land-of-redemption': [], banish: [],
    battle: [],
  };
  for (const c of cards) zones[c.zone].push(c);
  return {
    zones,
    history: [],
    turn: 1,
    phase: 'preparation',
    drawnThisTurn: false,
    deckName: 'Test',
    deckFormat: 'T1',
    options: { autoRouteLostSouls: false } as any,
    isSpreadHand: false,
  } as unknown as GameState;
}

const deck = (n: number) =>
  Array.from({ length: n }, (_, i) => makeCard({ instanceId: `d${i}`, zone: 'deck', isFlipped: true }));
const hand = (ids: string[]) => ids.map((id) => makeCard({ instanceId: id, zone: 'hand' }));
const undo: GameAction = { id: 'u', type: 'RESET_GAME', playerId: 'player1', timestamp: 0, payload: { value: '__UNDO__' } };

describe('deck shuffle count', () => {
  it('starts absent and goes up by one for each shuffle', () => {
    const state = makeState(deck(10));
    expect(state.deckShuffles).toBeUndefined();
    const once = gameReducer(state, gameActions.shuffleDeck());
    expect(once.deckShuffles).toBe(1);
    expect(gameReducer(once, gameActions.shuffleDeck()).deckShuffles).toBe(2);
  });

  it('goes back down when the shuffle is undone', () => {
    const once = gameReducer(makeState(deck(10)), gameActions.shuffleDeck());
    const twice = gameReducer(once, gameActions.shuffleDeck());
    expect(gameReducer(twice, undo).deckShuffles).toBe(1);
    expect(gameReducer(gameReducer(twice, undo), undo).deckShuffles).toBeUndefined();
  });

  it('is gone after a new game, so the opening deal plays alone', () => {
    const played = gameReducer(makeState(deck(10)), gameActions.shuffleDeck());
    const fresh = makeState([...deck(10), ...hand(['h1', 'h2'])]);
    const restarted = gameReducer(played, {
      id: 'n', type: 'RESET_GAME', playerId: 'player1', timestamp: 0, payload: { value: JSON.stringify(fresh) },
    });
    expect(restarted.deckShuffles).toBeUndefined();
    expect(restarted.soulDeckShuffles).toBeUndefined();
  });

  it('is left alone by actions that do not shuffle', () => {
    const state = gameReducer(makeState(deck(10)), gameActions.shuffleDeck());
    expect(gameReducer(state, gameActions.drawCard()).deckShuffles).toBe(1);
    expect(gameReducer(state, gameActions.moveCardToBottomOfDeck('d0')).deckShuffles).toBe(1);
  });

  it('goes up for a shuffle that also deals a new hand', () => {
    // Philip's Daughters: keep one, shuffle the rest away, draw that many.
    const state = makeState([...hand(['keep', 'a', 'b', 'c']), ...deck(8)]);
    const next = gameReducer(state, gameActions.keepOneShuffleDraw('keep'));
    expect(next.zones.hand).toHaveLength(4);
    expect(next.deckShuffles).toBe(1);
  });

  it('goes up when that shuffle deals nothing', () => {
    // The same effect with the draw prevented.
    const state = makeState([...hand(['keep', 'a', 'b', 'c']), ...deck(8)]);
    const next = gameReducer(state, gameActions.keepOneShuffleDraw('keep', false));
    expect(next.zones.hand).toHaveLength(1);
    expect(next.deckShuffles).toBe(1);
  });

  it('goes up for a reset that sweeps everything in and draws eight', () => {
    const source = makeCard({ instanceId: 'nails', cardName: 'Three Nails (GoC)', zone: 'territory' });
    const state = makeState([source, ...hand(['h1']), ...deck(12)]);
    const next = gameReducer(state, gameActions.executeCardAbility('nails', 0));
    expect(next.zones.hand).toHaveLength(8);
    expect(next.deckShuffles).toBe(1);
  });

  it('goes up for that reset when the deck starts almost empty', () => {
    // The swept cards go into the deck and straight back out, so nothing
    // flies from the pile. The shuffle is then the only thing to show.
    const source = makeCard({ instanceId: 'nails', cardName: 'Three Nails (GoC)', zone: 'territory' });
    const state = makeState([source, ...hand(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']), ...deck(2)]);
    const next = gameReducer(state, gameActions.executeCardAbility('nails', 0));
    expect(next.deckShuffles).toBe(1);
  });

  it('goes up for a shuffle-and-draw ability', () => {
    const source = makeCard({ instanceId: 'mayhem', cardName: 'Mayhem', zone: 'territory' });
    const state = makeState([source, ...hand(['a', 'b', 'c', 'd', 'e', 'f']), ...deck(12)]);
    const next = gameReducer(state, gameActions.executeCardAbility('mayhem', 0));
    expect(next.zones.hand).toHaveLength(6);
    expect(next.deckShuffles).toBe(1);
  });

  it('goes up once when a card is shuffled into the deck', () => {
    // The context sends a move and then a shuffle.
    const state = makeState([...hand(['h1']), ...deck(6)]);
    const moved = gameReducer(state, gameActions.shuffleCardIntoDeck('h1'));
    expect(moved.deckShuffles).toBeUndefined();
    expect(gameReducer(moved, gameActions.shuffleDeck()).deckShuffles).toBe(1);
  });
});

describe('Soul Deck shuffle count', () => {
  const souls = (n: number) =>
    Array.from({ length: n }, (_, i) => makeCard({ instanceId: `s${i}`, type: 'Lost Soul', zone: 'soul-deck', isFlipped: true }));

  it('goes up for a Soul Deck shuffle and leaves the deck count alone', () => {
    const next = gameReducer(makeState([...souls(6), ...deck(5)]), gameActions.shuffleSoulDeck());
    expect(next.soulDeckShuffles).toBe(1);
    expect(next.deckShuffles).toBeUndefined();
  });

  it('is left alone by a deck shuffle', () => {
    const next = gameReducer(makeState([...souls(6), ...deck(5)]), gameActions.shuffleDeck());
    expect(next.soulDeckShuffles).toBeUndefined();
    expect(next.deckShuffles).toBe(1);
  });
});
