'use client';

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ZONE_LABELS, type ZoneId } from '@/app/shared/types/gameCard';
import { legalDestinations, type TapMoveState, type ZoneOwner } from '@/app/play/lib/tapToMoveCore';

interface DestinationRailProps {
  state: TapMoveState;
  format: 'T1' | 'T2' | 'Paragon';
  cardName?: string;
  /** The armed card is a Lost Soul - pulls Land of Bondage and Land of
   *  Redemption to the front of the chip row (see legalDestinations). */
  isLostSoul?: boolean;
  /** Height of the player's hand band in screen px. The rail floats ABOVE it
   *  rather than over it: a card is usually armed FROM the hand, so covering
   *  the hand would hide the card just picked and block re-arming another. */
  handBandHeight?: number;
  /** Portrait board: the single scroll row leaves ~110px for chips on a
   *  393px-wide phone — one chip visible, the rest scrolled out with no
   *  affordance (wave-3 QA: players could not find Discard/Deck/LOR at all).
   *  Wrap lays the chips out as a full-width multi-row grid instead; the
   *  tall portrait column has the vertical room the landscape hand strip
   *  doesn't. */
  wrap?: boolean;
  onPick: (zone: ZoneId, owner: ZoneOwner) => void;
  onCancel: () => void;
  /** The segmented Mine/Theirs/Shared control drives the armed state's `side`
   *  (which gates board-tap commits) — the reducer owns it, the rail is a
   *  view. A cross-side board tap flips it too, so the visible segment change
   *  is the feedback that the tap re-targeted rather than committed. */
  onSideChange: (side: ZoneOwner) => void;
}

/** Short labels - the full ZONE_LABELS strings overflow a chip. Casing
 *  matches the sidebar pile labels (LOR/LOB), so the chips and the board
 *  name the zones identically. */
const SHORT_LABELS: Partial<Record<ZoneId, string>> = {
  'land-of-redemption': 'LOR',
  'land-of-bondage': 'LOB',
  'soul-deck': 'Soul Deck',
  banish: 'Banish',
};

/** The board's Cinzel/gold chrome, as Tailwind-arbitrary values — the stock
 *  neutral-gray chips read as a different app next to the turn bar. */
const CINZEL = '[font-family:var(--font-cinzel),Georgia,serif]';

function label(zone: ZoneId): string {
  return SHORT_LABELS[zone] ?? ZONE_LABELS[zone];
}

/**
 * Chip bar listing every legal destination for the armed card, INCLUDING
 * destinations currently off-screen.
 *
 * This is the answer to the reachability problem a pan/zoom camera creates:
 * with the rail, moving a card to the opponent's side never depends on what
 * the camera happens to be showing.
 */
export function DestinationRail({
  state, format, cardName, isLostSoul = false, handBandHeight = 0, wrap = false, onPick, onCancel, onSideChange,
}: DestinationRailProps) {
  // The side lives in the tap-to-move reducer (tapCard resets it to 'my', so
  // the rail never opens on a stale tab from the previous move).
  const side: ZoneOwner = state.kind === 'armed' ? state.side : 'my';

  const destinations = useMemo(() => {
    if (state.kind !== 'armed') return [];
    return legalDestinations(state.sourceZone, state.sourceOwner, format, { isLostSoul });
  }, [state, format, isLostSoul]);

  const visible = destinations.filter((d) => d.owner === side);
  const hasShared = destinations.some((d) => d.owner === 'shared');
  const sides: ZoneOwner[] = hasShared ? ['my', 'opponent', 'shared'] : ['my', 'opponent'];

  return (
    <AnimatePresence>
      {state.kind === 'armed' && (
        <motion.div
          className={`pointer-events-auto absolute inset-x-0 z-[300] flex items-center gap-2
                     border-y border-[rgba(var(--gf-border-rgb),0.6)] bg-[rgba(var(--gf-bg-dark-rgb),0.95)] px-2 py-1 backdrop-blur
                     ${wrap ? 'flex-wrap' : ''}`}
          style={{ bottom: handBandHeight }}
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          data-testid="destination-rail"
        >
          {/* Armed-card name — a small tab riding the rail's top edge, so the
              player can see WHICH card the chips will move (pairs with the
              amber ring on the card itself). Absolute: costs no rail width. */}
          {cardName && (
            <span
              data-testid="destination-rail-card-name"
              className="pointer-events-none absolute -top-[22px] left-2 max-w-[60%] truncate
                         rounded-t-md border border-b-0 border-[rgba(var(--gf-border-rgb),0.6)] bg-[rgba(var(--gf-bg-dark-rgb),0.95)]
                         px-2 py-0.5 text-[11px] font-medium text-amber-200/90"
            >
              {/* "Moving" makes the tab self-explanatory — a bare card name
                  over the board read as a phantom card after a stray tap
                  armed something (phone QA, wave 8). */}
              Moving: {cardName}
            </span>
          )}
          {/* One compact row. Three stacked rows were ~130px tall, which on a
              393px-high phone buried the entire hand band. */}
          {/* Side selector — a segmented control, visually distinct from the
              destination chips so "which side" doesn't read as a destination.
              Unselected segments stay clearly legible (they looked disabled
              at neutral-400). */}
          <div
            role="group"
            aria-label="Whose side"
            className="flex shrink-0 overflow-hidden rounded-lg border border-[color:var(--gf-border)]"
          >
            {sides.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => onSideChange(s)}
                data-testid={`destination-side-${s}`}
                aria-pressed={side === s}
                className={
                  `min-h-[44px] px-3 text-[12px] font-semibold ${CINZEL} ` +
                  (i > 0 ? 'border-l border-[color:var(--gf-border)] ' : '') +
                  (side === s
                    ? 'bg-[var(--gf-accent)] text-[#1a1108]'
                    : 'bg-[#14100a] text-[rgba(var(--gf-text-bright-rgb),0.85)] active:bg-[var(--gf-bg)]')
                }
              >
                {s === 'my' ? 'Mine' : s === 'opponent' ? 'Theirs' : 'Shared'}
              </button>
            ))}
          </div>

          {/* Wrap (portrait): a full-width multi-row grid below the selector
              row. Otherwise: one scrolling row, with a right-edge fade as the
              scroll affordance — without it the trailing chips (LOB for a
              soul) read as absent rather than scrolled out. */}
          <div
            className={
              wrap
                ? 'order-last flex basis-full flex-wrap gap-2 pt-1'
                : 'flex flex-1 gap-2 overflow-x-auto [mask-image:linear-gradient(to_right,black_0,black_calc(100%-28px),transparent)]'
            }
          >
            {visible.map((d) => (
              <button
                key={`${d.owner}:${d.zone}`}
                type="button"
                onClick={() => onPick(d.zone, d.owner)}
                data-testid={`destination-${d.owner}-${d.zone}`}
                className={`min-h-[44px] shrink-0 rounded-lg border border-[rgba(var(--gf-border-rgb),0.8)]
                           bg-[#221809] px-4 text-[13px] font-medium uppercase tracking-wide
                           text-[color:var(--gf-text-bright)] active:bg-[#3a2a14] ${CINZEL}`}
              >
                {label(d.zone)}
              </button>
            ))}
          </div>

          {/* Cancel must not read as another destination — ghost + red. */}
          <button
            type="button"
            onClick={onCancel}
            data-testid="destination-rail-cancel"
            aria-label={`Cancel moving ${cardName ?? 'card'}`}
            className={`min-h-[44px] min-w-[44px] shrink-0 rounded-lg border border-red-900/70
                       px-3 text-[12px] uppercase tracking-wide text-red-300/90
                       active:bg-red-950/60 active:text-red-200 ${CINZEL}
                       ${wrap ? 'ml-auto' : ''}`}
          >
            Cancel
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
