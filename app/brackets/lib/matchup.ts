import { EVIL_BRIGADES, GOOD_BRIGADES } from '@/app/decklist/card-search/constants';
import { sanitizeImgFile } from '@/app/shared/utils/cardImageUrl';
import { compareCardsByType, compareTypeGroups, type SortableCard } from '@/lib/cards/defaultSort';
import { getGroupDisplayName, getGroupKey } from '@/lib/decks/typeGroups';
import { brigadeRank } from '@/lib/tournament/brigadeColors';

/**
 * The matchup preview's pure helpers: how a deck's rows become buckets,
 * counts and brigade mixes, and how two decks line up in the face-off table.
 * Structural input so the page's enriched rows and tests' fixtures both fit.
 */
export interface MatchupCard {
  card_name: string;
  card_set?: string;
  card_img_file?: string | null;
  quantity: number;
  zone: string;
  /** Raw catalog type ('GE', 'Hero', 'Lost Soul', …); '' when the row matched no catalog card. */
  type: string;
  alignment: string;
  /** Normalized brigades joined with '/', as the catalog index stores them. */
  brigade: string;
  strength?: string;
  reference?: string;
}

export interface DeckGroup<T extends MatchupCard> {
  key: string;
  name: string;
  /** Copies in the bucket, not rows. */
  count: number;
  cards: T[];
}

export interface BrigadeCount { name: string; count: number }

export interface DeckBreakdown {
  main: number;
  reserve: number;
  types: { key: string; name: string; count: number }[];
  brigades: { good: BrigadeCount[]; evil: BrigadeCount[] };
}

export interface FaceOffRow { label: string; a: number | null; b: number | null }

const OTHER = 'Other';

/** The catalog key for a deck row: `name|set|imgFile`, the image sanitized the way CARD_BY_FULL_KEY is keyed. */
export function cardKey(card: Pick<MatchupCard, 'card_name' | 'card_set' | 'card_img_file'>): string {
  return `${card.card_name}|${card.card_set ?? ''}|${sanitizeImgFile(card.card_img_file ?? '')}`;
}

const toSortable = (c: MatchupCard): SortableCard => ({
  name: c.card_name,
  type: c.type,
  brigade: c.brigade,
  alignment: c.alignment,
  strength: c.strength,
  reference: c.reference,
});

const sumCopies = (cards: MatchupCard[]) => cards.reduce((n, c) => n + c.quantity, 0);

/** Main deck in canonical type buckets, each sorted; reserve sorted on its own. The maybeboard is not part of the deck. */
export function groupDeck<T extends MatchupCard>(cards: T[]): { main: DeckGroup<T>[]; reserve: T[] } {
  const byKey = new Map<string, T[]>();
  for (const card of cards) {
    if (card.zone !== 'main') continue;
    const key = card.type ? getGroupKey(card.type) : OTHER;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(card);
    else byKey.set(key, [card]);
  }
  const main = [...byKey.keys()]
    .sort(compareTypeGroups)
    .map(key => {
      const bucket = byKey.get(key)!.sort((x, y) => compareCardsByType(toSortable(x), toSortable(y)));
      return { key, name: getGroupDisplayName(key), count: sumCopies(bucket), cards: bucket };
    });
  const reserve = cards
    .filter(c => c.zone === 'reserve')
    .sort((x, y) => compareCardsByType(toSortable(x), toSortable(y)));
  return { main, reserve };
}

const GOOD = new Set<string>(GOOD_BRIGADES);
const EVIL = new Set<string>(EVIL_BRIGADES);

/** 'Good Gold' and 'Evil Multi' read as 'Gold' and 'Multi' once the side is known. */
const displayName = (token: string) => token.replace(/^(Good|Evil) /, '');

// Multi sorts first among equals, as every brigade-grouped list on the site does.
const tieRank = (name: string) => (name === 'Multi' ? -1 : brigadeRank(name));

/**
 * Main-deck copies per brigade, good and evil apart, most-played first.
 * A card carrying every brigade of a side counts once as that side's Multi;
 * a card with two or three named brigades counts under each of them.
 */
export function brigadeCounts(cards: MatchupCard[]): { good: BrigadeCount[]; evil: BrigadeCount[] } {
  const good = new Map<string, number>();
  const evil = new Map<string, number>();
  for (const card of cards) {
    if (card.zone !== 'main' || !card.brigade) continue;
    let tokens = card.brigade.split('/').map(t => t.trim()).filter(Boolean);
    if (GOOD_BRIGADES.every(b => tokens.includes(b))) {
      tokens = ['Good Multi', ...tokens.filter(t => !GOOD.has(t))];
    }
    if (EVIL_BRIGADES.every(b => tokens.includes(b))) {
      tokens = ['Evil Multi', ...tokens.filter(t => !EVIL.has(t))];
    }
    for (const token of tokens) {
      const side = token === 'Good Multi' || GOOD.has(token) ? good : token === 'Evil Multi' || EVIL.has(token) ? evil : null;
      if (!side) continue;
      const name = displayName(token);
      side.set(name, (side.get(name) ?? 0) + card.quantity);
    }
  }
  const list = (m: Map<string, number>): BrigadeCount[] =>
    [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((x, y) => y.count - x.count || tieRank(x.name) - tieRank(y.name));
  return { good: list(good), evil: list(evil) };
}

export function deckBreakdown(cards: MatchupCard[]): DeckBreakdown {
  const { main, reserve } = groupDeck(cards);
  return {
    main: main.reduce((n, g) => n + g.count, 0),
    reserve: sumCopies(reserve),
    types: main.map(({ key, name, count }) => ({ key, name, count })),
    brigades: brigadeCounts(cards),
  };
}

/**
 * The face-off table: totals, then every type bucket either deck has, in
 * canonical order. A side with no readable deck shows null in every row;
 * rows that are zero on both sides are left out.
 */
export function faceOffRows(a: DeckBreakdown | null, b: DeckBreakdown | null): FaceOffRow[] {
  if (!a && !b) return [];
  const pick = (side: DeckBreakdown | null, get: (d: DeckBreakdown) => number): number | null => (side ? get(side) : null);
  const keys = new Set([...(a?.types ?? []), ...(b?.types ?? [])].map(t => t.key));
  const countOf = (side: DeckBreakdown | null, key: string) =>
    pick(side, d => d.types.find(t => t.key === key)?.count ?? 0);
  const rows: FaceOffRow[] = [
    { label: 'Main deck', a: pick(a, d => d.main), b: pick(b, d => d.main) },
    { label: 'Reserve', a: pick(a, d => d.reserve), b: pick(b, d => d.reserve) },
    ...[...keys].sort(compareTypeGroups).map(key => ({
      label: getGroupDisplayName(key),
      a: countOf(a, key),
      b: countOf(b, key),
    })),
  ];
  return rows.filter(r => (r.a ?? 0) > 0 || (r.b ?? 0) > 0);
}
