import type { GameCard } from '@/app/goldfish/types';

/**
 * Targeting request issued by the menu when the player picks an ability that
 * needs a follow-up card click (currently only `imitate_lost_soul`). The
 * canvas owns the state — it stores the request, dims ineligible cards, and
 * routes the next eligible card click through `onSelect`.
 */
export interface TargetingRequest {
  prompt: string;
  isEligible: (card: GameCard) => boolean;
  onSelect: (targetInstanceId: string) => void;
  onCancel: () => void;
}

/**
 * Numeric input prompt issued by the menu when an ability needs the player to
 * pick a count at activation time (currently only `draw_bottom_of_deck_choose`).
 * The canvas owns the dialog state.
 */
export interface CountPromptRequest {
  title: string;
  cardName: string;
  defaultCount: number;
  // Upper bound for the chosen count (e.g. Angel of the Harvest's "limit 7").
  // When set, the stepper/input clamp to this and the confirmed value is capped.
  maxCount?: number;
  // Verb shown on the confirm button — "Draw 3", "Look at 3". Defaults to "Draw".
  confirmVerb?: string;
  onConfirm: (count: number) => void;
  onCancel: () => void;
}

/**
 * Common interface for game actions shared between goldfish and multiplayer modes.
 * All IDs are strings — multiplayer adapter converts to bigint internally.
 */
export interface GameActions {
  // Core card operations
  moveCard(cardId: string, toZone: string, posX?: string, posY?: string): void;
  moveCardsBatch(cardIds: string[], toZone: string): void;
  flipCard(cardId: string): void;
  meekCard(cardId: string): void;
  unmeekCard(cardId: string): void;
  addCounter(cardId: string, color: string): void;
  removeCounter(cardId: string, color: string): void;
  shuffleCardIntoDeck(cardId: string): void;
  shuffleDeck(): void;
  randomHandToZone(count: number, toZone: string, deckPosition: string): void;
  randomReserveToZone(count: number, toZone: string, deckPosition: string): void;
  reloadDeck: (deckId: string, deckData: string, paragon: string) => void;
  setNote(cardId: string, text: string): void;
  exchangeCards(cardIds: string[]): void;
  drawCard(): void;
  drawMultiple(count: number): void;

  // Deck position operations (available in both modes)
  moveCardToTopOfDeck(cardId: string): void;
  moveCardToBottomOfDeck(cardId: string): void;

  // Token operations (optional — not all modes may support)
  spawnLostSoul?(testament: 'NT' | 'OT', posX?: string, posY?: string): void;
  removeToken?(cardId: string): void;
  removeOpponentToken?(cardId: string): void;

  // Deck inspection (optional — may not be available in all modes)
  searchDeck?(): void;
  peekTopN?(count: number): void;

  // Equip weapon to warrior (optional — implemented by both goldfish and multiplayer)
  attachCard?(weaponId: string, warriorId: string): void;
  detachCard?(cardId: string, posX?: number, posY?: number): void;

  // Custom per-card abilities (optional — registry-driven right-click actions).
  // Implemented by both goldfish and multiplayer. See lib/cards/cardAbilities.ts.
  executeCardAbility?(sourceInstanceId: string, abilityIndex: number): void;

  // Variant of executeCardAbility for abilities whose count is chosen by the
  // player at activation time (currently only `draw_bottom_of_deck_choose`).
  // The CardContextMenu opens a count prompt via beginCountPrompt; on confirm
  // the canvas invokes this with the chosen count.
  executeCardAbilityWithCount?(sourceInstanceId: string, abilityIndex: number, count: number): void;
  beginCountPrompt?(req: CountPromptRequest): void;

  // Per-card hand reveal (optional — implemented by both goldfish and multiplayer).
  // Temporarily reveals a single hand card to opponents/spectators for 30 seconds.
  // Duration is fixed at the callee — callers don't pass it.
  revealCardInHand?(cardId: string): void;

  // Imitate Lost Soul ability (optional — implemented by both goldfish and multiplayer).
  // beginTargeting puts the canvas into "click a card" mode for ability flows
  // that need a follow-up target; CardContextMenu calls it for the
  // `imitate_lost_soul` ability variant.
  imitateLostSoul?(sourceInstanceId: string, targetInstanceId: string): void;
  stopImitatingLostSoul?(sourceInstanceId: string): void;
  beginTargeting?(req: TargetingRequest): void;

  // Resurrect Heroes ability (optional — implemented by both goldfish and
  // multiplayer). The CardContextMenu calls beginResurrectPrompt for the
  // `resurrect_heroes` variant; the canvas builds the per-player discard
  // pages from its own state, shows ResurrectHeroesModal, and on confirm
  // invokes resurrectHeroes with the chosen card instance ids. Each selected
  // Hero returns to its own owner's Territory (ownerId unchanged).
  beginResurrectPrompt?(sourceInstanceId: string, abilityIndex: number): void;
  resurrectHeroes?(sourceInstanceId: string, abilityIndex: number, selectedInstanceIds: string[]): void;

  // Philip's Daughters (`all_players_keep_one_shuffle_draw`). CardContextMenu
  // calls beginKeepOnePrompt; the canvas shows KeepOneModal over the local
  // player's own hand and on confirm invokes keepOneShuffleDraw with the card
  // being kept. Everything else in that hand shuffles into the deck and the
  // player draws that many back. In multiplayer the opponent is then asked to
  // do the same on their own hand — each player picks their own keeper, so
  // neither ever sees the other's choice before making it.
  beginKeepOnePrompt?(sourceInstanceId: string, abilityIndex: number): void;
  keepOneShuffleDraw?(sourceInstanceId: string, abilityIndex: number, keepInstanceId: string): void;
  // Takes back the local player's own half of Philip's Daughters (hand and
  // deck restored). Multiplayer only — goldfish has whole-state undo. Offered
  // on the card's menu and the deck menu while the server still holds the
  // snapshot (CardContextMenu's keepOneUndoAvailable).
  undoKeepOneShuffleDraw?(): void;
}
