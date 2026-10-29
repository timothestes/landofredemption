// Client-safe: only erased type imports and lib/formats, nothing that loads the card catalog.
import type { DeckRowKind } from './deckClassify';
import type { GROUP_ORIENTATIONS } from './deckSchema';
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

/** The group that defaults to Reserve, or null (spec: Groups and zones). */
export function defaultReserveGroup(groups: GroupSize[]): string | null {
  if (groups.length < 2) return null;
  const sideways = groups.filter(g => g.orientation !== 'upright');
  const cand = sideways.length === 1 ? sideways[0] : groups[groups.length - 1];
  const others = groups.filter(g => g !== cand).reduce((n, g) => n + g.count, 0);
  if (others < FORMATS.Limited.main.min) return null;
  const max = FORMATS[impliedFamily(others) === 'T2' ? 'T2' : 'Limited'].reserveMax;
  return cand.count <= max ? cand.key : null;
}
