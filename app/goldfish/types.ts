// Re-export all shared game types so existing goldfish imports continue to work.
export type {
  ZoneId,
  GamePhase,
  CounterColorId,
  Counter,
  GameCard,
  ActionType,
  GameAction,
  DeckDataForGoldfish,
} from '../shared/types/gameCard';

export {
  ALL_ZONES,
  ZONE_LABELS,
  PHASE_ORDER,
  COUNTER_COLORS,
} from '../shared/types/gameCard';

// --- Goldfish-specific types (not shared) ---

import type { GamePhase, ZoneId, GameCard } from '../shared/types/gameCard';

export interface GoldfishOptions {
  format: 'T1' | 'T2' | 'Paragon';
  startingHandSize: number;
  autoRouteLostSouls: boolean;
  showPhaseReminder: boolean;
  showTurnCounter: boolean;
  soundEnabled: boolean;
  alwaysStartWith: string[];
}

export const DEFAULT_OPTIONS: GoldfishOptions = {
  format: 'T1',
  startingHandSize: 8,
  autoRouteLostSouls: true,
  showPhaseReminder: true,
  showTurnCounter: true,
  soundEnabled: true,
  alwaysStartWith: [],
};

export interface GameState {
  sessionId: string;
  deckId: string;
  deckName: string;
  isOwner: boolean;
  /** True when the deck came from the Forge — routes the back button to the
   *  Forge deck builder rather than the public decklist. */
  isForge: boolean;
  format: 'T1' | 'T2' | 'Paragon';
  paragonName: string | null;
  turn: number;
  phase: GamePhase;
  zones: Record<ZoneId, GameCard[]>;
  history: GameState[];
  options: GoldfishOptions;
  isSpreadHand: boolean;
  drawnThisTurn: boolean;
  /** True while "play with top card of deck face up" is active (The
   *  Foretelling Angel's toggle_top_deck_reveal ability). The canvas renders
   *  the top deck card face up and draggable while set. Optional so states
   *  saved before the field existed load cleanly. */
  topDeckRevealed?: boolean;
  /** Instance ids of deck-pile cards laid out across Territory by the gear
   *  menu's "Spread Deck" (deck-builder expanded layout). Present only while
   *  at least one of them is still in Territory — the reducer prunes ids as
   *  cards leave, and drops the field when none remain — so a defined value
   *  means the menu should offer "Gather Deck". Named apart from the hand's
   *  `isSpreadHand` fan/unfan toggle. */
  deckSpreadIds?: string[];
  /** Logged-in user's profile username (null when not signed in). Used only to
   *  gate the per-user cycling-token easter egg; everything else ignores it. */
  currentUsername?: string | null;
}
