'use client';

import type { ReactNode } from 'react';
import { useInputMode } from '@/app/shared/hooks/useInputMode';
import { useToastKeyboardNav, toastFocusShadow } from './toastKeyboardNav';

interface BoardRequestBannerProps {
  /** The request description (may include <strong> emphasis). */
  message: ReactNode;
  /** Affirmative button label — "Approve", "Grant", etc. */
  affirmLabel: string;
  onAffirm: () => void;
  onDeny: () => void;
  /** Outer width cap (Three Nails uses a wider message). */
  maxWidth?: number;
}

/**
 * Center-of-board consent banner shared by the Three Nails reset, action
 * priority, and initiative requests. The affirmative button is the default
 * (Enter); Escape denies. ←/→ move the selection and the focused option is
 * highlighted.
 */
export function BoardRequestBanner({
  message,
  affirmLabel,
  onAffirm,
  onDeny,
  maxWidth,
}: BoardRequestBannerProps) {
  const { focusedIndex, setFocusedIndex } = useToastKeyboardNav({
    count: 2,
    defaultIndex: 0, // affirm
    onSelect: idx => (idx === 0 ? onAffirm() : onDeny()),
    onCancel: onDeny,
  });
  // Touch: the desktop-sized banner parked dead-centre covered most of the
  // battle band it was asking about. Tighter chrome, and anchored in the
  // upper third so the board stays readable while deciding.
  const isTouch = useInputMode() === 'touch';

  const affirmFocused = focusedIndex === 0;
  const denyFocused = focusedIndex === 1;

  return (
    <div
      // Grant/Deny (phase stops, action priority, initiative) are answered
      // mid-battle with a thumb; the blocking-prompt rule raises the ~35px
      // buttons to 44px on touch. A mis-tapped Deny is logged to the opponent.
      data-blocking-prompt
      style={{
        position: 'absolute',
        top: isTouch ? '28%' : '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        // 800, not 300: on a phone the chat panel is a full-screen `inset: 0`
        // overlay at z-index 300 (globals.css), and it is rendered AFTER the
        // canvas column, so at an equal z-index it won. A player with chat
        // open saw only the log line ("… requested action priority") — the
        // Grant/Deny buttons were painted over and untappable, and for a
        // phase-stop hold that means their own turn stays frozen until the
        // 60s server backstop. 800 matches the other must-answer surfaces
        // (PauseConsentToast, SpectatorHandRequestBanner).
        zIndex: 800,
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          background: 'rgba(var(--gf-bg-dark-rgb), 0.95)',
          border: '1px solid rgba(var(--gf-accent-rgb), 0.35)',
          borderRadius: 10,
          padding: isTouch ? '10px 14px' : '16px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: isTouch ? 8 : 12,
          boxShadow: '0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(var(--gf-accent-rgb), 0.08)',
          ...(maxWidth ? { maxWidth } : null),
        }}
      >
        <div
          style={{
            fontSize: isTouch ? 13 : 15,
            color: 'var(--gf-text-bright)',
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            letterSpacing: '0.06em',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          {message}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onAffirm}
            onMouseEnter={() => setFocusedIndex(0)}
            style={{
              padding: isTouch ? '7px 14px' : '9px 20px',
              background: affirmFocused ? '#3a7332' : '#2d5a27',
              border: '1px solid #4a8a42',
              borderRadius: 6,
              color: '#c4e8bf',
              fontSize: 14,
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              letterSpacing: '0.06em',
              cursor: 'pointer',
              boxShadow: affirmFocused ? toastFocusShadow('#6fbf63', 'rgba(74,138,66,0.55)') : 'none',
              transition: 'background 0.14s, box-shadow 0.14s',
            }}
          >
            {affirmLabel}
          </button>
          <button
            onClick={onDeny}
            onMouseEnter={() => setFocusedIndex(1)}
            style={{
              padding: isTouch ? '7px 14px' : '9px 20px',
              background: denyFocused ? '#733232' : '#5a2727',
              border: '1px solid #8a4242',
              borderRadius: 6,
              color: '#e8bfbf',
              fontSize: 14,
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              letterSpacing: '0.06em',
              cursor: 'pointer',
              boxShadow: denyFocused ? toastFocusShadow('#c46a6a', 'rgba(138,66,66,0.55)') : 'none',
              transition: 'background 0.14s, box-shadow 0.14s',
            }}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
