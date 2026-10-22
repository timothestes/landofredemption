import { CounterColorId, GameAction, ZoneId } from '../types';

function createAction(
  type: GameAction['type'],
  payload: GameAction['payload'] = {}
): GameAction {
  return {
    id: crypto.randomUUID(),
    type,
    playerId: 'player1',
    timestamp: Date.now(),
    payload,
  };
}

export const actions = {
  moveCard(cardInstanceId: string, toZone: ZoneId, toIndex?: number, posX?: number, posY?: number): GameAction {
    return createAction('MOVE_CARD', { cardInstanceId, toZone, toIndex, posX, posY });
  },

  moveCardToTopOfDeck(cardInstanceId: string): GameAction {
    return createAction('MOVE_TO_TOP_OF_DECK', { cardInstanceId });
  },

  moveCardToBottomOfDeck(cardInstanceId: string): GameAction {
    return createAction('MOVE_TO_BOTTOM_OF_DECK', { cardInstanceId });
  },

  drawCard(): GameAction {
    return createAction('DRAW_CARD');
  },

  drawMultiple(quantity: number): GameAction {
    return createAction('DRAW_MULTIPLE', { quantity });
  },

  shuffleDeck(): GameAction {
    return createAction('SHUFFLE_DECK');
  },

  shuffleSoulDeck(): GameAction {
    return createAction('SHUFFLE_SOUL_DECK');
  },

  shuffleCardIntoDeck(cardInstanceId: string): GameAction {
    // Move card to deck, then shuffle
    return createAction('MOVE_CARD', { cardInstanceId, toZone: 'deck' });
  },

  addCounter(cardInstanceId: string, color: CounterColorId = 'red'): GameAction {
    return createAction('ADD_COUNTER', { cardInstanceId, color });
  },

  removeCounter(cardInstanceId: string, color: CounterColorId = 'red'): GameAction {
    return createAction('REMOVE_COUNTER', { cardInstanceId, color });
  },

  meekCard(cardInstanceId: string): GameAction {
    return createAction('MEEK_CARD', { cardInstanceId });
  },

  unmeekCard(cardInstanceId: string): GameAction {
    return createAction('UNMEEK_CARD', { cardInstanceId });
  },

  flipCard(cardInstanceId: string): GameAction {
    return createAction('FLIP_CARD', { cardInstanceId });
  },

  revealCardInHand(cardInstanceId: string): GameAction {
    const revealUntil = Date.now() + 30_000;
    return createAction('REVEAL_CARD_IN_HAND', { cardInstanceId, value: revealUntil });
  },

  advancePhase(): GameAction {
    return createAction('ADVANCE_PHASE');
  },

  regressPhase(): GameAction {
    return createAction('REGRESS_PHASE');
  },

  endTurn(): GameAction {
    return createAction('END_TURN');
  },

  addNote(cardInstanceId: string, note: string): GameAction {
    return createAction('ADD_NOTE', { cardInstanceId, value: note });
  },

  addOpponentLostSoul(testament: 'NT' | 'OT' = 'NT', posX?: number, posY?: number): GameAction {
    return createAction('ADD_OPPONENT_LOST_SOUL', { value: testament, posX, posY });
  },

  removeOpponentToken(cardInstanceId: string): GameAction {
    return createAction('REMOVE_OPPONENT_TOKEN', { cardInstanceId });
  },

  moveCardsBatch(cardInstanceIds: string[], toZone: ZoneId, positions?: Record<string, { posX: number; posY: number }>): GameAction {
    return createAction('MOVE_CARDS_BATCH', { cardInstanceIds, toZone, positions });
  },

  addPlayerLostSoul(): GameAction {
    return createAction('ADD_PLAYER_LOST_SOUL');
  },

  reorderHand(cardInstanceIds: string[]): GameAction {
    return createAction('REORDER_HAND', { cardInstanceIds });
  },

  reorderLob(cardInstanceIds: string[]): GameAction {
    return createAction('REORDER_LOB', { cardInstanceIds });
  },

  /** Lay the whole deck (every listed card, whatever zone it sits in) out
   *  across Territory at precomputed positions (see layout/deckSpreadLayout.ts).
   *  `cardInstanceIds` is the paint order. */
  spreadDeckPile(cardInstanceIds: string[], positions: Record<string, { posX: number; posY: number }>): GameAction {
    return createAction('DECK_SPREAD', { cardInstanceIds, positions });
  },

  /** Put every spread card still in Territory back where it came from. */
  gatherDeckPile(): GameAction {
    return createAction('DECK_GATHER');
  },

  attachCard(cardInstanceId: string, warriorInstanceId: string): GameAction {
    return createAction('ATTACH_CARD', { cardInstanceId, warriorInstanceId });
  },

  detachCard(cardInstanceId: string, posX?: number, posY?: number): GameAction {
    return createAction('DETACH_CARD', { cardInstanceId, posX, posY });
  },

  executeCardAbility(cardInstanceId: string, abilityIndex: number): GameAction {
    return createAction('EXECUTE_CARD_ABILITY', { cardInstanceId, abilityIndex });
  },

  executeCardAbilityWithCount(cardInstanceId: string, abilityIndex: number, count: number): GameAction {
    return createAction('EXECUTE_CARD_ABILITY_WITH_COUNT', { cardInstanceId, abilityIndex, quantity: count });
  },

  resurrectHeroes(cardInstanceIds: string[]): GameAction {
    return createAction('RESURRECT_HEROES', { cardInstanceIds });
  },

  keepOneShuffleDraw(keepInstanceId: string, draw: boolean = true): GameAction {
    return createAction('KEEP_ONE_SHUFFLE_DRAW', { keepInstanceId, ...(draw ? {} : { skipDraw: true }) });
  },

  imitateLostSoul(sourceInstanceId: string, targetInstanceId: string): GameAction {
    return createAction('IMITATE_LOST_SOUL', {
      cardInstanceId: sourceInstanceId,
      targetInstanceId,
    });
  },

  stopImitatingLostSoul(sourceInstanceId: string): GameAction {
    return createAction('STOP_IMITATING_LOST_SOUL', {
      cardInstanceId: sourceInstanceId,
    });
  },
};
