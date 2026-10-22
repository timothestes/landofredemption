'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { GameCard } from '@/app/shared/types/gameCard';

interface CardReaderOverlayProps {
  card: GameCard;
  /** Already resolved (forge-aware) image URL, or '' when unavailable. */
  imageUrl: string;
  onClose: () => void;
}

/**
 * Full-screen card reader.
 *
 * On a pointer device a player reads a card by hovering it — the hover preview
 * and the right panel's loupe are both hover-fed, and both are disabled on
 * touch (see the `!isTouch` gate on the hover preview in MultiplayerCanvas and
 * `[data-panel-preview] { display: none }` in globals.css). That left a phone
 * player with no way at all to read a card's text: board cards render around
 * 57x79 px at fit.
 *
 * This is that missing surface — reached from the touch context sheet's header
 * and from the board browse sheets. Landscape phones are wide and short, so the
 * layout is a row: the scan fills the height, the text column scrolls beside it.
 * Portrait is the opposite shape and gets a column instead — see `isPortrait`.
 */
export function CardReaderOverlay({ card, imageUrl, onClose }: CardReaderOverlayProps) {
  // The row layout above assumes a short, wide viewport. A player who took
  // "Continue anyway" past the rotate gate reads cards in portrait, where a row
  // squeezed the scan into 205px of a 393px screen (a third of the height it
  // could use) and left the text in a 154px column — unreadable, which defeats
  // the whole point of this overlay.
  const [isPortrait, setIsPortrait] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const sync = () => setIsPortrait(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stats = card.strength || card.toughness
    ? `${card.strength || '–'} / ${card.toughness || '–'}`
    : null;

  return (
    <div
      data-card-reader
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        inset: 0,
        // Above the touch context sheet (900) and the right panel's phone
        // overlay (300) — the reader is opened FROM the sheet and must cover it.
        zIndex: 1200,
        background: 'rgba(0,0,0,0.88)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        padding: 'max(10px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left))',
        // The scan is tall; a landscape phone is short. Row keeps the image as
        // large as the height allows and gives the text the leftover width.
        // Portrait is tall and narrow, so stack instead and let the scan take
        // the width.
        flexDirection: isPortrait ? 'column' : 'row',
      }}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={card.cardName}
          // The scan plus the text column cover nearly the whole screen, so
          // the closes-on-tap "backdrop" was just the padding ring — in
          // practice only the 44px × closed the reader. Tapping the scan is
          // the natural dismiss; the text column keeps swallowing taps so
          // scrolling it never closes the reader.
          onClick={onClose}
          style={{
            ...(isPortrait
              ? { width: '100%', height: 'auto', maxHeight: '64%' }
              : { height: '100%', width: 'auto', maxWidth: '55%' }),
            objectFit: 'contain',
            borderRadius: 8,
            boxShadow: '0 10px 40px rgba(0,0,0,0.7)',
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            ...(isPortrait ? { width: '100%', maxHeight: '64%' } : { height: '100%' }),
            aspectRatio: '5 / 7',
            borderRadius: 8,
            border: '1px solid rgba(var(--gf-border-rgb), 0.5)',
            background: 'rgba(var(--gf-panel-rgb), 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(var(--gf-text-bright-rgb), 0.5)',
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          No scan
        </div>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          minWidth: 0,
          width: isPortrait ? '100%' : undefined,
          maxWidth: isPortrait ? '100%' : 460,
          maxHeight: '100%',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          color: 'var(--gf-text-bright)',
        }}
      >
        <div style={{
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 17,
          fontWeight: 700,
          lineHeight: 1.25,
          paddingRight: 52, // clear of the close button
        }}>
          {card.cardName || 'Face-down card'}
        </div>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 10px',
          marginTop: 6,
          fontSize: 12,
          color: 'rgba(var(--gf-text-bright-rgb), 0.65)',
        }}>
          {card.type && <span>{card.type}</span>}
          {card.brigade && <span style={{ color: 'rgba(212,168,103,0.85)' }}>{card.brigade}</span>}
          {stats && <span>{stats}</span>}
          {card.identifier && <span>{card.identifier}</span>}
        </div>
        {card.specialAbility && (
          <p style={{
            marginTop: 10,
            fontSize: 13,
            lineHeight: 1.45,
            color: 'rgba(var(--gf-text-bright-rgb), 0.92)',
            whiteSpace: 'pre-wrap',
          }}>
            {card.specialAbility}
          </p>
        )}
        {card.reference && (
          <p style={{
            marginTop: 8,
            fontSize: 11,
            fontStyle: 'italic',
            color: 'rgba(var(--gf-text-bright-rgb), 0.55)',
          }}>
            {card.reference}
          </p>
        )}
        {card.notes && (
          <p style={{
            marginTop: 10,
            fontSize: 12,
            lineHeight: 1.4,
            color: 'var(--gf-accent)',
            borderTop: '1px solid rgba(var(--gf-border-rgb), 0.5)',
            paddingTop: 8,
          }}>
            {card.notes}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close card view"
        data-testid="card-reader-close"
        style={{
          position: 'absolute',
          top: 'max(8px, env(safe-area-inset-top))',
          right: 'max(8px, env(safe-area-inset-right))',
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          border: '1px solid rgba(var(--gf-border-rgb), 0.6)',
          background: 'rgba(var(--gf-bg-dark-rgb), 0.9)',
          color: 'var(--gf-text-bright)',
        }}
      >
        <X size={20} />
      </button>
    </div>
  );
}
