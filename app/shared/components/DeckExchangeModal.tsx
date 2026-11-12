'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { isPrimaryPointer } from '@/app/play/lib/pointerButton';
import { useModalGame } from '@/app/shared/contexts/ModalGameContext';
import { GameCard, ZoneId } from '@/app/shared/types/gameCard';
import { X, Search, ArrowLeftRight } from 'lucide-react';
import { useModalCardHover, ModalCardHoverPreview, getHoverGlowStyle } from './ModalCardHoverPreview';
import { useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { useDraggableModal } from '@/app/shared/hooks/useDraggableModal';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { DraggableTitleBar } from './DraggableTitleBar';
import { DeckFilterBar, type DeckCardFilter } from './DeckFilterBar';

interface DeckExchangeModalProps {
  /** The card instance IDs being sent into the deck */
  exchangeCardIds: string[];
  onComplete: () => void;
  onCancel: () => void;
  /** Shared modal drag infrastructure — same as DeckSearchModal */
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  didDragRef?: React.MutableRefObject<boolean>;
  isDragActive?: boolean;
  /** Set by useModalCardDrag — true only when the drag ended on a valid zone */
  validDropRef?: React.MutableRefObject<boolean>;
  /** Which zone the exchange cards land in. Defaults to 'deck'; set to 'soul-deck' for Paragon shared-soul exchange. */
  targetZone?: ZoneId;
  /** Set when a card ability opened the exchange (exchange_with_deck, e.g.
   *  Benjamin's "exchange this card with a son of Jacob from deck"): the grid
   *  starts narrowed to the cards that qualify. */
  filter?: DeckCardFilter;
}

export function DeckExchangeModal({
  exchangeCardIds,
  onComplete,
  onCancel,
  onStartDrag,
  didDragRef,
  isDragActive,
  validDropRef,
  targetZone = 'deck',
  filter,
}: DeckExchangeModalProps) {
  const [filterOn, setFilterOn] = useState(true);
  const { dragHandleProps, modalStyle } = useDraggableModal();
  const isTouch = useInputMode() === 'touch';
  const { zones, actions } = useModalGame();
  const { moveCardToTopOfDeck, shuffleDeck, exchangeFromDeck } = actions;
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState<'all' | 'type' | 'name' | 'brigade' | 'alignment' | 'ability' | 'identifier' | 'reference'>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { setPreviewCard, isLoupeVisible } = useCardPreview();
  const { hover, hoverProgress, hoveredCardId, onCardMouseEnter, onCardMouseLeave } = useModalCardHover(350, { setPreviewCard, isLoupeVisible });

  // Ref for the inner modal box — used for outside-click detection so the
  // backdrop can stay pointer-events: none (letting hover previews reach the
  // game board cards underneath).
  const modalBoxRef = useRef<HTMLDivElement>(null);

  // Timestamp of last drag end — guards the outside-click handler against the
  // spurious click that fires when mousedown-on-card + mouseup-on-backdrop
  // occur during a drag gesture.
  const dragEndTimeRef = useRef(0);

  // Track pointer down card to distinguish click from drag
  const pointerDownCardRef = useRef<string | null>(null);

  // Track which card was dragged out so we can complete exchange on drop
  const draggedCardIdRef = useRef<string | null>(null);

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

  const matchesSearch = (c: GameCard, term: string): boolean => {
    const t = term.toLowerCase();
    if (searchField === 'all') {
      return (
        c.type.toLowerCase().includes(t) ||
        c.cardName.toLowerCase().includes(t) ||
        c.brigade.toLowerCase().includes(t) ||
        c.alignment.toLowerCase().includes(t) ||
        c.identifier.toLowerCase().includes(t) ||
        c.specialAbility.toLowerCase().includes(t) ||
        c.reference.toLowerCase().includes(t)
      );
    }
    switch (searchField) {
      case 'type': return c.type.toLowerCase().includes(t);
      case 'name': return c.cardName.toLowerCase().includes(t);
      case 'brigade': return c.brigade.toLowerCase().includes(t);
      case 'alignment': return c.alignment.toLowerCase().includes(t);
      case 'identifier': return c.identifier.toLowerCase().includes(t);
      case 'ability': return c.specialAbility.toLowerCase().includes(t);
      case 'reference': return c.reference.toLowerCase().includes(t);
    }
  };

  // Find the cards being exchanged (they may be in any zone)
  const exchangeCards = exchangeCardIds.map(id => {
    for (const cards of Object.values(zones)) {
      const found = cards.find(c => c.instanceId === id);
      if (found) return found;
    }
    return null;
  }).filter(Boolean) as GameCard[];

  const deckCards = zones[targetZone] ?? [];
  const pool = filter && filterOn ? deckCards.filter(filter.matches) : deckCards;
  const filtered = search
    ? pool.filter(c => matchesSearch(c, search))
    : pool;

  const needCount = exchangeCardIds.length;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel]);

  // Outside-click behavior. The backdrop is pointer-events: none so cards
  // underneath can fire hover previews, so we detect "click outside the modal
  // box" here instead of on the backdrop.
  useEffect(() => {
    const isInside = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (modalBoxRef.current?.contains(target)) return true;
      return !!target.closest('[data-modal-keep-open]');
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (isInside(e.target)) return;
      if (isPrimaryPointer(e) && !didDragRef?.current && Date.now() - dragEndTimeRef.current > 300) {
        onCancel();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);

    document.addEventListener('touchstart', handleMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('touchstart', handleMouseDown);
    };
  }, [onCancel, didDragRef]);

  const selectCard = useCallback((cardId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        if (next.size >= needCount) {
          const first = next.values().next().value;
          if (first) next.delete(first);
        }
        next.add(cardId);
      }
      return next;
    });
  }, [needCount]);

  const handleCardClick = useCallback((card: GameCard) => {
    selectCard(card.instanceId);
  }, [selectCard]);

  // Pointer down: start shared modal drag and track which card
  const handlePointerDown = useCallback((card: GameCard, imageUrl: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    onCardMouseLeave();
    pointerDownCardRef.current = card.instanceId;
    if (didDragRef) didDragRef.current = false;
    draggedCardIdRef.current = card.instanceId;
    if (onStartDrag) {
      onStartDrag(card, imageUrl, e);
    }
  }, [onCardMouseLeave, onStartDrag, didDragRef]);

  // Pointer up: if no drag happened, treat as click to select
  const handlePointerUp = useCallback((card: GameCard) => {
    if (pointerDownCardRef.current !== card.instanceId) return;
    pointerDownCardRef.current = null;
    if (didDragRef?.current) {
      didDragRef.current = false;
      return;
    }
    handleCardClick(card);
  }, [didDragRef, handleCardClick]);

  // The exchanged-away cards go into the pile: shuffled into a deck, or simply
  // into the Reserve (exchange_with_reserve) — never a deck shuffle for that.
  const sendExchangeCardsAway = () => {
    if (targetZone === 'reserve') {
      for (const id of exchangeCardIds) actions.moveCard(id, 'reserve');
      return;
    }
    for (const id of exchangeCardIds) {
      moveCardToTopOfDeck(id);
    }
    shuffleDeck();
  };

  // When a drag completes (isDragActive goes true→false), the shared hook
  // already moved the dragged card to the target zone at the drop position.
  // We now send the exchange cards to the pile and complete.
  // IMPORTANT: Only proceed if validDropRef indicates the drop landed on a
  // valid zone. Without this guard, dropping outside a zone would still move
  // exchange cards to the pile with no replacement — causing a desync.
  // Reassigned every render below, so it always sees the current props.
  const dragCompleteRef = useRef<() => void>(() => {});
  dragCompleteRef.current = () => {
    const draggedId = draggedCardIdRef.current;
    if (draggedId && validDropRef?.current) {
      sendExchangeCardsAway();
      draggedCardIdRef.current = null;
      onComplete();
    } else {
      // Invalid drop — reset drag state, keep modal open
      draggedCardIdRef.current = null;
    }
  };

  const prevDragActive = useRef(false);
  useEffect(() => {
    if (prevDragActive.current && !isDragActive) {
      dragEndTimeRef.current = Date.now();
      dragCompleteRef.current();
      if (didDragRef) didDragRef.current = false;
    }
    prevDragActive.current = !!isDragActive;
  }, [isDragActive]);

  const handleConfirm = useCallback(() => {
    if (selectedIds.size !== needCount) return;

    const pickedIds = Array.from(selectedIds);

    if (exchangeFromDeck && targetZone === 'deck') {
      // Atomic path: single reducer handles the entire exchange (private deck only)
      const replacementMoves = pickedIds.map((cardId, i) => {
        const source = exchangeCards[i];
        return {
          cardId,
          toZone: source.zone,
          posX: source.posX != null ? String(source.posX) : '',
          posY: source.posY != null ? String(source.posY) : '',
        };
      });
      exchangeFromDeck(exchangeCardIds, replacementMoves);
    } else {
      // Fallback for goldfish/non-multiplayer or non-deck targets (e.g. shared soul deck):
      // rely on the provider's moveCardToTopOfDeck / shuffleDeck to target the correct pile.
      for (let i = 0; i < needCount; i++) {
        const source = exchangeCards[i];
        actions.moveCard(pickedIds[i], source.zone, undefined, source.posX, source.posY);
      }
      if (targetZone === 'reserve') {
        for (const id of exchangeCardIds) actions.moveCard(id, 'reserve');
      } else {
        for (const id of exchangeCardIds) {
          moveCardToTopOfDeck(id);
        }
        shuffleDeck();
      }
    }

    onComplete();
  }, [selectedIds, needCount, exchangeCards, exchangeCardIds, exchangeFromDeck, actions, moveCardToTopOfDeck, shuffleDeck, onComplete, targetZone]);

  return (
    <>
      {/* Backdrop */}
      <motion.div
        data-blocking-prompt
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        style={{
          position: 'fixed',
          inset: 0,
          // Desktop loupe-column dodge only — on touch the right panel is a
          // full-screen overlay, and this inset shoved the 80vw modal mostly
          // off the left edge of a portrait phone.
          right: isTouch ? 0 : isLoupeVisible ? 'clamp(280px, 20vw, 380px)' : '36px',
          background: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // 800, not 500: the battle-resolution row (Win/End Battle) renders
          // at 600 and floated ON TOP of an open exchange. A must-answer
          // modal sits with the other must-answer surfaces at 800 so the
          // board chrome stays behind its scrim.
          zIndex: 800,
          pointerEvents: 'none',
        }}
      >
        <div
          ref={modalBoxRef}
          style={{
            background: 'var(--gf-bg)',
            border: '1px solid var(--gf-border)',
            borderRadius: 8,
            padding: isTouch ? 12 : 20,
            width: isTouch ? 'calc(100vw - 16px)' : '80vw',
            maxWidth: isTouch ? undefined : 700,
            // Touch: nearly the whole screen, as in DeckSearchModal — on a
            // landscape phone 80vh left no room for cards under the banner,
            // the filter line and the search row.
            height: isTouch ? 'calc(100dvh - 16px)' : '80vh',
            overflowX: 'hidden',
            overflowY: isTouch ? 'auto' : 'hidden',
            display: 'flex',
            flexDirection: 'column',
            opacity: isDragActive ? 0.15 : 1,
            pointerEvents: isDragActive ? 'none' : 'auto',
            transition: 'opacity 0.2s ease',
            ...modalStyle,
          }}
        >
          <DraggableTitleBar
            dragHandleProps={dragHandleProps}
            title={`Exchange — Pick ${needCount} card${needCount > 1 ? 's' : ''} from ${targetZone === 'soul-deck' ? 'Soul Deck' : targetZone === 'reserve' ? 'Reserve' : 'Deck'}`}
            bottomGap={12}
            onClose={onCancel}
          >
            <ArrowLeftRight size={14} style={{ color: 'var(--gf-accent)', flexShrink: 0 }} />
          </DraggableTitleBar>

          {/* Exchange info banner */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: 'rgba(var(--gf-accent-rgb), 0.1)',
            border: '1px solid var(--gf-hover-strong)',
            borderRadius: 6,
            marginBottom: 12,
          }}>
            <span style={{ color: 'var(--gf-text)', fontSize: 12, fontFamily: 'var(--font-cinzel), Georgia, serif' }}>
              Sending to {targetZone === 'soul-deck' ? 'soul deck' : targetZone === 'reserve' ? 'Reserve' : 'deck'}:
            </span>
            {exchangeCards.map(c => (
              <span key={c.instanceId} style={{
                color: 'var(--gf-text-bright)',
                fontSize: 12,
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                background: 'var(--gf-hover)',
                padding: '2px 8px',
                borderRadius: 4,
              }}>
                {c.cardName}
              </span>
            ))}
            <span style={{ color: 'var(--gf-text-dim)', fontSize: 11, marginLeft: 'auto' }}>
              {selectedIds.size}/{needCount} selected
            </span>
          </div>

          {/* Ability filter (exchange_with_deck) — what the card may become */}
          {filter && (
            <DeckFilterBar
              label={filter.label}
              shown={pool.length}
              total={deckCards.length}
              filterOn={filterOn}
              onToggle={() => setFilterOn(v => !v)}
            />
          )}

          {/* Search input + field selector */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <select
                value={searchField}
                onChange={(e) => setSearchField(e.target.value as typeof searchField)}
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
                autoFocus={!isTouch}
                style={{
                  width: '100%',
                  padding: '8px 30px 8px 30px',
                  background: 'rgb(var(--gf-panel-rgb))',
                  border: '1px solid var(--gf-border)',
                  borderRadius: 4,
                  color: 'var(--gf-text)',
                  fontSize: isTouch ? 16 : 13,
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

          {/* Hint — mouse wording, and on a landscape phone the row is better
              spent on the cards. */}
          {!isTouch && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ color: 'var(--gf-border)', fontSize: 10 }}>
                Click to select · Drag to a zone to exchange · Hover to enlarge
              </span>
            </div>
          )}

          {/* Card grid — minHeight 0 lets it shrink and scroll instead of
              pushing the Confirm row out of the window; on touch it keeps a
              usable floor and the window scrolls instead. */}
          <div style={{ overflow: 'auto', flex: 1, minHeight: isTouch ? 140 : 0 }}>
            {filtered.length === 0 ? (
              <p style={{ color: 'var(--gf-text-dim)', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>
                {search
                  ? 'No cards match your search'
                  : filter && deckCards.length > 0
                    ? `No cards in ${targetZone === 'reserve' ? 'Reserve' : 'deck'} match ${filter.label}`
                    : (targetZone === 'soul-deck' ? 'Soul Deck is empty' : targetZone === 'reserve' ? 'Reserve is empty' : 'Deck is empty')}
              </p>
            ) : (
              <div
                // Touch: one height-filling row that scrolls sideways, as in
                // DeckSearchModal — whole cards at whatever height is left.
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
                      style={isTouch
                        ? { position: 'relative', cursor: 'grab', flex: '0 0 auto', height: '100%', aspectRatio: '5 / 7' }
                        : { position: 'relative', cursor: 'grab' }}
                      onPointerDown={(e) => handlePointerDown(card, imageUrl, e)}
                      onPointerUp={() => handlePointerUp(card)}
                      onMouseEnter={(e) => onCardMouseEnter(card.cardImgFile, card.cardName, e, card.instanceId)}
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
                              background: 'rgb(var(--gf-panel-rgb))',
                              border: isSelected ? '2px solid var(--gf-accent)' : '1px solid var(--gf-border)',
                              boxShadow: glowStyle?.boxShadow ?? selectedShadow,
                              borderRadius: 4,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'var(--gf-border)',
                              fontSize: 11,
                              padding: 4,
                              textAlign: 'center',
                              transition: 'border 0.1s ease',
                            }}
                          >
                            {card.cardName}
                          </div>
                        );
                      })()}
                      {/* Touch row cards fill the row height; a caption would overflow it. */}
                      {!isTouch && (
                        <p style={{
                          fontSize: 10,
                          color: 'var(--gf-text-dim)',
                          marginTop: 2,
                          textAlign: 'center',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {card.cardName}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer with confirm button */}
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 10,
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid rgba(var(--gf-border-rgb), 0.3)',
          }}>
            <button
              onClick={onCancel}
              style={{
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid var(--gf-border)',
                borderRadius: 6,
                color: 'var(--gf-text-dim)',
                fontSize: 12,
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedIds.size !== needCount}
              style={{
                padding: '8px 20px',
                background: selectedIds.size === needCount ? 'var(--gf-hover-strong)' : 'rgba(var(--gf-border-rgb), 0.15)',
                border: `1px solid ${selectedIds.size === needCount ? 'var(--gf-accent)' : 'var(--gf-border)'}`,
                borderRadius: 6,
                color: selectedIds.size === needCount ? 'var(--gf-text-bright)' : 'var(--gf-border)',
                fontSize: 12,
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                cursor: selectedIds.size === needCount ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <ArrowLeftRight size={13} />
              Confirm Exchange
            </button>
          </div>
        </div>
      </motion.div>

      <ModalCardHoverPreview hover={hover} />
    </>
  );
}
