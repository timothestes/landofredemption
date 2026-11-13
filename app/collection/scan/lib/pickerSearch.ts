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
 * could not match, which is usually a misread ("Captve Preist"). The loose pass gathers hits for each
 * word and each word's first four letters, then ranks names by how many query words they match, so
 * Captive Priest (both words) beats Captain cards (one). `close` says the loose pass produced the hits.
 */
function looseNameHits(query: string) {
  const exact = searchCardNames(query, 8);
  if (exact.length > 0) return { hits: exact, close: false };
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  const stems = words.map(w => (w.length > 4 ? w.slice(0, 4) : w));
  const pool = new Map<string, { hit: ReturnType<typeof searchCardNames>[number]; order: number }>();
  for (const t of new Set([...words, ...stems])) {
    for (const h of searchCardNames(t, 40)) {
      const k = `${h.set}|${h.imgFile}`;
      if (!pool.has(k)) pool.set(k, { hit: h, order: pool.size });
    }
  }
  // Each query word scores its best letter-pair overlap with a word of the name, which survives the
  // swapped and dropped letters a misread makes ("Preist" still scores against "Priest").
  const score = (label: string) => {
    const nameWords = label.toLowerCase().split(/[^a-z']+/).filter(Boolean);
    return words.reduce((n, w) => n + Math.max(0, ...nameWords.map(x => pairSimilarity(w, x))), 0);
  };
  const hits = [...pool.values()]
    .sort((a, b) => score(b.hit.label) - score(a.hit.label) || a.order - b.order)
    .slice(0, 8)
    .map(x => x.hit);
  return { hits, close: hits.length > 0 };
}

const pairs = (w: string) => Array.from({ length: Math.max(0, w.length - 1) }, (_, i) => w.slice(i, i + 2));

/** Dice coefficient over letter pairs: 1 for the same word, 0 for nothing shared. */
function pairSimilarity(a: string, b: string): number {
  const pa = pairs(a);
  const pb = pairs(b);
  if (pa.length === 0 || pb.length === 0) return 0;
  const left = [...pb];
  let shared = 0;
  for (const p of pa) {
    const i = left.indexOf(p);
    if (i >= 0) { shared++; left.splice(i, 1); }
  }
  return (2 * shared) / (pa.length + pb.length);
}

const toHit = (c: CardData, identity: string): PickerHit => ({
  key: `${c.name}|${c.set}|${c.imgFile}`,
  name: c.name,
  set: c.set,
  officialSet: c.officialSet,
  imgFile: c.imgFile,
  legality: c.legality,
  price: null,
  identity,
});

/** Every printing of one card identity. */
export function printingsForIdentity(identity: string): PickerHit[] {
  return printingsOf(identity).map(c => toHit(c, identity));
}

const SOUL_WORDS = ['lost', 'soul', 'souls'];

/**
 * Lost Souls for a query, read straight from the catalog. The name index cannot find them: a nickname sits
 * inside quotes (`Lost Soul "Shepherds"`), so it only ever matches as a substring and is cut from the top
 * eight, and the souls known only by verse share one stem. Every word must start a word of the name or verse;
 * failing that, a nickname close to a typed word ("shephers"). A query of only "lost soul" lists them all.
 */
function lostSoulHits(query: string): PickerHit[] {
  const typed = query.toLowerCase().split(/[^a-z0-9:'-]+/).filter(Boolean);
  const words = typed.filter(w => !SOUL_WORDS.includes(w));
  // Nothing to go on, and not because "lost soul" is all that was typed.
  if (words.length === 0 && typed.length === 0) return [];
  const souls = CARDS.filter(c => c.type === 'Lost Soul');
  // Without the "Lost Soul" every name starts with: "s" or "lo" would match them all.
  const text = (c: CardData) =>
    ` ${`${c.name.replace(/^Lost Souls?\s*/, '')} ${c.reference}`.toLowerCase().replace(/["()[\]]/g, ' ')}`;
  let found = souls.filter(c => words.every(w => text(c).includes(` ${w}`)));
  if (found.length === 0) {
    const nick = (c: CardData) => (/"([^"]+)"/.exec(c.name)?.[1] ?? '').toLowerCase();
    const score = (c: CardData) => Math.max(0, ...words.map(w => pairSimilarity(w, nick(c))));
    found = souls.filter(c => nick(c) && score(c) >= 0.6).sort((a, b) => score(b) - score(a));
  }
  return found.map(c => toHit(c, cardIdentityKey(c)));
}

/**
 * Every printing of each of the top name hits; `price` is null for the client to fill.
 * `lostSoulsFirst`: the row being changed holds a Lost Soul, so the Lost Souls that match lead the list.
 */
export function searchPrintings(query: string, opts: { lostSoulsFirst?: boolean } = {}): { hits: PickerHit[]; close: boolean } {
  const out: PickerHit[] = [];
  const seen = new Set<string>();
  if (opts.lostSoulsFirst) {
    // The matching printing, then the card's others: a pick carries them all for Change printing.
    for (const h of lostSoulHits(query)) {
      for (const p of [h, ...printingsOf(h.identity).map(c => toHit(c, h.identity))]) {
        if (seen.has(p.key)) continue;
        seen.add(p.key);
        out.push(p);
      }
    }
  }
  const named = looseNameHits(query);
  // Souls that matched are the answer: the name search's "no exact match" does not apply to them.
  const { hits } = named;
  const close = named.close && out.length === 0;
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
      out.push(toHit(c, identity));
    }
  }
  return { hits: out, close };
}
