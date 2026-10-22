import { schema, table, t } from 'spacetimedb/server';

// ---------------------------------------------------------------------------
// 1. Game
// ---------------------------------------------------------------------------
export const Game = table(
  {
    name: 'game',
    public: true,
    indexes: [
      { accessor: 'game_code', algorithm: 'btree' as const, columns: ['code'] },
      { accessor: 'game_status', algorithm: 'btree' as const, columns: ['status'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    code: t.string(),
    status: t.string(),           // "waiting" | "playing" | "finished"
    currentTurn: t.u64(),         // seat number: 0 or 1
    currentPhase: t.string(),     // "draw" | "upkeep" | "preparation" | "battle" | "discard"
    turnNumber: t.u64(),
    format: t.string(),           // "T1" | "T2" | "Paragon"
    rngCounter: t.u64(),
    lastDiceRoll: t.string(),     // JSON: { result, sides, rollerId }
    createdAt: t.timestamp(),
    createdBy: t.identity(),
    isPublic: t.bool(),
    lobbyMessage: t.string(),
    createdByName: t.string(),
    pregamePhase: t.string(),     // "" | "rolling" | "choosing" | "revealing" | "stars" | "souls"
                                  // 'stars'/'souls' run with status='playing' — see pregameFlow.ts
    pregameReady0: t.bool(),      // seat 0 ready (reused for roll ack)
    pregameReady1: t.bool(),      // seat 1 ready (reused for roll ack)
    rollWinner: t.string(),       // "" | "0" | "1" — string to avoid 0n ambiguity
    rollResult0: t.u64(),         // d20 result for seat 0
    rollResult1: t.u64(),         // d20 result for seat 1
    rematchRequestedBy: t.string(), // "" | "0" | "1" — seat that requested rematch
    rematchDeckId0: t.string(),     // seat 0's deck ID for rematch
    rematchDeckData0: t.string(),   // seat 0's deck data for rematch
    rematchDeckId1: t.string(),     // seat 1's deck ID for rematch
    rematchDeckData1: t.string(),   // seat 1's deck data for rematch
    rematchParagon0: t.string(),    // seat 0's paragon name for rematch (empty string when absent)
    rematchParagon1: t.string(),    // seat 1's paragon name for rematch
    rematchResponse: t.string(),    // "" | "accepted" | "declined"
    rematchCode: t.string(),        // new game code for rematch
    disconnectTimeoutFired: t.bool().default(false), // true when timeout fired during active game
    choosingDeadlineMicros: t.u64().default(0n),  // server timestamp (microseconds since epoch) when choosing timer expires
    playingStartedAtMicros: t.u64().default(0n),  // server timestamp (microseconds since epoch) when status transitioned to 'playing'; 0 when not yet started
    // Mutually-agreed pause (honor system; does not lock card actions).
    pauseRequestedBy: t.string().default(''),     // '' | '0' | '1' — seat that requested the pending pause/resume
    pauseRequestType: t.string().default(''),     // '' | 'pause' | 'resume'
    pauseStartedAtMicros: t.u64().default(0n),    // when current active pause began; 0 when not paused
    totalPausedMicros: t.u64().default(0n),       // accumulated paused time across the game
    battleState: t.string().default(''),        // '' | 'active' | 'awaiting-soul'
    battleAttackerSeat: t.string().default(''), // '' | '0' | '1'
    lastBattlePlayBySeat: t.string().default(''), // '' | '0' | '1' — REG stalemate/mutual tiebreak
  }
);

// ---------------------------------------------------------------------------
// 2. Player
// ---------------------------------------------------------------------------
export const Player = table(
  {
    name: 'player',
    public: true,
    indexes: [
      { accessor: 'player_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
      { accessor: 'player_identity', algorithm: 'btree' as const, columns: ['identity'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    identity: t.identity(),
    seat: t.u64(),                // 0 or 1
    deckId: t.string(),
    displayName: t.string(),
    paragon: t.string(),
    supabaseUserId: t.string(),
    isConnected: t.bool(),
    autoRouteLostSouls: t.bool(),
    handRevealed: t.bool(),       // When true, hand is visible to opponent
    pendingDeckData: t.string(),  // JSON deck data, stored until game starts
    revealedCards: t.string(),    // JSON array of card instance IDs revealed from deck, "" when none
    reserveRevealed: t.bool().default(false), // When true, reserve is visible to opponent
    handRevealSnapshot: t.string().default('[]'), // JSON array of card IDs visible during reveal — cards drawn after reveal stay hidden
    shareHandWithSpectators: t.bool().default(false),
    topDeckRevealed: t.bool().default(false), // When true, this player's top deck card renders face up for everyone (The Foretelling Angel's toggle_top_deck_reveal)
    // JSON KeepOneSnapshot (see keepOneUndo.ts) while this player's half of
    // Philip's Daughters can still be taken back; '' otherwise. Cleared by
    // undo_keep_one_shuffle_draw and at the turn flip. New columns go LAST —
    // a mid-list insert aborts the publish with "requires a manual migration".
    keepOneUndo: t.string().default(''),
  }
);

// ---------------------------------------------------------------------------
// 3. CardInstance
// ---------------------------------------------------------------------------
export const CardInstance = table(
  {
    name: 'card_instance',
    public: true,
    indexes: [
      { accessor: 'card_instance_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
      { accessor: 'card_instance_owner_id', algorithm: 'btree' as const, columns: ['ownerId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    ownerId: t.u64(),
    zone: t.string(),             // "deck" | "hand" | "territory" | "land-of-bondage" | "land-of-redemption" | "discard" | "reserve" | "banish" | "paragon"
    zoneIndex: t.u64(),
    posX: t.string(),             // stringified number (empty string if unset)
    posY: t.string(),             // stringified number (empty string if unset)
    isMeek: t.bool(),
    isFlipped: t.bool(),
    cardName: t.string(),
    cardSet: t.string(),
    cardImgFile: t.string(),
    cardType: t.string(),
    brigade: t.string(),
    strength: t.string(),
    toughness: t.string(),
    alignment: t.string(),
    identifier: t.string(),
    specialAbility: t.string(),
    reference: t.string(),
    notes: t.string(),
    // Instance id of the warrior this card (a weapon) is attached to.
    // `0n` sentinel = unattached (matches the empty-string convention used for posX/posY).
    equippedToInstanceId: t.u64().default(0n),
    isSoulDeckOrigin: t.bool().default(false),
    isToken: t.bool().default(false),
    // Per-card hand reveal expiry. Absent = never revealed. When set, the
    // card's face is shown to all clients until this timestamp passes. Move
    // reducers clear this field when the card leaves the hand zone.
    revealExpiresAt: t.timestamp().optional(),
    // Immutable original owner. Set at insert time, never mutated by moves.
    // When a card returns to a "home" zone (deck/discard/reserve/banish/hand/LoB),
    // routing uses this so taken opponent cards go back to their real owner.
    // `0n` on pre-migration rows means "unset" — fall back to ownerId.
    originalOwnerId: t.u64().default(0n),
    // When the current reveal began. Used together with revealExpiresAt to
    // compute the full duration so the client countdown ring renders the
    // correct fraction regardless of whether the reveal was a 10s auto or a
    // 30s manual flash. Cleared alongside revealExpiresAt.
    revealStartedAt: t.timestamp().optional(),
    // Stamped when the card enters zone 'battle'; cleared by leavePlayFieldOverrides
    // whenever it leaves. Drives end-of-battle auto-return (survivors → origin).
    originZone: t.string().default(''),
    originPosX: t.string().default(''),
    originPosY: t.string().default(''),
    // Visual outline marker set by `set_card_outline` abilities (e.g. Three
    // Woes "Choose Good"/"Choose Evil"). '' = no outline; 'good' renders
    // green, 'evil' renders red. Cleared when the card leaves Territory.
    outlineColor: t.string().default(''),
    // Set by imitate_lost_soul to the simplifyLostSoulName(target.cardName)
    // value when this card is currently imitating another Lost Soul. Empty
    // string when not imitating. The card's cardImgFile is also mutated when
    // the target has registered art; otherwise GameCardNode renders this
    // value as a label overlay (fallback-only). Cleared by
    // stop_imitating_lost_soul.
    imitatingName: t.string().default(''),
    // Sideways (90°) marker set by the `set_rotation` ability on "counts as
    // two Lost Souls" cards (Two/Three Liner) to record the first of their two
    // required rescues while in the Land of Bondage. Cleared by
    // leavePlayFieldOverrides when the card leaves the Land of Bondage.
    // (New columns append at the END — inserting mid-list reads as a table
    // reorder and aborts the publish.)
    isRotated: t.bool().default(false),
  }
);

// ---------------------------------------------------------------------------
// 4. CardCounter
// ---------------------------------------------------------------------------
export const CardCounter = table(
  {
    name: 'card_counter',
    public: true,
    indexes: [
      { accessor: 'card_counter_card_instance_id', algorithm: 'btree' as const, columns: ['cardInstanceId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    cardInstanceId: t.u64(),
    color: t.string(),
    count: t.u64(),
  }
);

// ---------------------------------------------------------------------------
// 5. GameAction
// ---------------------------------------------------------------------------
export const GameAction = table(
  {
    name: 'game_action',
    public: true,
    indexes: [
      { accessor: 'game_action_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    playerId: t.u64(),
    actionType: t.string(),
    payload: t.string(),          // JSON
    turnNumber: t.u64(),
    phase: t.string(),
    timestamp: t.timestamp(),
  }
);

// ---------------------------------------------------------------------------
// 6. ChatMessage
// ---------------------------------------------------------------------------
export const ChatMessage = table(
  {
    name: 'chat_message',
    public: true,
    indexes: [
      { accessor: 'chat_message_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    senderId: t.u64(),
    text: t.string(),
    sentAt: t.timestamp(),
  }
);

// ---------------------------------------------------------------------------
// 7a. Spectator
// ---------------------------------------------------------------------------
export const Spectator = table(
  {
    name: 'spectator',
    public: true,
    indexes: [
      { accessor: 'spectator_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    identity: t.identity(),
    displayName: t.string(),
  }
);

// ---------------------------------------------------------------------------
// 7b. SpectatorBan — per-game identity ban list, enforced by join_as_spectator
// ---------------------------------------------------------------------------
export const SpectatorBan = table(
  {
    name: 'spectator_ban',
    public: true,
    indexes: [
      { accessor: 'spectator_ban_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    identity: t.identity(),
    bannedBySeat: t.u64(),
    bannedAt: t.timestamp(),
  }
);

// ---------------------------------------------------------------------------
// 7c. SpectatorHandRequest — transient signal for the player-side banner.
// Rate-limited per-spectator by request_spectator_hand_reveal.
// Auto-cleaned 30s after requestedAt by expire_spectator_hand_request.
// ---------------------------------------------------------------------------
export const SpectatorHandRequest = table(
  {
    name: 'spectator_hand_request',
    public: true,
    indexes: [
      { accessor: 'spectator_hand_request_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    spectatorId: t.u64(),
    spectatorName: t.string(),
    requestedAt: t.timestamp(),
  }
);

// ---------------------------------------------------------------------------
// 7d. SpectatorHandRequestExpiry (scheduled table)
//     Deletes the matching SpectatorHandRequest row 30s after creation.
//     The `scheduled` option references a reducer defined in index.ts (Task 5
//     of the spectator-mode plan). We use a forward reference via arrow
//     function — the arrow defers evaluation so the module loads without the
//     reducer existing yet. The actual reducer is wired up at import time.
// ---------------------------------------------------------------------------

// Forward-reference placeholder — will be set by index.ts before schema
// resolution occurs. The arrow function in `scheduled` defers evaluation.
let _handleSpectatorHandRequestExpiry: any;
export const setSpectatorHandRequestExpiryReducer = (reducer: any) => {
  _handleSpectatorHandRequestExpiry = reducer;
};

export const SpectatorHandRequestExpiry = table(
  {
    name: 'spectator_hand_request_expiry',
    public: true,
    scheduled: () => _handleSpectatorHandRequestExpiry,
    indexes: [
      { accessor: 'spectator_hand_request_expiry_request_id', algorithm: 'btree' as const, columns: ['requestId'] },
    ],
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    requestId: t.u64(),
  }
);

// ---------------------------------------------------------------------------
// 8. DisconnectTimeout (scheduled table)
//    The `scheduled` option references a reducer that will be defined in
//    index.ts (Task 4). We use a forward reference via arrow function —
//    the arrow defers evaluation so the module loads without the reducer
//    existing yet. The actual reducer will be wired up at import time.
// ---------------------------------------------------------------------------

// Forward-reference placeholder — will be set by index.ts before schema
// resolution occurs. The arrow function in `scheduled` defers evaluation.
let _handleDisconnectTimeout: any;
export const setDisconnectTimeoutReducer = (reducer: any) => {
  _handleDisconnectTimeout = reducer;
};

export const DisconnectTimeout = table(
  {
    name: 'disconnect_timeout',
    public: true,
    scheduled: () => _handleDisconnectTimeout,
    indexes: [
      { accessor: 'disconnect_timeout_player_id', algorithm: 'btree' as const, columns: ['playerId'] },
    ],
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    gameId: t.u64(),
    playerId: t.u64(),
  }
);

// ---------------------------------------------------------------------------
// 9. ZoneSearchRequest
// ---------------------------------------------------------------------------
export const ZoneSearchRequest = table(
  {
    name: 'zone_search_request',
    public: true,
    indexes: [
      { accessor: 'zone_search_request_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    requesterId: t.u64(),
    targetPlayerId: t.u64(),
    zone: t.string(),
    status: t.string(),
    createdAt: t.timestamp(),
    // When non-empty, this request is for an atomic action (not an interactive
    // browse). The requester waits for approval, then fires the corresponding
    // reducer. Params is JSON-encoded (e.g. '{"count":3}').
    action: t.string(),
    actionParams: t.string(),
  }
);

// ---------------------------------------------------------------------------
// 10. ChooseFirstTimeout (scheduled table)
//     Server-side enforcement of the 30-second choosing phase timer.
//     If the roll winner doesn't choose in time, auto-selects them to go first.
// ---------------------------------------------------------------------------

let _handleChooseFirstTimeout: any;
export const setChooseFirstTimeoutReducer = (reducer: any) => {
  _handleChooseFirstTimeout = reducer;
};

export const ChooseFirstTimeout = table(
  {
    name: 'choose_first_timeout',
    public: true,
    scheduled: () => _handleChooseFirstTimeout,
    indexes: [
      { accessor: 'choose_first_timeout_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    gameId: t.u64(),
  }
);

// ---------------------------------------------------------------------------
// 10b. RevealTimeout (scheduled table)
//     Server-side backstop for the 'revealing' phase. Both clients auto-ack
//     (pregame_acknowledge_first) ~1.5s after the reveal to start the game; if
//     an ack never arrives (e.g. a client whose auto-ack timer stalled), this
//     force-starts the game so "Starting game…" can't linger indefinitely.
// ---------------------------------------------------------------------------

let _handleRevealTimeout: any;
export const setRevealTimeoutReducer = (reducer: any) => {
  _handleRevealTimeout = reducer;
};

export const RevealTimeout = table(
  {
    name: 'reveal_timeout',
    public: true,
    scheduled: () => _handleRevealTimeout,
    indexes: [
      { accessor: 'reveal_timeout_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    gameId: t.u64(),
  }
);

// ---------------------------------------------------------------------------
// 11. Emote — ephemeral player emotes (e.g. thumbs_up). Public so opponent
// and spectators can render the animation.
// ---------------------------------------------------------------------------
export const Emote = table(
  {
    name: 'emote',
    public: true,
    indexes: [
      { accessor: 'emote_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    senderId: t.u64(),
    kind: t.string(),
    createdAt: t.timestamp(),
  }
);

// ---------------------------------------------------------------------------
// 13. ForgeGame (public marker — a row flags its game as a Forge playtest game)
//     Deliberately a separate table, NOT a Game column: adding a column would
//     change the game row's BSATN shape and break deployed clients' game
//     subscriptions during the publish window.
// ---------------------------------------------------------------------------
export const ForgeGame = table(
  { name: 'forge_game', public: true },
  {
    gameId: t.u64().primaryKey(),
  }
);

// ---------------------------------------------------------------------------
// 14. ForgeConfig (PRIVATE singleton — trusted server identity)
//     NO `public: true` — this table must never be client-visible.
// ---------------------------------------------------------------------------
export const ForgeConfig = table(
  { name: 'forge_config' },
  {
    id: t.u64().primaryKey(),
    serverIdentityHex: t.string(),
  }
);

// ---------------------------------------------------------------------------
// 15. ForgeSeatAuth (PRIVATE allowlist — one row = one pending seat grant)
//     NO `public: true` — this table must never be client-visible.
// ---------------------------------------------------------------------------
export const ForgeSeatAuth = table(
  {
    name: 'forge_seat_auth',
    indexes: [{ accessor: 'seat_auth_code', algorithm: 'btree' as const, columns: ['code'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    code: t.string(),
    identityHex: t.string(),
    authorizedAtMicros: t.u64(),
  }
);

// ---------------------------------------------------------------------------
// 16. CleanupSchedule (scheduled table)
// ---------------------------------------------------------------------------

let _handleCleanupStaleGames: any;
export const setCleanupStaleGamesReducer = (reducer: any) => {
  _handleCleanupStaleGames = reducer;
};

export const CleanupSchedule = table(
  {
    name: 'cleanup_schedule',
    public: true,
    scheduled: () => _handleCleanupStaleGames,
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
  }
);

// ---------------------------------------------------------------------------
// 17. PregameState — one row per game, live only during the REG Pre-Game
//     Phase sub-steps ('stars' / 'souls'). Row absent = pre-game complete.
//     Deliberately a separate table, NOT Game columns: adding a column would
//     change the game row's BSATN shape and break deployed clients' game
//     subscriptions during the publish window (cf. ForgeGame above).
//
//     The current step is NOT stored here — Game.pregamePhase is the single
//     source of truth for it. This table holds only whose window is open and
//     the per-seat progress flags.
// ---------------------------------------------------------------------------
export const PregameState = table(
  { name: 'pregame_state', public: true },
  {
    gameId: t.u64().primaryKey(),
    activeSeat: t.u64(),          // 0 or 1 — seat whose window is open
    starsDone0: t.bool(),
    starsDone1: t.bool(),
    soulsDone0: t.bool(),
    soulsDone1: t.bool(),
  }
);

// ---------------------------------------------------------------------------
// 18. PregameStar — one row per star card a player revealed, in the order they
//     chose to resolve them. Public: revealing is REG's cost for using a star
//     ability, so opponents and spectators must see the set. These rows (not
//     CardInstance.revealExpiresAt) back the opponent's view, because the
//     phase is untimed and the per-card reveal expires after 30s.
// ---------------------------------------------------------------------------
export const PregameStar = table(
  {
    name: 'pregame_star',
    public: true,
    indexes: [
      { accessor: 'pregame_star_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    gameId: t.u64(),
    seat: t.u64(),
    cardInstanceId: t.u64(),
    slot: t.u64(),                // 0-based resolution order
    resolved: t.bool(),
  }
);

// ---------------------------------------------------------------------------
// 19. PregameIdleTimeout (scheduled table)
//     The Pre-Game Phase is deliberately untimed, so this is a long backstop
//     only: it force-completes the active seat's sub-step so an idle or
//     departed player cannot hang the game.
// ---------------------------------------------------------------------------

let _handlePregameIdleTimeout: any;
export const setPregameIdleTimeoutReducer = (reducer: any) => {
  _handlePregameIdleTimeout = reducer;
};

export const PregameIdleTimeout = table(
  {
    name: 'pregame_idle_timeout',
    public: true,
    scheduled: () => _handlePregameIdleTimeout,
    indexes: [
      { accessor: 'pregame_idle_timeout_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    gameId: t.u64(),
  }
);

// ---------------------------------------------------------------------------
// 20. TurnStop — Phase Stops (opponent-turn priority stops). One row per game,
//     inserted lazily on the first set_turn_stop call — absence of a row means
//     "no stops, no hold". Deliberately a separate table, NOT Game columns:
//     adding a column would change the game row's BSATN shape and break
//     deployed clients' subscriptions during the publish window (cf. ForgeGame
//     / PregameState above). See
//     docs/superpowers/specs/2026-08-15-phase-stops-design.md.
// ---------------------------------------------------------------------------
export const TurnStop = table(
  { name: 'turn_stop', public: true },
  {
    gameId: t.u64().primaryKey(),
    seat0Stops: t.string().default(''),  // csv of gates seat 0 has armed (fire during seat 1's turn); one-shot — consumed on trip
    seat1Stops: t.string().default(''),  // csv of gates seat 1 has armed (fire during seat 0's turn); one-shot — consumed on trip
    holdPhase: t.string().default(''),   // '' | gate holding the turn ('upkeep'..'discard' = before that phase; 'end' = before the turn flip)
    firedPhases: t.string().default(''), // unused since rev 4 (one-shot gates consume themselves); kept so live rows migrate in place
    holdResume: t.string().default(''),  // unused (a release never advances — the active player redoes the move); kept because auto-migration cannot drop columns
  }
);

// ---------------------------------------------------------------------------
// 21. StopHoldTimeout (scheduled table) — 60s liveness backstop for a hold.
//     At most one row per game (delete-then-insert arming). `phase` is a
//     stale-row guard: the handler no-ops unless it matches the live holdPhase.
// ---------------------------------------------------------------------------

let _handleStopHoldTimeout: any;
export const setStopHoldTimeoutReducer = (reducer: any) => {
  _handleStopHoldTimeout = reducer;
};

export const StopHoldTimeout = table(
  {
    name: 'stop_hold_timeout',
    public: true,
    scheduled: () => _handleStopHoldTimeout,
    indexes: [
      { accessor: 'stop_hold_timeout_game_id', algorithm: 'btree' as const, columns: ['gameId'] },
    ],
  },
  {
    scheduledId: t.u64().primaryKey().autoInc(),
    scheduledAt: t.scheduleAt(),
    gameId: t.u64(),
    phase: t.string(),
  }
);

// ---------------------------------------------------------------------------
// 22. SoloGame — marks a game where ONE identity holds both Player rows
//     (Deck Bracket "solo" play). activeSeat is the "seat in hand": the seat
//     an un-hinted action resolves to. Flips with the turn and on
//     solo_swap_seat. A separate table, not Game columns, for the same BSATN
//     reason as ForgeGame / TurnStop.
// ---------------------------------------------------------------------------
export const SoloGame = table(
  { name: 'solo_game', public: true },
  {
    gameId: t.u64().primaryKey(),
    activeSeat: t.u64(),
  }
);

// ---------------------------------------------------------------------------
// Schema export
// ---------------------------------------------------------------------------
const spacetimedb = schema({
  Game,
  Player,
  CardInstance,
  CardCounter,
  GameAction,
  ChatMessage,
  Spectator,
  SpectatorBan,
  SpectatorHandRequest,
  SpectatorHandRequestExpiry,
  DisconnectTimeout,
  ZoneSearchRequest,
  ChooseFirstTimeout,
  RevealTimeout,
  Emote,
  ForgeGame,
  ForgeConfig,
  ForgeSeatAuth,
  CleanupSchedule,
  PregameState,
  PregameStar,
  PregameIdleTimeout,
  TurnStop,
  StopHoldTimeout,
  SoloGame,
});

export default spacetimedb;
