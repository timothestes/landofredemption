import { impliedFamily } from '@/lib/scan/deck';
import { DECK_COPY } from '../copy';
import { trayRows } from './deckTrayReducer';
import type { DeckTrayState, Zone } from '../types';

export type SaveRow = { card_name: string; card_set: string; card_img_file: string; quantity: number; zone: Zone };

export interface DeckOutcome {
  id: string;
  finalKey: string | null;
  nameChanged: boolean;
  printingChanged: boolean;
  removed: boolean;
  unresolved: boolean;
  zone: Zone | null;
  lostSoulPick: boolean;
}

const MAX_QTY = 99;
const RESOLVED = ['matched', 'which', 'read_as'];

/** `name|set|imgFile`, split on the last two pipes. */
function splitKey(key: string): { card_name: string; card_set: string; card_img_file: string } | null {
  const b = key.lastIndexOf('|');
  const a = b > 0 ? key.lastIndexOf('|', b - 1) : -1;
  if (a < 1) return null;
  return { card_name: key.slice(0, a), card_set: key.slice(a + 1, b), card_img_file: key.slice(b + 1) };
}

/** The deck as it will be saved: resolved rows plus Lost Soul picks, summed per card and zone. */
export function saveRows(s: DeckTrayState): SaveRow[] {
  const out = new Map<string, SaveRow>();
  const add = (key: string, qty: number, zone: Zone) => {
    const parts = splitKey(key);
    if (!parts || qty < 1) return;
    const k = `${zone}|${key}`;
    const row = out.get(k);
    if (row) row.quantity = Math.min(MAX_QTY, row.quantity + qty);
    else out.set(k, { ...parts, quantity: Math.min(MAX_QTY, qty), zone });
  };
  for (const r of trayRows(s)) {
    if (RESOLVED.includes(r.kind) && r.key) add(r.key, r.quantity, r.mainOnly ? 'main' : r.zone);
  }
  for (const p of s.lostSoulPicks) add(p.key, Math.round(p.qty), 'main');
  return [...out.values()];
}

const stem = (key: string): string => key.split('|')[0].replace(/\s*\([^)]*\)\s*$/, '');

/** One outcome per read (kept, changed or removed), added card and Lost Soul pick, keyed by scan id. */
export function deckOutcomes(s: DeckTrayState): Record<string, DeckOutcome[]> {
  const zones = new Map<string, Zone>();
  for (const r of trayRows(s)) for (const id of r.readIds) zones.set(id, r.mainOnly ? 'main' : r.zone);
  const out: Record<string, DeckOutcome[]> = {};
  const push = (id: string, o: Omit<DeckOutcome, 'id'>) => {
    (out[id.slice(0, id.indexOf(':'))] ??= []).push({ id, ...o });
  };
  for (const e of s.entries) {
    const finalKey = !e.removed && RESOLVED.includes(e.kind) ? e.key : null;
    const changed = !e.removed && e.original !== null && finalKey !== e.original.key;
    const printingChanged = changed && finalKey !== null && e.original!.key !== null && stem(finalKey) === stem(e.original!.key);
    push(e.entryId, {
      finalKey,
      printingChanged,
      nameChanged: changed && !printingChanged,
      removed: e.removed,
      // A Lost Soul placeholder is replaced by picks, not left out.
      unresolved: !e.removed && finalKey === null && e.kind !== 'lost_soul',
      zone: e.removed ? null : zones.get(e.entryId) ?? 'main',
      lostSoulPick: false,
    });
  }
  const scanId = s.photos.find(p => p.scanId)?.scanId;
  if (scanId) {
    s.lostSoulPicks.forEach((p, n) => push(`${scanId}:ls:${n}`, {
      finalKey: p.key, nameChanged: false, printingChanged: false, removed: false, unresolved: false, zone: 'main', lostSoulPick: true,
    }));
  }
  return out;
}

export function totals(s: DeckTrayState): { main: number; reserve: number; lostSoulsToPick: number; unread: number; toCheck: number; leftOut: number } {
  const t = { main: 0, reserve: 0, lostSoulsToPick: 0, unread: 0, toCheck: 0, leftOut: 0 };
  for (const r of saveRows(s)) t[r.zone] += r.quantity;
  let placeholders = 0;
  for (const r of trayRows(s)) {
    if (r.kind === 'lost_soul') placeholders += r.quantity;
    if (['which', 'read_as', 'not_found', 'unread'].includes(r.kind)) t.toCheck += 1;
    if (r.kind === 'unread') t.unread += r.quantity;
    if (r.kind === 'not_found' || r.kind === 'unread') t.leftOut += r.quantity;
  }
  const picked = s.lostSoulPicks.reduce((n, p) => n + p.qty, 0);
  t.lostSoulsToPick = s.lostSoulsSkipped ? 0 : Math.max(0, placeholders - picked);
  return t;
}

export const deckFormat = (mainTotal: number): 'Type 1' | 'Type 2' => (impliedFamily(mainTotal) === 'T2' ? 'Type 2' : 'Type 1');

export const deckName = (now: Date): string =>
  DECK_COPY.deckName.replace('{Mon D}', now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
