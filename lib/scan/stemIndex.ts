/**
 * The scanner's identity index: groups of printings of one card, built once
 * from CARDS. Starts from `cardIdentityKey` groups and applies the scanner's
 * union rules with union-find: (a) AB printing with its original, (b) one card
 * split by name decoration or class spelling, (c) known spelling variants.
 * Pure: no I/O.
 */

import { CARDS, type CardData } from '@/lib/cards/lookup';
import { cardIdentityKey, cardNameStem } from '@/lib/cards/cardIdentity';
import abMap from '@/lib/cards/generated/abMap.json';
import {
  cardKey, isLostSoul, nicknameOf, normalizeAbility, normalizeTitle, refsOf, SPELLING_VARIANT_STEMS,
} from './vocab';

export interface ScanIdentity {
  key: string;
  members: string[];
  stem: string;
  normalizedStem: string;
  cards: CardData[];
  refs: Set<string>;
  lostSoul: boolean;
  token: boolean;
}

export interface ScanIndex {
  identities: Map<string, ScanIdentity>;
  byStem: Map<string, ScanIdentity[]>;
  stems: string[];
  lostSoulByRef: Map<string, ScanIdentity[]>;
  canonicalIdentity(cardIdentityKeyValue: string): string;
  identityOf(card: CardData): ScanIdentity;
  abTwinKey(cardKey: string): string | undefined;
  stats: { identities: number; stems: number; unions: number };
}

const JACCARD_MIN = 0.6;

function tokenOverlap(a: string, b: string): number {
  const l = new Set(a.split(' ').filter(Boolean));
  const r = new Set(b.split(' ').filter(Boolean));
  if (!l.size || !r.size) return 0;
  let shared = 0;
  for (const t of l) if (r.has(t)) shared++;
  return shared / (l.size + r.size - shared);
}

function build(): ScanIndex {
  const raw = new Map<string, { key: string; cards: CardData[] }>();
  for (const c of CARDS) {
    const k = cardIdentityKey(c);
    let r = raw.get(k);
    if (!r) raw.set(k, (r = { key: k, cards: [] }));
    r.cards.push(c);
  }

  const parent = new Map<string, string>();
  for (const k of raw.keys()) parent.set(k, k);
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let y = x;
    while (parent.get(y) !== r) { const n = parent.get(y)!; parent.set(y, r); y = n; }
    return r;
  };
  // `unions` is the spike's union log: one entry per qualifying pair (AB pairs
  // that were not already joined; every pair that passes rule (b) or (c)), so
  // it can exceed the number of identities actually removed.
  let unions = 0;
  const union = (a: string, b: string, alwaysLog = false) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) { parent.set(ra, rb); unions++; } else if (alwaysLog) unions++;
  };

  const byNameSet = new Map<string, CardData>();
  for (const c of CARDS) byNameSet.set(`${c.name}|${c.set}`, c);

  // (a) AB printings with their originals.
  const abTwin = new Map<string, string>();
  for (const [ab, orig] of Object.entries(abMap as Record<string, string>)) {
    const a = byNameSet.get(ab), o = byNameSet.get(orig);
    if (!a || !o) continue;
    union(cardIdentityKey(a), cardIdentityKey(o));
    abTwin.set(cardKey(a), cardKey(o));
    abTwin.set(cardKey(o), cardKey(a));
  }

  const refsOfCards = (cards: CardData[]) => new Set(cards.flatMap(c => refsOf(c.reference)));
  const shareRef = (a: CardData[], b: CardData[]) => {
    const ra = refsOfCards(a);
    return b.some(c => refsOf(c.reference).some(r => ra.has(r)));
  };

  // (b) Same card split by name decoration or class spelling.
  const groups = new Map<string, { key: string; cards: CardData[] }[]>();
  for (const id of raw.values()) {
    const c = id.cards[0];
    const stemPart = isLostSoul(c) ? 'lost soul' : normalizeTitle(cardNameStem(c.name, c.type));
    const g = `${stemPart}|${normalizeTitle(c.type)}|${normalizeTitle(c.brigade)}|${normalizeTitle(c.alignment)}`;
    const list = groups.get(g);
    if (list) list.push(id); else groups.set(g, [id]);
  }
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const A = ids[i].cards, B = ids[j].cards;
      if (!shareRef(A, B)) continue;
      if (isLostSoul(A[0]) && nicknameOf(A[0]) !== nicknameOf(B[0])) continue;
      const abA = normalizeAbility(A[0].specialAbility), abB = normalizeAbility(B[0].specialAbility);
      if ((!abA && !abB) || abA === abB || tokenOverlap(abA, abB) >= JACCARD_MIN) union(ids[i].key, ids[j].key, true);
    }
  }

  // (c) Spelling variants: identities carrying either stem of a pair, sharing a reference.
  const stemsOfRaw = (id: { cards: CardData[] }) => new Set(id.cards.map(c => normalizeTitle(cardNameStem(c.name, c.type))));
  const rawList = [...raw.values()];
  for (const [s1, s2] of SPELLING_VARIANT_STEMS) {
    const left = rawList.filter(id => stemsOfRaw(id).has(s1));
    const right = rawList.filter(id => stemsOfRaw(id).has(s2));
    for (const a of left) for (const b of right) if (shareRef(a.cards, b.cards)) union(a.key, b.key, true);
  }

  const identities = new Map<string, ScanIdentity>();
  const memberToRoot = new Map<string, string>();
  for (const id of raw.values()) {
    const root = find(id.key);
    memberToRoot.set(id.key, root);
    let I = identities.get(root);
    if (!I) {
      const c = id.cards[0];
      const stem = cardNameStem(c.name, c.type);
      I = { key: root, members: [], stem, normalizedStem: normalizeTitle(stem), cards: [], refs: new Set(), lostSoul: isLostSoul(c), token: /token/i.test(c.type) };
      identities.set(root, I);
    }
    I.members.push(id.key);
    I.cards.push(...id.cards);
    for (const c of id.cards) for (const r of refsOf(c.reference)) I.refs.add(r);
  }

  const byStem = new Map<string, ScanIdentity[]>();
  const lostSoulByRef = new Map<string, ScanIdentity[]>();
  const addStem = (s: string, id: ScanIdentity) => {
    if (!s) return;
    const list = byStem.get(s);
    if (!list) byStem.set(s, [id]);
    else if (!list.includes(id)) list.push(id);
  };
  for (const id of identities.values()) {
    const seen = new Set<string>();
    for (const c of id.cards) {
      const stem = cardNameStem(c.name, c.type);
      if (seen.has(stem)) continue;
      seen.add(stem);
      addStem(normalizeTitle(stem), id);
      if (stem.includes(' / ')) for (const half of stem.split(' / ')) addStem(normalizeTitle(half), id);
    }
    if (id.lostSoul) for (const r of id.refs) {
      const list = lostSoulByRef.get(r);
      if (list) list.push(id); else lostSoulByRef.set(r, [id]);
    }
  }

  const canonicalIdentity = (k: string) => memberToRoot.get(k) ?? k;
  return {
    identities, byStem, stems: [...byStem.keys()], lostSoulByRef, canonicalIdentity,
    identityOf: card => identities.get(canonicalIdentity(cardIdentityKey(card)))!,
    abTwinKey: k => abTwin.get(k),
    stats: { identities: identities.size, stems: byStem.size, unions },
  };
}

let cached: ScanIndex | null = null;
export function getScanIndex(): ScanIndex {
  return (cached ??= build());
}
