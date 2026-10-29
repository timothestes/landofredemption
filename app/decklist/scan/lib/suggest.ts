// Lazy-loaded alongside the picker search: it pulls the whole card catalog.
import { searchPrintings, type PickerHit } from '@/app/collection/scan/lib/pickerSearch';

/**
 * Picker suggestions for a row the scan could not settle: the near stems the server sent (closest
 * first), then whatever the read title finds. One printing per card, preferring the Rotation one.
 */
export function suggestFor(
  readTitle: string | null,
  near: { stem: string; d: number }[] | undefined,
  max = 5,
): PickerHit[] {
  const queries = [...(near ?? [])].sort((a, b) => a.d - b.d).map(n => n.stem);
  if (readTitle && readTitle.trim()) queries.push(readTitle);
  const byIdentity = new Map<string, PickerHit>();
  for (const q of queries) {
    for (const h of searchPrintings(q).hits) {
      const have = byIdentity.get(h.identity);
      if (!have) byIdentity.set(h.identity, h);
      else if (have.legality !== 'Rotation' && h.legality === 'Rotation') {
        byIdentity.set(h.identity, h); // keeps the identity's original position in the map
      }
    }
  }
  return [...byIdentity.values()].slice(0, max);
}
