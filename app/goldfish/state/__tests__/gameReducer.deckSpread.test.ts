import { describe, it, expect } from 'vitest';
import { gameReducer } from '../gameReducer';
import type { GameCard, GameState, GameAction, ZoneId } from '../../types';

function makeCard(overrides: Partial<GameCard> & { instanceId: string }): GameCard {
  const zone: ZoneId = overrides.zone ?? 'deck';
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
    // Deck cards are face-down, everything else face-up (as in the initializer).
    isFlipped: zone === 'deck',
    isToken: false,
    zone,
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

// Spread slots: id i lands at (10 + 140*i, 20).
function spread(state: GameState, ids: string[]): GameState {
  const positions: Record<string, { posX: number; posY: number }> = {};
  ids.forEach((id, i) => { positions[id] = { posX: 10 + 140 * i, posY: 20 }; });
  return gameReducer(state, act('DECK_SPREAD', { cardInstanceIds: ids, positions }));
}

const ids = (cards: GameCard[]) => cards.map(c => c.instanceId);

describe('DECK_SPREAD', () => {
  it('moves cards from every zone to Territory face-up at the given positions, in the given order', () => {
    const state = makeState([
      makeCard({ instanceId: 'a', zone: 'deck' }),
      makeCard({ instanceId: 'b', zone: 'hand' }),
      makeCard({ instanceId: 'c', zone: 'reserve' }),
      makeCard({ instanceId: 'd', zone: 'land-of-redemption' }),
      makeCard({ instanceId: 'e', zone: 'discard' }),
      makeCard({ instanceId: 'f', zone: 'banish' }),
      makeCard({ instanceId: 'g', zone: 'land-of-bondage', type: 'Lost Soul' }),
    ]);
    const next = spread(state, ['g', 'a', 'f', 'c', 'e', 'b', 'd']);
    expect(ids(next.zones.territory)).toEqual(['g', 'a', 'f', 'c', 'e', 'b', 'd']);
    for (const zone of ['deck', 'hand', 'reserve', 'land-of-redemption', 'discard', 'banish', 'land-of-bondage'] as ZoneId[]) {
      expect(next.zones[zone]).toEqual([]);
    }
    next.zones.territory.forEach((card, i) => {
      expect(card.zone).toBe('territory');
      expect(card.isFlipped).toBe(false);
      expect({ posX: card.posX, posY: card.posY }).toEqual({ posX: 10 + 140 * i, posY: 20 });
    });
  });

  it('records where each card came from and pushes one history entry', () => {
    const state = makeState([
      makeCard({ instanceId: 'a', zone: 'deck' }),
      makeCard({ instanceId: 'b', zone: 'hand' }),
    ]);
    const next = spread(state, ['b', 'a']);
    expect(next.deckSpread).toEqual({
      a: { zone: 'deck', index: 0, isFlipped: true },
      b: { zone: 'hand', index: 0, isFlipped: false },
    });
    expect(next.history).toHaveLength(1);
  });

  it('records each card\'s original index even when several share a zone', () => {
    const state = makeState([
      makeCard({ instanceId: 'a' }), makeCard({ instanceId: 'b' }), makeCard({ instanceId: 'c' }),
    ]);
    const next = spread(state, ['c', 'a', 'b']);
    expect(next.deckSpread?.a.index).toBe(0);
    expect(next.deckSpread?.b.index).toBe(1);
    expect(next.deckSpread?.c.index).toBe(2);
  });

  it('is a no-op when none of the ids exist', () => {
    const state = makeState([makeCard({ instanceId: 'a' })]);
    const next = spread(state, ['ghost']);
    expect(next).toBe(state);
  });

  it('skips ids it cannot find and moves the rest', () => {
    const state = makeState([makeCard({ instanceId: 'a' })]);
    const next = spread(state, ['ghost', 'a']);
    expect(ids(next.zones.territory)).toEqual(['a']);
    expect(Object.keys(next.deckSpread ?? {})).toEqual(['a']);
  });

  it('remembers a Territory card\'s spot and unlinks its weapon', () => {
    const state = makeState([
      makeCard({ instanceId: 'h', zone: 'territory', posX: 400, posY: 300 }),
      makeCard({ instanceId: 'w', zone: 'territory', equippedTo: 'h' }),
    ]);
    const next = spread(state, ['h', 'w']);
    const w = next.zones.territory.find(c => c.instanceId === 'w')!;
    expect(w.equippedTo).toBeUndefined();
    expect({ posX: w.posX, posY: w.posY }).toEqual({ posX: 150, posY: 20 });
    expect(next.deckSpread?.h).toMatchObject({ zone: 'territory', posX: 400, posY: 300 });
    expect(next.deckSpread?.w).toMatchObject({ zone: 'territory', equippedTo: 'h' });
  });

  it('unlinks a weapon that is NOT spread but was attached to a spread warrior', () => {
    const state = makeState([
      makeCard({ instanceId: 'h', zone: 'territory', posX: 400, posY: 300 }),
      makeCard({ instanceId: 'w', zone: 'territory', equippedTo: 'h' }),
    ]);
    const next = spread(state, ['h']);
    expect(next.zones.territory.find(c => c.instanceId === 'w')?.equippedTo).toBeUndefined();
  });
});

describe('DECK_GATHER', () => {
  it('returns every spread card to the zone it came from, in its old order, with its old face', () => {
    const state = makeState([
      makeCard({ instanceId: 'd1', zone: 'deck' }), makeCard({ instanceId: 'd2', zone: 'deck' }),
      makeCard({ instanceId: 'h1', zone: 'hand' }), makeCard({ instanceId: 'h2', zone: 'hand' }),
      makeCard({ instanceId: 'r1', zone: 'reserve' }),
      makeCard({ instanceId: 'l1', zone: 'land-of-redemption' }),
      makeCard({ instanceId: 'b1', zone: 'land-of-bondage', type: 'Lost Soul' }),
    ]);
    const out = spread(state, ['h2', 'l1', 'd2', 'b1', 'r1', 'h1', 'd1']);
    const next = gameReducer(out, act('DECK_GATHER'));
    expect(next.zones.territory).toEqual([]);
    expect(ids(next.zones.deck)).toEqual(['d1', 'd2']);
    expect(ids(next.zones.hand)).toEqual(['h1', 'h2']);
    expect(ids(next.zones.reserve)).toEqual(['r1']);
    expect(ids(next.zones['land-of-redemption'])).toEqual(['l1']);
    expect(ids(next.zones['land-of-bondage'])).toEqual(['b1']);
    for (const c of next.zones.deck) expect(c.isFlipped).toBe(true);
    for (const c of [...next.zones.hand, ...next.zones.reserve, ...next.zones['land-of-redemption']]) {
      expect(c.isFlipped).toBe(false);
      expect(c.zone).not.toBe('territory');
      expect(c.posX).toBeUndefined();
    }
    expect(next.deckSpread).toBeUndefined();
    expect(next.history).toHaveLength(out.history.length + 1);
  });

  it('does not shuffle: the pile comes back in the order it had', () => {
    const state = makeState(['a', 'b', 'c', 'd', 'e'].map(id => makeCard({ instanceId: id })));
    const out = spread(state, ['e', 'c', 'a', 'd', 'b']);
    const next = gameReducer(out, act('DECK_GATHER'));
    expect(ids(next.zones.deck)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('puts a Territory card back where it was and re-links its weapon', () => {
    const state = makeState([
      makeCard({ instanceId: 'h', zone: 'territory', posX: 400, posY: 300 }),
      makeCard({ instanceId: 'w', zone: 'territory', equippedTo: 'h' }),
    ]);
    const next = gameReducer(spread(state, ['h', 'w']), act('DECK_GATHER'));
    const h = next.zones.territory.find(c => c.instanceId === 'h')!;
    const w = next.zones.territory.find(c => c.instanceId === 'w')!;
    expect({ posX: h.posX, posY: h.posY }).toEqual({ posX: 400, posY: 300 });
    expect(w.equippedTo).toBe('h');
    expect(w.posX).toBeUndefined();
  });

  it('leaves a weapon at its spread slot when its warrior is no longer in Territory', () => {
    const state = makeState([
      makeCard({ instanceId: 'h', zone: 'territory', posX: 400, posY: 300 }),
      makeCard({ instanceId: 'w', zone: 'territory', equippedTo: 'h' }),
    ]);
    const out = spread(state, ['h', 'w']);
    const gone = gameReducer(out, act('MOVE_CARD', { cardInstanceId: 'h', toZone: 'discard' }));
    const next = gameReducer(gone, act('DECK_GATHER'));
    const w = next.zones.territory.find(c => c.instanceId === 'w')!;
    expect(w.equippedTo).toBeUndefined();
    expect({ posX: w.posX, posY: w.posY }).toEqual({ posX: 150, posY: 20 });
  });

  it('clears in-play fiddling on a card going back to a non-play zone', () => {
    const state = makeState([makeCard({ instanceId: 'a', zone: 'deck' })]);
    const out = spread(state, ['a']);
    const fiddled = gameReducer(gameReducer(out,
      act('MEEK_CARD', { cardInstanceId: 'a' })),
      act('ADD_COUNTER', { cardInstanceId: 'a', color: 'red' }));
    const next = gameReducer(fiddled, act('DECK_GATHER'));
    const a = next.zones.deck[0];
    expect(a.isMeek).toBe(false);
    expect(a.counters).toEqual([]);
  });

  it('keeps in-play state on a card going back to Territory', () => {
    const state = makeState([makeCard({
      instanceId: 'h', zone: 'territory', posX: 1, posY: 2, isMeek: true, counters: [{ color: 'red', count: 2 }],
    })]);
    const next = gameReducer(spread(state, ['h']), act('DECK_GATHER'));
    expect(next.zones.territory[0]).toMatchObject({ isMeek: true, counters: [{ color: 'red', count: 2 }] });
  });

  it('clamps the old index when the zone shrank meanwhile', () => {
    const state = makeState([
      makeCard({ instanceId: 'h1', zone: 'hand' }), makeCard({ instanceId: 'h2', zone: 'hand' }), makeCard({ instanceId: 'h3', zone: 'hand' }),
    ]);
    const out = spread(state, ['h3']);
    const shrunk = gameReducer(out, act('MOVE_CARD', { cardInstanceId: 'h1', toZone: 'discard' }));
    const next = gameReducer(shrunk, act('DECK_GATHER'));
    expect(ids(next.zones.hand)).toEqual(['h2', 'h3']);
  });

  it('is a no-op when nothing is spread', () => {
    const state = makeState([makeCard({ instanceId: 'a' })]);
    const next = gameReducer(state, act('DECK_GATHER'));
    expect(next).toBe(state);
  });
});

describe('deckSpread pruning', () => {
  it('drops a spread card that leaves Territory and does not re-add it when it comes back', () => {
    const state = spread(makeState([
      makeCard({ instanceId: 'a' }), makeCard({ instanceId: 'b' }), makeCard({ instanceId: 'c' }),
    ]), ['c', 'a', 'b']);
    const toHand = gameReducer(state, act('MOVE_CARD', { cardInstanceId: 'a', toZone: 'hand' }));
    expect(Object.keys(toHand.deckSpread ?? {}).sort()).toEqual(['b', 'c']);
    const back = gameReducer(toHand, act('MOVE_CARD', { cardInstanceId: 'a', toZone: 'territory', posX: 500, posY: 500 }));
    expect(Object.keys(back.deckSpread ?? {}).sort()).toEqual(['b', 'c']);
    const gathered = gameReducer(back, act('DECK_GATHER'));
    expect(ids(gathered.zones.territory)).toEqual(['a']);
    expect(ids(gathered.zones.deck)).toEqual(['b', 'c']);
  });

  it('drops the field entirely once every spread card has left Territory', () => {
    const state = spread(makeState([makeCard({ instanceId: 'a' })]), ['a']);
    expect(state.deckSpread).toBeDefined();
    const next = gameReducer(state, act('MOVE_CARDS_BATCH', { cardInstanceIds: ['a'], toZone: 'discard' }));
    expect(next.deckSpread).toBeUndefined();
  });

  it('returns the same state object when a no-op action changes nothing', () => {
    const state = spread(makeState([makeCard({ instanceId: 'a' })]), ['a']);
    const next = gameReducer(state, act('MOVE_CARD', { cardInstanceId: 'missing', toZone: 'hand' }));
    expect(next).toBe(state);
  });

  it('keeps the record untouched by unrelated actions', () => {
    const state = spread(makeState([makeCard({ instanceId: 'a' })]), ['a']);
    const next = gameReducer(state, act('ADVANCE_PHASE'));
    expect(next.deckSpread).toEqual(state.deckSpread);
  });

  it('survives undo in both directions', () => {
    const base = makeState([makeCard({ instanceId: 'a' }), makeCard({ instanceId: 'b' })]);
    const spreadState = spread(base, ['a', 'b']);
    const gathered = gameReducer(spreadState, act('DECK_GATHER'));
    const undoneGather = gameReducer(gathered, act('MOVE_CARD', { value: '__UNDO__' }));
    expect(Object.keys(undoneGather.deckSpread ?? {}).sort()).toEqual(['a', 'b']);
    expect(undoneGather.zones.territory).toHaveLength(2);
    const undoneSpread = gameReducer(undoneGather, act('MOVE_CARD', { value: '__UNDO__' }));
    expect(undoneSpread.deckSpread).toBeUndefined();
    expect(ids(undoneSpread.zones.deck)).toEqual(['a', 'b']);
  });
});
