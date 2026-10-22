'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTable, useSpacetimeDB } from 'spacetimedb/react';
import { tables } from '@/lib/spacetimedb/module_bindings';
import { useToastKeyboardNav, toastFocusShadow } from '@/app/shared/components/toastKeyboardNav';
import { useInputMode } from '@/app/shared/hooks/useInputMode';

interface SpectatorHandRequestBannerProps {
  gameId: bigint | null;
  /** Local player's row — needed to call setShareHandWithSpectators and to auto-dismiss when share flips on. */
  myPlayer: { id: bigint; gameId: bigint; shareHandWithSpectators: boolean } | null;
}

/**
 * Row-driven banner stack: one banner per active SpectatorHandRequest for
 * this game. Each banner has Share / Dismiss buttons. Dismiss is local-only
 * (no server signal — the server only tracks the request itself).
 * Auto-dismisses when the underlying row is deleted by the 30s expiry
 * reducer OR when myPlayer.shareHandWithSpectators flips from false to true.
 *
 * Styled to match PauseConsentToast — see that component for the canonical
 * consent-banner pattern in this app.
 */
export default function SpectatorHandRequestBanner({
  gameId,
  myPlayer,
}: SpectatorHandRequestBannerProps) {
  const spacetimeCtx = useSpacetimeDB() as any;
  const conn = spacetimeCtx?.getConnection?.() ?? null;
  const [allRequests] = useTable(
    tables.SpectatorHandRequest.where(r => r.gameId.eq(gameId ?? 0n)),
  );
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const prevSharingRef = useRef(false);

  // Auto-dismiss only when shareHandWithSpectators flips false → true.
  useEffect(() => {
    const sharing = !!myPlayer?.shareHandWithSpectators;
    const flipped = !prevSharingRef.current && sharing;
    prevSharingRef.current = sharing;
    if (!flipped) return;
    setDismissed(prev => {
      const next = new Set(prev);
      for (const r of allRequests) next.add(r.id.toString());
      return next;
    });
  }, [myPlayer?.shareHandWithSpectators, allRequests]);

  const visible = useMemo(
    () => allRequests.filter(r => !dismissed.has(r.id.toString())),
    [allRequests, dismissed],
  );

  if (!myPlayer || visible.length === 0) return null;

  const onShare = () => {
    conn?.reducers.setShareHandWithSpectators({ gameId: myPlayer.gameId, share: true });
  };

  const onDismiss = (id: bigint) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id.toString());
      return next;
    });
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 800,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        pointerEvents: 'none',
      }}
    >
      {visible.map((req, i) => (
        <SpectatorRequestBanner
          key={req.id.toString()}
          spectatorName={req.spectatorName}
          isTop={i === visible.length - 1}
          onShare={onShare}
          onDismiss={() => onDismiss(req.id)}
        />
      ))}
    </div>
  );
}

/**
 * A single spectator-request banner. Only the topmost banner responds to the
 * keyboard — Share hand is the affirmative default (Enter); Escape dismisses.
 */
function SpectatorRequestBanner({
  spectatorName,
  isTop,
  onShare,
  onDismiss,
}: {
  spectatorName: string;
  isTop: boolean;
  onShare: () => void;
  onDismiss: () => void;
}) {
  // Touch: 44px minimum target on the buttons (min-height only — the button's
  // own vertical centering grows the padding). Pointer rendering is untouched.
  const isTouch = useInputMode() === 'touch';
  const { focusedIndex, setFocusedIndex } = useToastKeyboardNav({
    count: 2,
    defaultIndex: 1, // Share hand
    enabled: isTop,
    onSelect: idx => (idx === 0 ? onDismiss() : onShare()),
    onCancel: onDismiss,
  });

  const dismissFocused = focusedIndex === 0;
  const shareFocused = focusedIndex === 1;

  return (
    <div
      style={{
        background: 'rgba(var(--gf-bg-dark-rgb), 0.95)',
        border: '1px solid rgba(var(--gf-accent-rgb), 0.4)',
        borderRadius: 8,
        padding: '14px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        pointerEvents: 'auto',
        minWidth: 360,
      }}
    >
      {/* Header — explicit "spectator request" label */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingBottom: 8,
          borderBottom: '1px solid rgba(var(--gf-border-rgb), 0.3)',
        }}
      >
        {/* Eye icon makes it visually clear this is from a spectator */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          style={{ stroke: 'rgba(var(--gf-accent-rgb), 0.85)' }}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'rgba(var(--gf-accent-rgb), 0.85)',
          }}
        >
          Spectator request
        </span>
      </div>

      {/* Body — who and what */}
      <p
        style={{
          fontFamily: 'Georgia, serif',
          fontSize: 14,
          color: 'var(--gf-text-bright)',
          margin: 0,
          lineHeight: 1.4,
        }}
      >
        <span style={{ fontWeight: 700 }}>{spectatorName}</span>
        {' would like to see your hand.'}
      </p>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={onDismiss}
          onMouseEnter={() => setFocusedIndex(0)}
          style={{
            padding: '8px 16px',
            minHeight: isTouch ? 44 : undefined,
            borderRadius: 4,
            border: `1px solid ${dismissFocused ? 'rgba(var(--gf-accent-rgb), 0.4)' : 'rgba(var(--gf-border-rgb), 0.3)'}`,
            background: dismissFocused ? 'rgba(var(--gf-accent-rgb), 0.12)' : 'transparent',
            color: dismissFocused ? 'rgba(var(--gf-accent-rgb), 0.95)' : 'rgba(var(--gf-accent-rgb), 0.7)',
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            boxShadow: dismissFocused ? toastFocusShadow('rgba(var(--gf-accent-rgb), 0.5)', 'rgba(var(--gf-accent-rgb), 0.22)') : 'none',
            transition: 'background 0.14s, box-shadow 0.14s, color 0.14s, border-color 0.14s',
          }}
        >
          Dismiss
        </button>
        <button
          onClick={onShare}
          onMouseEnter={() => setFocusedIndex(1)}
          style={{
            padding: '8px 16px',
            minHeight: isTouch ? 44 : undefined,
            borderRadius: 4,
            border: '1px solid rgba(var(--gf-accent-rgb), 0.45)',
            background: shareFocused ? 'rgba(var(--gf-accent-rgb), 0.30)' : 'rgba(var(--gf-accent-rgb), 0.15)',
            color: 'var(--gf-text-bright)',
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            boxShadow: shareFocused ? toastFocusShadow('rgba(var(--gf-accent-rgb), 0.85)', 'rgba(var(--gf-accent-rgb), 0.4)') : 'none',
            transition: 'background 0.14s, box-shadow 0.14s, color 0.14s, border-color 0.14s',
          }}
        >
          Share hand
        </button>
      </div>
    </div>
  );
}
