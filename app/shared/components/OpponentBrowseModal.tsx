'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { isPrimaryPointer } from '@/app/play/lib/pointerButton';
import { beginCardPress, moveCardPress, cancelCardPress, cardPressFired, consumeCardPressFired, type CardPressTracker } from '@/app/shared/utils/modalCardPress';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { GameCard } from '@/app/shared/types/gameCard';
import { X, Search } from 'lucide-react';
import { useModalCardHover, ModalCardHoverPreview, getHoverGlowStyle } from './ModalCardHoverPreview';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { useDraggableModal } from '@/app/shared/hooks/useDraggableModal';
import { DraggableTitleBar } from './DraggableTitleBar';
import { compareCardsDefault } from '@/lib/cards/defaultSort';
import { isOnScrollbar } from '@/app/shared/utils/scrollbarHit';

const OPPONENT_ACTIONS = [
  { id: 'discard', label: 'Discard' },
  { id: 'banish', label: 'Banish' },
  { id: 'deck-top', label: 'Top of Deck' },
  { id: 'deck-bottom', label: 'Bottom of Deck' },
  { id: 'deck-shuffle', label: 'Shuffle into Deck' },
] as const;

function OpponentCardPopup({
  card,
  count,
  x,
  y,
  onClose,
  onAction,
}: {
  card: GameCard;
  count?: number;
  x: number;
  y: number;
  onClose: () => void;
  onAction: (action: string) => void;
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

  const label = count && count > 1 ? `Move ${count} cards...` : card.cardName;

  return (
    <div
      ref={ref}
      data-modal-keep-open="true"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        left: Math.max(8, Math.min(x, window.innerWidth - (isTouch ? 200 : 160))),
        top: Math.max(8, Math.min(y, window.innerHeight - (isTouch ? 280 : 200))),
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 800,
        minWidth: 140,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ ...itemStyle, color: 'var(--gf-text-dim)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'default', padding: '3px 12px' }}>
        {label}
      </div>
      {OPPONENT_ACTIONS.map(({ id, label: actionLabel }) => (
        <button
          key={id}
          style={itemStyle}
          onClick={() => { onAction(id); onClose(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {actionLabel}
        </button>
      ))}
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

interface OpponentBrowseModalProps {
  zoneName: string;
  cards: GameCard[];
  onMoveCard: (cardId: string, action: string) => void;
  onMoveCardsBatch?: (cardIds: string[], action: string) => void;
  onClose: (opts?: { shuffled?: boolean }) => void;
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  onStartMultiDrag?: (cards: { card: GameCard; imageUrl: string }[], e: React.PointerEvent) => void;
  didDragRef?: React.MutableRefObject<boolean>;
  isDragActive?: boolean;
}

const SEARCH_FIELDS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'type', label: 'Type' },
  { id: 'name', label: 'Name' },
  { id: 'brigade', label: 'Brigade' },
  { id: 'alignment', label: 'Alignment' },
  { id: 'identifier', label: 'Identifier' },
  { id: 'ability', label: 'Ability' },
  { id: 'reference', label: 'Reference' },
];

const TYPE_ALIASES: Record<string, string[]> = {
  'ls': ['lost soul', 'lost souls'],
  'he': ['hero', 'heroes'],
  'ec': ['evil character', 'evil characters'],
  'gc': ['good character', 'good characters'],
  'ee': ['evil enhancement', 'evil enhancements'],
  'ge': ['good enhancement', 'good enhancements'],
  'da': ['dominant artifact', 'dominant artifacts'],
  'ar': ['artifact'],
  'fo': ['fortress'],
  'si': ['site'],
  'cu': ['curse'],
  'co': ['covenant'],
};

export function OpponentBrowseModal({
  zoneName,
  cards,
  onMoveCard,
  onMoveCardsBatch,
  onClose,
  onStartDrag,
  onStartMultiDrag,
  didDragRef,
  isDragActive,
}: OpponentBrowseModalProps) {
  const { dragHandleProps, modalStyle } = useDraggableModal();
  const isTouchModal = useInputMode() === 'touch';
  // Touch has no clicks, hovers or right-clicks — say what actually works.
  const hintText = isTouchModal
    ? 'Tap to select · Long-press a card for actions'
    : 'Right-click for actions · Drag to a zone · Click to select · Hover to enlarge';
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState<string>('all');
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [shuffleOnClose, setShuffleOnClose] = useState(true);
  const [contextCard, setContextCard] = useState<{ card: GameCard; x: number; y: number } | null>(null);
  const { setPreviewCard, isLoupeVisible } = useCardPreview();
  const { hover, hoverProgress, hoveredCardId, onCardMouseEnter, onCardMouseLeave } = useModalCardHover(350, { setPreviewCard, isLoupeVisible });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [lassoRect, setLassoRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const lassoStart = useRef<{ x: number; y: number } | null>(null);
  const isLassoing = useRef(false);

  const isReserve = zoneName.toLowerCase().includes('reserve');
  const isDeck = zoneName.toLowerCase().includes('deck');
  const sortedCards = isReserve
    ? [...cards].sort((a, b) => compareCardsDefault(
        { name: a.cardName, type: a.type, brigade: a.brigade, alignment: a.alignment, strength: a.strength, reference: a.reference },
        { name: b.cardName, type: b.type, brigade: b.brigade, alignment: b.alignment, strength: b.strength, reference: b.reference },
      ))
    : cards;

  const matchesSearch = (c: GameCard, term: string): boolean => {
    const t = term.toLowerCase();
    const matchesType = (type: string, s: string): boolean => {
      const tl = type.toLowerCase();
      if (tl.includes(s)) return true;
      const aliases = TYPE_ALIASES[tl];
      return aliases ? aliases.some(a => a.includes(s)) : false;
    };
    if (searchField === 'all') {
      return matchesType(c.type, t) || c.cardName.toLowerCase().includes(t) ||
        c.brigade.toLowerCase().includes(t) || c.alignment.toLowerCase().includes(t) ||
        c.identifier.toLowerCase().includes(t) || c.specialAbility.toLowerCase().includes(t) ||
        c.reference.toLowerCase().includes(t);
    }
    if (searchField === 'type') return matchesType(c.type, t);
    if (searchField === 'name') return c.cardName.toLowerCase().includes(t);
    if (searchField === 'brigade') return c.brigade.toLowerCase().includes(t);
    if (searchField === 'alignment') return c.alignment.toLowerCase().includes(t);
    if (searchField === 'identifier') return c.identifier.toLowerCase().includes(t);
    if (searchField === 'ability') return c.specialAbility.toLowerCase().includes(t);
    if (searchField === 'reference') return c.reference.toLowerCase().includes(t);
    return true;
  };

  const filtered = search
    ? sortedCards.filter(c => matchesSearch(c, search))
    : sortedCards;

  // Complete the search, reporting whether the requester chose to shuffle the
  // target's deck — so the backend can log "(and chose not to shuffle it)".
  const didCloseRef = useRef(false);
  const handleClose = useCallback(() => {
    if (didCloseRef.current) return;
    didCloseRef.current = true;
    const shuffled = shuffleOnClose && isDeck;
    onClose({ shuffled });
  }, [shuffleOnClose, isDeck, onClose]);

  // Close after a successful drag-to-canvas completes (unless "leave open").
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;
  const leaveOpenRef = useRef(leaveOpen);
  leaveOpenRef.current = leaveOpen;
  const dragEndTimeRef = useRef(0);
  const prevDragActive = useRef(false);
  useEffect(() => {
    if (prevDragActive.current && !isDragActive) {
      dragEndTimeRef.current = Date.now();
      setSelectedIds(new Set());
      if (!leaveOpenRef.current) {
        handleCloseRef.current();
      }
      if (didDragRef) didDragRef.current = false;
    }
    prevDragActive.current = !!isDragActive;
  }, [isDragActive, didDragRef]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedIds.size > 0) {
          setSelectedIds(new Set());
        } else {
          handleClose();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [handleClose, selectedIds.size]);

  // Outside-click / outside-right-click behavior. The backdrop is
  // pointer-events: none so cards underneath can fire hover previews, so we
  // detect "click outside the modal box" here instead of on the backdrop.
  useEffect(() => {
    const isInside = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (modalBoxRef.current?.contains(target)) return true;
      return !!target.closest('[data-modal-keep-open]');
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (isInside(e.target)) return;
      setContextCard(null);
      if (isPrimaryPointer(e) && !didDragRef?.current && Date.now() - dragEndTimeRef.current > 300) {
        handleClose();
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
  }, [handleClose, didDragRef]);

  const openCardMenu = useCallback((card: GameCard, clientX: number, clientY: number) => {
    onCardMouseLeave();
    setContextCard({ card, x: clientX, y: clientY });
    setPreviewCard({ cardName: card.cardName, cardImgFile: card.cardImgFile, isMeek: card.isMeek, notes: card.notes });
  }, [onCardMouseLeave, setPreviewCard]);

  const handleCardContextMenu = useCallback((card: GameCard, e: React.MouseEvent) => {
    e.preventDefault();
    openCardMenu(card, e.clientX, e.clientY);
  }, [openCardMenu]);

  const pointerDownCardRef = useRef<string | null>(null);
  const cardPressRef = useRef<CardPressTracker | null>(null);

  const handlePointerDown = useCallback((card: GameCard, imageUrl: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onCardMouseLeave();
    pointerDownCardRef.current = card.instanceId;
    if (didDragRef) didDragRef.current = false;

    // Touch: no drag from the modal — it fights native scrolling. Tap still
    // selects; the long-press menu moves cards.
    if (e.pointerType === 'touch') return;

    const isSelected = selectedIds.has(card.instanceId);
    if (isSelected && selectedIds.size > 1 && onStartMultiDrag) {
      const allSelected = filtered.filter(c => selectedIds.has(c.instanceId));
      onStartMultiDrag(
        allSelected.map(c => ({ card: c, imageUrl: getCardImageUrl(c.cardImgFile) })),
        e,
      );
    } else if (onStartDrag) {
      onStartDrag(card, imageUrl, e);
    }
  }, [onCardMouseLeave, didDragRef, onStartDrag, onStartMultiDrag, selectedIds, filtered]);

  const handlePointerUp = useCallback((card: GameCard) => {
    if (pointerDownCardRef.current !== card.instanceId) return;
    pointerDownCardRef.current = null;
    if (consumeCardPressFired(cardPressRef)) return;
    if (didDragRef?.current) {
      didDragRef.current = false;
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
  }, [didDragRef]);

  // Lasso selection: pointer down on empty space
  const handleContentPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const tag = target.tagName.toLowerCase();
    if (tag === 'button' || tag === 'img' || tag === 'input' || tag === 'select' || tag === 'label') return;
    if (target.closest('[data-card-id]')) return;
    // A grab on the grid's native scrollbar lands on the scroll container
    // itself; it is not a click on empty space, so keep the selection.
    if (isOnScrollbar(target, e.clientX, e.clientY)) return;
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const scrollContainer = scrollContainerRef.current;
    const scrollTop = scrollContainer?.scrollTop ?? 0;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top + scrollTop;
    lassoStart.current = { x, y };
    isLassoing.current = true;
    setLassoRect(null);
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
      const scrollContainer = scrollContainerRef.current;
      const scrollTop = scrollContainer?.scrollTop ?? 0;
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top + scrollTop;
      const sx = Math.min(lassoStart.current.x, currentX);
      const sy = Math.min(lassoStart.current.y, currentY);
      const sw = Math.abs(currentX - lassoStart.current.x);
      const sh = Math.abs(currentY - lassoStart.current.y);

      setLassoRect({ x: sx, y: sy, w: sw, h: sh });

      if (sw > 5 || sh > 5) {
        const hits = new Set<string>();
        for (const [instanceId, el] of cardElRefs.current) {
          const cardRect = el.getBoundingClientRect();
          const cx = cardRect.left - rect.left;
          const cy = cardRect.top - rect.top + scrollTop;
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

  // Multi-card context menu handler
  const handleMultiAction = (action: string) => {
    if (onMoveCardsBatch) {
      onMoveCardsBatch(Array.from(selectedIds), action);
    } else {
      // Fallback: call onMoveCard for each selected card
      for (const id of selectedIds) {
        onMoveCard(id, action);
      }
    }
    setSelectedIds(new Set());
    setContextCard(null);
  };

  // Determine if context card is part of a multi-selection
  const isMultiContext = contextCard && selectedIds.has(contextCard.card.instanceId) && selectedIds.size > 1;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed',
        inset: 0,
        right: isLoupeVisible ? 'clamp(280px, 20vw, 380px)' : '36px',
        background: 'transparent',
        display: 'flex',
        alignItems: 'flex-start',
        paddingTop: '5vh',
        justifyContent: 'center',
        zIndex: 900,
        pointerEvents: 'none',
      }}
    >
      <div
        ref={modalBoxRef}
        onClick={() => setContextCard(null)}
        onPointerDown={handleContentPointerDown}
        style={{
          background: 'var(--gf-bg)',
          border: '1px solid var(--gf-border)',
          borderRadius: 8,
          padding: 20,
          width: '80vw',
          maxWidth: 700,
          height: '80vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          opacity: isDragActive ? 0.15 : 1,
          pointerEvents: isDragActive ? 'none' : 'auto',
          transition: 'opacity 0.2s ease',
          ...modalStyle,
        }}
      >
        {/* Title bar — drag handle */}
        <DraggableTitleBar
          dragHandleProps={dragHandleProps}
          title={`${zoneName} (${cards.length})`}
          bottomGap={12}
          onClose={handleClose}
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

        {/* Search input + field selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <select
              value={searchField}
              onChange={(e) => { setSearchField(e.target.value); setSearch(''); }}
              style={{
                appearance: 'none',
                WebkitAppearance: 'none',
                padding: '8px 28px 8px 10px',
                background: 'rgb(var(--gf-panel-rgb))',
                border: '1px solid var(--gf-border)',
                borderRadius: 4,
                color: 'var(--gf-text)',
                fontSize: 12,
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {SEARCH_FIELDS.map(f => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            <div style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
              color: 'var(--gf-text-dim)',
              fontSize: 10,
            }}>
              ▼
            </div>
          </div>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--gf-text-dim)',
              }}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchField === 'all' ? 'Search all fields...' : `Search by ${SEARCH_FIELDS.find(f => f.id === searchField)?.label.toLowerCase()}...`}
              // No autofocus on touch — the keyboard ate half the card grid
              // the moment the modal opened. 16px stops iOS focus-zoom.
              autoFocus={!isTouchModal}
              style={{
                width: '100%',
                padding: '8px 30px 8px 30px',
                background: 'rgb(var(--gf-panel-rgb))',
                border: '1px solid var(--gf-border)',
                borderRadius: 4,
                color: 'var(--gf-text)',
                fontSize: isTouchModal ? 16 : 13,
                outline: 'none',
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--gf-text-dim)',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Hint + options */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ color: 'var(--gf-border)', fontSize: 10 }}>
            {hintText}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
            {isDeck && (
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
                    border: shuffleOnClose ? '1.5px solid var(--gf-accent)' : '1.5px solid var(--gf-border)',
                    background: shuffleOnClose ? 'rgba(var(--gf-accent-rgb), 0.25)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  {shuffleOnClose && (
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5L4.5 7.5L8 3" stroke="#e8d5a3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <input
                  type="checkbox"
                  checked={shuffleOnClose}
                  onChange={(e) => setShuffleOnClose(e.target.checked)}
                  className="sr-only"
                />
                Shuffle on close
              </label>
            )}
          </div>
        </div>

        {/* Card grid — scrollable */}
        <div ref={scrollContainerRef} style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
          {filtered.length === 0 ? (
            <p style={{ color: 'var(--gf-text-dim)', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>
              {search ? 'No cards match your search' : 'No cards in this zone'}
            </p>
          ) : (
            <div
              ref={gridRef}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: 8,
                position: 'relative',
                userSelect: 'none',
              }}
            >
              {filtered.map((card) => {
                const imageUrl = getCardImageUrl(card.cardImgFile);
                const isSelected = selectedIds.has(card.instanceId);
                return (
                  <div
                    key={card.instanceId}
                    ref={(el) => registerCardEl(card.instanceId, el)}
                    data-card-id={card.instanceId}
                    style={{ position: 'relative', cursor: 'grab' }}
                    onContextMenu={(e) => handleCardContextMenu(card, e)}
                    onTouchStart={(e) => beginCardPress(cardPressRef, e, (px, py) => openCardMenu(card, px, py))}
                    onTouchMove={(e) => moveCardPress(cardPressRef, e)}
                    onTouchEnd={(e) => { if (cardPressFired(cardPressRef)) e.preventDefault(); cancelCardPress(cardPressRef); }}
                    onPointerDown={(e) => { e.stopPropagation(); handlePointerDown(card, imageUrl, e); }}
                    onPointerUp={() => handlePointerUp(card)}
                    onClick={(e) => e.stopPropagation()}
                    onMouseEnter={(e) => { if (!contextCard) onCardMouseEnter(card.cardImgFile, card.cardName, e, card.instanceId); }}
                    onMouseLeave={onCardMouseLeave}
                  >
                    {(() => {
                      const isHoveredCard = hoveredCardId === card.instanceId && !isSelected;
                      const glowStyle = isHoveredCard ? getHoverGlowStyle(hoverProgress) : undefined;
                      const selectedShadow = isSelected ? '0 0 8px rgba(var(--gf-accent-rgb), 0.4)' : 'none';
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
                            padding: 4,
                            textAlign: 'center',
                            transition: 'border 0.1s ease',
                          }}
                        >
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
                    border: '2px dashed var(--gf-accent)',
                    background: 'rgba(var(--gf-accent-rgb), 0.15)',
                    borderRadius: 2,
                    pointerEvents: 'none',
                    zIndex: 100,
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <ModalCardHoverPreview hover={hover} />

      {/* Context menu */}
      {contextCard && (
        isMultiContext ? (
          <OpponentCardPopup
            card={contextCard.card}
            count={selectedIds.size}
            x={contextCard.x}
            y={contextCard.y}
            onClose={() => setContextCard(null)}
            onAction={handleMultiAction}
          />
        ) : (
          <OpponentCardPopup
            card={contextCard.card}
            x={contextCard.x}
            y={contextCard.y}
            onClose={() => setContextCard(null)}
            onAction={(action) => onMoveCard(contextCard.card.instanceId, action)}
          />
        )
      )}
    </motion.div>
  );
}
