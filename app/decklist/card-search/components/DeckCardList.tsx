import React from "react";
import { useDraggable } from "@dnd-kit/core";
import { DeckCard, DeckZone } from "../types/deck";
import { Card } from "../utils";
import { CardThumb } from "./CardThumb";
import { useCardPrices } from "../hooks/useCardPrices";
import { DeckSelectionContext, selectionKey } from "./DeckSelectionContext";

/**
 * Wrapper that makes a deck-card row draggable. The activation distance on
 * PointerSensor (6px) plus TouchSensor delay (200ms) keep ordinary clicks
 * from accidentally initiating a drag — so the existing onClick / stepper
 * handlers inside the row keep working. We deliberately do *not* set
 * `touch-action: none` here so the parent list still scrolls on mobile;
 * TouchSensor's delay/tolerance handles scroll-vs-drag arbitration.
 *
 * Also the row's multi-select hook-up: `data-select-key` is what the deck
 * panel's lasso hit-tests, and Shift/Cmd/Ctrl-click toggles the row in the
 * selection instead of opening the card.
 */
function DraggableRow({
  zone,
  card,
  className,
  children,
}: {
  zone: DeckZone;
  card: Card;
  className?: string;
  children: React.ReactNode;
}) {
  const key = selectionKey(zone, card);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: key,
    data: { fromZone: zone, card },
  });
  const selection = React.useContext(DeckSelectionContext);
  const isSelected = selection?.selected.has(key) ?? false;
  const isDimmed = isDragging || (isSelected && !!selection?.isDraggingSelection);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-select-key={key}
      // `.deck-card-enter` fills `both`, so its final opacity:1 would beat
      // opacity-40; dropping the animation lets the dim show.
      style={isDimmed ? { animation: "none" } : undefined}
      onClickCapture={
        selection
          ? (e) => {
              if (!(e.shiftKey || e.metaKey || e.ctrlKey)) return;
              // Controls inside the row (stepper, menu) keep their own click.
              if ((e.target as HTMLElement).closest("button, a, input")) return;
              e.preventDefault();
              e.stopPropagation();
              selection.toggle(key);
            }
          : undefined
      }
      className={`${className ?? ""} cursor-grab active:cursor-grabbing group/draggable relative select-none ${
        isDimmed ? "opacity-40" : ""
      } ${isSelected ? "rounded-lg ring-2 ring-primary" : ""}`}
      aria-roledescription="Draggable card"
    >
      {children}
    </div>
  );
}

interface DeckCardListProps {
  cards: DeckCard[];
  onIncrement: (cardName: string, cardSet: string, zone: DeckZone) => void;
  onDecrement: (cardName: string, cardSet: string, zone: DeckZone) => void;
  onRemove: (cardName: string, cardSet: string, zone: DeckZone) => void;
  /** Optional: Show only cards in a specific zone */
  filterZone?: DeckZone;
  onViewCard?: (card: Card) => void;
  /** Move a card between zones. Today the move button only swaps main↔reserve. */
  onMoveCard?: (cardName: string, cardSet: string, fromZone: DeckZone, toZone: DeckZone) => void;
  showTypeIcons?: boolean;
  viewLayout?: 'grid' | 'list';
  disableHoverPreview?: boolean;
  showPrices?: boolean;
}

/**
 * Reusable component for displaying a list of cards in a deck with quantity controls
 */
export default function DeckCardList({
  cards,
  onIncrement,
  onDecrement,
  onRemove,
  filterZone,
  onViewCard,
  onMoveCard,
  showTypeIcons = true,
  viewLayout = 'list',
  disableHoverPreview = false,
  showPrices = false,
}: DeckCardListProps) {
  const [openMenuCard, setOpenMenuCard] = React.useState<string | null>(null);
  const [previewCard, setPreviewCard] = React.useState<{ card: Card; x: number; y: number } | null>(null);
  const { getPrice } = useCardPrices();
  
  // Close menu when clicking outside or pressing ESC
  React.useEffect(() => {
    const handleClickOutside = () => {
      if (openMenuCard) {
        setOpenMenuCard(null);
      }
    };
    
    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openMenuCard) {
        setOpenMenuCard(null);
      }
    };
    
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [openMenuCard]);

  // Clear preview card if the card being previewed is removed from the deck
  React.useEffect(() => {
    if (!previewCard) return;
    
    // Check if the previewed card still exists in the cards array
    const cardStillExists = cards.some(
      dc => dc.card.name === previewCard.card.name && 
            dc.card.set === previewCard.card.set
    );
    
    // If the card was removed, clear the preview
    if (!cardStillExists) {
      setPreviewCard(null);
    }
  }, [cards, previewCard]);

  // Safety net: dismiss the hover preview on any interaction that can hide or
  // unmount the hovered card without dispatching its onMouseLeave (e.g. clicking
  // a card opens a full-screen modal over the cursor, +/-/move re-renders the
  // tile, scrolling, or switching tabs). Without this the preview can get stuck
  // on screen until a page refresh.
  React.useEffect(() => {
    if (!previewCard) return;
    const clear = () => setPreviewCard(null);
    // pointerdown fires before any modal mounts or the tile unmounts
    window.addEventListener('pointerdown', clear);
    // capture: true so inner scroll containers are caught, not just window
    window.addEventListener('scroll', clear, true);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    return () => {
      window.removeEventListener('pointerdown', clear);
      window.removeEventListener('scroll', clear, true);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', clear);
    };
  }, [previewCard]);

  // Helper function to calculate preview position avoiding screen edges
  const calculatePreviewPosition = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const previewWidth = 300;
    const previewHeight = 400;
    const padding = 10;
    
    let x = rect.right + padding;
    let y = rect.top;
    
    // Check if preview would go off the right edge
    if (x + previewWidth > window.innerWidth) {
      // Position to the left of the element instead
      x = rect.left - previewWidth - padding;
    }
    
    // Check if preview would go off the bottom edge
    if (y + previewHeight > window.innerHeight) {
      // Align to bottom of viewport with padding
      y = window.innerHeight - previewHeight - padding;
    }
    
    // Make sure y doesn't go negative
    if (y < padding) {
      y = padding;
    }
    
    return { x, y };
  };
  
  // Filter cards based on filterZone prop
  const filteredCards = React.useMemo(() => {
    if (filterZone === undefined) return cards;
    return cards.filter((dc) => dc.zone === filterZone);
  }, [cards, filterZone]);

  if (filteredCards.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        No cards yet
      </div>
    );
  }

  // Grid View
  if (viewLayout === 'grid') {
    return (
      <ZoneDroppable filterZone={filterZone} viewLayout="grid">
        {filteredCards.map((deckCard) => {
          const { card, quantity, zone } = deckCard;
          const cardKey = `${card.name}-${card.set}-${zone}`;
          const isReserve = zone === 'reserve';

          return (
            <DraggableRow key={cardKey} zone={zone} card={card} className="deck-card-enter">
            <div
              className="relative group rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all duration-200"
              onMouseEnter={disableHoverPreview ? undefined : (e) => {
                const pos = calculatePreviewPosition(e.currentTarget);
                setPreviewCard({
                  card,
                  ...pos
                });
              }}
              onMouseLeave={disableHoverPreview ? undefined : () => setPreviewCard(null)}
            >
              {/* Backdrop overlay for this card only */}
              {openMenuCard === cardKey && (
                <div 
                  className="absolute inset-0 bg-black/60 backdrop-blur-sm z-30"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuCard(null);
                  }}
                />
              )}

              {/* Card Image */}
              <div
                className="aspect-[2.5/3.5] bg-muted animate-pulse cursor-pointer relative"
                onClick={() => onViewCard?.(card)}
              >
                <CardThumb
                  card={card}
                  alt={card.name}
                  className="w-full h-full object-cover"
                  crossOrigin="anonymous"
                  ref={(el) => {
                    if (el?.complete && el.naturalWidth > 0) {
                      el.parentElement?.classList.remove('animate-pulse');
                    }
                  }}
                  onLoad={(e) => {
                    e.currentTarget.parentElement?.classList.remove('animate-pulse');
                  }}
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              
              {/* Dropdown Menu - 2×2 grid centered on card. Vertical stack
                  overflowed the card boundary on the small grid-view tile;
                  a compact grid keeps every action inside the thumbnail.
                  Maybeboard quadrants swap to Move-to-Main / Move-to-Reserve /
                  Remove-one / Remove-all. */}
              {openMenuCard === cardKey && (
                filterZone === 'maybeboard' ? (
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid grid-cols-2 gap-1 z-40">
                    {/* Move to Main */}
                    {onMoveCard ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuCard(null);
                          onMoveCard(card.name, card.set, zone, 'main');
                        }}
                        className="w-8 h-8 hover:scale-110 bg-card/95 backdrop-blur rounded-md shadow-lg border border-border flex items-center justify-center text-foreground transition-all"
                        title="Move to main deck"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                        </svg>
                      </button>
                    ) : (
                      <span aria-hidden />
                    )}

                    {/* Move to Reserve */}
                    {onMoveCard ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuCard(null);
                          onMoveCard(card.name, card.set, zone, 'reserve');
                        }}
                        className="w-8 h-8 hover:scale-110 bg-card/95 backdrop-blur rounded-md shadow-lg border border-border flex items-center justify-center text-foreground transition-all"
                        title="Move to reserve"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                        </svg>
                      </button>
                    ) : (
                      <span aria-hidden />
                    )}

                    {/* Remove one copy */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuCard(null);
                        onDecrement(card.name, card.set, zone);
                      }}
                      className="w-8 h-8 hover:scale-110 bg-card/95 backdrop-blur rounded-md shadow-lg border border-border flex items-center justify-center text-foreground transition-all"
                      title="Remove one copy"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M20 12H4" />
                      </svg>
                    </button>

                    {/* Remove all copies */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuCard(null);
                        onRemove(card.name, card.set, zone);
                      }}
                      className="w-8 h-8 hover:scale-110 bg-card/95 backdrop-blur rounded-md shadow-lg border border-border flex items-center justify-center text-red-600 dark:text-red-400 transition-all"
                      title="Remove all copies"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid grid-cols-2 gap-1 z-40">
                  {/* View Card Details */}
                  {onViewCard ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewCard(card);
                        setOpenMenuCard(null);
                      }}
                      className="w-8 h-8 hover:scale-110 bg-card/95 backdrop-blur rounded-md shadow-lg border border-border flex items-center justify-center text-foreground transition-all"
                      title="View card details"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </button>
                  ) : (
                    <span aria-hidden />
                  )}

                  {/* Move to Reserve/Main */}
                  {onMoveCard && filterZone !== undefined ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuCard(null);
                        onMoveCard(card.name, card.set, zone, isReserve ? 'main' : 'reserve');
                      }}
                      className="w-8 h-8 hover:scale-110 bg-card/95 backdrop-blur rounded-md shadow-lg border border-border flex items-center justify-center text-foreground transition-all"
                      title={isReserve ? "Move to main deck" : "Move to reserve"}
                    >
                      {isReserve ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                        </svg>
                      )}
                    </button>
                  ) : (
                    <span aria-hidden />
                  )}

                  {/* Remove All Copies */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuCard(null);
                      onRemove(card.name, card.set, zone);
                    }}
                    className="w-8 h-8 hover:scale-110 bg-card/95 backdrop-blur rounded-md shadow-lg border border-border flex items-center justify-center text-red-600 dark:text-red-400 transition-all"
                    title="Remove all copies"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>

                  {/* Move to Maybeboard */}
                  {onMoveCard && filterZone !== undefined ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuCard(null);
                        onMoveCard(card.name, card.set, zone, 'maybeboard');
                      }}
                      className="w-8 h-8 hover:scale-110 bg-card/95 backdrop-blur rounded-md shadow-lg border border-border flex items-center justify-center text-violet-600 dark:text-violet-400 transition-all"
                      title="Move to maybeboard"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                      </svg>
                    </button>
                  ) : (
                    <span aria-hidden />
                  )}
                </div>
                )
              )}

              {/* Controls Overlay - Shows on Hover, Golden Ratio 2x2 Grid */}
              <div className="absolute inset-x-0 bottom-0 transition-opacity duration-200">
                {/* Using golden ratio: top section ~61.8%, bottom ~38.2% */}
                <div className="grid grid-rows-[1.618fr_1fr] grid-cols-2 gap-1.5 p-3 h-32">
                  {/* Top Left: Decrement */}
                  <div className="flex items-center justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDecrement(card.name, card.set, zone);
                      }}
                      className="w-14 h-14 max-w-full max-h-full flex items-center justify-center rounded-lg bg-black/30 hover:bg-black/50 backdrop-blur-md text-white transition-all font-bold text-3xl border border-white/20 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                  </div>
                  
                  {/* Top Right: Increment */}
                  <div className="flex items-center justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onIncrement(card.name, card.set, zone);
                      }}
                      className="w-14 h-14 max-w-full max-h-full flex items-center justify-center rounded-lg bg-black/30 hover:bg-black/50 backdrop-blur-md text-white transition-all font-bold text-3xl border border-white/20 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  
                  {/* Bottom Left: Menu Button */}
                  <div className="flex items-center justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuCard(openMenuCard === cardKey ? null : cardKey);
                      }}
                      className="w-10 h-10 max-w-full max-h-full flex items-center justify-center rounded-lg bg-black/30 hover:bg-black/50 backdrop-blur-md text-white transition-all border border-white/20 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                      aria-label="Card options"
                    >
                      {/* Horizontal dots icon */}
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
                      </svg>
                    </button>
                  </div>
                  
                  {/* Bottom Right: Quantity Display - Always Visible, Compact Style.
                      Translucent with no blur so the card text under it stays
                      readable on phones, where there is no hover preview. */}
                  <div className="flex items-center justify-center">
                    <div key={quantity} className="animate-qty-pop bg-black/50 text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)] px-2.5 py-1 rounded-md font-bold text-sm shadow-lg">
                      ×{quantity}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* Price label below card */}
            {showPrices && (() => {
              const priceKey = `${card.name}|${card.set}|${card.imgFile}`;
              const priceInfo = getPrice(priceKey);
              return priceInfo ? (
                <div className="text-[10px] text-green-600 dark:text-green-400 text-center mt-0.5 tabular-nums font-medium truncate">
                  ${priceInfo.price.toFixed(2)}
                </div>
              ) : null;
            })()}
            </DraggableRow>
          );
        })}

        {/* Card Preview on Hover */}
  {(!disableHoverPreview && previewCard) && (
          <div
            className="fixed z-50 pointer-events-none"
            style={{
              left: `${previewCard.x}px`,
              top: `${previewCard.y}px`,
              maxWidth: '300px',
            }}
          >
            <CardThumb
              card={previewCard.card}
              alt={previewCard.card.name}
              className="rounded-lg shadow-2xl border-2 border-border"
              style={{ maxHeight: '400px', width: 'auto' }}
            />
          </div>
        )}
      </ZoneDroppable>
    );
  }

  // List View (default)
  return (
    <ZoneDroppable filterZone={filterZone} viewLayout="list">
      {filteredCards.map((deckCard) => {
        const { card, quantity, zone } = deckCard;
        const cardKey = `${card.name}-${card.set}-${zone}`;
        const isReserve = zone === 'reserve';
        
        // Determine icon path for dominants, fortresses, and enhancements based on alignment/type
        const getIconPath = () => {
          if (card.type === 'Dominant' || card.type === 'Dom') {
            if (card.alignment === 'Good') {
              return '/filter-icons/Good Dominant.png';
            } else if (card.alignment === 'Evil') {
              return '/filter-icons/Evil Dominant.png';
            } else if (card.alignment === 'Neutral') {
              // For neutral dominants, we'll show both icons
              return null; // Handle separately
            }
          }
          if (card.type === 'Fortress' || card.type === 'Fort') {
            if (card.alignment === 'Good') {
              return '/filter-icons/Good Fortress.png';
            } else if (card.alignment === 'Evil') {
              return '/filter-icons/Evil Fortress.png';
            } else if (card.alignment === 'Neutral') {
              // For neutral fortresses, we'll show both icons
              return null; // Handle separately
            }
          }
          // Handle Good Enhancement (GE) and Evil Enhancement (EE)
          // Check for combined types like "GE/EE" - show both icons
          if (card.type === 'GE/EE' || card.type === 'EE/GE') {
            return null; // Handle with dual icons
          }
          if (card.type === 'GE' || card.type === 'Good Enhancement') {
            return '/filter-icons/GE.png';
          }
          if (card.type === 'EE' || card.type === 'Evil Enhancement') {
            return '/filter-icons/EE.png';
          }
          // Handle Hero/Evil Character dual type
          if (card.type === 'Hero/Evil Character' || card.type === 'Evil Character/Hero') {
            return null; // Handle with dual icons
          }
          // Handle Evil Character/Fortress dual type
          if (card.type === 'Evil Character/Fortress' || card.type === 'Fortress/Evil Character') {
            return null; // Handle with dual icons
          }
          // Handle Hero/Fortress dual type
          if (card.type === 'Hero/Fortress' || card.type === 'Fortress/Hero') {
            return null; // Handle with dual icons
          }
          // Handle Hero/GE dual type
          if (card.type === 'Hero/GE' || card.type === 'GE/Hero') {
            return null; // Handle with dual icons
          }
          // Handle EE/Evil Character dual type
          if (card.type === 'EE/Evil Character' || card.type === 'Evil Character/EE') {
            return null; // Handle with dual icons
          }
          // Handle GE/Evil Character dual type
          if (card.type === 'GE/Evil Character' || card.type === 'Evil Character/GE') {
            return null; // Handle with dual icons
          }
          return `/filter-icons/${card.type}.png`;
        };
        
        const iconPath = getIconPath();
        const isNeutralDominant = (card.type === 'Dominant' || card.type === 'Dom') && card.alignment === 'Neutral';
        const isNeutralFortress = (card.type === 'Fortress' || card.type === 'Fort') && card.alignment === 'Neutral';
        const isDualEnhancement = card.type === 'GE/EE' || card.type === 'EE/GE';
        const isDualHeroEC = card.type === 'Hero/Evil Character' || card.type === 'Evil Character/Hero';
        const isDualECFortress = card.type === 'Evil Character/Fortress' || card.type === 'Fortress/Evil Character';
        const isDualHeroFortress = card.type === 'Hero/Fortress' || card.type === 'Fortress/Hero';
        const isDualHeroGE = card.type === 'Hero/GE' || card.type === 'GE/Hero';
        const isDualEEEC = card.type === 'EE/Evil Character' || card.type === 'Evil Character/EE';
        const isDualGEEC = card.type === 'GE/Evil Character' || card.type === 'Evil Character/GE';

        return (
          <DraggableRow
            key={cardKey}
            zone={zone}
            card={card}
            className="flex items-center gap-2 p-2 rounded bg-muted hover:bg-muted/80 transition-colors group"
          >
            {/* Type Icon */}
            {showTypeIcons && (
              <>
                {isNeutralDominant ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={disableHoverPreview ? undefined : (e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={disableHoverPreview ? undefined : () => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/Good Dominant.png" 
                      alt="Good Dominant"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/Evil Dominant.png" 
                      alt="Evil Dominant"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isNeutralFortress ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/Good Fortress.png" 
                      alt="Good Fortress"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/Evil Fortress.png" 
                      alt="Evil Fortress"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isDualEnhancement ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/GE.png" 
                      alt="Good Enhancement"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/EE.png" 
                      alt="Evil Enhancement"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isDualHeroEC ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/Hero.png" 
                      alt="Hero"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/Evil Character.png" 
                      alt="Evil Character"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isDualECFortress ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/Evil Character.png" 
                      alt="Evil Character"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/Evil Fortress.png" 
                      alt="Evil Fortress"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isDualHeroFortress ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/Hero.png" 
                      alt="Hero"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/Good Fortress.png" 
                      alt="Good Fortress"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isDualHeroGE ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/Hero.png" 
                      alt="Hero"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/GE.png" 
                      alt="Good Enhancement"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isDualEEEC ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/EE.png" 
                      alt="Evil Enhancement"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/Evil Character.png" 
                      alt="Evil Character"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : isDualGEEC ? (
                  <div 
                    className="flex gap-0.5 flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                  >
                    <img 
                      src="/filter-icons/GE.png" 
                      alt="Good Enhancement"
                      className="w-8 h-8 object-contain"
                    />
                    <img 
                      src="/filter-icons/Evil Character.png" 
                      alt="Evil Character"
                      className="w-8 h-8 object-contain"
                    />
                  </div>
                ) : iconPath && (
                  <img 
                    src={iconPath} 
                    alt={card.type}
                    className="w-8 h-8 object-contain flex-shrink-0 cursor-pointer"
                    onMouseEnter={(e) => {
                      const pos = calculatePreviewPosition(e.currentTarget);
                      setPreviewCard({
                        card,
                        ...pos
                      });
                    }}
                    onMouseLeave={() => setPreviewCard(null)}
                    onError={(e) => {
                      // Hide icon if image doesn't exist
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
              </>
            )}
            
            {/* Quantity Controls with Badge */}
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {/* Decrement Button (always visible) */}
              <button
                onClick={() => onDecrement(card.name, card.set, zone)}
                className="w-7 h-7 flex items-center justify-center rounded bg-muted hover:bg-muted/70 text-foreground transition-colors font-semibold text-base"
                aria-label="Decrease quantity"
                title="Decrease quantity"
              >
                −
              </button>

              {/* Quantity Badge (always visible, not a button) */}
              <div key={quantity} className="animate-qty-pop flex-shrink-0 w-9 h-7 flex items-center justify-center text-foreground font-bold text-sm">
                {quantity}
              </div>

              {/* Increment Button (always visible) */}
              <button
                onClick={() => onIncrement(card.name, card.set, zone)}
                className="w-7 h-7 flex items-center justify-center rounded bg-muted hover:bg-muted/70 text-foreground transition-colors font-semibold text-base"
                aria-label="Increase quantity"
                title="Increase quantity"
              >
                +
              </button>
            </div>

            {/* Card Info */}
            <div className="flex-1 min-w-0">
              <div
                className="text-sm font-medium text-foreground truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                onMouseEnter={(e) => {
                  const pos = calculatePreviewPosition(e.currentTarget);
                  setPreviewCard({
                    card,
                    ...pos
                  });
                }}
                onMouseLeave={() => setPreviewCard(null)}
              >
                {card.name}
              </div>
            </div>

            {/* Price */}
            {(() => {
              const priceKey = `${card.name}|${card.set}|${card.imgFile}`;
              const priceInfo = getPrice(priceKey);
              return priceInfo ? (
                <span className="text-xs text-green-600 dark:text-green-400 font-medium flex-shrink-0 tabular-nums">
                  ${priceInfo.price.toFixed(2)}
                </span>
              ) : null;
            })()}

            {/* Additional Controls */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {/* View Card Button */}
              {onViewCard && (
                <button
                  onClick={() => onViewCard(card)}
                  className="w-6 h-6 flex items-center justify-center rounded bg-muted hover:bg-primary text-foreground hover:text-primary-foreground transition-colors"
                  aria-label="View card details"
                  title="View card details"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd"/>
                  </svg>
                </button>
              )}
              
              {/* Move Card Button (between main deck and reserve) */}
              {onMoveCard && filterZone !== undefined && filterZone !== 'maybeboard' && (
                <button
                  onClick={() => onMoveCard(card.name, card.set, zone, isReserve ? 'main' : 'reserve')}
                  className="w-8 h-6 flex items-center justify-center rounded bg-muted hover:bg-muted/70 text-foreground transition-colors text-xs font-bold"
                  aria-label={isReserve ? "Move to main deck" : "Move to reserve"}
                  title={isReserve ? "Move to main deck" : "Move to reserve"}
                >
                  {isReserve ? "<<" : ">>"}
                </button>
              )}

              {/* Move to Maybeboard Button */}
              {onMoveCard && filterZone !== undefined && filterZone !== 'maybeboard' && (
                <button
                  onClick={() => onMoveCard(card.name, card.set, zone, 'maybeboard')}
                  className="w-6 h-6 flex items-center justify-center rounded bg-violet-100 hover:bg-violet-200 dark:bg-violet-900/40 dark:hover:bg-violet-900/60 text-violet-700 dark:text-violet-300 transition-colors"
                  aria-label="Move to maybeboard"
                  title="Move to maybeboard"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </button>
              )}

              {/* Maybeboard list-view: Move to Main / Move to Reserve */}
              {onMoveCard && filterZone === 'maybeboard' && (
                <>
                  <button
                    onClick={() => onMoveCard(card.name, card.set, zone, 'main')}
                    className="w-8 h-6 flex items-center justify-center rounded bg-muted hover:bg-muted/70 text-foreground transition-colors text-xs font-bold"
                    aria-label="Move to main deck"
                    title="Move to main deck"
                  >
                    {"<<"}
                  </button>
                  <button
                    onClick={() => onMoveCard(card.name, card.set, zone, 'reserve')}
                    className="w-8 h-6 flex items-center justify-center rounded bg-muted hover:bg-muted/70 text-foreground transition-colors text-xs font-bold"
                    aria-label="Move to reserve"
                    title="Move to reserve"
                  >
                    {">>"}
                  </button>
                </>
              )}

              {/* Remove Button */}
              <button
                onClick={() => onRemove(card.name, card.set, zone)}
                className="w-6 h-6 flex items-center justify-center rounded bg-red-500 hover:bg-red-600 text-white transition-colors"
                aria-label="Remove card"
                title="Remove card from deck"
              >
                <span className="text-lg leading-none">×</span>
              </button>
            </div>
          </DraggableRow>
        );
      })}

      {/* Card Preview on Hover */}
  {(!disableHoverPreview && previewCard) && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: `${previewCard.x}px`,
            top: `${previewCard.y}px`,
            maxWidth: '300px',
          }}
        >
          <CardThumb
            card={previewCard.card}
            alt={previewCard.card.name}
            className="rounded-lg shadow-2xl border-2 border-border"
            style={{ maxHeight: '400px', width: 'auto' }}
          />
        </div>
      )}
    </ZoneDroppable>
  );
}

/**
 * Layout wrapper for the cards in a single DeckCardList. The actual
 * `useDroppable` for zone:main / zone:reserve / zone:maybeboard lives one
 * level up in `DeckBuilderPanel`, registered once per tab — this avoids
 * duplicate droppable ids when grouped views render multiple DeckCardList
 * instances for one zone.
 */
function ZoneDroppable({
  filterZone: _filterZone,
  viewLayout,
  children,
}: {
  filterZone: DeckZone | undefined;
  viewLayout: 'grid' | 'list';
  children: React.ReactNode;
}) {
  const wrapClass =
    viewLayout === 'grid'
      ? 'grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5 sm:gap-2'
      : 'space-y-1';
  return <div className={wrapClass}>{children}</div>;
}
