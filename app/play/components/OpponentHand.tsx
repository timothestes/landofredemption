'use client';

// ---------------------------------------------------------------------------
// OpponentHand — DOM overlay showing opponent's face-down hand cards
// Positioned at the top of the screen, above the canvas.
// ---------------------------------------------------------------------------

interface OpponentHandProps {
  cardCount: number;
  displayName: string;
}

// Aspect ratio for a standard card back thumbnail (2.5 × 3.5 inches → ~0.714)
const CARD_WIDTH = 40;
const CARD_HEIGHT = Math.round(CARD_WIDTH / 0.714); // ≈ 56px

export default function OpponentHand({ cardCount, displayName }: OpponentHandProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        minHeight: 64,
        background: 'rgba(var(--gf-deep-rgb), 0.94)',
        borderBottom: '1px solid rgba(var(--gf-border-rgb), 0.4)',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 'calc(12px + env(safe-area-inset-left, 0px))',
        paddingRight: 'calc(12px + env(safe-area-inset-right, 0px))',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        zIndex: 200,
        gap: 12,
      }}
    >
      {/* ----------------------------------------------------------------
          LEFT — Opponent name + card count badge
          ---------------------------------------------------------------- */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          flexShrink: 0,
          minWidth: 80,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 9,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'rgba(var(--gf-text-bright-rgb), 0.5)',
            lineHeight: 1,
          }}
        >
          Opponent
        </span>
        <span
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 11,
            letterSpacing: '0.04em',
            color: '#e8d5a3',
            lineHeight: 1,
            marginTop: 3,
            maxWidth: 100,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayName}
        </span>

        {/* Card count badge */}
        <div
          style={{
            marginTop: 4,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 9,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'rgba(var(--gf-accent-rgb), 0.7)',
              lineHeight: 1,
            }}
          >
            Hand:
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 18,
              height: 18,
              background: 'rgba(var(--gf-accent-rgb), 0.15)',
              border: '1px solid rgba(var(--gf-accent-rgb), 0.4)',
              borderRadius: 9,
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 10,
              fontWeight: 700,
              color: '#c4955a',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            {cardCount}
          </span>
        </div>
      </div>

      {/* ----------------------------------------------------------------
          RIGHT — Card back thumbnails or empty state
          ---------------------------------------------------------------- */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          overflowX: 'auto',
          overflowY: 'hidden',
          // Hide scrollbar visually but keep scroll functional
          scrollbarWidth: 'none',
        }}
      >
        {cardCount === 0 ? (
          <span
            style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 10,
              letterSpacing: '0.06em',
              color: 'rgba(var(--gf-text-bright-rgb), 0.3)',
              fontStyle: 'italic',
            }}
          >
            No cards in hand
          </span>
        ) : (
          Array.from({ length: cardCount }).map((_, i) => (
            <CardBack key={i} width={CARD_WIDTH} height={CARD_HEIGHT} />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CardBack — a single face-down card thumbnail rendered via SVG pattern
// ---------------------------------------------------------------------------

function CardBack({ width, height }: { width: number; height: number }) {
  return (
    <div
      title="Card (face down)"
      style={{
        width,
        height,
        flexShrink: 0,
        borderRadius: 3,
        background: 'linear-gradient(145deg, #1a1208 0%, #0d0a04 100%)',
        border: '1px solid rgba(var(--gf-border-rgb), 0.55)',
        boxShadow: '0 2px 6px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(var(--gf-accent-rgb), 0.08)',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Subtle cross-hatch inner pattern */}
      <svg
        width={width - 6}
        height={height - 6}
        viewBox="0 0 34 50"
        xmlns="http://www.w3.org/2000/svg"
        style={{ opacity: 0.35 }}
      >
        {/* Border frame */}
        <rect x="1" y="1" width="32" height="48" rx="2" fill="none" stroke="rgba(196,149,90,0.6)" strokeWidth="1" />
        {/* Inner diamond */}
        <polygon
          points="17,4 32,25 17,46 2,25"
          fill="none"
          stroke="rgba(196,149,90,0.4)"
          strokeWidth="0.75"
        />
        {/* Center dot */}
        <circle cx="17" cy="25" r="2" fill="rgba(196,149,90,0.5)" />
      </svg>
    </div>
  );
}
