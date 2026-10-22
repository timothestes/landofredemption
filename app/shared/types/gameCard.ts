/**
 * Core game card types shared between goldfish and multiplayer modes.
 *
 * Goldfish-specific types (GoldfishOptions, DEFAULT_OPTIONS, GameState)
 * remain in app/goldfish/types.ts and re-export everything from here.
 */

export type ZoneId =
  | 'deck'
  | 'hand'
  | 'reserve'
  | 'discard'
  | 'paragon'
  | 'land-of-bondage'
  | 'soul-deck'
  | 'territory'
  | 'land-of-redemption'
  | 'banish'
  | 'battle';

export const ALL_ZONES: ZoneId[] = [
  'deck', 'hand', 'reserve', 'discard', 'paragon',
  'land-of-bondage', 'soul-deck', 'territory',
  'land-of-redemption', 'banish', 'battle',
];

export const ZONE_LABELS: Record<ZoneId, string> = {
  'deck': 'Deck',
  'hand': 'Hand',
  'reserve': 'Reserve',
  'discard': 'Discard',
  'paragon': 'Paragon',
  'land-of-bondage': 'Land of Bondage',
  'soul-deck': 'Soul Deck',
  'territory': 'Territory',
  'land-of-redemption': 'Land of Redemption',
  'banish': 'Banish Zone',
  'battle': 'Field of Battle',
};

export type GamePhase = 'setup' | 'draw' | 'upkeep' | 'preparation' | 'battle' | 'discard';

export const PHASE_ORDER: GamePhase[] = ['draw', 'upkeep', 'preparation', 'battle', 'discard'];

export const COUNTER_COLORS = [
  { id: 'red', label: 'Red', hex: '#8b1a1a' },
  { id: 'blue', label: 'Blue', hex: '#1a3a8b' },
  { id: 'green', label: 'Green', hex: '#1a6b1a' },
  { id: 'yellow', label: 'Yellow', hex: '#8b7a1a' },
  { id: 'purple', label: 'Purple', hex: '#6b1a8b' },
  { id: 'white', label: 'White', hex: '#888888' },
] as const;

export type CounterColorId = typeof COUNTER_COLORS[number]['id'];

export interface Counter {
  color: CounterColorId;
  count: number;
}

export interface GameCard {
  instanceId: string;
  cardName: string;
  cardSet: string;
  cardImgFile: string;
  type: string;
  brigade: string;
  strength: string;
  toughness: string;
  specialAbility: string;
  identifier: string;
  reference: string;
  alignment: string;
  isMeek: boolean;
  counters: Counter[];
  isFlipped: boolean;
  isToken: boolean;
  /** Warrior/Weapon class, set only for Forge cards (which are absent from the
   *  public card index, so `findCard` can't supply it). Undefined for public
   *  cards — those resolve their class through the index. See equipClass.ts. */
  cardClass?: string;
  zone: ZoneId;
  ownerId: 'player1' | 'player2' | 'shared';
  isSoulDeckOrigin?: boolean;
  notes: string;
  posX?: number;
  posY?: number;
  /** Instance id of the warrior this card (a weapon) is attached to.
   *  Undefined when unattached. Cleared automatically by the reducer when
   *  either card leaves Territory. */
  equippedTo?: string;
  /** Unix ms epoch when this card's temporary per-card reveal expires.
   *  A card is "currently revealed" iff revealUntil !== undefined &&
   *  revealUntil > Date.now(). Cleared whenever the card changes zone. */
  revealUntil?: number;
  /** Total duration of the active reveal in ms. Used to render the
   *  countdown ring with the correct fraction (10s auto vs 30s manual).
   *  Undefined when no reveal is active. */
  revealDurationMs?: number;
  /** Visual outline marker driven by `set_card_outline` abilities
   *  (Three Woes "Choose Good"/"Choose Evil"). 'good' = green border,
   *  'evil' = red border. Cleared when the card leaves Territory. */
  outlineColor?: 'good' | 'evil';
  /** Sideways (90°) marker driven by the `set_rotation` ability on "counts
   *  as two Lost Souls" cards (Two/Three Liner) — records the first of two
   *  required rescues while the soul is in the Land of Bondage. Cleared when
   *  the card leaves the Land of Bondage. */
  isRotated?: boolean;
  /** Name of the Lost Soul this card is currently imitating (set by the
   *  imitate_lost_soul reducer). Empty string or undefined when not
   *  imitating. The label overlay in GameCardNode renders this value
   *  only when no art swap occurred (fallback-only). */
  imitatingName?: string;
}

export type ActionType =
  | 'MOVE_CARD'
  | 'DRAW_CARD'
  | 'DRAW_MULTIPLE'
  | 'SHUFFLE_DECK'
  | 'SHUFFLE_SOUL_DECK'
  | 'ADD_COUNTER'
  | 'REMOVE_COUNTER'
  | 'MEEK_CARD'
  | 'UNMEEK_CARD'
  | 'FLIP_CARD'
  | 'RESET_GAME'
  | 'START_GAME'
  | 'ADVANCE_PHASE'
  | 'REGRESS_PHASE'
  | 'END_TURN'
  | 'ADD_NOTE'
  | 'ADD_OPPONENT_LOST_SOUL'
  | 'REMOVE_OPPONENT_TOKEN'
  | 'MOVE_TO_TOP_OF_DECK'
  | 'MOVE_TO_BOTTOM_OF_DECK'
  | 'MOVE_CARDS_BATCH'
  | 'ADD_PLAYER_LOST_SOUL'
  | 'REORDER_HAND'
  | 'REORDER_LOB'
  | 'ATTACH_CARD'
  | 'DETACH_CARD'
  | 'EXECUTE_CARD_ABILITY'
  | 'EXECUTE_CARD_ABILITY_WITH_COUNT'
  | 'REVEAL_CARD_IN_HAND'
  | 'RESURRECT_HEROES'
  | 'KEEP_ONE_SHUFFLE_DRAW'
  | 'SET_CARD_OUTLINE'
  | 'IMITATE_LOST_SOUL'
  | 'STOP_IMITATING_LOST_SOUL'
  | 'DECK_SPREAD'
  | 'DECK_GATHER';

export interface GameAction {
  id: string;
  type: ActionType;
  playerId: 'player1' | 'player2';
  timestamp: number;
  payload: {
    cardInstanceId?: string;
    warriorInstanceId?: string;
    cardInstanceIds?: string[];
    fromZone?: ZoneId;
    toZone?: ZoneId;
    toIndex?: number;
    quantity?: number;
    value?: number | string;
    color?: CounterColorId;
    posX?: number;
    posY?: number;
    positions?: Record<string, { posX: number; posY: number }>;
    abilityIndex?: number;
    /** Instance id of a target card chosen via the targeting overlay
     *  (currently only used by IMITATE_LOST_SOUL). */
    targetInstanceId?: string;
    /** Hand card kept by KEEP_ONE_SHUFFLE_DRAW; the rest of that hand is
     *  shuffled into the deck and redrawn. */
    keepInstanceId?: string;
    /** KEEP_ONE_SHUFFLE_DRAW: true = shuffle the rest but draw nothing (the
     *  draw half was prevented). */
    skipDraw?: boolean;
  };
}

export interface DeckDataForGoldfish {
  id: string;
  name: string;
  format: string;
  paragon?: string | null;
  isOwner?: boolean;
  /** True when this deck was loaded from the Forge (private card design area).
   *  Routes the goldfish back button to the Forge deck builder instead of the
   *  public decklist. */
  isForge?: boolean;
  cards: {
    card_name: string;
    card_set: string;
    card_img_file: string;
    card_type: string;
    card_brigade: string;
    card_strength: string;
    card_toughness: string;
    card_special_ability: string;
    card_identifier: string;
    card_reference: string;
    card_alignment: string;
    /** Forge cards only — see GameCard.cardClass. */
    card_class?: string;
    quantity: number;
    is_reserve: boolean;
  }[];
}
