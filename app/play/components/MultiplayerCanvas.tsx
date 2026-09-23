'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Stage, Layer, Rect, Text, Group, Line, Circle, Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import KonvaLib from 'konva';

import { useGameState, useSpectatorGameState } from '../hooks/useGameState';
import { useSpacetimeDB } from 'spacetimedb/react';
import { useSpreadHand } from '../contexts/SpreadHandContext';
import {
  calculateMultiplayerLayout,
  type ZoneRect,
} from '../layout/multiplayerLayout';
import { toScreenPos, toDbPos, cardCenter, adjustAnchorForRotationChange } from '../utils/coordinateTransforms';
import { calculateHandPositions, HAND_TOOLBAR_RESERVE } from '../layout/multiplayerHandLayout';
import { calculateAutoArrangePositions } from '../layout/multiplayerAutoArrange';
import { splitLobCards } from '../layout/lobClassification';
import { useDealAnimation } from '@/app/shared/hooks/useDealAnimation';
import { useHandLayoutTween } from '@/app/shared/hooks/useHandLayoutTween';
import { DealLayer, type DealSpriteSpec } from '@/app/shared/components/DealLayer';
import {
  GameCardNode,
  CardBackShape,
  cardBackListeners,
  cardBackLoaded,
} from '../../shared/components/GameCardNode';
import { useSelectionState, type CardBound } from '../../goldfish/hooks/useSelectionState';
import type { GameCard, Counter } from '../../goldfish/types';
import { COUNTER_COLORS } from '../../goldfish/types';
import type {
  CardInstance,
  CardCounter,
  PregameStar,
} from '@/lib/spacetimedb/module_bindings/types';
import { CardContextMenu } from '@/app/shared/components/CardContextMenu';
import { CardNotePopover } from './CardNotePopover';
import { MultiCardContextMenu } from '@/app/shared/components/MultiCardContextMenu';
import { ZoneContextMenu } from '@/app/shared/components/ZoneContextMenu';
import { DeckContextMenu } from '@/app/shared/components/DeckContextMenu';
import { DeckDropPopup } from '@/app/shared/components/DeckDropPopup';
import { LorContextMenu } from '@/app/shared/components/LorContextMenu';
import { OpponentZoneContextMenu } from '@/app/shared/components/OpponentZoneContextMenu';
import { HandContextMenu } from '@/app/shared/components/HandContextMenu';
import { ReserveContextMenu } from '@/app/shared/components/ReserveContextMenu';
import { ConsentDialog } from '@/app/shared/components/ConsentDialog';
import { BoardRequestBanner } from '@/app/shared/components/BoardRequestBanner';
import { OpponentBrowseModal } from '@/app/shared/components/OpponentBrowseModal';
import { showGameToast } from '@/app/shared/components/GameToast';
import { TargetCardOverlay } from '@/app/shared/components/TargetCardOverlay';
import type { GameActions, TargetingRequest, CountPromptRequest } from '@/app/shared/types/gameActions';
import { CountPromptDialog } from '@/app/shared/components/CountPromptDialog';
import { ResurrectHeroesModal } from '@/app/shared/components/ResurrectHeroesModal';
import { KeepOneModal } from '@/app/shared/components/KeepOneModal';
import { isHeroCard, hasReferenceBook } from '@/lib/cards/cardAbilities';
import { ModalGameProvider, type ModalGameContextValue } from '@/app/shared/contexts/ModalGameContext';
import { DeckSearchModal } from '@/app/shared/components/DeckSearchModal';
import { DeckPeekModal } from '@/app/shared/components/DeckPeekModal';
import { getEffectiveAbilities, isCharacterCard, isDanielCard, isLostSoulCard, lostSoulValue, simplifyLostSoulName } from '@/lib/cards/cardAbilities';
import { DeckExchangeModal } from '@/app/shared/components/DeckExchangeModal';
import { ZoneBrowseModal } from '@/app/shared/components/ZoneBrowseModal';
import { useModalCardDrag } from '@/app/shared/hooks/useModalCardDrag';
import { useRevealTick } from '@/app/shared/hooks/useRevealTick';
import { computeHandBrigades } from '@/app/shared/utils/handBrigades';
import type { ZoneId } from '@/app/shared/types/gameCard';
import type { ZoneRect as GoldfishZoneRect } from '@/app/goldfish/layout/zoneLayout';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import DiceOverlay from './DiceOverlay';
import BattleResolutionUI from './BattleResolutionUI';
import PregameRail from './PregameRail';
import { STAR_OF_DAVID_IMG, STAR_OF_DAVID_INSET } from './StarOfDavidIcon';
import { getCardImageUrl as getSharedCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { preloadImitateSouls } from '@/app/shared/utils/preloadImitateSouls';
import { useVirtualCanvas, VIRTUAL_WIDTH, VIRTUAL_HEIGHT, virtualToScreen, screenToVirtual } from '@/app/shared/layout/virtualCanvas';
import { isPrimaryPointer } from '@/app/play/lib/pointerButton';
import { applyCameraToScale } from '@/app/shared/layout/camera';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { useBoardCamera } from '@/app/play/hooks/useBoardCamera';
import { useTapToMove } from '@/app/play/hooks/useTapToMove';
import { buildJumpTargets, type JumpTargetId } from '@/app/play/lib/jumpTargets';
import { PORTRAIT_GATE_MAX_WIDTH } from '@/app/play/lib/orientationGate';
import type { CommitMove } from '@/app/play/lib/tapToMoveCore';
import type { PointerSample } from '@/app/play/lib/gestureCore';
import { LONG_PRESS_MS, LONG_PRESS_MOVE_TOLERANCE } from '@/app/play/lib/longPressCore';
import { DestinationRail } from '@/app/play/components/DestinationRail';
import { TouchControls } from '@/app/play/components/TouchControls';
import { BoardBrowseSheet, type BoardBrowseEntry } from './BoardBrowseSheet';
import { CardReaderOverlay } from './CardReaderOverlay';
import { computeEquipOffset, hitTestWarrior, MAX_EQUIPPED_WEAPONS_PER_WARRIOR } from '@/app/goldfish/utils/equipLayout';
import { gameCardIsWarrior, gameCardIsWeapon } from '@/app/goldfish/utils/equipClass';
import { findCard, isSite } from '@/lib/cards/lookup';
import { isStarAbilityText } from '@/lib/cards/starCards';
import { compareCardsDefault } from '@/lib/cards/defaultSort';
import { normalizeDeckFormat } from '@/lib/deck-format';
import { SOUL_DECK_BACK_IMG } from '@/app/shared/paragon/soulDeck';
import { Link2Off } from 'lucide-react';
import { useCardScale } from '@/app/shared/hooks/useCardScale';
import { useCardSounds } from '@/app/shared/hooks/useCardSounds';
import { CardScaleControl } from '@/app/shared/components/CardScaleControl';
import { useLobArrivalEffect } from '@/app/shared/hooks/useLobArrivalEffect';
import { useLostSoulDeals } from '@/app/shared/hooks/useLostSoulDeals';
import { LostSoulDealLayer, type SoulDeal } from '@/app/shared/components/LostSoulDealLayer';
import { computeDealFlight } from '@/app/shared/utils/lostSoulDeal';
import { useCardEnterPlayPrompt } from '@/app/shared/hooks/useCardEnterPlayPrompt';
import { cardInstanceToGameCard } from '../utils/cardAdapter';
import { resolveCardImageUrl, resolveBattleRowFields, resolveForgeCardName, type ForgeResolverMap } from '../utils/forgeResolver';
import type { UndoStack, Captured } from '../hooks/useUndoStack';
import { makeReverseAction, makeBatchReverseAction, reverseIsSafe } from '../hooks/useUndoStack';
import {
  battleSideOf,
  sideTotals,
  computeInitiative,
  parseAlignmentStats,
  siteAttachedSoulIds,
  parseMeekStats,
  type BattleCardLike,
  type BattleSeat,
} from '../lib/battleMath';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sidebar zones that display as a pile with a count badge (not individual cards). */
const SIDEBAR_PILE_ZONES = ['deck', 'discard', 'reserve', 'banish', 'land-of-redemption'] as const;

// Compact touch: the icon-rail sidebar is too narrow for the full pile names —
// the count badges overprinted the glyphs ("DECR4", "RESER0/VE", "LAND OF/
// REDEMPTIO/N"). Short labels keep the count clear at phone sizes.
const COMPACT_PILE_LABELS: Record<string, string> = {
  deck: 'DECK',
  reserve: 'RES',
  discard: 'DISC',
  banish: 'BAN',
  'land-of-redemption': 'LOR',
  'land-of-bondage': 'LOB',
};

// The territory label band used to size itself from a per-char estimate
// (length * 8.5), which visibly mismatches Cinzel's real glyph widths — the
// band is right-anchored, so all the error showed up as a left overhang plus
// a gap before the count badge. Measure with the same canvas API Konva uses.
// No cache: Cinzel loads async, and an uncached measure self-corrects on the
// next render once the webfont is in.
let labelMeasureCtx: CanvasRenderingContext2D | null = null;
function measureLabelWidth(text: string, fontSize: number, letterSpacing: number): number {
  if (typeof document === 'undefined') return text.length * fontSize * 0.77;
  if (!labelMeasureCtx) labelMeasureCtx = document.createElement('canvas').getContext('2d');
  if (!labelMeasureCtx) return text.length * fontSize * 0.77;
  labelMeasureCtx.font = `${fontSize}px Cinzel, Georgia, serif`;
  return labelMeasureCtx.measureText(text).width + letterSpacing * Math.max(0, text.length - 1);
}

/** Zones where cards are positioned freely (territory only). */
const FREE_FORM_ZONES = ['territory'] as const;
type FreeFormZone = (typeof FREE_FORM_ZONES)[number];

/** Zones where cards are auto-arranged in a horizontal strip. */
const AUTO_ARRANGE_ZONES = ['land-of-bondage'] as const;

/** Battle-band background Rect opacity — the seam tween's open target. Must
 *  stay in sync with the Rect's JSX `opacity` (single source of truth for
 *  both; the tween must never read the Rect's live value as a target). */
const BAND_BG_OPACITY = 0.75;

/** Field-of-Battle open/close fade timings (ms). Open only fades the chrome IN
 *  (the background is placed opaque from frame 0 — flash-safe); close fades the
 *  whole band OUT. Close matches the 200ms card-reflow glide so nothing is out
 *  of step; the open wash is a touch quicker. */
const BAND_CHROME_FADE_MS = 160;
const BAND_CLOSE_FADE_MS = 200;

/** Drag-target guidance cue pulse — amplitude and one-leg duration. `yoyo`
 *  doubles the duration for a full up/down cycle (~1.6s here, within the
 *  1.5-2s "slow gentle pulse" range). */
const BATTLE_GUIDANCE_CUE_OPACITY_MIN = 0.35;
const BATTLE_GUIDANCE_CUE_OPACITY_MAX = 0.6;
const BATTLE_GUIDANCE_CUE_PULSE_DURATION = 0.8;

// Phase Stops: display labels for the gated phase in the hold prompt ('end'
// is phrased as "before you end your turn" instead).
const STOP_GATE_LABELS: Record<string, string> = {
  upkeep: 'Upkeep',
  preparation: 'Preparation',
  battle: 'Battle',
  discard: 'Discard',
};

/** All zone keys that can be a drop target. */
type DropZoneKey = string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// `cardInstanceToGameCard` is imported from `../utils/cardAdapter` — keep the
// adapter colocated with the reference-stable cache hook used by useGameState.

/** Check if a point (px, py) is inside a ZoneRect. */
function pointInRect(px: number, py: number, rect: ZoneRect): boolean {
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
}

/** Determine if a zone key is a free-form zone (cards positioned at arbitrary x/y). */
function isFreeFormZone(zone: string): boolean {
  return zone === 'territory' || zone === 'battle';
}

/** Determine if a zone key is an auto-arrange zone (horizontal strip layout). */
function isAutoArrangeZone(zone: string): boolean {
  return zone === 'land-of-bondage';
}

// ---------------------------------------------------------------------------
// Battle Zone chrome helpers (spec §5/§6, Task 12)
// ---------------------------------------------------------------------------

/** A battle-band CardInstance row paired with the owner-relative BattleCardLike
 *  shape battleMath.ts consumes, plus which local rendering "half" it belongs
 *  to (my cards vs. opponent-owned cards). */
interface BattleCardEntry {
  row: CardInstance;
  owner: 'my' | 'opponent';
  like: BattleCardLike;
}

/**
 * Whether the Field of Battle band should be open. Phase-driven (spec §4): open
 * while the turn player is in the 'battle' phase, OR whenever battleState is
 * non-empty (covers a battle still resolving a soul surrender, or drift between
 * the two signals). Gated on a live game: a finished game (e.g. a concede
 * mid-battle, which only flips status to 'finished' without clearing the phase
 * or battleState) — or a waiting one — never shows the band.
 */
export function isBattleBandActive(
  status: string,
  currentPhase: string,
  battleState: string,
): boolean {
  return status === 'playing' && (currentPhase === 'battle' || battleState !== '');
}

/** Mirrors battleMath.ts's private isLostSoulLike / the server's
 *  isLostSoulRow (battleStakesLobLostSouls): used client-side to count the
 *  stakes Lost Souls for the Rescue-attempt vs. Battle-challenge header. */
function isBattleLostSoulRow(c: { cardType: string; cardName: string }): boolean {
  return c.cardType === 'LS' || c.cardType === 'TOKEN_LS' || c.cardName.toLowerCase().includes('lost soul');
}

/** Build a human-readable fragment for an opponent-action request, used in the
 *  consent dialog (e.g. "draw 3 from the top of your deck"). */
function describeOpponentAction(action: string, paramsJson: string): string {
  let parsed: any = {};
  try { parsed = paramsJson ? JSON.parse(paramsJson) : {}; } catch {}
  const count = parsed.count ?? 0;
  const plural = count === 1 ? '' : 's';
  if (action === 'shuffle_and_draw') {
    const s = parsed.shuffleCount ?? 0;
    const d = parsed.drawCount ?? 0;
    return `shuffle ${s} random card${s === 1 ? '' : 's'} from your hand into your deck and draw ${d}`;
  }
  switch (action) {
    case 'shuffle_deck': return 'shuffle your deck';
    case 'look_deck_top': return `look at the top ${count} card${plural} of your deck`;
    case 'look_deck_bottom': return `look at the bottom ${count} card${plural} of your deck`;
    case 'look_deck_random': return `look at ${count} random card${plural} from your deck`;
    case 'reveal_deck_top': return `reveal the top ${count} card${plural} of your deck`;
    case 'reveal_deck_bottom': return `reveal the bottom ${count} card${plural} of your deck`;
    case 'reveal_deck_random': return `reveal ${count} random card${plural} from your deck`;
    case 'draw_deck_top': return `draw ${count} from the top of your deck`;
    case 'draw_deck_bottom': return `draw ${count} from the bottom of your deck`;
    case 'draw_deck_random': return `draw ${count} random card${plural} from your deck`;
    case 'discard_deck_top': return `discard the top ${count} card${plural} of your deck`;
    case 'discard_deck_bottom': return `discard the bottom ${count} card${plural} of your deck`;
    case 'discard_deck_random': return `discard ${count} random card${plural} from your deck`;
    case 'reserve_deck_top': return `send the top ${count} card${plural} of your deck to reserve`;
    case 'reserve_deck_bottom': return `send the bottom ${count} card${plural} of your deck to reserve`;
    case 'reserve_deck_random': return `send ${count} random card${plural} from your deck to reserve`;
    case 'random_hand_to_discard': return `discard ${count} random card${plural} from your hand`;
    case 'random_hand_to_reserve': return `send ${count} random card${plural} from your hand to reserve`;
    case 'random_hand_to_deck_top': return `send ${count} random card${plural} from your hand to the top of your deck`;
    case 'random_hand_to_deck_bottom': return `send ${count} random card${plural} from your hand to the bottom of your deck`;
    case 'random_hand_to_deck_shuffle': return `shuffle ${count} random card${plural} from your hand into your deck`;
    case 'discard_reserve_characters': return 'discard all characters from your reserve';
    case 'keep_one_shuffle_draw': return 'keep 1 card of your choice, shuffle the rest of your hand into your deck, and draw that many';
    default: return 'perform an action on your deck';
  }
}

/** Same as describeOpponentAction but phrased from the requester's POV for
 *  denial toasts (e.g. "look at top 6 of opponent's deck"). */
function describeRequesterAction(action: string, paramsJson: string): string {
  let parsed: any = {};
  try { parsed = paramsJson ? JSON.parse(paramsJson) : {}; } catch {}
  const count = parsed.count ?? 0;
  const plural = count === 1 ? '' : 's';
  if (action === 'shuffle_and_draw') {
    const s = parsed.shuffleCount ?? 0;
    const d = parsed.drawCount ?? 0;
    return `shuffle ${s} from opponent's hand, draw ${d}`;
  }
  switch (action) {
    case 'shuffle_deck': return "shuffle opponent's deck";
    case 'look_deck_top': return `look at top ${count} of opponent's deck`;
    case 'look_deck_bottom': return `look at bottom ${count} of opponent's deck`;
    case 'look_deck_random': return `look at ${count} random card${plural} from opponent's deck`;
    case 'reveal_deck_top': return `reveal top ${count} of opponent's deck`;
    case 'reveal_deck_bottom': return `reveal bottom ${count} of opponent's deck`;
    case 'reveal_deck_random': return `reveal ${count} random card${plural} from opponent's deck`;
    case 'draw_deck_top': return `draw ${count} from top of opponent's deck`;
    case 'draw_deck_bottom': return `draw ${count} from bottom of opponent's deck`;
    case 'draw_deck_random': return `draw ${count} random from opponent's deck`;
    case 'discard_deck_top': return `discard top ${count} of opponent's deck`;
    case 'discard_deck_bottom': return `discard bottom ${count} of opponent's deck`;
    case 'discard_deck_random': return `discard ${count} random from opponent's deck`;
    case 'reserve_deck_top': return `reserve top ${count} of opponent's deck`;
    case 'reserve_deck_bottom': return `reserve bottom ${count} of opponent's deck`;
    case 'reserve_deck_random': return `reserve ${count} random from opponent's deck`;
    case 'random_hand_to_discard': return `discard ${count} random from opponent's hand`;
    case 'random_hand_to_reserve': return `send ${count} random from opponent's hand to reserve`;
    case 'random_hand_to_deck_top': return `send ${count} random from opponent's hand to top of deck`;
    case 'random_hand_to_deck_bottom': return `send ${count} random from opponent's hand to bottom of deck`;
    case 'random_hand_to_deck_shuffle': return `shuffle ${count} random from opponent's hand into deck`;
    case 'discard_reserve_characters': return "discard all characters from opponent's reserve";
    case 'keep_one_shuffle_draw': return 'opponent keeps 1, shuffles the rest of their hand, and draws that many';
    default: return 'action';
  }
}

// ---------------------------------------------------------------------------
// Hand-card visibility predicate
// ---------------------------------------------------------------------------

type ViewerKind = 'self' | 'opponent' | 'spectator';

/**
 * Decide whether a hand card should render face-up for a given viewer.
 * - 'self': always face-up (you see your own hand).
 * - 'opponent': face-up iff owner.handRevealed AND the card is in the snapshot,
 *   OR the card has an active revealExpiresAt (per-card flash).
 * - 'spectator': face-up iff owner.shareHandWithSpectators, OR the card has
 *   an active revealExpiresAt.
 */
export function isHandCardFaceVisible(
  card: { id: bigint; revealExpiresAt?: { microsSinceUnixEpoch: bigint } | null },
  viewerKind: ViewerKind,
  ownerPlayer: { handRevealed: boolean; handRevealSnapshot: string; shareHandWithSpectators?: boolean } | null | undefined,
  nowMicros: bigint,
): boolean {
  if (viewerKind === 'self') return true;
  if (!ownerPlayer) return false;

  const flashActive =
    card.revealExpiresAt !== undefined &&
    card.revealExpiresAt !== null &&
    card.revealExpiresAt.microsSinceUnixEpoch > nowMicros;
  if (flashActive) return true;

  let snapshot: Set<string>;
  try {
    snapshot = new Set<string>((JSON.parse(ownerPlayer.handRevealSnapshot || '[]') as unknown[]).map(String));
  } catch {
    snapshot = new Set<string>();
  }
  const inSnapshot = snapshot.has(String(card.id));

  if (viewerKind === 'opponent') {
    return ownerPlayer.handRevealed && inSnapshot;
  }
  // spectator
  return ownerPlayer.shareHandWithSpectators === true || inSnapshot;
}

/**
 * Decide whether a FACE-DOWN in-play card's identity may be shown to the viewer
 * (e.g. in the hover loupe). Face-up / actively-revealed cards are public and
 * handled by the caller; this only governs cards that are face-down on the table.
 * - 'player': sees their own face-down cards ('player1'), never the opponent's.
 * - 'spectator': sees neither side's UNLESS that card's owner has opted to share
 *   with spectators (the same consent flag as hand/reserve).
 */
export function isFaceDownInPlayCardVisible(
  viewerKind: 'player' | 'spectator',
  ownerId: string,
  share: { myShareHand: boolean; oppShareHand: boolean },
): boolean {
  if (viewerKind === 'player') return ownerId === 'player1';
  return ownerId === 'player1' ? share.myShareHand : share.oppShareHand;
}

/**
 * Whether a double-click may toggle "meek" on a card. Any player may — meek can
 * be set on your own card OR an opponent's (e.g. a hero you've taken control
 * of); the server's meek_card/unmeek_card reducers don't gate on ownership
 * either. Spectators are strictly read-only.
 */
export function canViewerToggleMeek(
  viewerKind: 'player' | 'spectator',
): boolean {
  return viewerKind === 'player';
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MultiplayerCanvasProps {
  gameId: bigint;
  onLoadDeck?: () => void;
  /** Client-side undo stack for recording reverse actions */
  undoStack?: UndoStack;
  /** Called when any search/browse modal opens or closes. `true` = at least one modal is open. */
  onSearchModalChange?: (isOpen: boolean) => void;
  /** Whether the game timer is visible (passed through to CardScaleControl). */
  isTimerVisible?: boolean;
  /** Toggle timer visibility (passed through to CardScaleControl). */
  onToggleTimer?: () => void;
  /** Chat/log font scale — passed through to CardScaleControl for the slider. */
  chatScale?: number;
  setChatScale?: (scale: number) => void;
  resetChatScale?: () => void;
  minChatScale?: number;
  maxChatScale?: number;
  chatStep?: number;
  /**
   * Preloaded-image lookup. Hoisted to the parent so the cache survives the
   * canvas remounts that happen at lifecycle transitions (ceremony →
   * awaiting-start → playing).
   */
  getImage: (url: string) => HTMLImageElement | null;
  /** 'spectator' when mounted from /play/spectate/[code]. Defaults to 'player'. */
  viewerKind?: 'player' | 'spectator';
  /** Forge card resolver (granted name/text/art) for private Forge playtest games. */
  forgeResolver?: ForgeResolverMap | null;
  /** Compact touch layout, decided by the shell from the WINDOW viewport
   *  (isCompactTouchViewport) — covers phone portrait behind "Continue
   *  anyway" too, and kills the 500-548px drift between the shell's window
   *  height and this component's container height. Optional so callers that
   *  pass nothing (the spectator shell) keep the container-height fallback
   *  bit-identical. */
  compactLayout?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Zones whose browse grid must offer the full card menu rather than the
 *  move-only popup - cards in play need rotate/attach/counters/notes/rescue. */
const IN_PLAY_BROWSE_ZONES = new Set(['territory', 'land-of-bondage', 'hand']);

/** Mirror of BattleResolutionUI's chooser derivation (spec §7 / server
 *  surrender_soul): T1 → the defender picks the soul, T2/Paragon → the
 *  attacker. Used to hide TouchControls only for the viewer whose chooser
 *  modal is actually occluded by the cluster. */
function isSoulChooserSeat(mySeat: string, opponentSeat: string, attackerSeat: string, format: string): boolean {
  if (!mySeat) return false;
  const defenderSeat = attackerSeat === mySeat ? opponentSeat : attackerSeat === opponentSeat ? mySeat : '';
  const chooserSeat = format === 'T1' ? defenderSeat : attackerSeat;
  return mySeat === chooserSeat;
}

export default function MultiplayerCanvas({ gameId, onLoadDeck, undoStack, onSearchModalChange, isTimerVisible, onToggleTimer, getImage, chatScale, setChatScale, resetChatScale, minChatScale, maxChatScale, chatStep, viewerKind = 'player', forgeResolver, compactLayout }: MultiplayerCanvasProps) {
  const { setPreviewCard, isLoupeVisible, isPreviewFlipped } = useCardPreview();
  // Spectators may NEVER drag cards — even visually. Every `isDraggable` site
  // ANDs against this flag.
  const isSpectator = viewerKind === 'spectator';

  // ---- Container sizing (respects flex layout) ----
  const containerRef = useRef<HTMLDivElement>(null);
  // ---- Input mode + board camera ----
  // The camera folds into scale/offsetX/offsetY, which the Konva Layer and
  // every HTML overlay already respect, so it needs no call-site changes. On
  // pointer devices `camera` is null and the transform is bit-identical to
  // the pre-camera behaviour (asserted in camera.test.ts).
  const inputMode = useInputMode();
  const isTouch = inputMode === 'touch';
  const fit = useVirtualCanvas(containerRef);
  const { containerWidth, containerHeight, virtualWidth } = fit;
  const {
    camera, setCamera, jumpTo, reset: resetCamera,
    onPointersChange: onCameraPointers, isZoomed,
  } = useBoardCamera({
    fitScale: fit.scale,
    virtualWidth,
    containerWidth,
    containerHeight,
    enabled: isTouch,
  });
  const { scale, offsetX, offsetY } = applyCameraToScale(
    fit, camera, containerWidth, containerHeight,
  );
  /** Phone-sized viewports get the compact layout profile; tablets keep the
   *  standard one, which is already at laptop parity. The shell's viewport
   *  verdict wins when provided (it also covers phone portrait); the
   *  container-height fallback keeps prop-less callers (spectator shell)
   *  bit-identical. */
  const useCompactLayout = compactLayout ?? (isTouch && containerHeight > 0 && containerHeight < 500);
  /** Phone portrait behind "Continue anyway": the whole-board fit is a
   *  microfilm strip, so the default framing becomes a card-wide full-height
   *  column instead (see buildJumpTargets). Width-bounded like the rotate
   *  gate itself — iPad portrait is deliberately un-gated and its whole-board
   *  fit is usable, so it must NOT inherit the phone column framing. */
  const portraitBoard =
    isTouch && containerWidth > 0 && containerWidth < containerHeight && containerWidth < PORTRAIT_GATE_MAX_WIDTH;

  // ---- Canvas text legibility floor ----
  // Konva text is sized in virtual units and rendered through `scale`. On
  // small viewports (e.g. 14" Retina laptops where scale ~0.79) the same
  // virtual fontSize collapses below ~9 CSS px. `fs()` floors the rendered
  // size at MIN_TEXT_PX so labels stay readable; at scale ≥ ~1 the original
  // virtual size wins. `fsGrowth()` lets containers (label widths, badge
  // offsets) scale alongside the floored text.
  const MIN_TEXT_PX = 11;
  const safeScale = Math.max(scale, 0.01);
  const fs = (virtualSize: number) => Math.max(virtualSize, MIN_TEXT_PX / safeScale);
  const fsGrowth = (virtualSize: number) => fs(virtualSize) / virtualSize;

  // ---- Connection (for spectator-management reducer calls) ----
  const spacetimeCtx = useSpacetimeDB() as any;
  const conn = spacetimeCtx?.getConnection?.() ?? null;

  // ---- Game state ----
  // Both hooks must always be called (rules of hooks). Pass null to the unused
  // one — its subscriptions will match zero rows when effectiveGameId === 0n.
  const playerGameState = useGameState(viewerKind === 'spectator' ? 0n : gameId, forgeResolver);
  const spectatorGameState = useSpectatorGameState(viewerKind === 'spectator' ? gameId : null, forgeResolver);
  const gameState = viewerKind === 'spectator' ? spectatorGameState : playerGameState;
  const {
    myCards,
    opponentCards,
    sharedCards,
    counters,
    adaptedCardsById,
    moveCard: rawMoveCard,
    moveCardsBatch: rawMoveCardsBatch,
    updateCardPosition,
    incomingSearchRequest,
    approvedSearchRequest,
    logSearchDeck,
    logLookAtTop,
    requestZoneSearch,
    requestOpponentAction,
    approveZoneSearch,
    denyZoneSearch,
    completeZoneSearch,
    moveOpponentCard,
    shuffleOpponentDeck,
    zoneSearchRequests,
  } = gameState;

  // ---- Card sound effects (joke easter-egg, once per game; fires on each
  // client independently so both players hear it). ----
  const territorySoundCards = useMemo(
    () => [...(myCards['territory'] ?? []), ...(opponentCards['territory'] ?? [])],
    [myCards, opponentCards],
  );
  useCardSounds(territorySoundCards, String(gameId));

  // ---- Adapter: get GameCard for a CardInstance ----
  // Looks up the reference-stable adapted card from `useStableAdaptedCards` first
  // so every render-path consumer hits the same GameCard reference for unchanged
  // rows — the prerequisite that makes `memo(GameCardNode)` actually short-circuit.
  // Falls back to direct adaptation for synthetic cards or owner mismatches
  // (e.g. shared `ownerId === 0n` cards rendered as 'player2' in an opponent
  // shared-soul-deck modal — rare; correctness over speed).
  const adaptCard = useCallback(
    (card: CardInstance, owner: 'player1' | 'player2'): GameCard => {
      // Skip the stable cache for cards with active per-card reveals — the
      // countdown ring inside GameCardNode reads Date.now() at render time, so
      // it needs a fresh card reference each frame (driven by useRevealTick)
      // to bust the memo and tick down. Non-revealed cards keep the cached
      // reference so memo(GameCardNode) short-circuits as intended.
      const nowMicros = BigInt(Date.now()) * 1000n;
      const hasActiveReveal = card.revealExpiresAt !== undefined
        && card.revealExpiresAt.microsSinceUnixEpoch > nowMicros;
      if (!hasActiveReveal) {
        const cached = adaptedCardsById.get(card.id);
        if (cached && cached.ownerId === owner) return cached;
      }
      const cardCounters = counters.get(card.id) ?? [];
      return cardInstanceToGameCard(card, cardCounters, owner, forgeResolver);
    },
    [adaptedCardsById, counters, forgeResolver],
  );

  // Undo-aware wrappers for moveCard / moveCardsBatch used in drag handlers.
  const findCardForUndo = useCallback((id: string) => {
    for (const cards of Object.values(myCards)) {
      const found = cards.find(c => String(c.id) === id);
      if (found) return found;
    }
    for (const cards of Object.values(opponentCards)) {
      const found = cards.find(c => String(c.id) === id);
      if (found) return found;
    }
    return undefined;
  }, [myCards, opponentCards]);

  // Live lookup + move dispatcher bound into the undo guard. `lookupForUndo`
  // reports a card's CURRENT zone/owner (or undefined if it's gone) so the
  // guard can refuse a reverse whose target has since moved or been deleted.
  const lookupForUndo = useCallback((id: string) => {
    const c = findCardForUndo(id);
    return c ? { zone: c.zone, ownerId: String(c.ownerId) } : undefined;
  }, [findCardForUndo]);

  const undoMove = useCallback(
    (id: string, toZone: string, posX?: string, posY?: string, ownerId?: string) =>
      rawMoveCard(BigInt(id), toZone, undefined, posX, posY, ownerId),
    [rawMoveCard],
  );

  // Warm up the imitate-souls art cache once an Imitate Lost Soul exists
  // anywhere on either side. Avoids a ~1s placeholder flash when the player
  // triggers the swap. preloadImitateSouls is idempotent.
  useEffect(() => {
    const inAnyZone = (cards: Record<string, CardInstance[]>) =>
      Object.values(cards).some(zone => zone.some(c => c.cardName.startsWith('Lost Soul "Imitate"')));
    if (inAnyZone(myCards) || inAnyZone(opponentCards)) {
      preloadImitateSouls();
    }
  }, [myCards, opponentCards]);

  const moveCard: typeof rawMoveCard = useCallback(
    (cardInstanceId, toZone, zoneIndex, posX, posY, targetOwnerId) => {
      if (undoStack) {
        const card = findCardForUndo(String(cardInstanceId));
        if (card && card.zone !== toZone) {
          const captured: Captured = {
            cardId: String(cardInstanceId),
            fromZone: card.zone,
            prevOwnerId: String(card.ownerId),
            posX: card.posX,
            posY: card.posY,
          };
          undoStack.push({
            description: `Moved ${card.cardName || 'card'} to ${toZone}`,
            reverseAction: makeReverseAction({ captured, lookup: lookupForUndo, move: undoMove }),
          });
        }
      }
      rawMoveCard(cardInstanceId, toZone, zoneIndex, posX, posY, targetOwnerId);
    },
    [rawMoveCard, undoStack, findCardForUndo, lookupForUndo, undoMove],
  );

  const moveCardsBatch: typeof rawMoveCardsBatch = useCallback(
    (cardInstanceIds, toZone, positions, targetOwnerId, fromSource) => {
      if (undoStack) {
        const ids: string[] = JSON.parse(cardInstanceIds);
        const captured = ids.flatMap((id): Array<{ captured: Captured; name?: string }> => {
          const card = findCardForUndo(id);
          if (!card || card.zone === toZone) return [];
          return [{
            name: card.cardName,
            captured: {
              cardId: id,
              fromZone: card.zone,
              prevOwnerId: String(card.ownerId),
              posX: card.posX,
              posY: card.posY,
            },
          }];
        });
        if (captured.length > 0) {
          const desc = captured.length === 1
            ? `Moved ${captured[0].name || 'card'} to ${toZone}`
            : `Moved ${captured.length} cards to ${toZone}`;
          undoStack.push({
            description: desc,
            reverseAction: makeBatchReverseAction({
              items: captured.map(c => c.captured),
              lookup: lookupForUndo,
              move: undoMove,
            }),
          });
        }
      }
      rawMoveCardsBatch(cardInstanceIds, toZone, positions, targetOwnerId, fromSource);
    },
    [rawMoveCardsBatch, undoStack, findCardForUndo, lookupForUndo, undoMove],
  );

  // Push an undo entry for an opponent-card move. Captures the card's current
  // zone/position/owner BEFORE the forward action runs, so undo can restore it
  // even after the search request is closed.
  const recordOpponentCardUndo = useCallback((cardId: string | bigint, toZone: string) => {
    if (!undoStack) return;
    const idStr = String(cardId);
    const card = findCardForUndo(idStr);
    if (!card) return;
    if (card.zone === toZone) return; // no-op move, nothing to undo
    const prevOwnerId = String(card.ownerId ?? '');
    const captured: Captured = {
      cardId: idStr,
      fromZone: card.zone,
      prevOwnerId,
      posX: card.posX ?? '',
      posY: card.posY ?? '',
    };
    undoStack.push({
      description: `Moved ${card.cardName || 'card'} back to ${card.zone}`,
      reverseAction: makeReverseAction({ captured, lookup: lookupForUndo, move: undoMove }),
    });
  }, [undoStack, findCardForUndo, lookupForUndo, undoMove]);

  // ---- Layout ----
  // Normalize the raw game.format string (e.g. "Paragon Type 1", "Type 2") to
  // the canonical 'T1' | 'T2' | 'Paragon' expected by the layout function.
  const normalizedFormat = normalizeDeckFormat(gameState.game?.format ?? '');
  // ---- Drag state (isDraggingRef only — declared early so the battle-flip
  // deferral effect below can read it; the rest of the drag-state refs live
  // in their usual block further down). ----
  const isDraggingRef = useRef(false);

  // Field of Battle band stays open through the soul-surrender pick.
  // Layout flips are deferred while a card drag is in flight (Task 15, spec
  // §4): a previous attempt at this feature broke because an opponent
  // opening/closing the band mid-drag reflowed the layout under the dragged
  // card, teleporting it and dropping it somewhere the cursor never was.
  // `rawBattleActive` is the live server-derived truth; `battleActive` (the
  // APPLIED value everything below actually renders from) only follows it
  // while no drag is in flight. A flip that arrives mid-drag stays parked in
  // `rawBattleActiveRef` and is flushed by handleCardDragEnd on
  // dragend/drag-cancel — a single-step flip, never a per-frame recompute.
  // Phase-driven (spec §4): the band is visible whenever the turn player has
  // set_phase('battle'), OR whenever battleState is non-empty (defensive OR —
  // covers e.g. a battle still resolving a soul surrender after the phase bar
  // has moved on, or any state drift between the two signals). Gated on a live
  // game so a concede mid-battle (status -> 'finished' without clearing the
  // phase/battleState) closes the band instead of leaving it open. See
  // isBattleBandActive.
  const rawBattleActive = isBattleBandActive(
    gameState.game?.status ?? '',
    gameState.game?.currentPhase ?? '',
    gameState.game?.battleState ?? '',
  );
  const rawBattleActiveRef = useRef(rawBattleActive);
  rawBattleActiveRef.current = rawBattleActive;
  const [battleActive, setBattleActive] = useState(rawBattleActive);
  useEffect(() => {
    if (isDraggingRef.current) return; // parked; flushed on dragend/drag-cancel
    setBattleActive(rawBattleActive);
  }, [rawBattleActive]);
  const gameStatus = gameState.game?.status ?? '';
  const mpLayout = useMemo(
    () => calculateMultiplayerLayout(virtualWidth, VIRTUAL_HEIGHT, normalizedFormat, viewerKind === 'spectator' ? 'spectator' : 'player', battleActive, useCompactLayout),
    [virtualWidth, normalizedFormat, viewerKind, battleActive, useCompactLayout],
  );
  // Horizontal midline of the play mat (play area sans sidebar piles) in
  // screen px — dialogs that float over the board center on this rather than
  // the viewport/container midline, both of which sit visibly right of the
  // board (sidebar piles + chat column all live on the right).
  const playCenterScreenX = virtualToScreen(mpLayout.playAreaWidth / 2, 0, scale, offsetX, offsetY).x;
  // Band rect used for battle DROPS. While the band is still closed (a
  // divider-proxy drop that opens the battle) the current layout has no
  // battle rect yet, so normalize against the rect the band WILL have once
  // battleActive flips — that is the frame every client renders after
  // enter_battle lands.
  const battleBandRect = useMemo(() => {
    if (mpLayout?.zones.battle) return mpLayout.zones.battle;
    return calculateMultiplayerLayout(virtualWidth, VIRTUAL_HEIGHT, normalizedFormat, viewerKind === 'spectator' ? 'spectator' : 'player', true, useCompactLayout).zones.battle;
  }, [mpLayout, virtualWidth, normalizedFormat, viewerKind, useCompactLayout]);

  // Field of Battle band background lifecycle. OPEN is deliberately NOT
  // animated: the moment `battleActive` flips, the layout flip compresses the
  // territories in that same commit and the band region belongs to no zone —
  // it has no tint rect of its own, so any delay before the dark band Rect
  // covers it exposes the raw (bright) board art as a visible flash. The old
  // height/opacity grow-tween made that worse: it re-zeroed the Rect and left
  // most of the strip uncovered for the full 200ms glide. So the Rect now
  // renders in the SAME commit as the layout flip (`battleActive` in the JSX
  // gate below, not just `bandBgVisible`) at its full JSX height/opacity, and
  // motion comes from the card FLIP glides instead. Only the CLOSE fades:
  // by then the re-expanded territories already tint the region underneath,
  // so a fade-out can't expose anything bright.
  //
  // `lastBandRectRef` snapshots the last real band rect — once `battleActive`
  // flips false, mpLayout stops producing `zones.battle` entirely, so the
  // closing tween needs a frozen rect to animate against. `bandBgVisible`
  // keeps the Rect mounted a beat past `battleActive` going false so the
  // closing tween can finish before it actually unmounts. Every transition
  // destroys the in-flight tween FIRST (a rapid close→open must not leave a
  // stale close tween driving the rect to 0), and a reopen snaps the
  // imperatively-mutated height/opacity back to their layout-derived values —
  // React won't re-apply JSX attrs it doesn't know changed.
  const lastBandRectRef = useRef<ZoneRect | null>(null);
  if (mpLayout?.zones.battle) lastBandRectRef.current = mpLayout.zones.battle;
  const [bandBgVisible, setBandBgVisible] = useState(battleActive);
  // Refs to the two band-presentation Groups: `bg` (background rect + dashed
  // centerline, rendered below card art) and `chrome` (header + totals chips,
  // rendered above card art). Their opacity is driven imperatively by the
  // tweens below; each Group's JSX `opacity` prop is a CONSTANT React never
  // re-applies (same discipline as the guidance-cue tween), so a re-render
  // can't fight an in-flight fade.
  const bandBgGroupRef = useRef<Konva.Group | null>(null);
  const bandBgRectRef = useRef<Konva.Rect | null>(null);
  const bandChromeRef = useRef<Konva.Group | null>(null);
  const bandBgTweenRef = useRef<Konva.Tween | null>(null);
  const bandChromeTweenRef = useRef<Konva.Tween | null>(null);

  // Whole-band open/close animation. OPEN: the background rect "settles" from
  // fully opaque down to its resting BAND_BG_OPACITY while the chrome washes
  // IN — the bg is only ever MORE opaque than rest during the settle, so it
  // can never expose raw board art (the flash the old grow-tween caused; see
  // the BAND_BG_OPACITY note). CLOSE fades BOTH groups out together, so the
  // dashed centerline no longer hangs at full strength while everything else
  // dissolves. Every transition destroys the in-flight tweens FIRST so a rapid
  // open⇄close can't leave a stale fade driving a node toward 0. `bandBgTweenRef`
  // holds whichever bg animation is live (open = rect settle, close = group
  // fade) — the two branches are mutually exclusive so they never overlap.
  // Reduced motion: skip every tween and snap to the end state (mirrors
  // useHandLayoutTween, which gates the territory/battle card glides the same
  // way).
  useEffect(() => {
    bandBgTweenRef.current?.destroy();
    bandBgTweenRef.current = null;
    bandChromeTweenRef.current?.destroy();
    bandChromeTweenRef.current = null;
    const bg = bandBgGroupRef.current;
    const rect = bandBgRectRef.current;
    const chrome = bandChromeRef.current;
    const reduceMotion =
      typeof window !== 'undefined' &&
      !!window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (battleActive) {
      setBandBgVisible(true);
      // Group opacity at full immediately (a reopen mid-close snaps it back
      // from a fade the close tween had driven toward 0).
      bg?.opacity(1);
      if (reduceMotion) {
        rect?.opacity(BAND_BG_OPACITY);
        chrome?.opacity(1);
        return;
      }
      // BG settle: materialize from fully opaque to resting opacity.
      if (rect) {
        rect.opacity(1);
        const rt = new KonvaLib.Tween({
          node: rect,
          duration: BAND_CHROME_FADE_MS / 1000,
          opacity: BAND_BG_OPACITY,
          easing: KonvaLib.Easings.EaseOut,
          onFinish: () => { bandBgTweenRef.current = null; },
        });
        bandBgTweenRef.current = rt;
        rt.play();
      }
      // Chrome washes in from transparent so header/chips don't pop.
      if (chrome) {
        chrome.opacity(0);
        const t = new KonvaLib.Tween({
          node: chrome,
          duration: BAND_CHROME_FADE_MS / 1000,
          opacity: 1,
          easing: KonvaLib.Easings.EaseOut,
          onFinish: () => { bandChromeTweenRef.current = null; },
        });
        bandChromeTweenRef.current = t;
        t.play();
      }
      return;
    }
    // CLOSE — fade both groups out, then unmount once the bg fade lands.
    if (reduceMotion || !bg || !bg.getStage()) {
      chrome?.opacity(0);
      bg?.opacity(0);
      setBandBgVisible(false);
      return;
    }
    if (chrome) {
      const ct = new KonvaLib.Tween({
        node: chrome,
        duration: BAND_CLOSE_FADE_MS / 1000,
        opacity: 0,
        easing: KonvaLib.Easings.EaseOut,
        onFinish: () => { bandChromeTweenRef.current = null; },
      });
      bandChromeTweenRef.current = ct;
      ct.play();
    }
    const tween = new KonvaLib.Tween({
      node: bg,
      duration: BAND_CLOSE_FADE_MS / 1000,
      opacity: 0,
      easing: KonvaLib.Easings.EaseOut,
      onFinish: () => {
        bandBgTweenRef.current = null;
        setBandBgVisible(false);
      },
    });
    bandBgTweenRef.current = tween;
    tween.play();
  }, [battleActive]);

  useEffect(() => {
    return () => {
      bandBgTweenRef.current?.destroy();
      bandChromeTweenRef.current?.destroy();
    };
  }, []);

  // Card scale preference
  const { cardScale, zoomIn, zoomOut, resetScale, MIN_SCALE, MAX_SCALE, STEP, setCardScale } = useCardScale();

  // Four-tier card dimensions (scaled)
  const rawMain = mpLayout?.mainCard ?? { cardWidth: 0, cardHeight: 0 };
  const cardWidth = Math.round(rawMain.cardWidth * cardScale);
  const cardHeight = Math.round(rawMain.cardHeight * cardScale);
  const rawLob = mpLayout?.lobCard ?? { cardWidth: 0, cardHeight: 0 };
  const lobCard = { cardWidth: Math.round(rawLob.cardWidth * cardScale), cardHeight: Math.round(rawLob.cardHeight * cardScale) };
  const rawOppHand = mpLayout?.opponentHandCard ?? { cardWidth: 0, cardHeight: 0 };
  const oppHandCard = { cardWidth: Math.round(rawOppHand.cardWidth * cardScale), cardHeight: Math.round(rawOppHand.cardHeight * cardScale) };
  const pileCardWidth = Math.round((mpLayout?.pileCard.cardWidth ?? 0) * cardScale);
  const pileCardHeight = Math.round((mpLayout?.pileCard.cardHeight ?? 0) * cardScale);

  const myZones: Record<string, ZoneRect> = useMemo(() => {
    if (!mpLayout) return {};
    return {
      territory: mpLayout.zones.playerTerritory,
      'land-of-bondage': mpLayout.zones.playerLob,
      'land-of-redemption': mpLayout.sidebar.player.lor!,
      banish: mpLayout.sidebar.player.banish!,
      reserve: mpLayout.sidebar.player.reserve!,
      deck: mpLayout.sidebar.player.deck!,
      discard: mpLayout.sidebar.player.discard!,
    };
  }, [mpLayout]);

  const opponentZones: Record<string, ZoneRect> = useMemo(() => {
    if (!mpLayout) return {};
    return {
      territory: mpLayout.zones.opponentTerritory,
      'land-of-bondage': mpLayout.zones.opponentLob,
      'land-of-redemption': mpLayout.sidebar.opponent.lor!,
      banish: mpLayout.sidebar.opponent.banish!,
      reserve: mpLayout.sidebar.opponent.reserve!,
      deck: mpLayout.sidebar.opponent.deck!,
      discard: mpLayout.sidebar.opponent.discard!,
    };
  }, [mpLayout]);

  const myHandRect = mpLayout?.zones.playerHand ?? null;
  const opponentHandRect = mpLayout?.zones.opponentHand ?? null;

  // Player-hand card dimensions: capped so the card bottom always stays
  // above the floating toolbar reserve. On narrow viewports the mainCard
  // height can exceed the hand zone's usable height, which would push card
  // bottoms (e.g. Judas's alignment line) under the toolbar.
  //
  // Touch has nothing to reserve for: the toolbar collapses to a small button
  // pinned bottom-LEFT while the hand fans from the band's centre. Paying the
  // 48 virtual px anyway squeezed hand cards to ~37 screen px wide -- under
  // the touch target floor, on the surface used every single turn.
  const handToolbarReserve = useCompactLayout ? 0 : HAND_TOOLBAR_RESERVE;

  const { handCardWidth, handCardHeight } = useMemo(() => {
    if (!myHandRect) return { handCardWidth: cardWidth, handCardHeight: cardHeight };
    const usableHeight = Math.max(0, myHandRect.height - handToolbarReserve);
    if (cardHeight <= usableHeight) return { handCardWidth: cardWidth, handCardHeight: cardHeight };
    const aspect = cardHeight / Math.max(cardWidth, 1);
    const cappedH = Math.max(0, Math.round(usableHeight));
    const cappedW = Math.max(0, Math.round(cappedH / aspect));
    return { handCardWidth: cappedW, handCardHeight: cappedH };
  }, [myHandRect, cardWidth, cardHeight, handToolbarReserve]);

  // ---- LOB arrival glow + Lost Soul "deal" animation ----
  const myLobIds = useMemo(
    () => (myCards['land-of-bondage'] ?? []).map(c => String(c.id)),
    [myCards],
  );
  const oppLobIds = useMemo(
    () => (opponentCards['land-of-bondage'] ?? []).map(c => String(c.id)),
    [opponentCards],
  );

  // ---- "The deal" — flying-card animation when my cards move deck → hand ----
  // (turn-start auto-draw, Draw button, draw N/bottom/random.) Snapshot is
  // id+zone only; diffing happens inside the hook.
  const myCardZoneSnapshot = useMemo(() => {
    const flat: { id: string; zone: string }[] = [];
    for (const [zone, zoneCards] of Object.entries(myCards)) {
      for (const c of zoneCards) flat.push({ id: String(c.id), zone });
    }
    return flat;
  }, [myCards]);
  // Opening-hand deal: fires once when the pregame begins (hands are dealt
  // server-side at create/join, so the rows are already in the client cache;
  // the deal plays under the dice-roll overlay). The 'playing' branch covers a
  // canvas that mounts moments after start; the same key value across
  // pregame → playing means it can't fire twice. Later reloads/reconnects get
  // null — no replay.
  const openingDealKey = useMemo(() => {
    const g = gameState.game;
    if (!g) return null;
    if (g.status === 'pregame') return `opening-${String(g.id)}`;
    if (g.status !== 'playing') return null;
    const startedMicros = g.playingStartedAtMicros ?? 0n;
    if (startedMicros === 0n) return null;
    const startedMs = Number(startedMicros / 1000n);
    return Date.now() - startedMs < 20_000 ? `opening-${String(g.id)}` : null;
  }, [gameState.game]);
  const {
    deals: activeDeals,
    dealingIds,
    glowIds: dealGlowIds,
    completeDeal,
  } = useDealAnimation(myCardZoneSnapshot, viewerKind !== 'spectator', openingDealKey);

  // Opponent's draws get the same deal — card backs flying from their deck
  // pile to their hand strip. No face image ever (hidden info), no glow (their
  // strip renders plain backs).
  const oppCardZoneSnapshot = useMemo(() => {
    const flat: { id: string; zone: string }[] = [];
    for (const [zone, zoneCards] of Object.entries(opponentCards)) {
      for (const c of zoneCards) flat.push({ id: String(c.id), zone });
    }
    return flat;
  }, [opponentCards]);
  const {
    deals: oppActiveDeals,
    dealingIds: oppDealingIds,
    completeDeal: completeOppDeal,
  } = useDealAnimation(oppCardZoneSnapshot, viewerKind !== 'spectator', openingDealKey);

  // Gate detection until the subscription has applied AND we know who the
  // local player is — otherwise the initial SpacetimeDB push of pre-existing
  // LOB souls would register as "new arrivals" on game load / reconnect.
  const soulsHydrated = !gameState.isLoading && !!gameState.myPlayer;

  // Only Lost Souls fly; other LOB arrivals (attached sites) keep the plain glow.
  const myLobSoulIds = useMemo(
    () => (myCards['land-of-bondage'] ?? []).filter(isLostSoulCard).map(c => String(c.id)),
    [myCards],
  );
  const oppLobSoulIds = useMemo(
    () => (opponentCards['land-of-bondage'] ?? []).filter(isLostSoulCard).map(c => String(c.id)),
    [opponentCards],
  );
  // id → display name, for the summarizing toast.
  const lobSoulNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of (myCards['land-of-bondage'] ?? [])) m.set(String(c.id), c.cardName);
    for (const c of (opponentCards['land-of-bondage'] ?? [])) m.set(String(c.id), c.cardName);
    return m;
  }, [myCards, opponentCards]);

  const fireSoulToast = useCallback((newIds: string[]) => {
    if (newIds.length === 1) {
      const name = simplifyLostSoulName(lobSoulNameById.get(newIds[0]) ?? 'Lost Soul');
      showGameToast(`Lost Soul dealt: ${name}`);
    } else if (newIds.length > 1) {
      showGameToast(`${newIds.length} Lost Souls dealt`);
    }
  }, [lobSoulNameById]);

  // Deck-source ids gate the deal: a soul only flies from the deck if it was in
  // the deck last frame (a draw/route), not dragged in from hand/reserve/etc.
  const myDeckIds = useMemo(
    () => (myCards['deck'] ?? []).map(c => String(c.id)),
    [myCards],
  );
  const oppDeckIds = useMemo(
    () => (opponentCards['deck'] ?? []).map(c => String(c.id)),
    [opponentCards],
  );
  const { inFlight: myDeals, onLand: onMyLand } =
    useLostSoulDeals(myLobSoulIds, myDeckIds, soulsHydrated, fireSoulToast);
  const { inFlight: oppDeals, onLand: onOppLand } =
    useLostSoulDeals(oppLobSoulIds, oppDeckIds, soulsHydrated, fireSoulToast);

  // Route the glow to *visible* ids: a soul in flight is excluded until it lands,
  // so the amber glow fires on landing rather than on server placement.
  const myVisibleLobIds = useMemo(
    () => myLobIds.filter(id => !myDeals.has(id)),
    [myLobIds, myDeals],
  );
  const oppVisibleLobIds = useMemo(
    () => oppLobIds.filter(id => !oppDeals.has(id)),
    [oppLobIds, oppDeals],
  );
  const { getGlowIntensity: getMyLobGlow } = useLobArrivalEffect(myVisibleLobIds);
  const { getGlowIntensity: getOppLobGlow } = useLobArrivalEffect(oppVisibleLobIds);

  // Paragon: souls live in the shared LOB and fly from the shared Soul Deck.
  // (The old cinematic never fired here, so this is new arrival feedback; the
  // shared LOB has no glow today and we keep it that way — deal + toast is the
  // signal.)
  const sharedLobSoulIds = useMemo(
    () => (sharedCards['land-of-bondage'] ?? []).filter(isLostSoulCard).map(c => String(c.id)),
    [sharedCards],
  );
  const sharedDeckIds = useMemo(
    () => (sharedCards['soul-deck'] ?? []).map(c => String(c.id)),
    [sharedCards],
  );
  const { inFlight: sharedDeals, onLand: onSharedLand } =
    useLostSoulDeals(sharedLobSoulIds, sharedDeckIds, soulsHydrated, (newIds) => {
      if (newIds.length === 1) {
        const c = (sharedCards['land-of-bondage'] ?? []).find(x => String(x.id) === newIds[0]);
        showGameToast(`Lost Soul dealt: ${simplifyLostSoulName(c?.cardName ?? 'Lost Soul')}`);
      } else if (newIds.length > 1) {
        showGameToast(`${newIds.length} Lost Souls dealt`);
      }
    });

  // ---- Hand → play prompt for cards with `set_card_outline` abilities ----
  // Three Woes is the v1 target. The choice routes through the same
  // executeCardAbility flow that powers the right-click menu.
  const cardsForChoicePrompt = useMemo(() => {
    const list: { instanceId: string; cardName: string; zone: string }[] = [];
    for (const cards of Object.values(myCards)) {
      for (const c of cards) {
        if (c.isToken) continue;
        list.push({ instanceId: String(c.id), cardName: c.cardName, zone: c.zone });
      }
    }
    return list;
  }, [myCards]);
  useCardEnterPlayPrompt({
    cards: cardsForChoicePrompt,
    onChoose: (instanceId, abilityIndex) =>
      gameState.executeCardAbility(instanceId, abilityIndex),
  });

  // Drive 1s re-renders while any visible card has an active per-card reveal.
  // Hand reveals (own and opponent) flip back at expiry; reserve top reveals
  // (e.g. Herod's Temple) need the same tick so the opponent's face flip and
  // the countdown ring update without a server message.
  const anyHandActiveReveal = useMemo(() => {
    const nowMicros = BigInt(Date.now()) * 1000n;
    const hasActive = (cards: readonly { zone: string; revealExpiresAt?: { microsSinceUnixEpoch: bigint } }[]) =>
      cards.some(c =>
        (c.zone === 'hand' || c.zone === 'reserve')
        && c.revealExpiresAt !== undefined
        && c.revealExpiresAt.microsSinceUnixEpoch > nowMicros,
      );
    return hasActive(myCards['hand'] ?? [])
      || hasActive(opponentCards['hand'] ?? [])
      || hasActive(myCards['reserve'] ?? [])
      || hasActive(opponentCards['reserve'] ?? []);
    // myCards/opponentCards identities update on each server tick, so this
    // re-computes when reveals arrive or expire.
  }, [myCards, opponentCards]);
  useRevealTick(anyHandActiveReveal);

  const myHandBrigadeCounts = useMemo(() => {
    // In spectator mode, only reveal brigade counts when the player has
    // explicitly shared their hand; otherwise return empty to avoid leaking
    // card-face data indirectly.
    if (viewerKind === 'spectator' && !gameState.myPlayer?.shareHandWithSpectators) {
      return { total: 0, good: 0, evil: 0, neutral: 0 };
    }
    return computeHandBrigades(
      (myCards['hand'] ?? []).map(c => ({
        cardName: c.cardName,
        brigade: c.brigade,
        alignment: c.alignment,
        type: c.cardType,
      })),
    );
  }, [myCards, viewerKind, gameState.myPlayer?.shareHandWithSpectators]);

  // Opponent brigade counts — only meaningful when their hand is revealed to
  // me, and only over cards captured in the reveal snapshot (cards drawn
  // after reveal stay face-down and must NOT leak into this count).
  const opponentHandRevealed = gameState.opponentPlayer?.handRevealed ?? false;
  const opponentHandRevealSnapshotRaw = gameState.opponentPlayer?.handRevealSnapshot;
  const opponentHandBrigadeCounts = useMemo(() => {
    // In spectator mode, only reveal brigade counts when the opponent has
    // explicitly shared their hand.
    if (viewerKind === 'spectator') {
      if (!gameState.opponentPlayer?.shareHandWithSpectators) {
        return { total: 0, good: 0, evil: 0, neutral: 0 };
      }
      return computeHandBrigades(
        (opponentCards['hand'] ?? []).map(c => ({
          cardName: c.cardName,
          brigade: c.brigade,
          alignment: c.alignment,
          type: c.cardType,
        })),
      );
    }
    if (!opponentHandRevealed) return { total: 0, good: 0, evil: 0, neutral: 0 };
    const snapshot = new Set<string>();
    try {
      if (opponentHandRevealSnapshotRaw) {
        const ids = JSON.parse(opponentHandRevealSnapshotRaw);
        if (Array.isArray(ids)) for (const id of ids) snapshot.add(String(id));
      }
    } catch { /* ignore malformed snapshot */ }
    const visible = (opponentCards['hand'] ?? []).filter(c => snapshot.has(String(c.id)));
    return computeHandBrigades(
      visible.map(c => ({
        cardName: c.cardName,
        brigade: c.brigade,
        alignment: c.alignment,
        type: c.cardType,
      })),
    );
  }, [opponentCards, opponentHandRevealed, opponentHandRevealSnapshotRaw, viewerKind, gameState.opponentPlayer?.shareHandWithSpectators]);

  // ---- Reserve privacy for spectators ----
  // A player's reserve (its top-card face and the click-to-browse modal) becomes
  // visible to spectators when that player either reveals their reserve (the 👁
  // toggle — a public game action, already shown to the opponent) or shares their
  // hand with spectators. Spectators open the reserve read-only (no actions; see
  // readOnly on ZoneBrowseModal). Player-side rules are unchanged: a player always
  // sees their own reserve, and an opponent's reserve stays gated by reserveRevealed.
  const myShareHand = gameState.myPlayer?.shareHandWithSpectators ?? false;
  const oppShareHand = gameState.opponentPlayer?.shareHandWithSpectators ?? false;
  const canViewMyReserve =
    !isSpectator || myShareHand || (gameState.myPlayer?.reserveRevealed ?? false);
  const canViewOppReserve = isSpectator
    ? (oppShareHand || (gameState.opponentPlayer?.reserveRevealed ?? false))
    : (gameState.opponentPlayer?.reserveRevealed ?? false);

  /** Face visibility for the DOM browse surfaces (zone grids, card reader).
   *  The Konva board gates faces per-node at render time, but the grids render
   *  straight from zone data — for a spectator, "my" zones are seat-0's
   *  PRIVATE data, so the same consent rules have to be answered here too.
   *  True = render a card back and never open a reader for it. */
  const isCardFaceHiddenFromViewer = useCallback((card: GameCard): boolean => {
    const revealedNow = typeof card.revealUntil === 'number' && card.revealUntil > Date.now();
    if (revealedNow) return false;
    if (card.zone === 'hand') {
      if (!isSpectator) return card.ownerId !== 'player1';
      const owner = card.ownerId === 'player1' ? gameState.myPlayer : gameState.opponentPlayer;
      if (!owner) return true;
      if (owner.shareHandWithSpectators === true) return false;
      try {
        const snapshot = (JSON.parse(owner.handRevealSnapshot || '[]') as unknown[]).map(String);
        return !snapshot.includes(card.instanceId);
      } catch {
        return true;
      }
    }
    if (!card.isFlipped) return false;
    return !isFaceDownInPlayCardVisible(
      isSpectator ? 'spectator' : 'player',
      card.ownerId,
      { myShareHand, oppShareHand },
    );
  }, [isSpectator, gameState.myPlayer, gameState.opponentPlayer, myShareHand, oppShareHand]);

  // ---- Stage ref ----
  const stageRef = useRef<Konva.Stage>(null);
  const gameLayerRef = useRef<Konva.Layer>(null);

  // Prevent browser-native drag on the canvas container
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const container = stage.container();
    const preventDrag = (e: Event) => e.preventDefault();
    container.addEventListener('dragstart', preventDrag);
    container.addEventListener('dragover', preventDrag);
    container.style.userSelect = 'none';
    container.style.webkitUserSelect = 'none';
    container.style.cursor = 'default';
    return () => {
      container.removeEventListener('dragstart', preventDrag);
      container.removeEventListener('dragover', preventDrag);
    };
  }, []);

  // Image preloading lives on the parent (GameInner in client.tsx) so the
  // cache survives canvas remounts at lifecycle transitions. This component
  // reads the cache via the `getImage` prop.

  // Re-render once card back image loads
  const [, setCardBackVersion] = useState(0);
  useEffect(() => {
    if (cardBackLoaded) return;
    const onLoad = () => setCardBackVersion((v) => v + 1);
    cardBackListeners.push(onLoad);
    return () => {
      const idx = cardBackListeners.indexOf(onLoad);
      if (idx >= 0) cardBackListeners.splice(idx, 1);
    };
  }, []);

  // Soul Deck back image (Paragon-only). Load once; re-render when ready.
  const soulDeckBackRef = useRef<HTMLImageElement | null>(null);
  const [soulDeckBackReady, setSoulDeckBackReady] = useState(false);
  useEffect(() => {
    if (normalizedFormat !== 'Paragon') return;
    if (soulDeckBackRef.current) return;
    const img = new window.Image();
    img.onload = () => {
      soulDeckBackRef.current = img;
      setSoulDeckBackReady(true);
    };
    img.src = SOUL_DECK_BACK_IMG;
  }, [normalizedFormat]);

  // Star of David badge art (Pre-Game star cue). Same load-once idiom as the
  // Soul Deck back above; the badge simply doesn't draw until it's ready.
  const starIconRef = useRef<HTMLImageElement | null>(null);
  const [starIconReady, setStarIconReady] = useState(false);
  useEffect(() => {
    if (starIconRef.current) return;
    const img = new window.Image();
    img.onload = () => {
      starIconRef.current = img;
      setStarIconReady(true);
    };
    img.src = STAR_OF_DAVID_IMG;
  }, []);

  // ---- Hover state ----
  const [hoveredInstanceId, setHoveredInstanceId] = useState<string | null>(null);
  const [hoveredCard, setHoveredCard] = useState<GameCard | null>(null);
  const [hoverProgress, setHoverProgress] = useState(0);
  const hoverAnimFrameRef = useRef<number | null>(null);
  const hoverStartTimeRef = useRef<number | null>(null);
  const HOVER_DURATION = 250;

  const startHoverAnimation = useCallback(() => {
    if (hoverAnimFrameRef.current) cancelAnimationFrame(hoverAnimFrameRef.current);
    hoverStartTimeRef.current = performance.now();
    const animate = () => {
      const elapsed = performance.now() - hoverStartTimeRef.current!;
      const progress = Math.min(elapsed / HOVER_DURATION, 1);
      setHoverProgress(progress);
      if (progress < 1) {
        hoverAnimFrameRef.current = requestAnimationFrame(animate);
      }
    };
    hoverAnimFrameRef.current = requestAnimationFrame(animate);
  }, []);

  const stopHoverAnimation = useCallback(() => {
    if (hoverAnimFrameRef.current) {
      cancelAnimationFrame(hoverAnimFrameRef.current);
      hoverAnimFrameRef.current = null;
    }
    hoverStartTimeRef.current = null;
    setHoverProgress(0);
  }, []);

  // (Hover → CardPreview context sync moved below findAnyCardById.)

  // ---- Hand spread toggle (fan vs flat) ----
  const { isSpreadHand } = useSpreadHand();

  // ---- Card scale keyboard shortcuts (+/-) ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        zoomOut();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [zoomIn, zoomOut]);

  // ---- Mouse position tracking for hover preview ----
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // Delayed hover — only show preview after 250ms of continuous hover
  const [hoverReady, setHoverReady] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- rAF-throttled mouse-position updates ----
  // Stage pointermove fires 60-120/sec on high-poll mice. Each direct
  // setMousePos triggers a React render across the canvas. Coalesce to one
  // update per animation frame. Hover identity (hoveredInstanceId/hoveredCard)
  // is NOT throttled — it changes once per card crossing, and routing it
  // through a queue creates a stale-closure race with stage mousemove that
  // shows the wrong card highlighted.
  const pendingMousePosRef = useRef<{ x: number; y: number } | null>(null);
  const pendingMousePosFrameRef = useRef<number | null>(null);

  const flushMousePos = useCallback(() => {
    pendingMousePosFrameRef.current = null;
    const p = pendingMousePosRef.current;
    if (!p) return;
    pendingMousePosRef.current = null;
    setMousePos(p);
  }, []);

  const queueMousePos = useCallback((pos: { x: number; y: number }) => {
    pendingMousePosRef.current = pos;
    if (pendingMousePosFrameRef.current == null) {
      pendingMousePosFrameRef.current = requestAnimationFrame(flushMousePos);
    }
  }, [flushMousePos]);

  const cancelPendingMousePos = useCallback(() => {
    if (pendingMousePosFrameRef.current != null) {
      cancelAnimationFrame(pendingMousePosFrameRef.current);
      pendingMousePosFrameRef.current = null;
    }
    pendingMousePosRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (pendingMousePosFrameRef.current != null) {
        cancelAnimationFrame(pendingMousePosFrameRef.current);
      }
    };
  }, []);

  // ---- Selection state (multi-select via marquee) ----
  const {
    selectedIds,
    isSelected,
    isSelectingRef,
    onRectChangeRef,
    startSelectionDrag,
    updateSelectionDrag,
    endSelectionDrag,
    toggleSelect,
    clearSelection,
  } = useSelectionState();

  const selectionRectRef = useRef<Konva.Rect | null>(null);
  const selectionLayerRef = useRef<Konva.Layer | null>(null);

  // Wire up imperative rect updates for the selection marquee
  onRectChangeRef.current = useCallback(
    (rect: { startX: number; startY: number; currentX: number; currentY: number } | null) => {
      const node = selectionRectRef.current;
      const layer = selectionLayerRef.current;
      if (!node || !layer) return;
      if (!rect) {
        node.visible(false);
        layer.batchDraw();
        return;
      }
      const w = Math.abs(rect.currentX - rect.startX);
      const h = Math.abs(rect.currentY - rect.startY);
      if (w < 8 && h < 8) {
        node.visible(false);
        layer.batchDraw();
        return;
      }
      node.visible(true);
      node.x(Math.min(rect.startX, rect.currentX));
      node.y(Math.min(rect.startY, rect.currentY));
      node.width(w);
      node.height(h);
      layer.batchDraw();
    },
    [],
  );

  // ---- Escape key clears selection ----
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedIds.size > 0) {
        clearSelection();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [selectedIds.size, clearSelection]);

  // ---- Context menu state ----
  const [contextMenu, setContextMenu] = useState<{
    card: GameCard; x: number; y: number;
  } | null>(null);
  const contextMenuRef = useRef(contextMenu);
  contextMenuRef.current = contextMenu;

  // ---- Targeting state ----
  // Set by CardContextMenu when the player picks an ability that needs a
  // follow-up card click (e.g. `imitate_lost_soul`). The canvas dims
  // ineligible cards and routes the next eligible click through `onSelect`.
  // Cleared by Esc, the banner's Cancel button, or any eligible card click.
  const [targeting, setTargeting] = useState<TargetingRequest | null>(null);
  const [countPrompt, setCountPrompt] = useState<CountPromptRequest | null>(null);
  const [resurrectReq, setResurrectReq] = useState<{ sourceInstanceId: string; abilityIndex: number } | null>(null);
  // Philip's Daughters. The caster's picker carries the source card; the
  // responder's carries the request id it has to answer. Only one is ever set.
  const [keepOneReq, setKeepOneReq] = useState<
    | { mode: 'caster'; sourceInstanceId: string }
    | { mode: 'responder'; requestId: string; sourceCardName?: string }
    | null
  >(null);
  const [multiCardContextMenu, setMultiCardContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [notePopover, setNotePopover] = useState<{
    cardIds: string[];
    x: number;
    y: number;
    initialValue: string;
  } | null>(null);

  // ---- Zone browse overlay state ----
  const [browseMyZone, setBrowseMyZone] = useState<string | null>(null);
  const [browseOpponentZone, setBrowseOpponentZone] = useState<string | null>(null);
  /** Touch: the "cards in play" sheet, and the full-screen card reader. */
  const [boardBrowseOpen, setBoardBrowseOpen] = useState(false);
  const [readerCard, setReaderCard] = useState<GameCard | null>(null);
  const [browseSharedLob, setBrowseSharedLob] = useState(false);
  /** Touch: the browse sheet's Field of Battle grid (both players' band cards
   *  merged) — the only way to inspect an attacker buried under a blocker. */
  const [browseBattle, setBrowseBattle] = useState(false);
  const [zoneMenu, setZoneMenu] = useState<{ x: number; y: number; spawnX: number; spawnY: number; targetPlayerId?: string } | null>(null);
  const [deckMenu, setDeckMenu] = useState<{ x: number; y: number } | null>(null);
  // Paragon-only: right-click context menu for the shared Soul Deck pile. Shared by
  // both players, so there's no approval flow — handlers dispatch reducers directly.
  const [soulDeckMenu, setSoulDeckMenu] = useState<{ x: number; y: number } | null>(null);
  const [browseSoulDeck, setBrowseSoulDeck] = useState(false);
  const [soulDeckLookState, setSoulDeckLookState] = useState<
    { cardIds: string[]; title: string } | null
  >(null);
  // Public reveal of N soul-deck cards — shows a modal for both players and
  // broadcasts via revealCards. Cards stay in the soul deck until dragged out.
  const [soulDeckPeekState, setSoulDeckPeekState] = useState<
    { cardIds: string[]; title: string } | null
  >(null);
  const [lorMenu, setLorMenu] = useState<{ x: number; y: number } | null>(null);
  const [deckDrop, setDeckDrop] = useState<{ x: number; y: number; cardId: string; batchIds?: string[] } | null>(null);

  // Dragged node left sitting on the deck pile while a deck-drop popup is
  // open. Committing an option discards it (the reducer moves the row into
  // the deck); cancel/exchange glides it back home. Null for popups opened
  // from modal drags — those have no canvas node to hold.
  const deckDropHoldRef = useRef<{ cardId: string; glideBack: () => void; discard: () => void } | null>(null);
  // Deferred group-drag settle (destroy ghost, re-show followers). Scheduled
  // as a microtask at drag end; a deck-pile drop claims it within the same
  // tick so the ghost stack can wait on the pile instead.
  const pendingGroupSettleRef = useRef<(() => void) | null>(null);
  const releaseDeckHold = useCallback((action: 'commit' | 'glide') => {
    const hold = deckDropHoldRef.current;
    deckDropHoldRef.current = null;
    if (!hold) return;
    if (action === 'commit') hold.discard();
    else hold.glideBack();
  }, []);
  // Paragon: drop popup when a card is dragged onto the soul deck pile —
  // lets the player choose top / bottom / shuffle in.
  const [soulDeckDrop, setSoulDeckDrop] = useState<{ x: number; y: number; cardId: string; batchIds?: string[] } | null>(null);
  const pendingBatchRef = useRef<string[] | null>(null);
  const [showDeckSearch, setShowDeckSearch] = useState(false);
  const [peekState, setPeekState] = useState<{ position: 'top' | 'bottom' | 'random'; count: number; cardIds: string[]; source?: { cardName: string } } | null>(null);
  const [lookState, setLookState] = useState<{ count: number; position: 'top' | 'bottom' | 'random' } | null>(null);
  const [exchangeState, setExchangeState] = useState<
    { cardIds: string[]; targetZone: ZoneId } | null
  >(null);
  const exchangeStateRef = useRef<{ cardIds: string[]; targetZone: ZoneId } | null>(null);
  useEffect(() => {
    exchangeStateRef.current = exchangeState;
  }, [exchangeState]);
  const [opponentZoneMenu, setOpponentZoneMenu] = useState<{ x: number; y: number; zone: string; zoneName: string } | null>(null);
  const [opponentDeckMenu, setOpponentDeckMenu] = useState<{ x: number; y: number } | null>(null);
  const [opponentPeekState, setOpponentPeekState] = useState<{ position: 'top' | 'bottom' | 'random'; count: number; cardIds: string[] } | null>(null);
  const [opponentLookState, setOpponentLookState] = useState<{ position: 'top' | 'bottom' | 'random'; count: number } | null>(null);
  const [opponentRevealDismissed, setOpponentRevealDismissed] = useState(false);
  const [opponentRevealSnapshot, setOpponentRevealSnapshot] = useState<string[]>([]);
  // Spectator-only: the seat-0 player's public reveal. Seated players see their
  // own reveal via the interactive peekState modal, so this mirror renders only
  // for spectators (gated at render time), giving them both seats' reveals.
  const [myRevealDismissed, setMyRevealDismissed] = useState(false);
  const [myRevealSnapshot, setMyRevealSnapshot] = useState<string[]>([]);
  const [handMenu, setHandMenu] = useState<{ x: number; y: number } | null>(null);
  const [opponentHandMenu, setOpponentHandMenu] = useState<{ x: number; y: number } | null>(null);
  const [reserveMenu, setReserveMenu] = useState<{ x: number; y: number } | null>(null);
  const [opponentReserveMenu, setOpponentReserveMenu] = useState<{ x: number; y: number } | null>(null);
  const revealAutoHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [revealBarShrinking, setRevealBarShrinking] = useState(false);

  // Per-card props derived from the active targeting request. Spread onto every
  // GameCardNode render site so ineligible cards dim and eligible cards route
  // their next click through `targeting.onSelect`.
  const getTargetingProps = useCallback((card: GameCard) => {
    if (!targeting) return undefined as undefined | { isDimmed: boolean; targetingMode: { isEligible: boolean; onSelect: () => void } };
    const isEligible = targeting.isEligible(card);
    return {
      isDimmed: !isEligible,
      targetingMode: {
        isEligible,
        onSelect: () => {
          targeting.onSelect(card.instanceId);
          setTargeting(null);
        },
      },
    };
  }, [targeting]);

  // ---- Report search/browse modal open state to parent (for timer pause) ----
  useEffect(() => {
    if (!onSearchModalChange) return;
    const anyModalOpen = showDeckSearch ||
      browseMyZone !== null ||
      browseOpponentZone !== null ||
      peekState !== null ||
      exchangeState !== null ||
      opponentPeekState !== null ||
      opponentLookState !== null ||
      browseSoulDeck ||
      soulDeckLookState !== null ||
      soulDeckPeekState !== null ||
      (approvedSearchRequest != null &&
        !approvedSearchRequest.action &&
        approvedSearchRequest.zone !== 'hand-reveal' &&
        approvedSearchRequest.zone !== 'action-priority' &&
        approvedSearchRequest.zone !== 'initiative');
    onSearchModalChange(anyModalOpen);
  }, [
    onSearchModalChange,
    showDeckSearch,
    browseMyZone,
    browseOpponentZone,
    peekState,
    exchangeState,
    opponentPeekState,
    opponentLookState,
    browseSoulDeck,
    soulDeckLookState,
    soulDeckPeekState,
    approvedSearchRequest,
  ]);

  // ---- Turn 1 reserve protection ----
  // On each player's first turn, cards should not leave the reserve zone.
  // We show a gentle confirmation dialog instead of hard-blocking.
  // afterDismiss runs once the dialog closes (either confirm or cancel) and is
  // used by the opponent-reserve flow to defer completing the ZoneSearchRequest
  // until the user has decided — otherwise the request is deleted by the modal's
  // auto-close-on-drag-end before `execute` runs and the server rejects the move.
  // message/confirmLabel let callers (e.g. the Darius' Decree reserve-discard
  // ability) reuse this dialog with their own reminder wording. Both default to
  // the reserve-drag copy when omitted.
  type PendingReserveMove =
    | { kind: 'single'; execute: () => void; afterDismiss?: () => void; message?: React.ReactNode; confirmLabel?: string }
    | { kind: 'batch'; execute: () => void; afterDismiss?: () => void; message?: React.ReactNode; confirmLabel?: string };
  const [pendingReserveMove, setPendingReserveMove] = useState<PendingReserveMove | null>(null);

  // When set, the opponent browse modal's onClose should NOT immediately call
  // completeZoneSearch — it should hand the close opts off to afterDismiss so
  // the search request stays valid until the user resolves the dialog.
  const deferOpponentSearchCompleteRef = useRef<{
    reqId: bigint;
    storeOpts: (opts?: { shuffled?: boolean }) => void;
  } | null>(null);

  const dismissPendingReserveMove = useCallback(
    (move: PendingReserveMove, execute: boolean) => {
      if (execute) move.execute();
      move.afterDismiss?.();
      setPendingReserveMove(null);
    },
    [],
  );

  // A player is "still on their first turn" until they log an END_TURN action.
  // Don't gate on whose turn it currently is — players can drag reserve cards
  // while it's the opponent's turn (e.g. when seat 1 acts during seat 0's
  // first turn before seat 1 has had any turn at all). The reserve restriction
  // should fire any time the dragger hasn't yet completed their first turn.
  const isMyFirstTurn = useMemo(() => {
    const { game, myPlayer, gameActions } = gameState;
    if (!game || !myPlayer) return false;
    return !gameActions.some(
      (a) => a.playerId === myPlayer.id && a.actionType === 'END_TURN',
    );
  }, [gameState]);

  const isOpponentFirstTurn = useMemo(() => {
    const { game, opponentPlayer, gameActions } = gameState;
    if (!game || !opponentPlayer) return false;
    return !gameActions.some(
      (a) => a.playerId === opponentPlayer.id && a.actionType === 'END_TURN',
    );
  }, [gameState]);

  // Allow ESC to dismiss the reserve protection dialog.
  useEffect(() => {
    if (!pendingReserveMove) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissPendingReserveMove(pendingReserveMove, false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingReserveMove, dismissPendingReserveMove]);

  // Skip reserve protection in goldfish/practice mode (no opponent)
  const hasOpponent = !!gameState.opponentPlayer;

  /** Look up a card instance by its string ID across my cards. */
  const findMyCardById = useCallback((id: string): CardInstance | undefined => {
    for (const cards of Object.values(myCards)) {
      const found = cards.find(c => String(c.id) === id);
      if (found) return found;
    }
    return undefined;
  }, [myCards]);

  /** Look up a card instance by its string ID across both players' cards and shared zones. */
  const findAnyCardById = useCallback((id: string): CardInstance | undefined => {
    for (const cards of Object.values(myCards)) {
      const found = cards.find(c => String(c.id) === id);
      if (found) return found;
    }
    for (const cards of Object.values(opponentCards)) {
      const found = cards.find(c => String(c.id) === id);
      if (found) return found;
    }
    for (const cards of Object.values(sharedCards)) {
      const found = cards.find(c => String(c.id) === id);
      if (found) return found;
    }
    return undefined;
  }, [myCards, opponentCards, sharedCards]);
  // Render-fresh mirror of findAnyCardById for handleCardDragEnd's
  // synchronous stale-row check. On the destroy-path dragend (server moved
  // the dragged row cross-zone → react-konva unmounts the node in the
  // commit's mutation phase → Konva fires dragend synchronously), the
  // deleted fiber never received a prop update, so the event runs the
  // PREVIOUS commit's handleCardDragEnd closure — whose captured
  // findAnyCardById still sees the card in its source zone, defeating the
  // check. This render-body assignment lands during the render phase, i.e.
  // BEFORE that same commit's mutation phase, so reading through the ref
  // always yields the zone data of the update that triggered the destroy.
  // (Same pattern as rawBattleActiveRef above.)
  const findAnyCardByIdRef = useRef(findAnyCardById);
  findAnyCardByIdRef.current = findAnyCardById;

  // ---- REG Pre-Game Phase (star reveals, then Lost Soul activation) ----
  // These sub-steps run with game.status === 'playing', so pregamePhase — not
  // status — is what identifies them.
  const pregameStep: 'stars' | 'souls' | undefined =
    gameState.game?.pregamePhase === 'stars' ? 'stars'
    : gameState.game?.pregamePhase === 'souls' ? 'souls'
    : undefined;

  const myPregameWindow =
    !!gameState.pregameState && !!gameState.myPlayer &&
    gameState.pregameState.activeSeat === gameState.myPlayer.seat;

  // Star detection reads each row's OWN specialAbility, never findCard() —
  // Forge cards are absent from the public card index.
  const myHandStars = useMemo(() => (myCards['hand'] ?? [])
    .filter(c => isStarAbilityText(c.specialAbility))
    .map(c => ({
      instanceId: c.id, cardName: c.cardName, imitatingName: c.imitatingName,
    })), [myCards]);

  const myActivatableSouls = useMemo(() => (myCards['land-of-bondage'] ?? [])
    .filter(c => (c.specialAbility ?? '') !== '')
    .map(c => ({ instanceId: c.id, cardName: c.cardName })),
    [myCards]);

  const activeStarQueue = useMemo(() => {
    const seat = gameState.pregameState?.activeSeat;
    if (seat === undefined) return [];
    return (gameState.pregameStars ?? [])
      .filter((s: PregameStar) => s.seat === seat)
      .map((s: PregameStar) => {
        const card = findAnyCardById(String(s.cardInstanceId));
        return {
          starId: s.id, cardInstanceId: s.cardInstanceId, resolved: s.resolved,
          cardName: card?.cardName ?? '', cardImgFile: card?.cardImgFile ?? '',
          imitatingName: card?.imitatingName,
        };
      });
  }, [gameState.pregameState, gameState.pregameStars, findAnyCardById]);

  // The server rejects a second submission per seat, so any row of mine means
  // my selection window is closed and the resolve queue is what's live.
  const mySeatForPregame = gameState.myPlayer?.seat;
  const myStarsSubmitted = useMemo(
    () => mySeatForPregame !== undefined &&
      (gameState.pregameStars ?? []).some((s: PregameStar) => s.seat === mySeatForPregame),
    [gameState.pregameStars, mySeatForPregame],
  );

  // My star-selection window is open. One gate for all three surfaces it
  // drives: the click-to-pick intercept, the on-card eligibility marker, and
  // the order badges.
  const starWindowOpen =
    !isSpectator && pregameStep === 'stars' && myPregameWindow && !myStarsSubmitted;

  // The star cards I've clicked in hand, in pick order. Lives here rather than
  // inside PregameRail because both the hand's Konva order badges and the
  // rail's submit button read the same list.
  const [starPicks, setStarPicks] = useState<bigint[]>([]);

  const toggleStarPick = useCallback((id: bigint) => {
    setStarPicks(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  // Drop picks for cards that have left my hand (dragged out, moved by an
  // ability) so a stale id can never reach the submit reducer.
  const starPickOrder = useMemo(() => {
    if (starPicks.length === 0) return starPicks;
    const inHand = new Set(myHandStars.map(c => c.instanceId));
    return starPicks.filter(id => inHand.has(id));
  }, [starPicks, myHandStars]);

  // Clear the list whenever the selection window isn't open — after submitting,
  // when the window passes to the opponent, and when the pre-game ends.
  useEffect(() => {
    if (pregameStep === 'stars' && myPregameWindow && !myStarsSubmitted) return;
    setStarPicks(prev => (prev.length === 0 ? prev : []));
  }, [pregameStep, myPregameWindow, myStarsSubmitted]);

  // Propagate hoveredCard to the shared CardPreview context (drives CardLoupePanel).
  // Resolve the live card (by instanceId) from the current zone data so fields like
  // `notes` stay fresh while the mouse is still hovering.
  const liveHoveredNotes = hoveredCard
    ? findAnyCardById(hoveredCard.instanceId)?.notes ?? hoveredCard.notes
    : '';
  useEffect(() => {
    if (hoveredCard) {
      setPreviewCard({
        cardName: hoveredCard.cardName,
        cardImgFile: hoveredCard.cardImgFile,
        isMeek: hoveredCard.isMeek,
        notes: liveHoveredNotes,
      });
    }
  }, [hoveredCard, liveHoveredNotes, setPreviewCard]);

  /**
   * Check if a move should be intercepted by the Turn 1 reserve protection rule.
   * Returns true if the move was intercepted (dialog shown), false if it should proceed.
   */
  const checkReserveProtection = useCallback((
    fromZone: string | undefined,
    toZone: string,
    execute: () => void,
  ): boolean => {
    if (!isMyFirstTurn || !hasOpponent) return false;
    if (fromZone !== 'reserve' || toZone === 'reserve') return false;
    setPendingReserveMove({ kind: 'single', execute });
    return true;
  }, [isMyFirstTurn, hasOpponent]);

  /**
   * Check if a batch move contains any cards leaving the reserve on Turn 1.
   * Returns true if intercepted.
   */
  const checkReserveBatchProtection = useCallback((
    cardIds: string[],
    toZone: string,
    execute: () => void,
  ): boolean => {
    if (!isMyFirstTurn || !hasOpponent) return false;
    if (toZone === 'reserve') return false;
    const anyFromReserve = cardIds.some(id => {
      const card = findMyCardById(id);
      return card?.zone === 'reserve';
    });
    if (!anyFromReserve) return false;
    setPendingReserveMove({ kind: 'batch', execute });
    return true;
  }, [isMyFirstTurn, hasOpponent, findMyCardById]);

  // ---- Multiplayer GameActions adapter ----
  // Wraps moveCard/moveCardsBatch with Turn 1 reserve protection and undo tracking.
  const multiplayerActions: GameActions = useMemo(() => ({
    moveCard: (cardId, toZone, posX, posY) => {
      const card = findMyCardById(cardId);
      const fromZone = card?.zone;
      const execute = () => {
        // Record undo entry before executing. This path never reassigns
        // ownership (no targetOwnerId on the forward move), so the post-move
        // owner equals the pre-move owner.
        if (undoStack && card && fromZone && fromZone !== toZone) {
          const ownerId = String(card.ownerId);
          const captured: Captured = {
            cardId,
            fromZone,
            prevOwnerId: ownerId,
            posX: card.posX,
            posY: card.posY,
          };
          undoStack.push({
            description: `Moved ${card.cardName || 'card'} to ${toZone}`,
            reverseAction: makeReverseAction({ captured, lookup: lookupForUndo, move: undoMove }),
          });
        }
        gameState.moveCard(BigInt(cardId), toZone, undefined, posX, posY);
      };
      if (checkReserveProtection(fromZone, toZone, execute)) return;
      execute();
    },
    moveCardsBatch: (cardIds, toZone) => {
      const execute = () => {
        // Record undo entry: reverse each card back to its original zone + owner.
        // Guard per card; restore only the cards still where this batch left them.
        if (undoStack && cardIds.length > 0) {
          const captured = cardIds.flatMap((id): Array<{ captured: Captured; name?: string }> => {
            const card = findMyCardById(id);
            if (!card || card.zone === toZone) return [];
            const ownerId = String(card.ownerId);
            return [{
              name: card.cardName,
              captured: {
                cardId: id,
                fromZone: card.zone,
                prevOwnerId: ownerId,
                posX: card.posX,
                posY: card.posY,
              },
            }];
          });
          if (captured.length > 0) {
            const desc = captured.length === 1
              ? `Moved ${captured[0].name || 'card'} to ${toZone}`
              : `Moved ${captured.length} cards to ${toZone}`;
            undoStack.push({
              description: desc,
              reverseAction: makeBatchReverseAction({
                items: captured.map(c => c.captured),
                lookup: lookupForUndo,
                move: undoMove,
              }),
            });
          }
        }
        gameState.moveCardsBatch(JSON.stringify(cardIds), toZone);
      };
      if (checkReserveBatchProtection(cardIds, toZone, execute)) return;
      execute();
    },
    flipCard: (cardId) => {
      // Flip is a toggle — reverse is just flip again
      if (undoStack) {
        const card = findMyCardById(cardId);
        undoStack.push({
          description: `Flipped ${card?.cardName || 'card'}`,
          reverseAction: () => {
            if (!lookupForUndo(cardId)) return false; // card gone → refuse
            gameState.flipCard(BigInt(cardId));
            return true;
          },
        });
      }
      gameState.flipCard(BigInt(cardId));
    },
    revealCardInHand: (cardId) => {
      // Re-clicking already resets the timer — undo entry would add more
      // confusion than value, so skip it.
      gameState.revealCardInHand(BigInt(cardId));
    },
    meekCard: (cardId) => {
      if (undoStack) {
        const card = findMyCardById(cardId);
        undoStack.push({
          description: `Set ${card?.cardName || 'card'} meek`,
          reverseAction: () => {
            if (!lookupForUndo(cardId)) return false;
            gameState.unmeekCard(BigInt(cardId));
            return true;
          },
        });
      }
      gameState.meekCard(BigInt(cardId));
    },
    unmeekCard: (cardId) => {
      if (undoStack) {
        const card = findMyCardById(cardId);
        undoStack.push({
          description: `Removed meek from ${card?.cardName || 'card'}`,
          reverseAction: () => {
            if (!lookupForUndo(cardId)) return false;
            gameState.meekCard(BigInt(cardId));
            return true;
          },
        });
      }
      gameState.unmeekCard(BigInt(cardId));
    },
    addCounter: (cardId, color) => {
      if (undoStack) {
        const card = findMyCardById(cardId);
        undoStack.push({
          description: `Added ${color} counter to ${card?.cardName || 'card'}`,
          reverseAction: () => {
            if (!lookupForUndo(cardId)) return false;
            gameState.removeCounter(BigInt(cardId), color);
            return true;
          },
        });
      }
      gameState.addCounter(BigInt(cardId), color);
    },
    removeCounter: (cardId, color) => {
      if (undoStack) {
        const card = findMyCardById(cardId);
        undoStack.push({
          description: `Removed ${color} counter from ${card?.cardName || 'card'}`,
          reverseAction: () => {
            if (!lookupForUndo(cardId)) return false;
            gameState.addCounter(BigInt(cardId), color);
            return true;
          },
        });
      }
      gameState.removeCounter(BigInt(cardId), color);
    },
    shuffleCardIntoDeck: (cardId) => {
      if (undoStack) {
        const card = findMyCardById(cardId);
        if (card && card.zone !== 'deck') {
          const ownerId = String(card.ownerId);
          const captured: Captured = {
            cardId, fromZone: card.zone, prevOwnerId: ownerId,
            posX: card.posX, posY: card.posY,
          };
          undoStack.push({
            description: `Shuffled ${card.cardName || 'card'} into deck`,
            reverseAction: makeReverseAction({ captured, lookup: lookupForUndo, move: undoMove }),
          });
        }
      }
      gameState.shuffleCardIntoDeck(BigInt(cardId));
    },
    shuffleDeck: () => gameState.shuffleDeck(),
    setNote: (cardId, text) => gameState.setNote(BigInt(cardId), text),
    exchangeCards: (cardIds) => gameState.exchangeCards(JSON.stringify(cardIds)),
    drawCard: () => gameState.drawCard(),
    drawMultiple: (count) => gameState.drawMultiple(BigInt(count)),
    moveCardToTopOfDeck: (cardId) => {
      if (undoStack) {
        const card = findMyCardById(cardId);
        if (card && card.zone !== 'deck') {
          const ownerId = String(card.ownerId);
          const captured: Captured = {
            cardId, fromZone: card.zone, prevOwnerId: ownerId,
            posX: card.posX, posY: card.posY,
          };
          undoStack.push({
            description: `Moved ${card.cardName || 'card'} to top of deck`,
            reverseAction: makeReverseAction({ captured, lookup: lookupForUndo, move: undoMove }),
          });
        }
      }
      gameState.moveCardToTopOfDeck(BigInt(cardId));
    },
    moveCardToBottomOfDeck: (cardId) => {
      if (undoStack) {
        const card = findMyCardById(cardId);
        if (card) {
          // The card ends up in the deck either way, so the guard checks it is
          // still in 'deck'. When it was already in the deck (e.g. dragged out
          // of a peek/look modal), the reverse sends it back to the top — the
          // position that matches where the user was peeking.
          const fromZone = card.zone;
          const ownerId = String(card.ownerId);
          const captured: Captured = {
            cardId, fromZone, prevOwnerId: ownerId,
            posX: card.posX, posY: card.posY,
          };
          const reverseAction = fromZone === 'deck'
            ? () => {
                if (!reverseIsSafe(lookupForUndo(cardId))) return false;
                gameState.moveCardToTopOfDeck(BigInt(cardId));
                return true;
              }
            : makeReverseAction({ captured, lookup: lookupForUndo, move: undoMove });
          undoStack.push({
            description: `Moved ${card.cardName || 'card'} to bottom of deck`,
            reverseAction,
          });
        }
      }
      gameState.moveCardToBottomOfDeck(BigInt(cardId));
    },
    spawnLostSoul: (testament, posX, posY) =>
      gameState.spawnLostSoul(testament, posX ?? '0.5', posY ?? '0.5'),
    removeToken: (cardId) => gameState.removeToken(BigInt(cardId)),
    removeOpponentToken: undefined,
    executeCardAbility: (sourceInstanceId, abilityIndex) => {
      // Intercept modal-driven abilities (reveal_own_deck) client-side — the
      // server reducer throws SenderError for these. setPeekState → existing
      // useEffect broadcasts via revealCards so the opponent sees the reveal.
      // findAnyCardById (not findMyCardById) so abilities fired on an opponent's
      // card also dispatch client-side — effects route to the local activator.
      const source = findAnyCardById(sourceInstanceId);
      // Use effective abilities so imitated souls' right-click abilities (e.g.
      // Lawless reveal-top-6 on an Imitate) dispatch correctly. Mirrors the
      // server's execute_card_ability dispatcher and the goldfish path.
      // Forge rows blank cardName (leak spine) while the context menu builds
      // its items off the RESOLVED name — so without this the menu offered an
      // ability that then dispatched to nothing. Resolve for the lookup only;
      // the log/broadcast uses below keep the blanked name on purpose.
      const ability = source
        ? getEffectiveAbilities({
            cardName: resolveForgeCardName(source, forgeResolver),
            imitatingName: source.imitatingName,
          })[abilityIndex]
        : undefined;
      // (Star) abilities fired from hand also reveal the source card to
      // opponents/spectators so the implicit "reveal from hand" cost is
      // visible. Reveal duration matches the standard 30s — see
      // reveal_card_in_hand reducer in spacetimedb/src/index.ts.
      const firedFromHand =
        !!source &&
        source.zone === 'hand' &&
        !!ability &&
        ability.type !== 'three_nails_reset';
      if (firedFromHand) {
        gameState.revealCardInHand(BigInt(sourceInstanceId));
      }
      if (ability?.type === 'reveal_own_deck') {
        setPeekState({
          position: ability.position,
          count: ability.count,
          cardIds: sampleDeckCardIds(ability.position, ability.count),
          source: { cardName: source!.cardName },
        });
        return;
      }
      if (ability?.type === 'look_at_own_deck') {
        // Private — no broadcast to opponent. Reuses the existing lookState
        // modal (same DeckPeekModal with isPrivateLook).
        setLookState({
          position: ability.position,
          count: ability.count,
        });
        if (source) {
          gameState.logLookAtTop(ability.count, source.cardName, ability.position);
        }
        return;
      }
      if (ability?.type === 'look_at_opponent_deck') {
        // Requires opponent consent — routes through the existing
        // request_opponent_action flow. On approve, the approvedSearchRequest
        // effect dispatches `look_deck_*` which opens opponentLookState.
        const action =
          ability.position === 'top' ? 'look_deck_top'
          : ability.position === 'bottom' ? 'look_deck_bottom'
          : 'look_deck_random';
        requestOpponentAction(action, JSON.stringify({ count: ability.count }));
        return;
      }
      if (ability?.type === 'reveal_opponent_deck') {
        // Requires opponent consent — routes through the existing
        // request_opponent_action flow. On approve, the approvedSearchRequest
        // effect dispatches `reveal_deck_*` which opens opponentPeekState.
        const action =
          ability.position === 'top' ? 'reveal_deck_top'
          : ability.position === 'bottom' ? 'reveal_deck_bottom'
          : 'reveal_deck_random';
        requestOpponentAction(action, JSON.stringify({ count: ability.count }));
        return;
      }
      if (ability?.type === 'discard_opponent_deck') {
        // Requires opponent consent — routes through the existing
        // request_opponent_action flow. On approve, the approvedSearchRequest
        // effect dispatches `discard_deck_*` which calls
        // moveOpponentDeckCardsToZone(..., 'discard').
        const action =
          ability.position === 'top' ? 'discard_deck_top'
          : ability.position === 'bottom' ? 'discard_deck_bottom'
          : 'discard_deck_random';
        requestOpponentAction(action, JSON.stringify({ count: ability.count }));
        return;
      }
      if (ability?.type === 'three_nails_reset') {
        // Requires opponent consent. On approve, the approvedSearchRequest
        // effect dispatches three_nails_reset_execute. cardName rides along so
        // the approval banner + chat log can name the reset card (Three Nails
        // vs A New Beginning).
        requestOpponentAction(
          'three_nails_reset',
          JSON.stringify({ sourceInstanceId: sourceInstanceId.toString(), cardName: source?.cardName }),
        );
        return;
      }
      if (ability?.type === 'play_all_lost_souls') {
        // Capture pre-move state so undo can restore each Lost Soul to its
        // original zone + owner. Mirrors playAllLostSoulsImpl in the server:
        // per-player, prefer soul-deck (Paragon mode) when non-empty, else
        // main deck.
        if (undoStack) {
          const isLs = (c: { cardType: string; cardName: string }) =>
            c.cardType === 'LS'
            || c.cardType === 'Lost Soul'
            || c.cardName.toLowerCase().includes('lost soul');
          const reverseEntries: Array<{
            id: bigint;
            zone: string;
            ownerId: string;
            posX: string;
            posY: string;
          }> = [];
          for (const playerCards of [myCards, opponentCards]) {
            const soulDeck = playerCards['soul-deck'] ?? [];
            const sourceCards = soulDeck.length > 0
              ? soulDeck
              : (playerCards['deck'] ?? []);
            for (const c of sourceCards) {
              if (!isLs(c)) continue;
              reverseEntries.push({
                id: c.id,
                zone: c.zone,
                ownerId: String(c.ownerId),
                posX: c.posX,
                posY: c.posY,
              });
            }
          }
          if (reverseEntries.length > 0) {
            const sourceName = source?.cardName ?? 'card';
            undoStack.push({
              description: `Played all Lost Souls via ${sourceName}`,
              reverseAction: () => {
                // Guard per soul: only restore souls still sitting in
                // land-of-bondage under the same owner (i.e. still where
                // play_all_lost_souls left them). Refuse entirely if none are.
                const safe = reverseEntries.filter(e =>
                  reverseIsSafe(lookupForUndo(String(e.id))),
                );
                if (safe.length === 0) return false;
                // Group by (ownerId, zone) so each affected deck gets exactly
                // one shuffle. shuffle_card_into_deck routes by
                // originalOwnerId — works for opponent cards without consent —
                // and also reshuffles that owner's whole deck. So for each
                // 'deck' group: moveCard the first N-1 souls back, then use
                // shuffleCardIntoDeck on the final one as the single shuffle
                // trigger. soul-deck groups can't auto-shuffle (no per-player
                // soul-deck shuffle reducer exists), so just moveCard them.
                const groups = new Map<string, typeof reverseEntries>();
                for (const e of safe) {
                  const key = `${e.ownerId}:${e.zone}`;
                  const list = groups.get(key) ?? [];
                  list.push(e);
                  groups.set(key, list);
                }
                for (const list of groups.values()) {
                  if (list[0].zone === 'deck') {
                    for (let i = 0; i < list.length - 1; i++) {
                      const e = list[i];
                      gameState.moveCard(e.id, e.zone, undefined, e.posX, e.posY, e.ownerId);
                    }
                    gameState.shuffleCardIntoDeck(list[list.length - 1].id);
                  } else {
                    for (const e of list) {
                      gameState.moveCard(e.id, e.zone, undefined, e.posX, e.posY, e.ownerId);
                    }
                  }
                }
                return true;
              },
            });
          }
        }
        gameState.executeCardAbility(sourceInstanceId, abilityIndex);
        return;
      }
      if (ability?.type === 'band_heroes_from_deck') {
        // Capture the Heroes the server is about to pull so undo can put them
        // back. Same predicate as bandHeroesFromDeckImpl, over MY deck — the
        // effect always follows the activator, and the activator is us.
        if (undoStack) {
          const ids = (myCards['deck'] ?? [])
            .filter(c => isHeroCard(c) && hasReferenceBook(c.reference, ability.referenceBook))
            .map(c => c.id);
          if (ids.length > 0) {
            const sourceName = source?.cardName ?? 'card';
            undoStack.push({
              description: `Banded ${ids.length} ${ability.referenceBook} Heroes via ${sourceName}`,
              reverseAction: () => {
                // Guard per Hero: skip any that has since been deleted. All
                // share one owner and one destination, so — as in the
                // play_all_lost_souls reverse above — move all but the last
                // with moveCard and let shuffleCardIntoDeck handle the final
                // one, which reshuffles the deck exactly once.
                const safe = ids.filter(id => reverseIsSafe(lookupForUndo(String(id))));
                if (safe.length === 0) return false;
                for (let i = 0; i < safe.length - 1; i++) {
                  gameState.moveCard(safe[i], 'deck');
                }
                gameState.shuffleCardIntoDeck(safe[safe.length - 1]);
                return true;
              },
            });
          }
        }
        gameState.executeCardAbility(sourceInstanceId, abilityIndex);
        return;
      }
      if (ability?.type === 'reserve_opponent_deck') {
        // Same opponent-consent flow as discard_opponent_deck. On approve
        // dispatches `reserve_deck_*` → moveOpponentDeckCardsToZone(..., 'reserve').
        const action =
          ability.position === 'top' ? 'reserve_deck_top'
          : ability.position === 'bottom' ? 'reserve_deck_bottom'
          : 'reserve_deck_random';
        requestOpponentAction(action, JSON.stringify({ count: ability.count }));
        return;
      }
      if (ability?.type === 'draw_brigades') {
        // Draw cards equal to distinct brigades of the given alignment in the
        // opponent's revealed hand (Matthew = total, Ahijah/Hannah/Mighty Men =
        // evil, Damsels/Lying Prophet = good). Count is computed client-side
        // from the live snapshot and capped by the card's printed limit; the
        // server re-validates handRevealed and caps the count defensively.
        if (!opponentHandRevealed) return;
        let count = opponentHandBrigadeCounts[ability.alignment];
        if (ability.limit !== undefined) count = Math.min(count, ability.limit);
        gameState.matthewDrawBrigades(BigInt(sourceInstanceId), BigInt(count));
        return;
      }
      if (ability?.type === 'discard_characters_from_reserve') {
        if (ability.target === 'opponent') {
          // Touches the opponent's cards — route through the opponent-consent
          // flow. On approval, the approvedSearchRequest effect dispatches
          // discard_reserve_characters_execute. The opponent can decline (e.g.
          // when it's their first turn and the reserve should stay locked).
          requestOpponentAction(
            'discard_reserve_characters',
            JSON.stringify({ sourceInstanceId: sourceInstanceId.toString() }),
          );
          return;
        }
        // Self-reserve: fires immediately. Discarding out of your own reserve on
        // your first turn still triggers the Turn 1 reminder dialog.
        const execute = () => gameState.executeCardAbility(sourceInstanceId, abilityIndex);
        if (isMyFirstTurn && hasOpponent) {
          setPendingReserveMove({
            kind: 'single',
            execute,
            message: (
              <>
                Characters typically cannot leave the reserve on{' '}
                <strong style={{ color: 'var(--gf-text-bright, #e8d5a3)' }}>Turn 1</strong>.
                {' '}Discard all characters from your reserve anyway?
              </>
            ),
            confirmLabel: 'Discard Anyway',
          });
          return;
        }
        execute();
        return;
      }
      gameState.executeCardAbility(sourceInstanceId, abilityIndex);
    },
    randomHandToZone: (count, toZone, deckPosition) =>
      gameState.randomHandToZone(count, toZone, deckPosition),
    randomReserveToZone: (count, toZone, deckPosition) =>
      gameState.randomReserveToZone(count, toZone, deckPosition),
    reloadDeck: (deckId, deckData, paragon) => gameState.reloadDeck(deckId, deckData, paragon),
    attachCard: (weaponId, warriorId) => {
      gameState.attachCard(BigInt(weaponId), BigInt(warriorId));
    },
    detachCard: (cardId, posX, posY) => {
      gameState.detachCard(
        BigInt(cardId),
        posX !== undefined ? String(posX) : '',
        posY !== undefined ? String(posY) : '',
      );
    },
    beginTargeting: (req) => setTargeting(req),
    imitateLostSoul: (sourceInstanceId, targetInstanceId) => {
      gameState.imitateLostSoul(sourceInstanceId, targetInstanceId);
    },
    stopImitatingLostSoul: (sourceInstanceId) => {
      gameState.stopImitatingLostSoul(sourceInstanceId);
    },
    executeCardAbilityWithCount: (sourceInstanceId, abilityIndex, count) => {
      // look_at_own_deck_choose is a private, client-side look (like
      // look_at_own_deck) — open the look modal with the player-chosen count
      // (capped at the ability limit) instead of routing through the server.
      const source = findAnyCardById(sourceInstanceId);
      // Resolved name for the lookup — see executeCardAbility above.
      const ability = source
        ? getEffectiveAbilities({
            cardName: resolveForgeCardName(source, forgeResolver),
            imitatingName: source.imitatingName,
          })[abilityIndex]
        : undefined;
      if (ability?.type === 'look_at_own_deck_choose') {
        const n = Math.min(count, ability.maxCount);
        setLookState({ position: ability.position, count: n });
        if (source) gameState.logLookAtTop(n, source.cardName, ability.position);
        return;
      }
      if (ability?.type === 'reveal_own_deck_choose') {
        // Public counterpart of look_at_own_deck_choose — same peek modal the
        // fixed-count reveal_own_deck uses, so the opponent sees it too.
        const n = Math.min(count, ability.maxCount);
        setPeekState({
          position: ability.position,
          count: n,
          cardIds: sampleDeckCardIds(ability.position, n),
          source: { cardName: source!.cardName },
        });
        return;
      }
      if (
        ability?.type === 'look_at_opponent_deck_choose'
        || ability?.type === 'reveal_opponent_deck_choose'
        || ability?.type === 'discard_opponent_deck_choose'
      ) {
        // Same opponent-consent flow as the fixed-count variants — the request
        // payload already carries an arbitrary count, so the only difference is
        // where the number comes from.
        const n = Math.min(count, ability.maxCount);
        const verb =
          ability.type === 'look_at_opponent_deck_choose' ? 'look'
          : ability.type === 'reveal_opponent_deck_choose' ? 'reveal'
          : 'discard';
        const action = `${verb}_deck_${ability.position}`;
        requestOpponentAction(action, JSON.stringify({ count: n }));
        return;
      }
      gameState.executeCardAbilityWithCount(sourceInstanceId, abilityIndex, count);
    },
    beginCountPrompt: (req) => setCountPrompt(req),
    beginResurrectPrompt: (sourceInstanceId, abilityIndex) => setResurrectReq({ sourceInstanceId, abilityIndex }),
    beginKeepOnePrompt: (sourceInstanceId) => setKeepOneReq({ mode: 'caster', sourceInstanceId }),
  }), [gameState, findAnyCardById, checkReserveProtection, checkReserveBatchProtection, undoStack, opponentHandRevealed, opponentHandBrigadeCounts, isMyFirstTurn, isOpponentFirstTurn, hasOpponent]);

  // ---- ModalGameProvider value (for shared deck modals) ----
  const modalGameValue = useMemo<ModalGameContextValue>(() => ({
    zones: Object.fromEntries(
      Object.entries(myCards).map(([zone, cards]) => [
        zone,
        cards.map(c => adaptCard(c, 'player1'))
      ])
    ),
    actions: {
      moveCard: (id, toZone, _idx, posX, posY) => {
        const card = findMyCardById(String(id));
        const fromZone = card?.zone;
        const execute = () => gameState.moveCard(BigInt(id), String(toZone), undefined, posX?.toString(), posY?.toString());
        if (checkReserveProtection(fromZone, String(toZone), execute)) return;
        execute();
      },
      moveCardsBatch: (ids, toZone) => {
        const execute = () => gameState.moveCardsBatch(JSON.stringify(ids), String(toZone));
        if (checkReserveBatchProtection(ids.map(String), String(toZone), execute)) return;
        execute();
      },
      moveCardToTopOfDeck: (id) => {
        if (undoStack) {
          const card = findMyCardById(id);
          if (card && card.zone !== 'deck') {
            const ownerId = String(card.ownerId);
            const captured: Captured = {
              cardId: id, fromZone: card.zone, prevOwnerId: ownerId,
              posX: card.posX, posY: card.posY,
            };
            undoStack.push({
              description: `Moved ${card.cardName || 'card'} to top of deck`,
              reverseAction: makeReverseAction({ captured, lookup: lookupForUndo, move: undoMove }),
            });
          }
        }
        gameState.moveCardToTopOfDeck(BigInt(id));
      },
      moveCardToBottomOfDeck: (id) => {
        if (undoStack) {
          const card = findMyCardById(id);
          if (card) {
            const fromZone = card.zone;
            const ownerId = String(card.ownerId);
            const captured: Captured = {
              cardId: id, fromZone, prevOwnerId: ownerId,
              posX: card.posX, posY: card.posY,
            };
            const reverseAction = fromZone === 'deck'
              ? () => {
                  if (!reverseIsSafe(lookupForUndo(id))) return false;
                  gameState.moveCardToTopOfDeck(BigInt(id));
                  return true;
                }
              : makeReverseAction({ captured, lookup: lookupForUndo, move: undoMove });
            undoStack.push({
              description: `Moved ${card.cardName || 'card'} to bottom of deck`,
              reverseAction,
            });
          }
        }
        gameState.moveCardToBottomOfDeck(BigInt(id));
      },
      shuffleDeck: () => gameState.shuffleDeck(),
      shuffleCardIntoDeck: (id) => {
        if (undoStack) {
          const card = findMyCardById(id);
          if (card && card.zone !== 'deck') {
            const ownerId = String(card.ownerId);
            const captured: Captured = {
              cardId: id, fromZone: card.zone, prevOwnerId: ownerId,
              posX: card.posX, posY: card.posY,
            };
            undoStack.push({
              description: `Shuffled ${card.cardName || 'card'} into deck`,
              reverseAction: makeReverseAction({ captured, lookup: lookupForUndo, move: undoMove }),
            });
          }
        }
        gameState.shuffleCardIntoDeck(BigInt(id));
      },
      exchangeFromDeck: (exchangeCardIds, replacementMoves) => {
        // Capture pre-exchange state so undo can restore each card. We only
        // undo the atomic deck exchange path — exchangeCards uses random draws
        // and isn't cleanly reversible.
        if (undoStack && exchangeCardIds.length > 0) {
          const originals = exchangeCardIds.map(id => {
            const card = findMyCardById(id);
            return card ? { id, zone: card.zone, posX: card.posX, posY: card.posY, ownerId: String(card.ownerId), name: card.cardName } : null;
          }).filter((o): o is NonNullable<typeof o> => o !== null);
          const replacementIds = replacementMoves.map(m => m.cardId);
          if (originals.length > 0) {
            const desc = originals.length === 1
              ? `Exchanged ${originals[0].name || 'card'}`
              : `Exchanged ${originals.length} cards`;
            undoStack.push({
              description: desc,
              reverseAction: () => {
                // Best-effort: put surviving replacements back onto the deck
                // (top), then send each exchange card still sitting in the deck
                // back to its source zone with its original owner.
                let any = false;
                for (const rid of replacementIds) {
                  if (!lookupForUndo(rid)) continue;
                  gameState.moveCardToTopOfDeck(BigInt(rid));
                  any = true;
                }
                for (const o of originals) {
                  if (!reverseIsSafe(lookupForUndo(o.id))) continue;
                  gameState.moveCard(BigInt(o.id), o.zone, undefined, o.posX, o.posY, o.ownerId);
                  any = true;
                }
                return any;
              },
            });
          }
        }
        gameState.exchangeFromDeck(
          JSON.stringify(exchangeCardIds),
          JSON.stringify(replacementMoves),
        );
      },
      logDeckSearchNoShuffle: ({ topCount, bottomCount }) =>
        gameState.logDeckSearchNoShuffle(topCount, bottomCount),
    },
  }), [myCards, counters, gameState, findMyCardById, checkReserveProtection, checkReserveBatchProtection, undoStack, forgeResolver]);

  // ---- ModalGameProvider value for opponent deck modals (peek/search operate on opponent cards) ----
  const opponentModalGameValue = useMemo<ModalGameContextValue>(() => ({
    zones: Object.fromEntries(
      Object.entries(opponentCards).map(([zone, cards]) => [
        zone,
        cards.map(c => adaptCard(c, 'player2'))
      ])
    ),
    actions: {
      moveCard: (id, toZone, _idx, posX, posY) =>
        gameState.moveCard(BigInt(id), String(toZone), undefined, posX?.toString(), posY?.toString()),
      moveCardsBatch: (ids, toZone) =>
        gameState.moveCardsBatch(JSON.stringify(ids), String(toZone)),
      moveCardToTopOfDeck: (id) => gameState.moveCardToTopOfDeck(BigInt(id)),
      moveCardToBottomOfDeck: (id) => gameState.moveCardToBottomOfDeck(BigInt(id)),
      shuffleDeck: () => gameState.shuffleDeck(),
      shuffleCardIntoDeck: (id) => gameState.shuffleCardIntoDeck(BigInt(id)),
    },
  }), [opponentCards, counters, gameState]);

  // ---- ModalGameProvider value for shared Soul Deck modals (Paragon). Shared
  //      pile — no reserve protection, no consent flow. ----
  const soulDeckModalGameValue = useMemo<ModalGameContextValue>(() => ({
    zones: Object.fromEntries(
      Object.entries(sharedCards).map(([zone, cards]) => [
        zone,
        cards.map(c => adaptCard(c, 'player1'))
      ])
    ),
    actions: {
      moveCard: (id, toZone, _idx, posX, posY) =>
        gameState.moveCard(BigInt(id), String(toZone), undefined, posX?.toString(), posY?.toString()),
      moveCardsBatch: (ids, toZone) =>
        gameState.moveCardsBatch(JSON.stringify(ids), String(toZone)),
      // The shared Soul Deck has no "deck" semantics — redirect the generic
      // "Top/Bottom of Deck" and "Shuffle into Deck" context-menu actions back
      // to 'soul-deck' so they don't escape into the viewer's private deck and
      // corrupt both piles.
      moveCardToTopOfDeck: (id) => gameState.moveCard(BigInt(id), 'soul-deck', '0'),
      moveCardToBottomOfDeck: (id) => gameState.moveCard(BigInt(id), 'soul-deck'),
      shuffleDeck: () => gameState.shuffleSoulDeck(),
      shuffleCardIntoDeck: (_id) => gameState.shuffleSoulDeck(),
    },
  }), [sharedCards, counters, gameState]);

  // ---- Combined zones for context menu (includes both players' cards so counters
  //      update live when right-clicking opponent cards) ----
  const allZonesForContextMenu = useMemo(() => {
    const myZonesMap = modalGameValue.zones as Record<string, GameCard[]>;
    const oppZonesMap = opponentModalGameValue.zones as Record<string, GameCard[]>;
    const combined: Record<string, GameCard[]> = {};
    const allKeys = new Set([...Object.keys(myZonesMap), ...Object.keys(oppZonesMap)]);
    for (const key of allKeys) {
      combined[key] = [...(myZonesMap[key] ?? []), ...(oppZonesMap[key] ?? [])];
    }
    return combined;
  }, [modalGameValue.zones, opponentModalGameValue.zones]);

  // ---- ModalGameProvider value for the browse sheet's Field of Battle grid.
  //      The band is shared table space, so the grid shows BOTH players' band
  //      cards (allZonesForContextMenu already merges them); move_card accepts
  //      either player's card in sandbox mode (see the opponent deck modals
  //      comment below), so modalGameValue's actions serve both. ----
  const battleBrowseModalGameValue = useMemo<ModalGameContextValue>(() => ({
    ...modalGameValue,
    zones: { ...modalGameValue.zones, battle: allZonesForContextMenu['battle'] ?? [] },
  }), [modalGameValue, allZonesForContextMenu]);

  // ---- Close all menus helper ----
  const closeAllMenus = useCallback(() => {
    setContextMenu(null);
    setMultiCardContextMenu(null);
    setNotePopover(null);
    setZoneMenu(null);
    setDeckMenu(null);
    setLorMenu(null);
    setDeckDrop(null);
    setShowDeckSearch(false);
    setPeekState(null);
    setLookState(null);
    setExchangeState(null);
    setBrowseMyZone(null);
    setBrowseOpponentZone(null);
    setBoardBrowseOpen(false);
    setReaderCard(null);
    setBrowseSharedLob(false);
    setBrowseBattle(false);
    setOpponentZoneMenu(null);
    setOpponentDeckMenu(null);
    setOpponentPeekState(null);
    setOpponentLookState(null);
    setHandMenu(null);
    setOpponentHandMenu(null);
    setReserveMenu(null);
    setOpponentReserveMenu(null);
    setSoulDeckMenu(null);
    setBrowseSoulDeck(false);
    setSoulDeckLookState(null);
    setSoulDeckPeekState(null);
  }, []);

  // ---- moveDeckCardsToZone helper ----
  const moveDeckCardsToZone = useCallback((
    position: 'top' | 'bottom' | 'random',
    count: number,
    targetZone: string,
  ) => {
    const deckCards = [...(myCards['deck'] ?? [])].sort(
      (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
    );
    let selected: typeof deckCards;
    if (position === 'top') selected = deckCards.slice(0, count);
    else if (position === 'bottom') selected = deckCards.slice(-count);
    else {
      const shuffled = [...deckCards];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      selected = shuffled.slice(0, count);
    }
    const ids = selected.map(c => String(c.id));
    const fromSource = position === 'top' ? 'top-of-deck' : position === 'bottom' ? 'bottom-of-deck' : 'random-from-deck';
    if (ids.length > 0) {
      const execute = () => gameState.moveCardsBatch(JSON.stringify(ids), targetZone, undefined, undefined, fromSource);
      if (checkReserveBatchProtection(ids, targetZone, execute)) return;
      execute();
    }
  }, [myCards, gameState, checkReserveBatchProtection]);

  // ---- moveOpponentDeckCardsToZone helper (operates on opponent's deck) ----
  const moveOpponentDeckCardsToZone = useCallback((
    position: 'top' | 'bottom' | 'random',
    count: number,
    targetZone: string,
  ) => {
    const deckCards = [...(opponentCards['deck'] ?? [])].sort(
      (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
    );
    let selected: typeof deckCards;
    if (position === 'top') selected = deckCards.slice(0, count);
    else if (position === 'bottom') selected = deckCards.slice(-count);
    else {
      const shuffled = [...deckCards];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      selected = shuffled.slice(0, count);
    }
    const ids = selected.map(c => String(c.id));
    const fromSource = position === 'top' ? 'top-of-deck' : position === 'bottom' ? 'bottom-of-deck' : 'random-from-deck';
    // Reserve/discard/banish on the opponent's deck are *their* private piles
    // — the card stays with them. Without an explicit targetOwnerId, the
    // server's "actor takes opponent's card" home-routing would send it to
    // our pile instead. Hand is the exception: the actor draws into their
    // own hand, so leave targetOwnerId unset.
    const opponentId = gameState.opponentPlayer?.id;
    const targetOwnerId =
      opponentId !== undefined && (targetZone === 'reserve' || targetZone === 'discard' || targetZone === 'banish')
        ? String(opponentId)
        : undefined;
    if (ids.length === 0) return;
    // Undo: send the cards back to the opponent's deck. move_card_to_top_of_deck,
    // move_card_to_bottom_of_deck and shuffle_card_into_deck all route by the
    // card's originalOwnerId and none of them gate on ownership, so the reverse
    // lands in the opponent's deck without a second consent round-trip.
    // 'top'/'bottom' restore the exact original order; 'random' had no
    // meaningful order to restore, so those cards get reshuffled in instead.
    if (undoStack) {
      const verb = targetZone === 'hand' ? 'Drew' : targetZone === 'reserve' ? 'Reserved' : 'Discarded';
      undoStack.push({
        description: `${verb} ${ids.length} card${ids.length === 1 ? '' : 's'} from opponent's deck`,
        reverseAction: () => {
          // filter preserves order, so safe[0] is still the card that sat
          // closest to the top (or, for 'bottom', furthest from the bottom).
          const safe = ids.filter(id => reverseIsSafe(lookupForUndo(id)));
          if (safe.length === 0) return false;
          if (position === 'top') {
            // Each topdeck unshifts, so walk backwards to leave safe[0] on top.
            for (let i = safe.length - 1; i >= 0; i--) gameState.moveCardToTopOfDeck(BigInt(safe[i]));
          } else if (position === 'bottom') {
            // Each call takes the new bottom slot, so forward order rebuilds
            // the original tail with safe[last] bottom-most again.
            for (const id of safe) gameState.moveCardToBottomOfDeck(BigInt(id));
          } else {
            // Topdeck all but one, then let the final shuffleCardIntoDeck act
            // as the single reshuffle for the whole deck.
            for (let i = 0; i < safe.length - 1; i++) gameState.moveCardToTopOfDeck(BigInt(safe[i]));
            gameState.shuffleCardIntoDeck(BigInt(safe[safe.length - 1]));
          }
          return true;
        },
      });
    }
    gameState.moveCardsBatch(JSON.stringify(ids), targetZone, undefined, targetOwnerId, fromSource);
  }, [opponentCards, gameState, undoStack, lookupForUndo]);

  // ---- Shared Soul Deck handlers (Paragon). Pick N card IDs from the shared
  //      soul-deck by position, then reveal (→ shared LoB) or look (private). ----
  const handleSharedSoulDeckContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      e.cancelBubble = true;
      if (isSpectator) return;
      setSoulDeckMenu({ x: e.evt.clientX, y: e.evt.clientY });
    },
    [isSpectator],
  );

  const pickSoulDeckIds = useCallback(
    (mode: 'top' | 'bottom' | 'random', n: number): string[] => {
      const pile = [...(sharedCards['soul-deck'] ?? [])].sort(
        (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex),
      );
      if (pile.length === 0) return [];
      const count = Math.min(n, pile.length);
      if (mode === 'top') return pile.slice(0, count).map(c => String(c.id));
      if (mode === 'bottom') return pile.slice(-count).map(c => String(c.id));
      const shuffled = [...pile];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, count).map(c => String(c.id));
    },
    [sharedCards],
  );

  // Reveal: show the top/bottom/random N soul-deck cards in a public modal
  // for both players. Cards STAY in the soul deck until the player drags
  // them out or closes the modal.
  const revealFromSoulDeck = useCallback(
    (mode: 'top' | 'bottom' | 'random', n: number) => {
      setSoulDeckMenu(null);
      if ((sharedCards['soul-deck'] ?? []).length === 0) {
        showGameToast('Soul Deck is empty');
        return;
      }
      const ids = pickSoulDeckIds(mode, n);
      if (ids.length === 0) return;
      const count = ids.length;
      const title = mode === 'top'
        ? `Top ${count} of Soul Deck`
        : mode === 'bottom'
          ? `Bottom ${count} of Soul Deck`
          : `Random ${count} from Soul Deck`;
      setSoulDeckPeekState({ cardIds: ids, title });
    },
    [sharedCards, pickSoulDeckIds],
  );

  // Draw: move the top/bottom/random N soul-deck cards directly into the
  // shared LoB, face-up. Non-undoable rescue-attempt reveal semantics.
  const drawFromSoulDeck = useCallback(
    (mode: 'top' | 'bottom' | 'random', n: number) => {
      setSoulDeckMenu(null);
      if ((sharedCards['soul-deck'] ?? []).length === 0) {
        showGameToast('Soul Deck is empty');
        return;
      }
      const ids = pickSoulDeckIds(mode, n);
      if (ids.length === 0) return;
      if (ids.length === 1) {
        gameState.moveCard(BigInt(ids[0]), 'land-of-bondage');
      } else {
        gameState.moveCardsBatch(JSON.stringify(ids), 'land-of-bondage');
      }
    },
    [sharedCards, pickSoulDeckIds, gameState],
  );

  const lookAtSoulDeck = useCallback(
    (mode: 'top' | 'bottom' | 'random', n: number) => {
      setSoulDeckMenu(null);
      if ((sharedCards['soul-deck'] ?? []).length === 0) {
        showGameToast('Soul Deck is empty');
        return;
      }
      const ids = pickSoulDeckIds(mode, n);
      if (ids.length === 0) return;
      const count = ids.length;
      const title = mode === 'top'
        ? `Looking at Top ${count} of Soul Deck`
        : mode === 'bottom'
          ? `Looking at Bottom ${count} of Soul Deck`
          : `Looking at Random ${count} from Soul Deck`;
      setSoulDeckLookState({ cardIds: ids, title });
    },
    [sharedCards, pickSoulDeckIds],
  );

  const searchSoulDeck = useCallback(() => {
    setSoulDeckMenu(null);
    setBrowseSoulDeck(true);
  }, []);

  const handleShuffleSoulDeck = useCallback(() => {
    setSoulDeckMenu(null);
    gameState.shuffleSoulDeck();
  }, [gameState]);

  const soulDeckDragTopIdRef = useRef<string | null>(null);

  // ---- Drag state ----
  // isDraggingRef is declared earlier (battle-flip deferral, spec §4).
  const dragEndTimeRef = useRef<number>(0);
  const dragSourceZoneRef = useRef<string | null>(null);
  const dragSourceOwnerRef = useRef<'my' | 'opponent' | 'shared' | null>(null);
  // instanceId of the card currently mid-Konva-drag — used by the mid-drag
  // zone-change guard below (Task 15 spec §5) to look up its live zone/node.
  const draggedCardIdRef = useRef<string | null>(null);
  // Set by the mid-drag zone-change guard right before it calls
  // node.stopDrag(); tells handleCardDragEnd (fired synchronously by
  // stopDrag()) to skip drop resolution — there's no user-intended drop here.
  const dragCancelledRef = useRef(false);
  // Zone of each FOLLOWER card at drag start (multi-select / equip-follower
  // drags). handleCardDragEnd's synchronous stale-row check compares each
  // follower's live zone against this — a follower the server moved
  // mid-drag is dropped from the batch dispatch (its new position wins).
  // The lead card's start zone lives in dragSourceZoneRef.
  const dragStartFollowerZonesRef = useRef<Map<string, string> | null>(null);
  const dragOriginalPosRef = useRef<{ x: number; y: number } | null>(null);
  // Local coords in the original parent (before reparenting to the layer).
  // Used by snapBack to restore the card inside its source Group accurately.
  const dragOriginalLocalPosRef = useRef<{ x: number; y: number } | null>(null);
  /** Tracks the rendered card dimensions during drag (pile vs territory vs LOB). */
  const dragCardSizeRef = useRef<{ w: number; h: number } | null>(null);
  /** Tracks the original parent Group so we can move the node back on snap-back. */
  const dragOriginalParentRef = useRef<Konva.Container | null>(null);
  /** Tracks the card's z-index within its original parent so we can restore stacking order after drag. */
  const dragOriginalZIndexRef = useRef<number | null>(null);
  const [dragHoverZone, setDragHoverZone] = useState<DropZoneKey | null>(null);
  const dragHoverZoneRef = useRef<DropZoneKey | null>(null);
  // Re-renderable signal so overlays (e.g. detach icons) can hide during drag.
  const [isCardDraggingUi, setIsCardDraggingUi] = useState(false);
  // Timer that delays revealing drag-only overlays until DB state settles.
  const dragSettleTimerRef = useRef<number | null>(null);

  // Card node ref map for imperative multi-card drag
  const cardNodeRefs = useRef<Map<string, Konva.Group>>(new Map());
  const registerCardNode = useCallback((instanceId: string, node: Konva.Group | null) => {
    if (node) {
      cardNodeRefs.current.set(instanceId, node);
    } else {
      cardNodeRefs.current.delete(instanceId);
    }
  }, []);

  // Smooth hand re-layout: when cards enter/leave the hand the remaining
  // cards glide to their shifted slots instead of snapping.
  const myHandSlots = useMemo(() => {
    const m = new Map<string, { x: number; y: number; rotation: number }>();
    const cards = myCards['hand'] ?? [];
    if (!myHandRect || cards.length === 0) return m;
    const pos = calculateHandPositions(
      cards.length,
      myHandRect,
      handCardWidth,
      handCardHeight,
      viewerKind === 'spectator' ? true : isSpreadHand,
      handToolbarReserve,
    );
    cards.forEach((c, i) => {
      const p = pos[i];
      if (p) m.set(String(c.id), p);
    });
    return m;
  }, [myCards, myHandRect, handCardWidth, handCardHeight, viewerKind, isSpreadHand, handToolbarReserve]);
  useHandLayoutTween(myHandSlots, cardNodeRefs);

  // Multi-card drag: offsets of follower cards relative to the dragged card
  const dragFollowerOffsets = useRef<Map<string, { dx: number; dy: number }> | null>(null);
  // Ghost image for multi-card drag — a single rasterized snapshot of all followers
  const dragGhostRef = useRef<Konva.Image | null>(null);
  const dragGhostLayerRef = useRef<Konva.Layer | null>(null);
  const dragGhostOffsetRef = useRef<{ dx: number; dy: number } | null>(null);

  // ---- Zone hit-testing ----
  /**
   * Find which zone a point falls into, checking both player and opponent zones
   * plus hand zone. Priority: my zones first, then opponent free-form zones.
   */
  const findZoneAtPosition = useCallback(
    (x: number, y: number): { zone: DropZoneKey; owner: 'my' | 'opponent' | 'shared' } | null => {
      if (!mpLayout || !myHandRect) return null;

      // Check my hand zone
      if (pointInRect(x, y, myHandRect)) {
        return { zone: 'hand', owner: 'my' };
      }

      // Check opponent hand zone
      if (opponentHandRect && pointInRect(x, y, opponentHandRect)) {
        return { zone: 'hand', owner: 'opponent' };
      }

      // Paragon: the shared LoB is a drop target that resets ownership to the shared sentinel.
      if (normalizedFormat === 'Paragon' && mpLayout.zones.sharedLob && pointInRect(x, y, mpLayout.zones.sharedLob)) {
        return { zone: 'land-of-bondage', owner: 'shared' };
      }
      // Paragon: the soul deck pile is a drop target — opens a put-top/
      // put-bottom/shuffle popup like the normal deck.
      if (normalizedFormat === 'Paragon' && mpLayout.zones.soulDeck && pointInRect(x, y, mpLayout.zones.soulDeck)) {
        return { zone: 'soul-deck', owner: 'shared' };
      }

      // Battle band (Field of Battle) — checked BEFORE the territory loops.
      // Owner 'my' is a formality: the drop path always sends targetOwnerId ''
      // so ownership never transfers on battle drops (spec §4). The band is
      // now phase-driven (set_phase opens it) — there is no idle divider-proxy
      // drop that opens a battle anymore; the band must already be visible.
      if (battleActive) {
        if (mpLayout.zones.battle && pointInRect(x, y, mpLayout.zones.battle)) {
          return { zone: 'battle', owner: 'my' };
        }
      }

      // Check my zones (all: free-form + sidebar piles)
      for (const [key, rect] of Object.entries(myZones)) {
        if (pointInRect(x, y, rect)) {
          return { zone: key, owner: 'my' };
        }
      }

      // Check opponent free-form and auto-arrange zones — sandbox mode allows
      // dropping on opponent territory during battles
      for (const [key, rect] of Object.entries(opponentZones)) {
        if ((isFreeFormZone(key) || isAutoArrangeZone(key)) && pointInRect(x, y, rect)) {
          return { zone: key, owner: 'opponent' };
        }
      }

      // Check opponent sidebar zones too (e.g. dropping a lost soul in opp LOR)
      for (const [key, rect] of Object.entries(opponentZones)) {
        if (!isFreeFormZone(key) && !isAutoArrangeZone(key) && pointInRect(x, y, rect)) {
          return { zone: key, owner: 'opponent' };
        }
      }

      return null;
    },
    [mpLayout, myZones, opponentZones, myHandRect, opponentHandRect, normalizedFormat, battleActive],
  );

  // Dragging the Soul Deck pile: capture the top soul's ID at drag-start,
  // hit-test the drop point at drag-end, move the top soul into the shared
  // LoB if dropped there. Pile always snaps back to (0,0) since its inner
  // shapes carry absolute coords.
  const handleSoulDeckPileDragStart = useCallback(
    (_e: Konva.KonvaEventObject<DragEvent>) => {
      const sorted = [...(sharedCards['soul-deck'] ?? [])].sort(
        (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex),
      );
      soulDeckDragTopIdRef.current = sorted.length > 0 ? String(sorted[0].id) : null;
    },
    [sharedCards],
  );

  const handleSoulDeckPileDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const topId = soulDeckDragTopIdRef.current;
      soulDeckDragTopIdRef.current = null;
      const dragNode = e.target;
      const dragX = dragNode.x();
      const dragY = dragNode.y();
      dragNode.position({ x: 0, y: 0 });

      if (!topId) return;
      const sharedLobRect = mpLayout?.zones.sharedLob;
      const soulDeckZone = mpLayout?.zones.soulDeck;
      if (!sharedLobRect || !soulDeckZone) return;

      const pileWidth = Math.min(lobCard.cardWidth, soulDeckZone.width - 4);
      const pileHeight = Math.round(pileWidth * 1.4);
      const centerX = soulDeckZone.x + (soulDeckZone.width - pileWidth) / 2 + pileWidth / 2 + dragX;
      const centerY = soulDeckZone.y + (soulDeckZone.height - pileHeight) / 2 + pileHeight / 2 + dragY;

      const hit = findZoneAtPosition(centerX, centerY);
      if (!hit || hit.owner !== 'shared' || hit.zone !== 'land-of-bondage') return;

      const db = toDbPos(centerX - pileWidth / 2, centerY - pileHeight / 2, sharedLobRect, 'my', {
        cardWidth: lobCard.cardWidth,
        cardHeight: lobCard.cardHeight,
      });
      gameState.moveCard(BigInt(topId), 'land-of-bondage', undefined, String(db.x), String(db.y), '0');
    },
    [sharedCards, mpLayout, lobCard.cardWidth, lobCard.cardHeight, findZoneAtPosition, gameState],
  );

  // ---- Modal card drag hook (for dragging cards from modals to canvas) ----
  const findZoneForModalDrag = useCallback((x: number, y: number): ZoneId | null => {
    const hit = findZoneAtPosition(x, y);
    if (!hit) return null;
    // Shared zones (Paragon shared LoB / Soul Deck) are not valid modal drop
    // targets — the modal moveCard callback only handles 'my'/'opponent'
    // ownership, so shared drops would misroute the card to the player's own
    // zone with the wrong owner and coords (effectively losing the card).
    if (hit.owner === 'shared') return null;
    // Allow dropping on any non-shared zone — own zones and opponent zones
    // (territory/LOB for battles, sidebar piles for pile manipulation, hand
    // for transferring cards into the opponent's hand). Opponent hand is
    // hidden to the local player but the move itself is a legal sandbox
    // action; the server's existing visibility rules keep card identity
    // private.
    return hit.zone as ZoneId;
  }, [findZoneAtPosition]);

  const {
    dragState: modalDrag,
    startDrag: modalStartDrag,
    startMultiDrag: modalStartMultiDrag,
    ghostRef: modalGhostRef,
    didDragRef: modalDidDragRef,
    validDropRef: modalValidDropRef,
  } = useModalCardDrag({
    stageRef,
    zoneLayout: myZones as Partial<Record<ZoneId, GoldfishZoneRect>>,
    findZoneAtPosition: findZoneForModalDrag,
    scale,
    offsetX,
    offsetY,
    moveCard: (id: string, toZone: ZoneId, _idx?: number, posX?: number, posY?: number) => {
      // Battle is a single band rect hit-tested as owner 'my' as a formality
      // (see findZoneForModalDrag) — it is NOT in myZones/opponentZones, so
      // it can't go through the generic zone-lookup path below. Normalize
      // against battleBandRect with CARD-OWNER mirroring and the same
      // enter/move/no-op gating handleCardDragEnd's battle drop path uses,
      // instead of falling into the else-branch further down and sending
      // raw virtual pixels as posX/posY (an invisible card at toScreenPos).
      if (toZone === 'battle') {
        const battleState = gameState.game?.battleState;
        const battleNeedsEnter = battleState === '';
        if (!battleNeedsEnter && battleState !== 'active') {
          // 'awaiting-soul': band is open but the server refuses new plays
          // mid-resolution — snap back (no-op), matching handleCardDragEnd.
          return;
        }
        // Card-owner mirroring (spec §3/§4): battle drops never transfer
        // ownership and mirror by the DRAGGED CARD's owner, not the hit
        // zone (always 'my'). Shared-owned cards (0n) fold into 'my', same
        // as handleCardDragEnd's sourceOwner/targetOwner derivation.
        const sourceInstance = findAnyCardById(id);
        const sourceOwner: 'my' | 'opponent' | 'shared' =
          sourceInstance?.ownerId === 0n
            ? 'shared'
            : sourceInstance?.ownerId === gameState.opponentPlayer?.id
            ? 'opponent'
            : 'my';
        const targetOwner: 'my' | 'opponent' = sourceOwner === 'opponent' ? 'opponent' : 'my';
        const execute = () => {
          if (posX == null || posY == null || !battleBandRect) return;
          const db = toDbPos(posX, posY, battleBandRect, targetOwner, { cardWidth, cardHeight });
          if (battleNeedsEnter) {
            gameState.enterBattle(BigInt(id), String(db.x), String(db.y));
          } else {
            gameState.moveCard(BigInt(id), 'battle', undefined, String(db.x), String(db.y), '');
          }
        };
        const card = findMyCardById(id);
        if (checkReserveProtection(card?.zone, 'battle', execute)) return;
        execute();
        return;
      }

      // Determine which player's zone was hit so we can normalize correctly
      const hit = posX != null && posY != null
        ? findZoneAtPosition(posX + cardWidth / 2, posY + cardHeight / 2)
        : null;
      const isOppZone = hit?.owner === 'opponent';
      const zone = isOppZone ? opponentZones[toZone] : myZones[toZone];
      const ownerId = isOppZone && gameState.opponentPlayer
        ? String(gameState.opponentPlayer.id)
        : gameState.myPlayer ? String(gameState.myPlayer.id) : '';

      const execute = () => {
        if (zone && posX != null && posY != null) {
          const owner: 'my' | 'opponent' = isOppZone ? 'opponent' : 'my';
          const clamp = isFreeFormZone(String(toZone)) ? { cardWidth, cardHeight } : undefined;
          const db = toDbPos(posX, posY, zone, owner, clamp);
          gameState.moveCard(BigInt(id), String(toZone), undefined, db.x.toString(), db.y.toString(), ownerId);
        } else {
          gameState.moveCard(BigInt(id), String(toZone), undefined, posX?.toString(), posY?.toString(), ownerId);
        }
      };
      const card = findMyCardById(id);
      if (checkReserveProtection(card?.zone, String(toZone), execute)) return;
      execute();
    },
    moveCardsBatch: (ids: string[], toZone: ZoneId, positions?: Record<string, { posX: number; posY: number }>) => {
      // Battle batch drops: mirror the single-card branch above. Unlike
      // territory/LOB, the generic path below only special-cases
      // ('territory' | 'land-of-bondage') for normalization, so 'battle'
      // fell through to `gameState.moveCardsBatch(ids, toZone)` with NO
      // positions at all — every card piled at the server's fallback spot.
      if (toZone === 'battle') {
        const battleState = gameState.game?.battleState;
        const battleNeedsEnter = battleState === '';
        const execute = () => {
          if (!battleNeedsEnter && battleState !== 'active') {
            // 'awaiting-soul': no meaningful new plays mid-resolution — no-op.
            return;
          }
          if (!positions || !battleBandRect) {
            gameState.moveCardsBatch(JSON.stringify(ids), 'battle');
            return;
          }
          // Small per-card fan so a multi-select drop doesn't pile every
          // card on the exact same point (mirrors the territory/LOB fan
          // this hook already applies before calling us — battle just
          // never got one).
          const BATTLE_FAN_OFFSET = 20;
          const normalized: Record<string, { posX: string; posY: string }> = {};
          ids.forEach((id, i) => {
            const p = positions[id];
            if (!p) return;
            const sourceInstance = findAnyCardById(id);
            const sourceOwner: 'my' | 'opponent' =
              sourceInstance?.ownerId === gameState.opponentPlayer?.id ? 'opponent' : 'my';
            const db = toDbPos(p.posX + i * BATTLE_FAN_OFFSET, p.posY, battleBandRect, sourceOwner, { cardWidth, cardHeight });
            normalized[id] = { posX: String(db.x), posY: String(db.y) };
          });
          const leadId = ids[0];
          if (battleNeedsEnter && leadId && normalized[leadId]) {
            // Open the battle atomically with the lead card, same as
            // handleCardDragEnd's group-drag battleNeedsEnter branch.
            gameState.enterBattle(BigInt(leadId), normalized[leadId].posX, normalized[leadId].posY);
          }
          gameState.moveCardsBatch(JSON.stringify(ids), 'battle', JSON.stringify(normalized), '');
        };
        if (checkReserveBatchProtection(ids, 'battle', execute)) return;
        execute();
        return;
      }

      const execute = () => {
        if (positions && (toZone === 'territory' || toZone === 'land-of-bondage')) {
          const first = positions[ids[0]];
          const hit = first ? findZoneAtPosition(first.posX + cardWidth / 2, first.posY + cardHeight / 2) : null;
          const isOppZone = hit?.owner === 'opponent';
          const zone = isOppZone ? opponentZones[toZone] : myZones[toZone];
          const ownerId = isOppZone && gameState.opponentPlayer
            ? String(gameState.opponentPlayer.id)
            : gameState.myPlayer ? String(gameState.myPlayer.id) : '';
          if (zone) {
            const owner: 'my' | 'opponent' = isOppZone ? 'opponent' : 'my';
            const clamp = isFreeFormZone(String(toZone)) ? { cardWidth, cardHeight } : undefined;
            const normalized: Record<string, { posX: string; posY: string }> = {};
            for (const id of ids) {
              const p = positions[id];
              if (!p) continue;
              const db = toDbPos(p.posX, p.posY, zone, owner, clamp);
              normalized[id] = { posX: db.x.toString(), posY: db.y.toString() };
            }
            gameState.moveCardsBatch(JSON.stringify(ids), String(toZone), JSON.stringify(normalized), ownerId);
            return;
          }
        }
        gameState.moveCardsBatch(JSON.stringify(ids), String(toZone));
      };
      if (checkReserveBatchProtection(ids, String(toZone), execute)) return;
      execute();
    },
    onDeckDrop: (cardId, screenX, screenY) => {
      // Suppress the deck-drop popup while an exchange is already in progress.
      // Task 1 already ensures validDropRef stays false for deck targets, so
      // the exchange modal will not complete either.
      if (exchangeStateRef.current) return;
      // Defer so batch callback (called first) can store IDs
      pendingBatchRef.current = null;
      setTimeout(() => {
        setDeckDrop({ x: screenX, y: screenY, cardId, batchIds: pendingBatchRef.current ?? undefined });
      }, 0);
    },
    onBatchDeckDrop: (cardIds) => {
      if (exchangeStateRef.current) return;
      pendingBatchRef.current = cardIds;
    },
    cardWidth,
    cardHeight,
  });

  // ---- Modal card drag hook for opponent browse (dragging opponent cards to zones) ----
  const findZoneForOpponentDrag = useCallback((x: number, y: number): ZoneId | null => {
    const hit = findZoneAtPosition(x, y);
    if (!hit) return null;
    // Shared zones are not valid modal drop targets — moveCard only handles
    // 'my'/'opponent' ownership. See findZoneForModalDrag for details.
    if (hit.owner === 'shared') return null;
    return hit.zone as ZoneId;
  }, [findZoneAtPosition]);

  const {
    dragState: opponentModalDrag,
    startDrag: opponentModalStartDrag,
    startMultiDrag: opponentModalStartMultiDrag,
    ghostRef: opponentModalGhostRef,
    didDragRef: opponentModalDidDragRef,
  } = useModalCardDrag({
    stageRef,
    zoneLayout: { ...myZones, ...opponentZones } as Partial<Record<ZoneId, GoldfishZoneRect>>,
    findZoneAtPosition: findZoneForOpponentDrag,
    scale,
    offsetX,
    offsetY,
    moveCard: (id: string, toZone: ZoneId, _idx?: number, posX?: number, posY?: number) => {
      if (approvedSearchRequest) {
        const execute = () => {
          // Determine which player's zone was hit so we can normalize correctly
          const hit = posX != null && posY != null
            ? findZoneAtPosition(posX + cardWidth / 2, posY + cardHeight / 2)
            : null;
          const isOppZone = hit?.owner === 'opponent';
          const zone = isOppZone ? opponentZones[toZone] : myZones[toZone];

          let normX = posX?.toString();
          let normY = posY?.toString();
          if (zone && posX != null && posY != null) {
            const owner: 'my' | 'opponent' = isOppZone ? 'opponent' : 'my';
            const clamp = isFreeFormZone(String(toZone)) ? { cardWidth, cardHeight } : undefined;
            const db = toDbPos(posX, posY, zone, owner, clamp);
            normX = db.x.toString();
            normY = db.y.toString();
          }
          // Reassign ownership to match the destination zone's owner. Without
          // this, pulling a card from the opponent's deck into my territory
          // leaves the card still owned by the opponent (bug). When no hit is
          // resolved (drop coords missing), default to the actor — this is the
          // approved-search "take" flow, so the actor is who's grabbing the card.
          const newOwnerId = hit
            ? (isOppZone
              ? (gameState.opponentPlayer ? String(gameState.opponentPlayer.id) : '')
              : (gameState.myPlayer ? String(gameState.myPlayer.id) : ''))
            : (gameState.myPlayer ? String(gameState.myPlayer.id) : '');
          recordOpponentCardUndo(id, String(toZone));
          moveOpponentCard(
            BigInt(approvedSearchRequest.id),
            BigInt(id),
            String(toZone),
            normX,
            normY,
            newOwnerId
          );
        };
        // T1 reserve protection for opponent's reserve. Defer completing the
        // search request until after the user resolves the dialog — otherwise
        // the modal's drag-end auto-close deletes the request and `execute`
        // fails with "Search request not found".
        if (isOpponentFirstTurn && approvedSearchRequest.zone === 'reserve' && toZone !== 'reserve') {
          const reqId = BigInt(approvedSearchRequest.id);
          let storedOpts: { shuffled?: boolean } = {};
          deferOpponentSearchCompleteRef.current = {
            reqId,
            storeOpts: (opts) => { storedOpts = opts ?? {}; },
          };
          const afterDismiss = () => {
            deferOpponentSearchCompleteRef.current = null;
            completeZoneSearch(reqId, storedOpts.shuffled ?? false);
          };
          setPendingReserveMove({ kind: 'single', execute, afterDismiss });
        } else {
          execute();
        }
      }
    },
    moveCardsBatch: (ids: string[], toZone: ZoneId, positions?: Record<string, { posX: number; posY: number }>) => {
      if (approvedSearchRequest) {
        const execute = () => {
          if (positions && (toZone === 'territory' || toZone === 'land-of-bondage')) {
            const first = positions[ids[0]];
            const hit = first ? findZoneAtPosition(first.posX + cardWidth / 2, first.posY + cardHeight / 2) : null;
            const isOppZone = hit?.owner === 'opponent';
            const zone = isOppZone ? opponentZones[toZone] : myZones[toZone];
            if (zone) {
              const owner: 'my' | 'opponent' = isOppZone ? 'opponent' : 'my';
              const clamp = isFreeFormZone(String(toZone)) ? { cardWidth, cardHeight } : undefined;
              const newOwnerId = isOppZone
                ? (gameState.opponentPlayer ? String(gameState.opponentPlayer.id) : '')
                : (gameState.myPlayer ? String(gameState.myPlayer.id) : '');
              for (const id of ids) {
                const p = positions[id];
                recordOpponentCardUndo(id, String(toZone));
                if (!p) {
                  moveOpponentCard(BigInt(approvedSearchRequest.id), BigInt(id), String(toZone), undefined, undefined, newOwnerId);
                  continue;
                }
                const db = toDbPos(p.posX, p.posY, zone, owner, clamp);
                moveOpponentCard(BigInt(approvedSearchRequest.id), BigInt(id), String(toZone), db.x.toString(), db.y.toString(), newOwnerId);
              }
              return;
            }
          }
          for (const id of ids) {
            recordOpponentCardUndo(id, String(toZone));
            moveOpponentCard(BigInt(approvedSearchRequest.id), BigInt(id), String(toZone));
          }
        };
        // T1 reserve protection for opponent's reserve. See single-card branch
        // above for why we defer completing the search request.
        if (isOpponentFirstTurn && approvedSearchRequest.zone === 'reserve' && toZone !== 'reserve') {
          const reqId = BigInt(approvedSearchRequest.id);
          let storedOpts: { shuffled?: boolean } = {};
          deferOpponentSearchCompleteRef.current = {
            reqId,
            storeOpts: (opts) => { storedOpts = opts ?? {}; },
          };
          const afterDismiss = () => {
            deferOpponentSearchCompleteRef.current = null;
            completeZoneSearch(reqId, storedOpts.shuffled ?? false);
          };
          setPendingReserveMove({ kind: 'batch', execute, afterDismiss });
        } else {
          execute();
        }
      }
    },
    cardWidth,
    cardHeight,
  });

  // ---- Track denied search requests for toast notification ----
  const pendingSearchRef = useRef<any>(null);

  useEffect(() => {
    const myPending = zoneSearchRequests?.find(
      (r: any) => r.requesterId === gameState.myPlayer?.id && r.status === 'pending'
    );
    if (pendingSearchRef.current && !myPending && !approvedSearchRequest) {
      const prev = pendingSearchRef.current;
      const zone = prev.zone;
      const msg = prev.action ? `Opponent denied: ${describeRequesterAction(prev.action, prev.actionParams)}`
        : zone === 'hand-reveal' ? 'Opponent declined to reveal their hand'
        : zone === 'action-priority' ? 'Opponent declined priority'
        : zone === 'initiative' ? 'Opponent declined initiative'
        : `Opponent declined to share their ${zone}`;
      showGameToast(msg);
    }
    pendingSearchRef.current = myPending ?? null;
  }, [zoneSearchRequests, gameState.myPlayer, approvedSearchRequest]);

  // Auto-complete hand-reveal, action-priority, and initiative requests — no browse modal needed
  useEffect(() => {
    if (approvedSearchRequest && approvedSearchRequest.zone === 'hand-reveal') {
      completeZoneSearch(BigInt(approvedSearchRequest.id));
      showGameToast('Opponent revealed their hand');
    }
    if (approvedSearchRequest && approvedSearchRequest.zone === 'action-priority') {
      completeZoneSearch(BigInt(approvedSearchRequest.id));
      showGameToast('Action priority granted — take your action');
    }
    if (approvedSearchRequest && approvedSearchRequest.zone === 'initiative') {
      completeZoneSearch(BigInt(approvedSearchRequest.id));
      const passed = approvedSearchRequest.action === 'pass';
      showGameToast(passed ? 'Opponent passed initiative to you' : 'Initiative granted');
    }
  }, [approvedSearchRequest, completeZoneSearch]);

  // Dispatch approved opponent-action requests — fires the appropriate reducer
  // client-side, then completes the request so the row is cleaned up.
  const dispatchedActionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!approvedSearchRequest || !approvedSearchRequest.action) return;
    const reqId = String(approvedSearchRequest.id);
    if (dispatchedActionRef.current === reqId) return;
    dispatchedActionRef.current = reqId;

    const { action, actionParams } = approvedSearchRequest;
    let params: { count?: number; shuffleCount?: number; drawCount?: number; sourceInstanceId?: string } = {};
    try { params = actionParams ? JSON.parse(actionParams) : {}; } catch {}
    const count = params.count ?? 0;
    const reqIdBig = BigInt(approvedSearchRequest.id);

    const complete = () => completeZoneSearch(reqIdBig);

    switch (action) {
      case 'shuffle_deck':
        shuffleOpponentDeck(reqIdBig);
        complete();
        break;
      case 'look_deck_top':
        setOpponentLookState({ position: 'top', count });
        complete();
        break;
      case 'look_deck_bottom':
        setOpponentLookState({ position: 'bottom', count });
        complete();
        break;
      case 'look_deck_random':
        setOpponentLookState({ position: 'random', count });
        complete();
        break;
      case 'reveal_deck_top':
        setOpponentPeekState({ position: 'top', count, cardIds: sampleOpponentDeckCardIds('top', count) });
        complete();
        break;
      case 'reveal_deck_bottom':
        setOpponentPeekState({ position: 'bottom', count, cardIds: sampleOpponentDeckCardIds('bottom', count) });
        complete();
        break;
      case 'reveal_deck_random':
        setOpponentPeekState({ position: 'random', count, cardIds: sampleOpponentDeckCardIds('random', count) });
        complete();
        break;
      case 'draw_deck_top':
        moveOpponentDeckCardsToZone('top', count, 'hand');
        complete();
        break;
      case 'draw_deck_bottom':
        moveOpponentDeckCardsToZone('bottom', count, 'hand');
        complete();
        break;
      case 'draw_deck_random':
        moveOpponentDeckCardsToZone('random', count, 'hand');
        complete();
        break;
      case 'discard_deck_top':
        moveOpponentDeckCardsToZone('top', count, 'discard');
        complete();
        break;
      case 'discard_deck_bottom':
        moveOpponentDeckCardsToZone('bottom', count, 'discard');
        complete();
        break;
      case 'discard_deck_random':
        moveOpponentDeckCardsToZone('random', count, 'discard');
        complete();
        break;
      case 'reserve_deck_top':
        moveOpponentDeckCardsToZone('top', count, 'reserve');
        complete();
        break;
      case 'reserve_deck_bottom':
        moveOpponentDeckCardsToZone('bottom', count, 'reserve');
        complete();
        break;
      case 'reserve_deck_random':
        moveOpponentDeckCardsToZone('random', count, 'reserve');
        complete();
        break;
      case 'random_hand_to_discard':
        gameState.randomOpponentHandToZone(reqIdBig, count, 'discard', '');
        complete();
        break;
      case 'random_hand_to_reserve':
        gameState.randomOpponentHandToZone(reqIdBig, count, 'reserve', '');
        complete();
        break;
      case 'random_hand_to_deck_top':
        gameState.randomOpponentHandToZone(reqIdBig, count, 'deck', 'top');
        complete();
        break;
      case 'random_hand_to_deck_bottom':
        gameState.randomOpponentHandToZone(reqIdBig, count, 'deck', 'bottom');
        complete();
        break;
      case 'random_hand_to_deck_shuffle':
        gameState.randomOpponentHandToZone(reqIdBig, count, 'deck', 'shuffle');
        complete();
        break;
      case 'shuffle_and_draw':
        gameState.opponentShuffleAndDraw(reqIdBig, params.shuffleCount ?? 0, params.drawCount ?? 0);
        complete();
        break;
      case 'three_nails_reset':
        // sourceInstanceId is encoded in actionParams and re-parsed server-side
        // by three_nails_reset_execute; the client only needs to fire the reducer.
        gameState.threeNailsResetExecute(reqIdBig);
        complete();
        break;
      case 'discard_reserve_characters':
        // Darius' Decree on the opponent's reserve. sourceInstanceId is encoded
        // in actionParams and re-parsed server-side by
        // discard_reserve_characters_execute.
        gameState.discardReserveCharactersExecute(reqIdBig);
        complete();
        break;
      default:
        // Unknown action — complete to unblock, then warn.
        complete();
        console.warn('Unknown opponent action:', action);
    }
  }, [approvedSearchRequest, completeZoneSearch, shuffleOpponentDeck, moveOpponentDeckCardsToZone, gameState]);

  // Track opponent hand reveal — show/hide countdown bar
  const oppHandRevealed = gameState.opponentPlayer?.handRevealed ?? false;
  useEffect(() => {
    if (oppHandRevealed) {
      setRevealBarShrinking(false);
      // Start shrinking after a frame so the transition animates
      const frame = requestAnimationFrame(() => setRevealBarShrinking(true));
      return () => cancelAnimationFrame(frame);
    } else {
      setRevealBarShrinking(false);
    }
  }, [oppHandRevealed]);

  // Cleanup auto-hide timer on unmount
  useEffect(() => {
    return () => {
      if (revealAutoHideRef.current) clearTimeout(revealAutoHideRef.current);
    };
  }, []);

  // ---- Peek card IDs for DeckPeekModal ----
  // Snapshot taken at reveal time (stored in peekState.cardIds). Reading from
  // the live deck here would cause the "top N" to refill as cards are dragged
  // out, re-firing the broadcast effect and racing past clearRevealedCards.
  const peekCardIds = peekState?.cardIds ?? [];

  const sampleDeckCardIds = useCallback(
    (position: 'top' | 'bottom' | 'random', count: number): string[] => {
      const sorted = [...(myCards['deck'] ?? [])].sort(
        (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
      );
      let selected: typeof sorted;
      if (position === 'top') selected = sorted.slice(0, count);
      else if (position === 'bottom') selected = sorted.slice(-count);
      else {
        const shuffled = [...sorted];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        selected = shuffled.slice(0, count);
      }
      return selected.map(c => String(c.id));
    },
    [myCards],
  );

  const sampleOpponentDeckCardIds = useCallback(
    (position: 'top' | 'bottom' | 'random', count: number): string[] => {
      const sorted = [...(opponentCards['deck'] ?? [])].sort(
        (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
      );
      let selected: typeof sorted;
      if (position === 'top') selected = sorted.slice(0, count);
      else if (position === 'bottom') selected = sorted.slice(-count);
      else {
        const shuffled = [...sorted];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        selected = shuffled.slice(0, count);
      }
      return selected.map(c => String(c.id));
    },
    [opponentCards],
  );

  // ---- Look card IDs (private peek — no broadcast to opponent) ----
  const lookCardIds = useMemo(() => {
    if (!lookState) return [];
    const sorted = [...(myCards['deck'] ?? [])].sort(
      (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
    );
    let selected: typeof sorted;
    if (lookState.position === 'top') selected = sorted.slice(0, lookState.count);
    else if (lookState.position === 'bottom') selected = sorted.slice(-lookState.count);
    else {
      const shuffled = [...sorted];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      selected = shuffled.slice(0, lookState.count);
    }
    return selected.map(c => String(c.id));
  }, [lookState, myCards]);

  // Broadcast revealed cards to opponent via SpacetimeDB. Dedup: peekCardIds
  // returns a fresh array reference whenever myCards updates (which happens
  // on any subscription event), so compare serialized contents against the
  // last-sent ref to avoid firing the reducer twice for the same reveal.
  const peekCardIdsRef = useRef<string>('');
  useEffect(() => {
    if (peekCardIds.length === 0) {
      peekCardIdsRef.current = '';
      return;
    }
    const serialized = JSON.stringify(peekCardIds);
    if (peekCardIdsRef.current === serialized) return;
    peekCardIdsRef.current = serialized;
    const context = peekState?.source
      ? JSON.stringify({
          sourceCardName: peekState.source.cardName,
          position: peekState.position,
          count: peekState.count,
        })
      : '';
    gameState.revealCards(serialized, context);
  }, [peekCardIds, peekState]);

  // Broadcast the soul-deck reveal to both players. The soul-deck IDs already
  // live in sharedCards (visible to both seats) — revealCards tells the
  // opponent to open a matching modal over the same IDs.
  const soulDeckPeekIdsRef = useRef<string>('');
  useEffect(() => {
    if (!soulDeckPeekState || soulDeckPeekState.cardIds.length === 0) {
      soulDeckPeekIdsRef.current = '';
      return;
    }
    const serialized = JSON.stringify(soulDeckPeekState.cardIds);
    if (soulDeckPeekIdsRef.current === serialized) return;
    soulDeckPeekIdsRef.current = serialized;
    gameState.revealCards(serialized);
  }, [soulDeckPeekState, gameState]);

  // Opponent's revealed cards — driven by SpacetimeDB player.revealedCards
  const opponentRevealedCardIds = useMemo(() => {
    const raw = gameState.opponentPlayer?.revealedCards;
    if (!raw) return [];
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }, [gameState.opponentPlayer?.revealedCards]);

  // Snapshot revealed card IDs when they arrive — persist until opponent dismisses or clears
  useEffect(() => {
    if (opponentRevealedCardIds.length > 0) {
      setOpponentRevealSnapshot(opponentRevealedCardIds);
      setOpponentRevealDismissed(false);
    } else if (opponentRevealSnapshot.length > 0) {
      setOpponentRevealSnapshot([]);
      setOpponentRevealDismissed(true);
    }
  }, [opponentRevealedCardIds]);

  // Seat-0 player's revealed cards — same public source (player.revealedCards),
  // only rendered for spectators (see myRevealSnapshot render below). A seated
  // player's own reveal shows via the interactive peekState modal instead.
  const myRevealedCardIds = useMemo(() => {
    const raw = gameState.myPlayer?.revealedCards;
    if (!raw) return [];
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }, [gameState.myPlayer?.revealedCards]);

  useEffect(() => {
    if (myRevealedCardIds.length > 0) {
      setMyRevealSnapshot(myRevealedCardIds);
      setMyRevealDismissed(false);
    } else if (myRevealSnapshot.length > 0) {
      setMyRevealSnapshot([]);
      setMyRevealDismissed(true);
    }
  }, [myRevealedCardIds]);

  // Shared renderer for a read-only "public reveal" modal (Ancient of Days etc.).
  // The revealed IDs can live in different zones depending on the source:
  //   - shared soul-deck (Paragon reveal) → soulDeckModalGameValue
  //   - the seat-0 player's own deck → modalGameValue (maps myCards)
  //   - otherwise the seat-1 player's deck → opponentModalGameValue
  // Keying off the zone (not the revealer) lets the same renderer serve a reveal
  // from either seat, which is what makes the spectator's seat-0 view work.
  const renderPublicRevealModal = (
    snapshot: string[],
    liveIds: string[],
    displayName: string,
    onDismiss: () => void,
  ) => {
    const sharedSoulIds = new Set(
      (sharedCards['soul-deck'] ?? []).map((c) => String(c.id)),
    );
    const seat0Ids = new Set(
      Object.values(myCards).flat().map((c) => String(c.id)),
    );
    const isSoulDeckReveal = snapshot.some((id) => sharedSoulIds.has(id));
    const isSeat0DeckReveal = !isSoulDeckReveal && snapshot.some((id) => seat0Ids.has(id));
    const provider = isSoulDeckReveal
      ? soulDeckModalGameValue
      : isSeat0DeckReveal
        ? modalGameValue
        : opponentModalGameValue;
    const sourceZone: ZoneId = isSoulDeckReveal ? 'soul-deck' : 'deck';
    return (
      <ModalGameProvider value={provider}>
        <DeckPeekModal
          cardIds={snapshot}
          title={`${displayName} Revealed ${snapshot.length}`}
          onClose={liveIds.length > 0 ? undefined : onDismiss}
          onStartDrag={modalStartDrag}
          onStartMultiDrag={modalStartMultiDrag}
          didDragRef={modalDidDragRef}
          isDragActive={modalDrag.isDragging}
          sourceZone={sourceZone}
        />
      </ModalGameProvider>
    );
  };

  // Snapshot stored on opponentPeekState — see sampleOpponentDeckCardIds.
  // Reading from the live opponent deck would refill the "top N" as cards
  // are dragged out, re-firing the broadcast effect (which is logged) and
  // spamming the chat log with "revealed N cards".
  const opponentPeekCardIds = opponentPeekState?.cardIds ?? [];

  // Broadcast a reveal of opponent's deck to both players. The activator
  // already sees opponentPeekState locally; the opponent needs the same
  // modal so the reveal is truly public (e.g. The Ends of the Earth).
  const opponentPeekBroadcastRef = useRef<string>('');
  useEffect(() => {
    if (opponentPeekCardIds.length === 0) {
      opponentPeekBroadcastRef.current = '';
      return;
    }
    const serialized = JSON.stringify(opponentPeekCardIds);
    if (opponentPeekBroadcastRef.current === serialized) return;
    opponentPeekBroadcastRef.current = serialized;
    gameState.revealCards(serialized);
  }, [opponentPeekCardIds, gameState]);

  // Private look at opponent's deck — never broadcasts
  const opponentLookCardIds = useMemo(() => {
    if (!opponentLookState) return [];
    const sorted = [...(opponentCards['deck'] ?? [])].sort(
      (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex)
    );
    let selected: typeof sorted;
    if (opponentLookState.position === 'top') selected = sorted.slice(0, opponentLookState.count);
    else if (opponentLookState.position === 'bottom') selected = sorted.slice(-opponentLookState.count);
    else {
      const shuffled = [...sorted];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      selected = shuffled.slice(0, opponentLookState.count);
    }
    return selected.map(c => String(c.id));
  }, [opponentLookState, opponentCards]);

  // ---- Drag handlers ----

  const handleCardDragStart = useCallback(
    (card: GameCard) => {
      isDraggingRef.current = true;
      draggedCardIdRef.current = card.instanceId;
      dragCancelledRef.current = false;
      if (dragSettleTimerRef.current !== null) {
        clearTimeout(dragSettleTimerRef.current);
        dragSettleTimerRef.current = null;
      }
      setIsCardDraggingUi(true);
      dragSourceZoneRef.current = card.zone;
      const startSourceInstance = findAnyCardById(card.instanceId);
      dragSourceOwnerRef.current =
        startSourceInstance?.ownerId === 0n
          ? 'shared'
          : card.ownerId === 'player1'
          ? 'my'
          : 'opponent';

      // Turn off Konva's pixel-based hit detection for the duration of the drag.
      // Hit graph = an offscreen canvas where every listening shape is painted in a
      // unique color; on every pointermove Konva reads the pixel under the cursor
      // via getImageData to decide the target. With many visible cards that read
      // dominates CPU. During a drag we determine the target zone ourselves via
      // findZoneAtPosition, so Konva's hit test is pure overhead. Re-enabled in
      // handleCardDragEnd. Konva's drag system captures pointer events at the
      // document level so the drag itself keeps working while the layer is silenced.
      const gameLayer = gameLayerRef.current;
      if (gameLayer) gameLayer.listening(false);

      // If there is an active selection and the dragged card is not part of it,
      // clear the selection so the stale highlight doesn't persist.
      if (selectedIds.size > 0 && !selectedIds.has(card.instanceId)) {
        clearSelection();
      }

      // Determine the card's rendered dimensions based on its source zone.
      // Pile zones render at pileCardWidth/pileCardHeight, LOB at lobCard size,
      // everything else at the main cardWidth/cardHeight.
      if (SIDEBAR_PILE_ZONES.includes(card.zone as any)) {
        dragCardSizeRef.current = { w: pileCardWidth, h: pileCardHeight };
      } else if (isAutoArrangeZone(card.zone)) {
        dragCardSizeRef.current = { w: lobCard.cardWidth, h: lobCard.cardHeight };
      } else {
        dragCardSizeRef.current = { w: cardWidth, h: cardHeight };
      }

      // Store original position for snap-back (updated below after reparenting)
      const node = cardNodeRefs.current.get(card.instanceId);
      if (node) {
        // Move the card node to the top of the game layer so it escapes
        // any clipped parent Group and renders above all other zones/cards
        // during the drag.
        const layer = gameLayerRef.current;
        // Capture the node's local position in its original parent BEFORE
        // reparenting — snap-back restores these coords into the same parent.
        dragOriginalLocalPosRef.current = { x: node.x(), y: node.y() };
        if (layer && node.parent !== layer) {
          // Save original parent and z-index so we can restore on snap-back
          dragOriginalParentRef.current = node.parent as Konva.Container;
          dragOriginalZIndexRef.current = node.zIndex();
          // Convert the node's position from its current parent's coordinate
          // space to the layer's coordinate space. Without this, cards nested
          // in offset Groups (e.g. sidebar pile cards at local (0,0) inside a
          // Group at (cx, cy)) would jump to (0,0) in layer coords and become
          // unable to drag left due to the canvas-bounds clamp.
          const absPos = node.getAbsolutePosition();
          node.moveTo(layer);
          node.setAbsolutePosition(absPos);
        } else {
          dragOriginalParentRef.current = null;
          dragOriginalZIndexRef.current = null;
        }
        // Capture position after reparenting so drag-move logic uses layer coords
        dragOriginalPosRef.current = { x: node.x(), y: node.y() };
        node.moveToTop();
        layer?.batchDraw();
      }

      // Clear hover state
      setHoveredInstanceId(null);
      setHoveredCard(null);
      setHoverReady(false);
      if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
      stopHoverAnimation();

      // Multi-card drag: rasterize followers into a single ghost image.
      // Follower set: multi-select takes precedence; otherwise, for a warrior
      // being dragged within my own territory or battle band, attached
      // weapons come along.
      const isMultiSelectDrag = selectedIds.has(card.instanceId) && selectedIds.size > 1;
      // A host being dragged carries its attached accessories along.
      // Applies to territory AND battle warriors (with weapons) — a warrior
      // dragged out of the band, or repositioned within it, keeps its weapon
      // attached. LOB souls do NOT drag their attached sites — when a soul is
      // rescued or otherwise leaves LoB, the site stays put in LoB (the
      // server's accessory cascade unlinks it in place); 'land-of-bondage' is
      // a separate zone from 'battle'/'territory' so this doesn't affect it.
      const equipFollowerIds: string[] =
        !isMultiSelectDrag && (card.zone === 'territory' || card.zone === 'battle') && card.ownerId === 'player1'
          ? (myCards[card.zone] ?? [])
              .filter((c) => c.equippedToInstanceId === BigInt(card.instanceId))
              .map((c) => String(c.id))
          : [];
      const followerIds: string[] = isMultiSelectDrag
        ? Array.from(selectedIds).filter((id) => id !== card.instanceId)
        : equipFollowerIds;

      // Record each follower's zone at drag start — dragend's synchronous
      // stale-row check drops from the batch any follower the server moved
      // mid-drag. (Multi-select followers can start in different zones than
      // the lead, so a per-card snapshot is required; the lead's own start
      // zone is dragSourceZoneRef.)
      if (followerIds.length > 0) {
        const startZones = new Map<string, string>();
        for (const id of followerIds) {
          const inst = findAnyCardById(id);
          if (inst) startZones.set(id, inst.zone);
        }
        dragStartFollowerZonesRef.current = startZones;
      } else {
        dragStartFollowerZonesRef.current = null;
      }

      if (followerIds.length > 0) {
        const dragNode = cardNodeRefs.current.get(card.instanceId);
        if (dragNode) {
          const offsets = new Map<string, { dx: number; dy: number }>();
          const baseX = dragNode.x();
          const baseY = dragNode.y();

          const followers: { id: string; node: Konva.Group; dx: number; dy: number }[] = [];
          for (const id of followerIds) {
            const node = cardNodeRefs.current.get(id);
            if (node) {
              const dx = node.x() - baseX;
              const dy = node.y() - baseY;
              offsets.set(id, { dx, dy });
              followers.push({ id, node, dx, dy });
            }
          }
          dragFollowerOffsets.current = offsets;

          if (followers.length > 0) {
            // Use getClientRect to get the actual visual bounding box of each follower,
            // which correctly handles rotation=180 (opponent cards).
            const dragRect = dragNode.getClientRect({ skipTransform: false, skipShadow: true, skipStroke: true });
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            const followerRects: { f: typeof followers[0]; rect: { x: number; y: number; width: number; height: number } }[] = [];
            for (const f of followers) {
              const rect = f.node.getClientRect({ skipTransform: false, skipShadow: true, skipStroke: true });
              // Compute visual offset relative to drag card's visual top-left
              const relX = rect.x - dragRect.x;
              const relY = rect.y - dragRect.y;
              followerRects.push({ f, rect: { x: relX, y: relY, width: rect.width, height: rect.height } });
              minX = Math.min(minX, relX);
              minY = Math.min(minY, relY);
              maxX = Math.max(maxX, relX + rect.width);
              maxY = Math.max(maxY, relY + rect.height);
            }
            const ghostW = maxX - minX;
            const ghostH = maxY - minY;

            // Sort followers by zoneIndex so the ghost image preserves stacking order
            // (lower zoneIndex drawn first = underneath; higher drawn last = on top).
            followerRects.sort((a, b) => {
              const aCard = findAnyCardById(a.f.id);
              const bCard = findAnyCardById(b.f.id);
              return Number(aCard?.zoneIndex ?? 0) - Number(bCard?.zoneIndex ?? 0);
            });

            const offscreen = document.createElement('canvas');
            offscreen.width = ghostW * 2;
            offscreen.height = ghostH * 2;
            const ctx = offscreen.getContext('2d');
            if (ctx) {
              ctx.scale(2, 2);
              ctx.globalAlpha = 0.5;
              for (const { f, rect } of followerRects) {
                const cardCanvas = f.node.toCanvas({ pixelRatio: 1 });
                ctx.drawImage(cardCanvas, rect.x - minX, rect.y - minY, rect.width, rect.height);
              }

              // Position the ghost relative to the drag card's visual top-left
              // The ghost layer has the same scale/offset as the game layer,
              // so we need to convert from screen coords back to virtual coords.
              const ghostImage = new KonvaLib.Image({
                image: offscreen,
                // Convert screen-space offset to virtual coords by dividing by scale
                x: dragRect.x / scale - offsetX / scale + minX / scale,
                y: dragRect.y / scale - offsetY / scale + minY / scale,
                width: ghostW / scale,
                height: ghostH / scale,
                listening: false,
                opacity: 1,
              }) as Konva.Image;

              const stage = stageRef.current;
              if (stage) {
                let ghostLayer = dragGhostLayerRef.current;
                if (!ghostLayer) {
                  ghostLayer = new KonvaLib.Layer({ listening: false }) as Konva.Layer;
                  dragGhostLayerRef.current = ghostLayer;
                  stage.add(ghostLayer);
                }
                ghostLayer.scaleX(scale);
                ghostLayer.scaleY(scale);
                ghostLayer.x(offsetX);
                ghostLayer.y(offsetY);
                ghostLayer.add(ghostImage);
                ghostLayer.moveToTop();
                ghostLayer.batchDraw();
                dragGhostRef.current = ghostImage;
              }

              for (const f of followers) {
                f.node.visible(false);
              }
              dragNode.getLayer()?.batchDraw();
            }
          }
        }
      } else {
        dragFollowerOffsets.current = null;
      }
    },
    [selectedIds, stopHoverAnimation, cardWidth, cardHeight, pileCardWidth, pileCardHeight, lobCard.cardWidth, lobCard.cardHeight, scale, offsetX, offsetY, findAnyCardById, myCards],
  );

  const handleCardDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;

      // Use the dragged card's actual rendered size, not the territory default
      const dragW = dragCardSizeRef.current?.w ?? cardWidth;
      const dragH = dragCardSizeRef.current?.h ?? cardHeight;

      // Clamp card position to virtual canvas bounds
      const clampedX = Math.max(-dragW / 2, Math.min(node.x(), virtualWidth - dragW / 2));
      const clampedY = Math.max(-dragH / 2, Math.min(node.y(), VIRTUAL_HEIGHT - dragH / 2));
      if (clampedX !== node.x() || clampedY !== node.y()) {
        node.x(clampedX);
        node.y(clampedY);
      }

      const x = node.x();
      const y = node.y();
      // For rotation=180 cards (opponent territory), the node position is
      // the bottom-right corner, so compute center accordingly.
      const rot = (node as Konva.Group).rotation?.() ?? 0;
      const center = cardCenter(x, y, dragW, dragH, rot);
      const hit = findZoneAtPosition(center.x, center.y);
      const zoneKey = hit ? `${hit.owner}:${hit.zone}` : null;

      // Only trigger re-render when hovered zone changes
      if (zoneKey !== dragHoverZoneRef.current) {
        dragHoverZoneRef.current = zoneKey;
        setDragHoverZone(zoneKey);
      }

      // Multi-card drag: move the single ghost image
      const ghost = dragGhostRef.current;
      if (ghost) {
        if (!dragGhostOffsetRef.current) {
          dragGhostOffsetRef.current = {
            dx: ghost.x() - x,
            dy: ghost.y() - y,
          };
        }
        ghost.x(x + dragGhostOffsetRef.current.dx);
        ghost.y(y + dragGhostOffsetRef.current.dy);
        dragGhostLayerRef.current?.batchDraw();
      }
    },
    [findZoneAtPosition, cardWidth, cardHeight],
  );

  const handleCardDragEnd = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<DragEvent>) => {
      const followerOffsets = dragFollowerOffsets.current;
      const originalPos = dragOriginalPosRef.current;
      const originalLocalPos = dragOriginalLocalPosRef.current;
      const sourceZone = dragSourceZoneRef.current;
      const startFollowerZones = dragStartFollowerZonesRef.current;
      const originalParent = dragOriginalParentRef.current;
      const originalZIndex = dragOriginalZIndexRef.current;
      // Capture the dragged card's actual rendered size before resetting
      const dragW = dragCardSizeRef.current?.w ?? cardWidth;
      const dragH = dragCardSizeRef.current?.h ?? cardHeight;

      // Reset drag state
      isDraggingRef.current = false;
      // Delay revealing drag-only overlays (e.g. detach icons) until the
      // SpacetimeDB subscription has a chance to deliver the new posX/posY.
      // Without the delay, the overlay renders from stale state for a frame
      // and the icon visibly flashes at the pre-drag position.
      if (dragSettleTimerRef.current !== null) {
        clearTimeout(dragSettleTimerRef.current);
      }
      dragSettleTimerRef.current = window.setTimeout(() => {
        dragSettleTimerRef.current = null;
        setIsCardDraggingUi(false);
      }, 220);
      dragEndTimeRef.current = performance.now();
      dragSourceZoneRef.current = null;
      dragSourceOwnerRef.current = null;
      dragOriginalPosRef.current = null;
      dragOriginalLocalPosRef.current = null;
      dragCardSizeRef.current = null;
      dragOriginalParentRef.current = null;
      dragOriginalZIndexRef.current = null;
      dragHoverZoneRef.current = null;
      dragFollowerOffsets.current = null;
      dragStartFollowerZonesRef.current = null;
      const ghostOffset = dragGhostOffsetRef.current;
      dragGhostOffsetRef.current = null;
      setDragHoverZone(null);

      // Re-enable layer listening (disabled in handleCardDragStart for perf).
      const gameLayer = gameLayerRef.current;
      if (gameLayer) gameLayer.listening(true);

      // Group-drag visuals (ghost + hidden followers): normally settled
      // immediately, but a drop onto a deck pile claims them within this
      // tick (holdOnPile) so the stack waits on the pile while the popup
      // is open.
      const heldGhost = dragGhostRef.current;
      dragGhostRef.current = null;
      const heldFollowerIds = followerOffsets ? [...followerOffsets.keys()] : [];
      if (heldGhost || heldFollowerIds.length > 0) {
        pendingGroupSettleRef.current = () => {
          if (heldGhost) {
            heldGhost.destroy();
            dragGhostLayerRef.current?.batchDraw();
          }
          for (const id of heldFollowerIds) {
            const fNode = cardNodeRefs.current.get(id);
            if (fNode) fNode.visible(true);
          }
        };
        queueMicrotask(() => {
          pendingGroupSettleRef.current?.();
          pendingGroupSettleRef.current = null;
        });
      }

      // Task 15 spec §4: flush any battle-state flip parked while this drag
      // was in flight, and release the id the mid-drag zone-change guard
      // tracks. Runs on every dragend — including the stopDrag()-triggered
      // cancel path below — so the deferral can never wedge open.
      draggedCardIdRef.current = null;
      setBattleActive(rawBattleActiveRef.current);

      // Destroy a reparented drag node that react-konva failed to clean up.
      // At drag-start the dragged card is lifted out of its clipped zone Group
      // onto the game layer (handleCardDragStart: node.moveTo(layer)). Both
      // early returns below fire when the card's row left its drag-start zone
      // server-side mid-drag; normally react-konva destroys this node as it
      // remounts the card in the new zone. But a battle "courtesy drag" (the
      // opponent moving the very card you're dragging) can desync react-konva's
      // child bookkeeping so the reparented node SURVIVES on the layer while a
      // fresh authoritative node mounts in the new zone — a client-only
      // duplicate the user can nudge within the zone but never re-zone. Destroy
      // the survivor, but ONLY when a DIFFERENT live node is registered for this
      // id (authoritative node confirmed present elsewhere); destroying the sole
      // node for an id is the ghost-card class — see
      // reference_konva_destroy_ghost_cards.
      const destroyOrphanedDragNode = () => {
        const dragNode: Konva.Node = e.target;
        // react-konva already destroyed it → getStage() is null, nothing to do.
        if (!dragNode || dragNode.getStage() == null) return;
        const authoritative: Konva.Node | undefined = cardNodeRefs.current.get(card.instanceId);
        if (authoritative && authoritative !== dragNode) {
          dragNode.destroy();
          gameLayerRef.current?.batchDraw();
        }
      };

      // Restore a node to its pre-drag position/parent/z-index. Shared by the
      // gesture-cancel branch below and the drop paths' `snapBack` (which
      // binds it to the drop node).
      const snapBackNode = (node: Konva.Node) => {
        if (originalParent && node.parent !== originalParent) {
          node.moveTo(originalParent);
          // Restore the node's position in its original parent's coord space.
          // Using the pre-reparent local coords avoids the offset accumulation
          // that would occur if we applied layer-local coords inside a parent
          // that itself has a non-zero transform (e.g. sidebar pile Groups).
          if (originalLocalPos) {
            node.x(originalLocalPos.x);
            node.y(originalLocalPos.y);
          } else if (originalPos) {
            node.x(originalPos.x);
            node.y(originalPos.y);
          }
          // Restore original z-index so stacking order is preserved after snap-back
          if (originalZIndex != null) {
            const maxIdx = originalParent.getChildren().length - 1;
            node.zIndex(Math.min(originalZIndex, maxIdx));
          }
        } else if (originalPos) {
          node.x(originalPos.x);
          node.y(originalPos.y);
        }
        node.getLayer()?.batchDraw();
      };

      if (dragCancelledRef.current) {
        // Something called node.stopDrag() with this flag set — there is no
        // drop to resolve. TWO distinct causes land here, with different
        // node cleanup:
        // - Server-driven (mid-drag zone-change guard / synchronous remount):
        //   the row left its drag-start zone, react-konva owns the node's
        //   remount in the new zone — don't touch it beyond orphan cleanup.
        // - User-gesture (a pinch's second finger, a long-press): the row
        //   never moved, so nothing will remount — without an explicit
        //   snap-back the node strands visually at the drag point while the
        //   row still says it's in the source zone. Tell them apart by the
        //   row's LIVE zone (read through the ref — see the stale-closure
        //   note below).
        dragCancelledRef.current = false;
        const cancelledLiveRow = findAnyCardByIdRef.current(card.instanceId);
        if (
          cancelledLiveRow &&
          cancelledLiveRow.zone === sourceZone &&
          e.target.getStage() != null &&
          cardNodeRefs.current.get(card.instanceId) === e.target
        ) {
          if (followerOffsets && originalPos) {
            for (const [id, offset] of followerOffsets) {
              const fNode = cardNodeRefs.current.get(id);
              if (fNode) {
                fNode.x(originalPos.x + offset.dx);
                fNode.y(originalPos.y + offset.dy);
              }
            }
          }
          snapBackNode(e.target);
        } else {
          destroyOrphanedDragNode();
        }
        return;
      }

      // SYNCHRONOUS stale-row check (review Critical): for a genuine
      // cross-zone server move mid-drag (e.g. opponent's End Battle
      // auto-return), react-konva's removeChild runs in React's commit
      // mutation phase and Konva's own Node.remove() stops the drag and
      // fires THIS dragend synchronously — all before the passive effect
      // guard above ever runs, so dragCancelledRef is still false here.
      // The guard therefore cannot be the only protection: re-check the
      // row's live zone right now, inside dragend itself, independent of
      // what triggered it. Row gone, or zone no longer the drag-start
      // zone → the server moved the card mid-drag; its position wins.
      // Dispatch NOTHING (no moveCard, no undo entry) and don't touch the
      // node — react-konva has already destroyed/remounted it in the new
      // zone, and destroying a live node here is the ghost-card class.
      //
      // MUST read through findAnyCardByIdRef, not the closure: the deleted
      // fiber never got a prop update, so this destroy-path dragend runs
      // the PREVIOUS commit's closure, whose captured findAnyCardById still
      // reports the card in its source zone (re-review finding). The ref is
      // reassigned in the render body, which precedes the same commit's
      // mutation phase — it is always fresh when this fires.
      const liveLeadRow = findAnyCardByIdRef.current(card.instanceId);
      if (!liveLeadRow || liveLeadRow.zone !== sourceZone) {
        destroyOrphanedDragNode();
        return;
      }

      const node = e.target;
      const dropX = node.x();
      const dropY = node.y();
      // For rotation=180 cards (opponent territory), the node position is
      // the bottom-right corner, so compute center accordingly.
      // Use the actual dragged card dimensions, not the territory default.
      const dropRot = (node as Konva.Group).rotation?.() ?? 0;
      const center = cardCenter(dropX, dropY, dragW, dragH, dropRot);
      const hit = findZoneAtPosition(center.x, center.y);

      const isMultiSelectDrag = selectedIds.has(card.instanceId) && selectedIds.size > 1;
      const hasEquipFollowers =
        !isMultiSelectDrag && followerOffsets !== null && followerOffsets.size > 0;
      const isGroupDrag = isMultiSelectDrag || hasEquipFollowers;
      // Same stale-row rule applied per FOLLOWER: a follower the server
      // moved mid-drag (zone differs from its drag-start snapshot, or row
      // deleted) is dropped from the batch so the group dispatch can't
      // re-move it. The lead card was already validated above. Reads
      // through findAnyCardByIdRef for the same stale-closure reason.
      const followerStillDraggable = (id: string): boolean => {
        if (id === card.instanceId) return true;
        const live = findAnyCardByIdRef.current(id);
        if (!live) return false;
        const startZone = startFollowerZones?.get(id);
        return startZone === undefined || live.zone === startZone;
      };
      // Sort selected card IDs by their current zoneIndex so the server
      // assigns new zoneIndices in the same relative order — prevents
      // card order from getting scrambled during group drags.
      const cardIds = (isMultiSelectDrag
        ? Array.from(selectedIds).sort((a, b) => {
            const aCard = findAnyCardById(a);
            const bCard = findAnyCardById(b);
            return Number(aCard?.zoneIndex ?? BigInt(0)) - Number(bCard?.zoneIndex ?? BigInt(0));
          })
        : hasEquipFollowers
        ? [card.instanceId, ...Array.from(followerOffsets!.keys())]
        : [card.instanceId]
      ).filter(followerStillDraggable);
      const cardId = BigInt(card.instanceId);

      // Helper to snap back to original position and restore to original parent.
      // During dragStart the node was reparented from its clipped Group to the
      // layer so it renders above everything. On snap-back we need to reverse
      // that — move it back to the original parent and convert position from
      // layer coords back to the parent's local coords. (Shared logic lives in
      // snapBackNode above so the gesture-cancel branch can reuse it.)
      const snapBack = () => snapBackNode(node);

      if (!hit) {
        // No valid drop zone — snap primary and followers back to original positions
        if (followerOffsets && originalPos) {
          for (const [id, offset] of followerOffsets) {
            const fNode = cardNodeRefs.current.get(id);
            if (fNode) {
              fNode.x(originalPos.x + offset.dx);
              fNode.y(originalPos.y + offset.dy);
            }
          }
        }
        snapBack();
        return;
      }

      const targetZone = hit.zone;
      // Same zone = same zone name AND same owner (my hand ≠ opponent hand).
      // Paragon shared-zone cards (shared LoB / Soul Deck) are adapted with
      // ownerId='player1' for rendering, so fall back to the underlying
      // CardInstance.ownerId to detect the true 'shared' source — otherwise a
      // shared→shared drop would compute sourceOwner='my' vs hit.owner='shared'
      // and wrongly treat it as a cross-zone move.
      const sourceInstance = findAnyCardById(card.instanceId);
      const sourceOwner: 'my' | 'opponent' | 'shared' =
        sourceInstance?.ownerId === 0n
          ? 'shared'
          : card.ownerId === 'player1'
          ? 'my'
          : 'opponent';
      // Battle is a single band rect and its hit owner is always 'my', so a
      // card already in battle re-dropped inside the band is an intra-band
      // reposition regardless of which player owns the card.
      const isSameZone = targetZone === sourceZone && (hit.owner === sourceOwner || targetZone === 'battle');

      // Equip: if a weapon is dropped on a warrior in the local player's
      // territory OR on a warrior already in the battle band, attach instead
      // of moving. Gated to single-card drags (group drags are intentional
      // batch moves, not equip intents). Battle host candidates are drawn
      // from `myCards['battle']` (card ownership), never `hit.owner` — the
      // battle band hit-test always reports owner 'my' as a formality (see
      // findZoneAtPosition), so restricting the candidate pool to my own
      // battle cards is what keeps this from equipping onto the opponent's
      // battling warrior.
      //
      // Note: `hitTestWarrior` was written for goldfish where GameCard.posX/posY
      // are pixel coords. In multiplayer they're normalized 0–1 DB values, so
      // we convert each candidate's position to virtual-canvas pixels first.
      if (
        !isGroupDrag &&
        (targetZone === 'territory' || targetZone === 'battle') &&
        hit.owner === 'my' &&
        card.ownerId === 'player1'
      ) {
        const isBattleTarget = targetZone === 'battle';
        const hostZoneRect = isBattleTarget ? battleBandRect : myZones['territory'];
        if (gameCardIsWeapon(card) && hostZoneRect) {
          const myHostRaw = isBattleTarget ? myCards['battle'] ?? [] : myCards['territory'] ?? [];
          const myHostCards = myHostRaw.map((c) => {
            const adapted = cardInstanceToGameCard(c, counters.get(c.id) ?? [], 'player1', forgeResolver);
            if (adapted.posX !== undefined && adapted.posY !== undefined) {
              const { x, y } = toScreenPos(adapted.posX, adapted.posY, hostZoneRect, 'my');
              return { ...adapted, posX: x, posY: y };
            }
            return adapted;
          });
          const warriorCandidates = myHostCards.filter((c) => {
            if (c.instanceId === card.instanceId) return false;
            if (c.equippedTo) return false;
            if (!gameCardIsWarrior(c)) return false;
            const attached = myHostCards.filter((x) => x.equippedTo === c.instanceId);
            return attached.length < MAX_EQUIPPED_WEAPONS_PER_WARRIOR;
          });
          const hitWarrior = hitTestWarrior(
            center.x,
            center.y,
            cardWidth,
            cardHeight,
            warriorCandidates,
            card.instanceId,
          );
          if (hitWarrior) {
            gameState.attachCard(cardId, BigInt(hitWarrior.instanceId));
            snapBack();
            return;
          }
          // No Warrior under the drop — if it landed on a non-Warrior
          // character, the refusal is rules-correct (only Warrior-class
          // characters carry weapons) but used to be silent: the weapon just
          // sat in the zone and got discarded at battle end, reading as "the
          // game ate my sword" (UX review F10). Soft hint only — the move
          // below still proceeds, nothing is blocked.
          const nonWarriorCharacters = myHostCards.filter((c) => {
            if (c.instanceId === card.instanceId) return false;
            if (c.equippedTo) return false;
            if (!isCharacterCard({ cardType: c.type })) return false;
            return !gameCardIsWarrior(c);
          });
          const hitNonWarrior = hitTestWarrior(
            center.x,
            center.y,
            cardWidth,
            cardHeight,
            nonWarriorCharacters,
            card.instanceId,
          );
          if (hitNonWarrior) {
            showGameToast(`${hitNonWarrior.cardName} isn't a Warrior — ${card.cardName} won't attach`, 4000);
          }
        }
      }

      // Site attach in LOB: the site is always the accessory, the other card
      // is always the host — regardless of which one the user dragged.
      //   - Dragged site → any free LOB card becomes the host.
      //   - Dragged non-site → a free LOB site becomes the accessory, the
      //     dragged card becomes the host.
      // Gated to single-card drags. Note: we check geometrically against the
      // LOB zone rect (plus the peek extension above) rather than relying on
      // `targetZone === 'land-of-bondage'` — attached sites peek above the
      // zone, and a drop on the peeking portion lands in territory's rect.
      if (!isGroupDrag && card.ownerId === 'player1') {
        const myLobZone = myZones['land-of-bondage'];
        const peekUp = myLobZone
          ? lobCard.cardHeight * LOB_ATTACH_PEEK_VISIBLE_RATIO
          : 0;
        const dropInLobArea = !!(
          myLobZone &&
          center.x >= myLobZone.x &&
          center.x <= myLobZone.x + myLobZone.width &&
          center.y >= myLobZone.y - peekUp &&
          center.y <= myLobZone.y + myLobZone.height
        );
        const cardMeta = findCard(card.cardName, card.cardSet, card.cardImgFile);
        const draggedIsSite = isSite(cardMeta);
        if (myLobZone && dropInLobArea) {
          const myLobRaw = myCards['land-of-bondage'] ?? [];
          const sortedLob = [...myLobRaw].sort(
            (a, b) => Number(a.zoneIndex) - Number(b.zoneIndex),
          );
          const lobHosts = splitLobCards(sortedLob).hosts;
          const slotPositions = calculateAutoArrangePositions(
            lobHosts.length,
            myLobZone,
            lobCard.cardWidth,
            lobCard.cardHeight,
          );
          // Build pseudo-GameCards for the candidates with pixel posX/posY
          // taken from their auto-arrange slot (not their stored posX/posY).
          const lobCandidates = lobHosts.map((c, i) => {
            const slot = slotPositions[i];
            const adapted = cardInstanceToGameCard(c, counters.get(c.id) ?? [], 'player1', forgeResolver);
            return {
              ...adapted,
              posX: slot?.x,
              posY: slot?.y,
            };
          });
          // Filter by role. Dragged site → candidates are any free non-site
          // LOB cards (that don't already host an accessory). Dragged non-site
          // → candidates are free sites in LOB.
          const candidates = lobCandidates.filter((c) => {
            if (c.instanceId === card.instanceId) return false;
            if (c.equippedTo) return false;
            if (c.posX === undefined || c.posY === undefined) return false;
            const meta = findCard(c.cardName, c.cardSet, c.cardImgFile);
            const candidateIsSite = isSite(meta);
            if (draggedIsSite) {
              // Host candidate: any non-site LOB card with space for an accessory.
              if (candidateIsSite) return false;
              const attached = lobCandidates.filter((x) => x.equippedTo === c.instanceId);
              return attached.length < MAX_EQUIPPED_WEAPONS_PER_WARRIOR;
            }
            // Dragged non-site → accessory candidate is a free site.
            return candidateIsSite;
          });
          const hitHost = hitTestWarrior(
            center.x,
            center.y,
            lobCard.cardWidth,
            lobCard.cardHeight,
            candidates,
            card.instanceId,
          );
          if (hitHost) {
            // Site is always the accessory, other card is always the host.
            const siteId = draggedIsSite ? cardId : BigInt(hitHost.instanceId);
            const hostId = draggedIsSite ? BigInt(hitHost.instanceId) : cardId;
            gameState.attachCard(siteId, hostId);
            snapBack();
            return;
          }
        }
      }

      // Resolve the zone rect for the drop target so we can store normalized positions
      // (0–1 ratios). This ensures cards render at the correct proportional position
      // regardless of each player's screen/window size.
      const zoneRect =
        targetZone === 'battle'
          ? battleBandRect
          : hit.owner === 'my'
          ? myZones[targetZone]
          : hit.owner === 'opponent'
          ? opponentZones[targetZone]
          : mpLayout?.zones.sharedLob;
      // Resolve target owner ID — always set to the target zone's owner so
      // cards transfer ownership when moving between players' zones.
      // Battle: ownership NEVER transfers on battle drops (spec §4) — always
      // send an empty targetOwnerId regardless of the hit's formal owner.
      const targetOwnerId =
        targetZone === 'battle'
          ? ''
          : hit.owner === 'shared'
          ? '0'
          : hit.owner === 'my' && gameState.myPlayer
          ? String(gameState.myPlayer.id)
          : hit.owner === 'opponent' && gameState.opponentPlayer
          ? String(gameState.opponentPlayer.id)
          : '';

      // Opponent zones render with mirrored positions (1-posX, 1-posY).
      // When dropping into an opponent zone, inverse-mirror so the card
      // appears where it was visually dropped, not at the mirrored position.
      const isOpponentTarget = hit.owner === 'opponent';

      // Adjust drop position when rotation changes between source and target.
      // Opponent territory cards render with rotation=180 (anchor at bottom-right),
      // player territory cards render with rotation=0 (anchor at top-left).
      // When crossing between them, offset by card dimensions so the visual
      // position stays consistent.
      const sourceIsRotated = sourceOwner === 'opponent' && (isFreeFormZone(sourceZone ?? '') || isAutoArrangeZone(sourceZone ?? '') || SIDEBAR_PILE_ZONES.includes(sourceZone as any));
      // Battle renders by CARD owner (my cards rot 0, opponent-owned rot 180)
      // — the hit owner is always 'my' and must not drive rotation there.
      const targetIsRotated =
        targetZone === 'battle'
          ? sourceOwner === 'opponent'
          : isOpponentTarget && isFreeFormZone(targetZone);
      const { x: adjDropX, y: adjDropY } = adjustAnchorForRotationChange(
        dropX, dropY, dragW, dragH, sourceIsRotated, targetIsRotated,
      );

      // Battle positions mirror by CARD owner ('my'/'opponent' relative to me),
      // NOT by hit owner, so each player's cards land on their own half on
      // both screens (spec §3). Shared-owned cards render rot 0 → 'my'.
      const targetOwner: 'my' | 'opponent' =
        targetZone === 'battle'
          ? (sourceOwner === 'opponent' ? 'opponent' : 'my')
          : isOpponentTarget
          ? 'opponent'
          : 'my';
      const clampOpts = isFreeFormZone(targetZone) ? { cardWidth, cardHeight } : undefined;
      const toDb = (px: number, py: number) => toDbPos(px, py, zoneRect!, targetOwner, clampOpts);

      // Battle drops: when the band is closed, opening must be atomic with the
      // move — a client-side startBattle();moveCard(); pair would race the
      // opponent (spec §4). enter_battle throws during 'awaiting-soul', but
      // the server redirects stray move_card battle drops to territory then,
      // so route non-'active' states through enter_battle only when closed.
      const battleNeedsEnter = targetZone === 'battle' && gameState.game?.battleState === '';
      const dropSingleCard = (db: { x: number; y: number }) => {
        if (battleNeedsEnter) {
          gameState.enterBattle(cardId, String(db.x), String(db.y));
        } else {
          moveCard(cardId, targetZone, '', String(db.x), String(db.y), targetOwnerId);
        }
      };

      // Same free-form zone: just update position.
      // Restore the node to its original parent Group first — it was reparented
      // to the layer during dragStart and needs to go back so React-Konva's tree
      // stays in sync and the clipping Group works correctly.
      if (isSameZone && isFreeFormZone(targetZone)) {
        if (originalParent && node.parent !== originalParent) {
          const absPos = node.getAbsolutePosition();
          node.moveTo(originalParent);
          node.setAbsolutePosition(absPos);
        }
        if (isGroupDrag) {
          // Followers are already at drop positions from handleCardDragMove; confirm positions
          if (followerOffsets) {
            for (const [id, offset] of followerOffsets) {
              const fNode = cardNodeRefs.current.get(id);
              if (fNode) {
                if (originalParent && fNode.parent !== originalParent) {
                  const fAbsPos = fNode.getAbsolutePosition();
                  fNode.moveTo(originalParent);
                  fNode.setAbsolutePosition(fAbsPos);
                }
                fNode.x(dropX + offset.dx);
                fNode.y(dropY + offset.dy);
              }
            }
          }
          // Preserve relative z-order within the group, but place the entire
          // group above all other cards. Collect the group's Konva nodes and
          // moveToTop in an order that keeps attached weapons BELOW their
          // warrior (weapons first, then warriors). Within each class, preserve
          // zoneIndex ordering. moveToTop is last-wins, so emitting weapons
          // first leaves them beneath the warriors that are moved afterward.
          if (originalParent) {
            type GroupNode = { node: Konva.Node; zoneIndex: number; isWeapon: boolean };
            const groupNodes: GroupNode[] = [];
            const leadCard = findAnyCardById(card.instanceId);
            groupNodes.push({
              node,
              zoneIndex: Number(leadCard?.zoneIndex ?? 0),
              isWeapon: !!(leadCard && leadCard.equippedToInstanceId && leadCard.equippedToInstanceId !== 0n),
            });
            if (followerOffsets) {
              for (const [id] of followerOffsets) {
                const fNode = cardNodeRefs.current.get(id);
                if (fNode) {
                  const fCard = findAnyCardById(id);
                  groupNodes.push({
                    node: fNode,
                    zoneIndex: Number(fCard?.zoneIndex ?? 0),
                    isWeapon: !!(fCard && fCard.equippedToInstanceId && fCard.equippedToInstanceId !== 0n),
                  });
                }
              }
            }
            groupNodes.sort((a, b) => {
              if (a.isWeapon !== b.isWeapon) return a.isWeapon ? -1 : 1;
              return a.zoneIndex - b.zoneIndex;
            });
            for (const { node: gNode } of groupNodes) {
              gNode.moveToTop();
            }
          }
          // Build positions for batch move (normalized 0–1)
          const leadDb = toDb(dropX, dropY);
          const positions: Record<string, { posX: string; posY: string }> = {
            [card.instanceId]: { posX: String(leadDb.x), posY: String(leadDb.y) },
          };
          if (followerOffsets) {
            for (const [id, offset] of followerOffsets) {
              const fDb = toDb(dropX + offset.dx, dropY + offset.dy);
              positions[id] = { posX: String(fDb.x), posY: String(fDb.y) };
            }
          }
          moveCardsBatch(
            JSON.stringify(cardIds),
            targetZone,
            JSON.stringify(positions),
          );
          clearSelection();
        } else {
          const singleDb = toDb(dropX, dropY);
          updateCardPosition(cardId, String(singleDb.x), String(singleDb.y));
        }
        return;
      }

      // Same non-free-form zone
      if (isSameZone && !isFreeFormZone(targetZone)) {
        // Hand: compute drop index and reorder
        if (targetZone === 'hand' && hit.owner === 'my' && myHandRect) {
          const handCards = myCards['hand'] ?? [];
          if (handCards.length > 1) {
            const positions = calculateHandPositions(
              handCards.length,
              myHandRect,
              handCardWidth,
              handCardHeight,
              viewerKind === 'spectator' ? true : isSpreadHand,
              handToolbarReserve,
            );
            let targetIdx = 0;
            let minDist = Infinity;
            for (let i = 0; i < positions.length; i++) {
              const dist = Math.abs(positions[i].x + handCardWidth / 2 - center.x);
              if (dist < minDist) {
                minDist = dist;
                targetIdx = i;
              }
            }
            const draggedCardId = card.instanceId;
            const currentIdx = handCards.findIndex((c) => String(c.id) === draggedCardId);
            if (currentIdx !== -1 && currentIdx !== targetIdx) {
              const newOrder = [...handCards];
              const [dragged] = newOrder.splice(currentIdx, 1);
              newOrder.splice(targetIdx, 0, dragged);
              gameState.reorderHand(JSON.stringify(newOrder.map((c) => String(c.id))));
            }
          }
        }
        // Snap followers back to their original positions
        if (followerOffsets && originalPos) {
          for (const [id, offset] of followerOffsets) {
            const fNode = cardNodeRefs.current.get(id);
            if (fNode) {
              fNode.x(originalPos.x + offset.dx);
              fNode.y(originalPos.y + offset.dy);
            }
          }
        }
        snapBack();
        return;
      }

      // Battle drops while the battle is resolving ('awaiting-soul'): the band
      // is still open, but the server refuses enter_battle and redirects plain
      // move_card battle drops back to territory. For a territory-origin card
      // that redirect keeps the row in its SOURCE zone with the same React
      // key, so the destroy below would orphan it as an invisible ghost node
      // (same class as the LOB pile-drop guard further down). New plays are
      // not meaningful mid-resolution — snap everything back instead. The
      // closed-band proxy path is untouched (battleState '' → enter_battle).
      if (targetZone === 'battle' && !battleNeedsEnter && gameState.game?.battleState !== 'active') {
        if (followerOffsets && originalPos) {
          for (const [id, offset] of followerOffsets) {
            const fNode = cardNodeRefs.current.get(id);
            if (fNode) {
              fNode.x(originalPos.x + offset.dx);
              fNode.y(originalPos.y + offset.dy);
            }
          }
        }
        snapBack();
        return;
      }

      // Turn 1 reserve protection — check before executing the move
      if (sourceZone === 'reserve' && targetZone !== 'reserve' && isMyFirstTurn && hasOpponent) {
        const executeDragMove = () => {
          // Re-execute the move logic without protection check
          if (isGroupDrag) {
            if (targetZone === 'deck') {
              moveCardsBatch(JSON.stringify(cardIds), targetZone, undefined, targetOwnerId);
            } else if (isFreeFormZone(targetZone)) {
              const leadDb = toDb(adjDropX, adjDropY);
              const positions: Record<string, { posX: string; posY: string }> = {
                [card.instanceId]: { posX: String(leadDb.x), posY: String(leadDb.y) },
              };
              if (followerOffsets) {
                for (const [id, offset] of followerOffsets) {
                  const fDb = toDb(adjDropX + offset.dx, adjDropY + offset.dy);
                  positions[id] = { posX: String(fDb.x), posY: String(fDb.y) };
                }
              }
              if (battleNeedsEnter) {
                // Open the battle atomically with the lead card; the batch
                // executes after it server-side (same-connection reducer
                // ordering), so the group lands in an already-open band.
                gameState.enterBattle(cardId, positions[card.instanceId].posX, positions[card.instanceId].posY);
              }
              moveCardsBatch(JSON.stringify(cardIds), targetZone, JSON.stringify(positions), targetOwnerId);
            } else {
              moveCardsBatch(JSON.stringify(cardIds), targetZone, undefined, targetOwnerId);
            }
          } else if (isFreeFormZone(targetZone)) {
            const db = toDb(adjDropX, adjDropY);
            dropSingleCard(db);
          } else if (isAutoArrangeZone(targetZone)) {
            moveCard(cardId, targetZone, '', '0', '0', targetOwnerId);
          } else {
            moveCard(cardId, targetZone, '', undefined, undefined, targetOwnerId);
          }
          if (isGroupDrag) clearSelection();
        };
        setPendingReserveMove({ kind: isGroupDrag ? 'batch' : 'single', execute: executeDragMove });
        snapBack();
        return;
      }

      // Different zone — perform move.
      // For deck drops that show a popup, we snap the card back instead of
      // destroying the node. This prevents the card from disappearing if the
      // user cancels the popup without picking an option.
      const isDeckDropWithPopup = targetZone === 'deck' && stageRef.current;
      const isSoulDeckDropWithPopup = targetZone === 'soul-deck' && hit.owner === 'shared' && stageRef.current;

      // Hold the dragged node where it was dropped (on the pile) while a
      // deck-drop popup is open. Committing an option discards the node (the
      // move re-renders the card inside the deck); canceling glides it home
      // via the deferred snapBack. For group drags the ghost stack + hidden
      // followers are claimed too, so the whole pile waits together.
      const holdOnPile = () => {
        let group: {
          ghost: Konva.Image | null;
          ghostHome: { x: number; y: number } | null;
          followerIds: string[];
        } | null = null;
        if (pendingGroupSettleRef.current) {
          pendingGroupSettleRef.current = null; // claim — the settle microtask no-ops
          group = {
            ghost: heldGhost,
            ghostHome:
              ghostOffset && originalPos
                ? { x: originalPos.x + ghostOffset.dx, y: originalPos.y + ghostOffset.dy }
                : null,
            followerIds: heldFollowerIds,
          };
        }
        const settleGroup = (reshowFollowers: boolean) => {
          if (!group) return;
          if (group.ghost) {
            group.ghost.destroy();
            dragGhostLayerRef.current?.batchDraw();
          }
          if (reshowFollowers) {
            for (const id of group.followerIds) {
              const fNode = cardNodeRefs.current.get(id);
              if (fNode) fNode.visible(true);
            }
          }
        };
        deckDropHoldRef.current = {
          cardId: String(cardId),
          glideBack: () => {
            if (node.getStage()) {
              const abs = node.absolutePosition();
              snapBack();
              const homeX = node.x();
              const homeY = node.y();
              node.absolutePosition(abs);
              new KonvaLib.Tween({
                node,
                duration: 0.2,
                x: homeX,
                y: homeY,
                easing: KonvaLib.Easings.EaseOut,
              }).play();
            }
            if (group?.ghost && group.ghostHome && group.ghost.getStage()) {
              new KonvaLib.Tween({
                node: group.ghost,
                duration: 0.2,
                x: group.ghostHome.x,
                y: group.ghostHome.y,
                easing: KonvaLib.Easings.EaseOut,
                onFinish: () => settleGroup(true),
              }).play();
            } else {
              settleGroup(true);
            }
          },
          discard: () => {
            if (cardNodeRefs.current.get(card.instanceId) === node) {
              cardNodeRefs.current.delete(card.instanceId);
            }
            node.destroy();
            // Followers stay hidden — the reducer moves their rows into the
            // deck and the nodes unmount with the subscription update.
            // Failsafe: re-show any node still around (e.g. rejected move).
            if (group && group.followerIds.length > 0) {
              const ids = group.followerIds;
              setTimeout(() => {
                for (const id of ids) {
                  const fNode = cardNodeRefs.current.get(id);
                  if (fNode) fNode.visible(true);
                }
              }, 5000);
            }
            settleGroup(false);
            gameLayerRef.current?.batchDraw();
          },
        };
      };

      if (isSoulDeckDropWithPopup) {
        if (followerOffsets && originalPos) {
          for (const [id, offset] of followerOffsets) {
            const fNode = cardNodeRefs.current.get(id);
            if (fNode) {
              fNode.x(originalPos.x + offset.dx);
              fNode.y(originalPos.y + offset.dy);
            }
          }
        }
        holdOnPile();
        const stage = stageRef.current;
        if (stage) {
          const screenPos = virtualToScreen(center.x, center.y, scale, offsetX, offsetY);
          if (isGroupDrag) {
            pendingBatchRef.current = cardIds;
            setSoulDeckDrop({ x: screenPos.x, y: screenPos.y, cardId: cardIds[0], batchIds: cardIds });
          } else {
            setSoulDeckDrop({ x: screenPos.x, y: screenPos.y, cardId: String(cardId) });
          }
        }
        return;
      }

      if (isDeckDropWithPopup) {
        // Deck drop: the card waits on the pile while the popup is open.
        // The reducer fires when the user picks an option; cancel glides the
        // card back to where it came from. Followers return home now.
        if (followerOffsets && originalPos) {
          for (const [id, offset] of followerOffsets) {
            const fNode = cardNodeRefs.current.get(id);
            if (fNode) {
              fNode.x(originalPos.x + offset.dx);
              fNode.y(originalPos.y + offset.dy);
            }
          }
        }
        holdOnPile();
      } else {
        // Lost Souls dropped on a graveyard pile (discard/reserve/banish) are
        // redirected by the server back into the Land of Bondage. When the
        // drag started in a LoB the card re-renders in the SAME parent Group
        // with the same key, so its element never unmounts — destroying the
        // node here would orphan the row (React-Konva still thinks the node
        // exists and never recreates it), leaving an invisible "ghost" soul
        // holding a slot. Mirrors the server predicate at moveCard's
        // lost-soul redirect (token souls are deleted there, not redirected).
        const GRAVEYARD_PILE_ZONES = ['discard', 'reserve', 'banish'];
        const staysInLobAfterPileDrop = (id: string): boolean => {
          if (!GRAVEYARD_PILE_ZONES.includes(targetZone)) return false;
          const inst = findAnyCardById(id);
          if (!inst || inst.isToken) return false;
          if (inst.zone !== 'land-of-bondage') return false;
          return inst.cardType === 'LS' || inst.cardName.toLowerCase().includes('lost soul');
        };
        // Non-deck zone: destroy the reparented node so React-Konva creates
        // a fresh node in the correct parent Group with correct dimensions.
        const draggedNode = cardNodeRefs.current.get(card.instanceId);
        if (draggedNode) {
          if (staysInLobAfterPileDrop(card.instanceId)) {
            // Node must survive — the subscription update repositions it.
            snapBack();
          } else {
            cardNodeRefs.current.delete(card.instanceId);
            draggedNode.destroy();
          }
        }
        // Also clean up any follower nodes that were reparented
        if (followerOffsets) {
          for (const [id] of followerOffsets) {
            const fNode = cardNodeRefs.current.get(id);
            if (fNode) {
              // Redirected souls keep their node (it never left its parent);
              // the group-settle microtask re-shows it in place.
              if (staysInLobAfterPileDrop(id)) continue;
              cardNodeRefs.current.delete(id);
              fNode.destroy();
            }
          }
        }
        gameLayerRef.current?.batchDraw();
      }

      if (isGroupDrag) {
        if (targetZone === 'deck') {
          // Show deck drop popup for batch
          const stage = stageRef.current;
          if (stage) {
            const screenPos = virtualToScreen(center.x, center.y, scale, offsetX, offsetY);
            pendingBatchRef.current = cardIds;
            setDeckDrop({
              x: screenPos.x,
              y: screenPos.y,
              cardId: cardIds[0],
              batchIds: cardIds,
            });
          } else {
            moveCardsBatch(JSON.stringify(cardIds), targetZone, undefined, targetOwnerId);
          }
        } else if (isFreeFormZone(targetZone)) {
          const leadDb = toDb(adjDropX, adjDropY);
          const positions: Record<string, { posX: string; posY: string }> = {
            [card.instanceId]: { posX: String(leadDb.x), posY: String(leadDb.y) },
          };
          if (followerOffsets) {
            for (const [id, offset] of followerOffsets) {
              const fDb = toDb(adjDropX + offset.dx, adjDropY + offset.dy);
              positions[id] = { posX: String(fDb.x), posY: String(fDb.y) };
            }
          }
          if (battleNeedsEnter) {
            // Open the battle atomically with the lead card; the batch
            // executes after it server-side (same-connection reducer
            // ordering), so the group lands in an already-open band.
            gameState.enterBattle(cardId, positions[card.instanceId].posX, positions[card.instanceId].posY);
          }
          moveCardsBatch(
            JSON.stringify(cardIds),
            targetZone,
            JSON.stringify(positions),
            targetOwnerId,
          );
        } else {
          moveCardsBatch(JSON.stringify(cardIds), targetZone, undefined, targetOwnerId);
        }
        clearSelection();
      } else if (isFreeFormZone(targetZone)) {
        const db = toDb(adjDropX, adjDropY);
        dropSingleCard(db);
      } else if (isAutoArrangeZone(targetZone)) {
        // Auto-arrange zone: positions are ignored by rendering
        moveCard(cardId, targetZone, '', '0', '0', targetOwnerId);
      } else if (targetZone === 'deck') {
        const stage = stageRef.current;
        if (stage) {
          const screenPos = virtualToScreen(center.x, center.y, scale, offsetX, offsetY);
          setDeckDrop({
            x: screenPos.x,
            y: screenPos.y,
            cardId: String(cardId),
          });
        } else {
          moveCard(cardId, targetZone, '0', undefined, undefined, targetOwnerId);
        }
      } else {
        // Stacked zone — omit zoneIndex so server auto-appends to end
        moveCard(cardId, targetZone, '', undefined, undefined, targetOwnerId);
      }
    },
    [
      findZoneAtPosition,
      findAnyCardById,
      moveCard,
      moveCardsBatch,
      updateCardPosition,
      cardWidth,
      cardHeight,
      handCardWidth,
      handCardHeight,
      selectedIds,
      clearSelection,
      myZones,
      opponentZones,
      mpLayout,
      battleBandRect,
      gameState.myPlayer,
      gameState.opponentPlayer,
      scale,
      offsetX,
      offsetY,
      myCards,
      isMyFirstTurn,
      hasOpponent,
      gameState,
      counters,
      forgeResolver,
    ],
  );

  // Mid-drag zone-change guard (Task 15 spec §4/§5), UX layer: if the row
  // backing the actively-dragged card moves to a different zone server-side
  // (e.g. the opponent's End Battle auto-returns a battle card mid-drag) and
  // the node SURVIVED the commit, stop the Konva drag now rather than letting
  // the user keep dragging a phantom until pointerup. This effect is NOT the
  // correctness guarantee: when the server move unmounts the node,
  // react-konva's removeChild → Konva Node.remove() runs synchronously in
  // the commit mutation phase, Konva stops the drag itself and fires dragend
  // — all before this passive effect can run, so dragCancelledRef is never
  // set on that path. The synchronous stale-row check at the top of
  // handleCardDragEnd is what actually blocks the stale dispatch in every
  // case; this effect just ends the drag early when it gets the chance.
  useEffect(() => {
    if (!isDraggingRef.current) return;
    const id = draggedCardIdRef.current;
    if (!id) return;
    const liveZone = findAnyCardById(id)?.zone ?? null;
    if (liveZone === dragSourceZoneRef.current) return;
    const node = cardNodeRefs.current.get(id);
    if (node && node.getStage() && node.isDragging()) {
      dragCancelledRef.current = true;
      node.stopDrag();
    }
  }, [findAnyCardById]);

  // Noop handlers for non-draggable cards
  const noopDrag = useCallback((_e: Konva.KonvaEventObject<DragEvent>) => {}, []);
  const noopCardDrag = useCallback((_card: GameCard) => {}, []);
  const noopCardDragEnd = useCallback(
    (_card: GameCard, _e: Konva.KonvaEventObject<DragEvent>) => {},
    [],
  );
  const noopOpponentContextMenu = useCallback(
    (_card: GameCard, _e: Konva.KonvaEventObject<PointerEvent>) => {},
    [],
  );

  const handleSharedLobContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      if (isSpectator) return;
      closeAllMenus();
      const sharedRect = mpLayout?.zones.sharedLob;
      if (!sharedRect) return;
      const layer = gameLayerRef.current;
      const pointer = layer?.getRelativePointerPosition();
      const spawnX = pointer ? (pointer.x - sharedRect.x) / sharedRect.width : 0.5;
      const spawnY = pointer ? (pointer.y - sharedRect.y) / sharedRect.height : 0.5;
      setZoneMenu({
        x: e.evt.clientX,
        y: e.evt.clientY,
        spawnX,
        spawnY,
        targetPlayerId: '0',
      });
    },
    [mpLayout, closeAllMenus],
  );

  // Konva fires `dblclick` whenever two pointer-ups happen on the same shape
  // within the dblClickWindow — including right-click followed by left-click.
  // To ensure meek only toggles on a true left+left double-click, count
  // left-clicks since the last right-click on any card. A right-click resets
  // the counter to 0; each left-click increments it; the dblclick handler
  // requires the counter to be ≥ 2 before firing.
  const leftClicksSinceContextMenuRef = useRef<number>(99);

  // Universal card click handler — shift-click toggles selection
  // ---- Camera jump targets + e2e hook ----
  const jumpTargets = useMemo(() => {
    if (!mpLayout) return [];
    // Where the battle cards actually stand: free-form drops land anywhere
    // along the band, so the Battle jump centres on the cards rather than
    // the band midline (which left an off-centre attacker outside a phone
    // viewport). Node x is the card's top-left for my side but the rotated
    // bottom-right for the opponent's half — hence the ± half-card.
    let battleFocus: { centerX: number; span: number } | undefined;
    if (battleActive && battleBandRect) {
      const xs: number[] = [];
      for (const [rows, side] of [
        [myCards['battle'] ?? [], 'my'],
        [opponentCards['battle'] ?? [], 'opponent'],
      ] as const) {
        for (const c of rows) {
          if (!c.posX) continue;
          const p = toScreenPos(parseFloat(c.posX), parseFloat(c.posY), battleBandRect, side);
          xs.push(p.x + (side === 'my' ? cardWidth / 2 : -cardWidth / 2));
        }
      }
      if (xs.length > 0) {
        const min = Math.min(...xs);
        const max = Math.max(...xs);
        battleFocus = { centerX: (min + max) / 2, span: max - min + cardWidth };
      }
    }
    // Portrait's card-column "Fit" is a PLAYER framing (your hand, your
    // column). A spectator wants the overview, so they keep the whole-board
    // fit even in portrait — small, but complete, with the side jumps and
    // pinch for detail. Without this a portrait spectator's default view was
    // a column of empty ground with every pile off-screen.
    const targets = buildJumpTargets(mpLayout, virtualWidth, battleActive, portraitBoard && !isSpectator, battleFocus);
    if (!isSpectator) return targets;
    // A spectator has no "Mine"/"Theirs" — relabel the side jumps with the
    // seat names (seat-0 renders at the bottom, seat-1 at the top).
    const seatLabel = (name: string | undefined, fallback: string) => {
      const n = (name ?? '').trim();
      if (!n) return fallback;
      return n.length > 8 ? `${n.slice(0, 7)}…` : n;
    };
    return targets.map((t) =>
      t.id === 'my-side'
        ? { ...t, label: seatLabel(gameState.myPlayer?.displayName, 'P1') }
        : t.id === 'opponent-side'
          ? { ...t, label: seatLabel(gameState.opponentPlayer?.displayName, 'P2') }
          : t,
    );
  }, [mpLayout, virtualWidth, battleActive, portraitBoard, isSpectator, gameState.myPlayer?.displayName, gameState.opponentPlayer?.displayName, battleBandRect, myCards, opponentCards, cardWidth]);

  /** The in-play zones offered by the "cards in play" sheet, with live counts.
   *  Sidebar piles already open a grid when tapped; these are the zones on the
   *  board itself, which had no list view at all. */
  const boardBrowseEntries = useMemo<BoardBrowseEntry[]>(() => {
    const sharedLob = normalizedFormat === 'Paragon';
    const entries: BoardBrowseEntry[] = [
      { owner: 'my', zone: 'territory', label: 'Territory', count: (myCards['territory'] ?? []).length },
      { owner: 'opponent', zone: 'territory', label: 'Territory', count: (opponentCards['territory'] ?? []).length },
    ];
    if (battleActive) {
      // A contested battle stacks the attacker ~10px under the blocker, and
      // Konva hit-testing only returns the topmost card — on touch the buried
      // card is unreachable on the board. The band is shared table space, so
      // the row carries no Mine/Theirs prefix and the grid merges both sides.
      entries.unshift({
        owner: 'shared', zone: 'battle', label: 'Field of Battle',
        count: (myCards['battle'] ?? []).length + (opponentCards['battle'] ?? []).length,
      });
    }
    if (sharedLob) {
      entries.push({
        owner: 'shared', zone: 'land-of-bondage', label: 'Land of Bondage (shared)',
        count: (sharedCards['land-of-bondage'] ?? []).length,
      });
    } else {
      entries.push(
        { owner: 'my', zone: 'land-of-bondage', label: 'Land of Bondage', count: (myCards['land-of-bondage'] ?? []).length },
        { owner: 'opponent', zone: 'land-of-bondage', label: 'Land of Bondage', count: (opponentCards['land-of-bondage'] ?? []).length },
      );
    }
    // A spectator's "my" side is seat-0's PRIVATE hand, not the viewer's own —
    // this row (and the grid it opens) leaked the host's full hand to any
    // spectator. Offer it only when that player shares with spectators.
    if (!isSpectator || myShareHand) {
      entries.push({ owner: 'my', zone: 'hand', label: 'Hand', count: (myCards['hand'] ?? []).length });
    }

    // The pile zones. Their only other tap target is the right rail's count
    // badge, which is ~24x17 CSS px on a landscape phone with ~15px between
    // neighbours — a fingertip covers Discard, the gap and Banish at once
    // (measured: two taps 16px apart opened two different zones). Checking a
    // discard or your Land of Redemption is constant in this game, so route it
    // through the same 48px rows as everything else here.
    const pileZones: Array<{ zone: ZoneId; label: string }> = [
      { zone: 'discard', label: 'Discard' },
      { zone: 'land-of-redemption', label: 'Land of Redemption' },
      { zone: 'reserve', label: 'Reserve' },
      { zone: 'banish', label: 'Banish' },
    ];
    for (const { zone, label } of pileZones) {
      // Seat-0's reserve is hidden info for a spectator too — same gate the
      // rail uses (canViewMyReserve is always true for the seated player).
      if (!(zone === 'reserve' && !canViewMyReserve)) {
        entries.push({ owner: 'my', zone, label, count: (myCards[zone] ?? []).length });
      }
      // Their reserve is face-down unless revealed — same gate the rail uses.
      if (zone === 'reserve' && !canViewOppReserve) continue;
      entries.push({ owner: 'opponent', zone, label, count: (opponentCards[zone] ?? []).length });
    }
    return entries;
  }, [myCards, opponentCards, sharedCards, normalizedFormat, battleActive, canViewOppReserve, canViewMyReserve, isSpectator, myShareHand]);

  /** Which jump the camera is currently sitting in, so the cluster can show
   *  it. Cleared by any manual pan/pinch — the framing is no longer that
   *  target's. Without this every button rendered unselected and "Fit" vs
   *  "Theirs" read as "nothing happened". */
  const [activeJumpId, setActiveJumpId] = useState<JumpTargetId | null>('fit');
  // Mirror so jumpToTarget (and the edge-triggered effects below) can read the
  // current framing without re-creating on every jump — same idiom as
  // tapMoveStateRef.
  const activeJumpIdRef = useRef<JumpTargetId | null>(activeJumpId);
  activeJumpIdRef.current = activeJumpId;
  /** What the camera was framing before a Battle jump, so it can return there
   *  when the battle band closes instead of staying parked on an empty strip. */
  const preBattleJumpRef = useRef<JumpTargetId | null>(null);

  const jumpToTarget = useCallback((t: (typeof jumpTargets)[number]) => {
    // In the compact profile the turn bar OVERLAYS the canvas top — without
    // the inset, "Theirs" framed the opponent's hand row underneath it.
    if (!t.rect) return;
    if (t.id === 'battle' && activeJumpIdRef.current !== 'battle') {
      preBattleJumpRef.current = activeJumpIdRef.current;
    }
    jumpTo(t.rect, { axis: t.axis, insetTop: useCompactLayout ? 48 : 0, anchorX: t.anchorX });
    setActiveJumpId(t.id);
  }, [jumpTo, useCompactLayout]);

  /** The board is wider than the viewport at the current zoom — there is
   *  somewhere to pan to. */
  const canPanHorizontally = containerWidth > 0 && virtualWidth * scale > containerWidth + 1;

  /** Pan by most of a screen. Two-finger drag pans too, but a side jump leaves
   *  half the board off-screen and a crowded territory leaves no bare board to
   *  grab with one finger — so the pan needs a control that is always hittable. */
  const panHorizontal = useCallback((direction: -1 | 1) => {
    if (!Number.isFinite(scale) || scale <= 0) return;
    if (!camera) return;
    setActiveJumpId(null);
    setCamera({
      ...camera,
      centerX: camera.centerX + (direction * containerWidth * 0.8) / scale,
    });
  }, [camera, containerWidth, scale, setCamera]);

  // ---- Default framing (touch) ----
  // Frame 'fit' once the board is measured, and re-frame when portrait flips
  // (a rotation): in landscape this reproduces the default camera exactly
  // (whole-board fit clamps to zoom 1, centred), but in portrait 'fit' is the
  // card-wide column — and useBoardCamera preserves zoom != MIN_ZOOM across
  // resizes, so rotating to landscape would otherwise strand the user at the
  // column's ~2.9x zoom.
  const framedOnMeasureRef = useRef(false);
  const prevPortraitBoardRef = useRef(portraitBoard);
  useEffect(() => {
    if (isTouch === false) return;
    if (containerWidth <= 0 || containerHeight <= 0) return;
    const fitTarget = jumpTargets.find((t) => t.id === 'fit');
    if (!fitTarget || !fitTarget.rect) return;
    const portraitFlipped = prevPortraitBoardRef.current !== portraitBoard;
    if (framedOnMeasureRef.current === true && portraitFlipped === false) return;
    framedOnMeasureRef.current = true;
    prevPortraitBoardRef.current = portraitBoard;
    jumpToTarget(fitTarget);
  }, [isTouch, containerWidth, containerHeight, portraitBoard, jumpTargets, jumpToTarget]);

  // ---- Camera return after a battle closes (touch) ----
  // When the band closes, its jump target vanishes but the camera stayed
  // parked on the now-empty strip with a dangling activeJumpId. Edge-triggered
  // on battleActive true→false, and only while the camera is still framing
  // 'battle' — any manual pan nulls activeJumpId and suppresses the restore,
  // so this can never fight the player.
  const prevBattleActiveRef = useRef(battleActive);
  useEffect(() => {
    const wasActive = prevBattleActiveRef.current;
    prevBattleActiveRef.current = battleActive;
    if (wasActive === false || battleActive === true) return;
    if (isTouch === false) return;
    if (activeJumpIdRef.current !== 'battle') return;
    const restore =
      jumpTargets.find((t) => t.id === preBattleJumpRef.current) ??
      jumpTargets.find((t) => t.id === 'fit');
    if (restore && restore.rect) jumpToTarget(restore);
  }, [battleActive, isTouch, jumpTargets, jumpToTarget]);

  // Lets Playwright drive the camera without synthesising gestures, so camera
  // behaviour and gesture recognition can be tested independently.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    // Published so the screenshot harness can assert that no floating chrome
    // occludes the hand band - the check that would have caught the toolbar
    // covering 93% of the player's cards.
    if (mpLayout) {
      const box = stageRef.current?.container().getBoundingClientRect();
      (window as any).__mpHandBand = {
        top: (box?.top ?? 0) + mpLayout.zones.playerHand.y * scale + offsetY,
        left: (box?.left ?? 0) + mpLayout.zones.playerHand.x * scale + offsetX,
        width: mpLayout.zones.playerHand.width * scale,
        height: mpLayout.zones.playerHand.height * scale,
      };
    }
    (window as any).__mpCamera = {
      get: () => camera,
      jumpTo: (id: string) => {
        const t = jumpTargets.find((x) => x.id === id);
        if (t?.rect) jumpTo(t.rect, { axis: t.axis });
      },
      reset: resetCamera,
    };
    return () => {
      delete (window as any).__mpCamera;
      delete (window as any).__mpHandBand;
    };
  }, [camera, jumpTargets, jumpTo, resetCamera, mpLayout, scale, offsetX, offsetY]);

  // ---- Sidebar pile / LoB long-press (touch) ----
  // Pile menus (deck actions, LoR, token spawn on LoB) opened only via
  // onContextMenu, which iOS never fires for canvas long-presses — so touch
  // users had no path to them at all. Long-press on a zone Rect now opens the
  // same menu. One shared timer suffices: a second finger is a pinch.
  const zonePressRef = useRef<{ x: number; y: number; fired: boolean } | null>(null);
  const zonePressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The touchend that ends a long-press still emits a Konva tap on the same
  // Rect (Konva taps have no duration ceiling); this one-shot ref keeps that
  // tap from also firing the pile's tap action over the fresh menu.
  const zoneLongPressFiredRef = useRef(false);
  const clearZonePress = useCallback(() => {
    if (zonePressTimerRef.current) clearTimeout(zonePressTimerRef.current);
    zonePressTimerRef.current = null;
    zonePressRef.current = null;
  }, []);
  useEffect(() => clearZonePress, [clearZonePress]);
  const beginZonePress = useCallback((e: Konva.KonvaEventObject<TouchEvent>, fire: (pt: { x: number; y: number }) => void) => {
    const t = e.evt.touches?.[0];
    if (!t) return;
    if (e.evt.touches.length > 1) { clearZonePress(); return; }
    clearZonePress();
    zoneLongPressFiredRef.current = false;
    const origin = { x: t.clientX, y: t.clientY, fired: false };
    zonePressRef.current = origin;
    zonePressTimerRef.current = setTimeout(() => {
      const s = zonePressRef.current;
      if (!s || s.fired) return;
      // Fire-time movement re-check, same reasoning as GameCardNode: Konva
      // suppresses stage pointer events while one of its drags is live, so
      // onTouchMove alone can go blind mid-press.
      const pressStage = (e.target as Konva.Node).getStage?.();
      const livePos = pressStage?.getPointerPosition?.();
      if (pressStage && livePos) {
        const box = pressStage.container().getBoundingClientRect();
        const moved = Math.hypot(box.left + livePos.x - s.x, box.top + livePos.y - s.y);
        if (moved > LONG_PRESS_MOVE_TOLERANCE) { clearZonePress(); return; }
      }
      s.fired = true;
      zoneLongPressFiredRef.current = true;
      fire({ x: s.x, y: s.y });
    }, LONG_PRESS_MS);
  }, [clearZonePress]);
  const moveZonePress = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    const s = zonePressRef.current;
    if (!s || s.fired) return;
    const t = e.evt.touches?.[0];
    if (!t) return;
    if (Math.hypot(t.clientX - s.x, t.clientY - s.y) > LONG_PRESS_MOVE_TOLERANCE) clearZonePress();
  }, [clearZonePress]);

  // ---- Tap-to-move (touch) ----
  // Mirrors handleCardDragEnd's ownership rules, but NOT its rotation-anchor
  // adjustment: a tap has no drag anchor to preserve, so the tap point simply
  // becomes the card's new centre (the same shape as the soul-deck pile drop).
  const handleTapMoveCommit = useCallback((move: CommitMove) => {
    const id = BigInt(move.cardId);
    const card = findAnyCardById(move.cardId);

    // Battle drops NEVER transfer ownership (battle spec section 4) and the
    // band is shared table space, so an owner id here would hand the
    // opponent's card to whoever tapped. findZoneAtPosition reports the band
    // as owner 'my' purely as a formality.
    const targetOwnerId =
      move.toZone === 'battle'
        ? ''
        : move.toOwner === 'shared'
        ? '0'
        : move.toOwner === 'my' && gameState.myPlayer
        ? String(gameState.myPlayer.id)
        : move.toOwner === 'opponent' && gameState.opponentPlayer
        ? String(gameState.opponentPlayer.id)
        : '';

    // Battle positions mirror by CARD owner, not by hit owner, so each
    // player's cards land on their own half of the band on both screens.
    if (move.toZone === 'battle') {
      if (!battleBandRect || !move.atPoint) {
        moveCard(id, 'battle', '', undefined, undefined, '');
        return;
      }
      const cardIsOpponents =
        !!card && String(card.ownerId) !== String(gameState.myPlayer?.id);
      const bOwner: 'my' | 'opponent' = cardIsOpponents ? 'opponent' : 'my';
      const bAdj = adjustAnchorForRotationChange(
        move.atPoint.x - cardWidth / 2,
        move.atPoint.y - cardHeight / 2,
        cardWidth, cardHeight, false, cardIsOpponents,
      );
      const bdb = toDbPos(bAdj.x, bAdj.y, battleBandRect, bOwner, { cardWidth, cardHeight });
      moveCard(id, 'battle', '', String(bdb.x), String(bdb.y), '');
      return;
    }

    const zoneRect =
      move.toOwner === 'shared'
        ? mpLayout?.zones.sharedLob
        : move.toOwner === 'opponent'
        ? opponentZones[move.toZone]
        : myZones[move.toZone];

    // Rail chips carry no point. For free-form territory the server default
    // parked every card flush against the zone's top-left corner — synthesize
    // a centered drop, staggered by how many cards are already there so
    // successive rail moves don't pile onto one spot.
    let atPoint = move.atPoint;
    if (!atPoint && zoneRect && isFreeFormZone(move.toZone)) {
      const existing =
        (move.toOwner === 'opponent' ? opponentCards[move.toZone] : myCards[move.toZone])?.length ?? 0;
      atPoint = {
        x: zoneRect.x + Math.min(
          zoneRect.width * 0.22 + (existing % 6) * cardWidth * 0.45,
          zoneRect.width - cardWidth / 2 - 8,
        ),
        y: zoneRect.y + zoneRect.height / 2,
      };
    }
    // A zone we can't resolve a rect for falls back to the server placing it.
    if (!atPoint || !zoneRect) {
      moveCard(id, move.toZone, '', undefined, undefined, targetOwnerId);
      return;
    }

    const targetOwner: 'my' | 'opponent' = move.toOwner === 'opponent' ? 'opponent' : 'my';
    const clampOpts = isFreeFormZone(move.toZone) ? { cardWidth, cardHeight } : undefined;

    // Opponent free-form zones render rotated 180, so toDbPos expects the
    // BOTTOM-RIGHT anchor there while our own zones expect the top-left. The
    // drag path corrects this via adjustAnchorForRotationChange; without the
    // same correction a tap into opponent territory landed a full card
    // up-and-left of where the player touched.
    const targetIsRotated = targetOwner === 'opponent' && isFreeFormZone(move.toZone);
    const { x: adjX, y: adjY } = adjustAnchorForRotationChange(
      atPoint.x - cardWidth / 2,
      atPoint.y - cardHeight / 2,
      cardWidth,
      cardHeight,
      false,          // a tap has no source-drag anchor
      targetIsRotated,
    );
    const db = toDbPos(adjX, adjY, zoneRect, targetOwner, clampOpts);
    moveCard(id, move.toZone, '', String(db.x), String(db.y), targetOwnerId);
  }, [gameState.myPlayer, gameState.opponentPlayer, moveCard, myZones, opponentZones, myCards, opponentCards, cardWidth, cardHeight, battleBandRect, mpLayout, findAnyCardById]);

  const {
    state: tapMoveState, dispatch: tapMoveDispatch, reset: tapMoveReset,
  } = useTapToMove(handleTapMoveCommit);
  // Mirror for handleStageTap: reading state through a ref keeps that callback
  // stable, so the Stage's onTap prop doesn't change on every arm/disarm.
  const tapMoveStateRef = useRef(tapMoveState);
  tapMoveStateRef.current = tapMoveState;

  // The opponent acts concurrently, so an armed card can change zone, be
  // discarded, or disappear while the rail is open. Committing then would
  // yank the card out of wherever it actually ended up.
  useEffect(() => {
    if (tapMoveState.kind !== 'armed') return;
    if (gameStatus !== 'playing') { tapMoveReset(); return; }
    const live = findAnyCardById(tapMoveState.cardId);
    if (!live) { tapMoveReset(); return; }
    const liveOwner = String(live.ownerId) === String(gameState.myPlayer?.id) ? 'my' : 'opponent';
    if (live.zone !== tapMoveState.sourceZone || liveOwner !== tapMoveState.sourceOwner) {
      tapMoveReset();
    }
  }, [tapMoveState, gameStatus, findAnyCardById, gameState.myPlayer, tapMoveReset]);

  // Lets global CSS lift the floating toolbar out of the rail's way.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const open = isTouch && tapMoveState.kind === 'armed';
    document.documentElement.setAttribute('data-rail-open', open ? 'true' : 'false');
    return () => document.documentElement.removeAttribute('data-rail-open');
  }, [isTouch, tapMoveState.kind]);

  // Armed-card cue: the instanceId the destination rail is about to move.
  // Every GameCardNode compares against this to draw its amber ring.
  const armedCardId = isTouch && tapMoveState.kind === 'armed' ? tapMoveState.cardId : null;

  // ---- Stage-level touch handlers ----
  const collectPointers = useCallback((evt: TouchEvent): PointerSample[] => {
    const stage = stageRef.current;
    if (!stage) return [];
    const box = stage.container().getBoundingClientRect();
    return Array.from(evt.touches).map((t, i) => ({
      id: t.identifier ?? i,
      x: t.clientX - box.left,
      y: t.clientY - box.top,
    }));
  }, []);

  /** Set by handleCardClick when a tap lands on a card, so the Stage-level tap
   *  that bubbles up afterwards doesn't also try to resolve a destination. */
  const cardTapHandledRef = useRef(false);
  /** Screen-space distance the current one-finger gesture has travelled. A pan
   *  is not a Konva drag, so Konva still emits tap/dbltap when it ends —
   *  without this a pan would commit a move, and two quick pans would reset
   *  the camera. */
  const touchTravelRef = useRef(0);
  const touchStartPtRef = useRef<{ x: number; y: number } | null>(null);
  /** True from the moment a gesture grows to two fingers until the next
   *  single-finger touchstart. Konva counts a pinch's finger-lifts as taps and
   *  fires stage tap AND dbltap when it ends, but the travel tracker above only
   *  accrues in the one-pointer branch — so without this flag every pinch ended
   *  by resetting the camera (dbltap) and, with a card armed, could commit a
   *  tapZone move at the release point. */
  const sawMultiTouchRef = useRef(false);
  /** Draggable nodes this gesture's fingers landed on. Konva ARMS a drag on
   *  touchstart and starts it once the finger travels past dragDistance, so a
   *  node is dangerous long before `isDraggingRef` knows about it. */
  const pendingDragNodesRef = useRef<Set<Konva.Node>>(new Set());

  const handleStageTouch = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    if (!isTouch) return;
    const pointers = collectPointers(e.evt);

    // Remember every draggable node a finger came down on, whichever finger it
    // was — the branch below only ever inspects one target, and a two-finger
    // gesture routinely lands on two different cards.
    if (e.type === 'touchstart') {
      const hitStage = e.target.getStage();
      let cur: Konva.Node | null = e.target as Konva.Node;
      while (cur && cur !== (hitStage as unknown as Konva.Node)) {
        if (typeof (cur as any).draggable === 'function' && (cur as any).draggable()) {
          pendingDragNodesRef.current.add(cur);
          break;
        }
        cur = cur.getParent();
      }
    }

    if (pointers.length === 1) {
      const p = pointers[0];
      if (e.type === 'touchstart') {
        touchStartPtRef.current = { x: p.x, y: p.y };
        touchTravelRef.current = 0;
        sawMultiTouchRef.current = false;
      } else if (!touchStartPtRef.current) {
        // Tail of a pinch: the first finger's lift nulled the baseline, and
        // the surviving finger keeps moving. Re-baseline for travel, but KEEP
        // sawMultiTouch and the accrued travel — clearing them here made the
        // pinch's final finger-lift read as a clean tap, and with a card
        // armed that committed a stray tapZone move at the release point.
        touchStartPtRef.current = { x: p.x, y: p.y };
      } else {
        const s = touchStartPtRef.current;
        touchTravelRef.current = Math.max(touchTravelRef.current, Math.hypot(p.x - s.x, p.y - s.y));
      }
    }

    // A second finger promotes the interaction to a pinch. Cancel any card
    // drag in flight first, otherwise the card stays glued to finger 1 while
    // the layer transform changes under it and commits wherever it lands.
    if (pointers.length >= 2) {
      sawMultiTouchRef.current = true;
      if (isDraggingRef.current) {
        dragCancelledRef.current = true;
        const node = draggedCardIdRef.current
          ? cardNodeRefs.current.get(draggedCardIdRef.current)
          : null;
        if (node && typeof (node as any).stopDrag === 'function') (node as any).stopDrag();
      }
      // Disarm drags Konva has readied but not yet started. Left armed, one
      // starts a frame or two into the pinch — and the moment ANY Konva drag
      // is live, Stage._pointermove returns before firing shape events, so the
      // stage stops delivering touchmove and the camera freezes after a single
      // frame. That is what made two-finger panning look like it moved the
      // board once and then gave up.
      if (pendingDragNodesRef.current.size > 0) {
        for (const node of pendingDragNodesRef.current) {
          // stopDrag fires a synchronous dragend, which this flag turns into a
          // no-op; a node that was only ARMED emits none, so clear it after.
          dragCancelledRef.current = true;
          if (typeof (node as any).stopDrag === 'function') (node as any).stopDrag();
        }
        pendingDragNodesRef.current.clear();
        dragCancelledRef.current = false;
      }
      if (e.type === 'touchmove' && isZoomed) setActiveJumpId(null);
      onCameraPointers(pointers);
      return;
    }

    // One finger pans from the background or any non-draggable zone surface —
    // the LoB bands, hand background and pile rects all listen (for menus)
    // and used to eat the pan, leaving big dead patches while zoomed. Only a
    // draggable ancestor chain (a card) claims the finger for a drag instead.
    const stage = e.target.getStage();
    if (e.target !== stage) {
      let cur: Konva.Node | null = e.target as Konva.Node;
      let onDraggable = false;
      while (cur && cur !== (stage as unknown as Konva.Node)) {
        if (typeof (cur as any).draggable === 'function' && (cur as any).draggable()) { onDraggable = true; break; }
        cur = cur.getParent();
      }
      if (onDraggable) return;
    }
    // Only while zoomed: at fit a pan is clamped to a no-op, so the framing is
    // still "Fit" and the button should stay lit.
    if (e.type === 'touchmove' && isZoomed) setActiveJumpId(null);
    onCameraPointers(pointers);
  }, [isTouch, isZoomed, onCameraPointers, collectPointers]);

  const handleStageTouchEnd = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    if (!isTouch) return;
    onCameraPointers(collectPointers(e.evt));
    touchStartPtRef.current = null;
    if ((e.evt.touches?.length ?? 0) === 0) pendingDragNodesRef.current.clear();
  }, [isTouch, onCameraPointers, collectPointers]);


  const handleStageTap = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const wasCardTap = cardTapHandledRef.current;
    cardTapHandledRef.current = false;
    // Do NOT zero touchTravelRef here: dbltap fires right after tap on the
    // same touchend, so clearing it made dbltap's travel guard read 0 and a
    // pan-pan or pinch ending looked like a clean double-tap. The next
    // single-finger touchstart resets it anyway.
    const travelled = touchTravelRef.current;

    if (!isTouch || tapMoveStateRef.current.kind !== 'armed') return;
    // The gesture was a pinch, not a tap — its finger-lifts still emit taps.
    if (sawMultiTouchRef.current) return;
    // The card's own tap already armed/disarmed; don't also resolve a zone.
    if (wasCardTap) return;
    // The gesture was a pan, not a tap.
    if (travelled > LONG_PRESS_MOVE_TOLERANCE) return;

    const stage = stageRef.current;
    if (!stage) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    // Hit-test the release point regardless of which shape Konva reports as
    // the target. Konva only names the Stage when the tap misses every
    // listening shape, and the LoB rects, all six sidebar piles, the shared
    // Paragon rects and the hand background all listen — so gating on
    // `e.target === stage` made tap-to-move work over territory alone.
    const v = screenToVirtual(pos.x, pos.y, scale, offsetX, offsetY);
    const hit = findZoneAtPosition(v.x, v.y);
    if (!hit) {
      tapMoveDispatch({ type: 'tapEmpty' });
      return;
    }
    tapMoveDispatch({
      type: 'tapZone',
      zone: hit.zone as ZoneId,
      owner: hit.owner,
      point: { x: v.x, y: v.y },
    });
  }, [isTouch, scale, offsetX, offsetY, findZoneAtPosition, tapMoveDispatch]);

  const handleStageDblTap = useCallback((e: Konva.KonvaEventObject<Event>) => {
    if (!isTouch) return;
    // Double-tap on a CARD toggles meek (existing behaviour); only a
    // background double-tap touches the camera.
    if (e.target !== e.target.getStage()) return;
    // A pinch ending is not a double-tap, even though Konva emits one.
    if (sawMultiTouchRef.current) return;
    // Two quick pans are not a double-tap.
    if (touchTravelRef.current > LONG_PRESS_MOVE_TOLERANCE) return;
    if (isZoomed) {
      // Through the fit TARGET, not resetCamera: identical in landscape (the
      // whole-board fit clamps to the default camera) but correct in portrait,
      // where 'fit' is the card-wide column framing.
      const fitTarget = jumpTargets.find((t) => t.id === 'fit');
      if (fitTarget && fitTarget.rect) {
        jumpToTarget(fitTarget);
      } else {
        resetCamera();
        setActiveJumpId('fit');
      }
    }
  }, [isTouch, isZoomed, resetCamera, jumpTargets, jumpToTarget]);


  const handleCardClick = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<MouseEvent>) => {
      // REG pre-game star step: while my selection window is open, clicking a
      // star card in my hand picks it for the reveal instead of touching
      // marquee selection. Ahead of the left-click counter so a second click
      // (un-picking) can't also trip the meek double-click. Star detection
      // reads the row's OWN specialAbility — never findCard(), which is blind
      // to Forge cards.
      if (starWindowOpen && card.zone === 'hand' && isStarAbilityText(card.specialAbility)) {
        toggleStarPick(BigInt(card.instanceId));
        return;
      }
      // isPrimaryPointer, not `=== 0`: a TouchEvent has no `button`, so the
      // strict comparison never incremented on touch and double-tap-to-meek
      // (which needs this counter >= 2) was dead on touch devices.
      if (isPrimaryPointer(e.evt)) leftClicksSinceContextMenuRef.current += 1;
      if (e.evt.shiftKey) {
        toggleSelect(card.instanceId);
        return;
      }
      // Touch spectator: a tap can't act, so it becomes "read this card" —
      // there is no hover loupe on a phone, and this was the one thing a
      // watching phone couldn't do at all. Hidden faces stay inert.
      if (isTouch && isSpectator) {
        if (!isCardFaceHiddenFromViewer(card)) setReaderCard(card);
        return;
      }
      // Touch: a tap arms the card for tap-to-move rather than only adjusting
      // selection. Spectators stay read-only. Runs after the click counter so
      // double-tap-to-meek still works.
      if (isTouch && !isSpectator) {
        cardTapHandledRef.current = true;
        // A tap on the OPPONENT'S card with nothing armed is "let me read
        // that", not "let me move their card" — arming it offered to pull
        // their card into the viewer's own zones, and one stray board tap
        // did it (live QA: a card silently landed in Mine · Discard). While
        // a card IS armed, the tap keeps its move semantics (commit into
        // battle / re-target), so armed flows are untouched.
        if (tapMoveStateRef.current.kind !== 'armed' && card.ownerId !== 'player1') {
          if (!isCardFaceHiddenFromViewer(card)) setReaderCard(card);
          return;
        }
        tapMoveDispatch({
          type: 'tapCard',
          cardId: card.instanceId,
          zone: card.zone as ZoneId,
          // GameCard.ownerId is the viewer-relative seat label ('player1' =
          // mine), NOT a player id — cardInstanceToGameCard sets it from the
          // render seat. Comparing it to myPlayer.id is always false, which
          // armed every card as 'opponent' and made the liveness effect below
          // (which reads the raw row's numeric ownerId) disarm on the next
          // render — tap-to-move never survived a live game's render churn.
          owner: card.ownerId === 'player1' ? 'my' : 'opponent',
        });
        return;
      }
      if (selectedIds.size > 0 && !selectedIds.has(card.instanceId)) {
        clearSelection();
      }
    },
    [selectedIds, clearSelection, toggleSelect, starWindowOpen, toggleStarPick, isTouch, isSpectator, tapMoveDispatch, isCardFaceHiddenFromViewer],
  );

  const handleCardContextMenu = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      e.cancelBubble = true;
      if (isSpectator) {
        // Right-click / long-press for a spectator opens the read-only card
        // reader, never the action menu. Hidden faces stay inert.
        if (!isCardFaceHiddenFromViewer(card)) setReaderCard(card);
        return;
      }
      leftClicksSinceContextMenuRef.current = 0;
      const stage = stageRef.current;
      if (!stage) return;
      const container = stage.container().getBoundingClientRect();

      // Clear hover state — dismiss both the glow AND the preview tooltip
      setHoveredInstanceId(null);
      setHoveredCard(null);
      setHoverReady(false);
      stopHoverAnimation();

      // Use viewport coordinates (clientX/Y) for fixed-position context menus
      const menuX = e.evt.clientX;
      const menuY = e.evt.clientY;

      // If right-clicking a selected card with multi-selection, show multi-card menu
      if (selectedIds.has(card.instanceId) && selectedIds.size > 1) {
        setMultiCardContextMenu({ x: menuX, y: menuY });
      } else {
        // Clear selection if right-clicking an unselected card
        if (selectedIds.size > 0 && !selectedIds.has(card.instanceId)) {
          clearSelection();
        }
        setContextMenu({ card, x: menuX, y: menuY });
      }
    },
    [stopHoverAnimation, selectedIds, clearSelection, isSpectator, isCardFaceHiddenFromViewer],
  );
  /** Touch equivalent of right-click. Reuses handleCardContextMenu unchanged;
   *  it reads clientX/clientY off the event and positions from stageRef, so a
   *  synthetic event carrying the press point is enough. */
  const handleCardLongPress = useCallback((card: GameCard, p: { x: number; y: number }) => {
    // GameCardNode calls this immediately before stopDrag(). Marking the drag
    // cancelled here makes the resulting dragend a no-op instead of a move.
    if (isDraggingRef.current) dragCancelledRef.current = true;
    handleCardContextMenu(card, {
      evt: { clientX: p.x, clientY: p.y, preventDefault() {} },
      cancelBubble: false,
    } as unknown as Konva.KonvaEventObject<PointerEvent>);
  }, [handleCardContextMenu]);

  /** The player kept dragging after the long-press menu appeared: they were
   *  aiming, not asking for a menu. Take it back rather than making them
   *  dismiss something they never wanted. */
  const handleCardLongPressCancel = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Double-click toggles meek on any card (yours or an opponent's you control)
  const handleDblClick = useCallback((card: GameCard) => {
    if (leftClicksSinceContextMenuRef.current < 2) return;
    // Any player may toggle meek; spectators are read-only.
    if (!canViewerToggleMeek(isSpectator ? 'spectator' : 'player')) return;
    const willBeMeek = !card.isMeek;
    if (card.isMeek) {
      multiplayerActions.unmeekCard(card.instanceId);
    } else {
      multiplayerActions.meekCard(card.instanceId);
    }
    setPreviewCard({
      cardName: card.cardName,
      cardImgFile: card.cardImgFile,
      isMeek: willBeMeek,
      notes: card.notes,
    });
  }, [multiplayerActions, setPreviewCard, isSpectator]);
  const noopDblClick = useCallback((_card: GameCard) => {}, []);
  const noopContextMenu = useCallback((_card: GameCard, _e: Konva.KonvaEventObject<PointerEvent>) => {}, []);
  const noopMouseEnter = useCallback((_card: GameCard, _e: Konva.KonvaEventObject<MouseEvent>) => {}, []);
  const noopMouseLeave = useCallback(() => {}, []);

  const handleMouseEnter = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<MouseEvent>) => {
      if (isDraggingRef.current) return;
      // Ignore Konva re-firing mouseEnter immediately after a drag ends
      if (performance.now() - dragEndTimeRef.current < 100) return;
      setHoveredInstanceId(card.instanceId);
      startHoverAnimation();

      // Don't preview face-down (hidden-info) cards. A player never sees the
      // opponent's; a spectator sees neither side's UNLESS that card's owner has
      // shared with spectators (same consent flag as the hand/reserve). Actively
      // revealed cards (revealUntil) are public to everyone, so always allowed.
      const revealedNow =
        typeof card.revealUntil === 'number' && card.revealUntil > Date.now();
      if (
        card.isFlipped &&
        !revealedNow &&
        !isFaceDownInPlayCardVisible(
          isSpectator ? 'spectator' : 'player',
          card.ownerId,
          { myShareHand, oppShareHand },
        )
      ) {
        setHoveredCard(null);
        return;
      }

      setHoveredCard(card);
      // Capture mouse position for the hover preview tooltip
      const pos = { x: e.evt.clientX, y: e.evt.clientY };
      mousePosRef.current = pos;
      setMousePos(pos);
      // Start 250ms delay before showing hover preview
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      setHoverReady(false);
      hoverTimerRef.current = setTimeout(() => setHoverReady(true), 250);
    },
    [startHoverAnimation, isSpectator, myShareHand, oppShareHand],
  );

  const handleMouseLeave = useCallback(() => {
    cancelPendingMousePos();
    setHoveredInstanceId(null);
    setHoveredCard(null);
    stopHoverAnimation();
    // Clear hover preview delay
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    setHoverReady(false);
  }, [stopHoverAnimation, cancelPendingMousePos]);

  // ---- LOB layout: host + attached-accessory positions ----
  // LOB packs cards in a horizontal strip. Attached sites render BEHIND the
  // host, with a small portion peeking upward (my side) or downward (opponent
  // side, rotated 180°). `LOB_ATTACH_PEEK_VISIBLE_RATIO` is the fraction of
  // the site's height that pokes out beyond the host — the rest (e.g. 85%)
  // tucks behind. Hosts still use plain auto-arrange slots (no extra slot).
  const LOB_ATTACH_PEEK_VISIBLE_RATIO = 0.15;

  const myLobLayout = useMemo(() => {
    const hostPositions = new Map<string, { x: number; y: number }>();
    const accessoryPositions = new Map<
      string,
      { x: number; y: number; seamX: number; seamY: number }
    >();
    const cards = myCards['land-of-bondage'] ?? [];
    const zone = myZones['land-of-bondage'];
    if (!zone || cards.length === 0) {
      return { hostPositions, accessoryPositions };
    }
    const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
    const { hosts, accessoriesByHost } = splitLobCards(sorted);
    const slotPositions = calculateAutoArrangePositions(
      hosts.length,
      zone,
      lobCard.cardWidth,
      lobCard.cardHeight,
    );
    const peekUp = lobCard.cardHeight * LOB_ATTACH_PEEK_VISIBLE_RATIO;
    hosts.forEach((host, i) => {
      const hostSlot = slotPositions[i];
      if (!hostSlot) return;
      hostPositions.set(String(host.id), hostSlot);
      const accessories = accessoriesByHost.get(host.id);
      if (!accessories) return;
      accessories.forEach((acc, ai) => {
        // Accessory sits directly above the host, 15% visible above, 85%
        // tucked behind. Each stacked accessory (rare) peeks a bit higher
        // than the previous.
        const ay = hostSlot.y - peekUp * (ai + 1);
        accessoryPositions.set(String(acc.id), {
          x: hostSlot.x,
          y: ay,
          // Seam in the overlap band (between accessory's bottom and host's
          // top), horizontally centered on the host.
          seamX: hostSlot.x + lobCard.cardWidth * 0.5,
          seamY: hostSlot.y,
        });
      });
    });
    return { hostPositions, accessoryPositions };
  }, [myCards, myZones, lobCard.cardWidth, lobCard.cardHeight]);

  const opponentLobLayout = useMemo(() => {
    const hostPositions = new Map<string, { x: number; y: number }>();
    const accessoryPositions = new Map<string, { x: number; y: number }>();
    const cards = opponentCards['land-of-bondage'] ?? [];
    const zone = opponentZones['land-of-bondage'];
    if (!zone || cards.length === 0) {
      return { hostPositions, accessoryPositions };
    }
    const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
    const { hosts, accessoriesByHost } = splitLobCards(sorted);
    const slotPositions = calculateAutoArrangePositions(
      hosts.length,
      zone,
      lobCard.cardWidth,
      lobCard.cardHeight,
    );
    const peekAmount = lobCard.cardHeight * LOB_ATTACH_PEEK_VISIBLE_RATIO;
    hosts.forEach((host, i) => {
      const hostSlot = slotPositions[i];
      if (!hostSlot) return;
      hostPositions.set(String(host.id), hostSlot);
      const accessories = accessoriesByHost.get(host.id);
      if (!accessories) return;
      accessories.forEach((acc, ai) => {
        // Opponent LOB renders rotated 180°. The site should peek DOWNWARD
        // in screen coords (toward the center of the play area) so it's
        // visually oriented toward the player who owns it.
        // Accessory visual rect: (slot.x, slot.y + peekAmount*(ai+1)) to
        //                         (slot.x + w, slot.y + h + peekAmount*(ai+1)).
        // Anchor for rotation=180 is bottom-right.
        const anchorX = hostSlot.x + lobCard.cardWidth;
        const anchorY = hostSlot.y + lobCard.cardHeight + peekAmount * (ai + 1);
        accessoryPositions.set(String(acc.id), {
          x: anchorX,
          y: anchorY,
        });
      });
    });
    return { hostPositions, accessoryPositions };
  }, [opponentCards, opponentZones, lobCard.cardWidth, lobCard.cardHeight]);

  // Paragon-only: shared LoB hosts/accessory positions. Three FIXED slots
  // indexed by zoneIndex so rescued souls' slots stay empty (no visual shift)
  // until the refill re-populates the same slot.
  const sharedLobLayout = useMemo(() => {
    const hostPositions = new Map<string, { x: number; y: number }>();
    const accessoryPositions = new Map<
      string,
      { x: number; y: number; seamX: number; seamY: number }
    >();
    const cards = sharedCards['land-of-bondage'] ?? [];
    const zone = mpLayout?.zones.sharedLob;
    if (!zone || cards.length === 0) {
      return { hostPositions, accessoryPositions };
    }
    const { hosts, accessoriesByHost } = splitLobCards(cards);
    // Base 3 slots (canonical rescue-slot grid). Expand the grid if any host
    // has zoneIndex beyond slot 2 — e.g., a stray card dropped into an
    // overflow slot must render in its own position, not stacked on slot 0.
    const maxZoneIdx = hosts.reduce<number>(
      (m, h) => Math.max(m, Number(h.zoneIndex)),
      -1,
    );
    const SHARED_SLOT_COUNT = Math.max(3, maxZoneIdx + 1);
    const slotPositions = calculateAutoArrangePositions(
      SHARED_SLOT_COUNT,
      zone,
      lobCard.cardWidth,
      lobCard.cardHeight,
    );
    const peekUp = lobCard.cardHeight * LOB_ATTACH_PEEK_VISIBLE_RATIO;
    for (const host of hosts) {
      // Place each host at its zoneIndex-indexed slot; out-of-range hosts
      // fall back to the first empty slot so we never silently drop them.
      const idx = Number(host.zoneIndex);
      const hostSlot = slotPositions[idx] ?? slotPositions[0];
      if (!hostSlot) continue;
      hostPositions.set(String(host.id), hostSlot);
      const accessories = accessoriesByHost.get(host.id);
      if (!accessories) continue;
      accessories.forEach((acc, ai) => {
        const ay = hostSlot.y - peekUp * (ai + 1);
        accessoryPositions.set(String(acc.id), {
          x: hostSlot.x,
          y: ay,
          seamX: hostSlot.x + lobCard.cardWidth * 0.5,
          seamY: hostSlot.y,
        });
      });
    }
    return { hostPositions, accessoryPositions };
  }, [sharedCards, mpLayout, lobCard.cardWidth, lobCard.cardHeight]);

  // Smooth LOB re-layout: when a soul is rescued/removed the remaining cards
  // glide to their new slots instead of snapping. Rotation matches each
  // strip's render (mine/shared 0°, opponent's 180°).
  const lobSlots = useMemo(() => {
    const m = new Map<string, { x: number; y: number; rotation: number }>();
    for (const [id, p] of myLobLayout.hostPositions) m.set(id, { x: p.x, y: p.y, rotation: 0 });
    for (const [id, p] of myLobLayout.accessoryPositions) m.set(id, { x: p.x, y: p.y, rotation: 0 });
    // Opponent hosts render rotated 180° anchored at the slot's bottom-right
    // corner (x+cardWidth, y+cardHeight) — see the opponent LoB render. The
    // glide target must use that SAME anchor, or useHandLayoutTween drags each
    // host a full card up-and-left of its slot; clipping to the zone then
    // leaves only a sliver visible on the opponent's view. Opponent accessory
    // positions already bake the rotated anchor in, so they pass through as-is.
    for (const [id, p] of opponentLobLayout.hostPositions)
      m.set(id, { x: p.x + lobCard.cardWidth, y: p.y + lobCard.cardHeight, rotation: 180 });
    for (const [id, p] of opponentLobLayout.accessoryPositions) m.set(id, { x: p.x, y: p.y, rotation: 180 });
    for (const [id, p] of sharedLobLayout.hostPositions) m.set(id, { x: p.x, y: p.y, rotation: 0 });
    for (const [id, p] of sharedLobLayout.accessoryPositions) m.set(id, { x: p.x, y: p.y, rotation: 0 });
    return m;
  }, [myLobLayout, opponentLobLayout, sharedLobLayout, lobCard.cardWidth, lobCard.cardHeight]);
  useHandLayoutTween(lobSlots, cardNodeRefs);

  // ---- Derive per-accessory screen positions + seam (for detach overlay) ----
  // Accessories (weapons in territory, sites in LOB) don't use their own posX/
  // posY at render time — they're anchored to their host at an offset so they
  // peek out from behind. `seam` is the point where the accessory meets the
  // host, used to position the "unlink" icon.
  const myDerivedWeaponPositions = useMemo(() => {
    const result = new Map<string, { x: number; y: number; seamX: number; seamY: number }>();

    // Territory attachments (warrior + weapon)
    const territory = myCards['territory'] ?? [];
    const myTerrZone = myZones['territory'];
    if (myTerrZone && territory.length > 0) {
      const byHost = new Map<bigint, CardInstance[]>();
      for (const c of territory) {
        if (c.equippedToInstanceId === 0n) continue;
        const list = byHost.get(c.equippedToInstanceId);
        if (list) list.push(c);
        else byHost.set(c.equippedToInstanceId, [c]);
      }
      for (const [hostId, accessories] of byHost) {
        const host = territory.find((c) => c.id === hostId);
        if (!host || !host.posX) continue;
        const { x: hostX, y: hostY } = toScreenPos(
          parseFloat(host.posX),
          parseFloat(host.posY),
          myTerrZone,
          'my',
        );
        accessories.forEach((w, i) => {
          const { dx, dy } = computeEquipOffset(cardWidth, cardHeight, i);
          const x = hostX + dx;
          const y = hostY + dy;
          const seam =
            i === 0
              ? { x: hostX, y: hostY }
              : (() => {
                  const { dx: adx, dy: ady } = computeEquipOffset(cardWidth, cardHeight, i - 1);
                  return { x: hostX + adx, y: hostY + ady };
                })();
          result.set(String(w.id), { x, y, seamX: seam.x, seamY: seam.y });
        });
      }
    }

    // LOB attachments (soul + site) — positions come from `myLobLayout`.
    for (const [id, pos] of myLobLayout.accessoryPositions) {
      result.set(id, pos);
    }

    return result;
  }, [myCards, myZones, cardWidth, cardHeight, myLobLayout]);

  // Opponent accessory offsets are mirror-flipped (opponent zones render
  // rotated 180° from the local player's perspective). Seams aren't tracked
  // for the opponent since detach is local-player-only.
  const opponentDerivedWeaponPositions = useMemo(() => {
    const result = new Map<string, { x: number; y: number }>();

    // Territory attachments (warrior + weapon)
    const territory = opponentCards['territory'] ?? [];
    const oppTerrZone = opponentZones['territory'];
    if (oppTerrZone && territory.length > 0) {
      const byHost = new Map<bigint, CardInstance[]>();
      for (const c of territory) {
        if (c.equippedToInstanceId === 0n) continue;
        const list = byHost.get(c.equippedToInstanceId);
        if (list) list.push(c);
        else byHost.set(c.equippedToInstanceId, [c]);
      }
      for (const [hostId, accessories] of byHost) {
        const host = territory.find((c) => c.id === hostId);
        if (!host || !host.posX) continue;
        const { x: hostX, y: hostY } = toScreenPos(
          parseFloat(host.posX),
          parseFloat(host.posY),
          oppTerrZone,
          'opponent',
        );
        accessories.forEach((w, i) => {
          const { dx, dy } = computeEquipOffset(cardWidth, cardHeight, i);
          // Rotation=180 anchors cards at their bottom-right; flipping the offset
          // sign places accessories visually up-and-left from the opponent's perspective.
          result.set(String(w.id), { x: hostX - dx, y: hostY - dy });
        });
      }
    }

    // LOB attachments (soul + site) — positions come from `opponentLobLayout`.
    for (const [id, pos] of opponentLobLayout.accessoryPositions) {
      result.set(id, pos);
    }

    return result;
  }, [opponentCards, opponentZones, cardWidth, cardHeight, opponentLobLayout]);

  // ---- Derive battle-band weapon offsets (same math as territory, anchored
  // to the band rect instead) ----
  // Mirrors by CARD ownership (myCards['battle'] / opponentCards['battle']),
  // matching the battle render's split — NOT by hit owner, since the battle
  // hit-test always reports owner 'my' as a formality (see
  // findZoneAtPosition). No seam tracking: battle doesn't have a detach
  // ("unlink") affordance yet, so these maps are render-only.
  const myBattleDerivedWeaponPositions = useMemo(() => {
    const result = new Map<string, { x: number; y: number }>();
    const battle = myCards['battle'] ?? [];
    if (!battleBandRect || battle.length === 0) return result;
    const byHost = new Map<bigint, CardInstance[]>();
    for (const c of battle) {
      if (c.equippedToInstanceId === 0n) continue;
      const list = byHost.get(c.equippedToInstanceId);
      if (list) list.push(c);
      else byHost.set(c.equippedToInstanceId, [c]);
    }
    for (const [hostId, accessories] of byHost) {
      const host = battle.find((c) => c.id === hostId);
      if (!host || !host.posX) continue;
      const { x: hostX, y: hostY } = toScreenPos(
        parseFloat(host.posX),
        parseFloat(host.posY),
        battleBandRect,
        'my',
      );
      accessories.forEach((w, i) => {
        const { dx, dy } = computeEquipOffset(cardWidth, cardHeight, i);
        result.set(String(w.id), { x: hostX + dx, y: hostY + dy });
      });
    }
    return result;
  }, [myCards, battleBandRect, cardWidth, cardHeight]);

  // Opponent battle accessory offsets are mirror-flipped (the opponent's
  // half of the band renders rotated 180°) — same convention as
  // `opponentDerivedWeaponPositions` for territory.
  const opponentBattleDerivedWeaponPositions = useMemo(() => {
    const result = new Map<string, { x: number; y: number }>();
    const battle = opponentCards['battle'] ?? [];
    if (!battleBandRect || battle.length === 0) return result;
    const byHost = new Map<bigint, CardInstance[]>();
    for (const c of battle) {
      if (c.equippedToInstanceId === 0n) continue;
      const list = byHost.get(c.equippedToInstanceId);
      if (list) list.push(c);
      else byHost.set(c.equippedToInstanceId, [c]);
    }
    for (const [hostId, accessories] of byHost) {
      const host = battle.find((c) => c.id === hostId);
      if (!host || !host.posX) continue;
      const { x: hostX, y: hostY } = toScreenPos(
        parseFloat(host.posX),
        parseFloat(host.posY),
        battleBandRect,
        'opponent',
      );
      accessories.forEach((w, i) => {
        const { dx, dy } = computeEquipOffset(cardWidth, cardHeight, i);
        result.set(String(w.id), { x: hostX - dx, y: hostY - dy });
      });
    }
    return result;
  }, [opponentCards, battleBandRect, cardWidth, cardHeight]);

  // ---- FLIP glides: territory + battle-band reflows (Task 15 spec §4) ----
  // Extends the useHandLayoutTween slot-map pattern used above for hand
  // slots and lobSlots: when the band opens/closes, territories
  // compress/expand and existing cards reflow to new screen positions — this
  // glides them instead of snapping. Each slot's x/y/rotation must exactly
  // match what the render below assigns as GameCardNode props (same
  // toScreenPos + clamp math, same weapon-offset maps), or the tween's
  // target would fight the JSX-asserted value on the next render.
  //
  // Scope cut: territory<->battle CROSSING moves (a card entering the band
  // on open, or auto-returning to territory on close) are NOT glided here —
  // each zone renders its cards inside its own clipped Konva Group, so a
  // card crossing zones unmounts from one Group and mounts fresh in the
  // other; there's no single persistent Konva node to tween across that
  // boundary without restructuring the render into one unclipped group.
  // Those moves snap — consistent with how a card's first appearance in any
  // of these slot maps already never tweens (same convention as hand/LOB
  // deals). Within-zone reflows (territory compress/expand; a battle card
  // repositioning while others remain) DO glide via the maps below.
  const territorySlots = useMemo(() => {
    const m = new Map<string, { x: number; y: number; rotation: number }>();
    const myTerrZone = myZones['territory'];
    if (myTerrZone) {
      for (const card of myCards['territory'] ?? []) {
        if (card.equippedToInstanceId !== 0n) {
          const derived = myDerivedWeaponPositions.get(String(card.id));
          if (derived) {
            m.set(String(card.id), { x: derived.x, y: derived.y, rotation: 0 });
            continue;
          }
        }
        let x: number, y: number;
        if (card.posX) {
          ({ x, y } = toScreenPos(parseFloat(card.posX), parseFloat(card.posY), myTerrZone, 'my'));
        } else {
          x = myTerrZone.x + 20;
          y = myTerrZone.y + 24;
        }
        y = Math.min(y, myTerrZone.y + myTerrZone.height - cardHeight);
        m.set(String(card.id), { x, y, rotation: 0 });
      }
    }
    const oppTerrZone = opponentZones['territory'];
    if (oppTerrZone) {
      for (const card of opponentCards['territory'] ?? []) {
        if (card.equippedToInstanceId !== 0n) {
          const derived = opponentDerivedWeaponPositions.get(String(card.id));
          if (derived) {
            m.set(String(card.id), { x: derived.x, y: derived.y, rotation: 180 });
            continue;
          }
        }
        const { x: rawX, y: rawY } = toScreenPos(
          card.posX ? parseFloat(card.posX) : 0,
          card.posY ? parseFloat(card.posY) : 0,
          oppTerrZone,
          'opponent',
        );
        const y = Math.max(rawY, oppTerrZone.y + cardHeight);
        m.set(String(card.id), { x: rawX, y, rotation: 180 });
      }
    }
    return m;
  }, [myCards, opponentCards, myZones, opponentZones, cardHeight, myDerivedWeaponPositions, opponentDerivedWeaponPositions]);
  useHandLayoutTween(territorySlots, cardNodeRefs);

  const battleSlots = useMemo(() => {
    const m = new Map<string, { x: number; y: number; rotation: number }>();
    const band = mpLayout?.zones.battle;
    if (!band) return m;
    for (const card of myCards['battle'] ?? []) {
      if (card.equippedToInstanceId !== 0n) {
        const derived = myBattleDerivedWeaponPositions.get(String(card.id));
        if (derived) {
          m.set(String(card.id), { x: derived.x, y: derived.y, rotation: 0 });
          continue;
        }
      }
      let x: number, y: number;
      if (card.posX) {
        ({ x, y } = toScreenPos(parseFloat(card.posX), parseFloat(card.posY), band, 'my'));
      } else {
        x = band.x + 20;
        y = band.y + 24;
      }
      y = Math.min(y, band.y + band.height - cardHeight);
      m.set(String(card.id), { x, y, rotation: 0 });
    }
    for (const card of opponentCards['battle'] ?? []) {
      if (card.equippedToInstanceId !== 0n) {
        const derived = opponentBattleDerivedWeaponPositions.get(String(card.id));
        if (derived) {
          m.set(String(card.id), { x: derived.x, y: derived.y, rotation: 180 });
          continue;
        }
      }
      const { x: rawX, y: rawY } = toScreenPos(
        card.posX ? parseFloat(card.posX) : 0,
        card.posY ? parseFloat(card.posY) : 0,
        band,
        'opponent',
      );
      const y = Math.max(rawY, band.y + cardHeight);
      m.set(String(card.id), { x: rawX, y, rotation: 180 });
    }
    return m;
  }, [myCards, opponentCards, mpLayout, cardHeight, myBattleDerivedWeaponPositions, opponentBattleDerivedWeaponPositions]);
  useHandLayoutTween(battleSlots, cardNodeRefs);

  // ---- Battle Zone chrome derived state (spec §5/§6, Task 12) ----
  // BattleCardLike[] built from the live battle rows (my + opponent-owned).
  // dbX is read straight off posX — already owner-local, no viewer flip
  // (spec §3: every player plays into their own right half). cardRelW uses
  // the layout's UNSCALED mainCard width (not the cardScale-zoomed
  // `cardWidth` used for actual rendering) so side derivation stays
  // consistent regardless of either viewer's zoom preference — both clients
  // compute the same band-relative ratio from the same mpLayout inputs.
  const battleCardEntries = useMemo<BattleCardEntry[]>(() => {
    if (!battleActive || !mpLayout?.zones.battle) return [];
    const band = mpLayout.zones.battle;
    const cardRelW = band.width > 0 ? rawMain.cardWidth / band.width : 0;
    const mySeat = gameState.myPlayer ? (String(gameState.myPlayer.seat) as BattleSeat) : null;
    const oppSeat = gameState.opponentPlayer ? (String(gameState.opponentPlayer.seat) as BattleSeat) : null;
    const entries: BattleCardEntry[] = [];
    const pushRows = (rows: CardInstance[] | undefined, owner: 'my' | 'opponent', seat: BattleSeat | null) => {
      if (!seat || !rows) return;
      for (const row of rows) {
        // Forge rows carry blanked name/brigade/stats (leak spine) — the
        // viewer's granted resolver re-hydrates them here or forge cards
        // read as unknown stats and false brigade mismatches in the band.
        // specialAbility stays the raw row value on purpose: the auto-return
        // summary must predict the server, which only sees the blanked row
        // (see resolveBattleRowFields).
        const resolved = resolveBattleRowFields(row, forgeResolver);
        // Dual-icon cards (Nebuchadnezzar (PoC) and friends) carry BOTH
        // printed stat lines in one slash-joined field; resolve down to the
        // side matching the row's alignment before anything parses a number
        // out of it, or parseInt silently takes the left (good) segment and
        // counts an 11/10 Evil Character as a 4/3 Hero. See
        // parseAlignmentStats. Runs BEFORE the meek read so a meek value is
        // looked for inside the already-chosen side.
        const sideStats = parseAlignmentStats(resolved.strength, resolved.toughness, row.alignment);
        const sidedStr = sideStats ? sideStats.strength : resolved.strength;
        const sidedTgh = sideStats ? sideStats.toughness : resolved.toughness;
        // Meek hero/character in battle must count its meek-side power/
        // toughness, not its normal-side stats (spec: Matthias converted to
        // meek is 7/7). The meek value lives in the row's own strength/
        // toughness string ("<normal>(<meek>)") — see parseMeekStats. Falls
        // through to the normal-side string unchanged when unresolvable
        // (non-meek card, blanked Forge field), matching existing ? handling.
        const meekStats = row.isMeek ? parseMeekStats(sidedStr, sidedTgh) : null;
        entries.push({
          row,
          owner,
          like: {
            ownerSeat: seat,
            dbX: parseFloat(row.posX || '0'),
            cardRelW,
            strength: meekStats ? String(meekStats.strength) : sidedStr,
            toughness: meekStats ? String(meekStats.toughness) : sidedTgh,
            brigade: resolved.brigade,
            cardType: row.cardType,
            specialAbility: row.specialAbility,
            isFlipped: row.isFlipped,
            cardName: resolved.cardName,
            equippedToInstanceId: row.equippedToInstanceId,
            originZone: row.originZone,
          },
        });
      }
    };
    pushRows(myCards['battle'], 'my', mySeat);
    pushRows(opponentCards['battle'], 'opponent', oppSeat);
    return entries;
  }, [battleActive, mpLayout, rawMain.cardWidth, gameState.myPlayer, gameState.opponentPlayer, myCards, opponentCards, forgeResolver]);

  // Stakes Lost Soul rows (spec §5 header: Rescue attempt vs. Battle
  // challenge; spec §7/§8: Task 14's awaiting-soul picker eligibility).
  // Mirrors the server's battleStakesLobLostSouls exactly: T1/T2 use the
  // DEFENDER's land-of-bondage; Paragon uses the shared LoB. Single source
  // of truth for both the header count and the surrender-dialog grid so
  // they can never drift apart.
  const stakesLostSoulRows = useMemo<CardInstance[]>(() => {
    if (!battleActive) return [];
    if (normalizedFormat === 'Paragon') {
      return (sharedCards['land-of-bondage'] ?? []).filter(isBattleLostSoulRow);
    }
    const attackerSeat = gameState.battleAttackerSeat;
    if (!attackerSeat) return [];
    const mySeatStr = gameState.myPlayer ? String(gameState.myPlayer.seat) : '';
    const oppSeatStr = gameState.opponentPlayer ? String(gameState.opponentPlayer.seat) : '';
    const defenderRows =
      attackerSeat === mySeatStr ? (opponentCards['land-of-bondage'] ?? [])
      : attackerSeat === oppSeatStr ? (myCards['land-of-bondage'] ?? [])
      : [];
    return defenderRows.filter(isBattleLostSoulRow);
  }, [battleActive, normalizedFormat, sharedCards, gameState.battleAttackerSeat, gameState.myPlayer, gameState.opponentPlayer, myCards, opponentCards]);

  const stakesLostSoulCount = stakesLostSoulRows.length;

  // Which stakes souls have a Site attached — for the surrender picker's
  // "⚑ in Site" badge. The attachment link lives on the ACCESSORY row
  // (attach_card writes equippedToInstanceId on the Site, pointing at the
  // soul; a soul's own equippedToInstanceId is always 0n), so membership is
  // derived by scanning every card row for one pointing at a stakes soul.
  const stakesSiteAttachedSoulIds = useMemo<Set<string>>(() => {
    if (stakesLostSoulRows.length === 0) return new Set<string>();
    const allRows: CardInstance[] = [];
    for (const rows of Object.values(myCards)) allRows.push(...rows);
    for (const rows of Object.values(opponentCards)) allRows.push(...rows);
    for (const rows of Object.values(sharedCards)) allRows.push(...rows);
    return siteAttachedSoulIds(stakesLostSoulRows, allRows);
  }, [stakesLostSoulRows, myCards, opponentCards, sharedCards]);

  // Field of Battle band — chrome (Task 12, spec §5/§6): totals chips,
  // header line, initiative banner. Rendered AFTER the battle card groups
  // (below, in JSX) so it sits above card art. listening={false}
  // throughout — nothing here is clickable (drags must pass through); the
  // one interactive element (the brigade-mismatch Discard toast) is a
  // separate HTML overlay, not part of this Konva group. Gates on
  // status==='playing' && battleActive, same as the background block.
  //
  // Wrapped in useMemo (not an inline IIFE), matching every other derived
  // battle/layout value in this component (myZones, derivedWeaponPositions,
  // battleCardEntries, etc.) — avoids rebuilding ~15 Konva primitives on
  // unrelated re-renders, e.g. the per-frame ticks MultiplayerCanvas gets
  // from useRevealTick while any card's post-draw reveal flash is active.
  // Snapshot of the last rendered chrome element, replayed verbatim during the
  // close fade: once battleActive drops the battle rows are gone (totals would
  // read 0/0) and mpLayout has no battle rect, but the fade tween needs a
  // stable node to animate. The cached element carries the same "battle-chrome"
  // key, so react-konva keeps the same Konva node and the tween runs on it.
  const lastBattleChromeRef = useRef<React.ReactNode>(null);
  const battleChromeNode = useMemo(() => {
    if (gameStatus !== 'playing') return null;
    // Closing fade: replay the last snapshot while bandBgVisible keeps the
    // band mounted; otherwise there's nothing to show.
    if (!battleActive || !mpLayout?.zones.battle) {
      return bandBgVisible ? lastBattleChromeRef.current : null;
    }
    const band = mpLayout.zones.battle;
    const midX = band.x + band.width / 2;

    const mySeatStr = gameState.myPlayer ? String(gameState.myPlayer.seat) : '';
    const oppSeatStr = gameState.opponentPlayer ? String(gameState.opponentPlayer.seat) : '';
    const attackerSeat = gameState.battleAttackerSeat;
    // Defensive — the server always stamps battleAttackerSeat before
    // battleState flips to 'active' (spec §7), so this should never be
    // empty while battleActive is true.
    if (!attackerSeat) return null;

    const nameForSeat = (seat: string): string => {
      if (seat === mySeatStr) return gameState.myPlayer?.displayName || 'You';
      if (seat === oppSeatStr) return gameState.opponentPlayer?.displayName || 'Opponent';
      return 'Player';
    };

    const battleLikes = battleCardEntries.map((e) => e.like);
    const myTotals = mySeatStr ? sideTotals(battleLikes, mySeatStr as BattleSeat) : { str: 0, tgh: 0, hasUnknown: false };
    const oppTotals = oppSeatStr ? sideTotals(battleLikes, oppSeatStr as BattleSeat) : { str: 0, tgh: 0, hasUnknown: false };

    // No ⚔ prefixes anywhere in this chrome: Konva canvas text gets no emoji
    // fallback, so U+2694 rendered as a bare "×"-looking glyph (PR #197 UX
    // review F5). The HTML resolution buttons keep their glyphs — the DOM
    // renders them fine.
    //
    // ONE adaptive header line (owner direction, replacing the floating
    // status strip that used to render below the band — it sat on top of
    // territory cards and competed with the header + chips for attention).
    // The live status REPLACES the base "<attacker> attacking — <stakes>"
    // line (appending both read too wordy — owner feedback); the base line
    // only shows while there's no status to report: band just opened
    // (kind 'empty') or during 'awaiting-soul' (the pill/picker carries
    // that state), which also keeps reconnecting players and spectators
    // oriented.
    const initiative = computeInitiative(
      battleLikes,
      attackerSeat as BattleSeat,
      (gameState.lastBattlePlayBySeat || '') as BattleSeat | '',
    );
    let statusText = '';
    if (gameState.battleState === 'active') {
      switch (initiative.kind) {
        case 'empty':
          // No characters on either side — the drag-guidance cue carries
          // the instruction (UX review F2).
          break;
        case 'waiting-blocker':
          // Side-neutral: also shown after the only blocker was defeated
          // and dragged to discard (UX review F3).
          statusText = 'No blocker in battle';
          break;
        case 'no-attacker':
          statusText = 'No attacker in battle';
          break;
        case 'unknown':
          statusText = 'Initiative unknown (variable stats)';
          break;
        case 'initiative': {
          const reasonLabel = initiative.reason === 'mutual-destruction' ? 'mutual destruction' : initiative.reason;
          statusText = `Initiative: ${nameForSeat(initiative.seat)} (${reasonLabel})`;
          break;
        }
      }
    } else if (gameState.battleState === 'awaiting-soul') {
      // The soul-pick status lives here too (owner direction) — the old
      // in-band pill next to the End Battle button read as a second button
      // and collided with the totals chips. Chooser mirrors the server's
      // surrender_soul rule: T1 the defender picks, T2/Paragon the attacker.
      const defenderSeat = attackerSeat === '0' ? '1' : '0';
      const chooserSeat = normalizedFormat === 'T1' ? defenderSeat : attackerSeat;
      statusText = `Waiting for ${nameForSeat(chooserSeat)} to choose a soul…`;
    }
    const headerText =
      statusText ||
      `${nameForSeat(attackerSeat)} attacking — ${stakesLostSoulCount >= 1 ? 'Rescue attempt' : 'Battle challenge'}`;

    const chipWidth = 64 * fsGrowth(11);
    const chipHeight = 20;
    // Two "0/0" chips over an empty band are noise — chips appear with the
    // first card in the band (UX review F2).
    const showChips = battleLikes.length > 0;
    // Per-side card-count badges in the header bar — same idiom as the
    // territory zone label badges. Side membership via battleSideOf (position,
    // not ownership) so the counts agree with the totals chips; opponent's
    // badge sits at the left end, mine at the right, mirroring the chip
    // halves. Hidden while the band is empty, same rationale as showChips.
    const countBadgeW = 24;
    const myCardCount = mySeatStr
      ? battleLikes.filter((c) => battleSideOf(c) === mySeatStr).length
      : 0;
    const oppCardCount = oppSeatStr
      ? battleLikes.filter((c) => battleSideOf(c) === oppSeatStr).length
      : 0;

    // opacity={0} is a CONSTANT — the fade tweens (in on open, out on close)
    // mutate the Group's opacity imperatively; React never re-applies this
    // literal, so it can't fight an in-flight fade (guidance-cue discipline).
    const node = (
      <Group key="battle-chrome" ref={bandChromeRef} opacity={0} listening={false}>
        {/* Header — attacker + stakes type, top edge of the band */}
        <Rect x={band.x} y={band.y} width={band.width} height={18} fill="rgba(10,5,5,0.72)" perfectDrawEnabled={false} />
        <Text
          x={band.x + countBadgeW + 8}
          y={band.y + 2}
          width={band.width - 2 * (countBadgeW + 8)}
          text={headerText}
          fontSize={fs(12)}
          fontFamily="Cinzel, Georgia, serif"
          fontStyle="bold"
          fill="#e8b3a3"
          align="center"
          letterSpacing={1}
          ellipsis
          wrap="none"
          perfectDrawEnabled={false}
        />
        {showChips && (
          <>
            {/* Opponent side count — left end of the header bar (their half). */}
            <Rect
              x={band.x + 4}
              y={band.y + 2}
              width={countBadgeW}
              height={14}
              fill="rgba(100, 149, 237, 0.25)"
              cornerRadius={3}
              stroke="rgba(100, 149, 237, 0.5)"
              strokeWidth={0.5}
              perfectDrawEnabled={false}
            />
            <Text
              x={band.x + 4}
              y={band.y + 3}
              width={countBadgeW}
              text={String(oppCardCount)}
              fontSize={fs(11)}
              fill="#a3c5e8"
              align="center"
              perfectDrawEnabled={false}
            />
            {/* My side count — right end of the header bar (my half). */}
            <Rect
              x={band.x + band.width - countBadgeW - 4}
              y={band.y + 2}
              width={countBadgeW}
              height={14}
              fill="rgba(196, 149, 90, 0.25)"
              cornerRadius={3}
              stroke="rgba(196, 149, 90, 0.5)"
              strokeWidth={0.5}
              perfectDrawEnabled={false}
            />
            <Text
              x={band.x + band.width - countBadgeW - 4}
              y={band.y + 3}
              width={countBadgeW}
              text={String(myCardCount)}
              fontSize={fs(11)}
              fill="#e8d5a3"
              align="center"
              perfectDrawEnabled={false}
            />
          </>
        )}

        {/* Opponent-seat totals chip — flanks the vertical centerline on
            the left, anchored to the BOTTOM of the band (product direction,
            PR #197: "move the numbers to the bottom of the band"; previously
            vertically centered). Halves are viewer-relative (spec §3: every
            player plays into their own right half), so the opponent's
            totals sit on my left. */}
        {showChips && (
          <Group x={midX - 10 - chipWidth} y={band.y + band.height - 8 - chipHeight}>
            <Rect width={chipWidth} height={chipHeight} fill="rgba(10,5,5,0.82)" stroke="#6496e0" strokeWidth={1} cornerRadius={4} perfectDrawEnabled={false} />
            <Text
              width={chipWidth}
              height={chipHeight}
              text={`${oppTotals.str}/${oppTotals.tgh}${oppTotals.hasUnknown ? '?' : ''}`}
              fontSize={fs(11)}
              fontStyle="bold"
              fill="#a3c5e8"
              align="center"
              verticalAlign="middle"
              perfectDrawEnabled={false}
            />
          </Group>
        )}

        {/* My-seat totals chip — flanks the vertical centerline on the
            right, anchored to the BOTTOM of the band, 8px above its bottom
            edge. My cards always render on my own right half. */}
        {showChips && (
          <Group x={midX + 10} y={band.y + band.height - 8 - chipHeight}>
            <Rect width={chipWidth} height={chipHeight} fill="rgba(10,5,5,0.82)" stroke="#c4955a" strokeWidth={1} cornerRadius={4} perfectDrawEnabled={false} />
            <Text
              width={chipWidth}
              height={chipHeight}
              text={`${myTotals.str}/${myTotals.tgh}${myTotals.hasUnknown ? '?' : ''}`}
              fontSize={fs(11)}
              fontStyle="bold"
              fill="#e8d5a3"
              align="center"
              verticalAlign="middle"
              perfectDrawEnabled={false}
            />
          </Group>
        )}

      </Group>
    );
    lastBattleChromeRef.current = node;
    return node;
    // fs/fsGrowth are derived purely from `scale` (see their definitions
    // near the top of the component) — depending on `scale` directly keeps
    // this memo correct across window resizes without needing to list the
    // fs/fsGrowth closures themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    battleActive,
    bandBgVisible,
    gameStatus,
    mpLayout,
    battleCardEntries,
    stakesLostSoulCount,
    normalizedFormat,
    gameState.battleState,
    gameState.battleAttackerSeat,
    gameState.lastBattlePlayBySeat,
    gameState.myPlayer,
    gameState.opponentPlayer,
    scale,
  ]);

  // Drag-target guidance cue (PR #197 product direction: "if it's the
  // player's turn, make it obvious what zone they should be dragging into;
  // if they are defending, also make it obvious the same way"). Every
  // player plays into their own RIGHT half (spec §3), so the cue always
  // renders on the viewer's own right half — never re-derive side
  // membership, reuse `battleSideOf` + `isCharacterCard` exactly like the
  // empty-side checks inside computeInitiative. Text-only memo (not the
  // Konva nodes themselves) — the actual Group is rendered as a plain
  // conditional near the band background (below card nodes in z-order),
  // with its pulse tween lifecycle managed by a separate effect, the same
  // split used for the band-bg seam tween above.
  const battleGuidanceCueText = useMemo((): string | null => {
    if (!battleActive || gameStatus !== 'playing' || isSpectator) return null;
    if (gameState.battleState === 'awaiting-soul') return null;
    const attackerSeat = gameState.battleAttackerSeat;
    const mySeatStr = gameState.myPlayer ? String(gameState.myPlayer.seat) : '';
    if (!attackerSeat || !mySeatStr) return null;

    const battleLikes = battleCardEntries.map((e) => e.like);
    const sideHasCharacters = (seat: string) =>
      battleLikes.some((c) => battleSideOf(c) === seat && isCharacterCard({ cardType: c.cardType }));

    // ANY card on my side retires the cue — gating on characters alone left
    // it rendering underneath a placed enhancement/weapon (mobile QA).
    if (battleLikes.some((c) => battleSideOf(c) === mySeatStr)) return null;

    if (mySeatStr === attackerSeat) {
      return isTouch ? 'Drag or tap a card here' : 'Drag attackers here';
    }
    // Defending: only cue once there's actually something to block.
    if (!sideHasCharacters(attackerSeat)) return null;
    return isTouch ? 'Drag or tap a blocker here' : 'Drag a blocker here';
  }, [
    battleActive,
    gameStatus,
    isSpectator,
    isTouch,
    gameState.battleState,
    gameState.battleAttackerSeat,
    gameState.myPlayer,
    battleCardEntries,
  ]);

  // Pulse tween for the guidance cue — same ref-lifecycle discipline as the
  // band-bg seam tween (bandBgTweenRef above): destroy on EVERY transition
  // before deciding whether to start a new one, and destroy again on
  // unmount/hide so a detached node never keeps ticking. Amplitude/cycle
  // are layout-independent constants, not live values.
  const battleGuidanceCueRef = useRef<Konva.Group | null>(null);
  const battleGuidanceCueTweenRef = useRef<Konva.Tween | null>(null);
  useEffect(() => {
    battleGuidanceCueTweenRef.current?.destroy();
    battleGuidanceCueTweenRef.current = null;
    if (!battleGuidanceCueText) return;
    const node = battleGuidanceCueRef.current;
    if (!node) return;
    node.opacity(BATTLE_GUIDANCE_CUE_OPACITY_MIN);
    const startPulse = () => {
      const tween = new KonvaLib.Tween({
        node,
        duration: BATTLE_GUIDANCE_CUE_PULSE_DURATION,
        opacity: BATTLE_GUIDANCE_CUE_OPACITY_MAX,
        yoyo: true,
        easing: KonvaLib.Easings.EaseInOut,
        onFinish: () => {
          battleGuidanceCueTweenRef.current = null;
          startPulse();
        },
      });
      battleGuidanceCueTweenRef.current = tween;
      tween.play();
    };
    startPulse();
    return () => {
      battleGuidanceCueTweenRef.current?.destroy();
      battleGuidanceCueTweenRef.current = null;
    };
  }, [battleGuidanceCueText]);

  // ---- Card bounds for marquee selection (my + opponent free-form, LOB, hand cards) ----
  const allCardBounds = useMemo((): CardBound[] => {
    if (!mpLayout || !myHandRect) return [];
    const bounds: CardBound[] = [];

    // My free-form zone cards
    for (const zoneKey of FREE_FORM_ZONES) {
      const cards = myCards[zoneKey] ?? [];
      for (const card of cards) {
        const zone = myZones[zoneKey];
        let x: number, y: number;
        if (card.posX && zone) {
          ({ x, y } = toScreenPos(parseFloat(card.posX), parseFloat(card.posY), zone, 'my'));
        } else {
          x = (zone?.x ?? 0) + 20;
          y = (zone?.y ?? 0) + 24;
        }
        bounds.push({
          instanceId: String(card.id),
          x,
          y,
          width: cardWidth,
          height: cardHeight,
          rotation: 0,
          owner: 'my',
        });
      }
    }

    // Opponent free-form zone cards (rotated 180°)
    for (const zoneKey of FREE_FORM_ZONES) {
      const cards = opponentCards[zoneKey] ?? [];
      for (const card of cards) {
        const zone = opponentZones[zoneKey];
        if (!zone) continue;
        const { x: anchorX, y: anchorY } = toScreenPos(
          card.posX ? parseFloat(card.posX) : 0,
          card.posY ? parseFloat(card.posY) : 0,
          zone, 'opponent',
        );
        // Rotation=180 means anchor is bottom-right corner; bounding box is (anchor-w, anchor-h) to (anchor)
        bounds.push({
          instanceId: String(card.id),
          x: anchorX - cardWidth,
          y: anchorY - cardHeight,
          width: cardWidth,
          height: cardHeight,
          rotation: 180,
          owner: 'opponent',
        });
      }
    }

    // Battle band cards — my half (rot 0) and opponent-owned half (rot 180).
    // Both mirror against the FULL band rect by card owner (spec §3). The
    // rect only exists while a battle is open, which gates this naturally.
    if (mpLayout.zones.battle) {
      const band = mpLayout.zones.battle;
      for (const card of myCards['battle'] ?? []) {
        let x: number, y: number;
        if (card.posX) {
          ({ x, y } = toScreenPos(parseFloat(card.posX), parseFloat(card.posY), band, 'my'));
        } else {
          x = band.x + 20;
          y = band.y + 24;
        }
        bounds.push({
          instanceId: String(card.id),
          x,
          y,
          width: cardWidth,
          height: cardHeight,
          rotation: 0,
          owner: 'my',
        });
      }
      for (const card of opponentCards['battle'] ?? []) {
        const { x: anchorX, y: anchorY } = toScreenPos(
          card.posX ? parseFloat(card.posX) : 0,
          card.posY ? parseFloat(card.posY) : 0,
          band, 'opponent',
        );
        // Rotation=180: anchor is the bottom-right corner.
        bounds.push({
          instanceId: String(card.id),
          x: anchorX - cardWidth,
          y: anchorY - cardHeight,
          width: cardWidth,
          height: cardHeight,
          rotation: 180,
          owner: 'opponent',
        });
      }
    }

    // My auto-arrange zone cards (LOB). Attached sites don't get a slot —
    // their bounds come from the derived offset relative to the host slot.
    for (const zoneKey of AUTO_ARRANGE_ZONES) {
      const cards = myCards[zoneKey] ?? [];
      const zone = myZones[zoneKey];
      if (cards.length > 0 && zone) {
        const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
        const { hosts, accessoriesByHost } = splitLobCards(sorted);
        const positions = calculateAutoArrangePositions(hosts.length, zone, lobCard.cardWidth, lobCard.cardHeight);
        hosts.forEach((host, i) => {
          const pos = positions[i];
          if (!pos) return;
          bounds.push({
            instanceId: String(host.id),
            x: pos.x,
            y: pos.y,
            width: lobCard.cardWidth,
            height: lobCard.cardHeight,
            rotation: 0,
            owner: 'my',
          });
          const attached = accessoriesByHost.get(host.id) ?? [];
          for (const accessory of attached) {
            const derived = myDerivedWeaponPositions.get(String(accessory.id));
            if (!derived) continue;
            bounds.push({
              instanceId: String(accessory.id),
              x: derived.x,
              y: derived.y,
              width: lobCard.cardWidth,
              height: lobCard.cardHeight,
              rotation: 0,
              owner: 'my',
            });
          }
        });
      }
    }

    // Shared LoB cards (Paragon only). Positions come from sharedLobLayout.
    // Rendered with rotation=0 and owner='my' (viewer-local) so marquee picks
    // them up like own cards for selection/drag.
    if (normalizedFormat === 'Paragon' && mpLayout?.zones.sharedLob) {
      const cards = sharedCards['land-of-bondage'] ?? [];
      for (const card of cards) {
        const idStr = String(card.id);
        const pos =
          sharedLobLayout.hostPositions.get(idStr) ??
          sharedLobLayout.accessoryPositions.get(idStr);
        if (!pos) continue;
        bounds.push({
          instanceId: idStr,
          x: pos.x,
          y: pos.y,
          width: lobCard.cardWidth,
          height: lobCard.cardHeight,
          rotation: 0,
          owner: 'my',
        });
      }
    }

    // Opponent auto-arrange zone cards (LOB, rotated 180°). Attached sites
    // use their derived anchor, which is pre-computed with the mirror offset.
    for (const zoneKey of AUTO_ARRANGE_ZONES) {
      const cards = opponentCards[zoneKey] ?? [];
      const zone = opponentZones[zoneKey];
      if (cards.length > 0 && zone) {
        const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
        const { hosts, accessoriesByHost } = splitLobCards(sorted);
        const positions = calculateAutoArrangePositions(hosts.length, zone, lobCard.cardWidth, lobCard.cardHeight);
        hosts.forEach((host, i) => {
          const pos = positions[i];
          if (!pos) return;
          // Opponent LOB cards render at (pos.x + w, pos.y + h) with rotation=180.
          // Bounding box is (pos.x, pos.y) to (pos.x + w, pos.y + h).
          bounds.push({
            instanceId: String(host.id),
            x: pos.x,
            y: pos.y,
            width: lobCard.cardWidth,
            height: lobCard.cardHeight,
            rotation: 180,
            owner: 'opponent',
          });
          const attached = accessoriesByHost.get(host.id) ?? [];
          for (const accessory of attached) {
            const derived = opponentDerivedWeaponPositions.get(String(accessory.id));
            if (!derived) continue;
            // Derived anchor is bottom-right of the accessory (rotation=180).
            bounds.push({
              instanceId: String(accessory.id),
              x: derived.x - lobCard.cardWidth,
              y: derived.y - lobCard.cardHeight,
              width: lobCard.cardWidth,
              height: lobCard.cardHeight,
              rotation: 180,
              owner: 'opponent',
            });
          }
        });
      }
    }

    // My hand cards
    const handCards = myCards['hand'] ?? [];
    if (handCards.length > 0) {
      const positions = calculateHandPositions(
        handCards.length,
        myHandRect,
        handCardWidth,
        handCardHeight,
        viewerKind === 'spectator' ? true : isSpreadHand,
        handToolbarReserve,
      );
      handCards.forEach((card, i) => {
        const pos = positions[i];
        if (pos) {
          bounds.push({
            instanceId: String(card.id),
            x: pos.x,
            y: pos.y,
            width: handCardWidth,
            height: handCardHeight,
            rotation: pos.rotation,
            owner: 'my',
          });
        }
      });
    }

    return bounds;
  }, [mpLayout, myHandRect, myZones, myCards, opponentZones, opponentCards, cardWidth, cardHeight, handCardWidth, handCardHeight, lobCard, isSpreadHand, viewerKind, myDerivedWeaponPositions, opponentDerivedWeaponPositions, normalizedFormat, sharedCards, sharedLobLayout, handToolbarReserve]);

  // ---- Stage mouse handlers for marquee selection ----
  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Skip Ctrl/⌘+Click: macOS fires a native contextmenu right after. Starting
      // a marquee here would flip layer.listening(false) before Konva can hit-test
      // the contextmenu, so the hand Rect's onContextMenu never fires.
      if (!isPrimaryPointer(e.evt) || e.evt.ctrlKey || e.evt.metaKey) return;

      // Only start selection on empty canvas (not on cards or clickable zones).
      // Walks target + ancestors; treats anything draggable, named "zone-click",
      // or with a click/tap listener as interactive so we don't swallow the click.
      let node: Konva.Node | null = e.target;
      let isInteractive = false;
      while (node && node !== stageRef.current) {
        const listeners = (node as any).eventListeners;
        if (
          node.draggable?.() ||
          node.name?.() === 'zone-click' ||
          listeners?.click ||
          listeners?.tap
        ) {
          isInteractive = true;
          break;
        }
        node = node.parent;
      }
      if (isInteractive) return;

      if (!e.evt.shiftKey && selectedIds.size > 0) {
        clearSelection();
      }

      const layer = gameLayerRef.current;
      if (!layer) return;
      const pos = layer.getRelativePointerPosition();
      if (!pos) return;
      startSelectionDrag(pos.x, pos.y, e.evt.shiftKey);
      // Silence the game layer's hit canvas while the marquee is active — same
      // reasoning as card drag. Stage-level mouse handlers still fire because
      // the Stage itself doesn't depend on layer hit detection. Re-enabled in
      // handleStageMouseUp.
      layer.listening(false);
    },
    [selectedIds.size, clearSelection, startSelectionDrag],
  );

  const handleStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Track mouse position for hover preview tooltip
      const clientPos = { x: e.evt.clientX, y: e.evt.clientY };
      mousePosRef.current = clientPos;
      if (hoveredCard) {
        queueMousePos(clientPos);
      }

      if (!isSelectingRef.current) return;
      // Cancel selection if a card drag started
      if (isDraggingRef.current) {
        isSelectingRef.current = false;
        onRectChangeRef.current?.(null);
        return;
      }
      const layer = gameLayerRef.current;
      if (!layer) return;
      const pos = layer.getRelativePointerPosition();
      if (pos) {
        updateSelectionDrag(pos.x, pos.y, allCardBounds, e.evt.shiftKey);
      }
    },
    [updateSelectionDrag, allCardBounds, isSelectingRef, onRectChangeRef, hoveredCard, queueMousePos],
  );

  const handleStageMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isSelectingRef.current) return;
      endSelectionDrag(e.evt.shiftKey);
      // Re-enable layer listening (silenced in handleStageMouseDown for perf).
      const layer = gameLayerRef.current;
      if (layer) layer.listening(true);
    },
    [endSelectionDrag, isSelectingRef],
  );

  // ---- Don't render canvas content until we have dimensions and layout ----
  // NOTE: The container div MUST always render so the ref gets attached and
  // ResizeObserver can measure it. Only the Stage content is gated.
  if (containerWidth === 0 || containerHeight === 0 || !mpLayout || !myHandRect || !opponentHandRect) {
    return (
      <div ref={containerRef} style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        overflow: 'hidden',
        // The board owns every gesture inside it. Without this the browser
        // steals pan/pinch and iOS shows the long-press callout.
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }} />
    );
  }

  // ---- Helper: get image for a CardInstance ----
  const getCardImage = (card: CardInstance): HTMLImageElement | undefined => {
    if (!card.cardImgFile || card.isFlipped) return undefined;
    // Route through the shared resolver so `forge:<uuid>` refs become the
    // cookie-authed proxy URL (matching the preloader's cache key). Falls
    // through to the public CDN URL for official cards.
    const url = resolveCardImageUrl(card.cardImgFile, forgeResolver);
    if (!url) return undefined;
    return getImage(url) ?? undefined;
  };

  // All sidebar pile zone keys
  const SIDEBAR_ZONES = SIDEBAR_PILE_ZONES;

  // Build combined zone rect map for drag highlight overlay
  const allZoneRects: { key: string; rect: ZoneRect; owner: 'my' | 'opponent' | 'shared' }[] = [];
  for (const [key, rect] of Object.entries(myZones)) {
    // Skip the collapsed zero-height per-seat LoB rect in Paragon — shared LoB takes over.
    if (normalizedFormat === 'Paragon' && key === 'land-of-bondage') continue;
    allZoneRects.push({ key: `my:${key}`, rect, owner: 'my' });
  }
  allZoneRects.push({ key: 'my:hand', rect: myHandRect, owner: 'my' });
  for (const [key, rect] of Object.entries(opponentZones)) {
    if (normalizedFormat === 'Paragon' && key === 'land-of-bondage') continue;
    allZoneRects.push({ key: `opponent:${key}`, rect, owner: 'opponent' });
  }
  if (opponentHandRect) {
    allZoneRects.push({ key: 'opponent:hand', rect: opponentHandRect, owner: 'opponent' });
  }
  if (normalizedFormat === 'Paragon' && mpLayout?.zones.sharedLob) {
    allZoneRects.push({ key: 'shared:land-of-bondage', rect: mpLayout.zones.sharedLob, owner: 'shared' });
  }
  if (battleActive && mpLayout?.zones.battle) {
    // Keyed 'my:battle' to match findZoneAtPosition's hit owner so the hover
    // glow and source-zone suppression follow the `${owner}:${zone}` convention.
    allZoneRects.push({ key: 'my:battle', rect: mpLayout.zones.battle, owner: 'my' });
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        overflow: 'hidden',
        // The board owns every gesture inside it. Without this the browser
        // steals pan/pinch and iOS shows the long-press callout.
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Stage
        ref={stageRef}
        width={containerWidth}
        height={containerHeight}
        pixelRatio={typeof window !== 'undefined' ? window.devicePixelRatio : 1}
        onContextMenu={(e) => e.evt.preventDefault()}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onTap={handleStageTap}
        onDblTap={handleStageDblTap}
        onTouchStart={handleStageTouch}
        onTouchMove={handleStageTouch}
        onTouchEnd={handleStageTouchEnd}
      >
        {/* Game layer — all content in 1920x1080 virtual coords */}
        <Layer
          ref={gameLayerRef as any}
          scaleX={scale}
          scaleY={scale}
          x={offsetX}
          y={offsetY}
        >
          {/* ================================================================
              Zone backgrounds — My zones
              ================================================================ */}
          {normalizedFormat === 'Paragon' && mpLayout?.zones.sharedLob && (
            <Rect
              x={mpLayout.zones.sharedLob.x}
              y={mpLayout.zones.sharedLob.y}
              width={mpLayout.zones.sharedLob.width}
              height={mpLayout.zones.sharedLob.height}
              fill="#1e1610"
              stroke="#6b4e27"
              strokeWidth={1}
              cornerRadius={3}
              opacity={0.45}
              onContextMenu={handleSharedLobContextMenu}
              // Touch path to the shared-LoB spawn menu (Paragon).
              onTouchStart={isTouch && !isSpectator ? (e: Konva.KonvaEventObject<TouchEvent>) => beginZonePress(e, (pt) => {
                closeAllMenus();
                const sharedRect = mpLayout?.zones.sharedLob;
                if (!sharedRect) return;
                const layer = gameLayerRef.current;
                const pointer = layer?.getRelativePointerPosition();
                const spawnX = pointer ? (pointer.x - sharedRect.x) / sharedRect.width : 0.5;
                const spawnY = pointer ? (pointer.y - sharedRect.y) / sharedRect.height : 0.5;
                setZoneMenu({ x: pt.x, y: pt.y, spawnX, spawnY, targetPlayerId: '0' });
              }) : undefined}
              onTouchMove={isTouch ? moveZonePress : undefined}
              onTouchEnd={isTouch ? clearZonePress : undefined}
              perfectDrawEnabled={false}
            />
          )}
          {normalizedFormat === 'Paragon' && mpLayout?.zones.soulDeck && (
            <Rect
              x={mpLayout.zones.soulDeck.x}
              y={mpLayout.zones.soulDeck.y}
              width={mpLayout.zones.soulDeck.width}
              height={mpLayout.zones.soulDeck.height}
              fill="#1e1610"
              stroke="#6b4e27"
              strokeWidth={1}
              cornerRadius={3}
              opacity={0.45}
              perfectDrawEnabled={false}
            />
          )}
          {Object.entries(myZones).map(([key, zone]) => {
            // Paragon collapses the per-seat LoB rects to zero-height
            // placeholders (multiplayerLayout) — a stroked Rect still paints
            // its outline at height 0 (a stray hairline over the board), so
            // skip collapsed zones entirely.
            if (zone.height === 0) return null;
            // LOB + territory zones get their label+badge rendered as an overlay after cards
            const isLob = isAutoArrangeZone(key);
            const isFreeForm = isFreeFormZone(key);
            const skipLabel = isLob || isFreeForm;
            const cardsInZone = myCards[key] ?? [];
            // Approximate label width: ~7px per uppercase char at fontSize 11 + letterSpacing 1
            const labelTextWidth = zone.label.toUpperCase().length * 7;
            const isSidebarPile = SIDEBAR_PILE_ZONES.includes(key as (typeof SIDEBAR_PILE_ZONES)[number]);
            const openMyPileMenu = (pt: { x: number; y: number }) => {
              if (isSpectator) return;
              closeAllMenus();
              if (key === 'deck') setDeckMenu(pt);
              else if (key === 'reserve') setReserveMenu(pt);
              else if (key === 'land-of-redemption') setLorMenu(pt);
              else if (key === 'discard' || key === 'banish') setBrowseMyZone(key);
            };
            const openMyLobMenu = (pt: { x: number; y: number }) => {
              if (isSpectator) return;
              // Compute spawn position as normalized 0-1 within the LOB zone
              const layer = gameLayerRef.current;
              const pointer = layer?.getRelativePointerPosition();
              const spawnX = pointer ? (pointer.x - zone.x) / zone.width : 0.5;
              const spawnY = pointer ? (pointer.y - zone.y) / zone.height : 0.5;
              setZoneMenu({ x: pt.x, y: pt.y, spawnX, spawnY });
            };
            const myPileContextHandler = (e: Konva.KonvaEventObject<PointerEvent>) => {
              e.evt.preventDefault();
              openMyPileMenu({ x: e.evt.clientX, y: e.evt.clientY });
            };
            const myPileClickHandler = (e: Konva.KonvaEventObject<PointerEvent>) => {
              if (!isPrimaryPointer(e.evt)) return;  // TouchEvent has no `button`
              // The touchend of a zone long-press also emits a tap — swallow it.
              if (zoneLongPressFiredRef.current) { zoneLongPressFiredRef.current = false; return; }
              // A tap while a card is armed is a MOVE (the stage tap handler
              // commits it into this pile) — opening a browse/menu on top of
              // the commit buried the board under an unrequested surface.
              if (isTouch && tapMoveStateRef.current.kind === 'armed') return;
              if (key === 'discard' || key === 'banish') setBrowseMyZone(key);
              else if (key === 'reserve' && canViewMyReserve) setBrowseMyZone('reserve');
              // Viewing rescued souls is the whole point of the LoR pile —
              // tap/click browses it like the discard (the action menu stays
              // on long-press / right-click).
              else if (key === 'land-of-redemption') setBrowseMyZone('land-of-redemption');
              // Touch: a tap on the deck opens the deck menu (Search, Draw,
              // …). Before this the tap was a silent no-op and the only route
              // in was an undiscoverable long-press (phone QA, wave 8).
              // Desktop keeps click-through (right-click has the menu).
              else if (key === 'deck' && isTouch && !isSpectator) {
                const ev = e.evt as unknown as { clientX?: number; clientY?: number; changedTouches?: TouchList };
                const t = ev.changedTouches?.[0];
                closeAllMenus();
                setDeckMenu({ x: t?.clientX ?? ev.clientX ?? 0, y: t?.clientY ?? ev.clientY ?? 0 });
              }
            };
            return (
              <Group key={`my-${key}`}>
                <Rect
                  x={zone.x}
                  y={zone.y}
                  width={zone.width}
                  height={zone.height}
                  fill="#1e1610"
                  // Free-form territory is borderless: its stroke ran parallel
                  // to the divider/band strokes a few px away, doubling every
                  // horizontal boundary line across the board.
                  stroke={isFreeForm ? undefined : '#6b4e27'}
                  strokeWidth={isFreeForm ? 0 : 1}
                  cornerRadius={3}
                  opacity={0.45}
                  // Territory has no click/context handlers — drop it from the
                  // hit graph entirely so per-pointermove traversal is cheaper.
                  // LoB and sidebar piles must stay listening for their handlers.
                  listening={isFreeForm ? false : undefined}
                  onClick={isSidebarPile ? myPileClickHandler : undefined}
                  onTap={isSidebarPile ? (myPileClickHandler as unknown as (e: Konva.KonvaEventObject<TouchEvent>) => void) : undefined}
                  onContextMenu={isLob ? (e: Konva.KonvaEventObject<PointerEvent>) => {
                    e.evt.preventDefault();
                    openMyLobMenu({ x: e.evt.clientX, y: e.evt.clientY });
                  } : isSidebarPile ? myPileContextHandler : undefined}
                  onTouchStart={isTouch && (isLob || isSidebarPile) ? (e: Konva.KonvaEventObject<TouchEvent>) => beginZonePress(e, isLob ? openMyLobMenu : openMyPileMenu) : undefined}
                  onTouchMove={isTouch && (isLob || isSidebarPile) ? moveZonePress : undefined}
                  onTouchEnd={isTouch && (isLob || isSidebarPile) ? clearZonePress : undefined}
                  perfectDrawEnabled={false}
                />
                {/* Label + badge — skip for LOB/territory zones (rendered as overlay after cards) */}
                {!skipLabel && (
                  <>
                    <Text
                      x={zone.x + 6}
                      y={zone.y + 4}
                      text={useCompactLayout ? (COMPACT_PILE_LABELS[key] ?? zone.label.toUpperCase()) : zone.label.toUpperCase()}
                      fontSize={fs(11)}
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#e8d5a3"
                      letterSpacing={useCompactLayout ? 0 : 1}
                      // Always clip to the zone: fs() floors the on-screen font
                      // size, so at tiny scales (spectator portrait whole-board
                      // fit) an unclipped label outgrows its column and prints
                      // over the neighbor pile's — "DISC"+"BAN" read "DISBA".
                      width={zone.width - 8}
                      // wrap must be 'none' for ellipsis to apply — the default
                      // 'word' wrap char-breaks long words instead ("REDEMPTIO/N")
                      wrap="none"
                      ellipsis
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                  </>
                )}
                {/* Ghost text for empty territory */}
              </Group>
            );
          })}

          {/* ================================================================
              Zone backgrounds — Opponent zones
              ================================================================ */}
          {Object.entries(opponentZones).map(([key, zone]) => {
            // Same zero-height guard as the myZones loop above (Paragon
            // collapsed LoB placeholders).
            if (zone.height === 0) return null;
            const isLob = isAutoArrangeZone(key);
            const isFreeForm = isFreeFormZone(key);
            const skipLabel = isLob || isFreeForm;
            const cardsInZone = opponentCards[key] ?? [];
            const labelTextWidth = zone.label.toUpperCase().length * 7;
            const isOppSidebarPile = SIDEBAR_PILE_ZONES.includes(key as (typeof SIDEBAR_PILE_ZONES)[number]);
            const openOppPileMenu = (pt: { x: number; y: number }) => {
              if (isSpectator) return;
              closeAllMenus();
              if (key === 'deck') setOpponentDeckMenu(pt);
              else if (key === 'reserve') setOpponentReserveMenu(pt);
              else if (key === 'discard' || key === 'banish') setBrowseOpponentZone(key);
            };
            const openOppLobMenu = (pt: { x: number; y: number }) => {
              if (isSpectator) return;
              const layer = gameLayerRef.current;
              const pointer = layer?.getRelativePointerPosition();
              const spawnX = pointer ? (pointer.x - zone.x) / zone.width : 0.5;
              const spawnY = pointer ? (pointer.y - zone.y) / zone.height : 0.5;
              const oppId = gameState.opponentPlayer?.id;
              setZoneMenu({ x: pt.x, y: pt.y, spawnX, spawnY, targetPlayerId: oppId != null ? String(oppId) : undefined });
            };
            const oppPileContextHandler = (e: Konva.KonvaEventObject<PointerEvent>) => {
              e.evt.preventDefault();
              openOppPileMenu({ x: e.evt.clientX, y: e.evt.clientY });
            };
            const oppPileClickHandler = (e: Konva.KonvaEventObject<PointerEvent>) => {
              if (!isPrimaryPointer(e.evt)) return;  // TouchEvent has no `button`
              // The touchend of a zone long-press also emits a tap — swallow it.
              if (zoneLongPressFiredRef.current) { zoneLongPressFiredRef.current = false; return; }
              // Armed tap = move commit — see myPileClickHandler.
              if (isTouch && tapMoveStateRef.current.kind === 'armed') return;
              if (key === 'discard' || key === 'banish') setBrowseOpponentZone(key);
              else if (key === 'reserve' && canViewOppReserve) setBrowseOpponentZone('reserve');
              // Their LoR is public information — browse on tap like discard.
              else if (key === 'land-of-redemption') setBrowseOpponentZone('land-of-redemption');
            };
            return (
              <Group key={`opp-${key}`}>
                <Rect
                  x={zone.x}
                  y={zone.y}
                  width={zone.width}
                  height={zone.height}
                  fill="#10141e"
                  // Borderless like the my-side territory (see comment there).
                  stroke={isFreeForm ? undefined : '#27456b'}
                  strokeWidth={isFreeForm ? 0 : 1}
                  cornerRadius={3}
                  opacity={0.45}
                  listening={isFreeForm ? false : undefined}
                  onClick={isOppSidebarPile ? oppPileClickHandler : undefined}
                  onTap={isOppSidebarPile ? (oppPileClickHandler as unknown as (e: Konva.KonvaEventObject<TouchEvent>) => void) : undefined}
                  onContextMenu={isLob ? (e: Konva.KonvaEventObject<PointerEvent>) => {
                    e.evt.preventDefault();
                    openOppLobMenu({ x: e.evt.clientX, y: e.evt.clientY });
                  } : isOppSidebarPile ? oppPileContextHandler : undefined}
                  onTouchStart={isTouch && (isLob || isOppSidebarPile) ? (e: Konva.KonvaEventObject<TouchEvent>) => beginZonePress(e, isLob ? openOppLobMenu : openOppPileMenu) : undefined}
                  onTouchMove={isTouch && (isLob || isOppSidebarPile) ? moveZonePress : undefined}
                  onTouchEnd={isTouch && (isLob || isOppSidebarPile) ? clearZonePress : undefined}
                  perfectDrawEnabled={false}
                />
                {/* Label + badge — skip for LOB/territory zones (rendered as overlay after cards) */}
                {!skipLabel && (
                  <>
                    <Text
                      x={zone.x + 6}
                      y={zone.y + 4}
                      text={useCompactLayout ? (COMPACT_PILE_LABELS[key] ?? zone.label.toUpperCase()) : zone.label.toUpperCase()}
                      fontSize={fs(11)}
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#a3c5e8"
                      letterSpacing={useCompactLayout ? 0 : 1}
                      // Clip to the zone — see the my-zones label note above.
                      width={zone.width - 8}
                      // wrap must be 'none' for ellipsis to apply — the default
                      // 'word' wrap char-breaks long words instead ("REDEMPTIO/N")
                      wrap="none"
                      ellipsis
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                  </>
                )}
                {/* Ghost text for empty territory */}
              </Group>
            );
          })}

          {/* ================================================================
              Field of Battle band — static background (band rect + dashed
              centerline). Rendered ONLY while a battle is open AND the game
              is still playing (spec: "all battle UI gates on
              status === 'playing'" — battle columns are left dangling after
              resign/finish). The "FIELD OF BATTLE" label is superseded by
              the dynamic header line in the Task 12 chrome group below.
              ================================================================ */}
          {/* Gate on battleActive OR bandBgVisible: battleActive mounts the
              Rect in the SAME commit as the battle layout flip (waiting for
              the bandBgVisible effect leaves the untinted band region flashing
              bright for a frame); bandBgVisible keeps it mounted through the
              close fade after battleActive drops. */}
          {(battleActive || bandBgVisible) && gameStatus === 'playing' && lastBandRectRef.current && (() => {
            const band = lastBandRectRef.current!;
            const midX = band.x + band.width / 2;
            // opacity={1} is a CONSTANT — the close-fade tween mutates the
            // Group's opacity imperatively; React never re-applies this literal,
            // so it can't fight the fade (guidance-cue discipline). The Rect
            // keeps its own resting BAND_BG_OPACITY, which the Group opacity
            // multiplies down to 0 on close.
            return (
              <Group key="battle-band-bg" ref={bandBgGroupRef} opacity={1} listening={false}>
                <Rect
                  ref={bandBgRectRef}
                  x={band.x}
                  y={band.y}
                  width={band.width}
                  height={band.height}
                  fill="#1a0d0d"
                  stroke="#6b2f27"
                  strokeWidth={1}
                  cornerRadius={3}
                  opacity={BAND_BG_OPACITY}
                  perfectDrawEnabled={false}
                />
                {/* Dashed centerline — placement left/right decides a card's
                    side (spec §3: every player plays into their own right
                    half). */}
                <Line
                  points={[midX, band.y + 8, midX, band.y + band.height - 8]}
                  stroke="#8a5a4a"
                  strokeWidth={1}
                  dash={[10, 8]}
                  opacity={0.6}
                  perfectDrawEnabled={false}
                />
              </Group>
            );
          })()}

          {/* ================================================================
              Drag-target guidance cue (PR #197) — highlights the viewer's
              own right half when it's their move (attacking into an empty
              side, or defending one that already has a character down).
              Rendered here, BEFORE the battle card groups below, so it sits
              BELOW card art in z-order (unlike the chips/header chrome group,
              which renders after cards and stays above them). listening=
              false throughout — must never intercept drags. Text/visibility
              come from battleGuidanceCueText (memoized above); the pulse
              opacity is driven imperatively by battleGuidanceCueTweenRef, so
              the Group's own `opacity` JSX attr is a constant (never
              re-applied by React after mount) and never fights the tween —
              same discipline as the band-bg seam tween.
              ================================================================ */}
          {battleGuidanceCueText && mpLayout?.zones.battle && (() => {
            const band = mpLayout.zones.battle;
            const midX = band.x + band.width / 2;
            const inset = 6;
            const cueX = midX + inset;
            const cueY = band.y + inset;
            const cueWidth = band.x + band.width - cueX - inset;
            const cueHeight = band.height - inset * 2;
            return (
              <Group
                key="battle-guidance-cue"
                ref={battleGuidanceCueRef}
                listening={false}
                opacity={BATTLE_GUIDANCE_CUE_OPACITY_MIN}
              >
                <Rect
                  x={cueX}
                  y={cueY}
                  width={cueWidth}
                  height={cueHeight}
                  cornerRadius={6}
                  fill="rgba(196,149,90,0.07)"
                  stroke="#c4955a"
                  strokeWidth={1.5}
                  dash={[8, 6]}
                  perfectDrawEnabled={false}
                />
                <Text
                  x={cueX}
                  y={cueY}
                  width={cueWidth}
                  height={cueHeight}
                  text={battleGuidanceCueText}
                  fontSize={fs(13)}
                  fontFamily="Cinzel, Georgia, serif"
                  fontStyle="bold"
                  fill="#e8d5a3"
                  align="center"
                  verticalAlign="middle"
                  letterSpacing={1}
                  perfectDrawEnabled={false}
                />
              </Group>
            );
          })()}

          {/* ================================================================
              Hand zone backgrounds
              ================================================================ */}
          {/* My hand */}
          <Rect
            x={myHandRect.x}
            y={myHandRect.y}
            width={myHandRect.width}
            height={VIRTUAL_HEIGHT - myHandRect.y}
            fill="#0d0905"
            opacity={0.5}
            onContextMenu={(e: Konva.KonvaEventObject<PointerEvent>) => {
              e.evt.preventDefault();
              if (isSpectator) return;
              closeAllMenus();
              setHandMenu({
                x: e.evt.clientX,
                y: e.evt.clientY,
              });
            }}
            // Touch path to Reveal/Hide Hand — contextmenu never fires for a
            // canvas long-press on iOS. Presses that land on hand CARDS are
            // claimed by the card's own long-press (draggable ancestor check).
            onTouchStart={isTouch && !isSpectator ? (e: Konva.KonvaEventObject<TouchEvent>) => {
              if (e.target !== e.currentTarget) {
                let cur: Konva.Node | null = e.target as Konva.Node;
                while (cur) {
                  if (typeof (cur as any).draggable === 'function' && (cur as any).draggable()) return;
                  cur = cur.getParent();
                }
              }
              beginZonePress(e, (pt) => { closeAllMenus(); setHandMenu(pt); });
            } : undefined}
            onTouchMove={isTouch ? moveZonePress : undefined}
            onTouchEnd={isTouch ? clearZonePress : undefined}
            perfectDrawEnabled={false}
          />
          {(() => {
            const areaRight = myHandRect.x + myHandRect.width;
            const bw = 26;
            // "HAND" at fontSize 12 + letterSpacing 2 — grows with floored text.
            const lw = 52 * fsGrowth(12);
            const sx = areaRight - lw - 8 - bw - 6;
            const brigadeW = 200 * fsGrowth(12);
            const brigadeX = areaRight - brigadeW - 6;
            // Below the HAND label's real (floored-font) bottom edge — a fixed
            // +24 let the scrim swallow the label once fs(12) grew past 14.
            const brigadeTop = myHandRect.y + 4 + fs(12) + 8;
            const rowH = 16 * fsGrowth(12);
            return (
              <>
                <Text x={sx} y={myHandRect.y + 4} text="HAND" fontSize={fs(12)} fontFamily="Cinzel, Georgia, serif" fill="#e8d5a3" letterSpacing={2} listening={false} perfectDrawEnabled={false} />
                <Group x={sx + lw + 8} y={myHandRect.y + 2} listening={false}>
                  <Rect width={bw} height={18} fill="#2a1f12" cornerRadius={4} stroke="#c4955a" strokeWidth={1} perfectDrawEnabled={false} />
                  <Text text={String(myCards['hand']?.length ?? 0)} fontSize={fs(12)} fontStyle="bold" fill="#e8d5a3" width={bw} height={18} align="center" verticalAlign="middle" perfectDrawEnabled={false} />
                </Group>
                {myHandBrigadeCounts.total > 0 && useCompactLayout && (() => {
                  // Compact: the four labelled rows were a ~210×70px block —
                  // bigger than the cards it sat beside on a phone. Numbers
                  // only, one row; the colours already carry the meaning
                  // (cream total · green good · red evil · tan neutral).
                  const numW = 26 * fsGrowth(12);
                  const stripW = numW * 4;
                  const stripX = areaRight - stripW - 6;
                  const cells: Array<[number, string]> = [
                    [myHandBrigadeCounts.total, '#e8d5a3'],
                    [myHandBrigadeCounts.good, '#9ab86a'],
                    [myHandBrigadeCounts.evil, '#e87560'],
                    [myHandBrigadeCounts.neutral, '#c4955a'],
                  ];
                  return (
                    <>
                      <Rect
                        x={stripX - 6}
                        y={brigadeTop - 4}
                        width={stripW + 12}
                        height={rowH + 8}
                        fill="rgba(10, 8, 5, 0.72)"
                        cornerRadius={4}
                        listening={false}
                        perfectDrawEnabled={false}
                      />
                      {cells.map(([n, color], i) => (
                        <Text
                          key={color}
                          x={stripX + i * numW}
                          y={brigadeTop}
                          width={numW}
                          text={String(n)}
                          fontSize={fs(12)}
                          fontStyle="bold"
                          fontFamily="Cinzel, Georgia, serif"
                          fill={color}
                          align="center"
                          listening={false}
                          perfectDrawEnabled={false}
                        />
                      ))}
                    </>
                  );
                })()}
                {myHandBrigadeCounts.total > 0 && !useCompactLayout && (
                  <>
                    {/* Scrim behind the totals — the NEUTRAL/EVIL lines were
                        unreadable over bright background art. */}
                    <Rect
                      x={brigadeX - 6}
                      y={brigadeTop - 4}
                      width={brigadeW + 12}
                      height={rowH * 4 + 8}
                      fill="rgba(10, 8, 5, 0.72)"
                      cornerRadius={4}
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                    <Text
                      x={brigadeX}
                      y={brigadeTop}
                      width={brigadeW}
                      text={`Total Brigades: ${myHandBrigadeCounts.total}`}
                      fontSize={fs(12)}
                      fontStyle="bold"
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#e8d5a3"
                      letterSpacing={1}
                      align="right"
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                    <Text
                      x={brigadeX}
                      y={brigadeTop + rowH}
                      width={brigadeW}
                      text={`Good Brigades: ${myHandBrigadeCounts.good}`}
                      fontSize={fs(12)}
                      fontStyle="bold"
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#9ab86a"
                      letterSpacing={1}
                      align="right"
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                    <Text
                      x={brigadeX}
                      y={brigadeTop + rowH * 2}
                      width={brigadeW}
                      text={`Evil Brigades: ${myHandBrigadeCounts.evil}`}
                      fontSize={fs(12)}
                      fontStyle="bold"
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#e87560"
                      letterSpacing={1}
                      align="right"
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                    <Text
                      x={brigadeX}
                      y={brigadeTop + rowH * 3}
                      width={brigadeW}
                      text={`Neutral Brigades: ${myHandBrigadeCounts.neutral}`}
                      fontSize={fs(12)}
                      fontStyle="bold"
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#c4955a"
                      letterSpacing={1}
                      align="right"
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                  </>
                )}
              </>
            );
          })()}

          {/* Opponent hand */}
          <Rect
            x={opponentHandRect.x}
            y={opponentHandRect.y}
            width={opponentHandRect.width}
            height={opponentHandRect.height}
            fill="#050911"
            opacity={0.5}
            onContextMenu={(e: Konva.KonvaEventObject<PointerEvent>) => {
              e.evt.preventDefault();
              if (isSpectator) return;
              closeAllMenus();
              setOpponentHandMenu({
                x: e.evt.clientX,
                y: e.evt.clientY,
              });
            }}
            // Touch path to Request Reveal Hand (see my-hand rect above).
            onTouchStart={isTouch && !isSpectator ? (e: Konva.KonvaEventObject<TouchEvent>) => {
              if (e.target !== e.currentTarget) {
                let cur: Konva.Node | null = e.target as Konva.Node;
                while (cur) {
                  if (typeof (cur as any).draggable === 'function' && (cur as any).draggable()) return;
                  cur = cur.getParent();
                }
              }
              beginZonePress(e, (pt) => { closeAllMenus(); setOpponentHandMenu(pt); });
            } : undefined}
            onTouchMove={isTouch ? moveZonePress : undefined}
            onTouchEnd={isTouch ? clearZonePress : undefined}
            perfectDrawEnabled={false}
          />
          {(() => {
            const areaRight = opponentHandRect.x + opponentHandRect.width;
            const bw = 26;
            // "OPPONENT'S HAND" at fontSize 12 + letterSpacing 2 — grows with floored text.
            const lw = 178 * fsGrowth(12);
            const totalW = lw + 8 + bw;
            const sx = areaRight - totalW - 6;
            // 2x2 grid below label to fit the cramped vertical space between
            // the opponent hand strip and the right-side sidebar.
            const colW = 130 * fsGrowth(12);
            const colGap = 14;
            const gridW = colW * 2 + colGap;
            const col1X = areaRight - gridW - 6;
            const col2X = col1X + colW + colGap;
            // Below the label's floored-font bottom (same fix as my side).
            const brigadeTop = opponentHandRect.y + 4 + fs(12) + 8;
            const rowH = 16 * fsGrowth(12);
            return (
              <>
                {/* Count pill lives AFTER the strip (see the opp-hand cards
                    section) so the card backs can never bury it. */}
                <Text x={sx} y={opponentHandRect.y + 4} text="OPPONENT'S HAND" fontSize={fs(12)} fontFamily="Cinzel, Georgia, serif" fill="#a3c5e8" letterSpacing={2} listening={false} perfectDrawEnabled={false} />
                {opponentHandRevealed && opponentHandBrigadeCounts.total > 0 && useCompactLayout && (() => {
                  // Compact: numbers only, one row — see the my-hand strip.
                  const numW = 26 * fsGrowth(12);
                  const stripW = numW * 4;
                  const stripX = areaRight - stripW - 6;
                  const cells: Array<[number, string]> = [
                    [opponentHandBrigadeCounts.total, '#a3c5e8'],
                    [opponentHandBrigadeCounts.good, '#9ab86a'],
                    [opponentHandBrigadeCounts.evil, '#e87560'],
                    [opponentHandBrigadeCounts.neutral, '#c4955a'],
                  ];
                  return (
                    <>
                      {cells.map(([n, color], i) => (
                        <Text
                          key={color}
                          x={stripX + i * numW}
                          y={brigadeTop}
                          width={numW}
                          text={String(n)}
                          fontSize={fs(12)}
                          fontStyle="bold"
                          fontFamily="Cinzel, Georgia, serif"
                          fill={color}
                          align="center"
                          listening={false}
                          perfectDrawEnabled={false}
                        />
                      ))}
                    </>
                  );
                })()}
                {opponentHandRevealed && opponentHandBrigadeCounts.total > 0 && !useCompactLayout && (
                  <>
                    <Text
                      x={col1X}
                      y={brigadeTop}
                      width={colW}
                      text={`Total: ${opponentHandBrigadeCounts.total}`}
                      fontSize={fs(12)}
                      fontStyle="bold"
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#a3c5e8"
                      letterSpacing={1}
                      align="right"
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                    <Text
                      x={col2X}
                      y={brigadeTop}
                      width={colW}
                      text={`Good: ${opponentHandBrigadeCounts.good}`}
                      fontSize={fs(12)}
                      fontStyle="bold"
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#9ab86a"
                      letterSpacing={1}
                      align="right"
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                    <Text
                      x={col1X}
                      y={brigadeTop + rowH}
                      width={colW}
                      text={`Evil: ${opponentHandBrigadeCounts.evil}`}
                      fontSize={fs(12)}
                      fontStyle="bold"
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#e87560"
                      letterSpacing={1}
                      align="right"
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                    <Text
                      x={col2X}
                      y={brigadeTop + rowH}
                      width={colW}
                      text={`Neutral: ${opponentHandBrigadeCounts.neutral}`}
                      fontSize={fs(12)}
                      fontStyle="bold"
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#c4955a"
                      letterSpacing={1}
                      align="right"
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                  </>
                )}
              </>
            );
          })()}

          {/* ================================================================
              Cards in free-form zones — My territory (draggable, clipped).
              Two-pass per-cluster render: for each unequipped card, emit its
              attached weapons first (drawn behind) and then the card itself.
              This keeps equipped weapons visually tucked behind their warriors.
              ================================================================ */}
          {FREE_FORM_ZONES.map((zoneKey) => {
            const cards = myCards[zoneKey];
            if (!cards || cards.length === 0) return null;
            const zone = myZones[zoneKey];
            const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
            const unequipped = sorted.filter((c) => c.equippedToInstanceId === 0n);
            const renderCard = (card: CardInstance, overridePos?: { x: number; y: number }) => {
              const gameCard = adaptCard(card, 'player1');
              const myZone = myZones[zoneKey];
              let x: number, y: number;
              if (overridePos) {
                x = overridePos.x;
                y = overridePos.y;
              } else if (card.posX && myZone) {
                ({ x, y } = toScreenPos(parseFloat(card.posX), parseFloat(card.posY), myZone, 'my'));
              } else {
                x = (myZone?.x ?? 0) + 20;
                y = (myZone?.y ?? 0) + 24;
              }
              // Render-time bottom clamp (spec §2): battle mode compresses the
              // territories, so positions write-clamped against the taller idle
              // zone can otherwise park a card's bottom outside the clip rect.
              if (myZone) y = Math.min(y, myZone.y + myZone.height - cardHeight);
              return (
                <GameCardNode
                  key={String(card.id)}
                  card={gameCard}
                  isArmed={armedCardId === gameCard.instanceId}
                  x={x}
                  y={y}
                  rotation={0}
                  cardWidth={cardWidth}
                  cardHeight={cardHeight}
                  image={getCardImage(card)}
                  {...(getTargetingProps(gameCard) ?? {})}
                  isSelected={isSelected(String(card.id))}
                  isDraggable={!isSpectator}
                  hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                  nodeRef={registerCardNode}
                  onClick={handleCardClick}
                  onDragStart={handleCardDragStart}
                  onDragMove={handleCardDragMove}
                  onDragEnd={handleCardDragEnd}
                  onContextMenu={handleCardContextMenu}
                  onLongPress={isTouch ? handleCardLongPress : undefined}
                  onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                  onDblClick={handleDblClick}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                />
              );
            };
            return (
              <Group
                key={`my-cards-${zoneKey}`}
                clipX={zone?.x ?? 0}
                clipY={zone?.y ?? 0}
                clipWidth={zone?.width ?? VIRTUAL_WIDTH}
                clipHeight={zone?.height ?? VIRTUAL_HEIGHT}
              >
                {unequipped.flatMap((card) => {
                  const attachedWeapons = sorted.filter(
                    (w) => w.equippedToInstanceId === card.id
                  );
                  const nodes: React.ReactNode[] = [];
                  for (const weapon of attachedWeapons) {
                    const derived = myDerivedWeaponPositions.get(String(weapon.id));
                    nodes.push(renderCard(weapon, derived ? { x: derived.x, y: derived.y } : undefined));
                  }
                  nodes.push(renderCard(card));
                  return nodes;
                })}
              </Group>
            );
          })}

          {/* ================================================================
              Cards in free-form zones — Opponent territory (draggable).
              Same two-pass cluster render as my territory, mirrored at 180°.
              ================================================================ */}
          {FREE_FORM_ZONES.map((zoneKey) => {
            const cards = opponentCards[zoneKey];
            if (!cards || cards.length === 0) return null;
            const zone = opponentZones[zoneKey];
            const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
            const unequipped = sorted.filter((c) => c.equippedToInstanceId === 0n);
            const renderCard = (card: CardInstance, overridePos?: { x: number; y: number }) => {
              const gameCard = adaptCard(card, 'player2');
              const oppZone = opponentZones[zoneKey];
              if (!oppZone) return null;
              let x: number, y: number;
              if (overridePos) {
                x = overridePos.x;
                y = overridePos.y;
              } else {
                ({ x, y } = toScreenPos(
                  card.posX ? parseFloat(card.posX) : 0,
                  card.posY ? parseFloat(card.posY) : 0,
                  oppZone,
                  'opponent',
                ));
              }
              // Mirrored render-time clamp (spec §2): the rot-180 anchor is the
              // visual bottom-right — keep the anchor at least a card-height
              // below the zone top so the VISUAL card stays inside.
              y = Math.max(y, oppZone.y + cardHeight);
              return (
                <GameCardNode
                  key={String(card.id)}
                  card={gameCard}
                  isArmed={armedCardId === gameCard.instanceId}
                  x={x}
                  y={y}
                  rotation={180}
                  cardWidth={cardWidth}
                  cardHeight={cardHeight}
                  image={getCardImage(card)}
                  {...(getTargetingProps(gameCard) ?? {})}
                  isSelected={isSelected(String(card.id))}
                  isDraggable={!isSpectator}
                  hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                  nodeRef={registerCardNode}
                  onClick={handleCardClick}
                  onDragStart={handleCardDragStart}
                  onDragMove={handleCardDragMove}
                  onDragEnd={handleCardDragEnd}
                  onContextMenu={handleCardContextMenu}
                  onLongPress={isTouch ? handleCardLongPress : undefined}
                  onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                  onDblClick={handleDblClick}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                />
              );
            };
            return (
              <Group
                key={`opp-cards-${zoneKey}`}
                clipX={zone?.x ?? 0}
                clipY={zone?.y ?? 0}
                clipWidth={zone?.width ?? VIRTUAL_WIDTH}
                clipHeight={zone?.height ?? VIRTUAL_HEIGHT}
              >
                {unequipped.flatMap((card) => {
                  const attachedWeapons = sorted.filter(
                    (w) => w.equippedToInstanceId === card.id
                  );
                  const nodes: React.ReactNode[] = [];
                  for (const weapon of attachedWeapons) {
                    const derived = opponentDerivedWeaponPositions.get(String(weapon.id));
                    nodes.push(renderCard(weapon, derived));
                  }
                  nodes.push(renderCard(card));
                  return nodes;
                })}
              </Group>
            );
          })}

          {/* ================================================================
              Cards in the Field of Battle band — one clip Group over the full
              band with two owner groups inside: my cards (rot 0, 'my' mirror)
              and opponent-owned cards (rot 180, 'opponent' mirror, bottom-right
              anchor) — the same conventions as the territory groups. Mirroring
              is by CARD owner, so each player's cards render on their own half
              on BOTH screens (spec §3). Battle rows only exist while
              battleState is 'active'/'awaiting-soul' — the server auto-returns
              cards when a battle closes, so nothing renders here when the band
              is closed (defensive: stray rows in 'battle' while inactive would
              be invisible; acceptable, the server guarantees the invariant).
              Attached weapons render offset from their host via
              myBattleDerivedWeaponPositions / opponentBattleDerivedWeaponPositions,
              same convention as the territory groups.
              ================================================================ */}
          {battleActive && mpLayout?.zones.battle && (() => {
            const band = mpLayout.zones.battle;
            const myBattle = myCards['battle'] ?? [];
            const oppBattle = opponentCards['battle'] ?? [];
            if (myBattle.length === 0 && oppBattle.length === 0) return null;
            const renderBattleCard = (owner: 'my' | 'opponent') => {
              const adaptedOwner = owner === 'my' ? 'player1' : 'player2';
              return (card: CardInstance, overridePos?: { x: number; y: number }) => {
                const gameCard = adaptCard(card, adaptedOwner);
                let x: number, y: number;
                if (overridePos) {
                  x = overridePos.x;
                  y = overridePos.y;
                } else if (card.posX) {
                  ({ x, y } = toScreenPos(parseFloat(card.posX), parseFloat(card.posY), band, owner));
                } else if (owner === 'my') {
                  x = band.x + 20;
                  y = band.y + 24;
                } else {
                  ({ x, y } = toScreenPos(0, 0, band, 'opponent'));
                }
                // Render-time clamp (spec §2): own cards clamp the bottom edge;
                // opponent-owned rot-180 anchors are the visual bottom-right, so
                // keep the anchor a card-height below the band top instead.
                if (owner === 'my') {
                  y = Math.min(y, band.y + band.height - cardHeight);
                } else {
                  y = Math.max(y, band.y + cardHeight);
                }
                return (
                  <GameCardNode
                    key={String(card.id)}
                    card={gameCard}
                    isArmed={armedCardId === gameCard.instanceId}
                    x={x}
                    y={y}
                    rotation={owner === 'my' ? 0 : 180}
                    cardWidth={cardWidth}
                    cardHeight={cardHeight}
                    image={getCardImage(card)}
                    {...(getTargetingProps(gameCard) ?? {})}
                    isSelected={isSelected(String(card.id))}
                    isDraggable={!isSpectator}
                    hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                    nodeRef={registerCardNode}
                    onClick={handleCardClick}
                    onDragStart={handleCardDragStart}
                    onDragMove={handleCardDragMove}
                    onDragEnd={handleCardDragEnd}
                    onContextMenu={handleCardContextMenu}
                    onLongPress={isTouch ? handleCardLongPress : undefined}
                  onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                    onDblClick={handleDblClick}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                  />
                );
              };
            };
            // Two-pass cluster render (weapons behind their hosts), mirroring
            // the territory groups. Attached weapons render at their derived
            // offset (peeking out from behind their host) instead of their
            // own raw posX/posY.
            const buildBattleNodes = (
              cards: CardInstance[],
              render: (card: CardInstance, overridePos?: { x: number; y: number }) => React.ReactNode,
              derivedPositions: Map<string, { x: number; y: number }>,
            ) => {
              const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
              const unequipped = sorted.filter((c) => c.equippedToInstanceId === 0n);
              return unequipped.flatMap((card) => {
                const attachedWeapons = sorted.filter((w) => w.equippedToInstanceId === card.id);
                const nodes: React.ReactNode[] = [];
                for (const weapon of attachedWeapons) {
                  nodes.push(render(weapon, derivedPositions.get(String(weapon.id))));
                }
                nodes.push(render(card));
                return nodes;
              });
            };
            return (
              <Group
                key="battle-band-cards"
                clipX={band.x}
                clipY={band.y}
                clipWidth={band.width}
                clipHeight={band.height}
              >
                <Group key="battle-my">
                  {buildBattleNodes(myBattle, renderBattleCard('my'), myBattleDerivedWeaponPositions)}
                </Group>
                <Group key="battle-opp">
                  {buildBattleNodes(oppBattle, renderBattleCard('opponent'), opponentBattleDerivedWeaponPositions)}
                </Group>
              </Group>
            );
          })()}

          {battleChromeNode}

          {/* ================================================================
              Cards in auto-arrange zones — My LOB (draggable, horizontal strip).
              Two-pass cluster render: for each unattached LOB card (soul), emit
              its attached accessories (sites) first (drawn behind) and then the
              card itself. Attached sites don't occupy their own auto-arrange slot.
              Paragon: skipped — the shared LoB render block handles both seats.
              ================================================================ */}
          {normalizedFormat !== 'Paragon' && AUTO_ARRANGE_ZONES.map((zoneKey) => {
            const cards = myCards[zoneKey];
            if (!cards || cards.length === 0) return null;
            const zone = myZones[zoneKey];
            if (!zone) return null;
            const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
            const { hosts, accessoriesByHost } = splitLobCards(sorted);
            const renderLobCard = (card: CardInstance, overridePos: { x: number; y: number }) => {
              const gameCard = adaptCard(card, 'player1');
              const cardIdStr = String(card.id);
              return (
                <GameCardNode
                  key={cardIdStr}
                  card={gameCard}
                  isArmed={armedCardId === gameCard.instanceId}
                  x={overridePos.x}
                  y={overridePos.y}
                  rotation={0}
                  cardWidth={lobCard.cardWidth}
                  cardHeight={lobCard.cardHeight}
                  image={getCardImage(card)}
                  {...(getTargetingProps(gameCard) ?? {})}
                  isSelected={isSelected(cardIdStr)}
                  isDraggable={!isSpectator}
                  hoverProgress={hoveredInstanceId === cardIdStr ? hoverProgress : 0}
                  lobArrivalGlow={getMyLobGlow(cardIdStr) > 0}
                  nodeRef={registerCardNode}
                  onClick={handleCardClick}
                  onDragStart={handleCardDragStart}
                  onDragMove={handleCardDragMove}
                  onDragEnd={handleCardDragEnd}
                  onContextMenu={handleCardContextMenu}
                  onLongPress={isTouch ? handleCardLongPress : undefined}
                  onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                  onDblClick={handleDblClick}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                />
              );
            };
            // Accessories render FIRST (behind hosts), in a separate group
            // WITHOUT zone clipping so they can peek above the LOB strip.
            const accessoryNodes: React.ReactNode[] = [];
            const hostNodes: React.ReactNode[] = [];
            for (const host of hosts) {
              const hostPos = myLobLayout.hostPositions.get(String(host.id));
              if (!hostPos) continue;
              // In flight → the flyer shows it; skip the settled node this frame.
              if (myDeals.has(String(host.id))) continue;
              const attached = accessoriesByHost.get(host.id) ?? [];
              for (const accessory of attached) {
                const pos = myLobLayout.accessoryPositions.get(String(accessory.id));
                if (!pos) continue;
                accessoryNodes.push(renderLobCard(accessory, { x: pos.x, y: pos.y }));
              }
              hostNodes.push(renderLobCard(host, hostPos));
            }
            return (
              <React.Fragment key={`my-auto-${zoneKey}`}>
                {/* Attached accessories — unclipped so they peek above the zone */}
                <Group>{accessoryNodes}</Group>
                {/* Hosts — clipped to the zone rect */}
                <Group clipX={zone.x} clipY={zone.y} clipWidth={zone.width} clipHeight={zone.height}>
                  {hostNodes}
                </Group>
              </React.Fragment>
            );
          })}

          {/* ================================================================
              Cards in auto-arrange zones — Opponent LOB (draggable, horizontal strip).
              Two-pass cluster render mirroring my LOB, rotated 180°. Accessory
              anchor comes from opponentDerivedWeaponPositions (already mirrored).
              Paragon: skipped — the shared LoB render block handles both seats.
              ================================================================ */}
          {normalizedFormat !== 'Paragon' && AUTO_ARRANGE_ZONES.map((zoneKey) => {
            const cards = opponentCards[zoneKey];
            if (!cards || cards.length === 0) return null;
            const zone = opponentZones[zoneKey];
            if (!zone) return null;
            const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
            const { hosts, accessoriesByHost } = splitLobCards(sorted);
            const renderOppLobCard = (
              card: CardInstance,
              anchor: { x: number; y: number },
            ) => {
              const gameCard = adaptCard(card, 'player2');
              const cardIdStr = String(card.id);
              return (
                <GameCardNode
                  key={cardIdStr}
                  card={gameCard}
                  isArmed={armedCardId === gameCard.instanceId}
                  x={anchor.x}
                  y={anchor.y}
                  rotation={180}
                  cardWidth={lobCard.cardWidth}
                  cardHeight={lobCard.cardHeight}
                  image={getCardImage(card)}
                  {...(getTargetingProps(gameCard) ?? {})}
                  isSelected={isSelected(cardIdStr)}
                  isDraggable={!isSpectator}
                  hoverProgress={hoveredInstanceId === cardIdStr ? hoverProgress : 0}
                  lobArrivalGlow={getOppLobGlow(cardIdStr) > 0}
                  nodeRef={registerCardNode}
                  onClick={handleCardClick}
                  onDragStart={handleCardDragStart}
                  onDragMove={handleCardDragMove}
                  onDragEnd={handleCardDragEnd}
                  onContextMenu={handleCardContextMenu}
                  onLongPress={isTouch ? handleCardLongPress : undefined}
                  onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                  onDblClick={handleDblClick}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                />
              );
            };
            // Accessories render FIRST (behind hosts), in a separate group
            // WITHOUT zone clipping so they can peek below the LOB strip
            // (toward the center of the play area).
            const accessoryNodes: React.ReactNode[] = [];
            const hostNodes: React.ReactNode[] = [];
            for (const host of hosts) {
              const hostPos = opponentLobLayout.hostPositions.get(String(host.id));
              if (!hostPos) continue;
              if (oppDeals.has(String(host.id))) continue;
              const attached = accessoriesByHost.get(host.id) ?? [];
              for (const accessory of attached) {
                const pos = opponentLobLayout.accessoryPositions.get(String(accessory.id));
                if (!pos) continue;
                accessoryNodes.push(renderOppLobCard(accessory, { x: pos.x, y: pos.y }));
              }
              hostNodes.push(
                renderOppLobCard(host, {
                  x: hostPos.x + lobCard.cardWidth,
                  y: hostPos.y + lobCard.cardHeight,
                }),
              );
            }
            return (
              <React.Fragment key={`opp-auto-${zoneKey}`}>
                <Group>{accessoryNodes}</Group>
                <Group clipX={zone.x} clipY={zone.y} clipWidth={zone.width} clipHeight={zone.height}>
                  {hostNodes}
                </Group>
              </React.Fragment>
            );
          })}

          {/* ================================================================
              Paragon-only: shared Land of Bondage render. Both seats draw from
              `sharedCards['land-of-bondage']` with rotation=0 (no mirror). We
              reuse `adaptCard(c, 'player1')` because sharedCards don't have a
              seat — authorization lives server-side.
              ================================================================ */}
          {normalizedFormat === 'Paragon' && (() => {
            const zoneKey = 'land-of-bondage';
            const cards = sharedCards[zoneKey] ?? [];
            if (cards.length === 0) return null;
            const zone = mpLayout?.zones.sharedLob;
            if (!zone) return null;
            const sorted = [...cards].sort((a, b) => Number(a.zoneIndex) - Number(b.zoneIndex));
            const { hosts, accessoriesByHost } = splitLobCards(sorted);
            const renderSharedLobCard = (card: CardInstance, overridePos: { x: number; y: number }) => {
              const gameCard = adaptCard(card, 'player1');
              const cardIdStr = String(card.id);
              return (
                <GameCardNode
                  key={cardIdStr}
                  card={gameCard}
                  isArmed={armedCardId === gameCard.instanceId}
                  x={overridePos.x}
                  y={overridePos.y}
                  rotation={0}
                  cardWidth={lobCard.cardWidth}
                  cardHeight={lobCard.cardHeight}
                  image={getCardImage(card)}
                  {...(getTargetingProps(gameCard) ?? {})}
                  isSelected={isSelected(cardIdStr)}
                  isDraggable={!isSpectator}
                  hoverProgress={hoveredInstanceId === cardIdStr ? hoverProgress : 0}
                  nodeRef={registerCardNode}
                  onClick={handleCardClick}
                  onDragStart={handleCardDragStart}
                  onDragMove={handleCardDragMove}
                  onDragEnd={handleCardDragEnd}
                  onContextMenu={handleCardContextMenu}
                  onLongPress={isTouch ? handleCardLongPress : undefined}
                  onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                  onDblClick={handleDblClick}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                />
              );
            };
            const accessoryNodes: React.ReactNode[] = [];
            const hostNodes: React.ReactNode[] = [];
            for (const host of hosts) {
              const hostPos = sharedLobLayout.hostPositions.get(String(host.id));
              if (!hostPos) continue;
              if (sharedDeals.has(String(host.id))) continue;
              const attached = accessoriesByHost.get(host.id) ?? [];
              for (const accessory of attached) {
                const pos = sharedLobLayout.accessoryPositions.get(String(accessory.id));
                if (!pos) continue;
                accessoryNodes.push(renderSharedLobCard(accessory, { x: pos.x, y: pos.y }));
              }
              hostNodes.push(renderSharedLobCard(host, hostPos));
            }
            return (
              <React.Fragment key="shared-auto-land-of-bondage">
                <Group>{accessoryNodes}</Group>
                <Group clipX={zone.x} clipY={zone.y} clipWidth={zone.width} clipHeight={zone.height}>
                  {hostNodes}
                </Group>
              </React.Fragment>
            );
          })()}

          {/* ================================================================
              Paragon-only: Soul Deck pile. Face-down stack anchored in the
              soul-deck rect (left of shared LoB). Right-click opens a deck-
              style context menu (Search / Shuffle / Look / Reveal).
              ================================================================ */}
          {normalizedFormat === 'Paragon' && mpLayout?.zones.soulDeck && (sharedCards['soul-deck']?.length ?? 0) > 0 && (() => {
            const zone = mpLayout.zones.soulDeck!;
            const count = sharedCards['soul-deck']?.length ?? 0;
            const pileWidth = Math.min(lobCard.cardWidth, zone.width - 4);
            const pileHeight = Math.round(pileWidth * 1.4);
            const px = zone.x + (zone.width - pileWidth) / 2;
            const py = zone.y + (zone.height - pileHeight) / 2;
            return (
              <Group
                key="soul-deck-pile"
                draggable={true}
                onContextMenu={handleSharedSoulDeckContextMenu}
                // Touch path to the soul-deck menu; the fire-time movement
                // re-check in beginZonePress keeps drag-to-draw intact.
                onTouchStart={isTouch && !isSpectator ? (e: Konva.KonvaEventObject<TouchEvent>) => beginZonePress(e, (pt) => { closeAllMenus(); setSoulDeckMenu(pt); }) : undefined}
                onTouchMove={isTouch ? moveZonePress : undefined}
                onTouchEnd={isTouch ? clearZonePress : undefined}
                onDragStart={handleSoulDeckPileDragStart}
                onDragEnd={handleSoulDeckPileDragEnd}
                hitFunc={(ctx: any, shape: any) => {
                  ctx.beginPath();
                  ctx.rect(px - 2, py - 2, pileWidth, pileHeight);
                  ctx.closePath();
                  ctx.fillStrokeShape(shape);
                }}
              >
                {count > 1 && (
                  soulDeckBackReady && soulDeckBackRef.current ? (
                    <KonvaImage
                      image={soulDeckBackRef.current}
                      x={px - 2}
                      y={py - 2}
                      width={pileWidth}
                      height={pileHeight}
                      cornerRadius={4}
                      opacity={0.85}
                      perfectDrawEnabled={false}
                    />
                  ) : (
                    <Rect
                      x={px - 2}
                      y={py - 2}
                      width={pileWidth}
                      height={pileHeight}
                      fill="#2a1410"
                      stroke="#6b4e27"
                      strokeWidth={1}
                      cornerRadius={4}
                      perfectDrawEnabled={false}
                    />
                  )
                )}
                {soulDeckBackReady && soulDeckBackRef.current ? (
                  <KonvaImage
                    image={soulDeckBackRef.current}
                    x={px}
                    y={py}
                    width={pileWidth}
                    height={pileHeight}
                    cornerRadius={4}
                    perfectDrawEnabled={false}
                  />
                ) : (
                  <Rect
                    x={px}
                    y={py}
                    width={pileWidth}
                    height={pileHeight}
                    fill="#3a1e18"
                    stroke="#c4955a"
                    strokeWidth={1}
                    cornerRadius={4}
                    perfectDrawEnabled={false}
                  />
                )}
                <Group x={px + pileWidth - 30} y={py + 4}>
                  <Rect width={28} height={20} fill="#2a1f12" cornerRadius={4} stroke="#c4955a" strokeWidth={1} perfectDrawEnabled={false} />
                  <Text
                    text={String(count)}
                    fontSize={fs(14)}
                    fontStyle="bold"
                    fill="#e8d5a3"
                    width={28}
                    height={20}
                    align="center"
                    verticalAlign="middle"
                    perfectDrawEnabled={false}
                  />
                </Group>
                <Text
                  x={px}
                  y={py + pileHeight - 16}
                  width={pileWidth}
                  text="SOUL DECK"
                  fontSize={fs(9)}
                  fontFamily="Cinzel, Georgia, serif"
                  fill="#e8d5a3"
                  letterSpacing={1}
                  align="center"
                  perfectDrawEnabled={false}
                />
              </Group>
            );
          })()}

          {/* ================================================================
              LOB label overlays — rendered AFTER cards so labels sit on top
              ================================================================ */}
          {normalizedFormat !== 'Paragon' && (() => {
            const lobEntries: { zone: typeof myZones[string]; isOpponent: boolean }[] = [];
            const myLob = myZones['land-of-bondage'];
            const oppLob = opponentZones['land-of-bondage'];
            if (myLob) lobEntries.push({ zone: myLob, isOpponent: false });
            if (oppLob) lobEntries.push({ zone: oppLob, isOpponent: true });
            return lobEntries.map(({ zone, isOpponent }) => {
              const cards = isOpponent ? (opponentCards['land-of-bondage'] ?? []) : (myCards['land-of-bondage'] ?? []);
              const lobLabel = useCompactLayout ? COMPACT_PILE_LABELS['land-of-bondage'] : zone.label.toUpperCase();
              const lobFs = fs(11);
              const fillColor = isOpponent ? '#a3c5e8' : '#e8d5a3';
              const badgeFill = isOpponent ? 'rgba(100, 149, 237, 0.25)' : 'rgba(196, 149, 90, 0.25)';
              const badgeStroke = isOpponent ? 'rgba(100, 149, 237, 0.5)' : 'rgba(196, 149, 90, 0.5)';
              const bgFill = isOpponent ? 'rgba(16, 20, 30, 0.85)' : 'rgba(30, 22, 16, 0.85)';
              const badgeW = Math.max(24, Math.round(lobFs * 2.2));
              const badgeH = lobFs + 3;
              const bandH = Math.max(20, lobFs + 9);
              const fullLabelWidth = measureLabelWidth(lobLabel, lobFs, 1);
              const maxLabelWidth = Math.max(10, zone.width - badgeW - 22);
              const labelTextWidth = Math.min(fullLabelWidth, maxLabelWidth);
              const bgW = Math.min(6 + labelTextWidth + 8 + badgeW + 8, zone.width);
              const bgX = zone.x + zone.width - bgW;
              const labelX = bgX + 6;
              const badgeX = labelX + labelTextWidth + 8;
              const textY = zone.y + Math.round((bandH - lobFs) / 2);
              return (
                <Group key={`lob-overlay-${isOpponent ? 'opp' : 'my'}`} listening={false}>
                  <Rect
                    x={bgX}
                    y={zone.y}
                    width={bgW}
                    height={bandH}
                    fill={bgFill}
                    cornerRadius={[0, 3, 0, 4]}
                    perfectDrawEnabled={false}
                  />
                  <Text
                    x={labelX}
                    y={textY}
                    text={lobLabel}
                    fontSize={lobFs}
                    fontFamily="Cinzel, Georgia, serif"
                    fill={fillColor}
                    letterSpacing={1}
                    width={labelTextWidth + 2}
                    wrap="none"
                    ellipsis={true}
                    perfectDrawEnabled={false}
                  />
                  <Rect
                    x={badgeX}
                    y={zone.y + Math.round((bandH - badgeH) / 2)}
                    width={badgeW}
                    height={badgeH}
                    fill={badgeFill}
                    cornerRadius={3}
                    stroke={badgeStroke}
                    strokeWidth={0.5}
                    perfectDrawEnabled={false}
                  />
                  <Text
                    x={badgeX}
                    y={textY}
                    width={badgeW}
                    text={String(cards.length)}
                    fontSize={lobFs}
                    fill={fillColor}
                    align="center"
                    perfectDrawEnabled={false}
                  />
                </Group>
              );
            });
          })()}

          {/* ================================================================
              Paragon-only: shared LoB label overlay ("Land of Bondage (Shared)").
              ================================================================ */}
          {normalizedFormat === 'Paragon' && mpLayout?.zones.sharedLob && (() => {
            const zone = mpLayout.zones.sharedLob!;
            const cards = sharedCards['land-of-bondage'] ?? [];
            const sharedLobLabel = useCompactLayout ? COMPACT_PILE_LABELS['land-of-bondage'] : zone.label.toUpperCase();
            const sharedFs = fs(11);
            const fillColor = '#e8d5a3';
            const badgeFill = 'rgba(196, 149, 90, 0.25)';
            const badgeStroke = 'rgba(196, 149, 90, 0.5)';
            const bgFill = 'rgba(30, 22, 16, 0.85)';
            const badgeW = Math.max(24, Math.round(sharedFs * 2.2));
            const badgeH = sharedFs + 3;
            const bandH = Math.max(20, sharedFs + 9);
            const fullLabelWidth = measureLabelWidth(sharedLobLabel, sharedFs, 1);
            const maxLabelWidth = Math.max(10, zone.width - badgeW - 22);
            const labelTextWidth = Math.min(fullLabelWidth, maxLabelWidth);
            const bgW = Math.min(6 + labelTextWidth + 8 + badgeW + 8, zone.width);
            const bgX = zone.x + zone.width - bgW;
            const labelX = bgX + 6;
            const badgeX = labelX + labelTextWidth + 8;
            const textY = zone.y + Math.round((bandH - sharedFs) / 2);
            return (
              <Group key="lob-overlay-shared" listening={false}>
                <Rect
                  x={bgX}
                  y={zone.y}
                  width={bgW}
                  height={bandH}
                  fill={bgFill}
                  cornerRadius={[0, 3, 0, 4]}
                  perfectDrawEnabled={false}
                />
                <Text
                  x={labelX}
                  y={textY}
                  text={sharedLobLabel}
                  fontSize={sharedFs}
                  fontFamily="Cinzel, Georgia, serif"
                  fill={fillColor}
                  letterSpacing={1}
                  width={labelTextWidth + 2}
                  wrap="none"
                  ellipsis={true}
                  perfectDrawEnabled={false}
                />
                <Rect
                  x={badgeX}
                  y={zone.y + Math.round((bandH - badgeH) / 2)}
                  width={badgeW}
                  height={badgeH}
                  fill={badgeFill}
                  cornerRadius={3}
                  stroke={badgeStroke}
                  strokeWidth={0.5}
                  perfectDrawEnabled={false}
                />
                <Text
                  x={badgeX}
                  y={textY}
                  width={badgeW}
                  text={String(cards.length)}
                  fontSize={sharedFs}
                  fill={fillColor}
                  align="center"
                  perfectDrawEnabled={false}
                />
              </Group>
            );
          })()}

          {/* ================================================================
              Territory label overlays — rendered AFTER cards so labels sit on top
              ================================================================ */}
          {(() => {
            const territoryEntries: { zone: typeof myZones[string]; isOpponent: boolean; cards: typeof myCards[string] }[] = [];
            const myTerr = myZones['territory'];
            const oppTerr = opponentZones['territory'];
            if (myTerr) territoryEntries.push({ zone: myTerr, isOpponent: false, cards: myCards['territory'] ?? [] });
            if (oppTerr) territoryEntries.push({ zone: oppTerr, isOpponent: true, cards: opponentCards['territory'] ?? [] });
            return territoryEntries.map(({ zone, isOpponent, cards }) => {
              const labelFs = fs(11);
              // Spectators sit in neither seat, so "TERRITORY" vs "OPPONENT'S
              // TERRITORY" answers nothing — name the owner instead. (For a
              // spectator, gameState.myPlayer is seat 0 by convention.)
              const labelText = (isSpectator
                ? `${(isOpponent ? gameState.opponentPlayer?.displayName : gameState.myPlayer?.displayName) || (isOpponent ? 'Player 2' : 'Player 1')}'s Territory`
                : zone.label
              ).toUpperCase();
              const fillColor = isOpponent ? '#a3c5e8' : '#e8d5a3';
              const badgeFill = isOpponent ? 'rgba(100, 149, 237, 0.25)' : 'rgba(196, 149, 90, 0.25)';
              const badgeStroke = isOpponent ? 'rgba(100, 149, 237, 0.5)' : 'rgba(196, 149, 90, 0.5)';
              const bgFill = isOpponent ? 'rgba(16, 20, 30, 0.85)' : 'rgba(30, 22, 16, 0.85)';
              const badgeW = Math.max(24, Math.round(labelFs * 2.2));
              const badgeH = labelFs + 3;
              const bandH = Math.max(20, labelFs + 9);
              const fullLabelWidth = measureLabelWidth(labelText, labelFs, 1);
              // Band clamps to the zone; the label truncates before the badge does.
              const maxLabelWidth = Math.max(10, zone.width - badgeW - 22);
              const labelTextWidth = Math.min(fullLabelWidth, maxLabelWidth);
              const bgW = Math.min(6 + labelTextWidth + 8 + badgeW + 8, zone.width);
              const bgX = zone.x + zone.width - bgW;
              const labelX = bgX + 6;
              const badgeX = labelX + labelTextWidth + 8;
              const textY = zone.y + Math.round((bandH - labelFs) / 2);
              return (
                <Group key={`territory-overlay-${isOpponent ? 'opp' : 'my'}`} listening={false}>
                  <Rect
                    x={bgX}
                    y={zone.y}
                    width={bgW}
                    height={bandH}
                    fill={bgFill}
                    cornerRadius={[0, 3, 0, 4]}
                    perfectDrawEnabled={false}
                  />
                  <Text
                    x={labelX}
                    y={textY}
                    text={labelText}
                    fontSize={labelFs}
                    fontFamily="Cinzel, Georgia, serif"
                    fill={fillColor}
                    letterSpacing={1}
                    width={labelTextWidth + 2}
                    wrap="none"
                    ellipsis={true}
                    perfectDrawEnabled={false}
                  />
                  <Rect
                    x={badgeX}
                    y={zone.y + Math.round((bandH - badgeH) / 2)}
                    width={badgeW}
                    height={badgeH}
                    fill={badgeFill}
                    cornerRadius={3}
                    stroke={badgeStroke}
                    strokeWidth={0.5}
                    perfectDrawEnabled={false}
                  />
                  <Text
                    x={badgeX}
                    y={textY}
                    width={badgeW}
                    text={String(cards.length)}
                    fontSize={labelFs}
                    fill={fillColor}
                    align="center"
                    perfectDrawEnabled={false}
                  />
                </Group>
              );
            });
          })()}

          {/* ================================================================
              Sidebar pile indicators — My zones (NOT draggable, interactions via context menu)
              ================================================================ */}
          {SIDEBAR_ZONES.map((zoneKey) => {
            const zone = myZones[zoneKey];
            if (!zone) return null;
            const cards = myCards[zoneKey] ?? [];
            const count = cards.length;
            // The LoR badge shows redeemed-soul VALUE, not card count — the
            // Two/Three Liner souls count as two Lost Souls each, and cards
            // that aren't Lost Souls at all (e.g. Guardian of Your Souls,
            // which legitimately plays to the Land of Redemption) count zero.
            const badgeCount = zoneKey === 'land-of-redemption'
              ? cards.filter(isLostSoulCard).reduce((n, c) => n + lostSoulValue(c.cardName), 0)
              : count;
            // Cell header metrics. The badge grows with the floored font —
            // fixed at 26x18 it clipped "53" to "5" whenever fs() grew (Konva
            // char-wraps the overflowing digit onto a clipped second line).
            // Compact drops the grown badge under the label row (side by side
            // they no longer fit a phone cell); the art starts below whichever
            // header is in play and shrinks rather than overflow the cell.
            const pileBadgeGrow = fsGrowth(12);
            const bw = Math.round(26 * pileBadgeGrow);
            const bh = Math.round(18 * pileBadgeGrow);
            const badgeX = zone.x + zone.width - bw - 6;
            const badgeY = useCompactLayout ? Math.round(zone.y + 4 + fs(11) + 3) : zone.y + 2;
            const headerH = useCompactLayout ? Math.round(4 + fs(11) + 3 + bh + 3) : Math.max(18, bh + 4);
            const cellCardH = Math.max(12, Math.min(pileCardHeight, zone.height - headerH - 2));
            const cellCardW = Math.round(cellCardH / 1.4);
            const cx = zone.x + zone.width / 2 - cellCardW / 2;
            const cy = zone.y + headerH + Math.max(0, (zone.height - headerH - cellCardH) / 2);

            // Discard, LOR, and Reserve show top card face-up; everything else shows card back
            // Reserve always shows face-up to the owner regardless of isFlipped
            // Reserve sorts in the canonical default order to match the browse modal.
            // While a per-card reveal is active (e.g. Herod's Temple), pin the revealed
            // card to the end so it renders on top of the visual stack instead of being
            // buried by the sort.
            const nowMicrosForSort = BigInt(Date.now()) * 1000n;
            const sortedCards = zoneKey === 'reserve'
              ? [...cards].sort((a, b) => {
                  const aRevealed = a.revealExpiresAt !== undefined && a.revealExpiresAt.microsSinceUnixEpoch > nowMicrosForSort ? 1 : 0;
                  const bRevealed = b.revealExpiresAt !== undefined && b.revealExpiresAt.microsSinceUnixEpoch > nowMicrosForSort ? 1 : 0;
                  if (aRevealed !== bRevealed) return aRevealed - bRevealed;
                  return compareCardsDefault(
                    { name: a.cardName ?? '', type: a.cardType ?? '', brigade: a.brigade, alignment: a.alignment, strength: a.strength, reference: a.reference },
                    { name: b.cardName ?? '', type: b.cardType ?? '', brigade: b.brigade, alignment: b.alignment, strength: b.strength, reference: b.reference },
                  );
                })
              : cards;
            // For the deck, the top of the pile is the lowest zoneIndex (cards
            // are sorted ascending), so the draggable "draw" card is the first
            // element. For face-up piles (discard/reserve/banish/LOR) the last
            // element renders on top, so that one is the visible top card.
            const topCard = zoneKey === 'deck' ? sortedCards[0] : sortedCards[sortedCards.length - 1];
            const showFace = topCard && ((zoneKey === 'discard' || zoneKey === 'land-of-redemption' || zoneKey === 'banish') ? !topCard.isFlipped : (zoneKey === 'reserve' && canViewMyReserve));

            const openMyPileGroupMenu = (pt: { x: number; y: number }) => {
              closeAllMenus();
              if (zoneKey === 'deck') setDeckMenu(pt);
              else if (zoneKey === 'land-of-redemption') setLorMenu(pt);
              else if (zoneKey === 'reserve') setReserveMenu(pt);
              else if (zoneKey === 'discard' || zoneKey === 'banish') setBrowseMyZone(zoneKey);
            };
            return (
              <Group
                key={`my-pile-${zoneKey}`}
                onClick={zoneKey !== 'deck' && !(zoneKey === 'reserve' && !canViewMyReserve) ? (e: Konva.KonvaEventObject<PointerEvent>) => {
                  if (!isPrimaryPointer(e.evt)) return;  // TouchEvent has no `button`
                  setBrowseMyZone(zoneKey);
                } : undefined}
                // Tap parity: the browse fallback used to live only on the zone
                // Rect UNDERNEATH this Group, so the art surface swallowed
                // taps. Deck and a hidden reserve tap into their menus (their
                // desktop click is a no-op; the menu holds the touch path to
                // draw X / search / reveal).
                onTap={(e: Konva.KonvaEventObject<TouchEvent>) => {
                  if (zoneLongPressFiredRef.current) { zoneLongPressFiredRef.current = false; return; }
                  const t = (e.evt as TouchEvent).changedTouches?.[0];
                  const pt = t ? { x: t.clientX, y: t.clientY } : { x: 0, y: 0 };
                  if (zoneKey === 'deck' || (zoneKey === 'reserve' && !canViewMyReserve)) openMyPileGroupMenu(pt);
                  else setBrowseMyZone(zoneKey);
                }}
                onDblClick={undefined}
                onContextMenu={(e: Konva.KonvaEventObject<PointerEvent>) => {
                  e.evt.preventDefault();
                  openMyPileGroupMenu({ x: e.evt.clientX, y: e.evt.clientY });
                }}
                // Long-press opens the same menu the desktop right-click does.
                // LoR is excluded when the press lands on a spread card — the
                // card's own long-press (card menu) owns that gesture.
                onTouchStart={isTouch ? (e: Konva.KonvaEventObject<TouchEvent>) => {
                  if (zoneKey === 'land-of-redemption' && e.target !== e.currentTarget) {
                    let cur: Konva.Node | null = e.target as Konva.Node;
                    while (cur) {
                      if (typeof (cur as any).draggable === 'function' && (cur as any).draggable()) return;
                      cur = cur.getParent();
                    }
                  }
                  beginZonePress(e, openMyPileGroupMenu);
                } : undefined}
                onTouchMove={isTouch ? moveZonePress : undefined}
                onTouchEnd={isTouch ? clearZonePress : undefined}
                hitFunc={(ctx: any, shape: any) => {
                  ctx.beginPath();
                  ctx.rect(zone.x, zone.y, zone.width, zone.height);
                  ctx.closePath();
                  ctx.fillStrokeShape(shape);
                }}
              >
                {/* Count badge — see the header metrics above for sizing. */}
                <Group x={badgeX} y={badgeY} listening={false}>
                  <Rect width={bw} height={bh} fill="#2a1f12" cornerRadius={4} stroke="#c4955a" strokeWidth={1} perfectDrawEnabled={false} />
                  <Text
                    text={String(badgeCount)}
                    fontSize={fs(12)}
                    fontStyle="bold"
                    fill="#e8d5a3"
                    width={bw}
                    height={bh}
                    align="center"
                    verticalAlign="middle"
                    perfectDrawEnabled={false}
                  />
                </Group>

                {/* Revealed indicator for own reserve — clickable to hide. Sits left of the count badge. */}
                {zoneKey === 'reserve' && (gameState.myPlayer?.reserveRevealed ?? false) && (
                  <Group
                    x={badgeX - 26}
                    y={badgeY}
                    onMouseDown={(e: Konva.KonvaEventObject<PointerEvent>) => { e.cancelBubble = true; }}
                    onClick={(e: Konva.KonvaEventObject<PointerEvent>) => {
                      e.cancelBubble = true;
                      e.evt.stopPropagation();
                      if (!isPrimaryPointer(e.evt)) return;  // TouchEvent has no `button`
                      gameState.revealReserve(false);
                    }}
                    // onClick never fires from a touch tap — without this
                    // mirror, un-revealing the reserve was unreachable on touch.
                    onTap={(e: Konva.KonvaEventObject<TouchEvent>) => {
                      e.cancelBubble = true;
                      gameState.revealReserve(false);
                    }}
                    onMouseEnter={() => { const c = stageRef.current?.container(); if (c) c.style.cursor = 'pointer'; }}
                    onMouseLeave={() => { const c = stageRef.current?.container(); if (c) c.style.cursor = 'default'; }}
                    hitFunc={(ctx: any, shape: any) => {
                      ctx.beginPath();
                      ctx.rect(0, 0, 20, 18);
                      ctx.closePath();
                      ctx.fillStrokeShape(shape);
                    }}
                  >
                    <Rect width={20} height={18} fill="#1a2e1a" cornerRadius={4} stroke="#5a9a5a" strokeWidth={1} perfectDrawEnabled={false} />
                    <Text
                      text="👁"
                      fontSize={fs(11)}
                      width={20}
                      height={18}
                      align="center"
                      verticalAlign="middle"
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                  </Group>
                )}

                {/* LOR: spread all cards face-up with horizontal overlap */}
                {zoneKey === 'land-of-redemption' && count > 0 && (() => {
                  const pad = 4;
                  const availW = zone.width - pad * 2;
                  const overlap = count <= 1 ? 0 : Math.min(cellCardW * 0.3, (availW - cellCardW) / (count - 1));
                  return cards.map((c, i) => {
                    const img = getCardImage(c);
                    const gameCard = adaptCard(c, 'player1');
                    const cardX = zone.x + pad + i * overlap;
                    // Below the 18px label/badge header, like the other piles —
                    // full-height centering ran the cards up into the label row.
                    const cardY = zone.y + headerH + Math.max(0, (zone.height - headerH - cellCardH) / 2);
                    return img ? (
                      <GameCardNode
                        key={String(c.id)}
                        card={gameCard}
                        isArmed={armedCardId === gameCard.instanceId}
                        x={cardX}
                        y={cardY}
                        rotation={0}
                        cardWidth={cellCardW}
                        cardHeight={cellCardH}
                        image={img}
                        {...(getTargetingProps(gameCard) ?? {})}
                        isSelected={isSelected(String(c.id))}
                        isDraggable={!isSpectator}
                        nodeRef={registerCardNode}
                        hoverProgress={hoveredInstanceId === String(c.id) ? hoverProgress : 0}
                        onClick={handleCardClick}
                        onDragStart={handleCardDragStart}
                        onDragMove={handleCardDragMove}
                        onDragEnd={handleCardDragEnd}
                        onContextMenu={handleCardContextMenu}
                        onLongPress={isTouch ? handleCardLongPress : undefined}
                  onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                        onDblClick={noopDblClick}
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                      />
                    ) : (
                      <Group key={String(c.id)} x={cardX} y={cardY}>
                        <CardBackShape width={cellCardW} height={cellCardH} />
                      </Group>
                    );
                  });
                })()}

                {/* Pile visual — only if zone has cards (non-LOR) */}
                {zoneKey !== 'land-of-redemption' && count > 0 && (
                  <Group x={cx} y={cy}>
                    {/* Shadow card for depth if multiple — hide when showing face-up */}
                    {count > 1 && !showFace && (
                      <Group x={-2} y={-2}>
                        <CardBackShape width={cellCardW} height={cellCardH} />
                      </Group>
                    )}
                    {showFace ? (
                      // Render the top few cards stacked — each independently
                      // draggable. Only the topmost is visible; when dragged away
                      // the next card is already rendered underneath with its own
                      // node ref. Depth 3 (not the whole pile) keeps a 35-card
                      // discard from mounting hundreds of invisible Konva nodes:
                      // only the topmost node is grabbable, so drag paths never
                      // reference a buried card, and 3 covers rapid repeat drags.
                      sortedCards.slice(-3).map((c) => {
                        const effective = zoneKey === 'reserve' && c.isFlipped
                          ? { ...c, isFlipped: false }
                          : c;
                        const img = getCardImage(effective);
                        const isDraggableZone = zoneKey === 'discard' || zoneKey === 'reserve' || zoneKey === 'banish';
                        const gameCard = adaptCard(effective, 'player1');
                        return img ? (
                          <GameCardNode
                            key={String(c.id)}
                            card={gameCard}
                            isArmed={armedCardId === gameCard.instanceId}
                            x={0}
                            y={0}
                            rotation={0}
                            cardWidth={cellCardW}
                            cardHeight={cellCardH}
                            image={img}
                            {...(getTargetingProps(gameCard) ?? {})}
                            isSelected={false}
                            isDraggable={isDraggableZone && !isSpectator}
                            nodeRef={isDraggableZone ? registerCardNode : undefined}
                            hoverProgress={hoveredInstanceId === String(c.id) ? hoverProgress : 0}
                            onDragStart={isDraggableZone ? handleCardDragStart : noopCardDrag}
                            onDragMove={isDraggableZone ? handleCardDragMove : noopDrag}
                            onDragEnd={isDraggableZone ? handleCardDragEnd : noopCardDragEnd}
                            onContextMenu={noopContextMenu}
                            onDblClick={noopDblClick}
                            onMouseEnter={handleMouseEnter}
                            onMouseLeave={handleMouseLeave}
                          />
                        ) : (
                          <Group key={String(c.id)}>
                            <CardBackShape width={cellCardW} height={cellCardH} />
                          </Group>
                        );
                      })
                    ) : zoneKey === 'deck' && topCard ? (
                      // Deck top card is draggable (to draw). Its identity is
                      // hidden information — face + hover preview stay
                      // suppressed unless the owner's top-deck reveal toggle
                      // (The Foretelling Angel) is active.
                      (() => {
                        const topRevealed = gameState.myPlayer?.topDeckRevealed ?? false;
                        const effectiveTop = topRevealed && topCard.isFlipped
                          ? { ...topCard, isFlipped: false }
                          : topCard;
                        // adaptCard returns the reference-stable cached GameCard
                        // for this row id, so the isFlipped override spread onto
                        // effectiveTop is dropped in favor of the cached copy
                        // (deck rows rest isFlipped=true) — re-apply it on the
                        // adapted card or GameCardNode renders the card back.
                        const adapted = adaptCard(effectiveTop, 'player1');
                        const gameCard = topRevealed && adapted.isFlipped
                          ? { ...adapted, isFlipped: false }
                          : adapted;
                        return (
                          <GameCardNode
                            // Keyed by row id so drawing the top card UNMOUNTS
                            // this node instead of updating it in place. Drag
                            // reparents the Konva node onto the game layer
                            // (handleCardDragStart: node.moveTo(layer)); only an
                            // unmount makes react-konva destroy it. Unkeyed,
                            // React reused the displaced node for the NEXT top
                            // card — leaving the pile showing just the shadow
                            // CardBackShape until a full remount (hard refresh).
                            // Invisible pre-toggle because every top rendered as
                            // an identical back. Opponent branch already keys.
                            key={String(topCard.id)}
                            card={gameCard}
                            isArmed={armedCardId === gameCard.instanceId}
                            x={0}
                            y={0}
                            rotation={0}
                            cardWidth={cellCardW}
                            cardHeight={cellCardH}
                            image={topRevealed ? getCardImage(effectiveTop) : undefined}
                            {...(getTargetingProps(gameCard) ?? {})}
                            isSelected={false}
                            isDraggable={!isSpectator}
                            nodeRef={registerCardNode}
                            hoverProgress={topRevealed && hoveredInstanceId === String(topCard.id) ? hoverProgress : 0}
                            onDragStart={handleCardDragStart}
                            onDragMove={handleCardDragMove}
                            onDragEnd={handleCardDragEnd}
                            onContextMenu={noopContextMenu}
                            onDblClick={noopDblClick}
                            onMouseEnter={topRevealed ? handleMouseEnter : noopMouseEnter}
                            onMouseLeave={topRevealed ? handleMouseLeave : noopMouseLeave}
                          />
                        );
                      })()
                    ) : (
                      <CardBackShape width={cellCardW} height={cellCardH} />
                    )}
                  </Group>
                )}
              </Group>
            );
          })}

          {/* ================================================================
              Sidebar pile indicators — Opponent zones (NOT draggable)
              ================================================================ */}
          {SIDEBAR_ZONES.map((zoneKey) => {
            const zone = opponentZones[zoneKey];
            if (!zone) return null;
            const cards = opponentCards[zoneKey] ?? [];
            const count = cards.length;
            // The LoR badge shows redeemed-soul VALUE, not card count — the
            // Two/Three Liner souls count as two Lost Souls each, and cards
            // that aren't Lost Souls at all (e.g. Guardian of Your Souls,
            // which legitimately plays to the Land of Redemption) count zero.
            const badgeCount = zoneKey === 'land-of-redemption'
              ? cards.filter(isLostSoulCard).reduce((n, c) => n + lostSoulValue(c.cardName), 0)
              : count;
            // Cell header metrics. The badge grows with the floored font —
            // fixed at 26x18 it clipped "53" to "5" whenever fs() grew (Konva
            // char-wraps the overflowing digit onto a clipped second line).
            // Compact drops the grown badge under the label row (side by side
            // they no longer fit a phone cell); the art starts below whichever
            // header is in play and shrinks rather than overflow the cell.
            const pileBadgeGrow = fsGrowth(12);
            const bw = Math.round(26 * pileBadgeGrow);
            const bh = Math.round(18 * pileBadgeGrow);
            const badgeX = zone.x + zone.width - bw - 6;
            const badgeY = useCompactLayout ? Math.round(zone.y + 4 + fs(11) + 3) : zone.y + 2;
            const headerH = useCompactLayout ? Math.round(4 + fs(11) + 3 + bh + 3) : Math.max(18, bh + 4);
            const cellCardH = Math.max(12, Math.min(pileCardHeight, zone.height - headerH - 2));
            const cellCardW = Math.round(cellCardH / 1.4);
            const cx = zone.x + zone.width / 2 - cellCardW / 2;
            const cy = zone.y + headerH + Math.max(0, (zone.height - headerH - cellCardH) / 2);

            const oppReserveRevealed = gameState.opponentPlayer?.reserveRevealed ?? false;
            const nowMicrosForReveal = BigInt(Date.now()) * 1000n;
            // For per-card reveals on opponent reserve (e.g. Herod's Temple),
            // pick the revealed card as the displayed top card so the actual
            // revealed card shows on the visual stack — not whichever card
            // happens to be last in DB insertion order.
            const revealedReserveCard = zoneKey === 'reserve'
              ? cards.find(c => c.revealExpiresAt !== undefined && c.revealExpiresAt.microsSinceUnixEpoch > nowMicrosForReveal)
              : undefined;
            // Opponent's top-deck reveal toggle (The Foretelling Angel): their
            // top deck card renders face up. Deck cards sort zoneIndex-
            // ascending, so the top of the pile is the FIRST element — unlike
            // the face-up piles where the last element renders on top.
            const oppTopDeckRevealed = zoneKey === 'deck' && (gameState.opponentPlayer?.topDeckRevealed ?? false);
            const topCard = zoneKey === 'deck'
              ? cards[0]
              : (revealedReserveCard ?? cards[cards.length - 1]);
            const topReserveCardRevealed = !!revealedReserveCard;
            const showFace = ((zoneKey === 'discard' || zoneKey === 'land-of-redemption' || zoneKey === 'banish') && topCard && !topCard.isFlipped)
              || (zoneKey === 'reserve' && topCard && (oppReserveRevealed || topReserveCardRevealed || (isSpectator && oppShareHand)))
              || (oppTopDeckRevealed && topCard);

            const openOppPileGroupMenu = (pt: { x: number; y: number }) => {
              closeAllMenus();
              if (zoneKey === 'deck') setOpponentDeckMenu(pt);
              else if (zoneKey === 'reserve') setOpponentReserveMenu(pt);
              else if (zoneKey === 'discard' || zoneKey === 'banish') setBrowseOpponentZone(zoneKey);
            };
            return (
              <Group
                key={`opp-pile-${zoneKey}`}
                name="zone-click"
                onClick={zoneKey !== 'deck' && !(zoneKey === 'reserve' && !canViewOppReserve) ? (e: Konva.KonvaEventObject<PointerEvent>) => {
                  if (!isPrimaryPointer(e.evt)) return;  // TouchEvent has no `button`
                  setBrowseOpponentZone(zoneKey);
                } : undefined}
                // Tap parity with onClick, plus menus for the zones whose
                // desktop click is a no-op (see the my-side loop).
                onTap={(e: Konva.KonvaEventObject<TouchEvent>) => {
                  if (zoneLongPressFiredRef.current) { zoneLongPressFiredRef.current = false; return; }
                  const t = (e.evt as TouchEvent).changedTouches?.[0];
                  const pt = t ? { x: t.clientX, y: t.clientY } : { x: 0, y: 0 };
                  if (zoneKey === 'deck' || (zoneKey === 'reserve' && !canViewOppReserve)) openOppPileGroupMenu(pt);
                  else setBrowseOpponentZone(zoneKey);
                }}
                onContextMenu={(e: Konva.KonvaEventObject<PointerEvent>) => {
                  e.evt.preventDefault();
                  openOppPileGroupMenu({ x: e.evt.clientX, y: e.evt.clientY });
                }}
                onTouchStart={isTouch ? (e: Konva.KonvaEventObject<TouchEvent>) => {
                  if (zoneKey === 'land-of-redemption' && e.target !== e.currentTarget) {
                    let cur: Konva.Node | null = e.target as Konva.Node;
                    while (cur) {
                      if (typeof (cur as any).draggable === 'function' && (cur as any).draggable()) return;
                      cur = cur.getParent();
                    }
                  }
                  beginZonePress(e, openOppPileGroupMenu);
                } : undefined}
                onTouchMove={isTouch ? moveZonePress : undefined}
                onTouchEnd={isTouch ? clearZonePress : undefined}
                hitFunc={(ctx: any, shape: any) => {
                  ctx.beginPath();
                  ctx.rect(zone.x, zone.y, zone.width, zone.height);
                  ctx.closePath();
                  ctx.fillStrokeShape(shape);
                }}
              >
                {/* Count badge — see the my-side header metrics for sizing. */}
                <Group x={badgeX} y={badgeY} listening={false}>
                  <Rect width={bw} height={bh} fill="#101828" cornerRadius={4} stroke="#4a7ab5" strokeWidth={1} perfectDrawEnabled={false} />
                  <Text
                    text={String(badgeCount)}
                    fontSize={fs(12)}
                    fontStyle="bold"
                    fill="#a3c5e8"
                    width={bw}
                    height={bh}
                    align="center"
                    verticalAlign="middle"
                    perfectDrawEnabled={false}
                  />
                </Group>

                {/* Revealed indicator for opponent reserve — sits left of the count badge. Not clickable (only owner can toggle). */}
                {zoneKey === 'reserve' && oppReserveRevealed && (
                  <Group x={badgeX - 26} y={badgeY} listening={false}>
                    <Rect width={20} height={18} fill="#1a2e1a" cornerRadius={4} stroke="#5a9a5a" strokeWidth={1} perfectDrawEnabled={false} />
                    <Text
                      text="👁"
                      fontSize={fs(11)}
                      width={20}
                      height={18}
                      align="center"
                      verticalAlign="middle"
                      perfectDrawEnabled={false}
                    />
                  </Group>
                )}

                {/* Opponent LOR: spread all cards face-up with horizontal overlap (rotated 180°) */}
                {zoneKey === 'land-of-redemption' && count > 0 && (() => {
                  const pad = 4;
                  const availW = zone.width - pad * 2;
                  const overlap = count <= 1 ? 0 : Math.min(cellCardW * 0.3, (availW - cellCardW) / (count - 1));
                  return cards.map((c, i) => {
                    const img = getCardImage(c);
                    const gameCard = adaptCard(c, 'player2');
                    const cardX = zone.x + pad + i * overlap + cellCardW;
                    // Header-aware like the my-side spread (rot-180 anchor adds
                    // +cellCardH to reach the card's visual top-left).
                    const cardY = zone.y + headerH + Math.max(0, (zone.height - headerH - cellCardH) / 2) + cellCardH;
                    return img ? (
                      <GameCardNode
                        key={String(c.id)}
                        card={gameCard}
                        isArmed={armedCardId === gameCard.instanceId}
                        x={cardX}
                        y={cardY}
                        rotation={180}
                        cardWidth={cellCardW}
                        cardHeight={cellCardH}
                        image={img}
                        {...(getTargetingProps(gameCard) ?? {})}
                        isSelected={isSelected(String(c.id))}
                        isDraggable={!isSpectator}
                        nodeRef={registerCardNode}
                        hoverProgress={hoveredInstanceId === String(c.id) ? hoverProgress : 0}
                        onClick={handleCardClick}
                        onDragStart={handleCardDragStart}
                        onDragMove={handleCardDragMove}
                        onDragEnd={handleCardDragEnd}
                        onContextMenu={handleCardContextMenu}
                        onLongPress={isTouch ? handleCardLongPress : undefined}
                  onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                        onDblClick={noopDblClick}
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                      />
                    ) : (
                      <Group key={String(c.id)} x={cardX} y={cardY}>
                        <CardBackShape width={cellCardW} height={cellCardH} />
                      </Group>
                    );
                  });
                })()}

                {/* Non-LOR pile visual — rotated 180° for opponent */}
                {zoneKey !== 'land-of-redemption' && count > 0 && (
                  <Group x={cx} y={cy}>
                    {count > 1 && !showFace && (
                      <Group x={cellCardW - 2} y={cellCardH - 2} rotation={180}>
                        <CardBackShape width={cellCardW} height={cellCardH} />
                      </Group>
                    )}
                    {showFace && topCard ? (
                      (() => {
                        // Force face-up for opponent reserve when either the whole
                        // pile is revealed OR this specific card has an active
                        // per-card reveal (e.g. Herod's Temple). Needed because
                        // getCardImage() returns undefined for isFlipped cards,
                        // which would route this branch to CardBackShape and the
                        // opponent would never see the revealed face.
                        const effectiveTop = ((zoneKey === 'reserve' && (oppReserveRevealed || topReserveCardRevealed)) || oppTopDeckRevealed) && topCard.isFlipped
                          ? { ...topCard, isFlipped: false }
                          : topCard;
                        const img = getCardImage(effectiveTop);
                        // adaptCard's reference-stable cache is keyed by row id,
                        // so the isFlipped override on effectiveTop is dropped
                        // for cards without an active per-card reveal (deck rows
                        // rest isFlipped=true) — re-apply it on the adapted card
                        // or GameCardNode renders the card back.
                        const adapted = adaptCard(effectiveTop, 'player2');
                        const gameCard = effectiveTop !== topCard && adapted.isFlipped
                          ? { ...adapted, isFlipped: false }
                          : adapted;
                        return img ? (
                          <GameCardNode
                            key={String(effectiveTop.id)}
                            card={gameCard}
                            isArmed={armedCardId === gameCard.instanceId}
                            x={cellCardW}
                            y={cellCardH}
                            rotation={180}
                            cardWidth={cellCardW}
                            cardHeight={cellCardH}
                            image={img}
                            {...(getTargetingProps(gameCard) ?? {})}
                            isSelected={false}
                            isDraggable={zoneKey === 'discard' && !isSpectator}
                            nodeRef={zoneKey === 'discard' ? registerCardNode : undefined}
                            hoverProgress={hoveredInstanceId === String(topCard.id) ? hoverProgress : 0}
                            onClick={zoneKey === 'reserve' && canViewOppReserve ? (_c, e) => {
                              if ((e.evt as MouseEvent).button !== 0) return;
                              setBrowseOpponentZone('reserve');
                            } : undefined}
                            onDragStart={zoneKey === 'discard' ? handleCardDragStart : noopCardDrag}
                            onDragMove={zoneKey === 'discard' ? handleCardDragMove : noopDrag}
                            onDragEnd={zoneKey === 'discard' ? handleCardDragEnd : noopCardDragEnd}
                            onContextMenu={zoneKey === 'reserve' || zoneKey === 'deck' ? noopContextMenu : handleCardContextMenu}
                            onDblClick={noopDblClick}
                            onMouseEnter={handleMouseEnter}
                            onMouseLeave={handleMouseLeave}
                          />
                        ) : (
                          <Group x={cellCardW} y={cellCardH} rotation={180}>
                            <CardBackShape width={cellCardW} height={cellCardH} />
                          </Group>
                        );
                      })()
                    ) : (
                      <Group x={cellCardW} y={cellCardH} rotation={180}>
                        <CardBackShape width={cellCardW} height={cellCardH} />
                      </Group>
                    )}
                  </Group>
                )}
              </Group>
            );
          })}

          {/* ================================================================
              Opponent hand — card backs or face-up if hand is revealed
              ================================================================ */}
          {(() => {
            const opponentHandCards = opponentCards['hand'] ?? [];
            if (opponentHandCards.length === 0) return null;

            const oppHandPositions = calculateHandPositions(
              opponentHandCards.length,
              opponentHandRect!,
              oppHandCard.cardWidth,
              oppHandCard.cardHeight,
              true, // flat spread — no fan arc for opponent
            );

            const oppHandViewerKind: ViewerKind = viewerKind === 'spectator' ? 'spectator' : 'opponent';

            // Opponent deal sprites — rendered OUTSIDE the clipped strip group
            // below, so the flight from their deck pile stays visible.
            const oppDeckRect = opponentZones['deck'];
            const oppDealSprites: DealSpriteSpec[] = [];
            if (oppDeckRect && oppActiveDeals.length > 0) {
              const originScale = oppHandCard.cardWidth > 0 ? pileCardWidth / oppHandCard.cardWidth : 1;
              for (const deal of oppActiveDeals) {
                const idx = opponentHandCards.findIndex(c => String(c.id) === deal.instanceId);
                if (idx === -1) continue;
                const dealPos = oppHandPositions[idx];
                if (!dealPos) continue;
                oppDealSprites.push({
                  deal,
                  origin: {
                    x: oppDeckRect.x + oppDeckRect.width / 2 - (oppHandCard.cardWidth * originScale) / 2,
                    y: oppDeckRect.y + oppDeckRect.height / 2 - (oppHandCard.cardHeight * originScale) / 2,
                  },
                  originScale,
                  target: { x: dealPos.x, y: dealPos.y, rotation: dealPos.rotation },
                  cardWidth: oppHandCard.cardWidth,
                  cardHeight: oppHandCard.cardHeight,
                  image: undefined,
                });
              }
            }

            return (
              <>
              <Group
                clipX={opponentHandRect!.x}
                clipY={opponentHandRect!.y}
                clipWidth={opponentHandRect!.width}
                clipHeight={opponentHandRect!.height}
                onContextMenu={(e: Konva.KonvaEventObject<PointerEvent>) => {
                  e.evt.preventDefault();
                  closeAllMenus();
                  setOpponentHandMenu({
                    x: e.evt.clientX,
                    y: e.evt.clientY,
                  });
                }}
              >
                {oppHandPositions.map((pos, i) => {
                  const card = opponentHandCards[i];
                  // Mid-deal: the sprite is flying — keep the slot reserved
                  // but don't render the real card back yet.
                  if (card && oppDealingIds.has(String(card.id))) return null;
                  const nowMicros = BigInt(Date.now()) * 1000n;
                  if (card && isHandCardFaceVisible(card, oppHandViewerKind, gameState.opponentPlayer, nowMicros)) {
                    const gameCard = adaptCard(card, 'player2');
                    return (
                      <GameCardNode
                        key={String(card.id)}
                        card={gameCard}
                        isArmed={armedCardId === gameCard.instanceId}
                        x={pos.x}
                        y={pos.y}
                        rotation={pos.rotation}
                        cardWidth={oppHandCard.cardWidth}
                        cardHeight={oppHandCard.cardHeight}
                        image={getCardImage(card)}
                        {...(getTargetingProps(gameCard) ?? {})}
                        isDraggable={!isSpectator}
                        hoverProgress={hoveredInstanceId === String(card.id) ? hoverProgress : 0}
                        nodeRef={registerCardNode}
                        onDragStart={handleCardDragStart}
                        onDragMove={handleCardDragMove}
                        onDragEnd={handleCardDragEnd}
                        onContextMenu={handleCardContextMenu}
                        onLongPress={isTouch ? handleCardLongPress : undefined}
                  onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                        onDblClick={noopDblClick}
                        onMouseEnter={handleMouseEnter}
                        onMouseLeave={handleMouseLeave}
                      />
                    );
                  }
                  return (
                    <Group key={`opp-hand-${i}`} x={pos.x} y={pos.y}>
                      <CardBackShape width={oppHandCard.cardWidth} height={oppHandCard.cardHeight} />
                    </Group>
                  );
                })}
              </Group>
              {/* Count pill re-drawn OVER the strip: the pre-strip label block
                  renders first, so on narrow (portrait) widths the centered
                  card backs buried the count entirely. */}
              {(() => {
                const grow = fsGrowth(12);
                const pbw = Math.round(26 * grow);
                const pbh = Math.round(18 * grow);
                return (
                  <Group
                    x={opponentHandRect!.x + opponentHandRect!.width - pbw - 6}
                    y={opponentHandRect!.y + 2}
                    listening={false}
                  >
                    <Rect width={pbw} height={pbh} fill="#101828" cornerRadius={4} stroke="#4a7ab5" strokeWidth={1} perfectDrawEnabled={false} />
                    <Text
                      text={String(opponentCards['hand']?.length ?? 0)}
                      fontSize={fs(12)}
                      fontStyle="bold"
                      fill="#a3c5e8"
                      width={pbw}
                      height={pbh}
                      align="center"
                      verticalAlign="middle"
                      perfectDrawEnabled={false}
                    />
                  </Group>
                );
              })()}
              <DealLayer sprites={oppDealSprites} onLanded={completeOppDeal} />
              </>
            );
          })()}

          {/* ================================================================
              My hand — fan/spread layout at bottom (draggable)
              ================================================================ */}
          {(() => {
            const handCards = myCards['hand'] ?? [];
            if (handCards.length === 0) return null;

            const positions = calculateHandPositions(
              handCards.length,
              myHandRect!,
              handCardWidth,
              handCardHeight,
              viewerKind === 'spectator' ? true : isSpreadHand,
              handToolbarReserve,
            );

            // In spectator mode, seat-0's hand is subject to the same
            // visibility predicate as any other hand — face-up only when
            // the player has shared it with spectators (or a per-card flash).
            const myHandViewerKind: ViewerKind = viewerKind === 'spectator' ? 'spectator' : 'self';

            // "The deal" sprites — one per in-flight draw, flying from the
            // deck pile to the slot the real (hidden) card already reserves.
            const deckRect = myZones['deck'];
            const dealSprites: DealSpriteSpec[] = [];
            if (deckRect && activeDeals.length > 0) {
              const originScale = handCardWidth > 0 ? pileCardWidth / handCardWidth : 1;
              for (const deal of activeDeals) {
                const idx = handCards.findIndex(c => String(c.id) === deal.instanceId);
                if (idx === -1) continue;
                const dealPos = positions[idx];
                if (!dealPos) continue;
                dealSprites.push({
                  deal,
                  origin: {
                    x: deckRect.x + deckRect.width / 2 - (handCardWidth * originScale) / 2,
                    y: deckRect.y + deckRect.height / 2 - (handCardHeight * originScale) / 2,
                  },
                  originScale,
                  target: { x: dealPos.x, y: dealPos.y, rotation: dealPos.rotation },
                  cardWidth: handCardWidth,
                  cardHeight: handCardHeight,
                  image: getCardImage(handCards[idx]),
                });
              }
            }

            return (
              <Group>
                {handCards.map((card, i) => {
                  const pos = positions[i];
                  if (!pos) return null;
                  const idStr = String(card.id);
                  // Card is mid-deal: its DealLayer sprite is flying — don't
                  // render the real node yet (positions[] still reserves its
                  // slot in the fan).
                  if (dealingIds.has(idStr)) return null;
                  if (myHandViewerKind === 'spectator') {
                    const nowMicros = BigInt(Date.now()) * 1000n;
                    if (!isHandCardFaceVisible(card, 'spectator', gameState.myPlayer, nowMicros)) {
                      return (
                        <Group key={`my-hand-${i}`} x={pos.x} y={pos.y}>
                          <CardBackShape width={handCardWidth} height={handCardHeight} />
                        </Group>
                      );
                    }
                  }
                  const gameCard = adaptCard(card, 'player1');
                  const isArmedCard = armedCardId === gameCard.instanceId;
                  // The DestinationRail (a ~54px DOM overlay just above the
                  // hand band) covers the fan's arc — lift the armed card
                  // just far enough that its top edge (and amber ring) clears
                  // the rail. The rail is screen-sized, so convert to
                  // virtual. The old extra +0.6 card heights launched the
                  // card into the territory row, which read as the card
                  // having MOVED rather than being selected (phone QA wave 8:
                  // "why can't it just stay in hand?").
                  const armedLift = isArmedCard ? Math.round(54 / safeScale) : 0;
                  return (
                    <GameCardNode
                      key={idStr}
                      card={gameCard}
                      isArmed={isArmedCard}
                      x={pos.x}
                      y={pos.y - armedLift}
                      rotation={pos.rotation}
                      cardWidth={handCardWidth}
                      cardHeight={handCardHeight}
                      image={getCardImage(card)}
                      {...(getTargetingProps(gameCard) ?? {})}
                      // A pre-game star pick borrows the same golden outline.
                      // It rides inside the card's own Konva group, so it
                      // tracks the node through the hand-reflow glide.
                      isSelected={isSelected(idStr) || starPickOrder.includes(card.id)}
                      isDraggable={!isSpectator}
                      hoverProgress={hoveredInstanceId === idStr ? hoverProgress : 0}
                      lobArrivalGlow={dealGlowIds.has(idStr)}
                      suppressRevealRing
                      nodeRef={registerCardNode}
                      onClick={handleCardClick}
                      onDragStart={handleCardDragStart}
                      onDragMove={handleCardDragMove}
                      onDragEnd={handleCardDragEnd}
                      onContextMenu={handleCardContextMenu}
                      onLongPress={isTouch ? handleCardLongPress : undefined}
                  onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                      onDblClick={handleDblClick}
                      onMouseEnter={handleMouseEnter}
                      onMouseLeave={handleMouseLeave}
                    />
                  );
                })}
                {/* Pre-game star cues, drawn over the hand so the fan's
                    overlap can't hide them. Two signals in opposite top
                    corners, so they never collide:
                      · top-RIGHT, a Star of David — this card carries a (Star)
                        ability, i.e. clicking it picks it. Deliberately
                        subordinate: smaller than the numeral, no gold ring,
                        no glow.
                      · top-LEFT, a gold numeral — this card is picked Nth.
                        Same badge language as the HAND count chip.
                    The group is non-listening, so the click that picks the
                    card still reaches the card underneath. */}
                {(starWindowOpen || starPickOrder.length > 0) && handCards.map((card, i) => {
                  const pos = positions[i];
                  if (!pos || dealingIds.has(String(card.id))) return null;
                  const order = starPickOrder.indexOf(card.id);
                  // Same detection as the click intercept: the row's OWN
                  // ability text, never findCard().
                  const eligible = starWindowOpen && isStarAbilityText(card.specialAbility);
                  if (order < 0 && !eligible) return null;
                  const r = 12 * fsGrowth(13);
                  // Star disc, inscribed in the top-right corner the way the
                  // numeral is inscribed top-left — and a step smaller than it,
                  // so the pick order stays the louder signal.
                  const sr = 11 * fsGrowth(13);
                  const scx = handCardWidth - sr;
                  // Hexagram box, centred in the disc. The asset is taller than
                  // it is wide, so height drives the fit and width follows its
                  // aspect ratio — the same contain behaviour the DOM icon gets
                  // for free from objectFit.
                  const starH = sr * 2 * STAR_OF_DAVID_INSET;
                  const starIcon = starIconRef.current;
                  const starW = starIcon
                    ? starH * (starIcon.naturalWidth / starIcon.naturalHeight)
                    : starH;
                  return (
                    <Group
                      key={`star-cue-${String(card.id)}`}
                      x={pos.x}
                      y={pos.y}
                      rotation={pos.rotation}
                      listening={false}
                    >
                      {eligible && starIconReady && starIcon && (
                        <>
                          {/* Opaque white ground. Card art runs from near-white
                              title bands to dark illustration, so the disc — not
                              the hexagram — is what carries the badge against
                              both halves. */}
                          <Circle
                            x={scx}
                            y={sr}
                            radius={sr}
                            fill="#ffffff"
                            perfectDrawEnabled={false}
                          />
                          <KonvaImage
                            image={starIcon}
                            x={scx - starW / 2}
                            y={sr - starH / 2}
                            width={starW}
                            height={starH}
                            listening={false}
                            perfectDrawEnabled={false}
                          />
                        </>
                      )}
                      {order >= 0 && (
                        <>
                          <Circle
                            x={r}
                            y={r}
                            radius={r}
                            fill="rgba(10, 8, 5, 0.92)"
                            stroke="#c4955a"
                            strokeWidth={2}
                            shadowColor="#c4955a"
                            shadowBlur={8}
                            shadowOpacity={0.7}
                            perfectDrawEnabled={false}
                          />
                          <Text
                            text={String(order + 1)}
                            fontSize={fs(13)}
                            fontStyle="bold"
                            fontFamily="Cinzel, Georgia, serif"
                            fill="#e8d5a3"
                            width={r * 2}
                            height={r * 2}
                            align="center"
                            verticalAlign="middle"
                            perfectDrawEnabled={false}
                          />
                        </>
                      )}
                    </Group>
                  );
                })}
                <DealLayer sprites={dealSprites} onLanded={completeDeal} />
              </Group>
            );
          })()}

          {/* ================================================================
              Lost Soul "deal" flyers — transient cards dealt deck → LOB slot.
              Rendered last in the game layer so they draw above settled cards,
              unclipped so they can cross the zone boundary mid-flight.
              ================================================================ */}
          {normalizedFormat !== 'Paragon' && (() => {
            const deals: SoulDeal[] = [];
            const myDeck = myZones['deck'];
            const oppDeck = opponentZones['deck'];
            const byId = (cards: CardInstance[] | undefined, id: string) =>
              (cards ?? []).find(c => String(c.id) === id);

            if (myDeck) {
              for (const [id, seq] of myDeals) {
                const slot = myLobLayout.hostPositions.get(id);
                const card = byId(myCards['land-of-bondage'], id);
                if (!slot || !card) continue;
                deals.push({
                  id,
                  image: getCardImage(card),
                  cardWidth: lobCard.cardWidth,
                  cardHeight: lobCard.cardHeight,
                  rotation: 0,
                  flight: computeDealFlight({
                    deck: myDeck, slot, cardWidth: lobCard.cardWidth,
                    cardHeight: lobCard.cardHeight, seq,
                  }),
                });
              }
            }
            if (oppDeck) {
              for (const [id, seq] of oppDeals) {
                const slot = opponentLobLayout.hostPositions.get(id);
                const card = byId(opponentCards['land-of-bondage'], id);
                if (!slot || !card) continue;
                deals.push({
                  id,
                  image: getCardImage(card),
                  cardWidth: lobCard.cardWidth,
                  cardHeight: lobCard.cardHeight,
                  rotation: 180,
                  flight: computeDealFlight({
                    deck: oppDeck, slot, cardWidth: lobCard.cardWidth,
                    cardHeight: lobCard.cardHeight, seq,
                  }),
                });
              }
            }

            const handleLand = (id: string) => {
              if (myDeals.has(id)) onMyLand(id);
              if (oppDeals.has(id)) onOppLand(id);
            };
            return deals.length > 0
              ? <LostSoulDealLayer deals={deals} onLand={handleLand} />
              : null;
          })()}

          {/* Paragon: deal souls from the shared Soul Deck into the shared LOB. */}
          {normalizedFormat === 'Paragon' && mpLayout?.zones.soulDeck && (() => {
            const deck = mpLayout.zones.soulDeck;
            const deals: SoulDeal[] = [];
            for (const [id, seq] of sharedDeals) {
              const slot = sharedLobLayout.hostPositions.get(id);
              const card = (sharedCards['land-of-bondage'] ?? []).find(c => String(c.id) === id);
              if (!slot || !card) continue;
              deals.push({
                id,
                image: getCardImage(card),
                cardWidth: lobCard.cardWidth,
                cardHeight: lobCard.cardHeight,
                rotation: 0,
                flight: computeDealFlight({
                  deck, slot, cardWidth: lobCard.cardWidth,
                  cardHeight: lobCard.cardHeight, seq,
                }),
              });
            }
            return deals.length > 0
              ? <LostSoulDealLayer deals={deals} onLand={onSharedLand} />
              : null;
          })()}
        </Layer>

        {/* Selection rectangle layer — scaled to match game layer */}
        <Layer
          ref={selectionLayerRef as any}
          listening={false}
          scaleX={scale}
          scaleY={scale}
          x={offsetX}
          y={offsetY}
        >
          <Rect
            ref={selectionRectRef as any}
            visible={false}
            fill="rgba(196,149,90,0.12)"
            stroke="#c4955a"
            strokeWidth={1}
            dash={[6, 3]}
            perfectDrawEnabled={false}
          />
        </Layer>
      </Stage>

      {/* ================================================================
          Turn / whose-turn label — top-left, above the opponent's hand.
          Lives as an HTML overlay (not Konva) so its size is governed by
          the FZ clamp() scale, not the canvas scale, and stays legible on
          small viewports. Replaces the equivalent block that used to live
          in the TurnIndicator bar — moving it here freed enough room in
          the bar to keep the centered phase row from overlapping the
          score on narrow viewports.
          Touch: not rendered — the overlaid turn bar sits on top of this
          exact corner and buried it (plus the score orbs / phase pill
          behind it). The bar's own compact T{n} chip carries the turn
          number there instead (TurnIndicator, touch only).
          ================================================================ */}
      {gameState.game && gameState.myPlayer && !isTouch && (
        <div
          className="pointer-events-none absolute z-20"
          style={{
            top: 8,
            left: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 3,
            padding: '6px 12px',
            background: 'rgba(10, 8, 5, 0.85)',
            border: '1px solid rgba(107, 78, 39, 0.4)',
            borderRadius: 6,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 'clamp(11px, 0.45vw + 7px, 13px)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'rgba(232, 213, 163, 0.55)',
              lineHeight: 1,
            }}
          >
            Turn{' '}
            <span style={{ color: '#e8d5a3', fontSize: 'clamp(13px, 0.5vw + 9px, 15px)', fontWeight: 700 }}>
              {Number(gameState.game.turnNumber ?? 1)}
            </span>
          </span>
          <span
            style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 'clamp(10px, 0.4vw + 7px, 12px)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: gameState.isMyTurn ? '#c4955a' : '#4a7ab5',
              lineHeight: 1,
            }}
          >
            {viewerKind === 'spectator'
              ? gameState.isMyTurn
                ? `${gameState.myPlayer.displayName ?? 'Player 1'}'s turn`
                : `${gameState.opponentPlayer?.displayName ?? 'Player 2'}'s turn`
              : gameState.isMyTurn
              ? `${gameState.myPlayer.displayName ?? 'You'}'s turn (you)`
              : `${gameState.opponentPlayer?.displayName ?? 'Opponent'}'s turn`}
          </span>
        </div>
      )}

      {/* ================================================================
          Detach ("unlink") icons at each weapon/warrior seam.
          HTML overlay — only local-player weapons get the icon, since
          you can't unequip the opponent's cards.
          Hidden during drag because the overlay reads from state which
          doesn't update live while dragging.
          ================================================================ */}
      {!isCardDraggingUi && myDerivedWeaponPositions.size > 0 && (
        <div className="pointer-events-none absolute inset-0 z-30">
          {[
            ...(myCards['territory'] ?? []),
            ...(myCards['land-of-bondage'] ?? []),
          ]
            .filter((accessory) => accessory.equippedToInstanceId !== 0n)
            .map((accessory) => {
              const derived = myDerivedWeaponPositions.get(String(accessory.id));
              if (!derived) return null;
              const seam = virtualToScreen(derived.seamX, derived.seamY, scale, offsetX, offsetY);
              const zone = myZones[accessory.zone];
              const isLob = accessory.zone === 'land-of-bondage';
              return (
                <button
                  key={String(accessory.id)}
                  type="button"
                  onClick={() => {
                    if (isLob) {
                      // LOB cards are auto-arranged — stored posX/posY are
                      // meaningless. Pass empty strings so the reducer keeps
                      // whatever is currently stored (which is '' anyway).
                      gameState.detachCard(accessory.id, '', '');
                      return;
                    }
                    if (!zone) return;
                    const db = toDbPos(derived.x, derived.y, zone, 'my', { cardWidth, cardHeight });
                    gameState.detachCard(accessory.id, String(db.x), String(db.y));
                  }}
                  className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1a1510] p-1.5 text-[#c4955a] shadow-md ring-1 ring-[#c4955a]/40 transition hover:bg-[#2a1f14] hover:ring-[#c4955a]"
                  style={{ left: `${seam.x}px`, top: `${seam.y}px` }}
                  title="Detach"
                  aria-label="Detach accessory"
                >
                  <Link2Off size={14} strokeWidth={2} />
                </button>
              );
            })}
        </div>
      )}

      {/* Card size settings gear */}
      <CardScaleControl
        cardScale={cardScale}
        setCardScale={setCardScale}
        resetScale={resetScale}
        minScale={MIN_SCALE}
        maxScale={MAX_SCALE}
        step={STEP}
        chatScale={chatScale}
        setChatScale={setChatScale}
        resetChatScale={resetChatScale}
        minChatScale={minChatScale}
        maxChatScale={maxChatScale}
        chatStep={chatStep}
        onLoadDeck={onLoadDeck}
        isTimerVisible={isTimerVisible}
        onToggleTimer={onToggleTimer}
      />

      {/* ================================================================
          Zone highlight overlay during drag
          ================================================================ */}

      {/* ================================================================
          Dice roll overlay — synced via lastDiceRoll field from SpacetimeDB
          ================================================================ */}
      <DiceOverlay
        lastDiceRoll={gameState.game?.lastDiceRoll ?? ''}
        myPlayer={gameState.myPlayer}
        opponentPlayer={gameState.opponentPlayer}
        identityHex={gameState.identityHex}
      />

      {dragHoverZone !== null && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 450 }}>
          {allZoneRects.map(({ key, rect, owner }) => {
            // Don't highlight the source zone
            const sourceKey = dragSourceZoneRef.current && dragSourceOwnerRef.current
              ? `${dragSourceOwnerRef.current}:${dragSourceZoneRef.current}`
              : null;
            if (key === sourceKey) return null;

            const isHovered = dragHoverZone === key;
            // Shared Paragon zones use the same warm tone as own zones so the
            // shared LoB glows the same way as per-seat zones during drag.
            const warm = owner === 'my' || owner === 'shared';
            const borderColor = warm
              ? isHovered ? 'rgba(196,149,90,0.6)' : 'rgba(196,149,90,0.2)'
              : isHovered ? 'rgba(100,149,237,0.6)' : 'rgba(100,149,237,0.2)';
            const bgColor = warm
              ? isHovered ? 'rgba(196,149,90,0.12)' : 'transparent'
              : isHovered ? 'rgba(100,149,237,0.12)' : 'transparent';

            const screenTopLeft = virtualToScreen(rect.x, rect.y, scale, offsetX, offsetY);
            const screenBottomRight = virtualToScreen(rect.x + rect.width, rect.y + rect.height, scale, offsetX, offsetY);

            return (
              <div
                key={key}
                style={{
                  position: 'absolute',
                  left: screenTopLeft.x,
                  top: screenTopLeft.y,
                  width: screenBottomRight.x - screenTopLeft.x,
                  height: screenBottomRight.y - screenTopLeft.y,
                  border: `1px solid ${borderColor}`,
                  background: bgColor,
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'none',
                }}
              >
                <span
                  style={{
                    color: isHovered
                      ? owner === 'my'
                        ? 'rgba(232,213,163,0.7)'
                        : 'rgba(163,197,232,0.7)'
                      : owner === 'my'
                        ? 'rgba(232,213,163,0.3)'
                        : 'rgba(163,197,232,0.3)',
                    fontSize: 12,
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                    textTransform: 'uppercase',
                    letterSpacing: 2,
                  }}
                >
                  {rect.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ================================================================
          Battle resolution buttons (spec §8, Task 13) — dispatch
          IMMEDIATELY on click, no confirm dialog — plus the awaiting-soul
          chooser dialog / waiting pill (Task 14). Mounted here (not
          client.tsx) because it needs band geometry + scale/offsets, which
          only live in this component.
          status==='playing' && battleActive gate mounting here; spectators
          now DO mount (they need the awaiting-soul waiting pill) but pass
          isSpectator=true so BattleResolutionUI never shows them buttons or
          the soul picker. mySeat/opponentSeat are always the two real
          players' seats (even for the spectator viewer's canvas-compat
          "myPlayer"=seat0) — isSpectator is what keeps a spectator from
          ever being treated as attacker/defender/chooser.
          ================================================================ */}
      {battleActive && gameStatus === 'playing' && mpLayout?.zones.battle && (
        <BattleResolutionUI
          band={mpLayout.zones.battle}
          scale={scale}
          offsetX={offsetX}
          offsetY={offsetY}
          battleState={gameState.battleState}
          mySeat={gameState.myPlayer ? String(gameState.myPlayer.seat) : ''}
          opponentSeat={gameState.opponentPlayer ? String(gameState.opponentPlayer.seat) : ''}
          attackerSeat={gameState.battleAttackerSeat}
          isSpectator={isSpectator}
          format={normalizedFormat}
          myPlayerName={gameState.myPlayer?.displayName || 'Player 1'}
          opponentPlayerName={gameState.opponentPlayer?.displayName || 'Player 2'}
          eligibleSouls={stakesLostSoulRows}
          siteAttachedSoulIds={stakesSiteAttachedSoulIds}
          forgeResolver={forgeResolver}
          bandHasCards={battleCardEntries.length > 0}
          onResolveBattle={gameState.resolveBattle}
          onEndBattle={gameState.endBattle}
          onSurrenderSoul={gameState.surrenderSoul}
          holdPhase={gameState.holdPhase}
          compact={useCompactLayout}
          suppressResolution={isTouch && tapMoveState.kind === 'armed'}
        />
      )}

      {/* ================================================================
          REG Pre-Game Phase rail (star reveals, then Lost Soul activation).
          Mounted here, not client.tsx, because its wrapper is inset-0 over
          the canvas viewport — the same reason BattleResolutionUI lives
          here. The wrapper is pointer-events:none so the board, the
          toolbar and every modal stay fully interactive while it shows.
          ================================================================ */}
      {pregameStep && !isSpectator && (
        <PregameRail
          step={pregameStep}
          isMyWindow={myPregameWindow}
          opponentName={gameState.opponentPlayer?.displayName || 'Opponent'}
          handStars={myHandStars}
          queue={activeStarQueue}
          activatableSouls={myActivatableSouls}
          hasSubmitted={myStarsSubmitted}
          selection={starPickOrder}
          onSubmitStars={gameState.pregameSubmitStars}
          onResolveStar={gameState.pregameResolveStar}
          onFinishSouls={gameState.pregameFinishSouls}
          // Route through multiplayerActions, not gameState, so modal-driven
          // ability types (look_at_own_deck — the type all four star-half
          // registry entries use) are intercepted client-side. The raw
          // reducer throws SenderError for those.
          onExecuteAbility={(instanceId, abilityIndex) =>
            multiplayerActions.executeCardAbility(String(instanceId), abilityIndex)}
        />
      )}

      {/* ================================================================
          Shared context menu — positioned relative to canvas container
          ================================================================ */}
      {!isSpectator && contextMenu && (() => {
        const ctxCard = contextMenu.card;
        const isSharedSoul =
          ctxCard?.zone === 'land-of-bondage' &&
          ctxCard?.ownerId === 'player1' &&
          findAnyCardById(ctxCard.instanceId)?.ownerId === 0n;
        const sharedSoulActions = isSharedSoul
          ? {
              moveCardToTopOfDeck: (id: string) => gameState.moveCard(BigInt(id), 'soul-deck', '0'),
              moveCardToBottomOfDeck: (id: string) => gameState.moveCard(BigInt(id), 'soul-deck'),
              shuffleCardIntoDeck: (id: string) => {
                gameState.moveCard(BigInt(id), 'soul-deck');
                gameState.shuffleSoulDeck();
              },
            }
          : null;
        return (
        <CardContextMenu
          card={contextMenu.card}
          x={contextMenu.x}
          y={contextMenu.y}
          actions={{ ...multiplayerActions, ...(sharedSoulActions ?? {}) }}
          isHandRevealed={gameState.myPlayer?.handRevealed ?? false}
          opponentHandRevealed={opponentHandRevealed}
          topDeckRevealed={gameState.myPlayer?.topDeckRevealed ?? false}
          // Touch only: hover previews and the loupe are both hover-fed, so the
          // sheet header is a phone player's only route to a card's text.
          onViewCard={isTouch ? (c) => { setContextMenu(null); setReaderCard(c); } : undefined}
          cardImageUrl={isTouch ? resolveCardImageUrl(contextMenu.card.cardImgFile, forgeResolver) : undefined}
          onClose={() => setContextMenu(null)}
          onExchange={(cardIds) => {
            setContextMenu(null);
            setExchangeState({ cardIds, targetZone: isSharedSoul ? 'soul-deck' : 'deck' });
          }}
          onDetach={
            contextMenu.card.ownerId === 'player1'
              ? (weaponId) => {
                  const derived = myDerivedWeaponPositions.get(weaponId);
                  const myZone = myZones['territory'];
                  if (derived && myZone) {
                    const db = toDbPos(derived.x, derived.y, myZone, 'my', { cardWidth, cardHeight });
                    gameState.detachCard(BigInt(weaponId), String(db.x), String(db.y));
                  } else {
                    gameState.detachCard(BigInt(weaponId));
                  }
                }
              : undefined
          }
          onEditNote={(card) => {
            setNotePopover({
              cardIds: [card.instanceId],
              x: contextMenu.x,
              y: contextMenu.y,
              initialValue: card.notes ?? '',
            });
            setContextMenu(null);
          }}
          onSurrender={(cardInstanceId) => {
            gameState.surrenderLostSoul(BigInt(cardInstanceId));
          }}
          onRescue={(cardInstanceId) => {
            gameState.rescueLostSoul(BigInt(cardInstanceId));
          }}
          zones={allZonesForContextMenu as any}
        />
        );
      })()}

      {!isSpectator && multiCardContextMenu && (() => {
        const sortedIds = Array.from(selectedIds).sort((a, b) => {
          const aCard = findAnyCardById(a);
          const bCard = findAnyCardById(b);
          return Number(aCard?.zoneIndex ?? BigInt(0)) - Number(bCard?.zoneIndex ?? BigInt(0));
        });
        // Detect a pure shared-soul selection (all cards in shared LoB with
        // ownerId=0n). Route deck actions to the shared Soul Deck instead of
        // the player's private deck.
        const allShared =
          sortedIds.length > 0 &&
          sortedIds.every((id) => {
            const c = findAnyCardById(id);
            return c?.ownerId === 0n && c?.zone === 'land-of-bondage';
          });
        const sharedSoulActions = allShared
          ? {
              moveCardToTopOfDeck: (id: string) => gameState.moveCard(BigInt(id), 'soul-deck', '0'),
              moveCardToBottomOfDeck: (id: string) => gameState.moveCard(BigInt(id), 'soul-deck'),
              shuffleCardIntoDeck: (id: string) => {
                gameState.moveCard(BigInt(id), 'soul-deck');
                gameState.shuffleSoulDeck();
              },
              moveCardsBatch: (ids: string[], toZone: ZoneId | string) => {
                if (toZone === 'deck') {
                  gameState.moveCardsBatch(JSON.stringify(ids), 'soul-deck');
                } else {
                  gameState.moveCardsBatch(JSON.stringify(ids), String(toZone));
                }
              },
              shuffleDeck: () => gameState.shuffleSoulDeck(),
            }
          : null;
        return (
          <MultiCardContextMenu
            selectedIds={sortedIds}
            x={multiCardContextMenu.x}
            y={multiCardContextMenu.y}
            actions={{ ...multiplayerActions, ...(sharedSoulActions ?? {}) }}
            onClose={() => setMultiCardContextMenu(null)}
            onClearSelection={() => { clearSelection(); setMultiCardContextMenu(null); }}
            onEditNotes={(cardIds) => {
              setNotePopover({
                cardIds,
                x: multiCardContextMenu.x,
                y: multiCardContextMenu.y,
                initialValue: '',
              });
            }}
            zones={allZonesForContextMenu as any}
          />
        );
      })()}

      {!isSpectator && notePopover && (
        <CardNotePopover
          x={notePopover.x}
          y={notePopover.y}
          initialValue={notePopover.initialValue}
          onSave={(text) => {
            // Empty text from the multi-card path is a click-away cancel, not a
            // bulk clear — "Clear All Notes" is the explicit affordance for that.
            // Single-card keeps the clear-by-emptying flow.
            if (text !== '' || notePopover.cardIds.length === 1) {
              for (const id of notePopover.cardIds) {
                gameState.setNote(BigInt(id), text);
              }
            }
            setNotePopover(null);
          }}
          onCancel={() => setNotePopover(null)}
        />
      )}

      {!isSpectator && zoneMenu && (
        <ZoneContextMenu
          x={zoneMenu.x}
          y={zoneMenu.y}
          spawnX={zoneMenu.spawnX}
          spawnY={zoneMenu.spawnY}
          onClose={() => setZoneMenu(null)}
          onAddOpponentLostSoul={(testament, posX, posY) => {
            gameState.spawnLostSoul(testament, String(posX), String(posY), zoneMenu.targetPlayerId);
          }}
        />
      )}

      {!isSpectator && deckMenu && (
        <DeckContextMenu
          x={deckMenu.x}
          y={deckMenu.y}
          deckSize={(myCards['deck'] ?? []).length}
          revealedTopCardName={(() => {
            if (!(gameState.myPlayer?.topDeckRevealed ?? false)) return undefined;
            const top = (myCards['deck'] ?? [])[0];
            return top && isDanielCard(top.cardName ?? '', top.reference ?? '') ? top.cardName : undefined;
          })()}
          onClose={() => setDeckMenu(null)}
          onSearchDeck={() => { logSearchDeck(); setDeckMenu(null); setShowDeckSearch(true); }}
          onLookAtTop={(n) => { logLookAtTop(n, undefined, 'top'); setDeckMenu(null); setLookState({ count: n, position: 'top' }); }}
          onLookAtBottom={(n) => { logLookAtTop(n, undefined, 'bottom'); setDeckMenu(null); setLookState({ count: n, position: 'bottom' }); }}
          onLookAtRandom={(n) => { logLookAtTop(n, undefined, 'random'); setDeckMenu(null); setLookState({ count: n, position: 'random' }); }}
          onShuffleDeck={() => { multiplayerActions.shuffleDeck(); setDeckMenu(null); }}
          onDrawTop={(n) => { multiplayerActions.drawMultiple(n); setDeckMenu(null); }}
          onRevealTop={(n) => { setDeckMenu(null); setPeekState({ position: 'top', count: n, cardIds: sampleDeckCardIds('top', n) }); }}
          onDiscardTop={(n) => { moveDeckCardsToZone('top', n, 'discard'); setDeckMenu(null); }}
          onReserveTop={(n) => { moveDeckCardsToZone('top', n, 'reserve'); setDeckMenu(null); }}
          onDrawBottom={(n) => { moveDeckCardsToZone('bottom', n, 'hand'); setDeckMenu(null); }}
          onRevealBottom={(n) => { setDeckMenu(null); setPeekState({ position: 'bottom', count: n, cardIds: sampleDeckCardIds('bottom', n) }); }}
          onDiscardBottom={(n) => { moveDeckCardsToZone('bottom', n, 'discard'); setDeckMenu(null); }}
          onReserveBottom={(n) => { moveDeckCardsToZone('bottom', n, 'reserve'); setDeckMenu(null); }}
          onDrawRandom={(n) => { moveDeckCardsToZone('random', n, 'hand'); setDeckMenu(null); }}
          onRevealRandom={(n) => { setDeckMenu(null); setPeekState({ position: 'random', count: n, cardIds: sampleDeckCardIds('random', n) }); }}
          onDiscardRandom={(n) => { moveDeckCardsToZone('random', n, 'discard'); setDeckMenu(null); }}
          onReserveRandom={(n) => { moveDeckCardsToZone('random', n, 'reserve'); setDeckMenu(null); }}
        />
      )}

      {!isSpectator && soulDeckMenu && (
        <DeckContextMenu
          x={soulDeckMenu.x}
          y={soulDeckMenu.y}
          deckSize={sharedCards['soul-deck']?.length ?? 0}
          hideDiscardActions
          hideReserveActions
          onClose={() => setSoulDeckMenu(null)}
          onSearchDeck={searchSoulDeck}
          onShuffleDeck={handleShuffleSoulDeck}
          onLookAtTop={(n) => lookAtSoulDeck('top', n)}
          onLookAtBottom={(n) => lookAtSoulDeck('bottom', n)}
          onLookAtRandom={(n) => lookAtSoulDeck('random', n)}
          onRevealTop={(n) => revealFromSoulDeck('top', n)}
          onRevealBottom={(n) => revealFromSoulDeck('bottom', n)}
          onRevealRandom={(n) => revealFromSoulDeck('random', n)}
          // Draw moves the card face-up into the shared LoB directly.
          // Reveal shows a public modal without moving the card.
          onDrawTop={(n) => drawFromSoulDeck('top', n)}
          onDrawBottom={(n) => drawFromSoulDeck('bottom', n)}
          onDrawRandom={(n) => drawFromSoulDeck('random', n)}
          onDiscardTop={() => {}}
          onDiscardBottom={() => {}}
          onDiscardRandom={() => {}}
          onReserveTop={() => {}}
          onReserveBottom={() => {}}
          onReserveRandom={() => {}}
        />
      )}

      {!isSpectator && handMenu && (
        <HandContextMenu
          x={handMenu.x}
          y={handMenu.y}
          handSize={myCards['hand']?.length ?? 0}
          onClose={() => setHandMenu(null)}
          onRandomToDiscard={(count) => { setHandMenu(null); multiplayerActions.randomHandToZone(count, 'discard', ''); }}
          onRandomToReserve={(count) => { setHandMenu(null); multiplayerActions.randomHandToZone(count, 'reserve', ''); }}
          onRandomToDeckTop={(count) => { setHandMenu(null); multiplayerActions.randomHandToZone(count, 'deck', 'top'); }}
          onRandomToDeckBottom={(count) => { setHandMenu(null); multiplayerActions.randomHandToZone(count, 'deck', 'bottom'); }}
          onShuffleRandomIntoDeck={(count) => { setHandMenu(null); multiplayerActions.randomHandToZone(count, 'deck', 'shuffle'); }}
          isHandRevealed={gameState.myPlayer?.handRevealed ?? false}
          onRevealHand={(revealed) => {
            setHandMenu(null);
            gameState.revealHand(revealed);
            if (revealAutoHideRef.current) {
              clearTimeout(revealAutoHideRef.current);
              revealAutoHideRef.current = null;
            }
            if (revealed) {
              revealAutoHideRef.current = setTimeout(() => {
                gameState.revealHand(false);
                revealAutoHideRef.current = null;
              }, 30_000);
            }
          }}
        />
      )}

      {!isSpectator && opponentHandMenu && (() => {
        const requestAction = (action: string, count: number) => {
          const params = JSON.stringify({ count });
          requestOpponentAction(action, params);
          setOpponentHandMenu(null);
          showGameToast('Waiting for opponent to approve...');
        };
        return (
          <HandContextMenu
            mode="opponent"
            x={opponentHandMenu.x}
            y={opponentHandMenu.y}
            handSize={opponentCards['hand']?.length ?? 0}
            onClose={() => setOpponentHandMenu(null)}
            onRandomToDiscard={(count) => requestAction('random_hand_to_discard', count)}
            onRandomToReserve={(count) => requestAction('random_hand_to_reserve', count)}
            onRandomToDeckTop={(count) => requestAction('random_hand_to_deck_top', count)}
            onRandomToDeckBottom={(count) => requestAction('random_hand_to_deck_bottom', count)}
            onShuffleRandomIntoDeck={(count) => requestAction('random_hand_to_deck_shuffle', count)}
            isHandRevealed={gameState.opponentPlayer?.handRevealed ?? false}
            onRevealHand={() => {
              setOpponentHandMenu(null);
              requestZoneSearch('hand-reveal');
              showGameToast('Asking opponent to reveal hand...');
            }}
          />
        );
      })()}

      {!isSpectator && reserveMenu && (
        <ReserveContextMenu
          x={reserveMenu.x}
          y={reserveMenu.y}
          cardCount={myCards['reserve']?.length ?? 0}
          isRevealed={gameState.myPlayer?.reserveRevealed ?? false}
          onToggleReveal={() => {
            const isRevealed = gameState.myPlayer?.reserveRevealed ?? false;
            gameState.revealReserve(!isRevealed);
          }}
          onLookAtReserve={() => { setReserveMenu(null); setBrowseMyZone('reserve'); }}
          onClose={() => setReserveMenu(null)}
          onRandomToDiscard={(count) => { setReserveMenu(null); multiplayerActions.randomReserveToZone(count, 'discard', ''); }}
        />
      )}

      {!isSpectator && opponentReserveMenu && (() => {
        const oppReserveRevealed = gameState.opponentPlayer?.reserveRevealed ?? false;
        const oppReserveCards = opponentCards['reserve'] ?? [];
        const oppId = gameState.opponentPlayer?.id;
        const randomOppReserveToDiscard = (count: number) => {
          if (oppId == null || oppReserveCards.length === 0) return;
          const pool = [...oppReserveCards];
          const picks: typeof oppReserveCards = [];
          for (let i = 0; i < count && pool.length > 0; i++) {
            const idx = Math.floor(Math.random() * pool.length);
            picks.push(pool[idx]);
            pool.splice(idx, 1);
          }
          for (const card of picks) {
            gameState.moveCard(BigInt(card.id), 'discard', '', '', '', String(oppId));
          }
        };
        return (
          <ReserveContextMenu
            x={opponentReserveMenu.x}
            y={opponentReserveMenu.y}
            cardCount={oppReserveCards.length}
            isRevealed={oppReserveRevealed}
            onLookAtReserve={oppReserveRevealed ? () => { setOpponentReserveMenu(null); setBrowseOpponentZone('reserve'); } : undefined}
            onSearchRequest={!oppReserveRevealed ? () => {
              requestZoneSearch('reserve');
              showGameToast('Waiting for opponent to approve...');
              setOpponentReserveMenu(null);
            } : undefined}
            onRandomToDiscard={(count) => { setOpponentReserveMenu(null); randomOppReserveToDiscard(count); }}
            onClose={() => setOpponentReserveMenu(null)}
          />
        );
      })()}

      {!isSpectator && opponentDeckMenu && (() => {
        const requestAction = (action: string, count?: number) => {
          const params = count != null ? JSON.stringify({ count }) : '';
          requestOpponentAction(action, params);
          setOpponentDeckMenu(null);
          showGameToast('Waiting for opponent to approve...');
        };
        return (
          <DeckContextMenu
            x={opponentDeckMenu.x}
            y={opponentDeckMenu.y}
            deckSize={(opponentCards['deck'] ?? []).length}
            onClose={() => setOpponentDeckMenu(null)}
            hideDrawActions
            onSearchDeck={() => {
              setOpponentDeckMenu(null);
              requestZoneSearch('deck');
              showGameToast('Waiting for opponent to approve...');
            }}
            onShuffleDeck={() => requestAction('shuffle_deck')}
            onLookAtTop={(n) => requestAction('look_deck_top', n)}
            onLookAtBottom={(n) => requestAction('look_deck_bottom', n)}
            onLookAtRandom={(n) => requestAction('look_deck_random', n)}
            onDrawTop={(n) => requestAction('draw_deck_top', n)}
            onRevealTop={(n) => requestAction('reveal_deck_top', n)}
            onDiscardTop={(n) => requestAction('discard_deck_top', n)}
            onReserveTop={(n) => requestAction('reserve_deck_top', n)}
            onDrawBottom={(n) => requestAction('draw_deck_bottom', n)}
            onRevealBottom={(n) => requestAction('reveal_deck_bottom', n)}
            onDiscardBottom={(n) => requestAction('discard_deck_bottom', n)}
            onReserveBottom={(n) => requestAction('reserve_deck_bottom', n)}
            onDrawRandom={(n) => requestAction('draw_deck_random', n)}
            onRevealRandom={(n) => requestAction('reveal_deck_random', n)}
            onDiscardRandom={(n) => requestAction('discard_deck_random', n)}
            onReserveRandom={(n) => requestAction('reserve_deck_random', n)}
          />
        );
      })()}

      {!isSpectator && lorMenu && (
        <LorContextMenu
          x={lorMenu.x}
          y={lorMenu.y}
          onClose={() => setLorMenu(null)}
          onAddSoul={() => {
            multiplayerActions.spawnLostSoul?.('NT', '0.5', '0.5');
            setLorMenu(null);
          }}
        />
      )}

      {deckDrop && (() => {
        const ids = deckDrop.batchIds ?? [deckDrop.cardId];
        const isBatch = ids.length > 1;
        return (
          <DeckDropPopup
            x={deckDrop.x}
            y={deckDrop.y}
            onShuffleIn={() => {
              releaseDeckHold('commit');
              if (ids.length === 1) {
                multiplayerActions.shuffleCardIntoDeck(ids[0]);
              } else {
                multiplayerActions.moveCardsBatch(ids, 'deck');
                multiplayerActions.shuffleDeck();
              }
              setDeckDrop(null);
            }}
            onTopDeck={() => {
              releaseDeckHold('commit');
              for (const id of ids) multiplayerActions.moveCardToTopOfDeck(id);
              setDeckDrop(null);
            }}
            onBottomDeck={() => {
              releaseDeckHold('commit');
              for (const id of ids) multiplayerActions.moveCardToBottomOfDeck(id);
              setDeckDrop(null);
            }}
            onExchange={!isBatch ? () => { releaseDeckHold('glide'); setDeckDrop(null); setExchangeState({ cardIds: [deckDrop.cardId], targetZone: 'deck' }); } : undefined}
            onCancel={() => { releaseDeckHold('glide'); setDeckDrop(null); }}
          />
        );
      })()}

      {soulDeckDrop && (() => {
        const ids = soulDeckDrop.batchIds ?? [soulDeckDrop.cardId];
        const isBatch = ids.length > 1;
        return (
          <DeckDropPopup
            x={soulDeckDrop.x}
            y={soulDeckDrop.y}
            onShuffleIn={() => {
              // Move each card to soul-deck then shuffle. moveCardsBatch for >1.
              if (ids.length === 1) {
                gameState.moveCard(BigInt(ids[0]), 'soul-deck');
              } else {
                gameState.moveCardsBatch(JSON.stringify(ids), 'soul-deck');
              }
              gameState.shuffleSoulDeck();
              releaseDeckHold('commit');
              setSoulDeckDrop(null);
            }}
            onTopDeck={() => {
              releaseDeckHold('commit');
              for (const id of ids) gameState.moveCard(BigInt(id), 'soul-deck', '0');
              setSoulDeckDrop(null);
            }}
            onBottomDeck={() => {
              releaseDeckHold('commit');
              for (const id of ids) gameState.moveCard(BigInt(id), 'soul-deck');
              setSoulDeckDrop(null);
            }}
            onExchange={!isBatch ? () => { releaseDeckHold('glide'); setSoulDeckDrop(null); setExchangeState({ cardIds: [soulDeckDrop.cardId], targetZone: 'soul-deck' }); } : undefined}
            onCancel={() => { releaseDeckHold('glide'); setSoulDeckDrop(null); }}
          />
        );
      })()}

      {/* ================================================================
          Opponent zone search — context menu, consent dialog, browse modal
          ================================================================ */}
      {!isSpectator && opponentZoneMenu && (
        <OpponentZoneContextMenu
          x={opponentZoneMenu.x}
          y={opponentZoneMenu.y}
          zone={opponentZoneMenu.zone}
          zoneName={opponentZoneMenu.zoneName}
          onSearch={() => {
            requestZoneSearch(opponentZoneMenu.zone);
            showGameToast('Waiting for opponent to approve...');
            setOpponentZoneMenu(null);
          }}
          onRevealHand={opponentZoneMenu.zone === 'hand' ? () => {
            requestZoneSearch('hand-reveal');
            showGameToast('Asking opponent to reveal hand...');
            setOpponentZoneMenu(null);
          } : undefined}
          onClose={() => setOpponentZoneMenu(null)}
        />
      )}

      {/* Board reset approval (Three Nails / A New Beginning) — floating in center of board */}
      {incomingSearchRequest && incomingSearchRequest.action === 'three_nails_reset' && (() => {
        let resetCardName = 'Three Nails (GoC)';
        try {
          const p = JSON.parse(incomingSearchRequest.actionParams ?? '{}');
          if (p.cardName) resetCardName = p.cardName;
        } catch { /* legacy request without cardName */ }
        return (
          <BoardRequestBanner
            maxWidth={460}
            message={
              <>
                <strong style={{ color: '#c4955a' }}>
                  {gameState.opponentPlayer?.displayName ?? 'Opponent'}
                </strong>{' '}
                is activating <strong style={{ color: '#c4955a' }}>{resetCardName}</strong> — shuffles all hands, territories, and lands of bondage; each player draws 8.
              </>
            }
            affirmLabel="Approve"
            onAffirm={() => {
              approveZoneSearch(BigInt(incomingSearchRequest.id));
              showGameToast(`${resetCardName} reset approved`);
            }}
            onDeny={() => denyZoneSearch(BigInt(incomingSearchRequest.id))}
          />
        );
      })()}

      {/* Priority request — floating in center of board between territories */}
      {incomingSearchRequest && incomingSearchRequest.zone === 'action-priority' && (
        <BoardRequestBanner
          message={
            <>
              <strong style={{ color: '#c4955a' }}>
                {gameState.opponentPlayer?.displayName ?? 'Opponent'}
              </strong>{' '}
              requests action priority
            </>
          }
          affirmLabel="Grant"
          onAffirm={() => {
            approveZoneSearch(BigInt(incomingSearchRequest.id));
            showGameToast('Action priority granted');
          }}
          onDeny={() => denyZoneSearch(BigInt(incomingSearchRequest.id))}
        />
      )}

      {/* Phase Stop hold (rev 4) — a tripped gate IS a priority request, so it
          uses the same prompt as the Priority button, shown to the active
          player. Grant and Deny both just lift the hold — the turn stays
          where it halted and the active player redoes their move (the stop
          was consumed when it tripped, so it won't re-fire); they differ only
          in the courtesy logged to the opponent. The 60s server backstop
          releases on its own if the prompt is ignored. */}
      {!isSpectator && gameState.holdPhase !== '' && gameState.isMyTurn && (
        <BoardRequestBanner
          message={
            <>
              <strong style={{ color: '#c4955a' }}>
                {gameState.opponentPlayer?.displayName ?? 'Opponent'}
              </strong>{' '}
              requests action priority before you{' '}
              {gameState.holdPhase === 'end' ? (
                <>end your turn</>
              ) : (
                <>
                  move to{' '}
                  <strong style={{ color: '#c4955a' }}>
                    {STOP_GATE_LABELS[gameState.holdPhase] ?? gameState.holdPhase}
                  </strong>
                </>
              )}
            </>
          }
          affirmLabel="Grant"
          onAffirm={() => {
            gameState.releaseTurnStop(false);
            showGameToast('Action priority granted — continue when ready');
          }}
          onDeny={() => {
            gameState.releaseTurnStop(true);
            showGameToast('Priority declined — continue when ready');
          }}
        />
      )}

      {/* Initiative request — floating in center of board between territories */}
      {incomingSearchRequest && incomingSearchRequest.zone === 'initiative' && (
        <BoardRequestBanner
          message={
            <>
              <strong style={{ color: '#c4955a' }}>
                {gameState.opponentPlayer?.displayName ?? 'Opponent'}
              </strong>{' '}
              requests initiative
            </>
          }
          affirmLabel="Grant"
          onAffirm={() => {
            approveZoneSearch(BigInt(incomingSearchRequest.id));
            showGameToast('Initiative granted');
          }}
          onDeny={() => denyZoneSearch(BigInt(incomingSearchRequest.id))}
        />
      )}

      {/* Search/reveal/action requests — floating top-center banner */}
      {incomingSearchRequest && incomingSearchRequest.zone !== 'action-priority' && incomingSearchRequest.zone !== 'initiative' && incomingSearchRequest.action !== 'three_nails_reset' && (() => {
        const isAction = !!incomingSearchRequest.action;
        const actionDescription = isAction
          ? describeOpponentAction(incomingSearchRequest.action, incomingSearchRequest.actionParams)
          : undefined;
        return (
          <ConsentDialog
            requesterName={gameState.opponentPlayer?.displayName ?? 'Opponent'}
            zoneName={incomingSearchRequest.zone === 'hand-reveal' ? 'hand' : incomingSearchRequest.zone}
            requestType={isAction ? 'action' : incomingSearchRequest.zone === 'hand-reveal' ? 'reveal' : 'search'}
            actionDescription={actionDescription}
            onAllow={() => {
              approveZoneSearch(BigInt(incomingSearchRequest.id));
              if (incomingSearchRequest.zone === 'hand-reveal') {
                gameState.revealHand(true);
                // Auto-hide hand after 30 seconds
                if (revealAutoHideRef.current) clearTimeout(revealAutoHideRef.current);
                revealAutoHideRef.current = setTimeout(() => {
                  gameState.revealHand(false);
                  revealAutoHideRef.current = null;
                }, 30_000);
              }
              if (incomingSearchRequest.action === 'keep_one_shuffle_draw') {
                // Philip's Daughters — we approve, then pick our OWN keeper and
                // fire the target-half reducer ourselves. The caster can't do
                // it for us: they can't see this hand.
                setKeepOneReq({
                  mode: 'responder',
                  requestId: String(incomingSearchRequest.id),
                  sourceCardName: gameState.opponentPlayer?.displayName
                    ? `${gameState.opponentPlayer.displayName} played Philip’s Daughters`
                    : undefined,
                });
              }
            }}
            onDeny={() => denyZoneSearch(BigInt(incomingSearchRequest.id))}
          />
        );
      })()}

      {/* Countdown bar — shrinks over 30s while opponent hand is revealed */}
      {oppHandRevealed && opponentHandRect && mpLayout && (() => {
        // Bar spans only the play area (excludes sidebar) and stays inside the hand zone
        const barVirtualWidth = mpLayout.playAreaWidth;
        const barTopLeft = virtualToScreen(
          opponentHandRect.x,
          opponentHandRect.y + opponentHandRect.height,
          scale, offsetX, offsetY,
        );
        const barBottomRight = virtualToScreen(
          opponentHandRect.x + barVirtualWidth,
          opponentHandRect.y + opponentHandRect.height + 4,
          scale, offsetX, offsetY,
        );
        const screenWidth = barBottomRight.x - barTopLeft.x;
        return (
          <div
            style={{
              position: 'absolute',
              left: barTopLeft.x,
              top: barTopLeft.y,
              width: revealBarShrinking ? 0 : screenWidth,
              height: barBottomRight.y - barTopLeft.y,
              background: 'linear-gradient(90deg, #c8a84e, #f0d878)',
              transition: revealBarShrinking ? 'width 30s linear' : 'none',
              borderRadius: 2,
              zIndex: 100,
              pointerEvents: 'none',
            }}
          />
        );
      })()}

      {approvedSearchRequest && !approvedSearchRequest.action && approvedSearchRequest.zone !== 'hand-reveal' && approvedSearchRequest.zone !== 'action-priority' && approvedSearchRequest.zone !== 'initiative' && (() => {
        const zoneCards = (opponentCards[approvedSearchRequest.zone] ?? [])
          .map((c: CardInstance) => adaptCard(c, 'player2'));
        return (
          <OpponentBrowseModal
            zoneName={approvedSearchRequest.zone}
            cards={zoneCards}
            onMoveCard={(cardId, action) => {
              const reqId = BigInt(approvedSearchRequest.id);
              const destZone = action === 'discard' ? 'discard' : action === 'banish' ? 'banish' : 'deck';
              recordOpponentCardUndo(cardId, destZone);
              if (action === 'discard') {
                moveOpponentCard(reqId, BigInt(cardId), 'discard');
              } else if (action === 'banish') {
                moveOpponentCard(reqId, BigInt(cardId), 'banish');
              } else if (action === 'deck-top') {
                moveOpponentCard(reqId, BigInt(cardId), 'deck');
              } else if (action === 'deck-bottom') {
                moveOpponentCard(reqId, BigInt(cardId), 'deck');
              } else if (action === 'deck-shuffle') {
                moveOpponentCard(reqId, BigInt(cardId), 'deck');
                shuffleOpponentDeck(reqId);
              }
            }}
            onMoveCardsBatch={(cardIds, action) => {
              const reqId = BigInt(approvedSearchRequest.id);
              for (const cardId of cardIds) {
                const destZone = action === 'discard' ? 'discard' : action === 'banish' ? 'banish' : 'deck';
                recordOpponentCardUndo(cardId, destZone);
                if (action === 'discard') {
                  moveOpponentCard(reqId, BigInt(cardId), 'discard');
                } else if (action === 'banish') {
                  moveOpponentCard(reqId, BigInt(cardId), 'banish');
                } else if (action === 'deck-top') {
                  moveOpponentCard(reqId, BigInt(cardId), 'deck');
                } else if (action === 'deck-bottom') {
                  moveOpponentCard(reqId, BigInt(cardId), 'deck');
                } else if (action === 'deck-shuffle') {
                  moveOpponentCard(reqId, BigInt(cardId), 'deck');
                }
              }
              if (action === 'deck-shuffle') {
                shuffleOpponentDeck(reqId);
              }
            }}
            onClose={(opts) => {
              // If a Turn 1 reserve protection dialog is about to take over,
              // hand the close opts to it and let it complete the search after
              // the user resolves. Otherwise complete immediately as normal.
              const deferred = deferOpponentSearchCompleteRef.current;
              if (deferred) {
                deferred.storeOpts(opts);
                return;
              }
              completeZoneSearch(BigInt(approvedSearchRequest.id), opts?.shuffled ?? false);
            }}
            onStartDrag={opponentModalStartDrag}
            onStartMultiDrag={opponentModalStartMultiDrag}
            didDragRef={opponentModalDidDragRef}
            isDragActive={opponentModalDrag.isDragging}
          />
        );
      })()}

      {/* ================================================================
          Zone browse overlay — card grid for browsing pile contents
          ================================================================ */}
      {/* Field of Battle grid (touch browse sheet): both players' band cards.
          No drag props — the sheet only opens on touch, where modal drags are
          disabled anyway; taps route to the full card menu / card reader. */}
      {browseBattle && (
        <ModalGameProvider value={battleBrowseModalGameValue}>
          <ZoneBrowseModal
            zoneId="battle"
            onClose={() => setBrowseBattle(false)}
            readOnly={isSpectator}
            isCardFaceHidden={isCardFaceHiddenFromViewer}
            onReadCard={isSpectator ? setReaderCard : undefined}
            alwaysUseCardMenu
            onRequestCardMenu={(card, clientX, clientY) => {
              setBrowseBattle(false);
              setContextMenu({ card, x: clientX, y: clientY });
            }}
          />
        </ModalGameProvider>
      )}
      {browseOpponentZone && (
        <ModalGameProvider value={opponentModalGameValue}>
          <ZoneBrowseModal
            zoneId={browseOpponentZone as ZoneId}
            onClose={() => setBrowseOpponentZone(null)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            readOnly={isSpectator}
            isCardFaceHidden={isCardFaceHiddenFromViewer}
            onReadCard={isSpectator ? setReaderCard : undefined}
            alwaysUseCardMenu={IN_PLAY_BROWSE_ZONES.has(browseOpponentZone)}
            onRequestCardMenu={(card, clientX, clientY) => {
              setBrowseOpponentZone(null);
              setContextMenu({ card, x: clientX, y: clientY });
            }}
          />
        </ModalGameProvider>
      )}

      {/* ================================================================
          Shared deck modals — wrapped in ModalGameProvider
          ================================================================ */}
      <ModalGameProvider value={modalGameValue}>
        {browseMyZone && (
          <ZoneBrowseModal
            zoneId={browseMyZone as ZoneId}
            onClose={() => setBrowseMyZone(null)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            readOnly={isSpectator}
            isCardFaceHidden={isCardFaceHiddenFromViewer}
            onReadCard={isSpectator ? setReaderCard : undefined}
            alwaysUseCardMenu={IN_PLAY_BROWSE_ZONES.has(browseMyZone)}
            onRequestCardMenu={(card, clientX, clientY) => {
              setBrowseMyZone(null);
              setContextMenu({ card, x: clientX, y: clientY });
            }}
          />
        )}

        {showDeckSearch && (
          <DeckSearchModal
            onClose={() => setShowDeckSearch(false)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
          />
        )}

        {peekState && (
          <DeckPeekModal
            cardIds={peekCardIds}
            title={`${peekState.position === 'top' ? 'Top' : peekState.position === 'bottom' ? 'Bottom' : 'Random'} ${peekState.count}`}
            onClose={() => { setPeekState(null); gameState.clearRevealedCards(); }}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
          />
        )}

        {lookState && (
          <DeckPeekModal
            cardIds={lookCardIds}
            title={`Looking at ${lookState.position === 'top' ? 'Top' : lookState.position === 'bottom' ? 'Bottom' : 'Random'} ${lookState.count}`}
            onClose={() => setLookState(null)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            isPrivateLook
          />
        )}

        {exchangeState && exchangeState.targetZone !== 'soul-deck' && (
          <DeckExchangeModal
            exchangeCardIds={exchangeState.cardIds}
            targetZone={exchangeState.targetZone}
            onComplete={() => { setExchangeState(null); clearSelection(); }}
            onCancel={() => setExchangeState(null)}
            onStartDrag={modalStartDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            validDropRef={modalValidDropRef}
          />
        )}
      </ModalGameProvider>

      {/* Opponent deck modals — wrapped in ModalGameProvider with opponent card data.
          Uses regular modalStartDrag (not opponentModalStartDrag) because move_card
          allows either player to move any card in sandbox mode. The moveOpponentCard
          gate is only for the consent-flow OpponentBrowseModal. */}
      <ModalGameProvider value={opponentModalGameValue}>
        {opponentPeekState && (
          <DeckPeekModal
            cardIds={opponentPeekCardIds}
            title={`Opponent ${opponentPeekState.position === 'top' ? 'Top' : opponentPeekState.position === 'bottom' ? 'Bottom' : 'Random'} ${opponentPeekState.count}`}
            onClose={() => { setOpponentPeekState(null); gameState.clearRevealedCards(); }}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
          />
        )}
        {opponentLookState && (
          <DeckPeekModal
            cardIds={opponentLookCardIds}
            title={`Looking at Opponent ${opponentLookState.position === 'top' ? 'Top' : opponentLookState.position === 'bottom' ? 'Bottom' : 'Random'} ${opponentLookState.count}`}
            onClose={() => setOpponentLookState(null)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            isPrivateLook
          />
        )}
      </ModalGameProvider>

      {/* ================================================================
          Paragon-only: shared Soul Deck modals (Search + private Look).
          ================================================================ */}
      <ModalGameProvider value={soulDeckModalGameValue}>
        {browseSharedLob && (
          <ZoneBrowseModal
            zoneId="land-of-bondage"
            onClose={() => setBrowseSharedLob(false)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            readOnly={isSpectator}
            alwaysUseCardMenu
            onRequestCardMenu={(card, clientX, clientY) => {
              setBrowseSharedLob(false);
              setContextMenu({ card, x: clientX, y: clientY });
            }}
          />
        )}
        {browseSoulDeck && (
          <ZoneBrowseModal
            zoneId="soul-deck"
            onClose={() => setBrowseSoulDeck(false)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            readOnly={isSpectator}
          />
        )}
        {soulDeckLookState && (
          <DeckPeekModal
            cardIds={soulDeckLookState.cardIds}
            title={soulDeckLookState.title}
            onClose={() => setSoulDeckLookState(null)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            isPrivateLook
            sourceZone="soul-deck"
          />
        )}
        {soulDeckPeekState && (
          <DeckPeekModal
            cardIds={soulDeckPeekState.cardIds}
            title={soulDeckPeekState.title}
            onClose={() => { setSoulDeckPeekState(null); gameState.clearRevealedCards(); }}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            sourceZone="soul-deck"
          />
        )}
        {exchangeState && exchangeState.targetZone === 'soul-deck' && (
          <DeckExchangeModal
            exchangeCardIds={exchangeState.cardIds}
            targetZone={exchangeState.targetZone}
            onComplete={() => { setExchangeState(null); clearSelection(); }}
            onCancel={() => setExchangeState(null)}
            onStartDrag={modalStartDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            validDropRef={modalValidDropRef}
          />
        )}
      </ModalGameProvider>

      {/* Seat-1 player's server-revealed cards — shown from snapshot so it persists
          even after the revealer closes their reveal. Seated players see this as
          "the opponent's reveal"; spectators see it as the seat-1 reveal. */}
      {opponentRevealSnapshot.length > 0 && !opponentRevealDismissed &&
        renderPublicRevealModal(
          opponentRevealSnapshot,
          opponentRevealedCardIds,
          gameState.opponentPlayer?.displayName ?? 'Opponent',
          () => setOpponentRevealDismissed(true),
        )}

      {/* Spectator-only: seat-0 player's server-revealed cards. Seated players
          already see their own reveal via the interactive peekState modal, so
          this mirror renders only for spectators — giving them both seats' reveals. */}
      {isSpectator && myRevealSnapshot.length > 0 && !myRevealDismissed &&
        renderPublicRevealModal(
          myRevealSnapshot,
          myRevealedCardIds,
          gameState.myPlayer?.displayName ?? 'Player',
          () => setMyRevealDismissed(true),
        )}

      {/* Floating drag ghost (modal → canvas drag) */}
      {modalDrag.isDragging && modalDrag.imageUrl && (
        modalDrag.additionalCards.length > 0 ? (
          <div
            ref={modalGhostRef as React.RefObject<HTMLDivElement>}
            style={{
              position: 'fixed',
              pointerEvents: 'none',
              zIndex: 1100,
            }}
          >
            {[...modalDrag.additionalCards.slice(0, 2)].reverse().filter(e => e.imageUrl).map((extra, i) => (
              <img
                key={extra.card.instanceId}
                src={extra.imageUrl}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  width: 80,
                  borderRadius: 4,
                  border: '1px solid var(--gf-text-dim)',
                  opacity: 0.4 - i * 0.15,
                  top: -(6 + i * 4),
                  left: 4 + i * 2,
                  zIndex: -1 - i,
                }}
              />
            ))}
            <img
              src={modalDrag.imageUrl}
              alt="Dragging cards"
              draggable={false}
              style={{
                width: 80,
                borderRadius: 4,
                border: '2px solid var(--gf-accent)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
                opacity: 0.9,
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: -8,
                right: -8,
                background: 'var(--gf-accent)',
                color: '#1e1610',
                borderRadius: '50%',
                width: 22,
                height: 22,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 'bold',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
              }}
            >
              {modalDrag.additionalCards.length + 1}
            </div>
          </div>
        ) : (
          <img
            ref={modalGhostRef as React.RefObject<HTMLImageElement>}
            src={modalDrag.imageUrl}
            alt="Dragging card"
            draggable={false}
            style={{
              position: 'fixed',
              width: 80,
              borderRadius: 4,
              border: '2px solid var(--gf-accent)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
              zIndex: 1100,
              opacity: 0.9,
            }}
          />
        )
      )}

      {/* Floating drag ghost (opponent modal → canvas drag) */}
      {opponentModalDrag.isDragging && opponentModalDrag.imageUrl && (
        opponentModalDrag.additionalCards.length > 0 ? (
          <div
            ref={opponentModalGhostRef as React.RefObject<HTMLDivElement>}
            style={{
              position: 'fixed',
              pointerEvents: 'none',
              zIndex: 1100,
            }}
          >
            {[...opponentModalDrag.additionalCards.slice(0, 2)].reverse().filter(e => e.imageUrl).map((extra, i) => (
              <img
                key={i}
                src={extra.imageUrl}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  width: 80,
                  borderRadius: 4,
                  border: '1px solid var(--gf-text-dim)',
                  opacity: 0.4 - i * 0.15,
                  top: -(6 + i * 4),
                  left: 4 + i * 2,
                  zIndex: -1 - i,
                }}
              />
            ))}
            <img
              src={opponentModalDrag.imageUrl}
              alt="Dragging cards"
              draggable={false}
              style={{
                width: 80,
                borderRadius: 4,
                border: '2px solid var(--gf-accent)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
                opacity: 0.9,
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: -8,
                right: -8,
                background: 'var(--gf-accent)',
                color: '#1e1610',
                borderRadius: '50%',
                width: 22,
                height: 22,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 'bold',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
              }}
            >
              {opponentModalDrag.additionalCards.length + 1}
            </div>
          </div>
        ) : (
          <img
            ref={opponentModalGhostRef as React.RefObject<HTMLImageElement>}
            src={opponentModalDrag.imageUrl}
            alt="Dragging card"
            draggable={false}
            style={{
              position: 'fixed',
              width: 80,
              borderRadius: 4,
              border: '2px solid var(--gf-accent)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
              pointerEvents: 'none',
              zIndex: 1100,
              opacity: 0.9,
            }}
          />
        )
      )}

      {/* ================================================================
          Turn 1 reserve protection confirmation dialog
          ================================================================ */}
      {pendingReserveMove && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 950,
            background: 'rgba(0,0,0,0.4)',
          }}
          onClick={() => dismissPendingReserveMove(pendingReserveMove, false)}
        >
          <div
            style={{
              position: 'absolute',
              // Camera-derived and unbounded (see CountPromptDialog): zoomed in
              // near a board edge this panel rendered off-screen while its own
              // scrim still covered the board. Half of maxWidth, plus a margin.
              left: `clamp(190px, ${playCenterScreenX}px, calc(100% - 190px))`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'var(--gf-bg, #1a1510)',
              border: '1px solid var(--gf-border, #3a3428)',
              borderRadius: 10,
              padding: '20px 28px',
              maxWidth: 360,
              boxShadow: '0 12px 48px rgba(0,0,0,0.8)',
              textAlign: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              fontSize: 14,
              color: 'var(--gf-text, #c8b89a)',
              lineHeight: 1.5,
              marginBottom: 18,
            }}>
              {pendingReserveMove.message ?? (
                <>Cards typically cannot leave the reserve on <strong style={{ color: 'var(--gf-text-bright, #e8d5a3)' }}>Turn 1</strong>. Move anyway?</>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => dismissPendingReserveMove(pendingReserveMove, true)}
                style={{
                  padding: '7px 20px',
                  background: '#2d5a27',
                  border: '1px solid #4a8a42',
                  borderRadius: 6,
                  color: '#c4e8bf',
                  fontSize: 12,
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  cursor: 'pointer',
                  letterSpacing: 0.5,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#3a7332'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#2d5a27'; }}
              >
                {pendingReserveMove.confirmLabel ?? 'Move Anyway'}
              </button>
              <button
                onClick={() => dismissPendingReserveMove(pendingReserveMove, false)}
                style={{
                  padding: '7px 20px',
                  background: '#5a2727',
                  border: '1px solid #8a4242',
                  borderRadius: 6,
                  color: '#e8bfbf',
                  fontSize: 12,
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  cursor: 'pointer',
                  letterSpacing: 0.5,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#733232'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#5a2727'; }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ================================================================
          Card hover preview — floating tooltip near cursor
          ================================================================ */}
      {/* Touch gets no cursor-anchored hover preview: Konva synthesizes
          mouseenter from touches (setting hoveredCard) but never a mousemove
          with client coords, so mousePos is stale/NaN — the preview rendered
          at 0,0 or threw "NaN is an invalid value for left". The loupe panel
          is the touch preview surface. */}
      {!isTouch && hoveredCard && hoverReady && !isLoupeVisible && !isDraggingRef.current && !contextMenu && !multiCardContextMenu && !deckMenu && !zoneMenu && !lorMenu && !opponentZoneMenu && !handMenu && !opponentHandMenu && !reserveMenu && !opponentReserveMenu && (() => {
        const MARGIN = 8;
        const CURSOR_OFFSET = 16;
        const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const viewportH = typeof window !== 'undefined' ? window.innerHeight : 720;

        // Scale the preview down if the viewport is too short to fit the
        // default size. Keeps the 1:1.4 aspect ratio.
        const maxHeight = Math.max(120, viewportH - MARGIN * 2);
        let previewHeight = Math.min(Math.round(280 * 1.4), maxHeight);
        let previewWidth = Math.round(previewHeight / 1.4);
        const maxWidth = Math.max(80, viewportW - MARGIN * 2);
        if (previewWidth > maxWidth) {
          previewWidth = maxWidth;
          previewHeight = Math.round(previewWidth * 1.4);
        }

        const imageUrl = getSharedCardImageUrl(hoveredCard.cardImgFile);
        if (!imageUrl) return null;

        // Prefer above-right of cursor; flip horizontally / vertically if it
        // would overflow, then clamp to the viewport as a final guarantee so
        // the preview is never partially off-screen on small viewports.
        let left = mousePos.x + CURSOR_OFFSET;
        let top = mousePos.y - previewHeight - CURSOR_OFFSET;

        if (left + previewWidth > viewportW - MARGIN) {
          left = mousePos.x - previewWidth - CURSOR_OFFSET;
        }
        if (top < MARGIN) {
          top = mousePos.y + CURSOR_OFFSET;
        }

        left = Math.max(MARGIN, Math.min(left, viewportW - previewWidth - MARGIN));
        top = Math.max(MARGIN, Math.min(top, viewportH - previewHeight - MARGIN));
        if (!Number.isFinite(left) || !Number.isFinite(top)) return null;

        return (
          <div
            style={{
              position: 'fixed',
              left,
              top,
              width: previewWidth,
              height: previewHeight,
              zIndex: 1000,
              pointerEvents: 'none',
              borderRadius: 6,
              boxShadow: '0 8px 32px rgba(0,0,0,0.8), 0 0 12px rgba(212,168,103,0.3)',
              overflow: 'hidden',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={hoveredCard.cardName}
              width={previewWidth}
              height={previewHeight}
              style={{
                display: 'block',
                width: previewWidth,
                height: previewHeight,
                borderRadius: 6,
                transform: hoveredCard.isMeek && !isPreviewFlipped ? 'rotate(180deg)' : undefined,
              }}
            />
            {hoveredCard.notes && (
              <div
                style={{
                  position: 'absolute',
                  left: 12,
                  right: 12,
                  bottom: 14,
                  background: 'rgba(0, 0, 0, 0.88)',
                  border: '1px solid #c4955a',
                  borderRadius: 999,
                  padding: '6px 12px',
                  color: '#f0d9a8',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 13,
                  fontWeight: 700,
                  textAlign: 'center',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.8)',
                  wordBreak: 'break-word',
                }}
              >
                {hoveredCard.notes}
              </div>
            )}
          </div>
        );
      })()}

      {targeting && (
        <TargetCardOverlay
          prompt={targeting.prompt}
          onCancel={() => {
            targeting.onCancel();
            setTargeting(null);
          }}
        />
      )}

      {countPrompt && (
        <CountPromptDialog
          centerX={playCenterScreenX}
          req={{
            ...countPrompt,
            onConfirm: (count) => {
              countPrompt.onConfirm(count);
              setCountPrompt(null);
            },
            onCancel: () => {
              countPrompt.onCancel();
              setCountPrompt(null);
            },
          }}
        />
      )}

      {resurrectReq && (() => {
        const myZones = modalGameValue.zones as Record<string, GameCard[]>;
        const oppZones = opponentModalGameValue.zones as Record<string, GameCard[]>;
        // The source card is always one the local player controls ('player1'),
        // so list their discard page first. Each page carries the drag handlers
        // for its owner — your own zones via modalStartDrag, the opponent's via
        // opponentModalStartDrag (same infra the zone-browse modals use).
        const pages = [
          {
            ownerId: 'player1',
            playerName: gameState.myPlayer?.displayName || 'You',
            heroes: (myZones['discard'] ?? []).filter(isHeroCard),
            onStartDrag: modalStartDrag,
            onStartMultiDrag: modalStartMultiDrag,
            didDragRef: modalDidDragRef,
          },
          {
            ownerId: 'player2',
            playerName: gameState.opponentPlayer?.displayName || 'Opponent',
            heroes: (oppZones['discard'] ?? []).filter(isHeroCard),
            onStartDrag: opponentModalStartDrag,
            onStartMultiDrag: opponentModalStartMultiDrag,
            didDragRef: opponentModalDidDragRef,
          },
        ];
        return (
          <ResurrectHeroesModal
            pages={pages}
            isDragActive={modalDrag.isDragging || opponentModalDrag.isDragging}
            onConfirm={(ids) => {
              gameState.resurrectHeroes(resurrectReq.sourceInstanceId, resurrectReq.abilityIndex, ids);
              setResurrectReq(null);
            }}
            onCancel={() => setResurrectReq(null)}
          />
        );
      })()}

      {keepOneReq && (() => {
        // Always the LOCAL hand, in both modes — each player picks their own
        // keeper and never sees the other's.
        const myZones = modalGameValue.zones as Record<string, GameCard[]>;
        const hand = myZones['hand'] ?? [];
        return (
          <KeepOneModal
            hand={hand}
            isResponding={keepOneReq.mode === 'responder'}
            sourceCardName={keepOneReq.mode === 'responder' ? keepOneReq.sourceCardName : undefined}
            onConfirm={(keepInstanceId) => {
              // An empty hand confirms with '' — skip the caster's reducer
              // (nothing to shuffle) but still answer the responder request so
              // it doesn't sit open forever.
              if (keepOneReq.mode === 'caster') {
                if (keepInstanceId) {
                  gameState.keepOneShuffleDraw(
                    BigInt(keepOneReq.sourceInstanceId),
                    BigInt(keepInstanceId),
                  );
                }
              } else {
                gameState.opponentKeepOneShuffleDraw(
                  BigInt(keepOneReq.requestId),
                  keepInstanceId ? BigInt(keepInstanceId) : 0n,
                );
              }
              setKeepOneReq(null);
            }}
            onCancel={() => setKeepOneReq(null)}
          />
        );
      })()}

      {/* ---- Touch overlays ---- */}
      {/* Shown at every zoom level. Gating it on isZoomed made Fit a one-way
          trip — pressing it took the jump buttons away with it, and the only
          way back was a pinch. Gated on status 'playing': during pregame the
          ceremony dialogs (deck reveal, dice roll, star window) stack on the
          board centre and the cluster poked out from underneath them; after
          the game finishes the game-over overlay owns the screen. Hidden
          while THIS viewer's soul chooser is up:
          the z-30 cluster painted over the chooser's top-right corner, and the
          chooser's wait is momentary. The non-chooser (and spectators) keep
          the cluster — they have no modal and still need the camera. */}
      {isTouch && gameStatus === 'playing' && !pregameStep &&
        !(
          gameState.battleState === 'awaiting-soul' &&
          !isSpectator &&
          isSoulChooserSeat(
            gameState.myPlayer ? String(gameState.myPlayer.seat) : '',
            gameState.opponentPlayer ? String(gameState.opponentPlayer.seat) : '',
            gameState.battleAttackerSeat,
            normalizedFormat,
          )
        ) && (
        <TouchControls
          targets={jumpTargets}
          onJump={jumpToTarget}
          activeId={activeJumpId}
          canPanHorizontally={canPanHorizontally}
          onPanHorizontal={panHorizontal}
          onBrowseBoard={() => { closeAllMenus(); setBoardBrowseOpen(true); }}
          // Portrait: the expanded cluster sat directly on the opponent's
          // hand row (the portrait fit is a card-wide column, so the row is
          // exactly under the top-right dock) and hid it entirely.
          defaultCollapsed={portraitBoard}
          // The player turn bar wraps to two rows (94px) when its own width
          // drops under 520 — the bar spans the canvas plus the 44px chat
          // handle, so containerWidth < 476 is the same breakpoint.
          topOffsetPx={isSpectator ? 0 : containerWidth < 476 ? 94 : undefined}
          rightOffsetPx={
            mpLayout
              ? containerWidth - (fit.offsetX + mpLayout.playAreaWidth * fit.scale) + 8
              : undefined
          }
        />
      )}
      {isTouch && boardBrowseOpen && (
        <BoardBrowseSheet
          entries={boardBrowseEntries}
          // Spectators have no "Mine"/"Theirs" — show the seat names instead.
          ownerLabels={isSpectator ? {
            my: gameState.myPlayer?.displayName || 'Player 1',
            opponent: gameState.opponentPlayer?.displayName || 'Player 2',
          } : undefined}
          onClose={() => setBoardBrowseOpen(false)}
          onPick={(entry) => {
            setBoardBrowseOpen(false);
            if (entry.zone === 'battle') setBrowseBattle(true);
            else if (entry.owner === 'my') setBrowseMyZone(entry.zone);
            else if (entry.owner === 'shared') setBrowseSharedLob(true);
            else setBrowseOpponentZone(entry.zone);
          }}
        />
      )}
      {readerCard && (
        <CardReaderOverlay
          card={readerCard}
          imageUrl={resolveCardImageUrl(readerCard.cardImgFile, forgeResolver)}
          onClose={() => setReaderCard(null)}
        />
      )}
      {isTouch && !isSpectator && (
        <DestinationRail
          state={tapMoveState}
          format={normalizedFormat}
          isLostSoul={
            tapMoveState.kind === 'armed'
              ? isLostSoulCard(findAnyCardById(tapMoveState.cardId) ?? {})
              : false
          }
          // Distance from the container's BOTTOM to the top of the hand band on
          // screen. Deriving it from the band's height times the CAMERA scale
          // parked the rail mid-viewport while zoomed, with the hand nowhere in
          // sight. Capped so it can never eat more than a third of the screen.
          handBandHeight={
            mpLayout && containerHeight > 0
              ? Math.max(0, Math.min(
                  Math.round(containerHeight - (mpLayout.zones.playerHand.y * scale + offsetY)),
                  Math.round(containerHeight * 0.35),
                ))
              : 0
          }
          cardName={
            tapMoveState.kind === 'armed'
              ? findAnyCardById(tapMoveState.cardId)?.cardName
              : undefined
          }
          wrap={portraitBoard}
          onPick={(zone, owner) => tapMoveDispatch({ type: 'tapDestinationChip', zone, owner })}
          onCancel={tapMoveReset}
          onSideChange={(s) => tapMoveDispatch({ type: 'setSide', side: s })}
        />
      )}
    </div>
  );
}
