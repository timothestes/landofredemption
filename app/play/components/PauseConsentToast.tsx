'use client';

import { useToastKeyboardNav, toastFocusShadow } from '@/app/shared/components/toastKeyboardNav';
import { useInputMode } from '@/app/shared/hooks/useInputMode';

interface PauseConsentToastProps {
  /** Game row from SpacetimeDB. */
  game: any;
  /** Local player row. */
  myPlayer: any;
  /** Opponent player row (for the display name). */
  opponentPlayer: any;
  /** Called with `accepted` when responding to a pending pause request. */
  onRespondToPause: (accepted: boolean) => void;
  /** Called with `accepted` when responding to a pending resume request. */
  onRespondToResume: (accepted: boolean) => void;
}

/**
 * Floating banner that appears when the OPPONENT has requested a pause or
 * resume. Self-hides when no relevant request is pending. The requester's own
 * UI lives on the pause/play button in TurnIndicator (which flips to a cancel
 * affordance while their request is outstanding).
 */
export default function PauseConsentToast({
  game,
  myPlayer,
  opponentPlayer,
  onRespondToPause,
  onRespondToResume,
}: PauseConsentToastProps) {
  const mySeatStr: string = myPlayer?.seat?.toString() ?? '';
  const requestedBy: string = game?.pauseRequestedBy ?? '';
  const requestType: string = game?.pauseRequestType ?? '';

  // Only render when the OPPONENT has a pending request directed at me.
  if (!requestedBy || requestedBy === mySeatStr) return null;
  if (requestType !== 'pause' && requestType !== 'resume') return null;

  const oppName: string = opponentPlayer?.displayName ?? 'Opponent';
  const message =
    requestType === 'pause'
      ? `${oppName} wants to pause the game`
      : `${oppName} wants to resume the game`;
  const onAccept = () =>
    requestType === 'pause' ? onRespondToPause(true) : onRespondToResume(true);
  const onDecline = () =>
    requestType === 'pause' ? onRespondToPause(false) : onRespondToResume(false);

  return <PauseConsentBody message={message} onAccept={onAccept} onDecline={onDecline} />;
}

/**
 * Rendered only while a request is pending so the keyboard-nav hook (which
 * registers a global listener) is active only when the toast is visible.
 * Accept is the affirmative default (Enter); Escape declines.
 */
function PauseConsentBody({
  message,
  onAccept,
  onDecline,
}: {
  message: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  // Touch: 44px minimum target on the buttons (min-height only — the button's
  // own vertical centering grows the padding). Pointer rendering is untouched.
  const isTouch = useInputMode() === 'touch';
  const { focusedIndex, setFocusedIndex } = useToastKeyboardNav({
    count: 2,
    defaultIndex: 0, // Accept
    onSelect: idx => (idx === 0 ? onAccept() : onDecline()),
    onCancel: onDecline,
  });

  const acceptFocused = focusedIndex === 0;
  const declineFocused = focusedIndex === 1;

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 800,
        background: 'rgba(var(--gf-bg-dark-rgb), 0.95)',
        border: '1px solid rgba(var(--gf-accent-rgb), 0.4)',
        borderRadius: 8,
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      }}
    >
      <p
        style={{
          fontFamily: 'Georgia, serif',
          fontSize: 14,
          color: 'var(--gf-text-bright)',
          whiteSpace: 'nowrap',
          margin: 0,
        }}
      >
        {message}
      </p>
      <button
        onClick={onAccept}
        onMouseEnter={() => setFocusedIndex(0)}
        style={{
          padding: '8px 16px',
          minHeight: isTouch ? 44 : undefined,
          borderRadius: 4,
          border: '1px solid rgba(var(--gf-accent-rgb), 0.45)',
          background: acceptFocused ? 'rgba(var(--gf-accent-rgb), 0.30)' : 'rgba(var(--gf-accent-rgb), 0.15)',
          color: 'var(--gf-text-bright)',
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          boxShadow: acceptFocused ? toastFocusShadow('rgba(var(--gf-accent-rgb), 0.85)', 'rgba(var(--gf-accent-rgb), 0.4)') : 'none',
          transition: 'background 0.14s, box-shadow 0.14s, color 0.14s, border-color 0.14s',
        }}
      >
        Accept
      </button>
      <button
        onClick={onDecline}
        onMouseEnter={() => setFocusedIndex(1)}
        style={{
          padding: '8px 16px',
          minHeight: isTouch ? 44 : undefined,
          borderRadius: 4,
          border: `1px solid ${declineFocused ? 'rgba(var(--gf-accent-rgb), 0.4)' : 'rgba(var(--gf-border-rgb), 0.3)'}`,
          background: declineFocused ? 'rgba(var(--gf-accent-rgb), 0.12)' : 'transparent',
          color: declineFocused ? 'rgba(var(--gf-accent-rgb), 0.85)' : 'rgba(var(--gf-accent-rgb), 0.5)',
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          boxShadow: declineFocused ? toastFocusShadow('rgba(var(--gf-accent-rgb), 0.5)', 'rgba(var(--gf-accent-rgb), 0.22)') : 'none',
          transition: 'background 0.14s, box-shadow 0.14s, color 0.14s, border-color 0.14s',
        }}
      >
        Decline
      </button>
    </div>
  );
}
