import { saveRows } from './handoff';
import type { DeckTrayState } from '../types';

/**
 * Main first, then `Reserve:` when any, tab separated. Four columns (`qty\tname\tset\timgFile`) is the builder's
 * import format; two (`qty\tname`) is what the deck-check PDF and deck image parse.
 */
export function buildDeckText(s: DeckTrayState, opts?: { columns?: 2 | 4 }): string {
  const rows = saveRows(s);
  const line = (r: (typeof rows)[number]) =>
    opts?.columns === 2
      ? `${r.quantity}\t${r.card_name}`
      : `${r.quantity}\t${r.card_name}\t${r.card_set}\t${r.card_img_file}`;
  const main = rows.filter(r => r.zone === 'main').map(line);
  const reserve = rows.filter(r => r.zone === 'reserve').map(line);
  return [...main, ...(reserve.length ? ['Reserve:', ...reserve] : [])].join('\n');
}
