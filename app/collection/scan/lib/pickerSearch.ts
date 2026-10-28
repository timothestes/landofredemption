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

/** Every printing of each of the top name hits; `price` is null for the client to fill. */
export function searchPrintings(query: string): PickerHit[] {
  const out: PickerHit[] = [];
  const seen = new Set<string>();
  for (const hit of searchCardNames(query, 8)) {
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
  return out;
}
