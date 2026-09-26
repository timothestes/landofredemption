'use client';

import { useMemo, useCallback } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from '@/lib/spacetimedb/module_bindings';
import type {
  Game,
  Player,
  CardInstance,
  CardCounter,
  ChatMessage,
  GameAction,
  Spectator,
  DisconnectTimeout,
  Emote,
  ForgeGame,
  PregameState,
  PregameStar,
} from '@/lib/spacetimedb/module_bindings/types';
import type { GameCard } from '@/app/goldfish/types';
import { useStableAdaptedCards } from '../utils/cardAdapter';
import type { ForgeResolverMap } from '../utils/forgeResolver';
import { showGameToast } from '@/app/shared/components/GameToast';
import { countRedeemedSouls } from '@/lib/cards/cardAbilities';

// ---------------------------------------------------------------------------
// Row types inferred from the generated type objects
// ---------------------------------------------------------------------------
type GameRow = Game;
type PlayerRow = Player;
type CardInstanceRow = CardInstance;
type CardCounterRow = CardCounter;
type ChatMessageRow = ChatMessage;
type GameActionRow = GameAction;
type SpectatorRow = Spectator;
type DisconnectTimeoutRow = DisconnectTimeout;
type EmoteRow = Emote;
type ForgeGameRow = ForgeGame;
type PregameStateRow = PregameState;
type PregameStarRow = PregameStar;

// ---------------------------------------------------------------------------
// Phase Stops (spec §5.4): setPhase/endTurn/endBattle/resolveBattle/
// surrenderSoul are hold-gated server-side and reject with a SenderError
// whose message is already user-facing ("The turn is held — waiting on
// {name}"). conn.reducers.X() returns a Promise (DbConnectionImpl.
// callReducer) — without a .catch() the rejection is an unhandled promise
// rejection with no client-side surface at all.
// ---------------------------------------------------------------------------
function toastReducerError(e: unknown): void {
  showGameToast(e instanceof Error ? e.message : 'Action refused');
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface GameState {
  // All games (used for game discovery by code before gameId is known)
  allGames: GameRow[];
  // All players (used for joiner reconnect detection before gameId is known)
  allPlayers: PlayerRow[];

  // Core data
  game: GameRow | undefined;
  myPlayer: PlayerRow | undefined;
  opponentPlayer: PlayerRow | undefined;
  opponentConnectionStatus: 'connected' | 'reconnecting' | 'disconnected';
  disconnectTimeoutFired: boolean;
  myCards: Record<string, CardInstanceRow[]>;
  opponentCards: Record<string, CardInstanceRow[]>;
  /** Cards with ownerId === 0n (Paragon shared cards — Soul Deck and shared LoB souls). */
  sharedCards: Record<string, CardInstanceRow[]>;
  isMyTurn: boolean;
  counters: Map<bigint, CardCounterRow[]>;
  /**
   * Reference-stable adapted GameCard objects keyed by CardInstance id.
   * Unchanged cards return the same GameCard reference across renders, so
   * `memo(GameCardNode)`'s shallow prop compare short-circuits and only
   * cards whose content actually changed re-render.
   */
  adaptedCardsById: Map<bigint, GameCard>;
  chatMessages: ChatMessageRow[];
  /** useTable's subscribeApplied for ChatMessage: false until the initial
   *  sync has landed. Lets callers tell "history arrived" from "a new
   *  message arrived" instead of counting the whole backlog as unread. */
  isChatReady: boolean;
  gameActions: GameActionRow[];
  spectators: SpectatorRow[];
  soulsRescued: { me: number; opponent: number };
  zoneSearchRequests: any[];
  incomingSearchRequest: any | null;
  approvedSearchRequest: any | null;
  emotes: EmoteRow[];
  /** True when this game has a matching ForgeGame row (private Forge playtest game). */
  isForgeGame: boolean;

  // Loading state
  isLoading: boolean;
  // True once the game table subscription has applied (data is in client cache)
  isGamesReady: boolean;
  // True once the player table subscription has applied. Required by reconnect
  // logic that checks `allPlayers` to detect "already joined" — gating only on
  // isGamesReady races the Player subscription and falsely fires joinGame on a
  // playing-status game, which the server rejects.
  isPlayersReady: boolean;

  // Connection identity (as hex string for comparisons)
  identityHex: string | undefined;

  // Action methods — each wraps a SpacetimeDB reducer call
  drawCard: () => void;
  drawMultiple: (count: bigint) => void;
  matthewDrawBrigades: (cardInstanceId: bigint, brigadeCount: bigint) => void;
  moveCard: (cardInstanceId: bigint, toZone: string, zoneIndex?: string, posX?: string, posY?: string, targetOwnerId?: string) => void;
  moveCardsBatch: (cardInstanceIds: string, toZone: string, positions?: string, targetOwnerId?: string, fromSource?: string) => void;
  attachCard: (weaponInstanceId: bigint, warriorInstanceId: bigint) => void;
  detachCard: (weaponInstanceId: bigint, posX?: string, posY?: string) => void;
  shuffleDeck: () => void;
  shuffleCardIntoDeck: (cardInstanceId: bigint) => void;
  /** Paragon-only — shuffle all shared Soul Deck cards via server reducer. */
  shuffleSoulDeck: () => void;
  reloadDeck: (deckId: string, deckData: string, paragon: string) => void;
  randomHandToZone: (count: number, toZone: string, deckPosition: string) => void;
  randomReserveToZone: (count: number, toZone: string, deckPosition: string) => void;
  randomOpponentHandToZone: (requestId: bigint, count: number, toZone: string, deckPosition: string) => void;
  opponentShuffleAndDraw: (requestId: bigint, shuffleCount: number, drawCount: number) => void;
  keepOneShuffleDraw: (sourceInstanceId: bigint, keepInstanceId: bigint) => void;
  opponentKeepOneShuffleDraw: (requestId: bigint, keepInstanceId: bigint) => void;
  threeNailsResetExecute: (requestId: bigint) => void;
  discardReserveCharactersExecute: (requestId: bigint) => void;
  meekCard: (cardInstanceId: bigint) => void;
  unmeekCard: (cardInstanceId: bigint) => void;
  flipCard: (cardInstanceId: bigint) => void;
  revealCardInHand: (cardInstanceId: bigint) => void;
  updateCardPosition: (cardInstanceId: bigint, posX: string, posY: string) => void;
  addCounter: (cardInstanceId: bigint, color: string) => void;
  removeCounter: (cardInstanceId: bigint, color: string) => void;
  setNote: (cardInstanceId: bigint, text: string) => void;
  exchangeCards: (cardInstanceIds: string) => void;
  exchangeFromDeck: (exchangeCardIds: string, replacementMoves: string) => void;
  setPhase: (phase: string) => void;
  endTurn: () => void;
  rollDice: (sides: bigint) => void;
  sendChat: (text: string) => void | Promise<unknown>;
  setPlayerOption: (optionName: string, value: string) => void;
  revealHand: (revealed: boolean) => void;
  revealReserve: (revealed: boolean) => void;
  moveCardToTopOfDeck: (cardInstanceId: bigint) => void;
  moveCardToBottomOfDeck: (cardInstanceId: bigint) => void;
  spawnLostSoul: (testament: string, posX: string, posY: string, targetPlayerId?: string) => void;
  removeToken: (cardInstanceId: bigint) => void;
  executeCardAbility: (sourceInstanceId: string, abilityIndex: number) => void;
  executeCardAbilityWithCount: (sourceInstanceId: string, abilityIndex: number, count: number) => void;
  imitateLostSoul: (sourceInstanceId: string, targetInstanceId: string) => void;
  stopImitatingLostSoul: (sourceInstanceId: string) => void;
  resurrectHeroes: (sourceInstanceId: string, abilityIndex: number, selectedInstanceIds: string[]) => void;
  surrenderLostSoul: (cardInstanceId: bigint) => void;
  rescueLostSoul: (cardInstanceId: bigint) => void;
  resignGame: () => void;
  leaveGame: () => void;
  claimTimeoutVictory: () => void;
  // Pregame ceremony actions
  pregameAcknowledgeRoll: () => void;
  pregameChooseFirst: (chosenSeat: bigint) => void;
  pregameAcknowledgeFirst: () => void;
  pregameSkipToReveal: (chosenSeat: bigint) => void;
  pregameChangeDeck: (deckId: string, deckData: string, paragon: string) => void;
  // Pre-game star / Lost Soul sub-phase state + actions
  /** The game's pre-game sub-phase row, or null before the server creates it. */
  pregameState: PregameStateRow | null;
  /** This game's star reveals, ascending by resolution slot. */
  pregameStars: PregameStarRow[];
  pregameSubmitStars: (cardInstanceIds: bigint[]) => void;
  pregameResolveStar: (starId: bigint) => void;
  pregameFinishSouls: () => void;
  // Rematch actions
  requestRematch: (deckId: string, deckData: string, paragon: string, format: string) => void;
  respondRematch: (accepted: boolean, deckId: string, deckData: string, paragon: string, format: string) => void;
  cancelRematch: () => void;
  revealCards: (cardIds: string, context?: string) => void;
  clearRevealedCards: () => void;
  logSearchDeck: () => void;
  logLookAtTop: (count: number, sourceCardName?: string, position?: 'top' | 'bottom' | 'random') => void;
  logDeckSearchNoShuffle: (topCount: number, bottomCount: number) => void;
  requestZoneSearch: (zone: string) => void;
  passInitiative: () => void;
  sendEmote: (kind: string) => void;
  requestOpponentAction: (action: string, actionParams?: string) => void;
  approveZoneSearch: (requestId: bigint) => void;
  denyZoneSearch: (requestId: bigint) => void;
  completeZoneSearch: (requestId: bigint, shuffled?: boolean) => void;
  moveOpponentCard: (requestId: bigint, cardInstanceId: bigint, toZone: string, posX?: string, posY?: string, newOwnerId?: string) => void;
  shuffleOpponentDeck: (requestId: bigint) => void;
  reorderHand: (cardIds: string) => void;
  reorderLob: (cardIds: string) => void;

  // Battle zone (Field of Battle) — denormalized Game fields + reducer wrappers.
  /** '' | 'active' | 'awaiting-soul' */
  battleState: string;
  /** '' | '0' | '1' — seat of the attacker (turn seat when the band opened). */
  battleAttackerSeat: string;
  /** '' | '0' | '1' — seat that last played a card into the band. */
  lastBattlePlayBySeat: string;
  /** Atomic open-if-closed + move + stamp (server enter_battle). */
  enterBattle: (cardInstanceId: bigint, posX: string, posY: string) => void;
  endBattle: () => void;
  resolveBattle: () => void;
  surrenderSoul: (cardInstanceId: bigint) => void;

  /** Phase Stops */
  /** Viewer's own stop phases (spectator: always []). */
  myStops: string[];
  /** '' = no hold. */
  holdPhase: string;
  /** Non-active seat while holding, else null. */
  holdSeat: bigint | null;
  /** From the timeout row's `scheduledAt`. */
  holdDeadlineMicros: bigint | null;
  setTurnStop: (phase: string, enabled: boolean) => void;
  /** Active player answers the priority prompt (Grant: denied=false, Deny:
   *  denied=true). Either way the hold just lifts — nothing advances. */
  releaseTurnStop: (denied: boolean) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGameState(gameId: bigint, forgeResolver?: ForgeResolverMap | null): GameState {
  // Connection + identity from SpacetimeDB provider
  const spacetimeCtx = useSpacetimeDB() as any;
  const conn = spacetimeCtx?.getConnection?.() ?? null;
  const identity = spacetimeCtx?.identity;

  const identityHex: string | undefined = identity?.toHexString?.();

  // ---------------------------------------------------------------------------
  // Subscribe to relevant tables, scoping each subscription to the active game
  // when we have a gameId column to filter on. The typed query builder pushes
  // the WHERE clause to the server (so the connection only receives matching
  // rows) AND filters callbacks at the React layer (so unrelated row changes
  // don't trigger re-renders). When gameId is 0n (initial value before
  // discovery), the eq filter matches no rows — strictly safer than
  // subscribing globally.
  //
  // Game and Player stay unfiltered: `client.tsx` reconnect logic walks
  // `allGames` / `allPlayers` to find existing rows by `code` BEFORE the
  // numeric gameId is known. CardCounter has no gameId column — it stays
  // unfiltered until the schema split adds one.
  // ---------------------------------------------------------------------------
  const [allGames, gamesLoading] = useTable(tables.Game) as [GameRow[], boolean];
  const [allPlayers, playersLoading] = useTable(tables.Player) as [PlayerRow[], boolean];
  const [allCards, cardsLoading] = useTable(
    tables.CardInstance.where(c => c.gameId.eq(gameId)),
  ) as [CardInstanceRow[], boolean];
  const [allCounters, countersLoading] = useTable(tables.CardCounter) as [CardCounterRow[], boolean];
  const [allChat, chatLoading] = useTable(
    tables.ChatMessage.where(m => m.gameId.eq(gameId)),
  ) as [ChatMessageRow[], boolean];
  const [allActions, actionsLoading] = useTable(
    tables.GameAction.where(a => a.gameId.eq(gameId)),
  ) as [GameActionRow[], boolean];
  const [allSpectators, spectatorsLoading] = useTable(
    tables.Spectator.where(s => s.gameId.eq(gameId)),
  ) as [SpectatorRow[], boolean];
  const [allZoneSearchRequests, zsrLoading] = useTable(
    tables.ZoneSearchRequest.where(z => z.gameId.eq(gameId)),
  ) as [any[], boolean];
  const [allDisconnectTimeouts] = useTable(
    tables.DisconnectTimeout.where(t => t.gameId.eq(gameId)),
  ) as [DisconnectTimeoutRow[], boolean];
  const [allEmotes] = useTable(
    tables.Emote.where(e => e.gameId.eq(gameId)),
  ) as [EmoteRow[], boolean];
  const [forgeGameRows] = useTable(
    tables.ForgeGame.where(r => r.gameId.eq(gameId)),
  ) as [ForgeGameRow[], boolean];
  const [pregameStateRows] = useTable(
    tables.PregameState.where(r => r.gameId.eq(gameId)),
  ) as [PregameStateRow[], boolean];
  const [pregameStarRows] = useTable(
    tables.PregameStar.where(r => r.gameId.eq(gameId)),
  ) as [PregameStarRow[], boolean];
  const [turnStopRows] = useTable(
    tables.TurnStop.where((r) => r.gameId.eq(gameId)),
  ) as [any[], boolean];
  const [stopHoldTimeoutRows] = useTable(
    tables.StopHoldTimeout.where((r) => r.gameId.eq(gameId)),
  ) as [any[], boolean];

  // useTable returns [rows, subscribeApplied] where subscribeApplied=true means data is ready
  // Only require core tables (game, player, cards) — chat/actions/spectators can load async
  const isLoading = !(gamesLoading && playersLoading && cardsLoading);

  const isForgeGame = forgeGameRows.length > 0;

  // One PregameState row per game (gameId is unique), so the first row is it.
  const pregameState = pregameStateRows[0] ?? null;

  const pregameStars = useMemo(
    () => [...pregameStarRows].sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0)),
    [pregameStarRows],
  );

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const game = useMemo(
    () => allGames.find((g) => g.id === gameId),
    [allGames, gameId],
  );

  const gamePlayers = useMemo(
    () => allPlayers.filter((p) => p.gameId === gameId),
    [allPlayers, gameId],
  );

  const myPlayer = useMemo(
    () =>
      identityHex
        ? gamePlayers.find((p) => (p.identity as any)?.toHexString?.() === identityHex)
        : undefined,
    [gamePlayers, identityHex],
  );

  const opponentPlayer = useMemo(
    () =>
      identityHex
        ? gamePlayers.find((p) => (p.identity as any)?.toHexString?.() !== identityHex)
        : undefined,
    [gamePlayers, identityHex],
  );

  const disconnectTimeoutFired = game?.disconnectTimeoutFired ?? false;

  const opponentConnectionStatus = useMemo((): 'connected' | 'reconnecting' | 'disconnected' => {
    if (!opponentPlayer) return 'connected';
    if (opponentPlayer.isConnected) return 'connected';
    const hasPendingTimeout = allDisconnectTimeouts.some(
      (t) => t.playerId === opponentPlayer.id,
    );
    if (hasPendingTimeout) return 'reconnecting';
    // No timeout and isConnected is false — two possibilities:
    // 1. disconnectTimeoutFired is true → the 5-min timeout genuinely fired → 'disconnected'
    // 2. disconnectTimeoutFired is false → stale data from a brief WebSocket reconnection
    //    where clientConnected cancelled the timeout but isConnected wasn't restored.
    //    Default to 'connected' to avoid false-alarm red dots.
    return disconnectTimeoutFired ? 'disconnected' : 'connected';
  }, [opponentPlayer, allDisconnectTimeouts, disconnectTimeoutFired]);

  const isMyTurn = useMemo(
    () => (game && myPlayer ? game.currentTurn === myPlayer.seat : false),
    [game, myPlayer],
  );

  // ---- Phase Stops (opponent-turn priority stops) ----
  const turnStopRow = turnStopRows[0] ?? null;

  const myStops = useMemo(() => {
    if (!turnStopRow || !myPlayer) return [] as string[];
    const csv: string = myPlayer.seat === 0n ? turnStopRow.seat0Stops : turnStopRow.seat1Stops;
    return csv ? csv.split(',') : [];
  }, [turnStopRow, myPlayer]);

  const holdPhase: string = turnStopRow?.holdPhase ?? '';

  // The holding seat is always the non-active seat.
  const holdSeat = useMemo(() => {
    if (!game || holdPhase === '') return null;
    return game.currentTurn === 0n ? 1n : 0n;
  }, [game, holdPhase]);

  const holdDeadlineMicros = useMemo(() => {
    if (holdPhase === '') return null;
    const row = stopHoldTimeoutRows[0];
    if (!row) return null;
    const sched: any = row.scheduledAt;
    if (sched?.tag !== 'Time') return null;
    return sched.value.microsSinceUnixEpoch as bigint;
  }, [stopHoldTimeoutRows, holdPhase]);

  // Cards for this game, grouped by owner and zone
  const gameCards = useMemo(
    () => allCards.filter((c) => c.gameId === gameId),
    [allCards, gameId],
  );

  const myCards = useMemo(() => {
    if (!myPlayer) return {} as Record<string, CardInstanceRow[]>;
    return groupCardsByZone(gameCards.filter((c) => c.ownerId === myPlayer.id));
  }, [gameCards, myPlayer]);

  const opponentCards = useMemo(() => {
    if (!opponentPlayer) return {} as Record<string, CardInstanceRow[]>;
    return groupCardsByZone(gameCards.filter((c) => c.ownerId === opponentPlayer.id));
  }, [gameCards, opponentPlayer]);

  // Shared cards — ownerId === 0n sentinel (Paragon Soul Deck + shared-origin souls
  // still in the shared LoB). Once a shared soul is rescued, the move_card reducer
  // transfers ownership to the rescuer, so the card leaves this bucket and lands
  // in myCards / opponentCards under land-of-redemption.
  const sharedCards = useMemo(() => {
    return groupCardsByZone(gameCards.filter((c) => c.ownerId === 0n));
  }, [gameCards]);

  // Counters indexed by cardInstanceId
  const counters = useMemo(() => {
    const map = new Map<bigint, CardCounterRow[]>();
    // Only include counters for cards that belong to this game
    const gameCardIds = new Set(gameCards.map((c) => c.id));
    for (const counter of allCounters) {
      if (!gameCardIds.has(counter.cardInstanceId)) continue;
      const existing = map.get(counter.cardInstanceId);
      if (existing) {
        existing.push(counter);
      } else {
        map.set(counter.cardInstanceId, [counter]);
      }
    }
    return map;
  }, [allCounters, gameCards]);

  // Reference-stable adapted GameCard objects. Critical perf path: by holding
  // the same GameCard reference across renders for unchanged rows, memo(GameCardNode)
  // can actually short-circuit and skip re-rendering cards that didn't change.
  const adaptedCardsById = useStableAdaptedCards(
    gameCards,
    counters,
    opponentPlayer?.id,
    forgeResolver,
  );

  // Chat messages for this game, sorted by sentAt
  const chatMessages = useMemo(
    () =>
      allChat
        .filter((m) => m.gameId === gameId)
        .sort((a, b) => {
          const aTime = Number((a.sentAt as any).microsSinceUnixEpoch / BigInt(1000));
          const bTime = Number((b.sentAt as any).microsSinceUnixEpoch / BigInt(1000));
          return aTime - bTime;
        }),
    [allChat, gameId],
  );

  // Game actions for this game, sorted by id ascending
  const gameActions = useMemo(
    () =>
      allActions
        .filter((a) => a.gameId === gameId)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [allActions, gameId],
  );

  // Spectators for this game
  const spectators = useMemo(
    () => allSpectators.filter((s) => s.gameId === gameId),
    [allSpectators, gameId],
  );

  // Souls rescued — the same Redeemed Soul rule as the canvas badges and the
  // server win check (Liners count 2, rescued captives 1, Guardian of Your
  // Souls 0), so the header can never disagree with the board.
  const soulsRescued = useMemo(() => {
    return {
      me: countRedeemedSouls(myCards['land-of-redemption'] ?? []),
      opponent: countRedeemedSouls(opponentCards['land-of-redemption'] ?? []),
    };
  }, [myCards, opponentCards]);

  const zoneSearchRequests = useMemo(
    () => allZoneSearchRequests.filter((r: any) => r.gameId === gameId),
    [allZoneSearchRequests, gameId],
  );

  const incomingSearchRequest = useMemo(() => {
    if (!myPlayer) return null;
    return zoneSearchRequests.find((r: any) => r.targetPlayerId === myPlayer.id && r.status === 'pending') ?? null;
  }, [zoneSearchRequests, myPlayer]);

  const approvedSearchRequest = useMemo(() => {
    if (!myPlayer) return null;
    return zoneSearchRequests.find((r: any) => r.requesterId === myPlayer.id && r.status === 'approved') ?? null;
  }, [zoneSearchRequests, myPlayer]);

  // ---------------------------------------------------------------------------
  // Action methods — each wraps a SpacetimeDB reducer call using object syntax
  // ---------------------------------------------------------------------------

  const drawCard = useCallback(() => {
    conn?.reducers.drawCard({ gameId });
  }, [conn, gameId]);

  const drawMultiple = useCallback(
    (count: bigint) => {
      conn?.reducers.drawMultiple({ gameId, count });
    },
    [conn, gameId],
  );

  const matthewDrawBrigades = useCallback(
    (cardInstanceId: bigint, brigadeCount: bigint) => {
      conn?.reducers.matthewDrawBrigades({ gameId, cardInstanceId, brigadeCount });
    },
    [conn, gameId],
  );

  const moveCard = useCallback(
    (cardInstanceId: bigint, toZone: string, zoneIndex?: string, posX?: string, posY?: string, targetOwnerId?: string) => {
      conn?.reducers.moveCard({
        gameId,
        cardInstanceId,
        toZone,
        zoneIndex: zoneIndex || '',
        posX: posX || '',
        posY: posY || '',
        targetOwnerId: targetOwnerId || '',
      });
    },
    [conn, gameId],
  );

  const moveCardsBatch = useCallback(
    (cardInstanceIds: string, toZone: string, positions?: string, targetOwnerId?: string, fromSource?: string) => {
      conn?.reducers.moveCardsBatch({
        gameId,
        cardInstanceIds,
        toZone,
        positions: positions || '{}',
        targetOwnerId: targetOwnerId || '',
        fromSource: fromSource || '',
      });
    },
    [conn, gameId],
  );

  const attachCard = useCallback(
    (weaponInstanceId: bigint, warriorInstanceId: bigint) => {
      conn?.reducers.attachCard({ gameId, weaponInstanceId, warriorInstanceId });
    },
    [conn, gameId],
  );

  const detachCard = useCallback(
    (weaponInstanceId: bigint, posX?: string, posY?: string) => {
      conn?.reducers.detachCard({
        gameId,
        weaponInstanceId,
        posX: posX || '',
        posY: posY || '',
      });
    },
    [conn, gameId],
  );

  const shuffleDeck = useCallback(() => {
    conn?.reducers.shuffleDeck({ gameId });
  }, [conn, gameId]);

  const shuffleCardIntoDeck = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.shuffleCardIntoDeck({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const shuffleSoulDeck = useCallback(() => {
    conn?.reducers.shuffleSoulDeck({ gameId });
  }, [conn, gameId]);

  const randomHandToZone = useCallback(
    (count: number, toZone: string, deckPosition: string) => {
      conn?.reducers.randomHandToZone({ gameId, count: BigInt(count), toZone, deckPosition });
    },
    [conn, gameId],
  );

  const randomReserveToZone = useCallback(
    (count: number, toZone: string, deckPosition: string) => {
      conn?.reducers.randomReserveToZone({ gameId, count: BigInt(count), toZone, deckPosition });
    },
    [conn, gameId],
  );

  const randomOpponentHandToZone = useCallback(
    (requestId: bigint, count: number, toZone: string, deckPosition: string) => {
      conn?.reducers.randomOpponentHandToZone({ gameId, requestId, count: BigInt(count), toZone, deckPosition });
    },
    [conn, gameId],
  );

  const opponentShuffleAndDraw = useCallback(
    (requestId: bigint, shuffleCount: number, drawCount: number) => {
      conn?.reducers.opponentShuffleAndDraw({
        gameId,
        requestId,
        shuffleCount: BigInt(shuffleCount),
        drawCount: BigInt(drawCount),
      });
    },
    [conn, gameId],
  );

  // Philip's Daughters — caster half. Fired after the caster picks their
  // keeper; the server opens the opponent's request as part of the same call.
  const keepOneShuffleDraw = useCallback(
    (sourceInstanceId: bigint, keepInstanceId: bigint) => {
      conn?.reducers.keepOneShuffleDraw({ gameId, sourceInstanceId, keepInstanceId });
    },
    [conn, gameId],
  );

  // Philip's Daughters — target half. Unlike opponentShuffleAndDraw this is
  // fired by the TARGET, since only they can pick their own keeper.
  const opponentKeepOneShuffleDraw = useCallback(
    (requestId: bigint, keepInstanceId: bigint) => {
      conn?.reducers.opponentKeepOneShuffleDraw({ gameId, requestId, keepInstanceId });
    },
    [conn, gameId],
  );

  const threeNailsResetExecute = useCallback(
    (requestId: bigint) => {
      conn?.reducers.threeNailsResetExecute({ gameId, requestId });
    },
    [conn, gameId],
  );

  const discardReserveCharactersExecute = useCallback(
    (requestId: bigint) => {
      conn?.reducers.discardReserveCharactersExecute({ gameId, requestId });
    },
    [conn, gameId],
  );

  const reloadDeck = useCallback(
    (deckId: string, deckData: string, paragon: string) => {
      conn?.reducers.reloadDeck({ gameId, deckId, deckData, paragon });
    },
    [conn, gameId],
  );

  const meekCard = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.meekCard({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const unmeekCard = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.unmeekCard({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const flipCard = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.flipCard({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const revealCardInHand = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.revealCardInHand({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const updateCardPosition = useCallback(
    (cardInstanceId: bigint, posX: string, posY: string) => {
      conn?.reducers.updateCardPosition({ gameId, cardInstanceId, posX, posY });
    },
    [conn, gameId],
  );

  const addCounter = useCallback(
    (cardInstanceId: bigint, color: string) => {
      conn?.reducers.addCounter({ gameId, cardInstanceId, color });
    },
    [conn, gameId],
  );

  const removeCounter = useCallback(
    (cardInstanceId: bigint, color: string) => {
      conn?.reducers.removeCounter({ gameId, cardInstanceId, color });
    },
    [conn, gameId],
  );

  const setNote = useCallback(
    (cardInstanceId: bigint, text: string) => {
      conn?.reducers.setNote({ gameId, cardInstanceId, text });
    },
    [conn, gameId],
  );

  const exchangeCards = useCallback(
    (cardInstanceIds: string) => {
      conn?.reducers.exchangeCards({ gameId, cardInstanceIds });
    },
    [conn, gameId],
  );

  const exchangeFromDeck = useCallback(
    (exchangeCardIds: string, replacementMoves: string) => {
      conn?.reducers.exchangeFromDeck({ gameId, exchangeCardIds, replacementMoves });
    },
    [conn, gameId],
  );

  const setPhase = useCallback(
    (phase: string) => {
      conn?.reducers.setPhase({ gameId, phase }).catch(toastReducerError);
    },
    [conn, gameId],
  );

  const endTurn = useCallback(() => {
    conn?.reducers.endTurn({ gameId }).catch(toastReducerError);
  }, [conn, gameId]);

  const setTurnStop = useCallback(
    (phase: string, enabled: boolean) => {
      conn?.reducers.setTurnStop({ gameId, phase, enabled }).catch(toastReducerError);
    },
    [conn, gameId],
  );

  const releaseTurnStop = useCallback(
    (denied: boolean) => {
      conn?.reducers.releaseTurnStop({ gameId, denied }).catch(toastReducerError);
    },
    [conn, gameId],
  );

  const rollDice = useCallback(
    (sides: bigint) => {
      conn?.reducers.rollDice({ gameId, sides });
    },
    [conn, gameId],
  );

  const sendChat = useCallback(
    (text: string) => {
      // Returns the promise so the caller can put the draft back. `conn?.` on
      // its own made a dropped socket a silent no-op: the input cleared, the
      // message was never sent, and nothing was shown — the exact shape of
      // "I typed it and they never got it".
      if (!conn) {
        const err = new Error('Not connected — message not sent');
        toastReducerError(err);
        return Promise.reject(err);
      }
      return conn.reducers.sendChat({ gameId, text }).catch((e: unknown) => {
        toastReducerError(e);
        throw e;
      });
    },
    [conn, gameId],
  );

  const setPlayerOption = useCallback(
    (optionName: string, value: string) => {
      conn?.reducers.setPlayerOption({ gameId, optionName, value });
    },
    [conn, gameId],
  );

  const revealHand = useCallback(
    (revealed: boolean) => {
      conn?.reducers.toggleRevealHand({ gameId, revealed });
    },
    [conn, gameId],
  );

  const revealReserve = useCallback(
    (revealed: boolean) => {
      conn?.reducers.toggleRevealReserve({ gameId, revealed });
    },
    [conn, gameId],
  );

  const revealCards = useCallback(
    (cardIds: string, context: string = '') => {
      conn?.reducers.revealCards({ gameId, cardIds, context });
    },
    [conn, gameId],
  );

  const clearRevealedCards = useCallback(
    () => {
      conn?.reducers.clearRevealedCards({ gameId });
    },
    [conn, gameId],
  );

  const moveCardToTopOfDeck = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.moveCardToTopOfDeck({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const moveCardToBottomOfDeck = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.moveCardToBottomOfDeck({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const spawnLostSoul = useCallback(
    (testament: string, posX: string, posY: string, targetPlayerId?: string) => {
      conn?.reducers.spawnLostSoul({ gameId, testament, posX, posY, targetPlayerId: targetPlayerId ?? '' });
    },
    [conn, gameId],
  );

  const removeToken = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.removeToken({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const executeCardAbility = useCallback(
    (sourceInstanceId: string, abilityIndex: number) => {
      // v1 registry has no `type: 'custom'` entries, so every ability routes
      // through the generic reducer. When the first custom ability ships,
      // branch here and call conn.reducers[ability.reducerName] directly.
      conn?.reducers.executeCardAbility({
        gameId,
        cardInstanceId: BigInt(sourceInstanceId),
        abilityIndex: BigInt(abilityIndex),
      });
    },
    [conn, gameId],
  );

  const executeCardAbilityWithCount = useCallback(
    (sourceInstanceId: string, abilityIndex: number, count: number) => {
      conn?.reducers.executeCardAbilityWithCount({
        gameId,
        cardInstanceId: BigInt(sourceInstanceId),
        abilityIndex: BigInt(abilityIndex),
        chosenCount: BigInt(count),
      });
    },
    [conn, gameId],
  );

  const imitateLostSoul = useCallback(
    (sourceInstanceId: string, targetInstanceId: string) => {
      conn?.reducers.imitateLostSoul({
        gameId,
        sourceInstanceId: BigInt(sourceInstanceId),
        targetInstanceId: BigInt(targetInstanceId),
      });
    },
    [conn, gameId],
  );

  const resurrectHeroes = useCallback(
    (sourceInstanceId: string, abilityIndex: number, selectedInstanceIds: string[]) => {
      conn?.reducers.resurrectHeroes({
        gameId,
        cardInstanceId: BigInt(sourceInstanceId),
        abilityIndex: BigInt(abilityIndex),
        selectedIdsJson: JSON.stringify(selectedInstanceIds),
      });
    },
    [conn, gameId],
  );

  const stopImitatingLostSoul = useCallback(
    (sourceInstanceId: string) => {
      conn?.reducers.stopImitatingLostSoul({
        gameId,
        sourceInstanceId: BigInt(sourceInstanceId),
      });
    },
    [conn, gameId],
  );

  const surrenderLostSoul = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.surrenderLostSoul({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const rescueLostSoul = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.rescueLostSoul({ gameId, cardInstanceId });
    },
    [conn, gameId],
  );

  const resignGame = useCallback(() => {
    conn?.reducers.resignGame({ gameId });
  }, [conn, gameId]);

  const leaveGame = useCallback(() => {
    conn?.reducers.leaveGame({ gameId });
  }, [conn, gameId]);

  const claimTimeoutVictory = useCallback(() => {
    if (!conn || !gameId) return;
    conn.reducers.claimTimeoutVictory({ gameId });
  }, [conn, gameId]);

  const pregameAcknowledgeRoll = useCallback(() => {
    conn?.reducers.pregameAcknowledgeRoll({ gameId });
  }, [conn, gameId]);

  const pregameChooseFirst = useCallback((chosenSeat: bigint) => {
    conn?.reducers.pregameChooseFirst({ gameId, chosenSeat });
  }, [conn, gameId]);

  const pregameAcknowledgeFirst = useCallback(() => {
    conn?.reducers.pregameAcknowledgeFirst({ gameId });
  }, [conn, gameId]);

  const pregameSkipToReveal = useCallback((chosenSeat: bigint) => {
    conn?.reducers.pregameSkipToReveal({ gameId, chosenSeat });
  }, [conn, gameId]);

  const pregameChangeDeck = useCallback((deckId: string, deckData: string, paragon: string) => {
    conn?.reducers.pregameChangeDeck({ gameId, deckId, deckData, paragon });
  }, [conn, gameId]);

  const pregameSubmitStars = useCallback((cardInstanceIds: bigint[]) => {
    // JSON.stringify throws on raw BigInt — send the ids as strings.
    conn?.reducers.pregameSubmitStars({
      gameId,
      cardInstanceIds: JSON.stringify(cardInstanceIds.map((id) => id.toString())),
    });
  }, [conn, gameId]);

  const pregameResolveStar = useCallback((starId: bigint) => {
    conn?.reducers.pregameResolveStar({ gameId, starId });
  }, [conn, gameId]);

  const pregameFinishSouls = useCallback(() => {
    conn?.reducers.pregameFinishSouls({ gameId });
  }, [conn, gameId]);

  const requestRematch = useCallback((deckId: string, deckData: string, paragon: string, format: string) => {
    conn?.reducers.requestRematch({ gameId, deckId, deckData, paragon, format });
  }, [conn, gameId]);

  const respondRematch = useCallback((accepted: boolean, deckId: string, deckData: string, paragon: string, format: string) => {
    conn?.reducers.respondRematch({ gameId, accepted, deckId, deckData, paragon, format });
  }, [conn, gameId]);

  const cancelRematch = useCallback(() => {
    conn?.reducers.cancelRematch({ gameId });
  }, [conn, gameId]);

  const logSearchDeck = useCallback(() => {
    conn?.reducers.logSearchDeck({ gameId });
  }, [conn, gameId]);

  const logLookAtTop = useCallback(
    (count: number, sourceCardName?: string, position?: 'top' | 'bottom' | 'random') => {
      conn?.reducers.logLookAtTop({
        gameId,
        count: BigInt(count),
        sourceCardName: sourceCardName ?? '',
        position: position ?? '',
      });
    },
    [conn, gameId],
  );

  const logDeckSearchNoShuffle = useCallback(
    (topCount: number, bottomCount: number) => {
      conn?.reducers.logDeckSearchNoShuffle({
        gameId,
        topCount,
        bottomCount,
      });
    },
    [conn, gameId],
  );

  const requestZoneSearch = useCallback(
    (zone: string) => {
      conn?.reducers.requestZoneSearch({ gameId, zone });
    },
    [conn, gameId],
  );

  const passInitiative = useCallback(() => {
    conn?.reducers.passInitiative({ gameId });
  }, [conn, gameId]);

  const sendEmote = useCallback(
    (kind: string) => {
      conn?.reducers.sendEmote({ gameId, kind });
    },
    [conn, gameId],
  );

  const requestOpponentAction = useCallback(
    (action: string, actionParams: string = '') => {
      conn?.reducers.requestOpponentAction({ gameId, action, actionParams });
    },
    [conn, gameId],
  );

  const approveZoneSearch = useCallback(
    (requestId: bigint) => {
      conn?.reducers.approveZoneSearch({ gameId, requestId });
    },
    [conn, gameId],
  );

  const denyZoneSearch = useCallback(
    (requestId: bigint) => {
      conn?.reducers.denyZoneSearch({ gameId, requestId });
    },
    [conn, gameId],
  );

  const completeZoneSearch = useCallback(
    (requestId: bigint, shuffled: boolean = false) => {
      conn?.reducers.completeZoneSearch({ gameId, requestId, shuffled });
    },
    [conn, gameId],
  );

  const moveOpponentCard = useCallback(
    (requestId: bigint, cardInstanceId: bigint, toZone: string, posX?: string, posY?: string, newOwnerId?: string) => {
      conn?.reducers.moveOpponentCard({
        gameId,
        requestId,
        cardInstanceId,
        toZone,
        posX: posX || '',
        posY: posY || '',
        newOwnerId: newOwnerId || '',
      });
    },
    [conn, gameId],
  );

  const shuffleOpponentDeck = useCallback(
    (requestId: bigint) => {
      conn?.reducers.shuffleOpponentDeck({ gameId, requestId });
    },
    [conn, gameId],
  );

  const reorderHand = useCallback(
    (cardIds: string) => {
      conn?.reducers.reorderHand({ gameId, cardIds });
    },
    [conn, gameId],
  );

  const reorderLob = useCallback(
    (cardIds: string) => {
      conn?.reducers.reorderLob({ gameId, cardIds });
    },
    [conn, gameId],
  );

  const enterBattle = useCallback(
    (cardInstanceId: bigint, posX: string, posY: string) => {
      conn?.reducers.enterBattle({ gameId, cardInstanceId, posX, posY }).catch(toastReducerError);
    },
    [conn, gameId],
  );

  const endBattle = useCallback(() => {
    conn?.reducers.endBattle({ gameId }).catch(toastReducerError);
  }, [conn, gameId]);

  const resolveBattle = useCallback(() => {
    conn?.reducers.resolveBattle({ gameId }).catch(toastReducerError);
  }, [conn, gameId]);

  const surrenderSoul = useCallback(
    (cardInstanceId: bigint) => {
      conn?.reducers.surrenderSoul({ gameId, cardInstanceId }).catch(toastReducerError);
    },
    [conn, gameId],
  );

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    allGames,
    allPlayers,
    game,
    myPlayer,
    opponentPlayer,
    opponentConnectionStatus,
    disconnectTimeoutFired,
    myCards,
    opponentCards,
    sharedCards,
    isMyTurn,
    counters,
    adaptedCardsById,
    chatMessages,
    isChatReady: chatLoading,
    gameActions,
    spectators,
    soulsRescued,
    isLoading,
    isGamesReady: gamesLoading,
    isPlayersReady: playersLoading,
    identityHex,
    drawCard,
    drawMultiple,
    matthewDrawBrigades,
    moveCard,
    moveCardsBatch,
    attachCard,
    detachCard,
    shuffleDeck,
    shuffleCardIntoDeck,
    shuffleSoulDeck,
    randomHandToZone,
    randomReserveToZone,
    randomOpponentHandToZone,
    opponentShuffleAndDraw,
    keepOneShuffleDraw,
    opponentKeepOneShuffleDraw,
    threeNailsResetExecute,
    discardReserveCharactersExecute,
    reloadDeck,
    meekCard,
    unmeekCard,
    flipCard,
    revealCardInHand,
    updateCardPosition,
    addCounter,
    removeCounter,
    setNote,
    exchangeCards,
    exchangeFromDeck,
    setPhase,
    endTurn,
    rollDice,
    sendChat,
    setPlayerOption,
    revealHand,
    revealReserve,
    revealCards,
    clearRevealedCards,
    moveCardToTopOfDeck,
    moveCardToBottomOfDeck,
    spawnLostSoul,
    removeToken,
    executeCardAbility,
    executeCardAbilityWithCount,
    imitateLostSoul,
    stopImitatingLostSoul,
    resurrectHeroes,
    surrenderLostSoul,
    rescueLostSoul,
    resignGame,
    leaveGame,
    claimTimeoutVictory,
    pregameAcknowledgeRoll,
    pregameChooseFirst,
    pregameAcknowledgeFirst,
    pregameSkipToReveal,
    pregameChangeDeck,
    pregameState,
    pregameStars,
    pregameSubmitStars,
    pregameResolveStar,
    pregameFinishSouls,
    requestRematch,
    respondRematch,
    cancelRematch,
    zoneSearchRequests,
    incomingSearchRequest,
    approvedSearchRequest,
    logSearchDeck,
    logLookAtTop,
    logDeckSearchNoShuffle,
    requestZoneSearch,
    passInitiative,
    sendEmote,
    emotes: allEmotes,
    requestOpponentAction,
    approveZoneSearch,
    denyZoneSearch,
    completeZoneSearch,
    moveOpponentCard,
    shuffleOpponentDeck,
    battleState: game?.battleState ?? '',
    battleAttackerSeat: game?.battleAttackerSeat ?? '',
    lastBattlePlayBySeat: game?.lastBattlePlayBySeat ?? '',
    enterBattle,
    endBattle,
    resolveBattle,
    surrenderSoul,
    reorderHand,
    reorderLob,
    isForgeGame,

    // Phase Stops
    myStops,
    holdPhase,
    holdSeat,
    holdDeadlineMicros,
    setTurnStop,
    releaseTurnStop,
  };
}

// ---------------------------------------------------------------------------
// Spectator variant
// ---------------------------------------------------------------------------

/**
 * Spectator-mode variant of useGameState. The viewer has no Player row, so we
 * cannot key "my" vs "opponent" off identity. Instead we expose seat0/seat1
 * directly and shape the return so the existing canvas's two-zone layout works
 * unchanged: seat 0 takes the "my" slot, seat 1 takes "opponent".
 *
 * Subscribes to the SAME tables as useGameState (filtered by gameId where
 * possible) and returns a superset of the core data fields. Action methods are
 * all no-ops — spectators cannot mutate game state.
 */
export function useSpectatorGameState(gameId: bigint | null, forgeResolver?: ForgeResolverMap | null) {
  const effectiveGameId = gameId ?? 0n;

  // Connection — needed for the sendChat reducer call
  const spacetimeCtx = useSpacetimeDB() as any;
  const conn = spacetimeCtx?.getConnection?.() ?? null;

  // ---------------------------------------------------------------------------
  // Table subscriptions — mirror every subscription in useGameState
  // ---------------------------------------------------------------------------
  const [allGames, gamesLoading] = useTable(tables.Game) as [GameRow[], boolean];
  const [gamePlayers, playersLoading] = useTable(
    tables.Player.where((p) => p.gameId.eq(effectiveGameId)),
  ) as [PlayerRow[], boolean];
  const [gameCards, cardsLoading] = useTable(
    tables.CardInstance.where((c) => c.gameId.eq(effectiveGameId)),
  ) as [CardInstanceRow[], boolean];
  const [allCounters] = useTable(tables.CardCounter) as [CardCounterRow[], boolean];
  const [allChat, spectatorChatLoading] = useTable(
    tables.ChatMessage.where((m) => m.gameId.eq(effectiveGameId)),
  ) as [ChatMessageRow[], boolean];
  const [allActions] = useTable(
    tables.GameAction.where((a) => a.gameId.eq(effectiveGameId)),
  ) as [GameActionRow[], boolean];
  const [allSpectators] = useTable(
    tables.Spectator.where((s) => s.gameId.eq(effectiveGameId)),
  ) as [SpectatorRow[], boolean];
  const [allZoneSearchRequests] = useTable(
    tables.ZoneSearchRequest.where((z) => z.gameId.eq(effectiveGameId)),
  ) as [any[], boolean];
  const [allDisconnectTimeouts] = useTable(
    tables.DisconnectTimeout.where((t) => t.gameId.eq(effectiveGameId)),
  ) as [DisconnectTimeoutRow[], boolean];
  const [allEmotes] = useTable(
    tables.Emote.where((e) => e.gameId.eq(effectiveGameId)),
  ) as [EmoteRow[], boolean];
  const [pregameStateRows] = useTable(
    tables.PregameState.where((r) => r.gameId.eq(effectiveGameId)),
  ) as [PregameStateRow[], boolean];
  const [pregameStarRows] = useTable(
    tables.PregameStar.where((r) => r.gameId.eq(effectiveGameId)),
  ) as [PregameStarRow[], boolean];
  const [turnStopRows] = useTable(
    tables.TurnStop.where((r) => r.gameId.eq(effectiveGameId)),
  ) as [any[], boolean];
  const [stopHoldTimeoutRows] = useTable(
    tables.StopHoldTimeout.where((r) => r.gameId.eq(effectiveGameId)),
  ) as [any[], boolean];

  const isLoading = !(gamesLoading && playersLoading && cardsLoading);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const game = useMemo(
    () => (gameId != null ? allGames.find((g) => g.id === gameId) : undefined),
    [allGames, gameId],
  );

  const seat0Player = useMemo(
    () => gamePlayers.find((p) => p.seat === 0n) ?? null,
    [gamePlayers],
  );

  const seat1Player = useMemo(
    () => gamePlayers.find((p) => p.seat === 1n) ?? null,
    [gamePlayers],
  );

  // Shape for canvas compatibility: seat 0 = "my", seat 1 = "opponent"
  const myPlayer = seat0Player;
  const opponentPlayer = seat1Player;

  const disconnectTimeoutFired = game?.disconnectTimeoutFired ?? false;

  const opponentConnectionStatus = useMemo((): 'connected' | 'reconnecting' | 'disconnected' => {
    if (!seat1Player) return 'connected';
    if (seat1Player.isConnected) return 'connected';
    const hasPendingTimeout = allDisconnectTimeouts.some((t) => t.playerId === seat1Player.id);
    if (hasPendingTimeout) return 'reconnecting';
    return disconnectTimeoutFired ? 'disconnected' : 'connected';
  }, [seat1Player, allDisconnectTimeouts, disconnectTimeoutFired]);

  const isMyTurn = useMemo(
    () => (game && seat0Player ? game.currentTurn === seat0Player.seat : false),
    [game, seat0Player],
  );

  // ---- Phase Stops (opponent-turn priority stops) ----
  const turnStopRow = turnStopRows[0] ?? null;

  const holdPhase: string = turnStopRow?.holdPhase ?? '';

  // The holding seat is always the non-active seat.
  const holdSeat = useMemo(() => {
    if (!game || holdPhase === '') return null;
    return game.currentTurn === 0n ? 1n : 0n;
  }, [game, holdPhase]);

  const holdDeadlineMicros = useMemo(() => {
    if (holdPhase === '') return null;
    const row = stopHoldTimeoutRows[0];
    if (!row) return null;
    const sched: any = row.scheduledAt;
    if (sched?.tag !== 'Time') return null;
    return sched.value.microsSinceUnixEpoch as bigint;
  }, [stopHoldTimeoutRows, holdPhase]);

  const myCards = useMemo(
    () =>
      seat0Player
        ? groupCardsByZone(gameCards.filter((c) => c.ownerId === seat0Player.id))
        : ({} as Record<string, CardInstanceRow[]>),
    [gameCards, seat0Player],
  );

  const opponentCards = useMemo(
    () =>
      seat1Player
        ? groupCardsByZone(gameCards.filter((c) => c.ownerId === seat1Player.id))
        : ({} as Record<string, CardInstanceRow[]>),
    [gameCards, seat1Player],
  );

  const sharedCards = useMemo(
    () => groupCardsByZone(gameCards.filter((c) => c.ownerId === 0n)),
    [gameCards],
  );

  const counters = useMemo(() => {
    const map = new Map<bigint, CardCounterRow[]>();
    const gameCardIds = new Set(gameCards.map((c) => c.id));
    for (const counter of allCounters) {
      if (!gameCardIds.has(counter.cardInstanceId)) continue;
      const existing = map.get(counter.cardInstanceId);
      if (existing) {
        existing.push(counter);
      } else {
        map.set(counter.cardInstanceId, [counter]);
      }
    }
    return map;
  }, [allCounters, gameCards]);

  // Forge games admit member-authorized spectators; the resolver (when the
  // viewer is a Forge member) supplies granted card names/text/art.
  const adaptedCardsById = useStableAdaptedCards(gameCards, counters, seat1Player?.id, forgeResolver);

  const chatMessages = useMemo(
    () =>
      allChat
        .filter((m) => m.gameId === effectiveGameId)
        .sort((a, b) => {
          const aTime = Number((a.sentAt as any).microsSinceUnixEpoch / BigInt(1000));
          const bTime = Number((b.sentAt as any).microsSinceUnixEpoch / BigInt(1000));
          return aTime - bTime;
        }),
    [allChat, effectiveGameId],
  );

  const gameActions = useMemo(
    () =>
      allActions
        .filter((a) => a.gameId === effectiveGameId)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [allActions, effectiveGameId],
  );

  const spectators = useMemo(
    () => allSpectators.filter((s) => s.gameId === effectiveGameId),
    [allSpectators, effectiveGameId],
  );

  const soulsRescued = useMemo(() => {
    return {
      me: countRedeemedSouls(myCards['land-of-redemption'] ?? []),
      opponent: countRedeemedSouls(opponentCards['land-of-redemption'] ?? []),
    };
  }, [myCards, opponentCards]);

  const zoneSearchRequests = useMemo(
    () => allZoneSearchRequests.filter((r: any) => r.gameId === effectiveGameId),
    [allZoneSearchRequests, effectiveGameId],
  );

  // Spectators cannot issue or receive search requests; these are always null.
  const incomingSearchRequest = null;
  const approvedSearchRequest = null;

  // One PregameState row per game (gameId is unique), so the first row is it.
  const pregameState = pregameStateRows[0] ?? null;

  const pregameStars = useMemo(
    () => [...pregameStarRows].sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0)),
    [pregameStarRows],
  );

  // ---------------------------------------------------------------------------
  // No-op action stubs (spectators cannot mutate game state)
  // ---------------------------------------------------------------------------
  const noop = useCallback(() => {}, []);
  const noopBigint = useCallback((_: bigint) => {}, []);
  const noopString = useCallback((_: string) => {}, []);
  const noopBool = useCallback((_: boolean) => {}, []);

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    viewerKind: 'spectator' as const,

    // Spectator-specific seat references
    seat0Player,
    seat1Player,

    // Core data (canvas-compatible shape)
    allGames,
    allPlayers: gamePlayers,
    game,
    myPlayer,
    opponentPlayer,
    opponentConnectionStatus,
    disconnectTimeoutFired,
    myCards,
    opponentCards,
    sharedCards,
    isMyTurn,
    counters,
    adaptedCardsById,
    chatMessages,
    isChatReady: spectatorChatLoading,
    gameActions,
    spectators,
    soulsRescued,
    zoneSearchRequests,
    incomingSearchRequest,
    approvedSearchRequest,
    emotes: allEmotes,

    // Loading state
    isLoading,
    isGamesReady: gamesLoading,
    isPlayersReady: playersLoading,

    // No identity for spectators
    identityHex: undefined as string | undefined,

    // No-op action stubs
    drawCard: noop,
    drawMultiple: noopBigint,
    matthewDrawBrigades: useCallback((_cardInstanceId: bigint, _brigadeCount: bigint) => {}, []),
    moveCard: useCallback((_cardInstanceId: bigint, _toZone: string, _zoneIndex?: string, _posX?: string, _posY?: string, _targetOwnerId?: string) => {}, []),
    moveCardsBatch: useCallback((_cardInstanceIds: string, _toZone: string, _positions?: string, _targetOwnerId?: string, _fromSource?: string) => {}, []),
    attachCard: useCallback((_weaponInstanceId: bigint, _warriorInstanceId: bigint) => {}, []),
    detachCard: useCallback((_weaponInstanceId: bigint, _posX?: string, _posY?: string) => {}, []),
    shuffleDeck: noop,
    shuffleCardIntoDeck: noopBigint,
    shuffleSoulDeck: noop,
    reloadDeck: useCallback((_deckId: string, _deckData: string, _paragon: string) => {}, []),
    randomHandToZone: useCallback((_count: number, _toZone: string, _deckPosition: string) => {}, []),
    randomReserveToZone: useCallback((_count: number, _toZone: string, _deckPosition: string) => {}, []),
    randomOpponentHandToZone: useCallback((_requestId: bigint, _count: number, _toZone: string, _deckPosition: string) => {}, []),
    opponentShuffleAndDraw: useCallback((_requestId: bigint, _shuffleCount: number, _drawCount: number) => {}, []),
    keepOneShuffleDraw: useCallback((_sourceInstanceId: bigint, _keepInstanceId: bigint) => {}, []),
    opponentKeepOneShuffleDraw: useCallback((_requestId: bigint, _keepInstanceId: bigint) => {}, []),
    threeNailsResetExecute: noopBigint,
    discardReserveCharactersExecute: noopBigint,
    meekCard: noopBigint,
    unmeekCard: noopBigint,
    flipCard: noopBigint,
    revealCardInHand: noopBigint,
    updateCardPosition: useCallback((_cardInstanceId: bigint, _posX: string, _posY: string) => {}, []),
    addCounter: useCallback((_cardInstanceId: bigint, _color: string) => {}, []),
    removeCounter: useCallback((_cardInstanceId: bigint, _color: string) => {}, []),
    setNote: useCallback((_cardInstanceId: bigint, _text: string) => {}, []),
    exchangeCards: noopString,
    exchangeFromDeck: useCallback((_exchangeCardIds: string, _replacementMoves: string) => {}, []),
    setPhase: noopString,
    endTurn: noop,
    rollDice: noopBigint,
    sendChat: useCallback((text: string) => {
      if (!conn || !gameId) {
        const err = new Error('Not connected — message not sent');
        toastReducerError(err);
        return Promise.reject(err);
      }
      return conn.reducers.sendChat({ gameId, text }).catch((e: unknown) => {
        toastReducerError(e);
        throw e;
      });
    }, [conn, gameId]),
    setPlayerOption: useCallback((_optionName: string, _value: string) => {}, []),
    revealHand: noopBool,
    revealReserve: noopBool,
    moveCardToTopOfDeck: noopBigint,
    moveCardToBottomOfDeck: noopBigint,
    spawnLostSoul: useCallback((_testament: string, _posX: string, _posY: string, _targetPlayerId?: string) => {}, []),
    removeToken: noopBigint,
    executeCardAbility: useCallback((_sourceInstanceId: string, _abilityIndex: number) => {}, []),
    executeCardAbilityWithCount: useCallback((_sourceInstanceId: string, _abilityIndex: number, _count: number) => {}, []),
    imitateLostSoul: useCallback((_sourceInstanceId: string, _targetInstanceId: string) => {}, []),
    resurrectHeroes: useCallback((_sourceInstanceId: string, _abilityIndex: number, _selectedInstanceIds: string[]) => {}, []),
    stopImitatingLostSoul: noopString,
    surrenderLostSoul: noopBigint,
    rescueLostSoul: noopBigint,
    resignGame: noop,
    leaveGame: noop,
    claimTimeoutVictory: noop,
    pregameAcknowledgeRoll: noop,
    pregameChooseFirst: noopBigint,
    pregameAcknowledgeFirst: noop,
    pregameSkipToReveal: noopBigint,
    pregameChangeDeck: useCallback((_deckId: string, _deckData: string, _paragon: string) => {}, []),
    pregameState,
    pregameStars,
    pregameSubmitStars: useCallback((_cardInstanceIds: bigint[]) => {}, []),
    pregameResolveStar: noopBigint,
    pregameFinishSouls: noop,
    requestRematch: useCallback((_deckId: string, _deckData: string, _paragon: string, _format: string) => {}, []),
    respondRematch: useCallback((_accepted: boolean, _deckId: string, _deckData: string, _paragon: string, _format: string) => {}, []),
    cancelRematch: useCallback(() => {}, []),
    revealCards: useCallback((_cardIds: string, _context?: string) => {}, []),
    clearRevealedCards: noop,
    logSearchDeck: noop,
    logLookAtTop: useCallback((_count: number, _sourceCardName?: string, _position?: 'top' | 'bottom' | 'random') => {}, []),
    logDeckSearchNoShuffle: useCallback((_topCount: number, _bottomCount: number) => {}, []),
    requestZoneSearch: noopString,
    requestOpponentAction: useCallback((_action: string, _actionParams?: string) => {}, []),
    approveZoneSearch: noopBigint,
    denyZoneSearch: noopBigint,
    completeZoneSearch: useCallback((_requestId: bigint, _shuffled?: boolean) => {}, []),
    moveOpponentCard: useCallback((_requestId: bigint, _cardInstanceId: bigint, _toZone: string, _posX?: string, _posY?: string, _newOwnerId?: string) => {}, []),
    shuffleOpponentDeck: noopBigint,
    reorderHand: noopString,
    reorderLob: noopString,

    // Battle zone — read-only fields plus no-op action stubs
    battleState: game?.battleState ?? '',
    battleAttackerSeat: game?.battleAttackerSeat ?? '',
    lastBattlePlayBySeat: game?.lastBattlePlayBySeat ?? '',
    enterBattle: useCallback((_cardInstanceId: bigint, _posX: string, _posY: string) => {}, []),
    endBattle: noop,
    resolveBattle: noop,
    surrenderSoul: noopBigint,

    // Phase Stops — spectators render holds but cannot set/release stops
    myStops: [] as string[],
    holdPhase,
    holdSeat,
    holdDeadlineMicros,
    setTurnStop: useCallback((_p: string, _e: boolean) => {}, []),
    releaseTurnStop: useCallback((_denied: boolean) => {}, []),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupCardsByZone(cards: CardInstanceRow[]): Record<string, CardInstanceRow[]> {
  const result: Record<string, CardInstanceRow[]> = {};
  for (const card of cards) {
    const zone = card.zone;
    if (!result[zone]) {
      result[zone] = [];
    }
    result[zone].push(card);
  }
  // Sort deck cards by zoneIndex to preserve shuffled order
  if (result['deck']) {
    result['deck'].sort((a, b) => {
      const ai = typeof a.zoneIndex === 'bigint' ? a.zoneIndex : BigInt(a.zoneIndex ?? 0);
      const bi = typeof b.zoneIndex === 'bigint' ? b.zoneIndex : BigInt(b.zoneIndex ?? 0);
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });
  }
  // Sort hand cards by zoneIndex to preserve player-arranged order
  if (result['hand']) {
    result['hand'].sort((a, b) => {
      const ai = typeof a.zoneIndex === 'bigint' ? a.zoneIndex : BigInt(a.zoneIndex ?? 0);
      const bi = typeof b.zoneIndex === 'bigint' ? b.zoneIndex : BigInt(b.zoneIndex ?? 0);
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });
  }
  // Sort LOB cards by zoneIndex to preserve player-arranged order
  if (result['land-of-bondage']) {
    result['land-of-bondage'].sort((a, b) => {
      const ai = typeof a.zoneIndex === 'bigint' ? a.zoneIndex : BigInt(a.zoneIndex ?? 0);
      const bi = typeof b.zoneIndex === 'bigint' ? b.zoneIndex : BigInt(b.zoneIndex ?? 0);
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });
  }
  // Sort LOR cards by zoneIndex so newest card renders on top of the fan
  if (result['land-of-redemption']) {
    result['land-of-redemption'].sort((a, b) => {
      const ai = typeof a.zoneIndex === 'bigint' ? a.zoneIndex : BigInt(a.zoneIndex ?? 0);
      const bi = typeof b.zoneIndex === 'bigint' ? b.zoneIndex : BigInt(b.zoneIndex ?? 0);
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });
  }
  // Sort pile zones by zoneIndex so the most recently added card is last (rendered on top)
  for (const zone of ['discard', 'reserve', 'banish']) {
    if (result[zone]) {
      result[zone].sort((a, b) => {
        const ai = typeof a.zoneIndex === 'bigint' ? a.zoneIndex : BigInt(a.zoneIndex ?? 0);
        const bi = typeof b.zoneIndex === 'bigint' ? b.zoneIndex : BigInt(b.zoneIndex ?? 0);
        return ai < bi ? -1 : ai > bi ? 1 : 0;
      });
    }
  }
  return result;
}
