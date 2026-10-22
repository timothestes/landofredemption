'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HoveredCardInfo {
  cardName: string;
  cardImgFile: string;
  cardType: string;
  strength: string;
  toughness: string;
  specialAbility: string;
  brigade: string;
  x: number;
  y: number;
}

export interface ZoomedCardInfo {
  cardName: string;
  cardImgFile: string;
  specialAbility: string;
}

interface CardPreviewSystemProps {
  hoveredCard: HoveredCardInfo | null;
  zoomedCard: ZoomedCardInfo | null;
  onCloseZoom: () => void;
  getImage: (url: string) => HTMLImageElement | null;
}

// ---------------------------------------------------------------------------
// Hover Preview
// ---------------------------------------------------------------------------

const PREVIEW_WIDTH = 220;
const PREVIEW_HEIGHT = PREVIEW_WIDTH * 1.4;

interface FallbackImageProps {
  src: string;
  alt: string;
  imgStyle: CSSProperties;
  width?: number;
  height?: number;
}

// Renders an <img> with a spinner overlay while the browser is fetching it.
// Used when the preloader's cache miss forces a direct fetch — without this
// the user sees a blank pane and can't tell if the image is loading or broken.
function FallbackImage({ src, alt, imgStyle, width, height }: FallbackImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => {
    setStatus('loading');
  }, [src]);

  return (
    <div style={{ position: 'relative', lineHeight: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        style={{ ...imgStyle, opacity: status === 'loaded' ? 1 : 0 }}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
      />
      {status !== 'loaded' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(var(--gf-bg-dark-rgb), 0.6)',
            pointerEvents: 'none',
          }}
        >
          {status === 'loading' ? (
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                border: '2px solid rgba(212,168,103,0.25)',
                borderTopColor: 'rgba(212,168,103,0.85)',
                animation: 'cardPreviewSpin 0.7s linear infinite',
              }}
            />
          ) : (
            <span
              style={{
                fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
                fontSize: 10,
                color: 'rgba(var(--gf-text-bright-rgb), 0.55)',
                letterSpacing: '0.05em',
              }}
            >
              Image unavailable
            </span>
          )}
        </div>
      )}
    </div>
  );
}

interface HoverPreviewProps {
  card: HoveredCardInfo;
  getImage: (url: string) => HTMLImageElement | null;
}

function HoverPreview({ card, getImage }: HoverPreviewProps) {
  const imageUrl = getCardImageUrl(card.cardImgFile);
  const img = imageUrl ? getImage(imageUrl) : null;

  // Calculate position — prefer above-right of cursor, clamp to viewport
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  let left = card.x + 16;
  let top = card.y - PREVIEW_HEIGHT - 16;

  if (left + PREVIEW_WIDTH > vw - 8) {
    left = card.x - PREVIEW_WIDTH - 16;
  }
  if (top < 8) {
    top = card.y + 16;
  }
  if (top + PREVIEW_HEIGHT > vh - 8) {
    top = vh - PREVIEW_HEIGHT - 8;
  }
  // Touch paths can hand over a card with no client coords (Konva synthesizes
  // mouseenter from touches) — never feed NaN into a CSS position.
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;

  const hasStats = card.strength || card.toughness;

  return (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        width: PREVIEW_WIDTH,
        zIndex: 1000,
        pointerEvents: 'none',
        borderRadius: 6,
        background: 'rgba(var(--gf-bg-dark-rgb), 0.92)',
        border: '1px solid rgba(var(--gf-border-rgb), 0.4)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.8), 0 0 12px rgba(212,168,103,0.2)',
        overflow: 'hidden',
        animation: 'cardPreviewFadeIn 0.12s ease-out',
      }}
    >
      {/* Card image */}
      {img ? (
        <img
          src={img.src}
          alt={card.cardName}
          width={PREVIEW_WIDTH}
          height={PREVIEW_HEIGHT}
          style={{ display: 'block', width: '100%', height: 'auto' }}
        />
      ) : imageUrl ? (
        // Fallback: browser fetch if preloader doesn't have it yet
        <FallbackImage
          src={imageUrl}
          alt={card.cardName}
          width={PREVIEW_WIDTH}
          height={PREVIEW_HEIGHT}
          imgStyle={{ display: 'block', width: '100%', height: 'auto' }}
        />
      ) : (
        <div
          style={{
            width: PREVIEW_WIDTH,
            height: PREVIEW_HEIGHT,
            background: 'rgba(var(--gf-panel-rgb), 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <img
            src="/gameplay/cardback.webp"
            alt="Card back"
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
            style={{ display: 'block', width: '100%', height: 'auto', opacity: 0.6 }}
          />
        </div>
      )}

      {/* Card info bar */}
      <div
        style={{
          padding: '6px 8px',
          background: 'rgba(var(--gf-bg-dark-rgb), 0.95)',
          borderTop: '1px solid rgba(var(--gf-border-rgb), 0.3)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 11,
            color: 'var(--gf-text-bright)',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            marginBottom: 3,
          }}
        >
          {card.cardName}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            fontSize: 10,
            color: 'rgba(var(--gf-text-bright-rgb), 0.6)',
            fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
          }}
        >
          {card.cardType && <span>{card.cardType}</span>}
          {card.brigade && <span style={{ color: 'rgba(212,168,103,0.7)' }}>{card.brigade}</span>}
          {hasStats && (
            <span>
              {card.strength || '–'}/{card.toughness || '–'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zoom Modal
// ---------------------------------------------------------------------------

interface ZoomModalProps {
  card: ZoomedCardInfo;
  onClose: () => void;
  getImage: (url: string) => HTMLImageElement | null;
}

function ZoomModal({ card, onClose, getImage }: ZoomModalProps) {
  const imageUrl = getCardImageUrl(card.cardImgFile);
  const img = imageUrl ? getImage(imageUrl) : null;
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
        cursor: 'pointer',
        animation: 'cardPreviewFadeIn 0.15s ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          maxWidth: '90vw',
          maxHeight: '90vh',
          cursor: 'default',
          animation: 'cardZoomScaleIn 0.2s ease-out',
        }}
      >
        {/* Card image */}
        <div
          style={{
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: '0 12px 40px rgba(0,0,0,0.85), 0 0 20px rgba(212,168,103,0.2)',
            maxWidth: 'min(400px, 85vw)',
          }}
        >
          {img ? (
            <img
              src={img.src}
              alt={card.cardName}
              style={{
                display: 'block',
                maxHeight: '75vh',
                maxWidth: 'min(400px, 85vw)',
                width: 'auto',
                height: 'auto',
              }}
            />
          ) : imageUrl ? (
            <FallbackImage
              src={imageUrl}
              alt={card.cardName}
              imgStyle={{
                display: 'block',
                maxHeight: '75vh',
                maxWidth: 'min(400px, 85vw)',
                width: 'auto',
                height: 'auto',
              }}
            />
          ) : (
            <img
              src="/gameplay/cardback.webp"
              alt="Card back"
              style={{ display: 'block', width: 300, height: 420 }}
            />
          )}
        </div>

        {/* Card details */}
        <div
          style={{
            background: 'rgba(var(--gf-bg-dark-rgb), 0.95)',
            border: '1px solid rgba(var(--gf-border-rgb), 0.4)',
            borderRadius: 8,
            padding: '12px 16px',
            width: 'min(400px, 85vw)',
            position: 'relative',
          }}
        >
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'rgba(var(--gf-text-bright-rgb), 0.5)',
              padding: 2,
              lineHeight: 1,
            }}
          >
            <X size={14} />
          </button>

          <h3
            style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 14,
              color: 'var(--gf-text-bright)',
              marginBottom: 8,
              paddingRight: 20,
              letterSpacing: '0.04em',
            }}
          >
            {card.cardName}
          </h3>

          {card.specialAbility && (
            <p
              style={{
                fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
                fontSize: 11,
                color: 'rgba(var(--gf-text-bright-rgb), 0.7)',
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              {card.specialAbility}
            </p>
          )}
        </div>

        <span
          style={{
            fontSize: 10,
            color: 'rgba(var(--gf-text-bright-rgb), 0.35)',
            fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
            letterSpacing: '0.05em',
          }}
        >
          Click anywhere or press Esc to close
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Keyframe injection
// ---------------------------------------------------------------------------

const KEYFRAMES = `
@keyframes cardPreviewFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes cardZoomScaleIn {
  from { transform: scale(0.92); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}
@keyframes cardPreviewSpin {
  to { transform: rotate(360deg); }
}
`;

function KeyframeStyle() {
  return <style>{KEYFRAMES}</style>;
}

// ---------------------------------------------------------------------------
// CardPreviewSystem
// ---------------------------------------------------------------------------

export function CardPreviewSystem({
  hoveredCard,
  zoomedCard,
  onCloseZoom,
  getImage,
}: CardPreviewSystemProps) {
  return (
    <>
      <KeyframeStyle />
      {hoveredCard && !zoomedCard && (
        <HoverPreview card={hoveredCard} getImage={getImage} />
      )}
      {zoomedCard && (
        <ZoomModal card={zoomedCard} onClose={onCloseZoom} getImage={getImage} />
      )}
    </>
  );
}
