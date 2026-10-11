'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { isPrimaryPointer } from '@/app/play/lib/pointerButton';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { beginCardPress, moveCardPress, cancelCardPress, cardPressFired, consumeCardPressFired, type CardPressTracker } from '@/app/shared/utils/modalCardPress';
import { useModalGame } from '@/app/shared/contexts/ModalGameContext';
import { GameCard, ZoneId, ZONE_LABELS } from '@/app/shared/types/gameCard';
import { X, Search } from 'lucide-react';
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

interface DeckSearchModalProps {
  onClose: () => void;
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  onStartMultiDrag?: (cards: { card: GameCard; imageUrl: string }[], e: React.PointerEvent) => void;
  didDragRef?: React.MutableRefObject<boolean>;
  isDragActive?: boolean;
}

function CardContextPopup({
  card,
  count,
  x,
  y,
  onClose,
  onMove,
  onMoveToTop,
  onMoveToBottom,
}: {
  card: GameCard;
  count?: number;
  x: number;
  y: number;
  onClose: () => void;
  onMove: (zone: ZoneId) => void;
  onMoveToTop: () => void;
  onMoveToBottom: () => void;
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

  const label = count && count > 1 ? `Move ${count} cards to...` : 'Move to...';

  return (
    <div
      ref={ref}
      data-modal-keep-open="true"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: Math.max(8, Math.min(x, window.innerWidth - (isTouch ? 200 : 160))),
        top: Math.max(8, Math.min(y, window.innerHeight - (isTouch ? 340 : 300))),
        background: 'var(--gf-bg)',
        border: '1px solid var(--gf-border)',
        borderRadius: 6,
        padding: '4px 0',
        zIndex: 900,
        minWidth: isTouch ? 180 : 140,
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ ...itemStyle, color: 'var(--gf-text-dim)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', cursor: 'default', padding: '3px 12px' }}>
        {label}
      </div>
      {MOVE_ZONES.map(({ id, label: zoneLabel }) => (
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
    </div>
  );
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function DeckSearchModal({ onClose, onStartDrag, onStartMultiDrag, didDragRef, isDragActive }: DeckSearchModalProps) {
  const { dragHandleProps, modalStyle } = useDraggableModal();
  const { zones, actions } = useModalGame();
  const { moveCard, moveCardsBatch, moveCardToTopOfDeck, moveCardToBottomOfDeck, shuffleDeck, logDeckSearchNoShuffle } = actions;
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState<'all' | 'type' | 'name' | 'brigade' | 'alignment' | 'ability' | 'identifier' | 'reference'>('all');
  const [autoShuffle, setAutoShuffle] = useState(true);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [contextCard, setContextCard] = useState<{ card: GameCard; x: number; y: number } | null>(null);
  const { setPreviewCard, isLoupeVisible } = useCardPreview();
  const { hover, hoverProgress, hoveredCardId, onCardMouseEnter, onCardMouseLeave } = useModalCardHover(350, { setPreviewCard, isLoupeVisible });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isTouch = useInputMode() === 'touch';
  const cardPressRef = useRef<CardPressTracker | null>(null);

  // Ref for the inner modal box — used for outside-click detection so the
  // backdrop can stay pointer-events: none (letting hover previews reach the
  // game board cards underneath).
  const modalBoxRef = useRef<HTMLDivElement>(null);

  // Ref for the search input so we can focus it on open and after the field
  // dropdown changes.
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus the search input when the modal first mounts. A ref + effect is more
  // reliable than the autoFocus attribute inside this framer-motion modal.
  // Not on touch — the player opened this to LOOK at cards, and the keyboard
  // immediately ate half the grid before they typed anything.
  useEffect(() => {
    if (isTouch) return;
    searchInputRef.current?.focus();
  }, [isTouch]);

  // Touch: size the panel to the VISUAL viewport, not the layout viewport.
  // vh ignores the software keyboard, so with it open the input and results
  // sat behind the keys with nothing visible. Subscribing (not reading once)
  // matters — the keyboard opens after mount (CardNotePopover pattern).
  const [vvHeight, setVvHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!isTouch) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => setVvHeight(vv.height);
    sync();
    vv.addEventListener('resize', sync);
    return () => vv.removeEventListener('resize', sync);
  }, [isTouch]);

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

  const SEARCH_FIELDS: { id: typeof searchField; label: string }[] = [
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

  const matchesSearch = (c: GameCard, term: string): boolean => {
    const t = term.toLowerCase();

    const matchesType = (type: string, searchTerm: string): boolean => {
      const typeLower = type.toLowerCase();
      if (typeLower.includes(searchTerm)) return true;
      const aliases = TYPE_ALIASES[typeLower];
      if (aliases) return aliases.some(alias => alias.includes(searchTerm));
      return false;
    };

    if (searchField === 'all') {
      return (
        matchesType(c.type, t) ||
        c.cardName.toLowerCase().includes(t) ||
        c.brigade.toLowerCase().includes(t) ||
        c.alignment.toLowerCase().includes(t) ||
        c.identifier.toLowerCase().includes(t) ||
        c.specialAbility.toLowerCase().includes(t) ||
        c.reference.toLowerCase().includes(t)
      );
    }
    switch (searchField) {
      case 'type': return matchesType(c.type, t);
      case 'name': return c.cardName.toLowerCase().includes(t);
      case 'brigade': return c.brigade.toLowerCase().includes(t);
      case 'alignment': return c.alignment.toLowerCase().includes(t);
      case 'identifier': return c.identifier.toLowerCase().includes(t);
      case 'ability': return c.specialAbility.toLowerCase().includes(t);
      case 'reference': return c.reference.toLowerCase().includes(t);
    }
  };

  const deckCards = zones.deck ?? [];
  const filtered = search
    ? deckCards.filter(c => matchesSearch(c, search))
    : deckCards;

  // Refs tracking right-click "Top of Deck" / "Bottom of Deck" intents
  // performed while the modal was open. We DEFER the actual placement until
  // close so the game log shows a single clean sequence:
  //   - autoShuffle on  → shuffle the deck, then place the chosen card(s)
  //                       on top/bottom — log reads "shuffled, topdecked X".
  //   - autoShuffle off → place the chosen card(s) on top/bottom and emit a
  //                       clear "did NOT shuffle" log so opponents see that
  //                       the deck order is now known to the searcher.
  const pendingTopRef = useRef<string[]>([]);
  const pendingBottomRef = useRef<string[]>([]);
  const trackTopDeck = useCallback((id: string) => {
    pendingTopRef.current.push(id);
  }, []);
  const trackBottomDeck = useCallback((id: string) => {
    pendingBottomRef.current.push(id);
  }, []);

  // Guard ref to ensure we only shuffle+close once (prevents double-shuffle
  // from effect re-fires when handleClose's dependencies change).
  const didCloseRef = useRef(false);
  const handleClose = useCallback(() => {
    if (didCloseRef.current) return;
    didCloseRef.current = true;
    const topIds = pendingTopRef.current;
    const bottomIds = pendingBottomRef.current;
    const hasPending = topIds.length > 0 || bottomIds.length > 0;
    if (autoShuffle) {
      shuffleDeck();
    }
    if (hasPending) {
      for (const id of topIds) moveCardToTopOfDeck(id);
      for (const id of bottomIds) moveCardToBottomOfDeck(id);
    }
    if (!autoShuffle) {
      // Always log the no-shuffle decision — the searcher now knows their
      // deck order, which is significant for opponents whether or not any
      // cards were stacked.
      logDeckSearchNoShuffle?.({ topCount: topIds.length, bottomCount: bottomIds.length });
    }
    onClose();
  }, [autoShuffle, shuffleDeck, moveCardToTopOfDeck, moveCardToBottomOfDeck, logDeckSearchNoShuffle, onClose]);

  // Close modal after a successful drag-to-canvas completes (unless "leave open" is on).
  // Use refs for handleClose/leaveOpen so the effect only re-runs when isDragActive
  // changes — not when callback references are recreated by subscription updates.
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;
  const leaveOpenRef = useRef(leaveOpen);
  leaveOpenRef.current = leaveOpen;

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
        handleCloseRef.current();
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
          handleClose();
        }
      } else if (e.key === '/') {
        // "/" clears the search and refocuses the input — works even while
        // typing in the box (we don't expect literal "/" searches).
        e.preventDefault();
        setSearch('');
        searchInputRef.current?.focus();
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
      if (isPrimaryPointer(e) && !didDragRef?.current && Date.now() - dragEndTimeRef.current > 300) {
        setContextCard(null);
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

  const openCardMenu = (card: GameCard, clientX: number, clientY: number) => {
    onCardMouseLeave();
    setContextCard({ card, x: clientX, y: clientY });
    // Re-set the loupe preview so it keeps showing the right-clicked card
    setPreviewCard({ cardName: card.cardName, cardImgFile: card.cardImgFile, isMeek: card.isMeek, notes: card.notes });
  };

  const handleCardContextMenu = (card: GameCard, e: React.MouseEvent) => {
    e.preventDefault();
    openCardMenu(card, e.clientX, e.clientY);
  };

  // Track pointer down card to distinguish click from drag on pointer up
  const pointerDownCardRef = useRef<string | null>(null);

  const handlePointerDown = (card: GameCard, imageUrl: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onCardMouseLeave();
    pointerDownCardRef.current = card.instanceId;
    if (didDragRef) didDragRef.current = false;

    // Touch: never arm a drag from the grid — a touch drag fights the grid's
    // native scrolling (the browser cancels it mid-gesture), so touch moves
    // cards through the long-press menu instead. Tap still selects below.
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
  };

  const handlePointerUp = (card: GameCard) => {
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
  };

  // Lasso selection: pointer down on empty space
  const handleContentPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // Touch selects by tapping, never by lasso — and the preventDefault below
    // killed the scroller's swipe when a finger landed between cards.
    if (e.pointerType === 'touch') return;
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

  // Multi-card context menu handlers
  const handleMultiMove = (zone: ZoneId) => {
    moveCardsBatch(Array.from(selectedIds), zone);
    setSelectedIds(new Set());
    setContextCard(null);
  };

  const handleMultiTopDeck = () => {
    for (const id of selectedIds) trackTopDeck(id);
    setSelectedIds(new Set());
    setContextCard(null);
  };

  const handleMultiBottomDeck = () => {
    for (const id of selectedIds) trackBottomDeck(id);
    setSelectedIds(new Set());
    setContextCard(null);
  };

  const isMultiContext = contextCard && selectedIds.has(contextCard.card.instanceId) && selectedIds.size > 1;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed',
        inset: 0,
        // Desktop loupe-column dodge only — on touch the panel needs the
        // whole width, and the panel pins to the top so the search input
        // stays above the software keyboard.
        right: isTouch ? 0 : isLoupeVisible ? 'clamp(280px, 20vw, 380px)' : '36px',
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'flex-start',
        paddingTop: isTouch ? 8 : '5vh',
        justifyContent: 'center',
        zIndex: 500,
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
          padding: isTouch ? 12 : 20,
          width: isTouch ? 'calc(100vw - 16px)' : '80vw',
          maxWidth: isTouch ? undefined : 700,
          // Visual-viewport height on touch: the panel shrinks with the
          // keyboard so the input + a full row of results stay visible.
          height: isTouch ? (vvHeight != null ? vvHeight - 16 : '88vh') : '80vh',
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
          title={`Search Deck (${deckCards.length} cards)`}
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
              onChange={(e) => { setSearchField(e.target.value as typeof searchField); setSearch(''); searchInputRef.current?.focus(); }}
              style={{
                appearance: 'none',
                WebkitAppearance: 'none',
                padding: '8px 28px 8px 10px',
                background: '#1e1610',
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
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              // The filter is live, so Enter's job is "done typing" — blur
              // dismisses the software keyboard and gives the results the
              // screen back (it never went away on its own on a phone).
              enterKeyHint="search"
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              placeholder={searchField === 'all' ? 'Search all fields...' : `Search by ${SEARCH_FIELDS.find(f => f.id === searchField)?.label.toLowerCase()}...`}
              style={{
                width: '100%',
                padding: '8px 30px 8px 30px',
                background: '#1e1610',
                border: '1px solid var(--gf-border)',
                borderRadius: 4,
                color: 'var(--gf-text)',
                // 16px on touch stops iOS zooming the page when it takes focus.
                fontSize: isTouch ? 16 : 13,
                outline: 'none',
              }}
            />
            {search ? (
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
            ) : (
              <kbd
                aria-hidden="true"
                title="Press / to clear the search"
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  minWidth: 16,
                  height: 16,
                  padding: '0 4px',
                  borderRadius: 3,
                  border: '1px solid var(--gf-border)',
                  background: '#1e1610',
                  color: 'var(--gf-text-dim)',
                  fontSize: 10,
                  lineHeight: '14px',
                  textAlign: 'center',
                  fontFamily: 'inherit',
                  pointerEvents: 'none',
                }}
              >
                /
              </kbd>
            )}
          </div>
        </div>

        {/* Hint + auto-shuffle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ color: 'var(--gf-border)', fontSize: 10 }}>
            {isTouch
              ? 'Tap to select · Long-press a card for actions'
              : 'Drag to a zone · Right-click for more · Hover to enlarge'}
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
                  border: leaveOpen ? '1.5px solid #c4955a' : '1.5px solid var(--gf-border)',
                  background: leaveOpen ? 'rgba(196, 149, 90, 0.25)' : 'transparent',
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
                  border: autoShuffle ? '1.5px solid #c4955a' : '1.5px solid var(--gf-border)',
                  background: autoShuffle ? 'rgba(196, 149, 90, 0.25)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'border-color 0.15s, background 0.15s',
                }}
              >
                {autoShuffle && (
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5L4.5 7.5L8 3" stroke="#e8d5a3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <input
                type="checkbox"
                checked={autoShuffle}
                onChange={(e) => setAutoShuffle(e.target.checked)}
                className="sr-only"
              />
              Shuffle on close
            </label>
          </div>
        </div>

        {/* Card grid */}
        <div ref={scrollContainerRef} style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
          {filtered.length === 0 ? (
            <p style={{ color: 'var(--gf-text-dim)', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>
              {search ? 'No cards match your search' : 'Deck is empty'}
            </p>
          ) : (
            <div
              ref={gridRef}
              // Touch: one height-filling row that scrolls sideways — the
              // grid showed four cropped card tops under a landscape
              // keyboard. Cards render whole at whatever height the visual
              // viewport leaves, and a swipe walks the deck.
              style={isTouch ? {
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'stretch',
                gap: 8,
                height: '100%',
                position: 'relative',
                userSelect: 'none',
              } : {
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
                    style={isTouch
                      ? { position: 'relative', cursor: 'grab', flex: '0 0 auto', height: '100%', aspectRatio: '5 / 7' }
                      : { position: 'relative', cursor: 'grab' }}
                    onContextMenu={(e) => handleCardContextMenu(card, e)}
                    onPointerDown={(e) => { e.stopPropagation(); handlePointerDown(card, imageUrl, e); }}
                    onPointerUp={() => handlePointerUp(card)}
                    onTouchStart={(e) => beginCardPress(cardPressRef, e, (x, y) => openCardMenu(card, x, y))}
                    onTouchMove={(e) => moveCardPress(cardPressRef, e)}
                    onTouchEnd={(e) => { if (cardPressFired(cardPressRef)) e.preventDefault(); cancelCardPress(cardPressRef); }}
                    onClick={(e) => e.stopPropagation()}
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
                            // The wrapper is height-constrained in the touch
                            // scroller — fill it instead of deriving height
                            // from width (which overflowed the row).
                            ...(isTouch ? { height: '100%', objectFit: 'contain' as const, display: 'block' as const } : null),
                            borderRadius: 4,
                            border: isSelected ? '2px solid var(--gf-accent)' : '1px solid var(--gf-border)',
                            boxShadow: glowStyle?.boxShadow ?? selectedShadow,
                            transition: 'border 0.1s ease',
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            ...(isTouch ? { height: '100%' } : null),
                            aspectRatio: '1/1.4',
                            background: '#1e1610',
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
                    background: 'rgba(196,149,90,0.15)',
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
          <CardContextPopup
            card={contextCard.card}
            count={selectedIds.size}
            x={contextCard.x}
            y={contextCard.y}
            onClose={() => setContextCard(null)}
            onMove={handleMultiMove}
            onMoveToTop={handleMultiTopDeck}
            onMoveToBottom={handleMultiBottomDeck}
          />
        ) : (
          <CardContextPopup
            card={contextCard.card}
            x={contextCard.x}
            y={contextCard.y}
            onClose={() => setContextCard(null)}
            onMove={(zone) => moveCard(contextCard.card.instanceId, zone)}
            onMoveToTop={() => {
              trackTopDeck(contextCard.card.instanceId);
              handleClose();
            }}
            onMoveToBottom={() => {
              trackBottomDeck(contextCard.card.instanceId);
              handleClose();
            }}
          />
        )
      )}
    </motion.div>
  );
}
