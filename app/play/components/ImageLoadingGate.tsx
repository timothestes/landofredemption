'use client';

import { useEffect, useRef, useState } from 'react';

// Wait this long before actually showing the overlay. Fast connections finish
// preloading inside this window, so the user never sees the gate flash.
const SHOW_DELAY_MS = 250;

// Once shown, stay visible for at least this long. Prevents a strobe where
// the gate appears at 250ms and vanishes at 280ms on a borderline-fast load.
const MIN_DISPLAY_MS = 600;

interface ImageLoadingGateProps {
  /** True when the gate should be active; false when loading is done or timed out. */
  open: boolean;
  /** Current progress, 0–1. */
  progress: number;
  /** Optional subtitle override (e.g. "Almost there…"). */
  message?: string;
}

/**
 * Full-screen overlay shown while card images finish preloading on slow
 * connections. Styled to match the cave/torchlight game aesthetic so it
 * reads as part of the game's loading flow, not a generic spinner.
 *
 * Self-manages its own visibility with a show-delay + minimum-display-time
 * pattern, so fast loaders never see it flicker.
 */
export function ImageLoadingGate({ open, progress, message }: ImageLoadingGateProps) {
  const [isVisible, setIsVisible] = useState(false);
  const shownAtRef = useRef<number | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      // Cancel any pending hide — we want to keep showing.
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      if (isVisible || showTimerRef.current) return;
      showTimerRef.current = setTimeout(() => {
        showTimerRef.current = null;
        shownAtRef.current = Date.now();
        setIsVisible(true);
      }, SHOW_DELAY_MS);
    } else {
      // Fast-loader path: cancel the pending show before it ever fires.
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      if (!isVisible) return;
      const elapsed = Date.now() - (shownAtRef.current ?? Date.now());
      if (elapsed >= MIN_DISPLAY_MS) {
        shownAtRef.current = null;
        setIsVisible(false);
      } else {
        hideTimerRef.current = setTimeout(() => {
          hideTimerRef.current = null;
          shownAtRef.current = null;
          setIsVisible(false);
        }, MIN_DISPLAY_MS - elapsed);
      }
    }
  }, [open, isVisible]);

  // Cleanup pending timers on unmount.
  useEffect(() => {
    return () => {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  // Smooth progress updates so the bar doesn't feel jerky on fast transitions.
  const [displayedProgress, setDisplayedProgress] = useState(progress);
  useEffect(() => {
    const target = Math.max(displayedProgress, progress);
    if (target === displayedProgress) return;
    const id = requestAnimationFrame(() => setDisplayedProgress(target));
    return () => cancelAnimationFrame(id);
  }, [progress, displayedProgress]);

  if (!isVisible) return null;

  const pct = Math.round(displayedProgress * 100);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(var(--gf-deep-rgb), 0.68)',
        backdropFilter: 'blur(8px) saturate(0.85)',
        WebkitBackdropFilter: 'blur(8px) saturate(0.85)',
        pointerEvents: 'all',
      }}
      aria-live="polite"
      aria-busy="true"
    >
      <div
        style={{
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          fontSize: 18,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: '#e8d5a3',
          marginBottom: 18,
          textShadow: '0 0 12px rgba(var(--gf-accent-rgb), 0.4)',
        }}
      >
        Loading Cards
      </div>

      <div
        style={{
          width: 'min(360px, 70vw)',
          height: 6,
          background: 'rgba(40, 30, 20, 0.85)',
          borderRadius: 999,
          overflow: 'hidden',
          border: '1px solid rgba(var(--gf-border-rgb), 0.5)',
          boxShadow: '0 0 18px rgba(0, 0, 0, 0.6) inset',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: 'linear-gradient(90deg, rgba(196, 149, 90, 0.7) 0%, #e8b86a 60%, #f4d89e 100%)',
            boxShadow: '0 0 10px rgba(232, 184, 106, 0.6)',
            transition: 'width 180ms ease-out',
          }}
        />
      </div>

      <div
        style={{
          marginTop: 14,
          fontSize: 12,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'rgba(var(--gf-text-bright-rgb), 0.6)',
          fontFamily: 'var(--font-cinzel), Georgia, serif',
        }}
      >
        {message ?? `${pct}%`}
      </div>
    </div>
  );
}
