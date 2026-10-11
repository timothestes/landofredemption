'use client';

import { motion } from 'framer-motion';
import { isPrimaryPointer } from '@/app/play/lib/pointerButton';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { beginCardPress, moveCardPress, cancelCardPress, cardPressFired, consumeCardPressFired, type CardPressTracker } from '@/app/shared/utils/modalCardPress';
import { useModalGame } from '@/app/shared/contexts/ModalGameContext';
import { GameCard, ZoneId } from '@/app/shared/types/gameCard';
import { ArrowUp, ArrowDown, Shuffle } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useModalCardHover, ModalCardHoverPreview, getHoverGlowStyle } from './ModalCardHoverPreview';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { useDraggableModal } from '@/app/shared/hooks/useDraggableModal';
import { DraggableTitleBar } from './DraggableTitleBar';
import { isOnScrollbar } from '@/app/shared/utils/scrollbarHit';

const MOVE_ZONES: { id: ZoneId; label: string }[] = [
  { id: 'hand', label: 'Hand' },
  { id: 'territory', label: 'Territory' },
  { id: 'discard', label: 'Discard' },
  { id: 'reserve', label: 'Reserve' },
];

const LOST_SOUL_MOVE_ZONES: { id: ZoneId; label: string }[] = [
  { id: 'land-of-bondage', label: 'Land of Bondage' },
];

function isLostSoul(card: GameCard): boolean {
  return (
    card.type === 'LS' ||
    card.type === 'Lost Soul' ||
    card.type.toLowerCase().includes('lost soul') ||
    card.cardName.toLowerCase().startsWith('lost soul')
  );
}

function PeekCardContextPopup({
  card, count, x, y, onClose, onMove, onMoveToTop, onMoveToBottom, onShuffleIn, sourceZone = 'deck',
}: {
  card: GameCard; count?: number; x: number; y: number;
  onClose: () => void; onMove: (zone: ZoneId) => void;
  onMoveToTop: () => void; onMoveToBottom: () => void; onShuffleIn: () => void;
  sourceZone?: ZoneId;
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
    display: 'block', width: '100%', padding: isTouch ? '11px 16px' : '5px 12px', background: 'transparent',
    border: 'none', cursor: 'pointer', color: 'var(--gf-text)', fontSize: isTouch ? 13 : 11,
    textAlign: 'left', fontFamily: 'var(--font-cinzel), Georgia, serif',
  };
  const label = count && count > 1 ? `Move ${count} cards to...` : 'Move to...';

  return (
    <div ref={ref} data-modal-keep-open="true" onClick={(e) => e.stopPropagation()} style={{
      position: 'fixed', left: Math.max(8, Math.min(x, window.innerWidth - (isTouch ? 200 : 160))),
      top: Math.max(8, Math.min(y, window.innerHeight - (isTouch ? 340 : 300))), background: 'var(--gf-bg)',
      border: '1px solid var(--gf-border)', borderRadius: 6, padding: '4px 0',
      zIndex: 1000, minWidth: 140, boxShadow: '0 8px 24px rgba(0,0,0,0.6)', pointerEvents: 'auto',
    }}>
      <div style={{ ...itemStyle, color: 'var(--gf-text-dim)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'default', padding: '3px 12px' }}>
        {label}
      </div>
      {(isLostSoul(card) ? LOST_SOUL_MOVE_ZONES : MOVE_ZONES).map(({ id, label: zoneLabel }) => (
        <button key={id} style={itemStyle}
          onClick={() => { onMove(id); onClose(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >{zoneLabel}</button>
      ))}
      {sourceZone === 'deck' && (
        <>
          <div style={{ height: 1, background: 'var(--gf-border)', margin: '4px 8px', opacity: 0.5 }} />
          <button style={itemStyle} onClick={() => { onMoveToTop(); onClose(); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >Top of Deck</button>
          <button style={itemStyle} onClick={() => { onMoveToBottom(); onClose(); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >Bottom of Deck</button>
          <button style={itemStyle} onClick={() => { onShuffleIn(); onClose(); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >Shuffle into Deck</button>
        </>
      )}
    </div>
  );
}

function PeekActionButton({ icon, label, onClick, style }: {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  const isTouch = useInputMode() === 'touch';
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        minHeight: isTouch ? 40 : undefined,
        padding: isTouch ? '8px 14px' : '5px 12px',
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 5,
        color: 'var(--gf-text-bright)',
        fontSize: 12,
        fontFamily: 'var(--font-cinzel), Georgia, serif',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#3d2e1a';
        e.currentTarget.style.borderColor = 'var(--gf-accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--gf-bg)';
        e.currentTarget.style.borderColor = 'var(--gf-border)';
      }}
    >
      {icon}
      {label}
    </button>
  );
}

// Check if two axis-aligned rectangles overlap
function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

interface DeckPeekModalProps {
  cardIds: string[];
  title: string;
  onClose?: () => void;
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  onStartMultiDrag?: (cards: { card: GameCard; imageUrl: string }[], e: React.PointerEvent) => void;
  didDragRef?: React.MutableRefObject<boolean>;
  isDragActive?: boolean;
  /** When true, shows a "private" indicator — only you can see these cards */
  isPrivateLook?: boolean;
  /** Zone to look up peeked cards in. Defaults to 'deck'. */
  sourceZone?: ZoneId;
}

export function DeckPeekModal({ cardIds, title, onClose, onStartDrag, onStartMultiDrag, didDragRef, isDragActive, isPrivateLook, sourceZone = 'deck' }: DeckPeekModalProps) {
  const { dragHandleProps, modalStyle } = useDraggableModal();
  const { zones, actions } = useModalGame();
  const { moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleDeck, shuffleCardIntoDeck } = actions;
  const { setPreviewCard, isLoupeVisible } = useCardPreview();
  const { hover, hoverProgress, hoveredCardId, onCardMouseEnter, onCardMouseLeave } = useModalCardHover(200, { setPreviewCard, isLoupeVisible });

  // Guard against stray click events closing the modal immediately after mount
  const [readyForClose, setReadyForClose] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReadyForClose(true), 150);
    return () => clearTimeout(timer);
  }, []);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [keepOpen, setKeepOpen] = useState(true);

  // Timestamp of last drag end — used by the backdrop click handler as a reliable
  // guard against the spurious click that fires when mousedown-on-card + mouseup-on-backdrop
  // occur during a drag gesture. didDragRef alone can race with React's re-render cycle.
  const dragEndTimeRef = useRef(0);

  const prevDragActive = useRef(false);
  useEffect(() => {
    if (prevDragActive.current && !isDragActive) {
      dragEndTimeRef.current = Date.now();
      setSelectedIds(new Set());
      if (didDragRef) didDragRef.current = false;
    }
    prevDragActive.current = !!isDragActive;
  }, [isDragActive]);

  // Context menu state
  const [contextCard, setContextCard] = useState<{ card: GameCard; x: number; y: number } | null>(null);
  const isTouch = useInputMode() === 'touch';
  const cardPressRef = useRef<CardPressTracker | null>(null);

  const openCardMenu = (card: GameCard, clientX: number, clientY: number) => {
    if (!onClose) return; // Read-only mode (opponent viewing reveal)
    setContextCard({ card, x: clientX, y: clientY });
  };

  const handleCardContextMenu = (card: GameCard, e: React.MouseEvent) => {
    if (!onClose) return; // Read-only mode (opponent viewing reveal)
    e.preventDefault();
    e.stopPropagation();
    openCardMenu(card, e.clientX, e.clientY);
  };

  // Ref for the inner modal box — used for outside-click detection so the
  // backdrop can stay pointer-events: none (letting hover previews reach the
  // game board cards underneath).
  const modalBoxRef = useRef<HTMLDivElement>(null);

  // Refs for card DOM elements (for lasso hit-testing)
  const cardElRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const registerCardEl = useCallback((instanceId: string, el: HTMLDivElement | null) => {
    if (el) cardElRefs.current.set(instanceId, el);
    else cardElRefs.current.delete(instanceId);
  }, []);

  // Lasso selection state
  const gridRef = useRef<HTMLDivElement>(null);
  const [lassoRect, setLassoRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const lassoStart = useRef<{ x: number; y: number } | null>(null);
  const isLassoing = useRef(false);

  // Snapshot the card IDs on mount so the list is stable
  const [peekedIds] = useState(() => cardIds);

  // Track cards that have been committed to a new deck position (top/bottom/shuffle)
  // via the context menu — they should leave the peek view even though they remain
  // in the deck zone.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

  // Derive live cards from current state (they may have been moved already)
  const peekedCards = peekedIds
    .map(id => (zones[sourceZone] ?? []).find(c => c.instanceId === id))
    .filter((c): c is GameCard => !!c && !removedIds.has(c.instanceId));

  const remainingIds = peekedCards.map(c => c.instanceId);
  const hasRemaining = remainingIds.length > 0;

  // Auto-close when all revealed cards have been moved
  useEffect(() => {
    if (!hasRemaining && peekedIds.length > 0 && onClose && !keepOpen) {
      onClose();
    }
  }, [hasRemaining, keepOpen]);

  const handleCloseAction = (action: 'top' | 'bottom' | 'shuffle') => {
    if (!onClose) return;
    if (hasRemaining) {
      if (action === 'top') {
        // Skip if the peeked cards are already at the top of the deck in
        // peek order (the common case when peeking the TOP of deck — no-op).
        // Otherwise (bottom-peek / random-peek), actively move them.
        const deck = zones[sourceZone] ?? [];
        const alreadyOnTop = remainingIds.every((id, i) => deck[i]?.instanceId === id);
        if (!alreadyOnTop) {
          // Iterate in reverse so remainingIds[0] ends up topmost
          // (moveCardToTopOfDeck unshifts — last call wins).
          for (let i = remainingIds.length - 1; i >= 0; i--) {
            moveCardToTopOfDeck(remainingIds[i]);
          }
        }
      } else if (action === 'bottom') {
        // move_cards_batch to 'deck' preserves each card's existing zoneIndex,
        // so peeked cards wouldn't actually move. Use move_card_to_bottom_of_deck
        // per-card, which assigns maxIndex + 1.
        for (const id of remainingIds) moveCardToBottomOfDeck(id);
      } else if (action === 'shuffle') {
        shuffleDeck();
      }
    }
    onClose();
  };

  // Dismissing without an explicit choice (X / Escape / click-away) leaves the
  // deck untouched: peeking never moves cards, so doing nothing is what puts
  // them back where they came from. Reordering here instead would relocate a
  // bottom/random peek to the top and hand it to the next draw. The footer
  // buttons remain the way to say "put these somewhere else".
  const handleDismiss = () => {
    onClose?.();
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedIds.size > 0) {
          setSelectedIds(new Set());
        } else {
          handleDismiss();
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
    if (!onClose) return;
    const isInside = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (modalBoxRef.current?.contains(target)) return true;
      return !!target.closest('[data-modal-keep-open]');
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (isInside(e.target)) return;
      if (isPrimaryPointer(e) && readyForClose && !didDragRef?.current && Date.now() - dragEndTimeRef.current > 300) {
        handleDismiss();
      }
    };
    const handleContextMenu = (e: MouseEvent) => {
      if (isInside(e.target)) return;
      e.preventDefault();
    };

    document.addEventListener('mousedown', handleMouseDown);

    document.addEventListener('touchstart', handleMouseDown);
    document.addEventListener('contextmenu', handleContextMenu);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('touchstart', handleMouseDown);
      document.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [onClose, readyForClose, didDragRef]);

  // Track pointer down card to distinguish click from drag on pointer up
  const pointerDownCardRef = useRef<string | null>(null);

  const handlePointerDown = (card: GameCard, imageUrl: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onCardMouseLeave();
    pointerDownCardRef.current = card.instanceId;

    // Reset didDragRef so we can detect if a drag fires before pointerUp
    if (didDragRef) didDragRef.current = false;

    // Touch: no drag from the modal — it fights native scrolling. Tap still
    // selects; the long-press menu moves cards.
    if (e.pointerType === 'touch') return;

    const isSelected = selectedIds.has(card.instanceId);
    if (isSelected && selectedIds.size > 1 && onStartMultiDrag) {
      // Multi-card drag: gather all selected cards that are still in the deck
      const allSelected = peekedCards.filter(c => selectedIds.has(c.instanceId));
      onStartMultiDrag(
        allSelected.map(c => ({ card: c, imageUrl: getCardImageUrl(c.cardImgFile) })),
        e,
      );
    } else if (onStartDrag) {
      onStartDrag(card, imageUrl, e);
    }
  };

  const handlePointerUp = (card: GameCard) => {
    // Only toggle selection if this was a click (no drag occurred) on the same card
    if (pointerDownCardRef.current !== card.instanceId) return;
    pointerDownCardRef.current = null;
    if (consumeCardPressFired(cardPressRef)) return;
    if (didDragRef?.current) {
      didDragRef.current = false;
      return;
    }
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
    if (!onClose) return; // Read-only mode
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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        right: isLoupeVisible ? 'clamp(280px, 20vw, 380px)' : '36px',
        background: 'transparent',
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div ref={modalBoxRef} style={modalStyle}>
      <motion.div
        data-peek-modal
        initial={false}
        animate={{ opacity: isDragActive ? 0.15 : 1, scale: 1 }}
        transition={{ opacity: { duration: 0.2 } }}
        onPointerDown={handleContentPointerDown}
        style={{
          background: '#1e1610',
          border: '1px solid var(--gf-border)',
          borderRadius: 8,
          padding: 20,
          width: `min(90vw, ${Math.min(peekedIds.length, 4) * 152 + 40}px)`,
          maxHeight: '85vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          pointerEvents: isDragActive ? 'none' : 'auto',
        }}
      >
        <DraggableTitleBar
          dragHandleProps={dragHandleProps}
          title={title}
          onClose={onClose ? handleDismiss : undefined}
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

        <div data-peek-scroll style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            color: isPrivateLook ? 'var(--gf-accent)' : 'var(--gf-text-dim)',
            fontSize: 11,
            margin: 0,
          }}>
            {isPrivateLook
              ? (isTouch ? 'Only you can see this \u00b7 Tap to select \u00b7 Long-press for actions' : 'Only you can see this \u00b7 Drag to a zone \u00b7 Click to select')
              : onClose
                ? (isTouch ? 'Tap to select \u00b7 Long-press a card for actions' : 'Drag to a zone \u00b7 Click to select \u00b7 Lasso to multi-select')
                : 'Your opponent is revealing cards'}
          </p>
          {onClose && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--gf-text-dim)',
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'var(--font-cinzel), Georgia, serif',
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 3,
                  border: keepOpen ? '1.5px solid #c4955a' : '1.5px solid var(--gf-border)',
                  background: keepOpen ? 'rgba(196, 149, 90, 0.25)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                {keepOpen && (
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5L4.5 7.5L8 3" stroke="#e8d5a3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <input
                type="checkbox"
                checked={keepOpen}
                onChange={(e) => setKeepOpen(e.target.checked)}
                className="sr-only"
              />
              Keep open
            </label>
          )}
        </div>

        {peekedCards.length === 0 ? (
          <p style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            color: 'var(--gf-border)',
            fontSize: 13,
            textAlign: 'center',
            padding: 20,
          }}>
            All revealed cards have been moved
          </p>
        ) : (
          <div
            ref={gridRef}
            data-peek-grid
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(peekedIds.length, 4)}, minmax(140px, 1fr))`,
              gap: 12,
              position: 'relative',
              userSelect: 'none',
            }}
          >
            {peekedCards.map((card) => {
              const imageUrl = getCardImageUrl(card.cardImgFile);
              const isSelected = selectedIds.has(card.instanceId);
              return (
                <div
                  key={card.instanceId}
                  ref={(el) => registerCardEl(card.instanceId, el)}
                  data-card-id={card.instanceId}
                  style={{ position: 'relative', cursor: onClose ? 'grab' : 'default' }}
                  onPointerDown={onClose ? (e) => { e.stopPropagation(); handlePointerDown(card, imageUrl, e); } : undefined}
                  onPointerUp={onClose ? () => handlePointerUp(card) : undefined}
                  onTouchStart={onClose ? (e) => beginCardPress(cardPressRef, e, (x, y) => openCardMenu(card, x, y)) : undefined}
                  onTouchMove={onClose ? (e) => moveCardPress(cardPressRef, e) : undefined}
                  onTouchEnd={onClose ? (e) => { if (cardPressFired(cardPressRef)) e.preventDefault(); cancelCardPress(cardPressRef); } : undefined}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => handleCardContextMenu(card, e)}
                  onMouseEnter={(e) => onCardMouseEnter(card.cardImgFile, card.cardName, e, card.instanceId)}
                  onMouseLeave={onCardMouseLeave}
                >
                  {(() => {
                    const isHoveredCard = hoveredCardId === card.instanceId && !isSelected;
                    const glowStyle = isHoveredCard ? getHoverGlowStyle(hoverProgress) : undefined;
                    const selectedShadow = isSelected ? '0 0 8px rgba(196,149,90,0.4)' : 'none';
                    return imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={card.cardName}
                        draggable={false}
                        style={{
                          width: '100%',
                          borderRadius: 4,
                          border: isSelected ? '2px solid var(--gf-accent)' : '1px solid var(--gf-border)',
                          boxShadow: glowStyle?.boxShadow ?? selectedShadow,
                          transition: 'border 0.1s ease',
                        }}
                      />
                    ) : (
                      <div style={{
                        width: '100%',
                        aspectRatio: '2.5/3.5',
                        background: 'var(--gf-bg)',
                        border: isSelected ? '2px solid var(--gf-accent)' : '1px solid var(--gf-border)',
                        boxShadow: glowStyle?.boxShadow ?? selectedShadow,
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--gf-text)',
                        fontSize: 11,
                        fontFamily: 'var(--font-cinzel), Georgia, serif',
                        textAlign: 'center',
                        padding: 8,
                        transition: 'border 0.1s ease',
                      }}>
                        {card.cardName}
                      </div>
                    );
                  })()}
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
                  border: '1px dashed var(--gf-accent)',
                  background: 'rgba(196,149,90,0.12)',
                  borderRadius: 2,
                  pointerEvents: 'none',
                  zIndex: 10,
                }}
              />
            )}
          </div>
        )}
        </div>

        {/* Action footer — choose where remaining revealed cards go */}
        <div data-peek-footer style={{
          marginTop: 16,
          paddingTop: 12,
          borderTop: '1px solid #3d2e1a',
        }}>
          {hasRemaining && onClose && sourceZone === 'deck' ? (
            <>
              <div style={{
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                color: 'var(--gf-text-bright)',
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: 8,
              }}>
                Put remaining {remainingIds.length} {remainingIds.length === 1 ? 'card' : 'cards'} back to:
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <PeekActionButton
                  icon={<ArrowUp size={13} />}
                  label="Top of Deck"
                  onClick={() => handleCloseAction('top')}
                />
                <PeekActionButton
                  icon={<ArrowDown size={13} />}
                  label="Bottom of Deck"
                  onClick={() => handleCloseAction('bottom')}
                />
                <PeekActionButton
                  icon={<Shuffle size={13} />}
                  label="Shuffle In"
                  onClick={() => handleCloseAction('shuffle')}
                />
              </div>
            </>
          ) : onClose ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <PeekActionButton
                label="Close"
                onClick={onClose}
                style={{ marginLeft: 'auto' }}
              />
            </div>
          ) : null}
        </div>
      </motion.div>
      </div>

      <ModalCardHoverPreview hover={hover} />

      {/* Context menu */}
      {contextCard && (() => {
        const isMulti = selectedIds.has(contextCard.card.instanceId) && selectedIds.size > 1;
        const targetIds = isMulti
          ? peekedCards.filter(c => selectedIds.has(c.instanceId)).map(c => c.instanceId)
          : [contextCard.card.instanceId];
        return (
          <PeekCardContextPopup
            card={contextCard.card}
            count={isMulti ? selectedIds.size : undefined}
            x={contextCard.x}
            y={contextCard.y}
            onClose={() => setContextCard(null)}
            onMove={(zone) => {
              for (const id of targetIds) moveCard(id, zone);
              setRemovedIds(prev => { const next = new Set(prev); for (const id of targetIds) next.add(id); return next; });
              setSelectedIds(new Set());
            }}
            onMoveToTop={() => {
              for (const id of targetIds) moveCardToTopOfDeck(id);
              setRemovedIds(prev => { const next = new Set(prev); for (const id of targetIds) next.add(id); return next; });
              setSelectedIds(new Set());
            }}
            onMoveToBottom={() => {
              for (const id of targetIds) moveCardToBottomOfDeck(id);
              setRemovedIds(prev => { const next = new Set(prev); for (const id of targetIds) next.add(id); return next; });
              setSelectedIds(new Set());
            }}
            onShuffleIn={() => {
              if (targetIds.length === 1) {
                shuffleCardIntoDeck(targetIds[0]);
              } else {
                moveCardsBatch(targetIds, 'deck');
                shuffleDeck();
              }
              setRemovedIds(prev => { const next = new Set(prev); for (const id of targetIds) next.add(id); return next; });
              setSelectedIds(new Set());
            }}
            sourceZone={sourceZone}
          />
        );
      })()}
    </div>
  );
}
