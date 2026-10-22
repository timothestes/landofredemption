'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { isPrimaryPointer } from '@/app/play/lib/pointerButton';
import { beginCardPress, moveCardPress, cancelCardPress, cardPressFired, consumeCardPressFired, isCardPressLive, type CardPressTracker } from '@/app/shared/utils/modalCardPress';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { useModalGame } from '@/app/shared/contexts/ModalGameContext';
import { ZoneId, ZONE_LABELS, GameCard } from '@/app/shared/types/gameCard';
import { useModalCardHover, ModalCardHoverPreview, getHoverGlowStyle } from './ModalCardHoverPreview';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { useDraggableModal } from '@/app/shared/hooks/useDraggableModal';
import { DraggableTitleBar } from './DraggableTitleBar';
import { compareCardsDefault } from '@/lib/cards/defaultSort';
import { hasUsableAbilityInZone } from '@/lib/cards/cardAbilities';
import { isOnScrollbar } from '@/app/shared/utils/scrollbarHit';

const MOVE_ZONES: { id: ZoneId; label: string }[] = [
  { id: 'hand', label: 'Hand' },
  { id: 'territory', label: 'Territory' },
  { id: 'discard', label: 'Discard' },
  { id: 'reserve', label: 'Reserve' },
];

function CardContextPopup({
  card,
  count,
  x,
  y,
  currentZone,
  onClose,
  onMove,
  onMoveToTop,
  onMoveToBottom,
  onShuffleIntoDeck,
}: {
  card: GameCard;
  count?: number;
  x: number;
  y: number;
  currentZone: ZoneId;
  onClose: () => void;
  onMove: (zone: ZoneId) => void;
  onMoveToTop: () => void;
  onMoveToBottom: () => void;
  onShuffleIntoDeck: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isTouch = useInputMode() === 'touch';

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };
  }, [onClose]);

  const itemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: isTouch ? '11px 16px' : '5px 12px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--gf-text)',
    fontSize: isTouch ? 13 : 11,
    textAlign: 'left',
    fontFamily: 'var(--font-cinzel), Georgia, serif',
  };

  const filteredZones = MOVE_ZONES.filter(z => z.id !== currentZone);
  const label = count && count > 1 ? `Move ${count} cards to...` : 'Move to...';

  return (
    <div
      ref={ref}
      data-modal-keep-open="true"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: Math.max(8, Math.min(x, window.innerWidth - (isTouch ? 200 : 160))),
        top: Math.max(8, Math.min(y, window.innerHeight - (isTouch ? 340 : 300))),
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 900,
        minWidth: 140,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ ...itemStyle, color: 'var(--gf-text-dim)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'default', padding: '3px 12px' }}>
        {label}
      </div>
      {filteredZones.map(({ id, label: zoneLabel }) => (
        <button
          key={id}
          style={itemStyle}
          onClick={() => { onMove(id); onClose(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {zoneLabel}
        </button>
      ))}
      <div style={{ height: 1, background: 'var(--gf-border)', margin: '4px 8px', opacity: 0.5 }} />
      <button
        style={itemStyle}
        onClick={() => { onMoveToTop(); onClose(); }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Top of Deck
      </button>
      <button
        style={itemStyle}
        onClick={() => { onMoveToBottom(); onClose(); }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Bottom of Deck
      </button>
      <button
        style={itemStyle}
        onClick={() => { onShuffleIntoDeck(); onClose(); }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        Shuffle into Deck
      </button>
    </div>
  );
}

// Check if two axis-aligned rectangles overlap
function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

interface ZoneBrowseModalProps {
  zoneId: ZoneId;
  onClose: () => void;
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  onStartMultiDrag?: (cards: { card: GameCard; imageUrl: string }[], e: React.PointerEvent) => void;
  didDragRef?: React.MutableRefObject<boolean>;
  isDragActive?: boolean;
  readOnly?: boolean;
  /** When provided, right-clicking a card that has a right-click ability usable
   *  from its current zone (e.g. a Lost Soul "Harvest" in the Land of
   *  Redemption) defers to the canvas's full card menu — which surfaces the
   *  ability — instead of this modal's move-only popup. Receives viewport
   *  coordinates. */
  onRequestCardMenu?: (card: GameCard, clientX: number, clientY: number) => void;
  /** Route EVERY card to `onRequestCardMenu`, not just ones with a usable
   *  right-click ability. Set when browsing an in-play zone (territory, Land
   *  of Bondage, hand): those cards need rotate/attach/counters/notes/rescue,
   *  none of which the move-only popup below offers. */
  alwaysUseCardMenu?: boolean;
  /** Cards whose FACE the viewer may not see (face-down in-play cards, a hand
   *  not shared with this spectator) render as a card back and never open the
   *  reader or the hover preview. The grid gets raw zone data, so hidden-info
   *  rules have to be answered by the caller. */
  isCardFaceHidden?: (card: GameCard) => boolean;
  /** Read-only viewers (spectators) can't act on a card, but they still need
   *  to READ it — tap / long-press / click opens the caller's card reader. */
  onReadCard?: (card: GameCard) => void;
}

export function ZoneBrowseModal({ zoneId, onClose, onStartDrag, onStartMultiDrag, didDragRef, isDragActive, readOnly, onRequestCardMenu, alwaysUseCardMenu, isCardFaceHidden, onReadCard }: ZoneBrowseModalProps) {
  const { dragHandleProps, modalStyle } = useDraggableModal();
  // Touch has no clicks, lassos or right-clicks — say what actually works.
  const isTouchInput = useInputMode() === 'touch';
  const hintText = readOnly
    ? (onReadCard ? (isTouchInput ? 'Tap a card to read it' : 'Click a card to read it') : null)
    : isTouchInput
      ? (alwaysUseCardMenu
          ? 'Tap a card for its actions'
          : 'Tap to select · Long-press a card for actions')
      : 'Drag to a zone · Click or lasso to select · Right-click for more';
  const { zones, actions } = useModalGame();
  const { moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleCardIntoDeck, shuffleDeck } = actions;
  const rawCards = zones[zoneId] ?? [];
  // Sort reserve in the canonical default order (matches goldfish canvas convention)
  const cards = zoneId === 'reserve'
    ? [...rawCards].sort((a, b) => compareCardsDefault(
        { name: a.cardName, type: a.type, brigade: a.brigade, alignment: a.alignment, strength: a.strength, reference: a.reference },
        { name: b.cardName, type: b.type, brigade: b.brigade, alignment: b.alignment, strength: b.strength, reference: b.reference },
      ))
    : rawCards;
  // Field of Battle only: both sides share the grid, so per-card owner badges
  // are what distinguish attacker from blocker (see ownerBadge below).
  const battleMixedOwners =
    zoneId === 'battle' && new Set(cards.map((c) => c.ownerId)).size > 1;
  const { setPreviewCard, isLoupeVisible } = useCardPreview();
  const { hover, hoverProgress, hoveredCardId, onCardMouseEnter, onCardMouseLeave } = useModalCardHover(200, { setPreviewCard, isLoupeVisible });
  const [contextCard, setContextCard] = useState<{ card: GameCard; x: number; y: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [leaveOpen, setLeaveOpen] = useState(false);

  // Refs for card DOM elements (for lasso hit-testing)
  const cardElRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const registerCardEl = useCallback((instanceId: string, el: HTMLDivElement | null) => {
    if (el) cardElRefs.current.set(instanceId, el);
    else cardElRefs.current.delete(instanceId);
  }, []);

  // Lasso selection state
  const gridRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [lassoRect, setLassoRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const lassoStart = useRef<{ x: number; y: number } | null>(null);
  const isLassoing = useRef(false);

  // Close modal after a successful drag-to-canvas completes (unless "leave open" is on).
  // Use refs for onClose/leaveOpen so the effect only re-runs when isDragActive
  // changes — not when callback references are recreated by subscription updates.
  const leaveOpenRef = useRef(leaveOpen);
  leaveOpenRef.current = leaveOpen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Timestamp of last drag end — used by the backdrop click handler as a reliable
  // guard against the spurious click that fires when mousedown-on-card + mouseup-on-backdrop
  // occur during a drag gesture. didDragRef alone can race with React's re-render cycle.
  const dragEndTimeRef = useRef(0);

  const prevDragActive = useRef(false);
  useEffect(() => {
    if (prevDragActive.current && !isDragActive) {
      dragEndTimeRef.current = Date.now();
      setSelectedIds(new Set());
      if (!leaveOpenRef.current) {
        onCloseRef.current();
      }
      if (didDragRef) didDragRef.current = false;
    }
    prevDragActive.current = !!isDragActive;
  }, [isDragActive]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedIds.size > 0) {
          setSelectedIds(new Set());
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, selectedIds.size]);

  // Outside-click / outside-right-click behavior. The backdrop is
  // pointer-events: none so cards underneath can fire hover previews, so we
  // detect "click outside the modal box" here instead of on the backdrop.
  useEffect(() => {
    const isInside = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (contentRef.current?.contains(target)) return true;
      return !!target.closest('[data-modal-keep-open]');
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (isInside(e.target)) return;
      if (isPrimaryPointer(e) && !didDragRef?.current && Date.now() - dragEndTimeRef.current > 300) {
        setContextCard(null);
        onClose();
      }
    };
    const handleContextMenu = (e: MouseEvent) => {
      if (isInside(e.target)) return;
      e.preventDefault();
      setContextCard(null);
    };

    document.addEventListener('mousedown', handleMouseDown);

    document.addEventListener('touchstart', handleMouseDown);
    document.addEventListener('contextmenu', handleContextMenu);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('touchstart', handleMouseDown);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [onClose, didDragRef]);

  const openCardMenu = (card: GameCard, clientX: number, clientY: number) => {
    if (readOnly) return;
    onCardMouseLeave();
    // A card with a right-click ability usable from this zone (e.g. a Lost Soul
    // "Harvest" in the Land of Redemption) defers to the canvas's full card
    // menu so the ability is reachable. Multi-selections keep the batch-move
    // popup below.
    const isMultiSelected = selectedIds.has(card.instanceId) && selectedIds.size > 1;
    if (onRequestCardMenu && !isMultiSelected && (alwaysUseCardMenu || hasUsableAbilityInZone(card))) {
      onRequestCardMenu(card, clientX, clientY);
      return;
    }
    setContextCard({ card, x: clientX, y: clientY });
    // Re-set the loupe preview so it keeps showing the right-clicked card
    setPreviewCard({ cardName: card.cardName, cardImgFile: card.cardImgFile, isMeek: card.isMeek });
  };

  const handleCardContextMenu = (card: GameCard, e: React.MouseEvent) => {
    e.preventDefault();
    openCardMenu(card, e.clientX, e.clientY);
  };

  // Track pointer down card to distinguish click from drag on pointer up
  const pointerDownCardRef = useRef<string | null>(null);
  const cardPressRef = useRef<CardPressTracker | null>(null);

  const handlePointerDown = (card: GameCard, imageUrl: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (readOnly) {
      // Track the press so handlePointerUp can turn a clean click into
      // "read this card" — the only interaction a read-only viewer has.
      pointerDownCardRef.current = card.instanceId;
      return;
    }
    onCardMouseLeave();
    pointerDownCardRef.current = card.instanceId;

    // Reset didDragRef so we can detect if a drag fires before pointerUp
    if (didDragRef) didDragRef.current = false;

    // Touch: no drag from the modal — it fights native scrolling. Tap still
    // selects; the long-press menu moves cards.
    if (e.pointerType === 'touch') return;

    const isSelected = selectedIds.has(card.instanceId);
    if (isSelected && selectedIds.size > 1 && onStartMultiDrag) {
      // Multi-card drag: gather all selected cards
      const allSelected = cards.filter(c => selectedIds.has(c.instanceId));
      onStartMultiDrag(
        allSelected.map(c => ({ card: c, imageUrl: getCardImageUrl(c.cardImgFile) })),
        e,
      );
    } else if (onStartDrag) {
      onStartDrag(card, imageUrl, e);
    }
  };

  const handlePointerUp = (card: GameCard, e?: React.PointerEvent) => {
    // Only toggle selection if this was a click (no drag occurred) on the same card
    if (pointerDownCardRef.current !== card.instanceId) return;
    pointerDownCardRef.current = null;
    if (consumeCardPressFired(cardPressRef)) return;
    if (readOnly) {
      // Touch opens the reader from onTouchEnd (see below) so the tap's
      // synthesized click can be suppressed; pointer clicks open it here.
      if (e?.pointerType !== 'touch' && onReadCard && !(isCardFaceHidden?.(card) ?? false)) {
        onReadCard(card);
      }
      return;
    }
    if (didDragRef?.current) {
      didDragRef.current = false;
      return;
    }
    // Browsing an in-play zone on touch: the grid exists BECAUSE the card is
    // hard to hit on the board, so a tap should do the thing the player came
    // for. There is no batch-move use for a territory, and requiring a second
    // long-press to reach any action is the friction this sheet is meant to
    // remove. Pile grids keep tap-to-select for their multi-card moves.
    // The menu itself opens from onTouchEnd, NOT here: pointerup fires before
    // touchend, and opening on pointerup flushed the unmount/mount before the
    // tap's synthesized click was suppressible — the click then landed on the
    // just-mounted menu sheet (e.g. its counter "+" row) under the finger.
    if (alwaysUseCardMenu && e?.pointerType === 'touch' && !readOnly) {
      return;
    }
    setContextCard(null);
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(card.instanceId)) {
        next.delete(card.instanceId);
      } else {
        next.add(card.instanceId);
      }
      return next;
    });
  };

  // Lasso selection: pointer down on empty space in the content area starts lasso
  const handleContentPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Block lasso on interactive elements (buttons, card images, inputs)
    const target = e.target as HTMLElement;
    const tag = target.tagName.toLowerCase();
    if (tag === 'button' || tag === 'img' || tag === 'input') return;
    // Block lasso if clicking inside a card element (has data-card-id)
    if (target.closest('[data-card-id]')) return;
    // A grab on the grid's native scrollbar lands on the scroll container
    // itself; it is not a click on empty space, so keep the selection.
    if (isOnScrollbar(target, e.clientX, e.clientY)) return;
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const x = e.clientX - rect.left + grid.scrollLeft;
    const y = e.clientY - rect.top + grid.scrollTop;
    lassoStart.current = { x, y };
    isLassoing.current = true;
    setLassoRect(null);
    // Clear selection unless shift is held
    if (!e.shiftKey) {
      setSelectedIds(new Set());
    }
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!isLassoing.current || !lassoStart.current || !gridRef.current) return;
      const grid = gridRef.current;
      const rect = grid.getBoundingClientRect();
      const currentX = e.clientX - rect.left + grid.scrollLeft;
      const currentY = e.clientY - rect.top + grid.scrollTop;
      const sx = Math.min(lassoStart.current.x, currentX);
      const sy = Math.min(lassoStart.current.y, currentY);
      const sw = Math.abs(currentX - lassoStart.current.x);
      const sh = Math.abs(currentY - lassoStart.current.y);

      setLassoRect({ x: sx, y: sy, w: sw, h: sh });

      // Hit-test cards against lasso rect
      if (sw > 5 || sh > 5) {
        const hits = new Set<string>();
        for (const [instanceId, el] of cardElRefs.current) {
          const cardRect = el.getBoundingClientRect();
          // Convert card rect to grid-relative coordinates
          const cx = cardRect.left - rect.left + grid.scrollLeft;
          const cy = cardRect.top - rect.top + grid.scrollTop;
          if (rectsOverlap(sx, sy, sw, sh, cx, cy, cardRect.width, cardRect.height)) {
            hits.add(instanceId);
          }
        }
        setSelectedIds(hits);
      }
    };

    const onUp = () => {
      if (isLassoing.current) {
        isLassoing.current = false;
        lassoStart.current = null;
        setLassoRect(null);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  // Multi-card context menu handlers
  const handleMultiMove = (zone: ZoneId) => {
    const ids = Array.from(selectedIds);
    moveCardsBatch(ids, zone);
    setSelectedIds(new Set());
    setContextCard(null);
  };

  const handleMultiTopDeck = () => {
    for (const id of selectedIds) moveCardToTopOfDeck(id);
    setSelectedIds(new Set());
    setContextCard(null);
  };

  const handleMultiBottomDeck = () => {
    for (const id of selectedIds) moveCardToBottomOfDeck(id);
    setSelectedIds(new Set());
    setContextCard(null);
  };

  const handleMultiShuffleIntoDeck = () => {
    const ids = [...selectedIds];
    if (ids.length === 1) {
      shuffleCardIntoDeck(ids[0]);
    } else {
      moveCardsBatch(ids, 'deck');
      shuffleDeck();
    }
    setSelectedIds(new Set());
    setContextCard(null);
  };

  // Determine if context card is part of a multi-selection
  const isMultiContext = contextCard && selectedIds.has(contextCard.card.instanceId) && selectedIds.size > 1;

  // When the right panel (loupe + chat) is expanded, don't dim it
  const panelWidth = isLoupeVisible ? 'clamp(280px, 20vw, 380px)' : '36px';

  const gridColumns = zoneId === 'hand' ? 4 : 5;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed',
        inset: 0,
        right: panelWidth,
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500,
        pointerEvents: 'none',
      }}
    >
      <div
        ref={contentRef}
        onClick={() => setContextCard(null)}
        onPointerDown={handleContentPointerDown}
        style={{
          background: 'var(--gf-bg)',
          border: '1px solid var(--gf-border)',
          borderRadius: 8,
          padding: 20,
          maxWidth: gridColumns === 4 ? 680 : 850,
          maxHeight: '85vh',
          width: '90vw',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          opacity: isDragActive ? 0.15 : 1,
          pointerEvents: isDragActive ? 'none' : 'auto',
          transition: 'opacity 0.2s ease',
          ...modalStyle,
        }}
      >
        <DraggableTitleBar
          dragHandleProps={dragHandleProps}
          title={`${ZONE_LABELS[zoneId]} (${cards.length})`}
          onClose={onClose}
        >
          {selectedIds.size > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                color: 'var(--gf-accent)',
                fontSize: 12,
                fontFamily: 'var(--font-cinzel), Georgia, serif',
              }}>
                {selectedIds.size} selected
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); setSelectedIds(new Set()); }}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--gf-border)',
                  borderRadius: 4,
                  color: 'var(--gf-text-dim)',
                  fontSize: 10,
                  padding: '2px 6px',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                }}
              >
                Deselect
              </button>
            </div>
          )}
        </DraggableTitleBar>

        {/* Read-only hint — spectators still get told the one thing a tap does. */}
        {readOnly && hintText && (
          <div style={{ marginBottom: 12 }}>
            <span style={{ color: 'var(--gf-border)', fontSize: 10 }}>{hintText}</span>
          </div>
        )}

        {/* Hint + leave open toggle */}
        {!readOnly && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ color: 'var(--gf-border)', fontSize: 10 }}>
              {hintText}
            </span>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--gf-text-dim)',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 3,
                  border: leaveOpen ? '1.5px solid var(--gf-accent)' : '1.5px solid var(--gf-border)',
                  background: leaveOpen ? 'rgba(var(--gf-accent-rgb), 0.25)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                {leaveOpen && (
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5L4.5 7.5L8 3" stroke="#e8d5a3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <input
                type="checkbox"
                checked={leaveOpen}
                onChange={(e) => setLeaveOpen(e.target.checked)}
                className="sr-only"
              />
              Leave open
            </label>
          </div>
        )}

        {cards.length === 0 ? (
          <p style={{ color: 'var(--gf-text-dim)', fontStyle: 'italic' }}>Empty</p>
        ) : (
          <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
          <div
            ref={gridRef}
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${gridColumns}, 1fr)`,
              gap: 10,
              position: 'relative',
              userSelect: 'none',
              cursor: readOnly ? 'default' : 'crosshair',
            }}
          >
            {cards.map((card) => {
              // Hidden-info gate: render a card back and keep every read path
              // (reader, hover preview) inert for faces this viewer may not see.
              const faceHidden = isCardFaceHidden?.(card) ?? false;
              const imageUrl = faceHidden ? '/gameplay/cardback.webp' : getCardImageUrl(card.cardImgFile);
              const isSelected = selectedIds.has(card.instanceId);
              // Field of Battle merges both sides into one grid, and a
              // contested pair renders stacked on the board — this grid is
              // how a phone player tells attacker from blocker, so each card
              // says whose it is. ownerId is the viewer-relative seat label
              // ('player1' = mine), not a player id. Only shown when the
              // grid actually mixes owners (goldfish battle stays unbadged).
              const ownerBadge =
                zoneId === 'battle' && battleMixedOwners
                  ? (card.ownerId === 'player1' ? 'Yours' : 'Theirs')
                  : null;
              return (
                <div
                  key={card.instanceId}
                  ref={(el) => registerCardEl(card.instanceId, el)}
                  data-card-id={card.instanceId}
                  style={{ position: 'relative', cursor: 'grab' }}
                  onPointerDown={(e) => { e.stopPropagation(); handlePointerDown(card, imageUrl, e); }}
                  onPointerUp={(e) => handlePointerUp(card, e)}
                  onTouchStart={(e) => beginCardPress(cardPressRef, e, (px, py) => {
                    if (readOnly) {
                      // Long-press for a read-only viewer opens the reader.
                      if (onReadCard && !faceHidden) onReadCard(card);
                      return;
                    }
                    openCardMenu(card, px, py);
                  })}
                  onTouchMove={(e) => moveCardPress(cardPressRef, e)}
                  onTouchEnd={(e) => {
                    if (cardPressFired(cardPressRef)) {
                      e.preventDefault();
                    } else if (readOnly && onReadCard && !faceHidden && isCardPressLive(cardPressRef)) {
                      // Clean tap in a read-only grid = read the card. Same
                      // preventDefault-first ordering as the action path below.
                      e.preventDefault();
                      onReadCard(card);
                    } else if (alwaysUseCardMenu && !readOnly && isCardPressLive(cardPressRef)) {
                      // A clean tap on an in-play grid card opens the full card
                      // menu. preventDefault FIRST, while this node is still
                      // mounted — that suppresses the tap's synthesized mouse
                      // events so no ghost click reaches whatever mounts next.
                      // A scrolled press reads not-live (moveCardPress), so a
                      // grid scroll can no longer open a menu on release.
                      e.preventDefault();
                      const t = e.changedTouches[0];
                      if (t) openCardMenu(card, t.clientX, t.clientY);
                    }
                    cancelCardPress(cardPressRef);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => handleCardContextMenu(card, e)}
                  onMouseEnter={(e) => { if (!contextCard && !faceHidden) onCardMouseEnter(card.cardImgFile, card.cardName, e, card.instanceId); }}
                  onMouseLeave={onCardMouseLeave}
                >
                  {(() => {
                    const isHoveredCard = hoveredCardId === card.instanceId && !isSelected;
                    const glowStyle = isHoveredCard ? getHoverGlowStyle(hoverProgress) : undefined;
                    const selectedShadow = isSelected ? '0 0 8px rgba(var(--gf-accent-rgb), 0.4)' : 'none';
                    return imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={faceHidden ? 'Face-down card' : card.cardName}
                        draggable={false}
                        style={{
                          width: '100%',
                          borderRadius: 4,
                          border: isSelected ? '2px solid var(--gf-accent)' : '1px solid var(--gf-border)',
                          boxShadow: glowStyle?.boxShadow ?? selectedShadow,
                          filter: card.zone === 'banish' ? 'grayscale(0.55) brightness(0.78)' : undefined,
                          transition: 'border 0.1s ease',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '1/1.4',
                          background: 'rgb(var(--gf-panel-rgb))',
                          border: isSelected ? '2px solid var(--gf-accent)' : '1px solid var(--gf-border)',
                          boxShadow: glowStyle?.boxShadow ?? selectedShadow,
                          borderRadius: 4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--gf-text-dim)',
                          fontSize: 10,
                          transition: 'border 0.1s ease',
                        }}
                      >
                        {faceHidden ? 'Face-down card' : card.cardName}
                      </div>
                    );
                  })()}
                  {ownerBadge && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 4,
                        left: 4,
                        padding: '1px 6px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.04em',
                        pointerEvents: 'none',
                        // Identity colour (amber = mine, blue = theirs): never themed.
                        background: ownerBadge === 'Yours' ? 'rgba(60, 42, 16, 0.92)' : 'rgba(16, 32, 60, 0.92)',
                        border: `1px solid ${ownerBadge === 'Yours' ? 'rgba(196, 149, 90, 0.7)' : 'rgba(100, 149, 237, 0.7)'}`,
                        color: ownerBadge === 'Yours' ? '#e8d5a3' : '#a3c5e8',
                      }}
                    >
                      {ownerBadge}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Lasso selection rectangle */}
            {lassoRect && lassoRect.w > 5 && lassoRect.h > 5 && (
              <div
                style={{
                  position: 'absolute',
                  left: lassoRect.x,
                  top: lassoRect.y,
                  width: lassoRect.w,
                  height: lassoRect.h,
                  border: '2px dashed var(--gf-accent)',
                  background: 'rgba(var(--gf-accent-rgb), 0.15)',
                  borderRadius: 2,
                  pointerEvents: 'none',
                  zIndex: 100,
                }}
              />
            )}
          </div>
          </div>
        )}
      </div>

      {!readOnly && contextCard && (
        isMultiContext ? (
          <CardContextPopup
            card={contextCard.card}
            count={selectedIds.size}
            x={contextCard.x}
            y={contextCard.y}
            currentZone={zoneId}
            onClose={() => setContextCard(null)}
            onMove={handleMultiMove}
            onMoveToTop={handleMultiTopDeck}
            onMoveToBottom={handleMultiBottomDeck}
            onShuffleIntoDeck={handleMultiShuffleIntoDeck}
          />
        ) : (
          <CardContextPopup
            card={contextCard.card}
            x={contextCard.x}
            y={contextCard.y}
            currentZone={zoneId}
            onClose={() => setContextCard(null)}
            onMove={(zone) => moveCard(contextCard.card.instanceId, zone)}
            onMoveToTop={() => moveCardToTopOfDeck(contextCard.card.instanceId)}
            onMoveToBottom={() => moveCardToBottomOfDeck(contextCard.card.instanceId)}
            onShuffleIntoDeck={() => shuffleCardIntoDeck(contextCard.card.instanceId)}
          />
        )
      )}

      <ModalCardHoverPreview hover={hover} />
    </motion.div>
  );
}
