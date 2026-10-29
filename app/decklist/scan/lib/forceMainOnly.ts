import type { SaveRow } from './handoff';

/**
 * Lost Souls and Dominants can only live in the main deck. The client can't always
 * know the type of a swapped-in card, so the server forces them to main and merges
 * rows that now share a card and zone (quantity capped at 99).
 */
export function forceMainOnly(rows: SaveRow[], typeOf: (r: SaveRow) => string | undefined): SaveRow[] {
  const out = new Map<string, SaveRow>();
  for (const r of rows) {
    const t = (typeOf(r) ?? '').toLowerCase();
    const zone = t.includes('lost soul') || t.includes('dominant') ? 'main' : r.zone;
    const k = `${zone}|${r.card_name}|${r.card_set}|${r.card_img_file}`;
    const have = out.get(k);
    if (have) have.quantity = Math.min(99, have.quantity + r.quantity);
    else out.set(k, { ...r, zone });
  }
  return [...out.values()];
}
