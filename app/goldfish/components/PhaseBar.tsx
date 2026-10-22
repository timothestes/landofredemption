'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useGame } from '../state/GameContext';
import { PHASE_ORDER, GamePhase } from '../types';
import { motion } from 'framer-motion';
import { showGameToast } from './GameToast';

const PHASE_LABELS: Record<GamePhase, string> = {
  setup: 'Setup',
  draw: 'Draw',
  upkeep: 'Upkeep',
  preparation: 'Preparation',
  battle: 'Battle',
  discard: 'Discard',
};

const PHASE_TIPS: Record<GamePhase, string> = {
  setup: 'Game is being set up',
  draw: 'Draw 3 cards from your deck',
  upkeep: 'Resolve upkeep effects',
  preparation: 'Play characters, fortresses, artifacts to territory',
  battle: 'Initiate and resolve battles',
  discard: 'Discard down to hand limit if needed',
};

/** True while the bar has less room than its full-width layout needs. The bar
 *  laid its left (logo) and right (turn counter) clusters out absolutely over a
 *  centre-justified phase row, so below ~700px they painted on top of the phase
 *  labels — and the row itself (479px of phases + End Turn) simply ran off both
 *  edges of a 390px phone, taking End Turn with it. */
function useIsNarrowBar() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 700px)');
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return narrow;
}

export function PhaseBar({ hideBackButton = false }: { hideBackButton?: boolean } = {}) {
  const { state, advancePhase, regressPhase, endTurn } = useGame();
  const router = useRouter();
  const isNarrow = useIsNarrowBar();
  const stripRef = useRef<HTMLDivElement>(null);
  const activeChipRef = useRef<HTMLButtonElement>(null);
  const currentPhase = state.phase;
  const currentIdx = PHASE_ORDER.indexOf(currentPhase as GamePhase);
  const isFirstPhase = currentIdx <= 0;
  const isLastPhase = currentIdx >= PHASE_ORDER.length - 1;

  const handlePhaseClick = (phase: GamePhase) => {
    if (phase === currentPhase) return;

    const fromIdx = PHASE_ORDER.indexOf(currentPhase as any);
    const toIdx = PHASE_ORDER.indexOf(phase);

    if (toIdx > fromIdx) {
      for (let i = fromIdx; i < toIdx; i++) {
        advancePhase();
      }
    } else {
      for (let i = fromIdx; i > toIdx; i--) {
        regressPhase();
      }
    }
  };

  const HAND_LIMIT = 16;

  const handleEndTurn = () => {
    const handSize = state.zones.hand.length;
    const deckSize = state.zones.deck.length;
    const canDraw = Math.min(3, deckSize, HAND_LIMIT - handSize);
    endTurn();
    if (canDraw < 3 && handSize >= HAND_LIMIT - 2) {
      showGameToast(`Hand limit reached — only drew ${Math.max(0, canDraw)} card${canDraw === 1 ? '' : 's'}`);
    } else if (deckSize === 0) {
      showGameToast('Deck is empty — no cards drawn');
    } else if (deckSize < 3) {
      showGameToast(`Only ${deckSize} card${deckSize === 1 ? '' : 's'} left in deck`);
    }
  };

  // Keep the live phase visible when the strip scrolls. Without this the strip
  // holds whatever slice it was left on, so advancing off the visible window
  // looks like nothing happened.
  useEffect(() => {
    if (!isNarrow) return;
    activeChipRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [currentPhase, isNarrow]);

  const handleLogoClick = () => {
    if (!state.deckId) {
      router.push('/decklist/community');
      return;
    }
    if (state.isForge) {
      router.push(`/forge/play/decks/${state.deckId}`);
    } else if (state.isOwner) {
      router.push(`/decklist/card-search?deckId=${state.deckId}`);
    } else {
      router.push(`/decklist/${state.deckId}`);
    }
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 'calc(40px + env(safe-area-inset-top, 0px))',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        background: 'var(--gf-bg)',
        borderBottom: '1px solid var(--gf-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isNarrow ? 2 : 4,
        zIndex: 100,
        paddingLeft: `calc(${isNarrow ? 6 : 16}px + env(safe-area-inset-left, 0px))`,
        paddingRight: `calc(${isNarrow ? 6 : 16}px + env(safe-area-inset-right, 0px))`,
      }}
    >
      {/* Left side: back button + logo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
        }}
      >
        {!hideBackButton && (
          <button
            onClick={handleLogoClick}
            title="Back to deck"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 4,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'rgba(232, 213, 163, 0.35)',
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--gf-text-bright)';
              e.currentTarget.style.background = 'rgba(var(--gf-accent-rgb), 0.1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'rgba(232, 213, 163, 0.35)';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 21H19a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H15" />
              <polyline points="8 17 3 12 8 7" />
              <line x1="3" y1="12" x2="15" y2="12" />
            </svg>
          </button>
        )}

        {/* The wordmark is the widest thing in the bar and purely decorative —
            the arrow beside it already goes back to the deck. Dropping it on a
            phone is what buys the phase strip its room. */}
        {!isNarrow && (
          <button
            onClick={handleLogoClick}
            title="Back to deck"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Image
              src="/brand/lor-wordmark.webp"
              alt="Back to deck"
              width={96}
              height={28}
              className="opacity-85 hover:opacity-100 transition-opacity duration-200"
              style={{ width: 'auto', height: 28 }}
            />
          </button>
        )}
      </div>

      {/* Phase strip. Scrolls rather than overflowing: the phases are the part
          that must yield, because End Turn beside it has to stay on screen. */}
      <div
        ref={stripRef}
        className="gf-phase-strip"
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          overflowX: 'auto',
          overflowY: 'hidden',
          // Fade the cut edges so a clipped phase name reads as "scroll me"
          // rather than as a rendering fault. Invisible when everything fits.
          ...(isNarrow
            ? {
                maskImage:
                  'linear-gradient(to right, transparent 0, #000 10px, #000 calc(100% - 10px), transparent 100%)',
                WebkitMaskImage:
                  'linear-gradient(to right, transparent 0, #000 10px, #000 calc(100% - 10px), transparent 100%)',
              }
            : {}),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: isNarrow ? 2 : 4, margin: '0 auto', width: 'max-content' }}>
          {/* Previous phase arrow */}
          <button
            onClick={regressPhase}
            disabled={isFirstPhase}
            title="Previous phase"
            aria-label="Previous phase"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: isFirstPhase ? 'default' : 'pointer',
              color: isFirstPhase ? 'var(--gf-border-dim)' : 'var(--gf-text-dim)',
              fontSize: 18,
              fontFamily: 'serif',
              padding: isNarrow ? '8px 10px' : '2px 6px',
              transition: 'color 0.2s',
              lineHeight: 1,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { if (!isFirstPhase) e.currentTarget.style.color = 'var(--gf-text-bright)'; }}
            onMouseLeave={(e) => { if (!isFirstPhase) e.currentTarget.style.color = 'var(--gf-text-dim)'; }}
          >
            &#x276E;
          </button>

          {PHASE_ORDER.map((phase) => {
            const isActive = phase === currentPhase;
            return (
              <button
                key={phase}
                ref={isActive ? activeChipRef : undefined}
                onClick={() => handlePhaseClick(phase)}
                title={PHASE_TIPS[phase]}
                style={{
                  position: 'relative',
                  padding: isNarrow ? '8px 10px' : '6px 16px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 12,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  color: isActive ? 'var(--gf-text-bright)' : 'var(--gf-text-dim)',
                  transition: 'color 0.2s',
                }}
              >
                {PHASE_LABELS[phase]}
                {isActive && (
                  <motion.div
                    layoutId="phase-indicator"
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: '10%',
                      right: '10%',
                      height: 2,
                      background: 'var(--gf-accent)',
                      borderRadius: 1,
                      boxShadow: '0 0 8px rgba(var(--gf-accent-rgb),0.5)',
                    }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
              </button>
            );
          })}

          {/* Next phase arrow */}
          <button
            onClick={isLastPhase ? handleEndTurn : advancePhase}
            title={isLastPhase ? 'End turn' : 'Next phase'}
            aria-label={isLastPhase ? 'End turn' : 'Next phase'}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--gf-text-dim)',
              fontSize: 18,
              fontFamily: 'serif',
              padding: isNarrow ? '8px 10px' : '2px 6px',
              transition: 'color 0.2s',
              lineHeight: 1,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--gf-text-bright)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--gf-text-dim)'; }}
          >
            &#x276F;
          </button>
        </div>
      </div>

      {/* Right side: End Turn + turn counter. Never shrinks — ending your turn
          is the one control that must be reachable at every width. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isNarrow ? 6 : 12, flexShrink: 0 }}>
        <button
          onClick={handleEndTurn}
          style={{
            padding: isNarrow ? '8px 10px' : '6px 16px',
            background: 'transparent',
            border: '1px solid var(--gf-border)',
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 11,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            color: 'var(--gf-text)',
          }}
        >
          End Turn
        </button>

        <span
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 12,
            letterSpacing: '0.06em',
            whiteSpace: 'nowrap',
            color: 'var(--gf-text-dim)',
          }}
        >
          {isNarrow ? 'T' : 'Turn '}
          <span style={{ color: 'var(--gf-text-bright)', fontSize: 14, fontWeight: 'bold' }}>
            {state.turn}
          </span>
        </span>
      </div>

      {/* Arrow indicators between phases */}
      <style jsx>{`
        button:hover:not(:disabled) {
          color: var(--gf-text-bright) !important;
        }
        .gf-phase-strip {
          scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
        }
        .gf-phase-strip::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
