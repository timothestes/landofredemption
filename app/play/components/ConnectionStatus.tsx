'use client';

// ---------------------------------------------------------------------------
// ConnectionStatus — small unobtrusive indicator showing opponent connection
// state. Positioned top-right, above the canvas.
// ---------------------------------------------------------------------------

interface ConnectionStatusProps {
  isConnected: boolean;
  displayName: string;
}

export default function ConnectionStatus({ isConnected, displayName }: ConnectionStatusProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
        right: 'calc(env(safe-area-inset-right, 0px) + 12px)',
        zIndex: 210, // above OpponentHand bar (200)
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 2,
        pointerEvents: 'none', // non-interactive overlay
      }}
    >
      {/* Status row: dot + label */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          background: 'rgba(var(--gf-deep-rgb), 0.82)',
          border: '1px solid rgba(var(--gf-border-rgb), 0.3)',
          borderRadius: 10,
          padding: '3px 8px',
        }}
      >
        {/* Status dot */}
        <span
          style={{
            display: 'block',
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: isConnected ? '#22c55e' : '#ef4444',
            boxShadow: isConnected
              ? '0 0 6px rgba(34,197,94,0.7)'
              : '0 0 6px rgba(239,68,68,0.7)',
            flexShrink: 0,
          }}
        />

        {/* Status text */}
        <span
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 9,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: isConnected ? 'rgba(134, 239, 172, 0.9)' : 'rgba(252, 165, 165, 0.9)',
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      {/* Opponent name — shown always */}
      <span
        style={{
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 9,
          letterSpacing: '0.05em',
          color: 'rgba(var(--gf-text-bright-rgb), 0.45)',
          lineHeight: 1,
          paddingRight: 2,
          maxWidth: 120,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'right',
        }}
      >
        {displayName}
      </span>

      {/* Reconnecting sub-label — only when disconnected */}
      {!isConnected && (
        <span
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 8,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: 'rgba(252, 165, 165, 0.55)',
            lineHeight: 1,
            paddingRight: 2,
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        >
          Reconnecting...
        </span>
      )}
    </div>
  );
}
