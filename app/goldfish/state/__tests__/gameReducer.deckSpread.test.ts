import { describe, it, expect } from 'vitest';
import { gameReducer } from '../gameReducer';
import type { GameCard, GameState, GameAction } from '../../types';

function makeCard(overrides: Partial<GameCard> & { instanceId: string }): GameCard {
  return {
    cardName: overrides.instanceId,
    cardSet: 'T',
    cardImgFile: 'X',
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
    isFlipped: true,
    isToken: false,
    zone: 'deck',
    ownerId: 'player1',
    notes: '',
    ...overrides,
  };
}

function makeState(cards: GameCard[], extra: Partial<GameState> = {}): GameState {
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
    format: 'T1',
    options: { autoRouteLostSouls: false } as any,
    isSpreadHand: false,
    ...extra,
  } as unknown as GameState;
}

function act(type: GameAction['type'], payload: GameAction['payload'] = {}): GameAction {
  return { id: 'a', type, playerId: 'player1', timestamp: 0, payload };
}

const POS = {
  a: { posX: 10, posY: 20 },
  b: { posX: 10, posY: 60 },
  c: { posX: 150, posY: 20 },
};

function spread(state: GameState, ids = ['c', 'a', 'b']): GameState {
  return gameReducer(state, act('DECK_SPREAD', { cardInstanceIds: ids, positions: POS }));
}

describe('DECK_SPREAD', () => {
  it('moves the whole pile to Territory face-up at the given positions, in the given order', () => {
    const state = makeState([makeCard({ instanceId: 'a' }), makeCard({ instanceId: 'b' }), makeCard({ instanceId: 'c' })]);
    const next = spread(state);
    expect(next.zones.deck).toEqual([]);
    expect(next.zones.territory.map(c => c.instanceId)).toEqual(['c', 'a', 'b']);
    for (const card of next.zones.territory) {
      expect(card.zone).toBe('territory');
      expect(card.isFlipped).toBe(false);
      expect({ posX: card.posX, posY: card.posY }).toEqual(POS[card.instanceId as keyof typeof POS]);
    }
  });

  it('records the spread ids and pushes one history entry', () => {
    const state = makeState([makeCard({ instanceId: 'a' }), makeCard({ instanceId: 'b' }), makeCard({ instanceId: 'c' })]);
    const next = spread(state);
    expect(next.deckSpreadIds).toEqual(['c', 'a', 'b']);
    expect(next.history).toHaveLength(1);
  });

  it('is a no-op on an empty pile', () => {
    const state = makeState([makeCard({ instanceId: 'h', zone: 'hand' })]);
    const next = spread(state, ['h']);
    expect(next).toBe(state);
  });

  it('only takes cards that are actually in the pile', () => {
    const state = makeState([makeCard({ instanceId: 'a' }), makeCard({ instanceId: 'h', zone: 'hand', isFlipped: false })]);
    const next = gameReducer(state, act('DECK_SPREAD', {
      cardInstanceIds: ['a', 'h'],
      positions: { a: POS.a, h: POS.b },
    }));
    expect(next.zones.territory.map(c => c.instanceId)).toEqual(['a']);
    expect(next.zones.hand.map(c => c.instanceId)).toEqual(['h']);
    expect(next.deckSpreadIds).toEqual(['a']);
  });

  it('leaves cards already in Territory where they were', () => {
    const resident = makeCard({ instanceId: 't', zone: 'territory', isFlipped: false, posX: 400, posY: 300 });
    const state = makeState([resident, makeCard({ instanceId: 'a' })]);
    const next = gameReducer(state, act('DECK_SPREAD', { cardInstanceIds: ['a'], positions: { a: POS.a } }));
    expect(next.zones.territory.map(c => c.instanceId)).toEqual(['t', 'a']);
    expect(next.zones.territory[0]).toMatchObject({ posX: 400, posY: 300 });
  });
});

describe('DECK_GATHER', () => {
  it('returns the spread cards to the pile face-down with in-play state cleared', () => {
    const state = spread(makeState([makeCard({ instanceId: 'a' }), makeCard({ instanceId: 'b' }), makeCard({ instanceId: 'c' })]));
    // The player fiddled with a spread card while it was out.
    const fiddled = gameReducer(gameReducer(state,
      act('MEEK_CARD', { cardInstanceId: 'a' })),
      act('ADD_COUNTER', { cardInstanceId: 'a', color: 'red' }));
    const next = gameReducer(fiddled, act('DECK_GATHER'));
    expect(next.zones.territory).toEqual([]);
    expect(next.zones.deck.map(c => c.instanceId).sort()).toEqual(['a', 'b', 'c']);
    for (const card of next.zones.deck) {
      expect(card.zone).toBe('deck');
      expect(card.isFlipped).toBe(true);
      expect(card.isMeek).toBe(false);
      expect(card.counters).toEqual([]);
      expect(card.posX).toBeUndefined();
      expect(card.posY).toBeUndefined();
    }
  });

  it('clears the spread ids and pushes one history entry', () => {
    const state = spread(makeState([makeCard({ instanceId: 'a' }), makeCard({ instanceId: 'b' }), makeCard({ instanceId: 'c' })]));
    const next = gameReducer(state, act('DECK_GATHER'));
    expect(next.deckSpreadIds).toBeUndefined();
    expect(next.history).toHaveLength(state.history.length + 1);
  });

  it('is a no-op when nothing is spread', () => {
    const state = makeState([makeCard({ instanceId: 'a' })]);
    const next = gameReducer(state, act('DECK_GATHER'));
    expect(next).toBe(state);
  });

  it('unlinks a weapon the player attached to a spread card and leaves the weapon in Territory', () => {
    const weapon = makeCard({ instanceId: 'w', zone: 'territory', isFlipped: false, posX: 0, posY: 0 });
    const state = spread(makeState([weapon, makeCard({ instanceId: 'a' }), makeCard({ instanceId: 'b' }), makeCard({ instanceId: 'c' })]));
    const attached = gameReducer(state, act('ATTACH_CARD', { cardInstanceId: 'w', warriorInstanceId: 'a' }));
    expect(attached.zones.territory.find(c => c.instanceId === 'w')?.equippedTo).toBe('a');
    const next = gameReducer(attached, act('DECK_GATHER'));
    expect(next.zones.territory.map(c => c.instanceId)).toEqual(['w']);
    expect(next.zones.territory[0].equippedTo).toBeUndefined();
    expect(next.zones.deck.map(c => c.instanceId).sort()).toEqual(['a', 'b', 'c']);
  });

  it('unlinks a spread card the player attached to a resident warrior', () => {
    const warrior = makeCard({ instanceId: 'h', zone: 'territory', isFlipped: false, posX: 0, posY: 0 });
    const state = spread(makeState([warrior, makeCard({ instanceId: 'a' }), makeCard({ instanceId: 'b' }), makeCard({ instanceId: 'c' })]));
    const attached = gameReducer(state, act('ATTACH_CARD', { cardInstanceId: 'a', warriorInstanceId: 'h' }));
    const next = gameReducer(attached, act('DECK_GATHER'));
    const a = next.zones.deck.find(c => c.instanceId === 'a');
    expect(a?.equippedTo).toBeUndefined();
    expect(next.zones.territory.map(c => c.instanceId)).toEqual(['h']);
  });
});

describe('deckSpreadIds pruning', () => {
  it('drops a spread card that leaves Territory and does not re-add it when it comes back', () => {
    const state = spread(makeState([makeCard({ instanceId: 'a' }), makeCard({ instanceId: 'b' }), makeCard({ instanceId: 'c' })]));
    const toHand = gameReducer(state, act('MOVE_CARD', { cardInstanceId: 'a', toZone: 'hand' }));
    expect(toHand.deckSpreadIds).toEqual(['c', 'b']);
    const back = gameReducer(toHand, act('MOVE_CARD', { cardInstanceId: 'a', toZone: 'territory', posX: 500, posY: 500 }));
    expect(back.deckSpreadIds).toEqual(['c', 'b']);
    const gathered = gameReducer(back, act('DECK_GATHER'));
    expect(gathered.zones.territory.map(c => c.instanceId)).toEqual(['a']);
    expect(gathered.zones.deck.map(c => c.instanceId).sort()).toEqual(['b', 'c']);
  });

  it('drops the field entirely once every spread card has left Territory', () => {
    const state = spread(makeState([makeCard({ instanceId: 'a' })]), ['a']);
    expect(state.deckSpreadIds).toEqual(['a']);
    const next = gameReducer(state, act('MOVE_CARDS_BATCH', { cardInstanceIds: ['a'], toZone: 'discard' }));
    expect(next.deckSpreadIds).toBeUndefined();
  });

  it('returns the same state object when a no-op action changes nothing', () => {
    const state = spread(makeState([makeCard({ instanceId: 'a' })]), ['a']);
    const next = gameReducer(state, act('MOVE_CARD', { cardInstanceId: 'missing', toZone: 'hand' }));
    expect(next).toBe(state);
  });

  it('keeps the ids untouched by unrelated actions', () => {
    const state = spread(makeState([makeCard({ instanceId: 'a' })]), ['a']);
    const next = gameReducer(state, act('ADVANCE_PHASE'));
    expect(next.deckSpreadIds).toEqual(['a']);
  });

  it('survives undo in both directions', () => {
    const base = makeState([makeCard({ instanceId: 'a' }), makeCard({ instanceId: 'b' })]);
    const spreadState = spread(base, ['a', 'b']);
    const gathered = gameReducer(spreadState, act('DECK_GATHER'));
    const undoneGather = gameReducer(gathered, act('MOVE_CARD', { value: '__UNDO__' }));
    expect(undoneGather.deckSpreadIds).toEqual(['a', 'b']);
    expect(undoneGather.zones.territory).toHaveLength(2);
    const undoneSpread = gameReducer(undoneGather, act('MOVE_CARD', { value: '__UNDO__' }));
    expect(undoneSpread.deckSpreadIds).toBeUndefined();
    expect(undoneSpread.zones.deck.map(c => c.instanceId)).toEqual(['a', 'b']);
  });
});
