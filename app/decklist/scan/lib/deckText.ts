import { saveRows } from './handoff';
import type { DeckTrayState } from '../types';

/** The builder's tab format: `qty\tname\tset\timgFile`, main first, then `Reserve:` when any. */
export function buildDeckText(s: DeckTrayState): string {
  const rows = saveRows(s);
  const line = (r: (typeof rows)[number]) => `${r.quantity}\t${r.card_name}\t${r.card_set}\t${r.card_img_file}`;
  const main = rows.filter(r => r.zone === 'main').map(line);
  const reserve = rows.filter(r => r.zone === 'reserve').map(line);
  return [...main, ...(reserve.length ? ['Reserve:', ...reserve] : [])].join('\n');
}
