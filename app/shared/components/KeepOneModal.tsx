'use client';

import { useEffect, useState } from 'react';
import type { GameCard } from '@/app/shared/types/gameCard';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';

interface KeepOneModalProps {
  /** The local player's hand. Only ever their own — never the opponent's. */
  hand: GameCard[];
  /** Name of the card that triggered this (e.g. "Philip's Daughters [RR2]"). */
  sourceCardName?: string;
  /** True when this is the opponent answering the caster's request, which
   *  changes the framing from "you played it" to "you have to respond". */
  isResponding?: boolean;
  onConfirm: (keepInstanceId: string) => void;
  onCancel: () => void;
}

/**
 * Picker for `all_players_keep_one_shuffle_draw` (Philip's Daughters): choose
 * the single card to keep. Everything else in the hand shuffles into the deck
 * and the player draws that many back.
 *
 * Each player runs this over their own hand, so neither sees the other's
 * choice before committing to their own.
 */
export function KeepOneModal({
  hand,
  sourceCardName,
  isResponding,
  onConfirm,
  onCancel,
}: KeepOneModalProps) {
  const [selected, setSelected] = useState<string | null>(null);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // A hand that empties out from under the modal has nothing to choose.
  const shuffleCount = hand.length > 0 ? hand.length - 1 : 0;

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
          Keep one card
        </div>
        <div style={{ fontSize: 12, color: 'var(--gf-text-dim)', marginBottom: 14 }}>
          {isResponding
            ? `${sourceCardName ?? 'Your opponent'} — pick the card you keep. `
            : 'Pick the card you keep. '}
          {hand.length === 0
            ? 'Your hand is empty, so nothing happens.'
            : `The other ${shuffleCount} shuffle${shuffleCount === 1 ? 's' : ''} into your deck and you draw ${shuffleCount}.`}
        </div>

        <div style={{ overflowY: 'auto', flex: 1, marginBottom: 16 }}>
          {hand.length === 0 ? (
            <div
              style={{
                padding: '32px 0',
                textAlign: 'center',
                color: 'var(--gf-text-dim)',
                fontSize: 13,
              }}
            >
              No cards in hand.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                gap: 10,
              }}
            >
              {hand.map((card) => {
                const imageUrl = getCardImageUrl(card.cardImgFile);
                const isSelected = selected === card.instanceId;
                return (
                  <div
                    key={card.instanceId}
                    onClick={() => setSelected(card.instanceId)}
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
                          border: isSelected ? '2px solid var(--gf-accent)' : '1px solid var(--gf-border)',
                          boxShadow: isSelected ? '0 0 8px rgba(var(--gf-accent-rgb), 0.5)' : 'none',
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
                          border: isSelected ? '2px solid var(--gf-accent)' : '1px solid var(--gf-border)',
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
            // An empty hand still confirms — it's a legitimate no-op, and the
            // opponent's half of the effect shouldn't be blocked by it.
            onClick={() => onConfirm(selected ?? '')}
            disabled={hand.length > 0 && selected === null}
            style={btnStyle('primary', hand.length > 0 && selected === null)}
          >
            {hand.length === 0 ? 'Continue' : 'Keep this card'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Matches the button treatment used by the other goldfish-palette modals. */
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
      border: '1px solid var(--gf-accent)',
      background: disabled ? 'transparent' : 'var(--gf-accent)',
      color: disabled ? 'var(--gf-text-dim)' : 'var(--gf-bg-dark)',
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
