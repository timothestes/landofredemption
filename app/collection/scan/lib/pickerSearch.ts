// Loaded only through import() from the picker: it pulls the whole card catalog.
import { searchCardNames } from '@/lib/cards/search';
import { CARDS, findCard, type CardData } from '@/lib/cards/lookup';
import { cardIdentityKey } from '@/lib/cards/cardIdentity';
import type { Candidate } from '@/lib/scan/match';

/** A search result printing, tagged with its card identity so a pick can carry its siblings. */
export type PickerHit = Candidate & { identity: string };

let byIdentity: Map<string, CardData[]> | null = null;
function printingsOf(identity: string): CardData[] {
  if (!byIdentity) {
    byIdentity = new Map();
    for (const c of CARDS) {
      const k = cardIdentityKey(c);
      const list = byIdentity.get(k);
      if (list) list.push(c);
      else byIdentity.set(k, [c]);
    }
  }
  return byIdentity.get(identity) ?? [];
}

/**
 * Name hits for a query, loosened when it finds nothing: Find card starts from a title the scanner
 * could not match, which is usually a misread ("Captve Preist"). Then each word, longest first, and
 * then each word's first four letters. `close` says the loose pass produced the hits.
 */
function looseNameHits(query: string) {
  const exact = searchCardNames(query, 8);
  if (exact.length > 0) return { hits: exact, close: false };
  const words = query.split(/\s+/).filter(w => w.length >= 3).sort((a, b) => b.length - a.length);
  const tries = [...words, ...words.filter(w => w.length > 4).map(w => w.slice(0, 4))];
  const hits = [];
  const seen = new Set<string>();
  for (const t of tries) {
    for (const h of searchCardNames(t, 8)) {
      const k = `${h.set}|${h.imgFile}`;
      if (!seen.has(k)) { seen.add(k); hits.push(h); }
    }
    if (hits.length >= 8) break;
  }
  return { hits: hits.slice(0, 8), close: hits.length > 0 };
}

/** Every printing of each of the top name hits; `price` is null for the client to fill. */
export function searchPrintings(query: string): { hits: PickerHit[]; close: boolean } {
  const out: PickerHit[] = [];
  const seen = new Set<string>();
  const { hits, close } = looseNameHits(query);
  for (const hit of hits) {
    // A hit's name is the stem when unique, so findCard can land on another printing; trust set|imgFile.
    const found = findCard(hit.name, hit.set, hit.imgFile);
    const card =
      found && found.set === hit.set && found.imgFile === hit.imgFile
        ? found
        : CARDS.find(c => c.set === hit.set && c.imgFile === hit.imgFile) ?? found;
    if (!card) continue;
    const identity = cardIdentityKey(card);
    for (const c of printingsOf(identity)) {
      const key = `${c.name}|${c.set}|${c.imgFile}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        name: c.name,
        set: c.set,
        officialSet: c.officialSet,
        imgFile: c.imgFile,
        legality: c.legality,
        price: null,
        identity,
      });
    }
  }
  return { hits: out, close };
}
