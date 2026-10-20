'use client';

import { createContext, useContext, useReducer, useCallback, useMemo, type ReactNode } from 'react';
import { GameState, GameAction, ZoneId, DeckDataForGoldfish, GoldfishOptions, CounterColorId } from '../types';
import { gameReducer, undoAction } from './gameReducer';
import { buildInitialGameState } from './gameInitializer';
import { actions } from './gameActions';
import { clearGameToasts } from '../components/GameToast';

interface GameContextValue {
  state: GameState;
  dispatch: (action: GameAction) => void;
  drawCard: () => void;
  drawMultiple: (count: number) => void;
  moveCard: (cardInstanceId: string, toZone: ZoneId, toIndex?: number, posX?: number, posY?: number) => void;
  moveCardToTopOfDeck: (cardInstanceId: string) => void;
  moveCardToBottomOfDeck: (cardInstanceId: string) => void;
  shuffleCardIntoDeck: (cardInstanceId: string) => void;
  shuffleDeck: () => void;
  undo: () => void;
  newGame: () => void;
  advancePhase: () => void;
  regressPhase: () => void;
  endTurn: () => void;
  addCounter: (cardInstanceId: string, color?: CounterColorId) => void;
  removeCounter: (cardInstanceId: string, color?: CounterColorId) => void;
  meekCard: (cardInstanceId: string) => void;
  unmeekCard: (cardInstanceId: string) => void;
  flipCard: (cardInstanceId: string) => void;
  revealCardInHand: (cardInstanceId: string) => void;
  addNote: (cardInstanceId: string, note: string) => void;
  addOpponentLostSoul: (testament?: 'NT' | 'OT', posX?: number, posY?: number) => void;
  removeOpponentToken: (cardInstanceId: string) => void;
  executeCardAbility: (cardInstanceId: string, abilityIndex: number) => void;
  moveCardsBatch: (cardInstanceIds: string[], toZone: ZoneId, positions?: Record<string, { posX: number; posY: number }>) => void;
  addPlayerLostSoul: () => void;
  reorderHand: (cardInstanceIds: string[]) => void;
  reorderLob: (cardInstanceIds: string[]) => void;
  attachCard: (cardInstanceId: string, warriorInstanceId: string) => void;
  detachCard: (cardInstanceId: string, posX?: number, posY?: number) => void;
  toggleSpreadHand: () => void;
  /** Gear menu "Spread Deck" / "Gather Deck" — see layout/deckSpreadLayout.ts. */
  spreadDeckPile: (cardInstanceIds: string[], positions: Record<string, { posX: number; posY: number }>) => void;
  gatherDeckPile: () => void;
}

const GameContext = createContext<GameContextValue | null>(null);

interface GameProviderProps {
  children: ReactNode;
  deck: DeckDataForGoldfish;
  optionsOverrides?: Partial<GoldfishOptions>;
  /** Logged-in user's profile username — only used to gate the cycling-token
   *  easter egg. Null/undefined when not signed in. */
  username?: string | null;
}

export function GameProvider({ children, deck, optionsOverrides, username }: GameProviderProps) {
  const initialState = useMemo(
    () => buildInitialGameState(deck, optionsOverrides, username),
    // Only compute once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [state, baseDispatch] = useReducer(gameReducer, initialState);

  const dispatch = useCallback((action: GameAction) => {
    baseDispatch(action);
  }, []);

  const drawCard = useCallback(() => dispatch(actions.drawCard()), [dispatch]);
  const drawMultiple = useCallback((count: number) => dispatch(actions.drawMultiple(count)), [dispatch]);
  const moveCard = useCallback(
    (cardInstanceId: string, toZone: ZoneId, toIndex?: number, posX?: number, posY?: number) =>
      dispatch(actions.moveCard(cardInstanceId, toZone, toIndex, posX, posY)),
    [dispatch]
  );
  const moveCardToTopOfDeck = useCallback(
    (cardInstanceId: string) => dispatch(actions.moveCardToTopOfDeck(cardInstanceId)),
    [dispatch]
  );
  const moveCardToBottomOfDeck = useCallback(
    (cardInstanceId: string) => dispatch(actions.moveCardToBottomOfDeck(cardInstanceId)),
    [dispatch]
  );
  const shuffleCardIntoDeck = useCallback(
    (cardInstanceId: string) => {
      dispatch(actions.shuffleCardIntoDeck(cardInstanceId));
      dispatch(actions.shuffleDeck());
    },
    [dispatch]
  );
  const shuffleDeck = useCallback(() => dispatch(actions.shuffleDeck()), [dispatch]);

  const undo = useCallback(() => {
    // undoAction is not an action dispatch — it restores previous state
    // We use a special UNDO action type handled differently
    baseDispatch({
      id: crypto.randomUUID(),
      type: 'MOVE_CARD', // placeholder, won't be used
      playerId: 'player1',
      timestamp: Date.now(),
      payload: { value: '__UNDO__' },
    });
  }, []);

  const newGame = useCallback(() => {
    clearGameToasts();
    const freshState = buildInitialGameState(deck, optionsOverrides, username);
    baseDispatch({
      id: crypto.randomUUID(),
      type: 'RESET_GAME',
      playerId: 'player1',
      timestamp: Date.now(),
      payload: { value: JSON.stringify(freshState) },
    });
  }, [deck, optionsOverrides, username]);

  const advancePhase = useCallback(() => dispatch(actions.advancePhase()), [dispatch]);
  const regressPhase = useCallback(() => dispatch(actions.regressPhase()), [dispatch]);
  const endTurn = useCallback(() => dispatch(actions.endTurn()), [dispatch]);
  const addCounter = useCallback((id: string, color?: CounterColorId) => dispatch(actions.addCounter(id, color)), [dispatch]);
  const removeCounter = useCallback((id: string, color?: CounterColorId) => dispatch(actions.removeCounter(id, color)), [dispatch]);
  const meekCard = useCallback((id: string) => dispatch(actions.meekCard(id)), [dispatch]);
  const unmeekCard = useCallback((id: string) => dispatch(actions.unmeekCard(id)), [dispatch]);
  const flipCard = useCallback((id: string) => dispatch(actions.flipCard(id)), [dispatch]);
  const revealCardInHand = useCallback((id: string) => dispatch(actions.revealCardInHand(id)), [dispatch]);
  const addNote = useCallback(
    (id: string, note: string) => dispatch(actions.addNote(id, note)),
    [dispatch]
  );
  const addOpponentLostSoul = useCallback(
    (testament?: 'NT' | 'OT', posX?: number, posY?: number) => dispatch(actions.addOpponentLostSoul(testament, posX, posY)),
    [dispatch]
  );
  const removeOpponentToken = useCallback(
    (id: string) => dispatch(actions.removeOpponentToken(id)),
    [dispatch]
  );
  const executeCardAbility = useCallback(
    (cardInstanceId: string, abilityIndex: number) =>
      dispatch(actions.executeCardAbility(cardInstanceId, abilityIndex)),
    [dispatch]
  );
  const moveCardsBatch = useCallback(
    (cardInstanceIds: string[], toZone: ZoneId, positions?: Record<string, { posX: number; posY: number }>) =>
      dispatch(actions.moveCardsBatch(cardInstanceIds, toZone, positions)),
    [dispatch]
  );
  const addPlayerLostSoul = useCallback(() => dispatch(actions.addPlayerLostSoul()), [dispatch]);
  const reorderHand = useCallback(
    (cardInstanceIds: string[]) => dispatch(actions.reorderHand(cardInstanceIds)),
    [dispatch]
  );
  const reorderLob = useCallback(
    (cardInstanceIds: string[]) => dispatch(actions.reorderLob(cardInstanceIds)),
    [dispatch]
  );
  const attachCard = useCallback(
    (cardInstanceId: string, warriorInstanceId: string) =>
      dispatch(actions.attachCard(cardInstanceId, warriorInstanceId)),
    [dispatch]
  );
  const detachCard = useCallback(
    (cardInstanceId: string, posX?: number, posY?: number) =>
      dispatch(actions.detachCard(cardInstanceId, posX, posY)),
    [dispatch]
  );
  const spreadDeckPile = useCallback(
    (cardInstanceIds: string[], positions: Record<string, { posX: number; posY: number }>) =>
      dispatch(actions.spreadDeckPile(cardInstanceIds, positions)),
    [dispatch]
  );
  const gatherDeckPile = useCallback(() => dispatch(actions.gatherDeckPile()), [dispatch]);

  const toggleSpreadHand = useCallback(() => {
    // Spread hand toggle — handled via a special action or direct state
    // For now we'll handle this through a local override
    baseDispatch({
      id: crypto.randomUUID(),
      type: 'MOVE_CARD', // placeholder
      playerId: 'player1',
      timestamp: Date.now(),
      payload: { value: '__TOGGLE_SPREAD__' },
    });
  }, []);

  const value = useMemo(
    () => ({
      state,
      dispatch,
      drawCard,
      drawMultiple,
      moveCard,
      moveCardToTopOfDeck,
      moveCardToBottomOfDeck,
      shuffleCardIntoDeck,
      shuffleDeck,
      undo,
      newGame,
      advancePhase,
      regressPhase,
      endTurn,
      addCounter,
      removeCounter,
      meekCard,
      unmeekCard,
      flipCard,
      revealCardInHand,
      addNote,
      addOpponentLostSoul,
      removeOpponentToken,
      executeCardAbility,
      moveCardsBatch,
      addPlayerLostSoul,
      reorderHand,
      reorderLob,
      attachCard,
      detachCard,
      toggleSpreadHand,
      spreadDeckPile,
      gatherDeckPile,
    }),
    [
      state, dispatch, drawCard, drawMultiple, moveCard,
      moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleCardIntoDeck,
      shuffleDeck, undo, newGame, advancePhase, regressPhase, endTurn,
      addCounter, removeCounter, meekCard, unmeekCard, flipCard, revealCardInHand,
      addNote, addOpponentLostSoul, removeOpponentToken, executeCardAbility, moveCardsBatch, addPlayerLostSoul, reorderHand, reorderLob, attachCard, detachCard, toggleSpreadHand,
      spreadDeckPile, gatherDeckPile,
    ]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within a GameProvider');
  return ctx;
}
