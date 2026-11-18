'use client';

import { useEffect, useRef, useState } from 'react';
import type { GameCard } from '@/app/shared/types/gameCard';
import { getCardImageUrl, CARD_IMAGE_ASPECT_RATIO } from '@/app/shared/utils/cardImageUrl';
import { deriveTestamentAndGospel } from '@/app/decklist/card-search/data/testament';

/**
 * True when a Reserve card qualifies for take_enhancement_from_reserve: a GE
 * or EE segment in its type (there is no literal "Enhancement" type) or a
 * Covenant or Curse, which are Enhancements too, and — when `testament` is
 * set — a reference from that testament (dual-testament references count).
 */
export function isReserveEnhancement(card: GameCard, testament?: 'OT'): boolean {
  const isEnhancement = card.type.split('/').map((s) => s.trim()).some((s) => s === 'GE' || s === 'EE' || s === 'Covenant' || s === 'Curse');
  if (!isEnhancement) return false;
  if (!testament) return true;
  return deriveTestamentAndGospel(card.reference).testament.split('/').includes(testament);
}

interface ReserveEnhancementModalProps {
  /** The local player's Reserve Enhancements that qualify for the ability. */
  cards: GameCard[];
  /** Name of the card that triggered this (e.g. "Storehouse [IR]"). */
  sourceCardName?: string;
  /** Shown in the title and empty state, e.g. "O.T. Enhancement". */
  kindLabel: string;
  onConfirm: (instanceId: string) => void;
  onCancel: () => void;
  /** Drag-out handlers (same infra the zone-browse modals use). When given,
   *  a card can be dragged onto the board; a plain click still selects it. */
  onStartDrag?: (card: GameCard, imageUrl: string, e: React.PointerEvent) => void;
  didDragRef?: React.MutableRefObject<boolean>;
  /** True while a card from this modal is being dragged. The modal fades and
   *  goes pointer-through so the drop reaches the board, and closes when the
   *  drag ends — the card has been taken by hand. */
  isDragActive?: boolean;
}

/**
 * Picker for `take_enhancement_from_reserve` (Storehouse): choose one
 * Enhancement from your Reserve; on confirm it goes to your hand. A card can
 * also be dragged straight to any zone, like the other browse windows.
 */
export function ReserveEnhancementModal({
  cards,
  sourceCardName,
  kindLabel,
  onConfirm,
  onCancel,
  onStartDrag,
  didDragRef,
  isDragActive,
}: ReserveEnhancementModalProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const pointerDownCardRef = useRef<string | null>(null);

  // Close once a drag-out ends (isDragActive true → false). Refs keep the
  // effect keyed to that transition alone, not to callback identity.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const prevDragActive = useRef(false);
  useEffect(() => {
    if (prevDragActive.current && !isDragActive) {
      if (didDragRef) didDragRef.current = false;
      onCancelRef.current();
    }
    prevDragActive.current = !!isDragActive;
  }, [isDragActive, didDragRef]);

  const handlePointerDown = (card: GameCard, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    pointerDownCardRef.current = card.instanceId;
    if (didDragRef) didDragRef.current = false;
    onStartDrag?.(card, getCardImageUrl(card.cardImgFile), e);
  };

  // Only a click (no drag) on the same card selects it.
  const handlePointerUp = (card: GameCard) => {
    if (pointerDownCardRef.current !== card.instanceId) return;
    pointerDownCardRef.current = null;
    if (didDragRef?.current) {
      didDragRef.current = false;
      return;
    }
    setSelected(card.instanceId);
  };

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // A selection that left the Reserve under the modal can't be taken.
  const validSelected = selected !== null && cards.some((c) => c.instanceId === selected) ? selected : null;

  return (
    <div
      data-blocking-prompt
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 900,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Pointer-through while dragging so the drop reaches the board below.
        pointerEvents: isDragActive ? 'none' : 'auto',
      }}
    >
      <div
        style={{
          background: 'var(--gf-bg)',
          border: '1px solid var(--gf-border)',
          borderRadius: 8,
          padding: '18px 22px',
          width: 'min(680px, 90vw)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
          opacity: isDragActive ? 0.15 : 1,
          pointerEvents: isDragActive ? 'none' : 'auto',
          transition: 'opacity 0.2s ease',
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          style={{
            fontSize: 16,
            color: 'var(--gf-text-bright)',
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            marginBottom: 6,
          }}
        >
          Take an {kindLabel} from Reserve
        </div>
        <div style={{ fontSize: 12, color: 'var(--gf-text-dim)', marginBottom: 14 }}>
          {sourceCardName ? `${sourceCardName} — ` : ''}pick one to put in your hand.
        </div>

        <div style={{ overflowY: 'auto', flex: 1, marginBottom: 16 }}>
          {cards.length === 0 ? (
            <div
              style={{
                padding: '32px 0',
                textAlign: 'center',
                color: 'var(--gf-text-dim)',
                fontSize: 13,
              }}
            >
              No {kindLabel}s in your Reserve.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                gap: 10,
              }}
            >
              {cards.map((card) => {
                const imageUrl = getCardImageUrl(card.cardImgFile);
                const isSelected = validSelected === card.instanceId;
                return (
                  <div
                    key={card.instanceId}
                    onPointerDown={(e) => handlePointerDown(card, e)}
                    onPointerUp={() => handlePointerUp(card)}
                    onDoubleClick={() => onConfirm(card.instanceId)}
                    title={card.cardName}
                    style={{
                      position: 'relative',
                      cursor: onStartDrag ? 'grab' : 'pointer',
                      touchAction: onStartDrag ? 'none' : undefined,
                    }}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={card.cardName}
                        draggable={false}
                        style={{
                          width: '100%',
                          // Reserve the card's height before the image loads.
                          aspectRatio: CARD_IMAGE_ASPECT_RATIO,
                          objectFit: 'contain',
                          borderRadius: 4,
                          border: isSelected ? `2px solid ${GREEN}` : '1px solid var(--gf-border)',
                          boxShadow: isSelected ? '0 0 8px rgba(22, 163, 74, 0.5)' : 'none',
                          opacity: isSelected ? 1 : 0.85,
                          transition: 'border 0.1s ease, opacity 0.1s ease',
                          pointerEvents: 'none',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '1/1.4',
                          background: 'var(--gf-bg-dark)',
                          border: isSelected ? `2px solid ${GREEN}` : '1px solid var(--gf-border)',
                          borderRadius: 4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--gf-text-dim)',
                          fontSize: 10,
                          padding: 4,
                          textAlign: 'center',
                          pointerEvents: 'none',
                        }}
                      >
                        {card.cardName}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onCancel}
            style={btnStyle('ghost', false)}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--gf-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            Cancel
          </button>
          <button
            onClick={() => { if (validSelected) onConfirm(validSelected); }}
            disabled={validSelected === null}
            style={btnStyle('primary', validSelected === null)}
          >
            Put in hand
          </button>
        </div>
      </div>
    </div>
  );
}

const GREEN = '#16a34a';

/** The goldfish-palette modal buttons, with a green confirm. */
function btnStyle(variant: 'primary' | 'ghost', disabled: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: 6,
    fontSize: 13,
    fontFamily: 'var(--font-cinzel), Georgia, serif',
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background 0.1s ease, border 0.1s ease',
  };
  if (variant === 'primary') {
    return {
      ...base,
      border: `1px solid ${GREEN}`,
      background: disabled ? 'transparent' : GREEN,
      color: disabled ? 'var(--gf-text-dim)' : '#fff',
      opacity: disabled ? 0.6 : 1,
    };
  }
  return {
    ...base,
    border: '1px solid var(--gf-border)',
    background: 'transparent',
    color: 'var(--gf-text-dim)',
    opacity: disabled ? 0.5 : 1,
  };
}
