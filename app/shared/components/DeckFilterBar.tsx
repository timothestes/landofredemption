'use client';

import { useInputMode } from '@/app/shared/hooks/useInputMode';
import type { GameCard } from '@/app/shared/types/gameCard';
import { gameCardIsWeapon } from '@/app/goldfish/utils/equipClass';

/**
 * What a card ability may pick from the deck — set when a search_deck /
 * exchange_with_deck ability opened the window. `label` is the card's own
 * wording ("a son of Jacob", "an evil N.T. Fortress").
 */
export type DeckCardFilter = { label: string; matches: (card: GameCard) => boolean };

/**
 * Filter line at the top of Search Deck / Exchange with Deck when a card
 * ability opened it: what the card is looking for, how many deck cards
 * qualify, and a toggle to see the whole deck (the player is looking through
 * it either way, and card data can be wrong).
 */
export function DeckFilterBar({
  label,
  shown,
  total,
  filterOn,
  onToggle,
}: {
  label: string;
  shown: number;
  total: number;
  filterOn: boolean;
  onToggle: () => void;
}) {
  const isTouch = useInputMode() === 'touch';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12,
        padding: '6px 10px',
        background: 'rgb(var(--gf-panel-rgb))',
        border: '1px solid var(--gf-border)',
        borderRadius: 4,
      }}
    >
      <span style={{ color: 'var(--gf-text)', fontSize: 12, fontFamily: 'var(--font-cinzel), Georgia, serif', minWidth: 0 }}>
        {filterOn ? `Looking for ${label} · ${shown} of ${total} cards` : `Showing all ${total} cards`}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: '1px solid var(--gf-border)',
          borderRadius: 4,
          color: 'var(--gf-text-dim)',
          fontSize: isTouch ? 12 : 10,
          padding: isTouch ? '8px 12px' : '3px 8px',
          cursor: 'pointer',
          fontFamily: 'var(--font-cinzel), Georgia, serif',
        }}
      >
        {filterOn ? 'Show all' : 'Only matches'}
      </button>
    </div>
  );
}

/**
 * Set when the ability that opened the window equips what it finds ("equip a
 * gold weapon from deck") and its own card can carry a weapon right now.
 * `onEquip` puts the picked weapon on that card.
 */
export type DeckEquip = { hostName: string; onEquip: (weaponId: string) => void };

/**
 * Under the filter line: pick one weapon in the grid, then this button equips
 * it to the card that searched. Dragging a card out still works as usual.
 */
export function DeckEquipBar({
  equip,
  selected,
  onDone,
}: {
  equip: DeckEquip;
  selected: GameCard[];
  onDone: () => void;
}) {
  const isTouch = useInputMode() === 'touch';
  const weapon = selected.length === 1 && gameCardIsWeapon(selected[0]) ? selected[0] : null;
  // "Ehud, the Benjaminite [RR2]" → "Ehud, the Benjaminite".
  const hostName = equip.hostName.replace(/\s*[([][^)\]]*[)\]]/g, '').trim();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <span style={{ color: 'var(--gf-text-dim)', fontSize: 11, minWidth: 0 }}>
        {isTouch ? 'Tap a weapon, then equip it' : 'Click a weapon, then equip it'}
      </span>
      <button
        disabled={!weapon}
        onClick={(e) => {
          e.stopPropagation();
          if (!weapon) return;
          equip.onEquip(weapon.instanceId);
          onDone();
        }}
        style={{
          flexShrink: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minHeight: isTouch ? 40 : undefined,
          padding: isTouch ? '8px 14px' : '5px 12px',
          background: 'var(--gf-bg)',
          border: '1px solid var(--gf-border)',
          borderRadius: 5,
          color: 'var(--gf-text-bright)',
          fontSize: 12,
          fontFamily: 'var(--font-cinzel), Georgia, serif',
          cursor: weapon ? 'pointer' : 'default',
          opacity: weapon ? 1 : 0.45,
        }}
      >
        Equip to {hostName}
      </button>
    </div>
  );
}
