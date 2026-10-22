'use client';

import { useEffect, useRef, useState } from 'react';
import { useInputMode } from '../hooks/useInputMode';
import type { ParagonEntry } from '../types/paragonEntry';

interface ParagonDrawerProps {
  /** Paragon entries to display. Empty array = drawer hidden entirely. */
  paragons: ParagonEntry[];
}

const DRAWER_WIDTH = 620;
const HANDLE_WIDTH = 180;
const HANDLE_HEIGHT = 36;

export function ParagonDrawer({ paragons }: ParagonDrawerProps) {
  // The 396/400px right offsets below exist to clear the desktop chat column.
  // On touch that column is a full-screen overlay instead, so the offset just
  // shoved the handle AND the drawer entirely off the left edge of a phone
  // (on a 393px viewport the handle sat at x -187..-7) — a Paragon player had
  // no way to open, or even see, their own Paragon.
  const isTouch = useInputMode() === 'touch';
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (paragons.length === 0) {
      setActiveId(null);
      return;
    }
    const self = paragons.find((p) => p.isSelf);
    setActiveId((curr) => {
      if (curr && paragons.some((p) => p.playerId === curr)) return curr;
      return (self ?? paragons[0]).playerId;
    });
  }, [paragons]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
      if (!open) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setOpen(true);
        }
        return;
      }
      if (e.key === 'Escape' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (paragons.length < 2) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveId((curr) => {
          const idx = paragons.findIndex((p) => p.playerId === curr);
          const base = idx === -1 ? 0 : idx;
          const step = e.key === 'ArrowRight' ? 1 : -1;
          const next = (base + step + paragons.length) % paragons.length;
          return paragons[next].playerId;
        });
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, paragons]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const node = drawerRef.current;
      if (node && !node.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  const cycleParagon = (step: 1 | -1) => {
    setActiveId((curr) => {
      const idx = paragons.findIndex((p) => p.playerId === curr);
      const base = idx === -1 ? 0 : idx;
      const next = (base + step + paragons.length) % paragons.length;
      return paragons[next].playerId;
    });
  };

  if (paragons.length === 0) return null;

  const selfEntry = paragons.find((p) => p.isSelf) ?? paragons[0];
  const activeEntry = paragons.find((p) => p.playerId === activeId) ?? selfEntry;
  const showTabs = paragons.length >= 2;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open paragon"
        aria-hidden={open}
        tabIndex={open ? -1 : 0}
        style={{
          position: 'fixed',
          // 52 clears the 45px chat rail that the touch layout docks on the
          // right edge; the desktop 400 clears the full chat column.
          right: isTouch ? 52 : 400,
          bottom: 16,
          zIndex: 899,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: HANDLE_WIDTH,
          height: HANDLE_HEIGHT,
          padding: '0 12px 0 4px',
          background: 'rgba(var(--gf-bg-dark-rgb), 0.96)',
          border: '1px solid rgba(var(--gf-accent-rgb), 0.5)',
          borderRadius: 6,
          color: 'var(--gf-text-bright)',
          fontFamily: 'Cinzel, Georgia, serif',
          fontSize: 11,
          letterSpacing: 1.5,
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(0, 0, 0, 0.45)',
          opacity: open ? 0 : 1,
          transform: open ? 'translateY(12px)' : 'translateY(0)',
          transition: 'opacity 200ms ease-out, transform 200ms ease-out',
          pointerEvents: open ? 'none' : 'auto',
        }}
      >
        <img
          src={selfEntry.imageUrl}
          alt=""
          style={{
            width: 38,
            height: 27,
            objectFit: 'cover',
            borderRadius: 2,
            border: '1px solid rgba(var(--gf-accent-rgb), 0.3)',
            flexShrink: 0,
          }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
        <span style={{ flex: 1, textAlign: 'left' }}>PARAGON</span>
        <span aria-hidden style={{ fontSize: 14, opacity: 0.85, lineHeight: 1 }}>
          ▴
        </span>
      </button>

      <div
        ref={drawerRef}
        role="dialog"
        aria-label={`Paragon: ${activeEntry.paragonName}`}
        aria-hidden={!open}
        style={{
          position: 'fixed',
          bottom: 0,
          zIndex: 900,
          // Touch spans the viewport between the left edge and the chat rail
          // rather than taking a fixed width off a desktop-sized right offset.
          // `width: auto` is required for `right` to apply alongside `left`.
          ...(isTouch
            ? { left: 8, right: 53, width: 'auto', maxWidth: 'none',
                // A landscape phone is 393px tall and the open drawer is taller
                // than that, so without a cap its header (and the close button)
                // render above the top of the viewport.
                maxHeight: 'calc(100vh - 8px)', overflowY: 'auto' as const }
            : { right: 396, width: DRAWER_WIDTH, maxWidth: 'calc(100vw - 32px)' }),
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 360ms cubic-bezier(0.32, 0.72, 0, 1)',
          willChange: 'transform',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        <div
          style={{
            background: 'rgba(var(--gf-bg-dark-rgb), 0.98)',
            border: '1px solid rgba(var(--gf-accent-rgb), 0.5)',
            borderBottom: 'none',
            borderTopLeftRadius: 10,
            borderTopRightRadius: 10,
            boxShadow: '0 -10px 40px rgba(0, 0, 0, 0.55)',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: 8,
              borderBottom: '1px solid rgba(var(--gf-accent-rgb), 0.15)',
            }}
          >
            <span
              style={{
                fontFamily: 'Cinzel, Georgia, serif',
                fontSize: 12,
                letterSpacing: 1.5,
                color: 'var(--gf-text-bright)',
              }}
            >
              PARAGON
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close paragon drawer"
              title="Close (↓ or Esc)"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                height: 28,
                padding: '0 6px',
                background: 'transparent',
                border: 'none',
                color: 'rgba(var(--gf-accent-rgb), 0.75)',
                cursor: 'pointer',
                fontFamily: 'Georgia, serif',
                lineHeight: 1,
              }}
            >
              <span
                aria-hidden
                style={{
                  fontSize: 12,
                  opacity: 0.6,
                  fontFamily: 'Cinzel, Georgia, serif',
                  letterSpacing: 0.5,
                }}
              >
                ▾
              </span>
              <span aria-hidden style={{ fontSize: 20 }}>×</span>
            </button>
          </div>

          {showTabs && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                justifyContent: 'center',
                borderBottom: '1px solid rgba(var(--gf-accent-rgb), 0.2)',
                paddingBottom: 8,
              }}
            >
              <button
                type="button"
                onClick={() => cycleParagon(-1)}
                aria-label="Previous paragon"
                title="Previous (←)"
                style={{
                  width: 26,
                  height: 26,
                  padding: 0,
                  background: 'transparent',
                  border: '1px solid rgba(var(--gf-accent-rgb), 0.35)',
                  borderRadius: 3,
                  color: 'rgba(var(--gf-accent-rgb), 0.8)',
                  fontSize: 14,
                  lineHeight: 1,
                  cursor: 'pointer',
                  fontFamily: 'Cinzel, Georgia, serif',
                }}
              >
                ◂
              </button>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                  justifyContent: 'center',
                }}
              >
                {paragons.map((p) => {
                  const active = p.playerId === activeEntry.playerId;
                  return (
                    <button
                      key={p.playerId}
                      type="button"
                      onClick={() => setActiveId(p.playerId)}
                      style={{
                        padding: '5px 12px',
                        background: active ? 'rgba(var(--gf-accent-rgb), 0.25)' : 'transparent',
                        border: '1px solid rgba(var(--gf-accent-rgb), 0.4)',
                        borderRadius: 3,
                        color: active ? '#f3e2b4' : 'rgba(var(--gf-accent-rgb), 0.7)',
                        fontFamily: 'Cinzel, Georgia, serif',
                        fontSize: 11,
                        letterSpacing: 1,
                        cursor: 'pointer',
                      }}
                    >
                      {p.displayName.toUpperCase()}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => cycleParagon(1)}
                aria-label="Next paragon"
                title="Next (→)"
                style={{
                  width: 26,
                  height: 26,
                  padding: 0,
                  background: 'transparent',
                  border: '1px solid rgba(var(--gf-accent-rgb), 0.35)',
                  borderRadius: 3,
                  color: 'rgba(var(--gf-accent-rgb), 0.8)',
                  fontSize: 14,
                  lineHeight: 1,
                  cursor: 'pointer',
                  fontFamily: 'Cinzel, Georgia, serif',
                }}
              >
                ▸
              </button>
            </div>
          )}

          <img
            src={activeEntry.imageUrl}
            alt={`Paragon ${activeEntry.paragonName}`}
            style={{
              width: '100%',
              height: 'auto',
              aspectRatio: '1.4 / 1',
              objectFit: 'contain',
              borderRadius: 4,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
            }}
          />
        </div>
      </div>
    </>
  );
}
