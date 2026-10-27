'use client';

import { useEffect, useState } from 'react';
import type { GameCard } from '@/app/shared/types/gameCard';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { deriveTestamentAndGospel } from '@/app/decklist/card-search/data/testament';

/**
 * True when a Reserve card qualifies for take_enhancement_from_reserve: a GE
 * or EE segment in its type (there is no literal "Enhancement" type), and —
 * when `testament` is set — a reference from that testament (dual-testament
 * references count).
 */
export function isReserveEnhancement(card: GameCard, testament?: 'OT'): boolean {
  const isEnhancement = card.type.split('/').map((s) => s.trim()).some((s) => s === 'GE' || s === 'EE');
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
}

/**
 * Picker for `take_enhancement_from_reserve` (Storehouse): choose one
 * Enhancement from your Reserve; on confirm it goes to your hand.
 */
export function ReserveEnhancementModal({
  cards,
  sourceCardName,
  kindLabel,
  onConfirm,
  onCancel,
}: ReserveEnhancementModalProps) {
  const [selected, setSelected] = useState<string | null>(null);

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
                    onClick={() => setSelected(card.instanceId)}
                    onDoubleClick={() => onConfirm(card.instanceId)}
                    title={card.cardName}
                    style={{ position: 'relative', cursor: 'pointer' }}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={card.cardName}
                        draggable={false}
                        style={{
                          width: '100%',
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
