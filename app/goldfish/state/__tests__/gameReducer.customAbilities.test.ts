// app/goldfish/state/__tests__/gameReducer.customAbilities.test.ts
import { describe, it, expect } from 'vitest';
import { gameReducer } from '../gameReducer';
import { actions as gameActions } from '../gameActions';
import { getEffectiveAbilities } from '@/lib/cards/cardAbilities';
import type { GameCard, GameState, GameAction } from '../../types';

function makeCard(overrides: Partial<GameCard>): GameCard {
  return {
    instanceId: 'source-1',
    // Registry keys match cardName (which carries the set suffix). The
    // identifier field is a taxonomy descriptor from carddata and is NOT the
    // lookup key — set it to a representative value so tests mirror real data.
    cardName: 'Two Possessed (GoC)',
    cardSet: 'GoC',
    cardImgFile: 'two-possessed.png',
    type: 'EC',
    brigade: '',
    strength: '',
    toughness: '',
    specialAbility: '',
    identifier: 'Generic, Demon',
    reference: '',
    alignment: 'Evil',
    isMeek: false,
    counters: [],
    isFlipped: false,
    isToken: false,
    zone: 'territory',
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

function act(cardInstanceId: string, abilityIndex: number): GameAction {
  return {
    id: 'a',
    type: 'EXECUTE_CARD_ABILITY',
    playerId: 'player1',
    timestamp: 0,
    payload: { cardInstanceId, abilityIndex },
  };
}

describe('EXECUTE_CARD_ABILITY — spawn_token', () => {
  it('Two Possessed spawns 2 Violent Possessor Tokens in the same zone', () => {
    const source = makeCard({ zone: 'territory', cardName: 'Two Possessed (GoC)' });
    const state = makeState([source]);

    const next = gameReducer(state, act('source-1', 0));

    expect(next.zones.territory).toHaveLength(3); // source + 2 tokens
    const tokens = next.zones.territory.filter(c => c.isToken);
    expect(tokens).toHaveLength(2);
    expect(tokens.every(t => t.cardName === 'Violent Possessor Token')).toBe(true);
    expect(tokens.every(t => t.ownerId === 'player1')).toBe(true);
    expect(tokens[0].instanceId).not.toEqual(tokens[1].instanceId);
    expect(tokens[0].instanceId).not.toEqual('source-1');
  });

  it('spawning in a row cascades onto fresh slots instead of stacking', () => {
    const source = makeCard({ zone: 'territory', cardName: 'Two Possessed (GoC)', posX: 200, posY: 200 });
    const state = makeState([source]);

    // First spawn (2 tokens), then a second spawn from the same source.
    const after1 = gameReducer(state, act('source-1', 0));
    const after2 = gameReducer(after1, act('source-1', 0));

    const tokens = after2.zones.territory.filter(c => c.isToken);
    expect(tokens).toHaveLength(4);

    // Every token occupies a distinct position — no two tokens share a slot.
    const positions = tokens.map(t => `${t.posX},${t.posY}`);
    expect(new Set(positions).size).toBe(4);
  });

  it('single-count ability spawns exactly one token', () => {
    const source = makeCard({ cardName: 'The Proselytizers (GoC)' });
    const state = makeState([source]);

    const next = gameReducer(state, act('source-1', 0));

    const tokens = next.zones.territory.filter(c => c.isToken);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].cardName).toBe('Proselyte Token');
  });

  it('spawn from a non-play zone is blocked (cards in hand cannot trigger abilities)', () => {
    const source = makeCard({ zone: 'hand', cardName: 'The Proselytizers (GoC)' });
    const state = makeState([source]);

    const next = gameReducer(state, act('source-1', 0));

    // No tokens spawned anywhere; state reference unchanged.
    expect(next).toBe(state);
  });

  it('spawn from land-of-bondage always lands in Territory (default target zone)', () => {
    const source = makeCard({ zone: 'land-of-bondage', cardName: 'The Proselytizers (GoC)' });
    const state = makeState([source]);

    const next = gameReducer(state, act('source-1', 0));

    // Regardless of source zone, default target is Territory (the visible
    // free-form play area). Registry can override via ability.defaultZone.
    const tokens = next.zones.territory.filter(c => c.isToken);
    expect(tokens).toHaveLength(1);
    expect(next.zones['land-of-bondage'].filter(c => c.isToken)).toHaveLength(0);
  });

  it('unknown source instanceId is a no-op (returns same state reference)', () => {
    const state = makeState([makeCard({})]);
    const next = gameReducer(state, act('does-not-exist', 0));
    expect(next).toBe(state);
  });

  it('out-of-range abilityIndex is a no-op (returns same state reference)', () => {
    const source = makeCard({ cardName: 'Two Possessed (GoC)' });
    const state = makeState([source]);
    const next = gameReducer(state, act('source-1', 99));
    expect(next).toBe(state);
  });

  it('card with no registered abilities is a no-op', () => {
    const source = makeCard({ cardName: 'No Such Ability Card' });
    const state = makeState([source]);
    const next = gameReducer(state, act('source-1', 0));
    expect(next).toBe(state);
  });

  it('ownerId is inherited from source (player2 source → player2 tokens)', () => {
    const source = makeCard({ ownerId: 'player2', cardName: 'The Proselytizers (GoC)' });
    const state = makeState([source]);
    const next = gameReducer(state, act('source-1', 0));
    const tokens = next.zones.territory.filter(c => c.isToken);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].ownerId).toBe('player2');
  });

  it('spawning pushes history so the spawn can be undone', () => {
    const source = makeCard({ cardName: 'Two Possessed (GoC)' });
    const state = makeState([source]);

    const next = gameReducer(state, act('source-1', 0));

    // 2 tokens spawned
    expect(next.zones.territory.filter(c => c.isToken)).toHaveLength(2);
    // History gained exactly one entry — the pre-spawn snapshot
    expect(next.history.length).toBe(state.history.length + 1);
  });
});

describe("EXECUTE_CARD_ABILITY — discard_opponent_deck (goldfish no-op)", () => {
  it('returns the same state reference when Delivered is activated', () => {
    const source = makeCard({
      cardName: 'Delivered',
      cardSet: 'PoC',
      type: 'GE/EE',
      identifier: '',
      alignment: 'Neutral',
      zone: 'territory',
    });
    const state = makeState([source]);

    const next = gameReducer(state, act('source-1', 0));

    // Single-player goldfish: no opponent → ability is a no-op.
    // Reducer must return the same state reference (no clone, no history push).
    expect(next).toBe(state);
  });
});

describe('imitate_lost_soul', () => {
  it('swaps cardImgFile and sets imitatingName when target has registered art', () => {
    const source = makeCard({
      instanceId: 'src',
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      cardImgFile: '23-Lost-Soul-Imitate-R',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const target = makeCard({
      instanceId: 'tgt',
      cardName: 'Lost Soul "Awake" [Ephesians 5:14 - TPC]',
      cardImgFile: 'awake-original',
      reference: 'Ephesians 5:14',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const initial = makeState([source, target]);
    const next = gameReducer(initial, gameActions.imitateLostSoul('src', 'tgt'));
    const updatedSource = next.zones['land-of-bondage'].find(c => c.instanceId === 'src')!;
    expect(updatedSource.cardImgFile).toBe('/imitate-souls/cards/awake.jpg');
    // imitatingName stores the FULL target cardName so the menu can resolve
    // inherited abilities. simplifyLostSoulName() is applied at render time.
    expect(updatedSource.imitatingName).toBe('Lost Soul "Awake" [Ephesians 5:14 - TPC]');
  });

  it('leaves cardImgFile unchanged and sets imitatingName when target has no registered art', () => {
    const source = makeCard({
      instanceId: 'src',
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      cardImgFile: '23-Lost-Soul-Imitate-R',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const target = makeCard({
      instanceId: 'tgt',
      cardName: 'Lost Soul Matthew 19:23 (Speed Bump)',
      cardImgFile: 'speed-bump-original',
      reference: 'Matthew 19:23',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const initial = makeState([source, target]);
    const next = gameReducer(initial, gameActions.imitateLostSoul('src', 'tgt'));
    const updatedSource = next.zones['land-of-bondage'].find(c => c.instanceId === 'src')!;
    expect(updatedSource.cardImgFile).toBe('23-Lost-Soul-Imitate-R');
    expect(updatedSource.imitatingName).toBe('Lost Soul Matthew 19:23 (Speed Bump)');
  });

  it('stop_imitating reverts cardImgFile and clears imitatingName', () => {
    const source = makeCard({
      instanceId: 'src',
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      cardImgFile: '/imitate-souls/cards/awake.jpg',
      imitatingName: 'Lost Soul "Awake" [Ephesians 5:14 - TPC]',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const initial = makeState([source]);
    const next = gameReducer(initial, gameActions.stopImitatingLostSoul('src'));
    const updatedSource = next.zones['land-of-bondage'].find(c => c.instanceId === 'src')!;
    expect(updatedSource.cardImgFile).toBe('23-Lost-Soul-Imitate-R');
    expect(updatedSource.imitatingName).toBe('');
  });

  it('rejects non-Lost-Soul target', () => {
    const source = makeCard({
      instanceId: 'src',
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      cardImgFile: '23-Lost-Soul-Imitate-R',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const target = makeCard({
      instanceId: 'tgt',
      cardName: 'Mayhem',
      type: 'Evil Card',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const initial = makeState([source, target]);
    const next = gameReducer(initial, gameActions.imitateLostSoul('src', 'tgt'));
    expect(next).toBe(initial);
  });

  it('rejects target outside Land of Bondage', () => {
    const source = makeCard({
      instanceId: 'src',
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      cardImgFile: '23-Lost-Soul-Imitate-R',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const target = makeCard({
      instanceId: 'tgt',
      cardName: 'Lost Soul "Awake" [Ephesians 5:14 - TPC]',
      type: 'Lost Soul',
      zone: 'deck',
      ownerId: 'player1',
    });
    const initial = makeState([source, target]);
    const next = gameReducer(initial, gameActions.imitateLostSoul('src', 'tgt'));
    expect(next).toBe(initial);
  });

  it('rejects when source is not an Imitate Lost Soul', () => {
    const notImitate = makeCard({
      instanceId: 'src',
      cardName: 'Lost Soul "Awake" [Ephesians 5:14 - TPC]',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const target = makeCard({
      instanceId: 'tgt',
      cardName: 'Lost Soul "Forsaken" [Hebrews 10:25]',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const initial = makeState([notImitate, target]);
    const next = gameReducer(initial, gameActions.imitateLostSoul('src', 'tgt'));
    expect(next).toBe(initial);
  });

  it('re-imitate overwrites prior imitation', () => {
    const source = makeCard({
      instanceId: 'src',
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      cardImgFile: '/imitate-souls/cards/awake.jpg',
      imitatingName: 'Lost Soul "Awake" [Ephesians 5:14 - TPC]',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const target = makeCard({
      instanceId: 'tgt',
      cardName: 'Lost Soul "Forsaken" [Hebrews 10:25]',
      reference: 'Hebrews 10:25',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const initial = makeState([source, target]);
    const next = gameReducer(initial, gameActions.imitateLostSoul('src', 'tgt'));
    const updatedSource = next.zones['land-of-bondage'].find(c => c.instanceId === 'src')!;
    expect(updatedSource.cardImgFile).toBe('/imitate-souls/cards/forsaken.jpg');
    expect(updatedSource.imitatingName).toBe('Lost Soul "Forsaken" [Hebrews 10:25]');
  });

  it('rejects O.T. Lost Soul target (Imitate restricts to N.T. souls)', () => {
    const source = makeCard({
      instanceId: 'src',
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      cardImgFile: '23-Lost-Soul-Imitate-R',
      reference: 'III John 1:11',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const otTarget = makeCard({
      instanceId: 'tgt',
      cardName: 'Lost Soul "Accusers" [Ezra 4:6]',
      reference: 'Ezra 4:6',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const initial = makeState([source, otTarget]);
    const next = gameReducer(initial, gameActions.imitateLostSoul('src', 'tgt'));
    expect(next).toBe(initial);
  });

  it('re-imitate from art-supported to unsupported soul reverts art to canonical (regression)', () => {
    // Regression: previously the reducer fell back to source.cardImgFile when
    // the target had no registered art, leaving the stale awake.jpg in place
    // AND hiding the label (since cardImgFile !== canonical). The fix is to
    // fall back to the canonical Imitate art instead.
    const source = makeCard({
      instanceId: 'src',
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      cardImgFile: '/imitate-souls/cards/awake.jpg',  // already imitating Awake
      imitatingName: 'Lost Soul "Awake" [Ephesians 5:14 - TPC]',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const target = makeCard({
      instanceId: 'tgt',
      cardName: 'Lost Soul Matthew 19:23 (Speed Bump)',  // no art available
      reference: 'Matthew 19:23',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const initial = makeState([source, target]);
    const next = gameReducer(initial, gameActions.imitateLostSoul('src', 'tgt'));
    const updatedSource = next.zones['land-of-bondage'].find(c => c.instanceId === 'src')!;
    expect(updatedSource.cardImgFile).toBe('23-Lost-Soul-Imitate-R');  // canonical, not awake.jpg
    expect(updatedSource.imitatingName).toBe('Lost Soul Matthew 19:23 (Speed Bump)');
  });

  it('clears imitation and restores canonical art when the card leaves LoB', () => {
    const source = makeCard({
      instanceId: 'src',
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      cardImgFile: '/imitate-souls/cards/awake.jpg',
      imitatingName: 'Lost Soul "Awake" [Ephesians 5:14 - TPC]',
      type: 'Lost Soul',
      zone: 'land-of-bondage',
      ownerId: 'player1',
    });
    const initial = makeState([source]);
    // Move from LoB to deck (simulates shuffle / rescue back to deck).
    const next = gameReducer(initial, gameActions.moveCard('src', 'deck'));
    const moved = next.zones.deck.find(c => c.instanceId === 'src')!;
    expect(moved.imitatingName).toBe('');
    expect(moved.cardImgFile).toBe('23-Lost-Soul-Imitate-R');
  });
});

describe('getEffectiveAbilities — Imitate inherits the imitated soul abilities', () => {
  it('returns base + imitated abilities (filtered to avoid nested imitate_lost_soul)', () => {
    const card = {
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      imitatingName: 'Lost Soul "Lawless" [Hebrews 12:8]',  // has reveal_own_deck count:6
    };
    const abilities = getEffectiveAbilities(card);
    // First entry is the source card's own imitate_lost_soul, then inherited.
    expect(abilities[0]?.type).toBe('imitate_lost_soul');
    expect(abilities[1]).toEqual({ type: 'reveal_own_deck', position: 'top', count: 6 });
    expect(abilities).toHaveLength(2);
  });

  it('drops nested imitate_lost_soul so chained imitation does not duplicate the Imitate item', () => {
    const card = {
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      imitatingName: 'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]',  // silly but legal
    };
    const abilities = getEffectiveAbilities(card);
    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.type).toBe('imitate_lost_soul');
  });

  it('returns just the base abilities when imitatingName is empty', () => {
    const card = {
      cardName: 'Lost Soul "Imitate" [III John 1:11]',
      imitatingName: '',
    };
    const abilities = getEffectiveAbilities(card);
    expect(abilities).toHaveLength(1);
    expect(abilities[0]?.type).toBe('imitate_lost_soul');
  });
});

describe('RESURRECT_HEROES', () => {
  function resurrect(cardInstanceIds: string[]): GameAction {
    return {
      id: 'r',
      type: 'RESURRECT_HEROES',
      playerId: 'player1',
      timestamp: 0,
      payload: { cardInstanceIds },
    };
  }

  it('moves selected Heroes from discard into territory, owner preserved', () => {
    const hero1 = makeCard({ instanceId: 'h1', cardName: 'Aaron (Di)', type: 'Hero', zone: 'discard' });
    const hero2 = makeCard({ instanceId: 'h2', cardName: 'David (Roots)', type: 'Hero', zone: 'discard' });
    const state = makeState([hero1, hero2]);

    const next = gameReducer(state, resurrect(['h1', 'h2']));

    expect(next.zones.discard).toHaveLength(0);
    expect(next.zones.territory).toHaveLength(2);
    expect(next.zones.territory.every(c => c.ownerId === 'player1')).toBe(true);
    expect(next.zones.territory.every(c => typeof c.posX === 'number')).toBe(true);
  });

  it('accepts dual-alignment "contains Hero" types', () => {
    const dual = makeCard({ instanceId: 'd1', cardName: 'Dual', type: 'Hero/Evil Character', zone: 'discard' });
    const state = makeState([dual]);

    const next = gameReducer(state, resurrect(['d1']));

    expect(next.zones.discard).toHaveLength(0);
    expect(next.zones.territory).toHaveLength(1);
  });

  it('ignores non-Hero ids in the discard pile', () => {
    const hero = makeCard({ instanceId: 'h1', cardName: 'Aaron (Di)', type: 'Hero', zone: 'discard' });
    const evil = makeCard({ instanceId: 'e1', cardName: 'Evil One', type: 'Evil Character', zone: 'discard' });
    const state = makeState([hero, evil]);

    const next = gameReducer(state, resurrect(['h1', 'e1']));

    expect(next.zones.territory).toHaveLength(1);
    expect(next.zones.territory[0].instanceId).toBe('h1');
    // The non-Hero stays in discard.
    expect(next.zones.discard.map(c => c.instanceId)).toEqual(['e1']);
  });

  it('is a no-op (same state reference) when nothing valid is selected', () => {
    const evil = makeCard({ instanceId: 'e1', cardName: 'Evil One', type: 'Evil Character', zone: 'discard' });
    const state = makeState([evil]);

    expect(gameReducer(state, resurrect(['e1']))).toBe(state);
    expect(gameReducer(state, resurrect([]))).toBe(state);
  });

  it('does not resurrect Heroes that are not in the discard pile', () => {
    const heroInPlay = makeCard({ instanceId: 'h1', cardName: 'Aaron (Di)', type: 'Hero', zone: 'territory' });
    const state = makeState([heroInPlay]);

    // h1 is in territory, not discard — selecting it should change nothing.
    expect(gameReducer(state, resurrect(['h1']))).toBe(state);
  });
});

describe('EXECUTE_CARD_ABILITY — discard_bottom_of_deck (The Gates of Hell)', () => {
  it('discards the bottom card of deck when it is not a Lost Soul', () => {
    const source = makeCard({ instanceId: 'goh', cardName: 'The Gates of Hell (GoC)', zone: 'territory' });
    const top = makeCard({ instanceId: 'd1', cardName: 'Top Card', zone: 'deck' });
    const bottom = makeCard({ instanceId: 'd2', cardName: 'Bottom Card', zone: 'deck', isFlipped: true });
    const state = makeState([source, top, bottom]);

    const next = gameReducer(state, act('goh', 0));

    expect(next.zones.deck.map(c => c.instanceId)).toEqual(['d1']);
    expect(next.zones.discard.map(c => c.instanceId)).toEqual(['d2']);
    expect(next.zones.discard[0].isFlipped).toBe(false);
    expect(next.zones['land-of-bondage']).toHaveLength(0);
  });

  it('plays the bottom card into the Land of Bondage when it is a Lost Soul', () => {
    const source = makeCard({ instanceId: 'goh', cardName: 'The Gates of Hell', zone: 'territory' });
    const top = makeCard({ instanceId: 'd1', cardName: 'Top Card', zone: 'deck' });
    const soul = makeCard({ instanceId: 'ls1', cardName: 'Lost Soul Romans 3:23', type: 'Lost Soul', zone: 'deck', isFlipped: true });
    const state = makeState([source, top, soul]);

    const next = gameReducer(state, act('goh', 0));

    expect(next.zones.deck.map(c => c.instanceId)).toEqual(['d1']);
    expect(next.zones.discard).toHaveLength(0);
    expect(next.zones['land-of-bondage'].map(c => c.instanceId)).toEqual(['ls1']);
    expect(next.zones['land-of-bondage'][0].isFlipped).toBe(false);
    expect(next.zones['land-of-bondage'][0].zone).toBe('land-of-bondage');
  });

  it('is a no-op (same state reference) when the deck is empty', () => {
    const source = makeCard({ instanceId: 'goh', cardName: 'The Gates of Hell [2024 - 2nd Place]', zone: 'territory' });
    const state = makeState([source]);

    expect(gameReducer(state, act('goh', 0))).toBe(state);
  });

  it('all three Gates of Hell variants are registered', () => {
    for (const name of ['The Gates of Hell', 'The Gates of Hell (GoC)', 'The Gates of Hell [2024 - 2nd Place]']) {
      expect(getEffectiveAbilities({ cardName: name })).toEqual([{ type: 'discard_bottom_of_deck' }]);
    }
  });
});

describe("KEEP_ONE_SHUFFLE_DRAW (Philip's Daughters)", () => {
  // Deck cards are distinct from hand cards so we can tell a redrawn card from
  // a card that never left the hand.
  function setup(handIds: string[], deckIds: string[]): GameState {
    return makeState([
      ...handIds.map(id => makeCard({ instanceId: id, cardName: 'Hand Card', zone: 'hand' })),
      ...deckIds.map(id => makeCard({ instanceId: id, cardName: 'Deck Card', zone: 'deck', isFlipped: true })),
    ]);
  }

  it('keeps the chosen card, shuffles the rest away, and redraws that many', () => {
    const state = setup(['keep', 'a', 'b', 'c'], ['d1', 'd2', 'd3', 'd4', 'd5']);

    const next = gameReducer(state, gameActions.keepOneShuffleDraw('keep'));

    // Kept card never moved.
    expect(next.zones.hand.some(c => c.instanceId === 'keep')).toBe(true);
    // Three shuffled out, three drawn back, so the hand size is unchanged.
    // The three CAN come back — they were shuffled in before the draw — so the
    // invariant is the count, not which ids ended up where.
    expect(next.zones.hand).toHaveLength(4);
    // Deck: started 5, gained 3, lost 3 to the draw.
    expect(next.zones.deck).toHaveLength(5);
    // Nothing leaked into another zone.
    expect(next.zones.hand.length + next.zones.deck.length).toBe(9);
  });

  it('leaves every card in the deck face-down and zoned to the deck', () => {
    // Which specific ids land in the deck is up to the shuffle, so assert the
    // property that must hold for all of them rather than for one card.
    const state = setup(['keep', 'a', 'b'], ['d1', 'd2', 'd3', 'd4']);

    const next = gameReducer(state, gameActions.keepOneShuffleDraw('keep'));

    expect(next.zones.deck.length).toBeGreaterThan(0);
    for (const c of next.zones.deck) {
      expect(c.zone).toBe('deck');
      expect(c.isFlipped).toBe(true);
    }
    // And drawn cards are face-up in hand.
    for (const c of next.zones.hand) expect(c.isFlipped).toBe(false);
  });

  it('draws as many as it can when the deck is short', () => {
    const state = setup(['keep', 'a', 'b', 'c'], ['d1']);

    const next = gameReducer(state, gameActions.keepOneShuffleDraw('keep'));

    // 3 shuffled in + 1 already there = 4 available, all 3 draws succeed.
    expect(next.zones.hand).toHaveLength(4);
    expect(next.zones.deck).toHaveLength(1);
  });

  it('is a no-op when only the kept card is in hand', () => {
    const state = setup(['keep'], ['d1', 'd2']);

    const next = gameReducer(state, gameActions.keepOneShuffleDraw('keep'));

    expect(next.zones.hand.map(c => c.instanceId)).toEqual(['keep']);
    expect(next.zones.deck).toHaveLength(2);
  });

  it('refuses (same state reference) when the kept card is not in hand', () => {
    const state = setup(['a', 'b'], ['d1']);

    expect(gameReducer(state, gameActions.keepOneShuffleDraw('not-in-hand'))).toBe(state);
  });

  it('ignores an empty keep id rather than shuffling the whole hand away', () => {
    const state = setup(['a', 'b'], ['d1']);

    expect(gameReducer(state, gameActions.keepOneShuffleDraw(''))).toBe(state);
  });

  it('shuffles the rest but draws nothing when the draw is prevented', () => {
    const state = setup(['keep', 'a', 'b', 'c'], ['d1', 'd2']);

    const next = gameReducer(state, gameActions.keepOneShuffleDraw('keep', false));

    expect(next.zones.hand.map(c => c.instanceId)).toEqual(['keep']);
    // Three shuffled in, none drawn back out.
    expect(next.zones.deck).toHaveLength(5);
    for (const c of next.zones.deck) expect(c.isFlipped).toBe(true);
  });

  it("Philip's Daughters is registered with the keep-one variant", () => {
    expect(getEffectiveAbilities({ cardName: 'Philip’s Daughters [RR2]' }))
      .toEqual([{ type: 'all_players_keep_one_shuffle_draw' }]);
  });
});

describe('three_nails_reset source zone', () => {
  const act = (cardInstanceId: string, abilityIndex: number): GameAction =>
    gameActions.executeCardAbility(cardInstanceId, abilityIndex);

  it('banishes an Artifact reset card out of territory', () => {
    const source = makeCard({ instanceId: 'nails', cardName: 'Three Nails (GoC)', zone: 'territory' });
    const inHand = makeCard({ instanceId: 'h1', cardName: 'Hand Card', zone: 'hand' });
    const state = makeState([source, inHand, ...Array.from({ length: 10 }, (_, i) =>
      makeCard({ instanceId: `d${i}`, cardName: 'Deck Card', zone: 'deck', isFlipped: true }))]);

    const next = gameReducer(state, act('nails', 0));

    expect(next.zones.banish.map(c => c.instanceId)).toEqual(['nails']);
    expect(next.zones.territory).toHaveLength(0);
  });

  it('banishes a battle-zone reset card out of battle, leaving no copy behind', () => {
    // A New Beginning [RR2] is a Good Enhancement played into battle. Filtering
    // only territory used to leave the real card in battle while banishing a copy.
    const source = makeCard({ instanceId: 'anb', cardName: 'A New Beginning [RR2]', zone: 'battle' });
    const state = makeState([source, ...Array.from({ length: 10 }, (_, i) =>
      makeCard({ instanceId: `d${i}`, cardName: 'Deck Card', zone: 'deck', isFlipped: true }))]);

    const next = gameReducer(state, act('anb', 0));

    expect(next.zones.battle).toHaveLength(0);
    expect(next.zones.banish.map(c => c.instanceId)).toEqual(['anb']);
    // Exactly one copy of the card exists across every zone.
    const all = Object.values(next.zones).flat().filter(c => c.instanceId === 'anb');
    expect(all).toHaveLength(1);
  });

  it('all three reset printings are registered', () => {
    for (const name of ['Three Nails (GoC)', 'A New Beginning (FoM)', 'A New Beginning [RR2]']) {
      expect(getEffectiveAbilities({ cardName: name })).toContainEqual({ type: 'three_nails_reset' });
    }
  });
});

describe('band_heroes_from_deck — Creation of the World', () => {
  const act = (cardInstanceId: string, abilityIndex: number): GameAction =>
    gameActions.executeCardAbility(cardInstanceId, abilityIndex);

  const genesisHero = (id: string, reference = 'Genesis 2:7') =>
    makeCard({ instanceId: id, cardName: `Hero ${id}`, type: 'Hero', reference, zone: 'deck', isFlipped: true });

  it('bands every Genesis Hero out of the deck (goldfish has no battle zone, so: Territory)', () => {
    const source = makeCard({ instanceId: 'cotw', cardName: 'Creation of the World', type: 'GE', zone: 'territory' });
    const state = makeState([
      source,
      genesisHero('adam', 'Genesis 2:7'),
      genesisHero('eve', 'Genesis 3:20'),
      makeCard({ instanceId: 'david', cardName: 'David', type: 'Hero', reference: 'I Samuel 17:50', zone: 'deck' }),
      makeCard({ instanceId: 'ge', cardName: 'Some Enhancement', type: 'GE', reference: 'Genesis 1:1', zone: 'deck' }),
    ]);

    const next = gameReducer(state, act('cotw', 0));

    expect(next.zones.territory.map(c => c.instanceId).sort()).toEqual(['adam', 'cotw', 'eve']);
    // Non-Genesis Hero and the Genesis non-Hero both stay put.
    expect(next.zones.deck.map(c => c.instanceId).sort()).toEqual(['david', 'ge']);
  });

  it('turns the banded Heroes face up and lays them out in a wrapped row', () => {
    const source = makeCard({ instanceId: 'cotw', cardName: 'Creation of the World', type: 'GE', zone: 'territory' });
    const heroes = Array.from({ length: 10 }, (_, i) => genesisHero(`h${i}`));
    const next = gameReducer(makeState([source, ...heroes]), act('cotw', 0));

    const banded = next.zones.territory.filter(c => c.instanceId !== 'cotw');
    expect(banded).toHaveLength(10);
    expect(banded.every(c => c.isFlipped === false)).toBe(true);
    // 8 per row: the 9th wraps back to the first column on a new row.
    expect(banded[0].posX).toBe(banded[8].posX);
    expect(banded[8].posY).toBeGreaterThan(banded[0].posY!);
    // No two Heroes share a slot.
    const slots = new Set(banded.map(c => `${c.posX},${c.posY}`));
    expect(slots.size).toBe(10);
  });

  it('leaves state untouched when the deck holds no Genesis Heroes', () => {
    const source = makeCard({ instanceId: 'cotw', cardName: 'Creation of the World', type: 'GE', zone: 'territory' });
    const state = makeState([
      source,
      makeCard({ instanceId: 'david', cardName: 'David', type: 'Hero', reference: 'I Samuel 17:50', zone: 'deck' }),
    ]);

    expect(gameReducer(state, act('cotw', 0))).toBe(state);
  });

  it('only the Patriarchs printing is registered — the Roots card is a different effect', () => {
    expect(getEffectiveAbilities({ cardName: 'Creation of the World' }))
      .toEqual([{ type: 'band_heroes_from_deck', referenceBook: 'Genesis' }]);
    expect(getEffectiveAbilities({ cardName: 'Creation of the World (Roots)' })).toEqual([]);
  });
});

describe('EXECUTE_CARD_ABILITY — set_rotation (Two/Three Liner)', () => {
  const makeLiner = (overrides: Partial<GameCard> = {}) => makeCard({
    cardName: 'Lost Souls (Two Liner)',
    type: 'Lost Soul',
    alignment: 'Neutral',
    identifier: '',
    zone: 'land-of-bondage',
    ...overrides,
  });

  it('Turn Sideways (index 0) sets isRotated in the Land of Bondage', () => {
    const state = makeState([makeLiner()]);
    const next = gameReducer(state, act('source-1', 0));
    expect(next.zones['land-of-bondage'][0].isRotated).toBe(true);
  });

  it('Turn Upright (index 1) clears isRotated', () => {
    const state = makeState([makeLiner({ isRotated: true })]);
    const next = gameReducer(state, act('source-1', 1));
    expect(next.zones['land-of-bondage'][0].isRotated).toBe(false);
  });

  it('re-firing the current state is a no-op (same state reference)', () => {
    const state = makeState([makeLiner()]);
    // Turn Upright while already upright.
    expect(gameReducer(state, act('source-1', 1))).toBe(state);
  });

  it('does nothing outside the Land of Bondage', () => {
    const state = makeState([makeLiner({ zone: 'territory' })]);
    expect(gameReducer(state, act('source-1', 0))).toBe(state);
  });

  it('clears the marker when the soul leaves the Land of Bondage', () => {
    const state = makeState([makeLiner({ isRotated: true })]);
    const next = gameReducer(state, {
      id: 'm',
      type: 'MOVE_CARD',
      playerId: 'player1',
      timestamp: 0,
      payload: { cardInstanceId: 'source-1', toZone: 'land-of-redemption' },
    } as GameAction);
    expect(next.zones['land-of-redemption'][0].isRotated).toBeUndefined();
  });
});

describe('toggle_top_deck_reveal — The Foretelling Angel (PC)', () => {
  it('toggles the topDeckRevealed flag on and back off', () => {
    const source = makeCard({ zone: 'territory', cardName: 'The Foretelling Angel (PC)', type: 'Hero' });
    const state = makeState([source]);
    expect(state.topDeckRevealed).toBeUndefined();

    const on = gameReducer(state, act('source-1', 0));
    expect(on.topDeckRevealed).toBe(true);

    const off = gameReducer(on, act('source-1', 0));
    expect(off.topDeckRevealed).toBe(false);
  });

  it('does not touch any zone contents', () => {
    const source = makeCard({ zone: 'territory', cardName: 'The Foretelling Angel (PC)', type: 'Hero' });
    const top = makeCard({ instanceId: 'deck-top', cardName: 'Daniel (Pr)', type: 'Hero', zone: 'deck' });
    const state = makeState([source, top]);

    const next = gameReducer(state, act('source-1', 0));

    expect(next.zones.deck.map(c => c.instanceId)).toEqual(['deck-top']);
    expect(next.zones.territory.map(c => c.instanceId)).toEqual(['source-1']);
  });

  it('is blocked outside the in-play zones (hand)', () => {
    const source = makeCard({ zone: 'hand', cardName: 'The Foretelling Angel (PC)', type: 'Hero' });
    const state = makeState([source]);

    expect(gameReducer(state, act('source-1', 0))).toBe(state);
  });

  it('undo restores the previous flag', () => {
    const source = makeCard({ zone: 'territory', cardName: 'The Foretelling Angel (PC)', type: 'Hero' });
    const state = makeState([source]);

    const on = gameReducer(state, act('source-1', 0));
    expect(on.topDeckRevealed).toBe(true);

    const undone = gameReducer(on, {
      id: 'u',
      type: 'MOVE_CARD',
      playerId: 'player1',
      timestamp: 0,
      payload: { value: '__UNDO__' },
    });
    expect(undone.topDeckRevealed).toBeUndefined();
  });
});
