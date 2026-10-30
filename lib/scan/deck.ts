// Client-safe: only erased type imports and lib/formats, nothing that loads the card catalog.
import type { DeckRowKind } from './deckClassify';
import type { Box, GROUP_ORIENTATIONS } from './deckSchema';
import { FORMATS } from '@/lib/formats';

/** Copy of normalizeTitle in vocab.ts (that module loads the catalog). */
function normalizeTitle(s: string | null | undefined): string {
  if (!s) return '';
  return s.toLowerCase().replace(/[‘’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** One classified read. `photo` is the tray photo index; `readId` is `${scanId}:${i}`. */
export interface DeckEntry {
  readId: string;
  photo: number;
  group: number;
  kind: DeckRowKind;
  key: string | null;
  title: string | null;
  identityCandidates?: string[];
  type: string;
}

/** A merged decklist row; `shares` is keyed `${photo}:${group}`. */
export interface DeckRow {
  rowKey: string;
  kind: DeckRowKind;
  key: string | null;
  title: string | null;
  identityCandidates?: string[];
  quantity: number;
  shares: Record<string, number>;
  readIds: string[];
  mainOnly: boolean;
}

export interface GroupSize {
  key: string;
  orientation: (typeof GROUP_ORIENTATIONS)[number];
  count: number;
  /** The group's box in the photo; when every group has one, the layout picks the Reserve. */
  bbox?: Box;
  /** Reads matched to a card (matched, which, read as); a group off the main band with none is not a Reserve. */
  identified?: number;
}

/** The merge key: reads with equal keys become one row. */
export function rowKeyOf(e: DeckEntry): string {
  switch (e.kind) {
    case 'matched': return `m:${e.key}`;
    case 'read_as': return `r:${e.key}`;
    case 'which': return `w:${[...(e.identityCandidates ?? [])].sort().join(',')}`;
    case 'not_found': return `n:${normalizeTitle(e.title)}`;
    case 'unread': return `u:${e.photo}:${e.group}`;
    case 'lost_soul': return `l:${e.photo}:${e.group}`;
  }
}

const isMainOnly = (e: DeckEntry): boolean => {
  const t = (e.type ?? '').toLowerCase();
  return e.kind === 'lost_soul' || t.includes('lost soul') || t.includes('dominant');
};

/** Merge reads into rows in first-seen order; quantity counts reads, shares count per group. */
export function mergeDeckRows(entries: DeckEntry[]): DeckRow[] {
  const rows = new Map<string, DeckRow>();
  for (const e of entries) {
    const rowKey = rowKeyOf(e);
    let row = rows.get(rowKey);
    if (!row) {
      row = { rowKey, kind: e.kind, key: e.key, title: e.title, quantity: 0, shares: {}, readIds: [], mainOnly: false };
      if (e.identityCandidates) row.identityCandidates = e.identityCandidates;
      rows.set(rowKey, row);
    }
    const share = `${e.photo}:${e.group}`;
    row.quantity += 1;
    row.shares[share] = (row.shares[share] ?? 0) + 1;
    row.readIds.push(e.readId);
    if (isMainOnly(e)) row.mainOnly = true;
  }
  return [...rows.values()];
}

/** Type 2 when the main total falls in the T2 main range, else Type 1. */
export function impliedFamily(mainTotal: number): 'T1' | 'T2' {
  return mainTotal >= FORMATS.T2.main.min && mainTotal <= FORMATS.T2.main.max ? 'T2' : 'T1';
}

/** Tops of side-by-side columns within this much (of the photo's height) chain into one band; a tilted photo drifts gradually. */
export const BAND_TOP_TOL = 0.06;
/** Groups this close side by side (of the photo's width) are neighbours. */
export const BAND_GAP = 0.05;

/** Row kinds that name a card: what `GroupSize.identified` counts. */
export const IDENTIFIED_KINDS: ReadonlySet<DeckRowKind> = new Set<DeckRowKind>(['matched', 'which', 'read_as']);

const isSynthetic = (g: GroupSize) => g.key.split(':')[1] === '0';
const total = (gs: GroupSize[]) => gs.reduce((n, g) => n + g.count, 0);

/** Whether these groups can be the Reserve: the rest makes a main deck and they fit its family's reserve. */
function fitsReserve(set: GroupSize[], all: GroupSize[]): boolean {
  const rest = total(all) - total(set);
  if (rest < FORMATS.Limited.main.min) return false;
  return total(set) <= FORMATS[impliedFamily(rest) === 'T2' ? 'T2' : 'Limited'].reserveMax;
}

/** The only sideways group, else the last group, when it fits (the rule before group boxes). */
function lastGroupReserve(cands: GroupSize[], all: GroupSize[]): string[] {
  const sideways = cands.filter(g => g.orientation !== 'upright');
  const cand = sideways.length === 1 ? sideways[0] : cands[cands.length - 1];
  return cand && fitsReserve([cand], all) ? [cand.key] : [];
}

/** Merges groups into connected sets under `linked`, in the order the groups came. */
function components(gs: GroupSize[], linked: (a: Box, b: Box) => boolean): GroupSize[][] {
  let sets: GroupSize[][] = [];
  for (const g of gs) {
    const hit = sets.filter(set => set.some(x => linked(g.bbox!, x.bbox!)));
    sets = [...sets.filter(set => !hit.includes(set)), [g, ...hit.flat()]];
  }
  return sets.map(set => gs.filter(g => set.includes(g)));
}

const xGap = (a: Box, b: Box) => Math.max(a[0], b[0]) - Math.min(a[2], b[2]);
/** Side by side, not stacked: close in x, overlapping under half the narrower, tops within BAND_TOP_TOL. */
const sideBySide = (a: Box, b: Box) =>
  xGap(a, b) <= BAND_GAP && -xGap(a, b) < 0.5 * Math.min(a[2] - a[0], b[2] - b[0]) && Math.abs(a[1] - b[1]) <= BAND_TOP_TOL;
/** One row: overlapping in y by over half the shorter, and close in x. */
const sameRow = (a: Box, b: Box) =>
  Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.5 * Math.min(a[3] - a[1], b[3] - b[1]) && xGap(a, b) <= BAND_GAP;

/**
 * The groups that default to Reserve, or none (spec: Groups and zones). From one photo with every group's box: the main deck
 * is the band of side-by-side columns holding the most cards; the Reserve is a row off that band (the largest that fits),
 * else one group off it (the last that fits), else the last-group rule over the band and the groups off it that read a card.
 * A row off the band that read no card (tokens, art cards, a Lost Soul row) is never Reserve. Without boxes, or across photos,
 * the last-group rule.
 */
export function defaultReserveGroups(groups: GroupSize[]): string[] {
  if (groups.length < 2) return [];
  // Group 0 is the synthetic orphan group (model ids are >= 1): it counts toward the rest but is never Reserve.
  const real = groups.filter(g => !isSynthetic(g));
  const onePhoto = new Set(real.map(g => g.key.split(':')[0])).size === 1;
  if (!onePhoto || !real.every(g => g.bbox)) return lastGroupReserve(real, groups);

  const band = components(real, sideBySide).reduce((a, b) => (total(b) > total(a) ? b : a));
  const off = real.filter(g => !band.includes(g));
  const read = (set: GroupSize[]) => set.some(g => (g.identified ?? 1) > 0);
  const ok = (set: GroupSize[]) => read(set) && fitsReserve(set, groups);

  // In reading order by each row's last group, so of two rows the same size the later wins.
  const rows = components(off, sameRow).filter(ok).sort((a, b) => off.indexOf(a[a.length - 1]) - off.indexOf(b[b.length - 1]));
  if (rows.length > 0) return rows.reduce((a, b) => (total(b) >= total(a) ? b : a)).map(g => g.key);
  const singles = off.filter(g => ok([g]));
  if (singles.length > 0) return [singles[singles.length - 1].key];
  return lastGroupReserve(real.filter(g => band.includes(g) || read([g])), groups);
}
