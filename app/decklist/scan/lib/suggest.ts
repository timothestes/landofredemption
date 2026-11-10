// Lazy-loaded alongside the picker search: it pulls the whole card catalog.
import { printingsForIdentity, searchPrintings, type PickerHit } from '@/app/collection/scan/lib/pickerSearch';
import type { Candidate, DeckRowKind } from '../types';

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

/** A one-tap fix for a flagged row: the printing to set, the name to show, and the card's other printings. */
export type Chip = { key: string; label: string; siblings: Candidate[] };

/**
 * Up to `max` chips for a row the scan flagged: a Which card? row's own candidates first, then the picker's
 * suggestions. Unread rows have nothing to go on. Chips that share a name carry their set.
 */
export function chipsFor(
  e: { kind: DeckRowKind; title: string | null; near?: { stem: string; d: number }[]; identityCandidates?: string[] },
  max = 3,
): Chip[] {
  if (e.kind !== 'which' && e.kind !== 'read_as' && e.kind !== 'not_found') return [];
  const picked = new Map<string, PickerHit>();
  if (e.kind === 'which') {
    for (const identity of e.identityCandidates ?? []) {
      const all = printingsForIdentity(identity);
      const hit = all.find(h => h.legality === 'Rotation') ?? all[0];
      if (hit) picked.set(identity, hit);
    }
  }
  for (const h of suggestFor(e.title, e.near, max)) if (!picked.has(h.identity)) picked.set(h.identity, h);
  const hits = [...picked.values()].slice(0, max);
  const names = new Map<string, number>();
  for (const h of hits) names.set(h.name, (names.get(h.name) ?? 0) + 1);
  return hits.map(h => ({
    key: h.key,
    label: names.get(h.name)! > 1 ? `${h.name} · ${h.officialSet || h.set}` : h.name,
    siblings: printingsForIdentity(h.identity),
  }));
}
