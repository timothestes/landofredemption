'use client';

import { useGame } from '../state/GameContext';
import { isLostSoulCard, lostSoulValue } from '@/lib/cards/cardAbilities';

export function GameHUD() {
  const { state } = useGame();
  // Two/Three Liner souls count as two Lost Souls each; non-Lost-Soul cards
  // that legitimately sit in the Land of Redemption (e.g. Guardian of Your
  // Souls) must not add to the count.
  const soulsRescued = state.zones['land-of-redemption']
    .filter(isLostSoulCard)
    .reduce((n, c) => n + lostSoulValue(c.cardName), 0);

  if (!state.options.showTurnCounter) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(48px + env(safe-area-inset-top, 0px))',
        left: 'calc(12px + env(safe-area-inset-left, 0px))',
        display: 'flex',
        gap: 20,
        zIndex: 100,
        pointerEvents: 'none',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 9,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--gf-text-dim)',
          }}
        >
          Turn
        </div>
        <div
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 24,
            color: 'var(--gf-text-bright)',
            lineHeight: 1,
          }}
        >
          {state.turn}
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 9,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--gf-text-dim)',
          }}
        >
          Souls
        </div>
        <div
          style={{
            fontFamily: 'var(--font-cinzel), Georgia, serif',
            fontSize: 24,
            color: 'var(--gf-gold)',
            lineHeight: 1,
          }}
        >
          {soulsRescued}
        </div>
      </div>
    </div>
  );
}
