import type { PickerHit } from './pickerSearch';

const isAlternateBorder = (h: PickerHit) => /\bAB\b/.test(h.name) || /alternate border/i.test(h.officialSet);

/** One search result row: the printing shown, how many printings of that card the search found, and the rest of them. */
export interface PickerRow { hit: PickerHit; printings: number; others: PickerHit[] }

/**
 * Search hits as one row per card instead of one per printing: for a deck, which card matters and its printing
 * can be changed afterwards. Each card shows its current printing if it has it, else a Rotation printing (the
 * regular one before an alternate border), else its first. Cards legal in Limited (a Rotation printing) come first; otherwise the search's own order is kept.
 */
export function onePerCard(hits: PickerHit[], currentKey: string | null): PickerRow[] {
  const byCard = new Map<string, PickerHit[]>();
  for (const h of hits) {
    const list = byCard.get(h.identity);
    if (list) list.push(h);
    else byCard.set(h.identity, [h]);
  }
  const legalFirst = (a: PickerHit, b: PickerHit) => Number(b.legality === 'Rotation') - Number(a.legality === 'Rotation');
  const rows = [...byCard.values()].map(list => {
    const hit = list.find(h => h.key === currentKey)
      ?? list.find(h => h.legality === 'Rotation' && !isAlternateBorder(h))
      ?? list.find(h => h.legality === 'Rotation')
      ?? list[0];
    return {
      hit,
      printings: list.length,
      others: list.filter(h => h !== hit).sort(legalFirst),
      legal: list.some(h => h.legality === 'Rotation'),
    };
  });
  // Array.prototype.sort is stable: equal rows keep the search order.
  return rows.sort((a, b) => Number(b.legal) - Number(a.legal)).map(({ hit, printings, others }) => ({ hit, printings, others }));
}

/** The highlighted row after an arrow key: one step, held inside the list. */
export const moveActive = (active: number, step: 1 | -1, count: number): number =>
  Math.min(Math.max(0, count - 1), Math.max(0, active + step));
