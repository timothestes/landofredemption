'use client';

import { useState, useRef, useEffect } from 'react';
import { Settings, RotateCcw, RefreshCw, Clock, EyeOff, Link, Unlink } from 'lucide-react';
import { useInputMode } from '@/app/shared/hooks/useInputMode';

interface CardScaleControlProps {
  cardScale: number;
  setCardScale: (scale: number) => void;
  resetScale: () => void;
  minScale: number;
  maxScale: number;
  step: number;
  /** Chat/log font scale — if provided, a second slider renders. */
  chatScale?: number;
  setChatScale?: (scale: number) => void;
  resetChatScale?: () => void;
  minChatScale?: number;
  maxChatScale?: number;
  chatStep?: number;
  /** Called to trigger mid-game deck reload (multiplayer only). */
  onLoadDeck?: () => void;
  /** Whether the game timer is currently visible. */
  isTimerVisible?: boolean;
  /** Toggle timer visibility. */
  onToggleTimer?: () => void;
  /** Whether the Lost Soul cinematic plays when souls are dealt (gear-menu toggle). */
  isSoulCinematicEnabled?: boolean;
  /** Toggle the Lost Soul cinematic setting. */
  onToggleSoulCinematic?: () => void;
}

export function CardScaleControl({
  cardScale,
  setCardScale,
  resetScale,
  minScale,
  maxScale,
  step,
  chatScale,
  setChatScale,
  resetChatScale,
  minChatScale,
  maxChatScale,
  chatStep,
  onLoadDeck,
  isTimerVisible,
  onToggleTimer,
  isSoulCinematicEnabled,
  onToggleSoulCinematic,
}: CardScaleControlProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };
  }, [open]);

  const isTouch = useInputMode() === 'touch';

  const pct = Math.round(cardScale * 100);
  const chatPct = chatScale !== undefined ? Math.round(chatScale * 100) : null;
  const hasChatControl =
    chatScale !== undefined &&
    setChatScale !== undefined &&
    resetChatScale !== undefined &&
    minChatScale !== undefined &&
    maxChatScale !== undefined &&
    chatStep !== undefined;

  return (
    <div data-card-scale-control
      ref={popoverRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute',
        // The collapsed toolbar button sits beside this one; both anchor to the
        // safe area so they stay on the same line on a notched phone.
        bottom: isTouch ? 'calc(8px + env(safe-area-inset-bottom))' : 8,
        left: isTouch ? 'calc(8px + env(safe-area-inset-left))' : 12,
        zIndex: 200,
      }}
    >
      {/* Gear button */}
      <button
        onClick={() => setOpen(prev => !prev)}
        title="Card size settings (+/- keys)"
        aria-label="Card size settings"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: isTouch ? 44 : 36,
          height: isTouch ? 44 : 36,
          background: 'rgba(30,22,16,0.92)',
          border: '1px solid var(--gf-border, #3d2e1f)',
          borderRadius: 8,
          cursor: 'pointer',
          color: 'var(--gf-text, #e8d5a3)',
          transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
          e.currentTarget.style.color = 'var(--gf-text-bright, #fff)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(30,22,16,0.92)';
          e.currentTarget.style.color = 'var(--gf-text, #e8d5a3)';
        }}
      >
        <Settings size={18} />
      </button>

      {/* Popover */}
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 44,
            left: 0,
            background: 'rgba(30,22,16,0.96)',
            border: '1px solid var(--gf-border, #3d2e1f)',
            borderRadius: 8,
            padding: '12px 16px',
            minWidth: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {/* Label + percentage */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 11,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--gf-text, #e8d5a3)',
              }}
            >
              Card Size
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--gf-text-bright, #fff)',
                fontVariantNumeric: 'tabular-nums',
                minWidth: 36,
                textAlign: 'right',
              }}
            >
              {pct}%
            </span>
          </div>

          {/* Slider */}
          <input
            type="range"
            min={minScale * 100}
            max={maxScale * 100}
            step={step * 100}
            value={pct}
            onChange={(e) => {
              const newScale = Math.round(parseFloat(e.target.value)) / 100;
              setCardScale(newScale);
            }}
            style={{
              width: '100%',
              accentColor: '#c4955a',
              cursor: 'pointer',
            }}
          />

          {/* Min/max labels + reset */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 10, color: 'var(--gf-text-dim, #8a7a66)' }}>
              {Math.round(minScale * 100)}%
            </span>
            <button
              onClick={resetScale}
              title="Reset to 100%"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                background: 'transparent',
                border: '1px solid var(--gf-border, #3d2e1f)',
                borderRadius: 4,
                cursor: 'pointer',
                color: 'var(--gf-text, #e8d5a3)',
                fontSize: 10,
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <RotateCcw size={10} />
              Reset
            </button>
            <span style={{ fontSize: 10, color: 'var(--gf-text-dim, #8a7a66)' }}>
              {Math.round(maxScale * 100)}%
            </span>
          </div>

          {/* Chat/log font size — multiplayer only */}
          {hasChatControl && (
            <>
              <div style={{
                height: 1,
                background: 'var(--gf-border, #3d2e1f)',
                margin: '4px 0',
              }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                    fontSize: 11,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--gf-text, #e8d5a3)',
                  }}
                >
                  Chat/Log Size
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--gf-text-bright, #fff)',
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: 36,
                    textAlign: 'right',
                  }}
                >
                  {chatPct}%
                </span>
              </div>
              <input
                type="range"
                min={minChatScale! * 100}
                max={maxChatScale! * 100}
                step={chatStep! * 100}
                value={chatPct!}
                onChange={(e) => {
                  const newScale = Math.round(parseFloat(e.target.value)) / 100;
                  setChatScale!(newScale);
                }}
                style={{
                  width: '100%',
                  accentColor: '#c4955a',
                  cursor: 'pointer',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: 'var(--gf-text-dim, #8a7a66)' }}>
                  {Math.round(minChatScale! * 100)}%
                </span>
                <button
                  onClick={resetChatScale}
                  title="Reset to 100%"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    background: 'transparent',
                    border: '1px solid var(--gf-border, #3d2e1f)',
                    borderRadius: 4,
                    cursor: 'pointer',
                    color: 'var(--gf-text, #e8d5a3)',
                    fontSize: 10,
                    fontFamily: 'var(--font-cinzel), Georgia, serif',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <RotateCcw size={10} />
                  Reset
                </button>
                <span style={{ fontSize: 10, color: 'var(--gf-text-dim, #8a7a66)' }}>
                  {Math.round(maxChatScale! * 100)}%
                </span>
              </div>
            </>
          )}

          {/* Load Deck — multiplayer only */}
          {onLoadDeck && (
            <>
              <div style={{
                height: 1,
                background: 'var(--gf-border, #3d2e1f)',
                margin: '4px 0',
              }} />
              <button
                onClick={() => {
                  onLoadDeck();
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 4px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: 'var(--gf-text, #e8d5a3)',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <RefreshCw size={14} />
                Load Deck
              </button>
            </>
          )}

          {/* Timer visibility toggle */}
          {onToggleTimer && (
            <>
              <div style={{
                height: 1,
                background: 'var(--gf-border, #3d2e1f)',
                margin: '4px 0',
              }} />
              <button
                onClick={() => {
                  onToggleTimer();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 4px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: 'var(--gf-text, #e8d5a3)',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {isTimerVisible ? <EyeOff size={14} /> : <Clock size={14} />}
                {isTimerVisible ? 'Hide Timer' : 'Show Timer'}
              </button>
            </>
          )}

          {/* Lost Soul cinematic toggle */}
          {onToggleSoulCinematic && (
            <>
              <div style={{
                height: 1,
                background: 'var(--gf-border, #3d2e1f)',
                margin: '4px 0',
              }} />
              <button
                onClick={onToggleSoulCinematic}
                aria-pressed={!!isSoulCinematicEnabled}
                title="Full-screen chain cinematic when a Lost Soul is dealt"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 4px',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: 'var(--gf-text, #e8d5a3)',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--gf-hover, #2a1f12)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {isSoulCinematicEnabled ? <Link size={14} /> : <Unlink size={14} />}
                {isSoulCinematicEnabled ? 'Soul Cinematic On' : 'Soul Cinematic Off'}
              </button>
            </>
          )}

        </div>
      )}
    </div>
  );
}
