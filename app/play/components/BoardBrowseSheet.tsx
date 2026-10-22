'use client';

import React from 'react';
import { X } from 'lucide-react';
import type { ZoneId } from '@/app/shared/types/gameCard';

export type BoardBrowseOwner = 'my' | 'opponent' | 'shared';

export interface BoardBrowseEntry {
  owner: BoardBrowseOwner;
  zone: ZoneId;
  label: string;
  count: number;
}

interface BoardBrowseSheetProps {
  entries: BoardBrowseEntry[];
  onPick: (entry: BoardBrowseEntry) => void;
  onClose: () => void;
  /** Replaces the default "Mine"/"Theirs" owner prefixes — a spectator is
   *  neither player, so their sheet shows the seat names instead. */
  ownerLabels?: { my: string; opponent: string };
}

/**
 * "What is actually on the board?" — a list of the in-play zones with their
 * counts, each opening the zone's card grid.
 *
 * Board cards render around 57x79 screen px on a landscape phone, free-form
 * territories do not arrange themselves, and Konva hit-testing only ever
 * returns the topmost card. Past about eight cards a territory becomes a pile
 * a player can neither read nor aim at, and half of it is off-camera after a
 * side jump. The grid behind this sheet is camera-independent and readable, so
 * finding and acting on a specific card stops depending on hitting a sliver of
 * it.
 */
export function BoardBrowseSheet({ entries, onPick, onClose, ownerLabels }: BoardBrowseSheetProps) {
  return (
    <div
      data-board-browse
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        inset: 0,
        // Over the floating toolbar/gear (200) and the phone right panel (300),
        // under the card menus (900) the grid itself opens.
        zIndex: 500,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
          maxHeight: '88%',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          background: 'var(--gf-bg, #14100a)',
          borderTop: '1px solid var(--gf-border, rgba(107,78,39,0.6))',
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '2px 4px 2px 16px',
            borderBottom: '1px solid var(--gf-border, rgba(107,78,39,0.5))',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--gf-text, #e8d5a3)',
            }}
          >
            Cards in play
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 44, height: 44, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none',
              color: 'var(--gf-text-dim, rgba(232,213,163,0.6))',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {entries.map((e) => (
          <button
            key={`${e.owner}:${e.zone}`}
            type="button"
            disabled={e.count === 0}
            onClick={() => onPick(e)}
            data-testid={`board-browse-${e.owner}-${e.zone}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              width: '100%',
              minHeight: 48,
              padding: '0 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid rgba(var(--gf-border-rgb), 0.25)',
              color: e.count === 0
                ? 'var(--gf-text-dim, rgba(232,213,163,0.35))'
                : 'var(--gf-text, #e8d5a3)',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              fontSize: 14,
              textAlign: 'left',
            }}
          >
            <span>
              {e.owner !== 'shared' && (
                <>
                  <span
                    style={{
                      // Identity colour (amber = mine, blue = theirs): never themed.
                      color: e.owner === 'my' ? '#c4955a' : 'rgba(232,213,163,0.55)',
                      // Seat names can be long — keep the zone label readable.
                      display: 'inline-block',
                      maxWidth: 110,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      verticalAlign: 'bottom',
                    }}
                  >
                    {e.owner === 'my' ? (ownerLabels?.my ?? 'Mine') : (ownerLabels?.opponent ?? 'Theirs')}
                  </span>
                  {' · '}
                </>
              )}
              {e.label}
            </span>
            <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.75 }}>{e.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
