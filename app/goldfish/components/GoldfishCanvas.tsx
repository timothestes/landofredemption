'use client';

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Stage, Layer, Rect, Text, Image as KonvaImage, Group, Circle } from 'react-konva';
import type Konva from 'konva';
import KonvaLib from 'konva';
import { useGame } from '../state/GameContext';
import { calculateZoneLayout, calculateCardPositionsInZone, type ZoneRect } from '../layout/zoneLayout';
import { CARD_WIDTH, CARD_HEIGHT, CARD_ASPECT_RATIO } from '../layout/zoneLayout';
import { calculateHandPositions } from '../layout/handLayout';
import { calculateAutoArrangePositions } from '../../play/layout/multiplayerAutoArrange';
import { VIRTUAL_WIDTH, VIRTUAL_HEIGHT, virtualToScreen } from '@/app/shared/layout/virtualCanvas';
import { preloadImitateSouls } from '@/app/shared/utils/preloadImitateSouls';
import { computeHandBrigades } from '@/app/shared/utils/handBrigades';
import { GameCard, ZoneId, ZONE_LABELS } from '../types';
import { GameCardNode, CardBackShape, cardBackListeners, cardBackLoaded } from '../../shared/components/GameCardNode';
import { PhaseBar } from './PhaseBar';
import { GameToolbar } from './GameToolbar';
import { CardContextMenu } from '@/app/shared/components/CardContextMenu';
import { CardHoverPreview } from './CardHoverPreview';
import { ZoneBrowseModal } from '@/app/shared/components/ZoneBrowseModal';
import { DeckSearchModal } from '@/app/shared/components/DeckSearchModal';
import { DeckContextMenu } from '@/app/shared/components/DeckContextMenu';
import { DeckPeekModal } from '@/app/shared/components/DeckPeekModal';
import { DeckDropPopup } from '@/app/shared/components/DeckDropPopup';
import { DeckExchangeModal } from '@/app/shared/components/DeckExchangeModal';
import { ModalGameProvider, type ModalGameContextValue } from '@/app/shared/contexts/ModalGameContext';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { ZoneContextMenu } from '@/app/shared/components/ZoneContextMenu';
import { LorContextMenu } from '@/app/shared/components/LorContextMenu';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useCardScale } from '@/app/shared/hooks/useCardScale';
import { useCardSounds } from '@/app/shared/hooks/useCardSounds';
import { CardScaleControl } from '@/app/shared/components/CardScaleControl';
import { useModalCardDrag } from '@/app/shared/hooks/useModalCardDrag';
import { useSelectionState, type CardBound } from '../hooks/useSelectionState';
import { MultiCardContextMenu } from '@/app/shared/components/MultiCardContextMenu';
import { TargetCardOverlay } from '@/app/shared/components/TargetCardOverlay';
import { GameActions, TargetingRequest, CountPromptRequest } from '@/app/shared/types/gameActions';
import { CountPromptDialog } from '@/app/shared/components/CountPromptDialog';
import { GameToastContainer, showGameToast } from './GameToast';
import { DiceRollOverlay } from './DiceRollOverlay';
import { useCardPreview } from '../state/CardPreviewContext';
import { useLobArrivalEffect } from '@/app/shared/hooks/useLobArrivalEffect';
import { useLostSoulDeals } from '@/app/shared/hooks/useLostSoulDeals';
import { LostSoulDealLayer, type SoulDeal } from '@/app/shared/components/LostSoulDealLayer';
import { computeDealFlight } from '@/app/shared/utils/lostSoulDeal';
import { useDealAnimation } from '@/app/shared/hooks/useDealAnimation';
import { useHandLayoutTween } from '@/app/shared/hooks/useHandLayoutTween';
import { DealLayer, type DealSpriteSpec } from '@/app/shared/components/DealLayer';
import { useCardEnterPlayPrompt } from '@/app/shared/hooks/useCardEnterPlayPrompt';
import { CardChoicePromptContainer } from '@/app/shared/components/CardChoicePrompt';
import { useRevealTick } from '@/app/shared/hooks/useRevealTick';
import { computeEquipOffset, hitTestWarrior, MAX_EQUIPPED_WEAPONS_PER_WARRIOR } from '../utils/equipLayout';
import { gameCardIsWarrior, gameCardIsWeapon } from '../utils/equipClass';
import { findCard } from '@/lib/cards/lookup';
import { compareCardsDefault } from '@/lib/cards/defaultSort';
import { getEffectiveAbilities, isDanielCard, isLostSoulCard, isHeroCard, lostSoulValue, simplifyLostSoulName } from '@/lib/cards/cardAbilities';
import { ResurrectHeroesModal } from '@/app/shared/components/ResurrectHeroesModal';
import { KeepOneModal } from '@/app/shared/components/KeepOneModal';
import { Link2Off } from 'lucide-react';

import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { SOUL_DECK_BACK_IMG } from '@/app/shared/paragon/soulDeck';
import { actions as gameActionCreators } from '../state/gameActions';

interface GoldfishCanvasProps {
  containerWidth: number;
  containerHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  virtualWidth: number;
  onLoadDeck?: () => void;
  hideBackButton?: boolean;
}

export default function GoldfishCanvas({ containerWidth, containerHeight, scale, offsetX, offsetY, virtualWidth, onLoadDeck, hideBackButton }: GoldfishCanvasProps) {
  const { state, dispatch, drawCard, drawMultiple, moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleCardIntoDeck, shuffleDeck, meekCard, unmeekCard, flipCard, revealCardInHand, addCounter, removeCounter, addNote, addOpponentLostSoul, removeOpponentToken, executeCardAbility, addPlayerLostSoul, reorderHand, attachCard, detachCard } = useGame();
  const { setPreviewCard, isLoupeVisible } = useCardPreview();
  const stageRef = useRef<Konva.Stage>(null);
  const gameLayerRef = useRef<Konva.Layer>(null);

  // ---- Card sound effects (joke easter-egg, once per game) ----
  useCardSounds(state.zones['territory'] ?? [], state.sessionId);

  // ---- LOB arrival glow + Lost Soul "deal" animation ----
  const lobCardIds = useMemo(
    () => (state.zones['land-of-bondage'] ?? []).map(c => c.instanceId),
    [state.zones],
  );
  // Only Lost Souls fly; other LOB arrivals (attached sites) keep the plain glow.
  const lobSoulIds = useMemo(
    () => (state.zones['land-of-bondage'] ?? []).filter(isLostSoulCard).map(c => c.instanceId),
    [state.zones['land-of-bondage']],
  );
  // Deck sources — a soul only flies from the deck if it was there last frame
  // (a draw/route), not dragged in from hand/reserve/territory. `soul-deck`
  // covers the Paragon format.
  const deckSourceIds = useMemo(
    () => [
      ...(state.zones['deck'] ?? []),
      ...(state.zones['soul-deck'] ?? []),
    ].map(c => c.instanceId),
    [state.zones['deck'], state.zones['soul-deck']],
  );
  const { inFlight: soulDeals, onLand: onSoulLand } = useLostSoulDeals(
    lobSoulIds,
    deckSourceIds,
    true,
    (newIds) => {
      if (newIds.length === 1) {
        const c = (state.zones['land-of-bondage'] ?? []).find(x => x.instanceId === newIds[0]);
        showGameToast(`Lost Soul dealt: ${simplifyLostSoulName(c?.cardName ?? 'Lost Soul')}`);
      } else if (newIds.length > 1) {
        showGameToast(`${newIds.length} Lost Souls dealt`);
      }
    },
  );
  // Route the glow to *visible* ids so it fires on landing, not server placement.
  const visibleLobIds = useMemo(
    () => lobCardIds.filter(id => !soulDeals.has(id)),
    [lobCardIds, soulDeals],
  );
  const { getGlowIntensity: getLobGlow } = useLobArrivalEffect(visibleLobIds);

  // ---- "The deal" — flying-card animation when cards move deck → hand ----
  // (Draw button, draw N/bottom, ability draws.) Snapshot is id+zone only;
  // diffing happens inside the hook. sessionId changes on every new game
  // (fresh deck load, New Game), which triggers the fast opening-hand deal.
  const cardZoneSnapshot = useMemo(() => {
    const flat: { id: string; zone: string }[] = [];
    for (const zoneId of Object.keys(state.zones) as ZoneId[]) {
      for (const card of state.zones[zoneId]) flat.push({ id: card.instanceId, zone: zoneId });
    }
    return flat;
  }, [state.zones]);
  const {
    deals: activeDeals,
    dealingIds,
    glowIds: dealGlowIds,
    completeDeal,
  } = useDealAnimation(cardZoneSnapshot, true, state.sessionId);

  // Drive 1s re-renders while any visible card has an active per-card reveal —
  // hand (30s flash) or reserve top (10s from Herod's Temple). Needed for the
  // countdown badge to tick and the auto-expiry flip-back to render.
  const handHasActiveReveal = useMemo(() => {
    const hasReveal = (cards: typeof state.zones.hand) =>
      cards.some(c => typeof c.revealUntil === 'number' && c.revealUntil > Date.now());
    return hasReveal(state.zones.hand ?? []) || hasReveal(state.zones.reserve ?? []);
  }, [state.zones.hand, state.zones.reserve]);
  useRevealTick(handHasActiveReveal);

  const handBrigadeCounts = useMemo(
    () => computeHandBrigades(state.zones.hand ?? []),
    [state.zones.hand],
  );

  // ---- Three Woes "Choose Good / Choose Evil" prompt on hand → play ----
  // Generic over any card with `set_card_outline` abilities; the prompt
  // routes the click through executeCardAbility so the same registry-driven
  // flow that powers the right-click menu fires the outline tint.
  const cardsForChoicePrompt = useMemo(() => {
    const list: { instanceId: string; cardName: string; zone: string }[] = [];
    for (const zoneId of Object.keys(state.zones) as ZoneId[]) {
      for (const card of state.zones[zoneId]) {
        if (card.ownerId !== 'player1') continue;
        if (card.isToken) continue;
        list.push({ instanceId: card.instanceId, cardName: card.cardName, zone: card.zone });
      }
    }
    return list;
  }, [state.zones]);
  useCardEnterPlayPrompt({
    cards: cardsForChoicePrompt,
    onChoose: executeCardAbility,
  });

  // Targeting state — set by CardContextMenu when the player picks an
  // ability that needs a follow-up card click (e.g. `imitate_lost_soul`).
  // The canvas dims ineligible cards and routes the next eligible click
  // through `onSelect`. Cleared by Esc, the banner's Cancel button, or any
  // eligible card click.
  const [targeting, setTargeting] = useState<TargetingRequest | null>(null);
  const [countPrompt, setCountPrompt] = useState<CountPromptRequest | null>(null);
  const [resurrectReq, setResurrectReq] = useState<{ sourceInstanceId: string; abilityIndex: number } | null>(null);
  const [keepOneReq, setKeepOneReq] = useState<{ sourceInstanceId: string; abilityIndex: number } | null>(null);

  // Opens the "look at / reveal top N" peek modal for an own-deck inspection
  // ability. Shared by the fixed-count path (look_at_own_deck / reveal_own_deck)
  // and the player-chosen-count path (look_at_own_deck_choose). requestedCount is
  // clamped to the deck size here; the choose path caps it to the ability limit
  // before calling. setPeekState is a stable useState setter — intentionally
  // omitted from the deps to avoid a TDZ access (it's declared further down).
  const openOwnDeckPeek = useCallback(
    (position: 'top' | 'bottom' | 'random', requestedCount: number, source: GameCard | undefined) => {
      const deck = state.zones.deck;
      if (deck.length === 0) { showGameToast('Deck is empty'); return; }
      const n = Math.min(requestedCount, deck.length);
      let ids: string[];
      let title: string;
      if (position === 'top') {
        ids = deck.slice(0, n).map(c => c.instanceId);
        title = `Top ${n} of Deck`;
      } else if (position === 'bottom') {
        ids = deck.slice(-n).map(c => c.instanceId);
        title = `Bottom ${n} of Deck`;
      } else {
        const shuffled = [...deck];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        ids = shuffled.slice(0, n).map(c => c.instanceId);
        title = `Random ${n} from Deck`;
      }
      // (Star) abilities fired from hand — flash the source card so the implicit
      // "reveal from hand" cost is visible (parity with multiplayer behavior).
      if (source && source.zone === 'hand') revealCardInHand(source.instanceId);
      setPeekState({ cardIds: ids, title });
    },
    [state.zones, revealCardInHand],
  );

  // Adapter: bridge goldfish game context to shared GameActions interface
  const goldfishActions: GameActions = useMemo(() => ({
    moveCard: (cardId, toZone, posX, posY) => moveCard(cardId, toZone as ZoneId, undefined, posX !== undefined ? Number(posX) : undefined, posY !== undefined ? Number(posY) : undefined),
    moveCardsBatch: (cardIds, toZone) => moveCardsBatch(cardIds, toZone as ZoneId),
    flipCard: (cardId) => flipCard(cardId),
    revealCardInHand: (cardId) => revealCardInHand(cardId),
    meekCard: (cardId) => meekCard(cardId),
    unmeekCard: (cardId) => unmeekCard(cardId),
    addCounter: (cardId, color) => addCounter(cardId, color as any),
    removeCounter: (cardId, color) => removeCounter(cardId, color as any),
    shuffleCardIntoDeck: (cardId) => shuffleCardIntoDeck(cardId),
    shuffleDeck: () => shuffleDeck(),
    setNote: (cardId, text) => addNote(cardId, text),
    exchangeCards: () => { /* handled via onExchange callback */ },
    drawCard: () => drawCard(),
    drawMultiple: (count) => drawMultiple(count),
    moveCardToTopOfDeck: (cardId) => moveCardToTopOfDeck(cardId),
    moveCardToBottomOfDeck: (cardId) => moveCardToBottomOfDeck(cardId),
    removeOpponentToken: (cardId) => removeOpponentToken(cardId),
    executeCardAbility: (cardId, abilityIndex) => {
      // Intercept modal-driven abilities (reveal_own_deck) — the goldfish
      // reducer no-ops them; the modal lives in component state.
      let source: GameCard | undefined;
      for (const zone of Object.values(state.zones)) {
        const found = zone.find(c => c.instanceId === cardId);
        if (found) { source = found; break; }
      }
      const ability = source ? getEffectiveAbilities(source)[abilityIndex] : undefined;
      if (ability?.type === 'reveal_own_deck' || ability?.type === 'look_at_own_deck') {
        openOwnDeckPeek(ability.position, ability.count, source);
        return;
      }
      // Non-modal abilities fired from hand still flash the source so the
      // user can verify what they activated (e.g. Delivered's STAR).
      if (source && source.zone === 'hand' && ability) revealCardInHand(cardId);
      executeCardAbility(cardId, abilityIndex);
    },
    randomHandToZone: () => {}, // not used in goldfish
    randomReserveToZone: () => {}, // not used in goldfish
    reloadDeck: () => {}, // not used in goldfish
    imitateLostSoul: (sourceInstanceId, targetInstanceId) => {
      dispatch(gameActionCreators.imitateLostSoul(sourceInstanceId, targetInstanceId));
    },
    stopImitatingLostSoul: (sourceInstanceId) => {
      dispatch(gameActionCreators.stopImitatingLostSoul(sourceInstanceId));
    },
    beginTargeting: (req) => setTargeting(req),
    executeCardAbilityWithCount: (cardId, abilityIndex, count) => {
      // look_at_own_deck_choose is modal-driven client-side (like look_at_own_deck) —
      // open the peek modal with the player-chosen count (capped at the ability
      // limit) instead of routing the count through the reducer.
      let source: GameCard | undefined;
      for (const zone of Object.values(state.zones)) {
        const found = zone.find(c => c.instanceId === cardId);
        if (found) { source = found; break; }
      }
      const ability = source ? getEffectiveAbilities(source)[abilityIndex] : undefined;
      if (ability?.type === 'look_at_own_deck_choose' || ability?.type === 'reveal_own_deck_choose') {
        // Goldfish is single-player, so look and reveal collapse to the same
        // modal — matching how the fixed-count pair is handled above.
        openOwnDeckPeek(ability.position, Math.min(count, ability.maxCount), source);
        return;
      }
      if (
        ability?.type === 'look_at_opponent_deck_choose'
        || ability?.type === 'reveal_opponent_deck_choose'
        || ability?.type === 'discard_opponent_deck_choose'
      ) {
        // No opponent in goldfish — same no-op as the fixed-count opponent
        // abilities in gameReducer's ability switch.
        return;
      }
      dispatch(gameActionCreators.executeCardAbilityWithCount(cardId, abilityIndex, count));
    },
    beginCountPrompt: (req) => setCountPrompt(req),
    beginResurrectPrompt: (sourceInstanceId, abilityIndex) => setResurrectReq({ sourceInstanceId, abilityIndex }),
    beginKeepOnePrompt: (sourceInstanceId, abilityIndex) => setKeepOneReq({ sourceInstanceId, abilityIndex }),
  }), [moveCard, moveCardsBatch, flipCard, revealCardInHand, meekCard, unmeekCard, addCounter, removeCounter, shuffleCardIntoDeck, shuffleDeck, addNote, drawCard, drawMultiple, moveCardToTopOfDeck, moveCardToBottomOfDeck, removeOpponentToken, executeCardAbility, openOwnDeckPeek, state.zones, dispatch]);

  // Bridge goldfish game state into the shared ModalGameContext for shared modal components
  const modalGameValue = useMemo<ModalGameContextValue>(() => ({
    zones: state.zones,
    actions: {
      moveCard,
      moveCardsBatch,
      moveCardToTopOfDeck,
      moveCardToBottomOfDeck,
      shuffleDeck,
      shuffleCardIntoDeck,
      logDeckSearchNoShuffle: ({ topCount, bottomCount }) => {
        const parts: string[] = [];
        if (topCount > 0) parts.push(`${topCount} on top`);
        if (bottomCount > 0) parts.push(`${bottomCount} on bottom`);
        const msg = parts.length > 0
          ? `Stacked ${parts.join(' & ')} — deck NOT shuffled`
          : 'Searched deck — NOT shuffled';
        showGameToast(msg);
      },
    },
  }), [state.zones, moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleDeck, shuffleCardIntoDeck]);

  // Prevent browser-native drag on the canvas container.
  // Without this, the browser can hijack card drags (especially multi-select)
  // and show a ghosted overlay of the page instead of the Konva drag behavior.
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

  // Use ref for image cache to avoid re-renders on every image load.
  // A version counter triggers a single re-render when images finish loading.
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const pendingLoads = useRef(0);
  const [imageVersion, setImageVersion] = useState(0);

  // Re-render once cardback image finishes loading
  useEffect(() => {
    if (cardBackLoaded) return;
    const onLoad = () => setImageVersion(v => v + 1);
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
    if (state.format !== 'Paragon') return;
    if (soulDeckBackRef.current) return;
    const img = new window.Image();
    img.onload = () => {
      soulDeckBackRef.current = img;
      setSoulDeckBackReady(true);
    };
    img.src = SOUL_DECK_BACK_IMG;
  }, [state.format]);

  const [contextMenu, setContextMenu] = useState<{
    card: GameCard;
    x: number;
    y: number;
  } | null>(null);
  const [hoverCard, setHoverCard] = useState<{
    card: GameCard;
    x: number;
    y: number;
  } | null>(null);
  const [hoveredInstanceId, setHoveredInstanceId] = useState<string | null>(null);
  const [hoverProgress, setHoverProgress] = useState(0);
  const hoverAnimFrameRef = useRef<number | null>(null);
  const hoverStartTimeRef = useRef<number | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);
  const dragSourceZoneRef = useRef<ZoneId | null>(null);
  const [browseZone, setBrowseZone] = useState<ZoneId | null>(null);
  // Goldfish only ever bound `contextmenu`, so on a phone there was no path to
  // any card menu, pile browse, shuffle or flip — the whole action layer was
  // mouse-only. Touch gets the same long-press adapter multiplayer uses.
  const isTouch = useInputMode() === 'touch';
  const dragCancelledRef = useRef(false);

  // Keep hover preview in sync with game state (e.g. when meekifying a hovered card)
  useEffect(() => {
    if (!hoverCard) return;
    const allCards = Object.values(state.zones).flat();
    const updated = allCards.find((c) => c.instanceId === hoverCard.card.instanceId);
    if (updated && updated !== hoverCard.card) {
      setHoverCard((prev) => prev ? { ...prev, card: updated } : null);
    } else if (!updated) {
      setHoverCard(null);
    }
  }, [state.zones, hoverCard?.card.instanceId]);

  // Warm up the imitate-souls art cache once an Imitate Lost Soul exists
  // anywhere on the board. Avoids a 1s placeholder flash when the player
  // actually triggers the swap. preloadImitateSouls is idempotent.
  useEffect(() => {
    const hasImitate = Object.values(state.zones)
      .flat()
      .some(c => c.cardName.startsWith('Lost Soul "Imitate"'));
    if (hasImitate) preloadImitateSouls();
  }, [state.zones]);
  const [showDeckSearch, setShowDeckSearch] = useState(false);
  const [deckMenu, setDeckMenu] = useState<{ x: number; y: number } | null>(null);
  const [soulDeckMenu, setSoulDeckMenu] = useState<{ x: number; y: number } | null>(null);
  const [browseSoulDeck, setBrowseSoulDeck] = useState(false);
  const [peekState, setPeekState] = useState<{ cardIds: string[]; title: string; sourceZone?: ZoneId } | null>(null);
  const [lookState, setLookState] = useState<{ cardIds: string[]; title: string; sourceZone?: ZoneId } | null>(null);
  const [deckDropPopup, setDeckDropPopup] = useState<{ cardInstanceId: string; x: number; y: number } | null>(null);
  const [soulDeckDropPopup, setSoulDeckDropPopup] = useState<{ cardInstanceId: string; batchIds?: string[]; x: number; y: number } | null>(null);
  const [canvasDragZone, setCanvasDragZone] = useState<ZoneId | null>(null);
  const isCanvasDragging = useRef(false);
  // Set of card instanceIds currently being dragged (drag card + followers).
  // Used to hide a specific unlink icon only when its warrior or weapon is
  // part of the active drag — the HTML overlay reads from state, which lags
  // behind the dragged Konva node, so the icon would visibly drift otherwise.
  const [draggingCardIds, setDraggingCardIds] = useState<ReadonlySet<string>>(() => new Set());
  // Tracks the source zone of an active drag. Used to disable clipping ONLY
  // for that zone so a card dragged out of a clipped zone (territory,
  // land-of-bondage) isn't visually cut off — without exposing previously
  // clipped siblings (e.g. tall Lost Soul cards in the short LoB rect) in
  // unrelated zones.
  const [dragSourceZone, setDragSourceZone] = useState<ZoneId | null>(null);
  const [multiCardContextMenu, setMultiCardContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [batchDeckDropIds, setBatchDeckDropIds] = useState<string[] | null>(null);
  const [exchangeCardIds, setExchangeCardIds] = useState<string[] | null>(null);
  const exchangeCardIdsRef = useRef<string[] | null>(null);
  useEffect(() => {
    exchangeCardIdsRef.current = exchangeCardIds;
  }, [exchangeCardIds]);

  const [zoneMenu, setZoneMenu] = useState<{ x: number; y: number; spawnX: number; spawnY: number } | null>(null);
  const [lorMenu, setLorMenu] = useState<{ x: number; y: number } | null>(null);
  const [cardRenderKey, setCardRenderKey] = useState(0);

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

  // Card node ref map for imperative multi-card drag
  const cardNodeRefs = useRef<Map<string, Konva.Group>>(new Map());
  const registerCardNode = useCallback((instanceId: string, node: Konva.Group | null) => {
    if (node) {
      cardNodeRefs.current.set(instanceId, node);
    } else {
      cardNodeRefs.current.delete(instanceId);
    }
  }, []);
  // Offsets of follower cards relative to the dragged card during group drag
  const dragFollowerOffsets = useRef<Map<string, { dx: number; dy: number }> | null>(null);
  // Ghost image for multi-card drag — a single rasterized snapshot of all followers
  const dragGhostRef = useRef<Konva.Image | null>(null);
  const dragGhostLayerRef = useRef<Konva.Layer | null>(null);
  // Drag-start position of the leader card so we can snap it back if the drop
  // opens a popup (deck/soul-deck) instead of moving the card immediately.
  const dragStartPositionRef = useRef<{ instanceId: string; x: number; y: number } | null>(null);

  // Card left sitting on the deck pile while a deck-drop popup is open —
  // committing an option unmounts it into the deck; canceling glides it home.
  // For group drags, `group` holds the claimed ghost stack + hidden followers.
  const deckDropHoldRef = useRef<{
    instanceId: string;
    homeX: number;
    homeY: number;
    group?: {
      ghost: Konva.Image | null;
      ghostHomeX: number | null;
      ghostHomeY: number | null;
      followerIds: string[];
    };
  } | null>(null);
  // Deferred group-drag settle (destroy ghost, re-show followers). Scheduled
  // as a microtask at drag end; a deck-pile drop claims it within the same
  // tick so the ghost stack can wait on the pile instead.
  const pendingGroupSettleRef = useRef<(() => void) | null>(null);
  const releaseDeckHold = useCallback((glideHome: boolean) => {
    const hold = deckDropHoldRef.current;
    deckDropHoldRef.current = null;
    if (!hold) return;
    const group = hold.group;
    const settleGroup = () => {
      if (!group) return;
      if (group.ghost) {
        group.ghost.destroy();
        dragGhostLayerRef.current?.batchDraw();
      }
      // On commit the follower rows move into the deck and their hidden
      // nodes unmount with the state change — only a cancel re-shows them.
      if (glideHome) {
        for (const id of group.followerIds) {
          const fNode = cardNodeRefs.current.get(id);
          if (fNode) fNode.visible(true);
        }
      }
    };
    if (!glideHome) {
      settleGroup();
      return;
    }
    const node = cardNodeRefs.current.get(hold.instanceId);
    if (node && node.getStage()) {
      new KonvaLib.Tween({
        node,
        duration: 0.2,
        x: hold.homeX,
        y: hold.homeY,
        easing: KonvaLib.Easings.EaseOut,
      }).play();
    }
    if (group?.ghost && group.ghostHomeX != null && group.ghostHomeY != null && group.ghost.getStage()) {
      new KonvaLib.Tween({
        node: group.ghost,
        duration: 0.2,
        x: group.ghostHomeX,
        y: group.ghostHomeY,
        easing: KonvaLib.Easings.EaseOut,
        onFinish: settleGroup,
      }).play();
    } else {
      settleGroup();
    }
  }, []);

  // Selection state
  const {
    selectedIds, isSelectingRef, onRectChangeRef,
    startSelectionDrag, updateSelectionDrag, endSelectionDrag,
    toggleSelect, clearSelection,
  } = useSelectionState();
  const selectionRectRef = useRef<Konva.Rect | null>(null);
  const selectionLayerRef = useRef<Konva.Layer | null>(null);
  // Wire up imperative rect updates
  onRectChangeRef.current = useCallback((rect: { startX: number; startY: number; currentX: number; currentY: number } | null) => {
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
    // Don't show the selection rectangle until it's large enough to be intentional
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
  }, []);

  const { cardScale, zoomIn, zoomOut, resetScale, MIN_SCALE, MAX_SCALE, STEP, setCardScale } = useCardScale();
  useKeyboardShortcuts({ onZoomIn: zoomIn, onZoomOut: zoomOut });

  const zoneLayout = useMemo(
    () => calculateZoneLayout(virtualWidth, VIRTUAL_HEIGHT, scale, state.format),
    [virtualWidth, scale, state.format],
  );
  const cardWidth = Math.round(CARD_WIDTH * cardScale);
  const cardHeight = Math.round(CARD_HEIGHT * cardScale);
  // Sidebar pile cards are capped to fit within the sidebar zone height
  const sidebarZoneHeight = zoneLayout['deck']?.height ?? 0;
  const maxSidebarCardHeight = sidebarZoneHeight - 28; // room for label + padding
  const sidebarCardHeight = Math.min(cardHeight, maxSidebarCardHeight);
  const sidebarCardWidth = Math.round(sidebarCardHeight / CARD_ASPECT_RATIO);
  // Land of Bondage cards are capped to fit within the short LOB strip. Lost
  // Souls are full-height cards; without this cap they render cropped by the
  // zone clip. Mirrors the multiplayer layout's lobCard sizing (85% of zone).
  const lobZoneHeight = zoneLayout['land-of-bondage']?.height ?? 0;
  const lobCardHeight = lobZoneHeight > 0
    ? Math.min(cardHeight, Math.round(lobZoneHeight * 0.85))
    : cardHeight;
  const lobCardWidth = Math.round(lobCardHeight / CARD_ASPECT_RATIO);
  // Virtual canvas is always 16:9 — no need to rotate sidebar piles
  const rotateSidebarPiles = false;

  // Escape key clears selection
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedIds.size > 0) {
        clearSelection();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [selectedIds.size, clearSelection]);

  // Load images into ref — batch the version bump
  useEffect(() => {
    const cache = imageCacheRef.current;
    const allCards = Object.values(state.zones).flat();
    const urlsToLoad: string[] = [];

    for (const card of allCards) {
      if (card.cardImgFile) {
        const url = getCardImageUrl(card.cardImgFile);
        if (!cache.has(url)) {
          urlsToLoad.push(url);
        }
      }
    }

    if (urlsToLoad.length === 0) return;

    // Deduplicate
    const uniqueUrls = [...new Set(urlsToLoad)];
    pendingLoads.current += uniqueUrls.length;

    for (const url of uniqueUrls) {
      // Mark as loading (set to a placeholder so we don't re-request)
      cache.set(url, null as any);
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        cache.set(url, img);
        pendingLoads.current--;
        // Batch: only bump version when all pending loads finish
        if (pendingLoads.current <= 0) {
          pendingLoads.current = 0;
          setImageVersion(v => v + 1);
        }
      };
      img.onerror = () => {
        cache.delete(url);
        pendingLoads.current--;
        if (pendingLoads.current <= 0) {
          pendingLoads.current = 0;
          setImageVersion(v => v + 1);
        }
      };
      img.src = url;
    }
  }, [state.zones]); // No imageCache dependency — prevents cascade

  // Zone hit-test for drag and drop — check smaller sidebar zones first
  // so they aren't swallowed by larger overlapping zones like territory.
  const ZONE_HIT_ORDER: ZoneId[] = useMemo(() => [
    // Sidebar zones first (small, precise targets)
    'land-of-redemption', 'banish', 'reserve', 'deck', 'discard',
    // Soul deck pile (Paragon only, narrow column inside land-of-bondage)
    'soul-deck',
    // Then main area zones
    'land-of-bondage', 'territory', 'hand',
  ], []);

  const findZoneAtPosition = useCallback(
    (x: number, y: number): ZoneId | null => {
      for (const zoneId of ZONE_HIT_ORDER) {
        const rect = zoneLayout[zoneId];
        if (!rect) continue;
        if (
          x >= rect.x &&
          x <= rect.x + rect.width &&
          y >= rect.y &&
          y <= rect.y + rect.height
        ) {
          return zoneId;
        }
      }
      return null;
    },
    [zoneLayout, ZONE_HIT_ORDER]
  );

  // Shared handler: when a card is dropped on the deck zone, show popup
  const handleDeckDrop = useCallback((cardInstanceId: string, screenX: number, screenY: number) => {
    // Suppress the deck-drop popup while an exchange is already in progress.
    // Dropping deck→deck during exchange is treated as "cancel this drag attempt";
    // Task 1 already ensures validDropRef stays false for deck targets, so the
    // exchange modal will not complete either.
    if (exchangeCardIdsRef.current) return;
    // Tokens dragged onto deck are silently removed
    const allCards = Object.values(state.zones).flat();
    const card = allCards.find(c => c.instanceId === cardInstanceId);
    if (card?.isToken) {
      removeOpponentToken(cardInstanceId);
      return;
    }
    setDeckDropPopup({ cardInstanceId, x: screenX, y: screenY });
  }, [state.zones, removeOpponentToken]);

  // Batch deck drop handler for multi-card modal drags
  const handleBatchDeckDrop = useCallback((cardInstanceIds: string[]) => {
    if (exchangeCardIdsRef.current) return;
    setBatchDeckDropIds(cardInstanceIds);
  }, []);

  // Modal card drag (drag from search/peek/browse modals to canvas zones)
  const {
    dragState: modalDrag,
    startDrag: modalStartDrag,
    startMultiDrag: modalStartMultiDrag,
    hoveredZone: modalHoveredZone,
    ghostRef: modalGhostRef,
    didDragRef: modalDidDragRef,
    validDropRef: modalValidDropRef,
  } = useModalCardDrag({
    stageRef,
    zoneLayout,
    findZoneAtPosition,
    moveCard,
    moveCardsBatch,
    onDeckDrop: handleDeckDrop,
    onBatchDeckDrop: handleBatchDeckDrop,
    cardWidth,
    cardHeight,
    scale,
    offsetX,
    offsetY,
  });

  // Clear hover state and mark dragging on drag start
  const handleCardDragStart = useCallback((card: GameCard) => {
    isDraggingRef.current = true;
    isCanvasDragging.current = true;
    setDragSourceZone(card.zone);
    dragSourceZoneRef.current = card.zone;

    // Bring the dragged card to the front of its parent group so it draws
    // above sibling cards mid-drag. Without this, cards rendered later in
    // the same parent (right-side hand fan, overlapping territory cards)
    // visually obscure the dragged node until drop triggers a re-render.
    const dragLeaderNode = cardNodeRefs.current.get(card.instanceId);
    dragLeaderNode?.moveToTop();
    dragLeaderNode?.getLayer()?.batchDraw();
    if (dragLeaderNode) {
      dragStartPositionRef.current = {
        instanceId: card.instanceId,
        x: dragLeaderNode.x(),
        y: dragLeaderNode.y(),
      };
    }

    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverCard(null);
    setHoveredInstanceId(null);
    stopHoverAnimation();

    // Multi-card drag: build a single rasterized ghost of all follower cards
    // Follower set: multi-select takes precedence; else attached weapons in territory.
    const multiSelectFollowerIds: string[] = (selectedIds.has(card.instanceId) && selectedIds.size > 1)
      ? Array.from(selectedIds).filter(id => id !== card.instanceId)
      : [];
    const equipFollowerIds: string[] = card.zone === 'territory'
      ? state.zones.territory.filter(c => c.equippedTo === card.instanceId).map(c => c.instanceId)
      : [];
    const followerIds = multiSelectFollowerIds.length > 0
      ? multiSelectFollowerIds
      : equipFollowerIds;
    setDraggingCardIds(new Set([card.instanceId, ...followerIds]));

    if (followerIds.length > 0) {
      const dragNode = cardNodeRefs.current.get(card.instanceId);
      if (dragNode) {
        const offsets = new Map<string, { dx: number; dy: number }>();
        const baseX = dragNode.x();
        const baseY = dragNode.y();

        // Collect follower nodes and compute offsets
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

        // Rasterize followers into a single ghost image
        if (followers.length > 0) {
          // Compute bounding box of all followers relative to the drag card
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const f of followers) {
            minX = Math.min(minX, f.dx);
            minY = Math.min(minY, f.dy);
            maxX = Math.max(maxX, f.dx + cardWidth);
            maxY = Math.max(maxY, f.dy + cardHeight);
          }
          const ghostW = maxX - minX;
          const ghostH = maxY - minY;

          // Draw all followers onto an offscreen canvas
          const offscreen = document.createElement('canvas');
          offscreen.width = ghostW * 2;  // 2x for sharpness
          offscreen.height = ghostH * 2;
          const ctx = offscreen.getContext('2d');
          if (ctx) {
            ctx.scale(2, 2);
            ctx.globalAlpha = 0.5;
            for (const f of followers) {
              // Don't pass x/y — let Konva use getClientRect() defaults
              // so the card renders correctly regardless of its absolute position
              const cardCanvas = f.node.toCanvas({ pixelRatio: 1 });
              ctx.drawImage(cardCanvas, f.dx - minX, f.dy - minY, cardWidth, cardHeight);
            }

            // Create a Konva.Image from the offscreen canvas
            const ghostImage = new KonvaLib.Image({
              image: offscreen,
              x: baseX + minX,
              y: baseY + minY,
              width: ghostW,
              height: ghostH,
              listening: false,
              opacity: 1,
            }) as Konva.Image;

            // Add to a dedicated ghost layer (scaled to match game layer)
            const stage = stageRef.current;
            if (stage) {
              let ghostLayer = dragGhostLayerRef.current;
              if (!ghostLayer) {
                ghostLayer = new KonvaLib.Layer({ listening: false }) as Konva.Layer;
                dragGhostLayerRef.current = ghostLayer;
                stage.add(ghostLayer);
              }
              // Match the game layer's transform so ghost aligns with cards
              ghostLayer.scaleX(scale);
              ghostLayer.scaleY(scale);
              ghostLayer.x(offsetX);
              ghostLayer.y(offsetY);
              ghostLayer.add(ghostImage);
              ghostLayer.moveToTop();
              ghostLayer.batchDraw();
              dragGhostRef.current = ghostImage;
            }

            // Hide the real follower nodes
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
  }, [selectedIds, cardWidth, cardHeight, scale, offsetX, offsetY, state.zones.territory]);

  const canvasDragZoneRef = useRef<ZoneId | null>(null);
  // Track the ghost's offset from the drag card origin for repositioning
  const dragGhostOffsetRef = useRef<{ dx: number; dy: number } | null>(null);
  const handleCardDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;

      // Clamp card position to virtual canvas bounds
      const clampedX = Math.max(-cardWidth / 2, Math.min(node.x(), virtualWidth - cardWidth / 2));
      const clampedY = Math.max(-cardHeight / 2, Math.min(node.y(), VIRTUAL_HEIGHT - cardHeight / 2));
      if (clampedX !== node.x() || clampedY !== node.y()) {
        node.x(clampedX);
        node.y(clampedY);
      }

      const x = node.x();
      const y = node.y();
      const centerX = x + cardWidth / 2;
      const centerY = y + cardHeight / 2;
      const zone = findZoneAtPosition(centerX, centerY);
      // Only trigger a re-render when the hovered zone actually changes
      if (zone !== canvasDragZoneRef.current) {
        canvasDragZoneRef.current = zone;
        setCanvasDragZone(zone);
      }

      // Multi-card drag: move the single ghost image (one node, not N)
      const ghost = dragGhostRef.current;
      if (ghost) {
        // On first move, compute the ghost's offset relative to the drag card
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
    [findZoneAtPosition, cardWidth, cardHeight]
  );

  const handleCardDragEnd = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<DragEvent>) => {
      // A long-press that opened a menu ends the drag it interrupted. Snap the
      // node home instead of committing a move the player never aimed.
      if (dragCancelledRef.current) {
        dragCancelledRef.current = false;
        isDraggingRef.current = false;
        isCanvasDragging.current = false;
        setDraggingCardIds(new Set());
        canvasDragZoneRef.current = null;
        dragSourceZoneRef.current = null;
        dragFollowerOffsets.current = null;
        dragGhostOffsetRef.current = null;
        const start = dragStartPositionRef.current;
        dragStartPositionRef.current = null;
        setCanvasDragZone(null);
        setDragSourceZone(null);
        if (start) {
          e.target.position({ x: start.x, y: start.y });
          e.target.getLayer()?.batchDraw();
        }
        return;
      }
      // Capture follower offsets before clearing
      const followerOffsets = dragFollowerOffsets.current;
      isDraggingRef.current = false;
      isCanvasDragging.current = false;
      setDraggingCardIds(new Set());
      canvasDragZoneRef.current = null;
      dragSourceZoneRef.current = null;
      dragFollowerOffsets.current = null;
      const ghostOffset = dragGhostOffsetRef.current;
      dragGhostOffsetRef.current = null;
      const dragStartPosition = dragStartPositionRef.current;
      dragStartPositionRef.current = null;
      setCanvasDragZone(null);
      setDragSourceZone(null);

      // Group-drag visuals (ghost + hidden followers): normally settled
      // immediately, but a drop onto a deck pile claims them within this
      // tick (deckDropHoldRef) so the stack waits on the pile while the
      // popup is open.
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

      // Equip: if a weapon is dropped on top of a warrior in territory, attach.
      // Runs only for single-card drags (group drags are intentional batch moves).
      const isGroupDragForEquip = selectedIds.has(card.instanceId) && selectedIds.size > 1;
      if (!isGroupDragForEquip) {
        if (gameCardIsWeapon(card)) {
          const dropNode = e.target;
          const dropCenterX = dropNode.x() + cardWidth / 2;
          const dropCenterY = dropNode.y() + cardHeight / 2;
          const targetZoneForEquip = findZoneAtPosition(dropCenterX, dropCenterY);
          if (targetZoneForEquip === 'territory') {
            // Candidates: territory cards that are themselves warriors, not already
            // attached to someone else, not the card being dragged, and not yet at the cap.
            const warriorCandidates = state.zones.territory.filter(c => {
              if (c.instanceId === card.instanceId) return false;
              if (c.equippedTo) return false; // a weapon attached to someone else isn't a valid target
              if (!gameCardIsWarrior(c)) return false;
              const attached = state.zones.territory.filter(x => x.equippedTo === c.instanceId);
              return attached.length < MAX_EQUIPPED_WEAPONS_PER_WARRIOR;
            });
            const hit = hitTestWarrior(
              dropCenterX, dropCenterY, cardWidth, cardHeight, warriorCandidates, card.instanceId,
            );
            if (hit) {
              // Consume the drop: attach instead of continuing into the move path.
              attachCard(card.instanceId, hit.instanceId);
              return;
            }
          }
        }
      }

      const node = e.target;
      const dropX = node.x();
      const dropY = node.y();
      // Use card center for hit-testing so drops near zone edges work intuitively
      const centerX = dropX + cardWidth / 2;
      const centerY = dropY + cardHeight / 2;
      const targetZone = findZoneAtPosition(centerX, centerY);

      // Group drag: multi-select takes precedence; else attached weapons travel with warrior.
      const multiSelectFollowerIds = selectedIds.has(card.instanceId) && selectedIds.size > 1
        ? Array.from(selectedIds)
        : null;
      const equipFollowerIds = card.zone === 'territory'
        ? state.zones.territory
            .filter(c => c.equippedTo === card.instanceId)
            .map(c => c.instanceId)
        : [];
      const isGroupDrag = multiSelectFollowerIds !== null || equipFollowerIds.length > 0;
      const cardIds = multiSelectFollowerIds ?? [card.instanceId, ...equipFollowerIds];

      // Hand-to-hand reorder: when a hand card is dropped back on the hand zone
      if (targetZone === 'hand' && card.zone === 'hand' && state.zones.hand.length > 1) {
        // Calculate current hand positions to find the closest slot to the drop point
        const currentHandPositions = calculateHandPositions(
          state.zones.hand.length, virtualWidth, VIRTUAL_HEIGHT, state.isSpreadHand, cardWidth, cardHeight
        );
        let targetIdx = 0;
        let minDist = Infinity;
        for (let i = 0; i < currentHandPositions.length; i++) {
          const dist = Math.abs(currentHandPositions[i].x + cardWidth / 2 - centerX);
          if (dist < minDist) {
            minDist = dist;
            targetIdx = i;
          }
        }
        const currentIdx = state.zones.hand.findIndex(c => c.instanceId === card.instanceId);
        if (currentIdx !== -1 && currentIdx !== targetIdx) {
          const newOrder = [...state.zones.hand];
          const [dragged] = newOrder.splice(currentIdx, 1);
          newOrder.splice(targetIdx, 0, dragged);
          reorderHand(newOrder.map(c => c.instanceId));
        }
      } else if (targetZone === 'land-of-bondage' && card.zone === 'land-of-bondage') {
        // LOB-to-LOB: snap back to auto-arranged position
        const lobZone = zoneLayout['land-of-bondage'];
        if (lobZone) {
          const lobPositions = calculateAutoArrangePositions(
            state.zones['land-of-bondage'].length, lobZone, lobCardWidth, lobCardHeight
          );
          const idx = state.zones['land-of-bondage'].findIndex(c => c.instanceId === card.instanceId);
          if (idx !== -1 && lobPositions[idx]) {
            node.x(lobPositions[idx].x);
            node.y(lobPositions[idx].y);
          }
        }
        node.getLayer()?.batchDraw();
      } else if (targetZone === 'deck' && card.zone !== 'deck') {
        // Snap the card back to its drag-start position so it doesn't sit at
        // the deck position while the popup is open. If the user picks an
        // action, moveCard runs and the card animates from the source zone;
        // if they cancel, the card glides back home.
        // Leave the card sitting where it was dropped (on the pile) while the
        // popup is open — committing an option moves it into the deck;
        // canceling glides it back to its drag-start position.
        if (dragStartPosition?.instanceId === card.instanceId) {
          let group: NonNullable<typeof deckDropHoldRef.current>['group'];
          if (pendingGroupSettleRef.current) {
            pendingGroupSettleRef.current = null; // claim — the settle microtask no-ops
            group = {
              ghost: heldGhost,
              ghostHomeX: ghostOffset ? dragStartPosition.x + ghostOffset.dx : null,
              ghostHomeY: ghostOffset ? dragStartPosition.y + ghostOffset.dy : null,
              followerIds: heldFollowerIds,
            };
          }
          deckDropHoldRef.current = {
            instanceId: card.instanceId,
            homeX: dragStartPosition.x,
            homeY: dragStartPosition.y,
            group,
          };
        }
        const stage = stageRef.current;
        if (stage) {
          const rect = stage.container().getBoundingClientRect();
          if (isGroupDrag) {
            setBatchDeckDropIds(cardIds);
          }
          const screenPos = virtualToScreen(centerX, centerY, scale, offsetX, offsetY);
          handleDeckDrop(card.instanceId, rect.left + screenPos.x, rect.top + screenPos.y);
        }
      } else if (targetZone === 'soul-deck' && card.zone !== 'soul-deck') {
        // Paragon: dropping on the soul deck pile opens a top/bottom/shuffle popup.
        // The card waits on the pile; a canceled popup glides it home.
        if (dragStartPosition?.instanceId === card.instanceId) {
          let group: NonNullable<typeof deckDropHoldRef.current>['group'];
          if (pendingGroupSettleRef.current) {
            pendingGroupSettleRef.current = null; // claim — the settle microtask no-ops
            group = {
              ghost: heldGhost,
              ghostHomeX: ghostOffset ? dragStartPosition.x + ghostOffset.dx : null,
              ghostHomeY: ghostOffset ? dragStartPosition.y + ghostOffset.dy : null,
              followerIds: heldFollowerIds,
            };
          }
          deckDropHoldRef.current = {
            instanceId: card.instanceId,
            homeX: dragStartPosition.x,
            homeY: dragStartPosition.y,
            group,
          };
        }
        const stage = stageRef.current;
        if (stage) {
          const rect = stage.container().getBoundingClientRect();
          const screenPos = virtualToScreen(centerX, centerY, scale, offsetX, offsetY);
          setSoulDeckDropPopup({
            cardInstanceId: card.instanceId,
            batchIds: isGroupDrag ? cardIds : undefined,
            x: rect.left + screenPos.x,
            y: rect.top + screenPos.y,
          });
        }
      } else if (targetZone && (targetZone !== card.zone || targetZone === 'territory')) {
        // Hide the dragged card group immediately so it doesn't linger at the drop position
        // while React processes the state update and re-renders the card in its new zone.
        // Walk up from e.target to find the draggable Group (the card-level container).
        // Skip hiding for free-form zones where repositioning within the same zone is allowed.
        const freeFormZones: ZoneId[] = ['territory'];
        if (!freeFormZones.includes(targetZone)) {
          let cardGroup: Konva.Node | null = node;
          while (cardGroup && !cardGroup.draggable()) {
            cardGroup = cardGroup.parent;
          }
          if (cardGroup) {
            cardGroup.visible(false);
            cardGroup.getLayer()?.batchDraw();
          }
        }
        if (isGroupDrag) {
          // For free-form zones, preserve each card's drop position
          let positions: Record<string, { posX: number; posY: number }> | undefined;
          if (freeFormZones.includes(targetZone)) {
            positions = { [card.instanceId]: { posX: dropX, posY: dropY } };
            if (followerOffsets) {
              for (const [id, offset] of followerOffsets) {
                positions[id] = { posX: dropX + offset.dx, posY: dropY + offset.dy };
              }
            }
          }
          moveCardsBatch(cardIds, targetZone, positions);
          clearSelection();
        } else if (freeFormZones.includes(targetZone)) {
          moveCard(card.instanceId, targetZone, undefined, dropX, dropY);
        } else {
          moveCard(card.instanceId, targetZone);
        }
      }

      // Re-trigger hover preview only if the card stayed in place (no zone change).
      // If the card moved zones, it's no longer under the cursor and mouseLeave
      // won't fire, so the preview would get stuck.
      const movedZones = targetZone && targetZone !== card.zone;
      if (!movedZones) {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = setTimeout(() => {
          if (isDraggingRef.current || contextMenuRef.current) return;
          setHoverCard({
            card,
            x: e.evt.clientX,
            y: e.evt.clientY,
          });
        }, 700);
      }
    },
    [findZoneAtPosition, moveCard, moveCardsBatch, handleDeckDrop, cardWidth, cardHeight, selectedIds, clearSelection, state.turn, scale, offsetX, offsetY, state.zones.hand, state.zones['land-of-bondage'], state.zones.territory, state.isSpreadHand, virtualWidth, reorderHand, zoneLayout, attachCard]
  );

  // Konva fires `dblclick` whenever two pointer-ups happen on the same shape
  // within the dblClickWindow — including right-click followed by left-click.
  // Track left-clicks since the last right-click so meek only toggles on a
  // genuine left+left double-click.
  const leftClicksSinceContextMenuRef = useRef<number>(99);

  const handleCardContextMenu = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      leftClicksSinceContextMenuRef.current = 0;
      const stage = stageRef.current;
      if (!stage) return;
      const container = stage.container().getBoundingClientRect();
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      setHoverCard(null);

      // If right-clicking a selected card with multi-selection, show multi-card menu
      if (selectedIds.has(card.instanceId) && selectedIds.size > 1) {
        setMultiCardContextMenu({
          x: e.evt.clientX - container.left,
          y: e.evt.clientY - container.top,
        });
      } else {
        // Clear selection if right-clicking an unselected card
        if (selectedIds.size > 0 && !selectedIds.has(card.instanceId)) {
          clearSelection();
        }
        setContextMenu({
          card,
          x: e.evt.clientX - container.left,
          y: e.evt.clientY - container.top,
        });
      }
    },
    [selectedIds, clearSelection]
  );

  const contextMenuRef = useRef(contextMenu);
  contextMenuRef.current = contextMenu;

  // When loupe is visible, tooltip delay is irrelevant (loupe shows instantly).
  // When loupe is hidden, use a shorter delay for the fallback tooltip.
  const TOOLTIP_DELAY = 250;

  const isLoupeVisibleRef = useRef(isLoupeVisible);
  isLoupeVisibleRef.current = isLoupeVisible;

  const startHoverAnimation = useCallback(() => {
    // Skip glow animation when loupe is active — preview is instant
    if (isLoupeVisibleRef.current) return;
    if (hoverAnimFrameRef.current) cancelAnimationFrame(hoverAnimFrameRef.current);
    hoverStartTimeRef.current = performance.now();
    const animate = () => {
      const elapsed = performance.now() - hoverStartTimeRef.current!;
      const progress = Math.min(elapsed / TOOLTIP_DELAY, 1);
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

  const handleCardMouseEnter = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<MouseEvent>) => {
      if (isDraggingRef.current || contextMenuRef.current) return;

      // Always update the loupe panel instantly
      setPreviewCard({
        cardName: card.cardName,
        cardImgFile: card.cardImgFile,
        isMeek: card.isMeek,
      });

      setHoveredInstanceId(card.instanceId);

      // When loupe is visible, skip the delayed tooltip entirely
      if (isLoupeVisibleRef.current) return;

      startHoverAnimation();
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => {
        if (isDraggingRef.current || contextMenuRef.current) return;
        // Stop the rAF loop but keep progress at 1 so glow stays while preview is showing
        if (hoverAnimFrameRef.current) {
          cancelAnimationFrame(hoverAnimFrameRef.current);
          hoverAnimFrameRef.current = null;
        }
        setHoverProgress(1);
        setHoverCard({
          card,
          x: e.evt.clientX,
          y: e.evt.clientY,
        });
      }, TOOLTIP_DELAY);
    },
    [startHoverAnimation, setPreviewCard]
  );

  const handleCardMouseLeave = useCallback(() => {
    setHoveredInstanceId(null);
    // Don't clear previewCard on mouseLeave so the last card stays visible in the loupe panel
    stopHoverAnimation();
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setHoverCard(null);
  }, [stopHoverAnimation]);

  const handleCardDblClick = useCallback(
    (card: GameCard) => {
      if (leftClicksSinceContextMenuRef.current < 2) return;
      const willBeMeek = !card.isMeek;
      if (card.isMeek) {
        unmeekCard(card.instanceId);
      } else {
        meekCard(card.instanceId);
      }
      setPreviewCard({
        cardName: card.cardName,
        cardImgFile: card.cardImgFile,
        isMeek: willBeMeek,
      });
    },
    [meekCard, unmeekCard, setPreviewCard]
  );

  const handleDeckContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const container = stage.container().getBoundingClientRect();
      setDeckMenu({
        x: e.evt.clientX - container.left,
        y: e.evt.clientY - container.top,
      });
    },
    []
  );

  const handleSoulDeckContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const container = stage.container().getBoundingClientRect();
      setSoulDeckMenu({
        x: e.evt.clientX - container.left,
        y: e.evt.clientY - container.top,
      });
    },
    []
  );

  // Pop N card IDs from the soul-deck by position (top/bottom/random).
  const pickSoulDeckIds = useCallback(
    (mode: 'top' | 'bottom' | 'random', n: number): string[] => {
      const pile = state.zones['soul-deck'];
      if (pile.length === 0) return [];
      const count = Math.min(n, pile.length);
      if (mode === 'top') return pile.slice(0, count).map(c => c.instanceId);
      if (mode === 'bottom') return pile.slice(-count).map(c => c.instanceId);
      // random
      const shuffled = [...pile];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled.slice(0, count).map(c => c.instanceId);
    },
    [state.zones],
  );

  // Reveal: show the top/bottom/random N soul-deck cards in a peek modal.
  // Cards stay in the soul deck until the user drags them out or closes.
  const revealFromSoulDeck = useCallback(
    (mode: 'top' | 'bottom' | 'random', n: number) => {
      setSoulDeckMenu(null);
      const pile = state.zones['soul-deck'];
      if (pile.length === 0) { showGameToast('Soul Deck is empty'); return; }
      const ids = pickSoulDeckIds(mode, n);
      if (ids.length === 0) return;
      const count = ids.length;
      const title = mode === 'top'
        ? `Top ${count} of Soul Deck`
        : mode === 'bottom'
          ? `Bottom ${count} of Soul Deck`
          : `Random ${count} from Soul Deck`;
      setPeekState({ cardIds: ids, title, sourceZone: 'soul-deck' });
    },
    [state.zones, pickSoulDeckIds],
  );

  // Draw: move the top/bottom/random N soul-deck cards face-up into the LoB.
  const drawFromSoulDeck = useCallback(
    (mode: 'top' | 'bottom' | 'random', n: number) => {
      setSoulDeckMenu(null);
      const pile = state.zones['soul-deck'];
      if (pile.length === 0) { showGameToast('Soul Deck is empty'); return; }
      const ids = pickSoulDeckIds(mode, n);
      if (ids.length === 0) return;
      if (ids.length === 1) {
        moveCard(ids[0], 'land-of-bondage');
      } else {
        moveCardsBatch(ids, 'land-of-bondage');
      }
    },
    [state.zones, pickSoulDeckIds, moveCard, moveCardsBatch],
  );

  const lookAtSoulDeck = useCallback(
    (mode: 'top' | 'bottom' | 'random', n: number) => {
      setSoulDeckMenu(null);
      const pile = state.zones['soul-deck'];
      if (pile.length === 0) { showGameToast('Soul Deck is empty'); return; }
      const ids = pickSoulDeckIds(mode, n);
      if (ids.length === 0) return;
      const count = ids.length;
      const title = mode === 'top'
        ? `Looking at Top ${count} of Soul Deck`
        : mode === 'bottom'
          ? `Looking at Bottom ${count} of Soul Deck`
          : `Looking at Random ${count} from Soul Deck`;
      setLookState({ cardIds: ids, title, sourceZone: 'soul-deck' });
    },
    [state.zones, pickSoulDeckIds],
  );

  const searchSoulDeck = useCallback(() => {
    setSoulDeckMenu(null);
    setBrowseSoulDeck(true);
  }, []);

  const shuffleSoulDeck = useCallback(() => {
    setSoulDeckMenu(null);
    dispatch(gameActionCreators.shuffleSoulDeck());
  }, [dispatch]);

  const handleZoneClick = useCallback(
    (zoneId: ZoneId) => {
      const browsable: ZoneId[] = ['discard', 'reserve', 'banish', 'land-of-redemption'];
      if (browsable.includes(zoneId) && state.zones[zoneId].length > 0) {
        setBrowseZone(zoneId);
      }
    },
    [state.zones]
  );

  // Zones where cards should open browse modal instead of card context menu
  const BROWSE_ONLY_ZONES: ZoneId[] = ['discard', 'reserve', 'banish'];

  const handleBrowseZoneCardContextMenu = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      // Open the browse modal for the card's zone instead of the card context menu
      const zone = card.zone;
      if (zone && BROWSE_ONLY_ZONES.includes(zone)) {
        setBrowseZone(zone);
      }
    },
    []
  );

  /** Touch equivalent of right-click, mirroring MultiplayerCanvas: the context
   *  handlers read clientX/clientY off the event and position against the
   *  stage, so a synthetic event carrying the press point is enough. */
  const synthPointerEvent = useCallback(
    (p: { x: number; y: number }) =>
      ({
        evt: { clientX: p.x, clientY: p.y, preventDefault() {} },
        cancelBubble: false,
      }) as unknown as Konva.KonvaEventObject<PointerEvent>,
    [],
  );

  const handleCardLongPress = useCallback(
    (card: GameCard, p: { x: number; y: number }) => {
      // GameCardNode fires this immediately before stopDrag(); marking the drag
      // cancelled keeps the resulting dragend from committing a move the player
      // never asked for.
      if (isDraggingRef.current) dragCancelledRef.current = true;
      const zone = card.zone;
      if (zone && BROWSE_ONLY_ZONES.includes(zone)) {
        setBrowseZone(zone);
        return;
      }
      handleCardContextMenu(card, synthPointerEvent(p));
    },
    [handleCardContextMenu, synthPointerEvent],
  );

  /** They kept dragging after the menu appeared — they were aiming, not asking
   *  for a menu. Take it back rather than making them dismiss it. */
  const handleCardLongPressCancel = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleDeckLongPress = useCallback(
    (p: { x: number; y: number }) => handleDeckContextMenu(synthPointerEvent(p)),
    [handleDeckContextMenu, synthPointerEvent],
  );

  const handleBrowseZoneCardClick = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.shiftKey) {
        toggleSelect(card.instanceId);
        return;
      }
      if (selectedIds.size > 0 && !selectedIds.has(card.instanceId)) {
        clearSelection();
      }
      const zone = card.zone;
      if (zone && BROWSE_ONLY_ZONES.includes(zone)) {
        setBrowseZone(zone);
      }
    },
    [selectedIds, clearSelection, toggleSelect]
  );

  // Universal card click handler for selection support
  const handleCardClick = useCallback(
    (card: GameCard, e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button === 0) leftClicksSinceContextMenuRef.current += 1;
      if (e.evt.shiftKey) {
        toggleSelect(card.instanceId);
        return;
      }
      if (selectedIds.size > 0 && !selectedIds.has(card.instanceId)) {
        clearSelection();
      }
    },
    [selectedIds, clearSelection, toggleSelect]
  );

  // Calculate card positions for each zone
  const handPositions = useMemo(
    () => calculateHandPositions(state.zones.hand.length, virtualWidth, VIRTUAL_HEIGHT, state.isSpreadHand, cardWidth, cardHeight),
    [state.zones.hand.length, state.isSpreadHand, cardWidth, cardHeight, virtualWidth]
  );

  // Smooth hand re-layout: when cards enter/leave the hand the remaining
  // cards glide to their shifted slots instead of snapping.
  const handSlots = useMemo(() => {
    const m = new Map<string, { x: number; y: number; rotation: number }>();
    state.zones.hand.forEach((c, i) => {
      const p = handPositions[i];
      if (p) m.set(c.instanceId, p);
    });
    return m;
  }, [state.zones.hand, handPositions]);
  useHandLayoutTween(handSlots, cardNodeRefs);

  // Same glide for the Land of Bondage strip — when a soul is rescued or
  // removed, the remaining souls slide left instead of snapping.
  const lobSlots = useMemo(() => {
    const m = new Map<string, { x: number; y: number; rotation: number }>();
    const cards = state.zones['land-of-bondage'] ?? [];
    const rect = zoneLayout['land-of-bondage'];
    if (!rect || cards.length === 0) return m;
    const pos = calculateAutoArrangePositions(cards.length, rect, lobCardWidth, lobCardHeight);
    cards.forEach((c, i) => {
      const p = pos[i];
      if (p) m.set(c.instanceId, { x: p.x, y: p.y, rotation: 0 });
    });
    return m;
  }, [state.zones['land-of-bondage'], zoneLayout, lobCardWidth, lobCardHeight]);
  useHandLayoutTween(lobSlots, cardNodeRefs);

  // Render all zones except hand
  const nonHandZones: ZoneId[] = useMemo(() => [
    'territory', 'land-of-bondage',
    'land-of-redemption', 'deck', 'discard', 'reserve', 'banish',
  ], []);

  // Map weapon instanceId → { x, y, seamX, seamY } derived from the warrior it's
  // attached to. Weapons fan diagonally: index 0 sits closest to the warrior;
  // higher indices peek out further behind. `seam` is the top-left of whatever
  // sits in front of this weapon (warrior for index 0, weapon N-1 otherwise) —
  // used to anchor the unlink icon at the visible attach point.
  // Only applies in Territory.
  const derivedWeaponPositions = useMemo(() => {
    const result = new Map<string, { x: number; y: number; seamX: number; seamY: number }>();
    // Group weapons by their warrior id, preserving territory array order.
    const byWarrior = new Map<string, typeof state.zones.territory>();
    for (const card of state.zones.territory) {
      if (!card.equippedTo) continue;
      const list = byWarrior.get(card.equippedTo);
      if (list) list.push(card);
      else byWarrior.set(card.equippedTo, [card]);
    }
    for (const [warriorId, weapons] of byWarrior) {
      const warrior = state.zones.territory.find(c => c.instanceId === warriorId);
      if (!warrior || warrior.posX === undefined || warrior.posY === undefined) continue;
      weapons.forEach((weapon, index) => {
        const { dx, dy } = computeEquipOffset(cardWidth, cardHeight, index);
        // This weapon's top-left in canvas coords.
        const x = warrior.posX! + dx;
        const y = warrior.posY! + dy;
        // "Seam" for this weapon's detach icon: the top-left corner of whatever is
        // in front of it. For index 0 that's the warrior; for index N that's weapon N-1.
        const ahead = index === 0
          ? { x: warrior.posX!, y: warrior.posY! }
          : (() => {
              const { dx: adx, dy: ady } = computeEquipOffset(cardWidth, cardHeight, index - 1);
              return { x: warrior.posX! + adx, y: warrior.posY! + ady };
            })();
        result.set(weapon.instanceId, { x, y, seamX: ahead.x, seamY: ahead.y });
      });
    }
    return result;
  }, [state.zones.territory, cardWidth, cardHeight]);

  // Compute card bounds for all visible cards (used for selection rectangle intersection)
  const allCardBounds = useMemo((): CardBound[] => {
    const bounds: CardBound[] = [];

    // Hand cards
    const handPos = calculateHandPositions(state.zones.hand.length, virtualWidth, VIRTUAL_HEIGHT, state.isSpreadHand, cardWidth, cardHeight);
    state.zones.hand.forEach((card, i) => {
      const pos = handPos[i];
      if (pos) bounds.push({ instanceId: card.instanceId, x: pos.x, y: pos.y, width: cardWidth, height: cardHeight, rotation: pos.rotation });
    });

    // Territory cards (free-form). Attached weapons don't carry their own posX/posY —
    // look them up in derivedWeaponPositions so rect-select hits them where they're
    // actually rendered, not at the autogrid fallback.
    const tZone = zoneLayout['territory'];
    if (tZone) {
      state.zones.territory.forEach((card, i) => {
        let x: number;
        let y: number;
        if (card.equippedTo) {
          const derived = derivedWeaponPositions.get(card.instanceId);
          if (!derived) return; // can't place without derived — skip from selection bounds
          x = derived.x;
          y = derived.y;
        } else {
          x = card.posX ?? (tZone.x + 8 + (i % 8) * (cardWidth + 4));
          y = card.posY ?? (tZone.y + 20 + Math.floor(i / 8) * (cardHeight * 0.35));
        }
        bounds.push({ instanceId: card.instanceId, x, y, width: cardWidth, height: cardHeight, rotation: 0 });
      });
    }

    // Land of bondage (auto-arrange)
    const lobZone = zoneLayout['land-of-bondage'];
    if (lobZone && state.zones['land-of-bondage'].length > 0) {
      const lobPositions = calculateAutoArrangePositions(state.zones['land-of-bondage'].length, lobZone, lobCardWidth, lobCardHeight);
      state.zones['land-of-bondage'].forEach((card, i) => {
        const pos = lobPositions[i];
        if (pos) bounds.push({ instanceId: card.instanceId, x: pos.x, y: pos.y, width: lobCardWidth, height: lobCardHeight, rotation: 0 });
      });
    }

    // Reserve (horizontal overlap)
    const resZone = zoneLayout['reserve'];
    if (resZone && state.zones.reserve.length > 0) {
      const pad = 8;
      const availW = resZone.width - pad * 2;
      const cards = state.zones.reserve;
      const overlap = cards.length <= 1 ? 0 : Math.min(cardWidth * 0.3, (availW - cardWidth) / (cards.length - 1));
      cards.forEach((card, i) => {
        bounds.push({ instanceId: card.instanceId, x: resZone.x + pad + i * overlap, y: resZone.y + 24, width: cardWidth, height: cardHeight, rotation: 0 });
      });
    }

    // Discard and Banish are browse-only piles — not drag-selectable

    // Land of Redemption (horizontal overlap)
    const lorZone = zoneLayout['land-of-redemption'];
    if (lorZone && state.zones['land-of-redemption'].length > 0) {
      const pad = 8;
      const availW = lorZone.width - pad * 2;
      const cards = state.zones['land-of-redemption'];
      const overlap = cards.length <= 1 ? 0 : Math.min(cardWidth * 0.3, (availW - cardWidth) / (cards.length - 1));
      cards.forEach((card, i) => {
        bounds.push({ instanceId: card.instanceId, x: lorZone.x + pad + i * overlap, y: lorZone.y + 24, width: cardWidth, height: cardHeight, rotation: 0 });
      });
    }

    return bounds;
  }, [state.zones, state.isSpreadHand, zoneLayout, cardWidth, cardHeight, derivedWeaponPositions]);

  // Stage event handlers for rectangular selection drag
  const handleStageMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Only left-click; skip Ctrl/⌘+Click so macOS contextmenu routing wins
      // over marquee selection (mirrors MultiplayerCanvas).
      if (e.evt.button !== 0 || e.evt.ctrlKey || e.evt.metaKey) return;
      // Only start selection drag on empty canvas space (not cards).
      // Walk up the node tree to detect any draggable ancestor (card Group),
      // since the click target may be a nested child (e.g. KonvaImage inside
      // a non-draggable meek-rotation Group inside the draggable card Group).
      const target = e.target;
      let ancestor: Konva.Node | null = target.parent;
      let isCard = false;
      while (ancestor && ancestor !== stageRef.current) {
        if (ancestor.draggable?.()) { isCard = true; break; }
        ancestor = ancestor.parent;
      }
      if (isCard) return;

      if (!e.evt.shiftKey && selectedIds.size > 0) {
        clearSelection();
      }
      const layer = gameLayerRef.current;
      if (!layer) return;
      const pos = layer.getRelativePointerPosition();
      if (!pos) return;
      startSelectionDrag(pos.x, pos.y, e.evt.shiftKey);
    },
    [selectedIds.size, clearSelection, startSelectionDrag]
  );

  const handleStageMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isSelectingRef.current) return;
      // If a card drag started (handleCardDragStart fired), cancel the selection
      // so the dotted rect doesn't flash alongside the card drag.
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
    [updateSelectionDrag, allCardBounds]
  );

  const handleStageMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isSelectingRef.current) return;
      endSelectionDrag(e.evt.shiftKey);
    },
    [endSelectionDrag]
  );

  // Access image cache via ref (imageVersion ensures we read current values after loads complete)
  const getImage = useCallback((imgFile: string): HTMLImageElement | undefined => {
    if (!imgFile) return undefined;
    const url = getCardImageUrl(imgFile);
    const img = imageCacheRef.current.get(url);
    return img || undefined;
  }, [imageVersion]); // imageVersion dependency ensures fresh reads after batch load

  const SIDEBAR_ZONES_WITH_BADGE: ZoneId[] = ['deck', 'reserve', 'discard', 'banish', 'land-of-redemption', 'territory', 'land-of-bondage'];

  // Abbreviated labels for narrow sidebar zones
  const SHORT_ZONE_LABELS: Partial<Record<ZoneId, string>> = {
    'land-of-redemption': 'L.O.R.',
    'land-of-bondage': 'L.O.B.',
    'banish': 'Banish',
  };
  const sidebarWidth = zoneLayout['deck']?.width ?? 0;
  const useShortenedLabels = sidebarWidth < 160;

  return (
    <>
      <Stage
        ref={stageRef}
        width={containerWidth}
        height={containerHeight}
        pixelRatio={typeof window !== 'undefined' ? window.devicePixelRatio : 1}
        onContextMenu={(e) => e.evt.preventDefault()}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
      >
        {/* Game layer — scaled to virtual canvas 1920x1080 */}
        <Layer
          ref={gameLayerRef as any}
          scaleX={scale}
          scaleY={scale}
          x={offsetX}
          y={offsetY}
          listening={true}
        >
          {nonHandZones.map(zoneId => {
            const rect = zoneLayout[zoneId];
            if (!rect) return null;
            // The LoR badge shows redeemed-soul VALUE, not card count — the
            // Two/Three Liner souls count as two Lost Souls each, and cards
            // that aren't Lost Souls at all (e.g. Guardian of Your Souls,
            // which legitimately plays to the Land of Redemption) count zero.
            const cardCount = zoneId === 'land-of-redemption'
              ? (state.zones[zoneId] ?? []).filter(isLostSoulCard).reduce((n, c) => n + lostSoulValue(c.cardName), 0)
              : state.zones[zoneId]?.length || 0;

            return (
              <Group
                key={zoneId}
                onClick={(e) => {
                  if (e.evt.button === 0 && zoneId !== 'deck') handleZoneClick(zoneId);
                }}
                onContextMenu={(e) => {
                  if (zoneId === 'deck') handleDeckContextMenu(e);
                  if (zoneId === 'land-of-bondage') {
                    e.evt.preventDefault();
                    const stage = stageRef.current;
                    if (!stage) return;
                    const container = stage.container().getBoundingClientRect();
                    const layer = gameLayerRef.current;
                    const pointer = layer?.getRelativePointerPosition();
                    setZoneMenu({
                      x: e.evt.clientX - container.left,
                      y: e.evt.clientY - container.top,
                      spawnX: pointer?.x ?? e.evt.clientX - container.left,
                      spawnY: pointer?.y ?? e.evt.clientY - container.top,
                    });
                  }
                  if (zoneId === 'land-of-redemption') {
                    e.evt.preventDefault();
                    const stage = stageRef.current;
                    if (!stage) return;
                    const container = stage.container().getBoundingClientRect();
                    setLorMenu({
                      x: e.evt.clientX - container.left,
                      y: e.evt.clientY - container.top,
                    });
                  }
                }}
              >
                <Rect
                  x={rect.x}
                  y={rect.y}
                  width={rect.width}
                  height={rect.height}
                  fill="#1e1610"
                  stroke="#6b4e27"
                  strokeWidth={1}
                  cornerRadius={3}
                  opacity={0.45}
                />
                {zoneId === 'territory' || zoneId === 'land-of-bondage' ? (
                  // Top-right aligned label + count — matches multiplayer style
                  (() => {
                    const labelText = rect.label.toUpperCase();
                    const labelTextWidth = labelText.length * 8.5;
                    const badgeW = 24;
                    const labelW = labelTextWidth + 8 + badgeW + 8;
                    const bgW = Math.min(labelW + 6, rect.width);
                    const bgX = rect.x + rect.width - bgW;
                    const labelX = bgX + 6;
                    const badgeX = labelX + labelTextWidth + 8;
                    return (
                      <>
                        <Rect
                          x={bgX}
                          y={rect.y}
                          width={bgW}
                          height={20}
                          fill="rgba(30, 22, 16, 0.85)"
                          cornerRadius={[0, 3, 0, 4]}
                        />
                        <Text
                          x={labelX}
                          y={rect.y + 4}
                          text={labelText}
                          fontSize={11}
                          fontFamily="Cinzel, Georgia, serif"
                          fill="#e8d5a3"
                          letterSpacing={1}
                          width={rect.width - 44}
                          ellipsis={true}
                        />
                        <Rect
                          x={badgeX}
                          y={rect.y + 3}
                          width={badgeW}
                          height={14}
                          fill="rgba(196, 149, 90, 0.25)"
                          cornerRadius={3}
                          stroke="rgba(196, 149, 90, 0.5)"
                          strokeWidth={0.5}
                        />
                        <Text
                          x={badgeX}
                          y={rect.y + 4}
                          width={badgeW}
                          text={String(cardCount)}
                          fontSize={11}
                          fill="#e8d5a3"
                          align="center"
                        />
                      </>
                    );
                  })()
                ) : (
                  <>
                    <Text
                      x={rect.x + 8}
                      y={rect.y + 6}
                      text={(useShortenedLabels && SHORT_ZONE_LABELS[zoneId] ? SHORT_ZONE_LABELS[zoneId] : rect.label).toUpperCase()}
                      fontSize={SIDEBAR_ZONES_WITH_BADGE.includes(zoneId) && useShortenedLabels ? 11 : 14}
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#e8d5a3"
                      letterSpacing={SIDEBAR_ZONES_WITH_BADGE.includes(zoneId) && useShortenedLabels ? 1 : 2}
                      width={rect.width - 8 - 38}
                      ellipsis={true}
                    />
                    {/* Count badge for sidebar zones */}
                    {SIDEBAR_ZONES_WITH_BADGE.includes(zoneId) && (
                      <Group x={rect.x + rect.width - 34} y={rect.y + 4}>
                        <Rect width={28} height={20} fill="#2a1f12" cornerRadius={4} stroke="#c4955a" strokeWidth={1} />
                        <Text
                          text={String(cardCount)}
                          fontSize={14}
                          fontStyle="bold"
                          fill="#e8d5a3"
                          width={28}
                          height={20}
                          align="center"
                          verticalAlign="middle"
                        />
                      </Group>
                    )}
                  </>
                )}
              </Group>
            );
          })}

          {/* Hand zone background */}
          <Rect
            x={zoneLayout.hand.x}
            y={zoneLayout.hand.y}
            width={zoneLayout.hand.width}
            height={zoneLayout.hand.height}
            fill="#0d0905"
            opacity={0.5}
          />
          {/* Hand label + count + brigade — right-aligned to the hand zone.
              HAND [count] on the top row, brigade counts stacked vertically below. */}
          {(() => {
            const right = zoneLayout.hand.x + zoneLayout.hand.width;
            const top = zoneLayout.hand.y;
            const badgeW = 28;
            const labelW = 60;
            const brigadeW = 200;
            const badgeX = right - 8 - badgeW;
            const labelX = badgeX - 8 - labelW;
            const brigadeX = right - 8 - brigadeW;
            const brigadeTop = top + 26;
            const rowH = 18;
            return (
              <>
                <Text
                  x={labelX}
                  y={top + 4}
                  width={labelW}
                  text="HAND"
                  fontSize={14}
                  fontFamily="Cinzel, Georgia, serif"
                  fill="#e8d5a3"
                  letterSpacing={2}
                  align="right"
                />
                <Group x={badgeX} y={top + 2}>
                  <Rect width={badgeW} height={20} fill="#2a1f12" cornerRadius={4} stroke="#c4955a" strokeWidth={1} />
                  <Text
                    text={String(state.zones.hand.length)}
                    fontSize={14}
                    fontStyle="bold"
                    fill="#e8d5a3"
                    width={badgeW}
                    height={20}
                    align="center"
                    verticalAlign="middle"
                  />
                </Group>
                {handBrigadeCounts.total > 0 && (
                  <>
                    <Text
                      x={brigadeX}
                      y={brigadeTop}
                      width={brigadeW}
                      text={`Total Brigades: ${handBrigadeCounts.total}`}
                      fontSize={13}
                      fontStyle="bold"
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#e8d5a3"
                      letterSpacing={1}
                      align="right"
                      listening={false}
                    />
                    <Text
                      x={brigadeX}
                      y={brigadeTop + rowH}
                      width={brigadeW}
                      text={`Good Brigades: ${handBrigadeCounts.good}`}
                      fontSize={13}
                      fontStyle="bold"
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#9ab86a"
                      letterSpacing={1}
                      align="right"
                      listening={false}
                    />
                    <Text
                      x={brigadeX}
                      y={brigadeTop + rowH * 2}
                      width={brigadeW}
                      text={`Evil Brigades: ${handBrigadeCounts.evil}`}
                      fontSize={13}
                      fontStyle="bold"
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#e87560"
                      letterSpacing={1}
                      align="right"
                      listening={false}
                    />
                    <Text
                      x={brigadeX}
                      y={brigadeTop + rowH * 3}
                      width={brigadeW}
                      text={`Neutral Brigades: ${handBrigadeCounts.neutral}`}
                      fontSize={13}
                      fontStyle="bold"
                      fontFamily="Cinzel, Georgia, serif"
                      fill="#c4955a"
                      letterSpacing={1}
                      align="right"
                      listening={false}
                    />
                  </>
                )}
              </>
            );
          })()}
          {state.zones.hand.length === 0 && (
            <Text
              x={zoneLayout.hand.x}
              y={zoneLayout.hand.y + zoneLayout.hand.height / 2 - 8}
              width={zoneLayout.hand.width}
              text="Hand is empty"
              fontSize={14}
              fontFamily="Cinzel, Georgia, serif"
              fill="#6b4e27"
              opacity={0.5}
              align="center"
            />
          )}

          {/* Card rendering — non-hand zones */}
          {nonHandZones.map(zoneId => {
            const cards = state.zones[zoneId];
            if (!cards || cards.length === 0) return null;

            // Deck: show top card face-down, right-click opens deck search.
            // While the top-deck reveal toggle is on (The Foretelling Angel's
            // toggle_top_deck_reveal), the top card renders face up and
            // draggable instead; right-click still opens the normal deck menu.
            if (zoneId === 'deck') {
              const zone = zoneLayout[zoneId];
              const cx = zone.x + zone.width / 2;
              const cy = zone.y + zone.height / 2;
              const rot = rotateSidebarPiles ? -90 : 0;
              const oX = rotateSidebarPiles ? sidebarCardWidth / 2 : 0;
              const oY = rotateSidebarPiles ? sidebarCardHeight / 2 : 0;
              // When not rotated, position top-left so card sits below the label
              const px = rotateSidebarPiles ? cx : zone.x + zone.width / 2 - sidebarCardWidth / 2;
              const py = rotateSidebarPiles ? cy : zone.y + 24;
              // Deck cards sit face-down (isFlipped) — force the revealed top
              // card face up, same as the multiplayer pile's effectiveTop.
              const rawTop = state.topDeckRevealed ? cards[0] : undefined;
              const revealedTop = rawTop
                ? (rawTop.isFlipped ? { ...rawTop, isFlipped: false } : rawTop)
                : undefined;
              // GameCardNode has no offset props, so the rotated layout's
              // center pivot is rebased onto the node's top-left origin.
              const revealedX = rotateSidebarPiles ? cx - sidebarCardHeight / 2 : px;
              const revealedY = rotateSidebarPiles ? cy + sidebarCardWidth / 2 : py;
              return (
                <Group key={zoneId}>
                  {cards.length > 1 && (
                    <Group x={px - 2} y={py - 2} rotation={rot} offsetX={oX} offsetY={oY}>
                      <CardBackShape width={sidebarCardWidth} height={sidebarCardHeight} />
                    </Group>
                  )}
                  {revealedTop ? (
                    <GameCardNode
                      key={revealedTop.instanceId}
                      card={revealedTop}
                      x={revealedX}
                      y={revealedY}
                      rotation={rot}
                      cardWidth={sidebarCardWidth}
                      cardHeight={sidebarCardHeight}
                      image={getImage(revealedTop.cardImgFile)}
                      {...(getTargetingProps(revealedTop) ?? {})}
                      isSelected={selectedIds.has(revealedTop.instanceId)}
                      hoverProgress={hoveredInstanceId === revealedTop.instanceId ? hoverProgress : 0}
                      nodeRef={registerCardNode}
                      onDragStart={handleCardDragStart}
                      onDragMove={handleCardDragMove}
                      onDragEnd={(c, e) => {
                        handleCardDragEnd(c, e);
                        // Aborted drop (card stayed in deck): snap the node
                        // back onto the pile. A successful move unmounts this
                        // node on the next render, so the reset is harmless.
                        e.target.position({ x: revealedX, y: revealedY });
                        e.target.getLayer()?.batchDraw();
                      }}
                      onContextMenu={(_c, e) => handleDeckContextMenu(e)}
                      onLongPress={isTouch ? (_c, p) => handleDeckLongPress(p) : undefined}
                      onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                      onDblClick={() => {}}
                      onMouseEnter={handleCardMouseEnter}
                      onMouseLeave={handleCardMouseLeave}
                    />
                  ) : (
                    <Group
                      x={px}
                      y={py}
                      rotation={rot}
                      offsetX={oX}
                      offsetY={oY}
                      onContextMenu={handleDeckContextMenu}
                      // Touch has no right-click: without a tap handler the
                      // deck pile did nothing at all on a phone — no draw, no
                      // search, no shuffle.
                      onTap={(e) => handleDeckLongPress({ x: e.evt.changedTouches?.[0]?.clientX ?? 0, y: e.evt.changedTouches?.[0]?.clientY ?? 0 })}
                    >
                      <CardBackShape width={sidebarCardWidth} height={sidebarCardHeight} />
                    </Group>
                  )}
                </Group>
              );
            }

            // Reserve: overlap cards horizontally, in the canonical default order
            if (zoneId === 'reserve') {
              const zone = zoneLayout[zoneId];
              const pad = 8;
              const availW = zone.width - pad * 2;
              const sorted = [...cards].sort((a, b) => compareCardsDefault(
                { name: a.cardName, type: a.type, brigade: a.brigade, alignment: a.alignment, strength: a.strength, reference: a.reference },
                { name: b.cardName, type: b.type, brigade: b.brigade, alignment: b.alignment, strength: b.strength, reference: b.reference },
              ));
              const overlap = sorted.length <= 1
                ? 0
                : Math.min(sidebarCardWidth * 0.3, (availW - sidebarCardWidth) / (sorted.length - 1));
              const nowForReveal = Date.now();
              return (
                <Group key={zoneId}>
                  {sorted.map((card, i) => {
                    // Spread the card to a fresh ref while a reveal is active
                    // so the memoized GameCardNode re-renders each tick — the
                    // countdown ring reads Date.now() at render time.
                    const cardForNode = (typeof card.revealUntil === 'number' && card.revealUntil > nowForReveal)
                      ? { ...card }
                      : card;
                    return (
                      <GameCardNode
                        key={card.instanceId}
                        card={cardForNode}
                        x={zone.x + pad + i * overlap}
                        y={zone.y + 24}
                        rotation={0}
                        cardWidth={sidebarCardWidth}
                        cardHeight={sidebarCardHeight}
                        image={getImage(card.cardImgFile)}
                        {...(getTargetingProps(card) ?? {})}
                        isSelected={selectedIds.has(card.instanceId)}
                        hoverProgress={hoveredInstanceId === card.instanceId ? hoverProgress : 0}
                        nodeRef={registerCardNode}
                        onDragStart={handleCardDragStart}
                        onDragMove={handleCardDragMove}
                        onDragEnd={handleCardDragEnd}
                        onContextMenu={handleBrowseZoneCardContextMenu}
                        onLongPress={isTouch ? handleCardLongPress : undefined}
                        onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                        onClick={handleBrowseZoneCardClick}
                        onDblClick={handleCardDblClick}
                        onMouseEnter={handleCardMouseEnter}
                        onMouseLeave={handleCardMouseLeave}
                      />
                    );
                  })}
                </Group>
              );
            }

            // Banish: face-down stacked pile, click opens browse modal
            if (zoneId === 'banish') {
              const zone = zoneLayout[zoneId];
              const cx = zone.x + zone.width / 2;
              const cy = zone.y + zone.height / 2;
              const rot = rotateSidebarPiles ? -90 : 0;
              const oX = rotateSidebarPiles ? sidebarCardWidth / 2 : 0;
              const oY = rotateSidebarPiles ? sidebarCardHeight / 2 : 0;
              const px = rotateSidebarPiles ? cx : zone.x + zone.width / 2 - sidebarCardWidth / 2;
              const py = rotateSidebarPiles ? cy : zone.y + 24;
              return (
                <Group key={zoneId}>
                  {cards.length > 1 && (
                    <Group x={px - 2} y={py - 2} rotation={rot} offsetX={oX} offsetY={oY}>
                      <CardBackShape width={sidebarCardWidth} height={sidebarCardHeight} />
                    </Group>
                  )}
                  <Group
                    x={px}
                    y={py}
                    rotation={rot}
                    offsetX={oX}
                    offsetY={oY}
                    onClick={() => setBrowseZone('banish')}
                    onTap={() => setBrowseZone('banish')}
                    onContextMenu={(e) => { e.evt.preventDefault(); setBrowseZone('banish'); }}
                  >
                    <CardBackShape width={sidebarCardWidth} height={sidebarCardHeight} />
                  </Group>
                </Group>
              );
            }

            // Discard: stack with natural jitter
            if (zoneId === 'discard') {
              const zone = zoneLayout[zoneId];
              const cx = zone.x + zone.width / 2;
              const cy = zone.y + zone.height / 2;
              // When rotated, GameCardNode rotates around top-left, so pre-offset
              // so the visual center lands at (cx, cy).
              const baseX = rotateSidebarPiles ? cx - sidebarCardHeight / 2 : cx - sidebarCardWidth / 2;
              const baseY = rotateSidebarPiles ? cy + sidebarCardWidth / 2 : zone.y + 24;
              const baseRot = rotateSidebarPiles ? -90 : 0;
              return (
                <Group key={zoneId}>
                  {cards.map((card, i) => {
                    // Stable per-card jitter from instanceId hash
                    let h = 0;
                    for (let c = 0; c < card.instanceId.length; c++) {
                      h = ((h << 5) - h + card.instanceId.charCodeAt(c)) | 0;
                    }
                    const jitterX = ((h & 0xff) / 255 - 0.5) * 6;
                    const jitterY = (((h >> 8) & 0xff) / 255 - 0.5) * 6;
                    const jitterRot = (((h >> 16) & 0xff) / 255 - 0.5) * 8;
                    return (
                      <GameCardNode
                        key={card.instanceId}
                        card={{ ...card, isFlipped: false }}
                        x={baseX + jitterX}
                        y={baseY + jitterY}
                        rotation={baseRot + jitterRot}
                        cardWidth={sidebarCardWidth}
                        cardHeight={sidebarCardHeight}
                        image={getImage(card.cardImgFile)}
                        {...(getTargetingProps(card) ?? {})}
                        isSelected={selectedIds.has(card.instanceId)}
                        hoverProgress={hoveredInstanceId === card.instanceId ? hoverProgress : 0}
                        nodeRef={registerCardNode}
                        onDragStart={handleCardDragStart}
                        onDragMove={handleCardDragMove}
                        onDragEnd={handleCardDragEnd}
                        onContextMenu={handleBrowseZoneCardContextMenu}
                        onLongPress={isTouch ? handleCardLongPress : undefined}
                        onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                        onClick={handleBrowseZoneCardClick}
                        onDblClick={handleCardDblClick}
                        onMouseEnter={handleCardMouseEnter}
                        onMouseLeave={handleCardMouseLeave}
                      />
                    );
                  })}
                </Group>
              );
            }

            // Land of Redemption: overlap cards within zone bounds
            if (zoneId === 'land-of-redemption') {
              const zone = zoneLayout[zoneId];
              const pad = 8;
              const availW = zone.width - pad * 2;
              const overlap = cards.length <= 1
                ? 0
                : Math.min(sidebarCardWidth * 0.3, (availW - sidebarCardWidth) / (cards.length - 1));
              return (
                <Group key={zoneId}>
                  {cards.map((card, i) => (
                    <GameCardNode
                      key={card.instanceId}
                      card={card}
                      x={zone.x + pad + i * overlap}
                      y={zone.y + 24}
                      rotation={0}
                      cardWidth={sidebarCardWidth}
                      cardHeight={sidebarCardHeight}
                      image={getImage(card.cardImgFile)}
                      {...(getTargetingProps(card) ?? {})}
                      isSelected={selectedIds.has(card.instanceId)}
                      hoverProgress={hoveredInstanceId === card.instanceId ? hoverProgress : 0}
                      nodeRef={registerCardNode}
                      onDragStart={handleCardDragStart}
                      onDragMove={handleCardDragMove}
                      onDragEnd={handleCardDragEnd}
                      onContextMenu={handleCardContextMenu}
                      onLongPress={isTouch ? handleCardLongPress : undefined}
                      onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                      onClick={handleCardClick}
                      onDblClick={handleCardDblClick}
                      onMouseEnter={handleCardMouseEnter}
                      onMouseLeave={handleCardMouseLeave}
                    />
                  ))}
                </Group>
              );
            }

            // Territory: free-form placement using stored positions.
            // Per-cluster render so each warrior's weapons draw directly behind
            // THAT warrior (not globally behind all warriors). We walk the
            // non-attached cards in territory order; for each warrior, its
            // attached weapons are emitted first (higher-index first so fan
            // z-order is correct), then the warrior itself.
            if (zoneId === 'territory') {
              const zone = zoneLayout[zoneId];
              const clipProps = dragSourceZone === 'territory'
                ? {}
                : { clipX: zone.x, clipY: zone.y, clipWidth: zone.width, clipHeight: zone.height };
              return (
                <Group key={zoneId} {...clipProps}>
                  {cards.filter(c => !c.equippedTo).flatMap((card, i) => {
                    const attached = cards
                      .filter(w => w.equippedTo === card.instanceId)
                      .slice()
                      .sort((a, b) => {
                        const warriorWeapons = cards.filter(c => c.equippedTo === a.equippedTo);
                        return warriorWeapons.indexOf(b) - warriorWeapons.indexOf(a);
                      });
                    const weaponNodes = attached.map(w => {
                      const derived = derivedWeaponPositions.get(w.instanceId);
                      if (!derived) return null;
                      return (
                        <GameCardNode
                          key={w.instanceId}
                          card={w}
                          x={derived.x}
                          y={derived.y}
                          rotation={0}
                          cardWidth={cardWidth}
                          cardHeight={cardHeight}
                          image={getImage(w.cardImgFile)}
                          {...(getTargetingProps(w) ?? {})}
                          isSelected={selectedIds.has(w.instanceId)}
                          hoverProgress={hoveredInstanceId === w.instanceId ? hoverProgress : 0}
                          nodeRef={registerCardNode}
                          onDragStart={handleCardDragStart}
                          onDragMove={handleCardDragMove}
                          onDragEnd={handleCardDragEnd}
                          onContextMenu={handleCardContextMenu}
                          onLongPress={isTouch ? handleCardLongPress : undefined}
                          onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                          onClick={handleCardClick}
                          onDblClick={handleCardDblClick}
                          onMouseEnter={handleCardMouseEnter}
                          onMouseLeave={handleCardMouseLeave}
                        />
                      );
                    });
                    const x = card.posX ?? (zone.x + 8 + (i % 8) * (cardWidth + 4));
                    const y = card.posY ?? (zone.y + 20 + Math.floor(i / 8) * (cardHeight * 0.35));
                    const warriorNode = (
                      <GameCardNode
                        key={card.instanceId}
                        card={card}
                        x={x}
                        y={y}
                        rotation={0}
                        cardWidth={cardWidth}
                        cardHeight={cardHeight}
                        image={getImage(card.cardImgFile)}
                        {...(getTargetingProps(card) ?? {})}
                        isSelected={selectedIds.has(card.instanceId)}
                        hoverProgress={hoveredInstanceId === card.instanceId ? hoverProgress : 0}
                        nodeRef={registerCardNode}
                        onDragStart={handleCardDragStart}
                        onDragMove={handleCardDragMove}
                        onDragEnd={handleCardDragEnd}
                        onContextMenu={handleCardContextMenu}
                        onLongPress={isTouch ? handleCardLongPress : undefined}
                        onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                        onClick={handleCardClick}
                        onDblClick={handleCardDblClick}
                        onMouseEnter={handleCardMouseEnter}
                        onMouseLeave={handleCardMouseLeave}
                      />
                    );
                    return [...weaponNodes, warriorNode];
                  })}
                </Group>
              );
            }

            // Land of Bondage: auto-arrange horizontal strip with drag-to-reorder
            if (zoneId === 'land-of-bondage') {
              const zone = zoneLayout[zoneId];
              const lobPositions = calculateAutoArrangePositions(cards.length, zone, lobCardWidth, lobCardHeight);
              const lobClipProps = dragSourceZone === 'land-of-bondage'
                ? {}
                : { clipX: zone.x, clipY: zone.y, clipWidth: zone.width, clipHeight: zone.height };
              return (
                <Group key={zoneId} {...lobClipProps}>
                  {cards.map((card, i) => {
                    const pos = lobPositions[i];
                    if (!pos) return null;
                    // In flight → the flyer shows it; skip the settled node.
                    if (soulDeals.has(card.instanceId)) return null;
                    return (
                      <GameCardNode
                        key={card.instanceId}
                        card={card}
                        x={pos.x}
                        y={pos.y}
                        rotation={0}
                        cardWidth={lobCardWidth}
                        cardHeight={lobCardHeight}
                        image={getImage(card.cardImgFile)}
                        {...(getTargetingProps(card) ?? {})}
                        isSelected={selectedIds.has(card.instanceId)}
                        hoverProgress={hoveredInstanceId === card.instanceId ? hoverProgress : 0}
                        lobArrivalGlow={getLobGlow(card.instanceId) > 0}
                        nodeRef={registerCardNode}
                        onDragStart={handleCardDragStart}
                        onDragMove={handleCardDragMove}
                        onDragEnd={handleCardDragEnd}
                        onContextMenu={handleCardContextMenu}
                        onLongPress={isTouch ? handleCardLongPress : undefined}
                        onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                        onClick={handleCardClick}
                        onDblClick={handleCardDblClick}
                        onMouseEnter={handleCardMouseEnter}
                        onMouseLeave={handleCardMouseLeave}
                      />
                    );
                  })}
                </Group>
              );
            }

            // For other zones, lay cards out in a grid
            const positions = calculateCardPositionsInZone(
              zoneLayout[zoneId],
              cards.length,
              cardWidth,
              cardHeight
            );
            const isBrowseOnly = BROWSE_ONLY_ZONES.includes(zoneId);

            return (
              <Group key={zoneId}>
                {cards.map((card, i) => {
                  const pos = positions[i];
                  if (!pos) return null;
                  return (
                    <GameCardNode
                      key={card.instanceId}
                      card={card}
                      x={pos.x}
                      y={pos.y}
                      rotation={0}
                      cardWidth={cardWidth}
                      cardHeight={cardHeight}
                      image={getImage(card.cardImgFile)}
                      {...(getTargetingProps(card) ?? {})}
                      isSelected={selectedIds.has(card.instanceId)}
                      hoverProgress={hoveredInstanceId === card.instanceId ? hoverProgress : 0}
                      nodeRef={registerCardNode}
                      onDragStart={handleCardDragStart}
                      onDragMove={handleCardDragMove}
                      onDragEnd={handleCardDragEnd}
                      onContextMenu={isBrowseOnly ? handleBrowseZoneCardContextMenu : handleCardContextMenu}
                      onLongPress={isTouch ? handleCardLongPress : undefined}
                      onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                      onClick={isBrowseOnly ? handleBrowseZoneCardClick : handleCardClick}
                      onDblClick={handleCardDblClick}
                      onMouseEnter={handleCardMouseEnter}
                      onMouseLeave={handleCardMouseLeave}
                    />
                  );
                })}
              </Group>
            );
          })}

          {/* Soul Deck pile — Paragon only. Face-down stack anchored in the
              soul-deck rect (left side of Land of Bondage). Right-click opens
              a deck-style context menu (Search / Shuffle / Look / Reveal). */}
          {state.format === 'Paragon' && state.zones['soul-deck'].length > 0 && (() => {
            const zone = zoneLayout['soul-deck'];
            if (!zone || zone.width <= 0) return null;
            const count = state.zones['soul-deck'].length;
            // Fit the card inside the narrow soul-deck column.
            const pileWidth = Math.min(cardWidth, zone.width - 4);
            const pileHeight = Math.round(pileWidth * CARD_ASPECT_RATIO);
            const px = zone.x + (zone.width - pileWidth) / 2;
            const py = zone.y + (zone.height - pileHeight) / 2;
            // TODO: drag-from-Soul-Deck — right-click reveal is the primary path for now.
            return (
              <Group
                key="soul-deck-pile"
                onContextMenu={handleSoulDeckContextMenu}
              >
                {/* Back-stack hint — a slight offset shows depth when there's more than one */}
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
                  />
                )}
                {/* Count badge anchored to the top-right of the pile */}
                <Group x={px + pileWidth - 30} y={py + 4}>
                  <Rect width={28} height={20} fill="#2a1f12" cornerRadius={4} stroke="#c4955a" strokeWidth={1} />
                  <Text
                    text={String(count)}
                    fontSize={14}
                    fontStyle="bold"
                    fill="#e8d5a3"
                    width={28}
                    height={20}
                    align="center"
                    verticalAlign="middle"
                  />
                </Group>
                {/* Small "SOUL" label at the bottom so the pile is identifiable */}
                <Text
                  x={px}
                  y={py + pileHeight - 16}
                  width={pileWidth}
                  text="SOUL DECK"
                  fontSize={9}
                  fontFamily="Cinzel, Georgia, serif"
                  fill="#e8d5a3"
                  letterSpacing={1}
                  align="center"
                />
              </Group>
            );
          })()}

          {/* Hand cards */}
          {state.zones.hand.map((card, i) => {
            const pos = handPositions[i];
            if (!pos) return null;
            // Card is mid-deal: its DealLayer sprite is flying — don't render
            // the real node yet (handPositions still reserves its slot).
            if (dealingIds.has(card.instanceId)) return null;
            return (
              <GameCardNode
                key={card.instanceId}
                card={card}
                x={pos.x}
                y={pos.y}
                rotation={pos.rotation}
                cardWidth={cardWidth}
                cardHeight={cardHeight}
                image={getImage(card.cardImgFile)}
                {...(getTargetingProps(card) ?? {})}
                isSelected={selectedIds.has(card.instanceId)}
                      hoverProgress={hoveredInstanceId === card.instanceId ? hoverProgress : 0}
                lobArrivalGlow={dealGlowIds.has(card.instanceId)}
                nodeRef={registerCardNode}
                onDragStart={handleCardDragStart}
                onDragMove={handleCardDragMove}
                onDragEnd={handleCardDragEnd}
                onContextMenu={handleCardContextMenu}
                onLongPress={isTouch ? handleCardLongPress : undefined}
                onLongPressCancel={isTouch ? handleCardLongPressCancel : undefined}
                onClick={handleCardClick}
                onDblClick={handleCardDblClick}
                onMouseEnter={handleCardMouseEnter}
                onMouseLeave={handleCardMouseLeave}
              />
            );
          })}

          {/* Lost Soul "deal" flyers — dealt from the deck into the LOB slot. */}
          {(() => {
            const lobZone = zoneLayout['land-of-bondage'];
            const deck = zoneLayout['deck'];
            if (!lobZone || !deck) return null;
            const lobCards = state.zones['land-of-bondage'] ?? [];
            const slots = calculateAutoArrangePositions(lobCards.length, lobZone, lobCardWidth, lobCardHeight);
            const deals: SoulDeal[] = [];
            for (const [id, seq] of soulDeals) {
              const idx = lobCards.findIndex(c => c.instanceId === id);
              const slot = idx >= 0 ? slots[idx] : undefined;
              const card = idx >= 0 ? lobCards[idx] : undefined;
              if (!slot || !card) continue;
              deals.push({
                id,
                image: getImage(card.cardImgFile),
                cardWidth: lobCardWidth,
                cardHeight: lobCardHeight,
                rotation: 0,
                flight: computeDealFlight({ deck, slot, cardWidth: lobCardWidth, cardHeight: lobCardHeight, seq }),
              });
            }
            return deals.length > 0
              ? <LostSoulDealLayer deals={deals} onLand={onSoulLand} />
              : null;
          })()}

          {/* "The deal" sprites — card backs flying deck pile → hand slot */}
          {(() => {
            const deckZone = zoneLayout['deck'];
            if (!deckZone || activeDeals.length === 0) return null;
            // Match the deck pile's rendered card-back size (see sidebar piles).
            const pileWidth = Math.min(cardWidth, deckZone.width - 4);
            const originScale = cardWidth > 0 ? pileWidth / cardWidth : 1;
            const sprites: DealSpriteSpec[] = [];
            for (const deal of activeDeals) {
              const idx = state.zones.hand.findIndex(c => c.instanceId === deal.instanceId);
              if (idx === -1) continue;
              const dealPos = handPositions[idx];
              if (!dealPos) continue;
              sprites.push({
                deal,
                origin: {
                  x: deckZone.x + deckZone.width / 2 - (cardWidth * originScale) / 2,
                  y: deckZone.y + deckZone.height / 2 - (cardHeight * originScale) / 2,
                },
                originScale,
                target: { x: dealPos.x, y: dealPos.y, rotation: dealPos.rotation },
                cardWidth,
                cardHeight,
                image: getImage(state.zones.hand[idx].cardImgFile),
              });
            }
            return <DealLayer sprites={sprites} onLanded={completeDeal} />;
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
          />
        </Layer>
      </Stage>

      {/* Equip unlink icons — one per attached weapon, anchored at that weapon's seam
          (top-left of whatever sits in front of it: warrior for index 0, weapon N-1 otherwise).
          Hidden only when this specific link's warrior or weapon is part of the active drag —
          the overlay reads from state (which lags behind the Konva node mid-drag), so leaving
          it visible for the moving card would make the icon drift. Other links stay put. */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        aria-hidden="false"
      >
        {state.zones.territory
          .filter(c => c.equippedTo)
          .filter(weapon =>
            !draggingCardIds.has(weapon.instanceId) &&
            !(weapon.equippedTo && draggingCardIds.has(weapon.equippedTo))
          )
          .map(weapon => {
            const derived = derivedWeaponPositions.get(weapon.instanceId);
            if (!derived) return null;
            // Convert the weapon's own seam from virtual canvas coords to screen coords
            // so the HTML button aligns over the rendered Konva cards.
            const seam = virtualToScreen(derived.seamX, derived.seamY, scale, offsetX, offsetY);
            const warrior = state.zones.territory.find(c => c.instanceId === weapon.equippedTo);
            return (
              <button
                key={weapon.instanceId}
                type="button"
                onClick={() => detachCard(weapon.instanceId, derived.x, derived.y)}
                className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#1a1510] p-1.5 text-[#c4955a] shadow-md ring-1 ring-[#c4955a]/40 transition hover:bg-[#2a1f14] hover:ring-[#c4955a]"
                style={{ left: `${seam.x}px`, top: `${seam.y}px` }}
                title="Unequip"
                aria-label={warrior ? `Unequip ${weapon.cardName} from ${warrior.cardName}` : 'Unequip'}
              >
                <Link2Off size={14} strokeWidth={2} />
              </button>
            );
          })}
      </div>

      {/* DOM overlays */}

      {/* Reserve lock indicator on turn 1 */}
      {state.turn === 1 && zoneLayout.reserve && (() => {
        const reserveTopRight = virtualToScreen(
          zoneLayout.reserve.x + zoneLayout.reserve.width,
          zoneLayout.reserve.y,
          scale, offsetX, offsetY
        );
        const lockPos = { x: reserveTopRight.x - 52, y: reserveTopRight.y + 5 };
        return (
        <div
          className="reserve-lock-wrapper"
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: 'absolute',
            left: lockPos.x,
            top: lockPos.y,
            pointerEvents: 'auto',
            cursor: 'help',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            zIndex: 50,
          }}
        >
          <svg width="12" height="14" viewBox="0 0 12 14" fill="none" style={{ opacity: 0.7 }}>
            <rect x="1" y="6" width="10" height="7" rx="1.5" fill="#6b4e27" stroke="#8b6532" strokeWidth="0.8" />
            <path d="M3.5 6V4.5C3.5 3.1 4.6 2 6 2s2.5 1.1 2.5 2.5V6" stroke="#8b6532" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            <circle cx="6" cy="9.5" r="1" fill="#c9b99a" />
          </svg>
          <span
            className="reserve-lock-tip"
            style={{
              position: 'absolute',
              right: 0,
              bottom: '100%',
              marginBottom: 4,
              padding: '4px 8px',
              background: 'var(--gf-bg)',
              border: '1px solid var(--gf-border)',
              borderRadius: 4,
              color: 'var(--gf-text-bright)',
              fontSize: 10,
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              opacity: 0,
              transition: 'opacity 0.05s',
            }}
          >
            Cannot remove cards from reserve on turn 1
          </span>
          <style>{`
            .reserve-lock-wrapper:hover .reserve-lock-tip {
              opacity: 1 !important;
            }
          `}</style>
        </div>
        );
      })()}

      <PhaseBar hideBackButton={hideBackButton} />
      <GameToolbar />
      <CardScaleControl
        cardScale={cardScale}
        setCardScale={setCardScale}
        resetScale={resetScale}
        minScale={MIN_SCALE}
        maxScale={MAX_SCALE}
        step={STEP}
        onLoadDeck={onLoadDeck}
      />

      {contextMenu && (
        <CardContextMenu
          card={contextMenu.card}
          x={contextMenu.x}
          y={contextMenu.y}
          actions={goldfishActions}
          zones={state.zones}
          isHandRevealed={false}
          topDeckRevealed={!!state.topDeckRevealed}
          onClose={() => setContextMenu(null)}
          onExchange={(ids) => setExchangeCardIds(ids)}
          onDetach={(id) => {
            const derived = derivedWeaponPositions.get(id);
            detachCard(id, derived?.x, derived?.y);
          }}
        />
      )}

      {multiCardContextMenu && (
        <MultiCardContextMenu
          selectedIds={Array.from(selectedIds)}
          x={multiCardContextMenu.x}
          y={multiCardContextMenu.y}
          actions={goldfishActions}
          zones={state.zones}
          onClose={() => setMultiCardContextMenu(null)}
          onClearSelection={() => { clearSelection(); setMultiCardContextMenu(null); }}
          onExchange={(ids) => setExchangeCardIds(ids)}
        />
      )}

      {zoneMenu && (
        <ZoneContextMenu
          x={zoneMenu.x}
          y={zoneMenu.y}
          spawnX={zoneMenu.spawnX}
          spawnY={zoneMenu.spawnY}
          onClose={() => setZoneMenu(null)}
          onAddOpponentLostSoul={(testament, posX, posY) => addOpponentLostSoul(testament, posX, posY)}
        />
      )}

      {lorMenu && (
        <LorContextMenu
          x={lorMenu.x}
          y={lorMenu.y}
          onAddSoul={() => { addPlayerLostSoul(); setLorMenu(null); }}
          onClose={() => setLorMenu(null)}
        />
      )}

      {deckMenu && (
        <DeckContextMenu
          x={deckMenu.x}
          y={deckMenu.y}
          deckSize={state.zones.deck.length}
          revealedTopCardName={
            state.topDeckRevealed && state.zones.deck[0] && isDanielCard(state.zones.deck[0].cardName, state.zones.deck[0].reference)
              ? state.zones.deck[0].cardName
              : undefined
          }
          onClose={() => setDeckMenu(null)}
          onSearchDeck={() => { setDeckMenu(null); setShowDeckSearch(true); }}
          onLookAtTop={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const n = Math.min(count, deck.length);
            const ids = deck.slice(0, n).map(c => c.instanceId);
            setLookState({ cardIds: ids, title: `Looking at Top ${n}` });
          }}
          onLookAtBottom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const n = Math.min(count, deck.length);
            const ids = deck.slice(-n).map(c => c.instanceId);
            setLookState({ cardIds: ids, title: `Looking at Bottom ${n}` });
          }}
          onLookAtRandom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const n = Math.min(count, deck.length);
            const shuffled = [...deck];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const ids = shuffled.slice(0, n).map(c => c.instanceId);
            setLookState({ cardIds: ids, title: `Looking at Random ${n}` });
          }}
          onShuffleDeck={() => { setDeckMenu(null); shuffleDeck(); }}
          // Top card actions
          onDrawTop={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const handSpace = 16 - state.zones.hand.length;
            if (handSpace <= 0) { showGameToast('Hand is full (max 16 cards)'); return; }
            if (count === 1) drawCard(); else drawMultiple(count);
            if (count > handSpace) {
              showGameToast(`Hand is full — drew ${Math.min(handSpace, deck.length)}`);
            }
          }}
          onRevealTop={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const n = Math.min(count, deck.length);
            const ids = deck.slice(0, n).map(c => c.instanceId);
            setPeekState({ cardIds: ids, title: `Top ${n} of Deck` });
          }}
          onDiscardTop={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const ids = deck.slice(0, Math.min(count, deck.length)).map(c => c.instanceId);
            ids.forEach(id => moveCard(id, 'discard'));
          }}
          onReserveTop={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const ids = deck.slice(0, Math.min(count, deck.length)).map(c => c.instanceId);
            ids.forEach(id => moveCard(id, 'reserve'));
          }}
          // Bottom card actions
          onDrawBottom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const handSpace = 16 - state.zones.hand.length;
            if (handSpace <= 0) { showGameToast('Hand is full (max 16 cards)'); return; }
            // Walk up from the bottom of the deck. With auto-route on, a drawn
            // Lost Soul goes to Land of Bondage without consuming a draw, so we
            // keep walking up to pull a replacement from the next bottom card —
            // same rule as top-of-deck (DRAW_CARD).
            const autoRoute = state.options.autoRouteLostSouls;
            const want = Math.min(count, deck.length, handSpace);
            let drawn = 0;
            for (let i = deck.length - 1; i >= 0 && drawn < want; i--) {
              const c = deck[i];
              const isLS = c.type === 'LS' || c.type === 'Lost Soul' || c.type.toLowerCase().includes('lost soul');
              if (autoRoute && isLS) {
                moveCard(c.instanceId, 'land-of-bondage');
              } else {
                moveCard(c.instanceId, 'hand');
                drawn++;
              }
            }
            if (count > handSpace) {
              showGameToast(`Hand is full — drew ${drawn}`);
            }
          }}
          onRevealBottom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const n = Math.min(count, deck.length);
            const ids = deck.slice(-n).map(c => c.instanceId);
            setPeekState({ cardIds: ids, title: `Bottom ${n} of Deck` });
          }}
          onDiscardBottom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const ids = deck.slice(-Math.min(count, deck.length)).map(c => c.instanceId);
            ids.forEach(id => moveCard(id, 'discard'));
          }}
          onReserveBottom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const ids = deck.slice(-Math.min(count, deck.length)).map(c => c.instanceId);
            ids.forEach(id => moveCard(id, 'reserve'));
          }}
          // Random card actions
          onDrawRandom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const handSpace = 16 - state.zones.hand.length;
            if (handSpace <= 0) { showGameToast('Hand is full (max 16 cards)'); return; }
            const shuffled = [...deck];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const cards = shuffled.slice(0, Math.min(count, deck.length));
            let drawn = 0;
            cards.forEach(c => {
              const isLS = c.type === 'LS' || c.type === 'Lost Soul' || c.type.toLowerCase().includes('lost soul');
              if (isLS) {
                moveCard(c.instanceId, 'land-of-bondage');
              } else if (drawn < handSpace) {
                moveCard(c.instanceId, 'hand');
                drawn++;
              }
            });
            if (count > handSpace) {
              showGameToast(`Hand is full — drew ${drawn}`);
            }
          }}
          onRevealRandom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const shuffled = [...deck];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const n = Math.min(count, deck.length);
            const ids = shuffled.slice(0, n).map(c => c.instanceId);
            setPeekState({ cardIds: ids, title: `Random ${n} from Deck` });
          }}
          onDiscardRandom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const shuffled = [...deck];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const ids = shuffled.slice(0, Math.min(count, deck.length)).map(c => c.instanceId);
            ids.forEach(id => moveCard(id, 'discard'));
          }}
          onReserveRandom={(count) => {
            setDeckMenu(null);
            const deck = state.zones.deck;
            if (deck.length === 0) { showGameToast('Deck is empty'); return; }
            const shuffled = [...deck];
            for (let i = shuffled.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const ids = shuffled.slice(0, Math.min(count, deck.length)).map(c => c.instanceId);
            ids.forEach(id => moveCard(id, 'reserve'));
          }}
        />
      )}

      {soulDeckMenu && (
        <DeckContextMenu
          x={soulDeckMenu.x}
          y={soulDeckMenu.y}
          deckSize={state.zones['soul-deck'].length}
          hideDiscardActions
          hideReserveActions
          onClose={() => setSoulDeckMenu(null)}
          onSearchDeck={searchSoulDeck}
          onShuffleDeck={shuffleSoulDeck}
          onLookAtTop={(n) => lookAtSoulDeck('top', n)}
          onLookAtBottom={(n) => lookAtSoulDeck('bottom', n)}
          onLookAtRandom={(n) => lookAtSoulDeck('random', n)}
          onRevealTop={(n) => revealFromSoulDeck('top', n)}
          onRevealBottom={(n) => revealFromSoulDeck('bottom', n)}
          onRevealRandom={(n) => revealFromSoulDeck('random', n)}
          // Draw moves the card face-up into LoB; Reveal shows a peek modal.
          onDrawTop={(n) => drawFromSoulDeck('top', n)}
          onDrawBottom={(n) => drawFromSoulDeck('bottom', n)}
          onDrawRandom={(n) => drawFromSoulDeck('random', n)}
          // Hidden actions — still required by the prop contract
          onDiscardTop={() => {}}
          onDiscardBottom={() => {}}
          onDiscardRandom={() => {}}
          onReserveTop={() => {}}
          onReserveBottom={() => {}}
          onReserveRandom={() => {}}
        />
      )}

      {hoverCard && (
        <CardHoverPreview
          card={hoverCard.card}
          anchorX={hoverCard.x}
          anchorY={hoverCard.y}
        />
      )}

      <ModalGameProvider value={modalGameValue}>
        {browseZone && (
          <ZoneBrowseModal
            zoneId={browseZone}
            onClose={() => setBrowseZone(null)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            onRequestCardMenu={(card, clientX, clientY) => {
              const container = stageRef.current?.container().getBoundingClientRect();
              setBrowseZone(null);
              setContextMenu({
                card,
                x: clientX - (container?.left ?? 0),
                y: clientY - (container?.top ?? 0),
              });
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

        {peekState !== null && (
          <DeckPeekModal
            cardIds={peekState.cardIds}
            title={peekState.title}
            onClose={() => setPeekState(null)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            sourceZone={peekState.sourceZone}
          />
        )}

        {lookState !== null && (
          <DeckPeekModal
            cardIds={lookState.cardIds}
            title={lookState.title}
            onClose={() => setLookState(null)}
            onStartDrag={modalStartDrag}
            onStartMultiDrag={modalStartMultiDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            isPrivateLook
            sourceZone={lookState.sourceZone}
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
          />
        )}

      {/* Zone drop target highlights — visible during any drag */}
      {(modalDrag.isDragging || canvasDragZone !== null) && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 450 }}>
          {(Object.entries(zoneLayout) as [ZoneId, ZoneRect][]).map(([zoneId, rect]) => {
            // Don't show highlight for the zone the card is being dragged from
            if (!modalDrag.isDragging && dragSourceZoneRef.current === zoneId) return null;
            const activeHoveredZone = modalDrag.isDragging ? modalHoveredZone : canvasDragZone;
            const isHovered = activeHoveredZone === zoneId;
            const screenTopLeft = virtualToScreen(rect.x, rect.y, scale, offsetX, offsetY);
            const screenBottomRight = virtualToScreen(rect.x + rect.width, rect.y + rect.height, scale, offsetX, offsetY);
            return (
              <div
                key={zoneId}
                style={{
                  position: 'absolute',
                  left: screenTopLeft.x,
                  top: screenTopLeft.y,
                  width: screenBottomRight.x - screenTopLeft.x,
                  height: screenBottomRight.y - screenTopLeft.y,
                  border: isHovered ? '1px solid rgba(196,149,90,0.6)' : '1px solid var(--gf-hover)',
                  background: isHovered ? 'rgba(196,149,90,0.12)' : 'transparent',
                  borderRadius: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{
                  color: isHovered ? 'rgba(232,213,163,0.7)' : 'rgba(232,213,163,0.3)',
                  fontSize: 12,
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  textTransform: 'uppercase',
                  letterSpacing: 2,
                }}>
                  {rect.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating drag ghost */}
      {modalDrag.isDragging && modalDrag.imageUrl && (
        modalDrag.additionalCards.length > 0 ? (
          <div
            ref={modalGhostRef as React.RefObject<HTMLDivElement>}
            style={{
              position: 'fixed',
              pointerEvents: 'none',
              zIndex: 700,
            }}
          >
            {/* Stacked offset cards behind (max 2 for performance) */}
            {[...modalDrag.additionalCards.slice(0, 2)].reverse().map((extra, i) => (
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
            {/* Primary card on top */}
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
            {/* Count badge */}
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
              zIndex: 700,
              opacity: 0.9,
            }}
          />
        )
      )}

      {deckDropPopup && (
        <DeckDropPopup
          x={deckDropPopup.x}
          y={deckDropPopup.y}
          onShuffleIn={() => {
            releaseDeckHold(false);
            const ids = batchDeckDropIds || [deckDropPopup.cardInstanceId];
            if (ids.length === 1) {
              moveCard(ids[0], 'deck');
            } else {
              moveCardsBatch(ids, 'deck');
            }
            shuffleDeck();
            setDeckDropPopup(null);
            setBatchDeckDropIds(null);
            if (batchDeckDropIds) clearSelection();
          }}
          onTopDeck={() => {
            releaseDeckHold(false);
            const ids = batchDeckDropIds || [deckDropPopup.cardInstanceId];
            for (const id of ids) {
              moveCardToTopOfDeck(id);
            }
            setDeckDropPopup(null);
            setBatchDeckDropIds(null);
            if (batchDeckDropIds) clearSelection();
          }}
          onBottomDeck={() => {
            releaseDeckHold(false);
            const ids = batchDeckDropIds || [deckDropPopup.cardInstanceId];
            for (const id of ids) {
              moveCardToBottomOfDeck(id);
            }
            setDeckDropPopup(null);
            setBatchDeckDropIds(null);
            if (batchDeckDropIds) clearSelection();
          }}
          onExchange={() => {
            releaseDeckHold(true);
            const ids = batchDeckDropIds || [deckDropPopup.cardInstanceId];
            setExchangeCardIds(ids);
            setDeckDropPopup(null);
            setBatchDeckDropIds(null);
          }}
          onCancel={() => {
            releaseDeckHold(true);
            if (batchDeckDropIds) setCardRenderKey(k => k + 1);
            setDeckDropPopup(null);
            setBatchDeckDropIds(null);
          }}
        />
      )}

      {soulDeckDropPopup && (() => {
        const ids = soulDeckDropPopup.batchIds ?? [soulDeckDropPopup.cardInstanceId];
        return (
          <DeckDropPopup
            x={soulDeckDropPopup.x}
            y={soulDeckDropPopup.y}
            onShuffleIn={() => {
              releaseDeckHold(false);
              for (const id of ids) moveCard(id, 'soul-deck');
              dispatch(gameActionCreators.shuffleSoulDeck());
              setSoulDeckDropPopup(null);
              if (soulDeckDropPopup.batchIds) clearSelection();
            }}
            onTopDeck={() => {
              releaseDeckHold(false);
              for (const id of ids) moveCard(id, 'soul-deck', 0);
              setSoulDeckDropPopup(null);
              if (soulDeckDropPopup.batchIds) clearSelection();
            }}
            onBottomDeck={() => {
              releaseDeckHold(false);
              for (const id of ids) moveCard(id, 'soul-deck');
              setSoulDeckDropPopup(null);
              if (soulDeckDropPopup.batchIds) clearSelection();
            }}
            onCancel={() => {
              releaseDeckHold(true);
              if (soulDeckDropPopup.batchIds) setCardRenderKey(k => k + 1);
              setSoulDeckDropPopup(null);
            }}
          />
        );
      })()}

        {exchangeCardIds && (
          <DeckExchangeModal
            exchangeCardIds={exchangeCardIds}
            onComplete={() => {
              setExchangeCardIds(null);
              clearSelection();
            }}
            onCancel={() => {
              setExchangeCardIds(null);
              setCardRenderKey(k => k + 1);
            }}
            onStartDrag={modalStartDrag}
            didDragRef={modalDidDragRef}
            isDragActive={modalDrag.isDragging}
            validDropRef={modalValidDropRef}
          />
        )}
      </ModalGameProvider>

      <GameToastContainer />
      <CardChoicePromptContainer />
      <DiceRollOverlay />

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
        // Goldfish is single-seat — only player1 has a discard pile of Heroes.
        const heroes = state.zones.discard.filter(c => c.ownerId === 'player1' && isHeroCard(c));
        return (
          <ResurrectHeroesModal
            pages={[{
              ownerId: 'player1',
              playerName: 'You',
              heroes,
              onStartDrag: modalStartDrag,
              onStartMultiDrag: modalStartMultiDrag,
              didDragRef: modalDidDragRef,
            }]}
            isDragActive={modalDrag.isDragging}
            onConfirm={(ids) => {
              dispatch(gameActionCreators.resurrectHeroes(ids));
              setResurrectReq(null);
            }}
            onCancel={() => setResurrectReq(null)}
          />
        );
      })()}

      {keepOneReq && (
        <KeepOneModal
          hand={state.zones.hand}
          onConfirm={(keepInstanceId) => {
            // Empty hand confirms with '' — the reducer treats a missing
            // keeper as a no-op rather than shuffling the whole hand away.
            if (keepInstanceId) dispatch(gameActionCreators.keepOneShuffleDraw(keepInstanceId));
            setKeepOneReq(null);
          }}
          onCancel={() => setKeepOneReq(null)}
        />
      )}
    </>
  );
}
