import type { GameCard } from '../types';
import type { ZoneRect } from './zoneLayout';
import { compareCardsByType, compareTypeGroups } from '@/lib/cards/defaultSort';

/**
 * "Spread Deck" layout: lay the deck pile out across Territory the way the
 * deck builder's expanded view draws a deck with viewMode='stacked' and
 * groupBy='type' (app/decklist/card-search/components/FullDeckView.tsx).
 *
 * One or more vertical columns per type bucket, buckets in canonical order,
 * every copy its own card, each card overlapping the one above so only a top
 * strip shows. Pure: the caller (GoldfishCanvas) supplies the Territory rect
 * and the current card size; the reducer only applies the positions.
 */

/** Max cards per column before a bucket is split — FullDeckView.splitTypeGroup. */
export const SPREAD_MAX_PER_COLUMN = 17;
/** Column gap as a fraction of card width: `md:gap-4` (16px) on a `md:w-28` (112px) card. */
export const SPREAD_GAP_RATIO = 0.14;
/** Visible strip per stacked card as a fraction of card height: a 112×156.8
 *  card in a `flex-col gap-2` column with `-mb-32` shows 156.8 − 128 + 8 ≈ 36.8px. */
export const SPREAD_STRIP_RATIO = 0.235;

const EDGE_PAD = 8;
/** Clears the 20px zone label strip along the top of Territory. */
const TOP_PAD = 24;

// Same prettification FullDeckView uses to build its bucket keys. Only the
// bucket names matter here; they feed compareTypeGroups.
const PRETTY_TYPE: Record<string, string> = {
  GE: 'Good Enhancement',
  EE: 'Evil Enhancement',
  EC: 'Evil Character',
  HC: 'Hero Character',
  GC: 'Good Character',
  LS: 'Lost Soul',
  Dom: 'Dominant',
  Cov: 'Covenant',
  Cur: 'Curse',
  Art: 'Artifact',
  Fort: 'Fortress',
  Site: 'Site',
};

/** Deck-builder bucket for a raw card type (FullDeckView.groupCards, groupBy='type'). */
export function spreadBucketKey(rawType: string): string {
  const type = rawType || 'Unknown';
  if (type.includes('/')) return 'Dual-Type';
  const pretty = PRETTY_TYPE[type] ?? type;
  if (pretty === 'Artifact' || pretty === 'Covenant' || pretty === 'Curse') return 'Artifact/Covenant/Curse';
  if (pretty === 'Fortress' || pretty === 'Site' || pretty === 'City') return 'Fortress/Site';
  return pretty;
}

interface Run {
  cards: GameCard[];
}

// Collapse a sorted bucket into runs of identical copies (same name + set),
// the "entries with quantity" FullDeckView balances on.
function runsOf(sorted: GameCard[]): Run[] {
  const runs: Run[] = [];
  for (const card of sorted) {
    const last = runs[runs.length - 1];
    const prev = last?.cards[0];
    if (prev && prev.cardName === card.cardName && prev.cardSet === card.cardSet) {
      last.cards.push(card);
    } else {
      runs.push({ cards: [card] });
    }
  }
  return runs;
}

// Port of FullDeckView.splitTypeGroup: balance whole runs across
// ceil(total / max) columns, never splitting a run.
function splitIntoColumns(sorted: GameCard[], maxPerColumn = SPREAD_MAX_PER_COLUMN): GameCard[][] {
  const total = sorted.length;
  if (total <= maxPerColumn) return total > 0 ? [sorted] : [];

  const numColumns = Math.ceil(total / maxPerColumn);
  const target = Math.ceil(total / numColumns);

  const columns: GameCard[][] = [];
  let current: GameCard[] = [];

  for (const run of runsOf(sorted)) {
    const qty = run.cards.length;
    if (current.length + qty > target && current.length > 0) {
      const distanceWithout = Math.abs(current.length - target);
      const distanceWith = Math.abs(current.length + qty - target);
      if (distanceWith > distanceWithout) {
        columns.push(current);
        current = [...run.cards];
      } else {
        current.push(...run.cards);
      }
    } else {
      current.push(...run.cards);
    }
  }
  if (current.length > 0) columns.push(current);
  return columns;
}

export interface DeckSpreadLayout {
  /** Column by column, top to bottom. Append in this order so later cards paint on top. */
  orderedIds: string[];
  positions: Record<string, { posX: number; posY: number }>;
}

export function computeDeckSpreadLayout(
  cards: GameCard[],
  zone: ZoneRect,
  cardWidth: number,
  cardHeight: number,
): DeckSpreadLayout {
  const buckets = new Map<string, GameCard[]>();
  for (const card of cards) {
    const key = spreadBucketKey(card.type);
    const list = buckets.get(key);
    if (list) list.push(card);
    else buckets.set(key, [card]);
  }

  const columns: GameCard[][] = [];
  for (const key of [...buckets.keys()].sort(compareTypeGroups)) {
    const sorted = [...buckets.get(key)!].sort((a, b) =>
      compareCardsByType(toSortable(a), toSortable(b)),
    );
    columns.push(...splitIntoColumns(sorted));
  }

  const orderedIds: string[] = [];
  const positions: DeckSpreadLayout['positions'] = {};
  if (columns.length === 0) return { orderedIds, positions };

  const availW = zone.width - EDGE_PAD * 2;
  const availH = zone.height - TOP_PAD - EDGE_PAD;
  const maxLen = Math.max(...columns.map((c) => c.length));

  const defaultPitch = cardWidth + Math.round(cardWidth * SPREAD_GAP_RATIO);
  const pitch = columns.length > 1
    ? Math.max(0, Math.min(defaultPitch, (availW - cardWidth) / (columns.length - 1)))
    : defaultPitch;

  const defaultStrip = Math.round(cardHeight * SPREAD_STRIP_RATIO);
  const strip = maxLen > 1
    ? Math.max(0, Math.min(defaultStrip, (availH - cardHeight) / (maxLen - 1)))
    : defaultStrip;

  const x0 = zone.x + EDGE_PAD;
  const y0 = zone.y + TOP_PAD;

  columns.forEach((column, col) => {
    column.forEach((card, row) => {
      orderedIds.push(card.instanceId);
      positions[card.instanceId] = { posX: x0 + col * pitch, posY: y0 + row * strip };
    });
  });

  return { orderedIds, positions };
}

function toSortable(card: GameCard) {
  return {
    name: card.cardName,
    type: card.type,
    brigade: card.brigade,
    alignment: card.alignment,
    strength: card.strength,
    toughness: card.toughness,
    reference: card.reference,
  };
}
