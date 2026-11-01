import { describe, it, expect } from 'vitest';
import { passesLegalityFilter } from '../DuplicateCards';
import { CARDS } from '@/lib/cards/lookup';
import type { Card } from '../../utils';

function card(name: string, set: string): Card {
  const row = CARDS.find((c) => c.name === name && c.set === set);
  if (!row) throw new Error(`missing card row: ${name} (${set})`);
  return row as unknown as Card;
}

// These printings are flagged legality:'Rotation' in the card data; only the
// per-format ban list keeps them out of the Limited view.
const IMITATE = card('Lost Soul "Imitate" [III John 1:11]', 'RoJ');
const IMITATE_AB = card('Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]', 'RoJ (AB)');
const HARVEST_TIME = card('Harvest Time (GoC)', 'GoC');
const BURIAL = card('Burial (GoC)', 'GoC');

describe('passesLegalityFilter — Limited mode applies the format ban list', () => {
  it('the explicit-only bans are Rotation-flagged in the data', () => {
    for (const c of [IMITATE, IMITATE_AB, HARVEST_TIME, BURIAL]) {
      expect(c.legality).toBe('Rotation');
    }
  });

  it('hides the Imitate Lost Soul in Limited, Teams and T2', () => {
    for (const format of ['Limited', 'Teams', 'T2'] as const) {
      expect(passesLegalityFilter(IMITATE, 'Limited', format)).toBe(false);
      expect(passesLegalityFilter(IMITATE_AB, 'Limited', format)).toBe(false);
    }
  });

  it('keeps the Imitate Lost Soul for an Unlimited deck, where it is legal', () => {
    expect(passesLegalityFilter(IMITATE, 'Limited', 'Unlimited')).toBe(true);
  });

  it('hides Harvest Time only in T2 and Burial only in Teams', () => {
    expect(passesLegalityFilter(HARVEST_TIME, 'Limited', 'Limited')).toBe(true);
    expect(passesLegalityFilter(HARVEST_TIME, 'Limited', 'T2')).toBe(false);
    expect(passesLegalityFilter(BURIAL, 'Limited', 'Limited')).toBe(true);
    expect(passesLegalityFilter(BURIAL, 'Limited', 'Teams')).toBe(false);
  });

  it('Banned mode still lists them for the format that bans them', () => {
    expect(passesLegalityFilter(IMITATE, 'Banned', 'Limited')).toBe(true);
    expect(passesLegalityFilter(HARVEST_TIME, 'Banned', 'Limited')).toBe(false);
  });
});
