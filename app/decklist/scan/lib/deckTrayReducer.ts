import type { QueueAction } from '@/app/collection/scan/hooks/useScanQueue';
import { defaultReserveGroup, mergeDeckRows, type DeckEntry, type DeckRow, type GroupSize } from '@/lib/scan/deck';
import type { DeckScanResponse } from '@/lib/scan/deckClassify';
import type { Candidate, DeckPhoto, DeckTrayState, TrayEntry, Zone } from '../types';

export type DeckTrayAction =
  | QueueAction<DeckScanResponse>
  | { type: 'setCard'; rowKey: string; key: string; candidates?: Candidate[] }
  /** Corrects only the row's first read: one of "3 unread" (or of a Not found ×N) becomes the pick. */
  | { type: 'setCardOne'; rowKey: string; key: string; candidates?: Candidate[] }
  | { type: 'setQty'; rowKey: string; qty: number }
  | { type: 'removeRow'; rowKey: string }
  | { type: 'undoRemove' }
  | { type: 'moveRow'; rowKey: string; zone: Zone }
  | { type: 'setGroupZone'; groupKey: string; zone: Zone }
  | { type: 'addCard'; groupKey: string; key: string; candidates?: Candidate[] }
  | { type: 'setLostSoulPicks'; picks: { key: string; qty: number }[] }
  | { type: 'skipLostSouls' }
  | { type: 'saving' }
  | { type: 'saved'; deckId: string }
  | { type: 'saveFailed' };

export const MAX_QTY = 99;

export type TrayDeckRow = DeckRow & { groupKey: string; zone: Zone };

export const STORAGE_KEY = (userId: string) => `deck-scan-tray:v1:${userId}`;

export function initialDeckTray(userId: string): DeckTrayState {
  return {
    userId, photos: [], entries: [], groupZones: {}, lostSoulPicks: [], lostSoulsSkipped: false,
    lastRemoved: null, addSeq: 0, phase: 'editing', savedDeckId: null,
  };
}

const groupKeyOf = (e: { photoId: string; group: number }) => `${e.photoId}:${e.group}`;

// Same rule as mergeDeckRows' mainOnly (not exported there): Lost Souls and Dominants never go to Reserve.
const isMainOnly = (e: TrayEntry): boolean => {
  const t = (e.type ?? '').toLowerCase();
  return e.kind === 'lost_soul' || t.includes('lost soul') || t.includes('dominant');
};

const effectiveZone = (s: DeckTrayState, e: TrayEntry): Zone =>
  isMainOnly(e) ? 'main' : (e.zone ?? s.groupZones[groupKeyOf(e)] ?? 'main');

/**
 * Derived rows, merged by card and effective zone (a card split across main and Reserve is two rows).
 * A row's `rowKey` is `${zone}|${mergeKey}`; actions resolve it by recomputing this list.
 * `groupKey` is the first entry's group, `${photoId}:${group}`.
 */
export function trayRows(s: DeckTrayState): TrayDeckRow[] {
  const index = new Map(s.photos.map((p, i) => [p.photoId, i]));
  const byId = new Map<string, TrayEntry>();
  const perZone: Record<Zone, DeckEntry[]> = { main: [], reserve: [] };
  for (const e of s.entries) {
    const photo = index.get(e.photoId);
    if (e.removed || photo === undefined) continue;
    byId.set(e.entryId, e);
    perZone[effectiveZone(s, e)].push({
      readId: e.entryId, photo, group: e.group, kind: e.kind, key: e.key, title: e.title,
      identityCandidates: e.identityCandidates, type: e.type,
    });
  }
  const out: TrayDeckRow[] = [];
  for (const zone of ['main', 'reserve'] as Zone[]) {
    for (const row of mergeDeckRows(perZone[zone])) {
      const first = byId.get(row.readIds[0])!;
      const shares: Record<string, number> = {};
      for (const [k, n] of Object.entries(row.shares)) {
        const photo = s.photos[Number(k.slice(0, k.indexOf(':')))];
        shares[`${photo.photoId}${k.slice(k.indexOf(':'))}`] = n;
      }
      out.push({ ...row, rowKey: `${zone}|${row.rowKey}`, shares, zone, groupKey: groupKeyOf(first) });
    }
  }
  return out;
}

export function zoneOf(s: DeckTrayState, row: DeckRow & { groupKey: string }): Zone {
  if (row.mainOnly) return 'main';
  const first = s.entries.find(e => e.entryId === row.readIds[0]);
  return first?.zone ?? s.groupZones[row.groupKey] ?? 'main';
}

const patchPhoto = (s: DeckTrayState, photoId: string, patch: Partial<DeckPhoto>): DeckTrayState => ({
  ...s,
  photos: s.photos.map(p => (p.photoId === photoId ? { ...p, ...patch } : p)),
});

const patchEntries = (s: DeckTrayState, ids: Set<string>, fn: (e: TrayEntry) => TrayEntry): DeckTrayState => ({
  ...s,
  entries: s.entries.map(e => (ids.has(e.entryId) ? fn(e) : e)),
});

const rowEntries = (s: DeckTrayState, rowKey: string) => {
  const row = trayRows(s).find(r => r.rowKey === rowKey);
  if (!row) return null;
  const ids = new Set(row.readIds);
  return { row, ids, entries: s.entries.filter(e => ids.has(e.entryId)) };
};

function addedEntry(s: DeckTrayState, from: Pick<TrayEntry, 'photoId' | 'group' | 'kind' | 'key' | 'title' | 'type'> & Partial<Pick<TrayEntry, 'zone' | 'identityCandidates' | 'near' | 'candidates'>>): TrayEntry {
  const scanId = s.photos.find(p => p.photoId === from.photoId)?.scanId ?? from.photoId;
  const e: TrayEntry = {
    entryId: `${scanId}:add:${s.addSeq}`, photoId: from.photoId, group: from.group, kind: from.kind,
    key: from.key, title: from.title, type: from.type, candidates: from.candidates ?? [], original: null, removed: false,
  };
  // Copied so an added `which` read keeps the row key (`w:<candidates>`) and merges with its row.
  if (from.identityCandidates) e.identityCandidates = from.identityCandidates;
  if (from.near) e.near = from.near;
  if (from.zone) e.zone = from.zone;
  return e;
}

const groupSizes = (s: DeckTrayState): GroupSize[] => {
  const groups: GroupSize[] = [];
  for (const p of s.photos) {
    if (p.status !== 'done') continue;
    const counts = new Map<number, number>();
    for (const e of s.entries) if (e.photoId === p.photoId) counts.set(e.group, (counts.get(e.group) ?? 0) + 1);
    const seen = new Set<number>();
    for (const g of p.groups) {
      seen.add(g.id);
      groups.push({ key: `${p.photoId}:${g.id}`, orientation: g.orientation as GroupSize['orientation'], count: counts.get(g.id) ?? 0 });
    }
    for (const [id, count] of counts) {
      if (!seen.has(id)) groups.push({ key: `${p.photoId}:${id}`, orientation: 'upright', count });
    }
  }
  return groups;
};

/** Zone defaults the first time the deck has two or more groups. */
function withDefaultZones(before: DeckTrayState, after: DeckTrayState): DeckTrayState {
  const groups = groupSizes(after);
  if (groupSizes(before).length >= 2 || groups.length < 2) return after;
  const reserve = defaultReserveGroup(groups);
  const groupZones = { ...after.groupZones };
  for (const g of groups) if (!(g.key in groupZones)) groupZones[g.key] = g.key === reserve ? 'reserve' : 'main';
  return { ...after, groupZones };
}

export function deckTrayReducer(s: DeckTrayState, a: DeckTrayAction): DeckTrayState {
  switch (a.type) {
    case 'photoAdded': {
      if (s.photos.some(p => p.photoId === a.photoId)) return s;
      const n = s.photos.reduce((m, p) => Math.max(m, p.n), 0) + 1;
      return { ...s, photos: [...s.photos, { photoId: a.photoId, n, status: 'queued', groups: [] }] };
    }
    case 'photoStarted':
      return patchPhoto(s, a.photoId, { status: 'reading', startedAt: a.at, error: undefined, busy: undefined });
    case 'photoDone': {
      if (!s.photos.some(p => p.photoId === a.photoId)) return s;
      const r = a.response;
      const done = patchPhoto(s, a.photoId, {
        status: 'done', scanId: r.scanId, photoQuality: r.photoQuality, error: undefined,
        groups: r.groups.map(g => ({ id: g.id, orientation: g.orientation, bbox: g.bbox, cardCount: g.cardCount })),
      });
      // A read that lands while saving was not in the saved deck: do not add it to the tray.
      if (s.phase !== 'editing') return done;
      const have = new Set(s.entries.map(e => e.entryId));
      const fresh: TrayEntry[] = r.detections.filter(d => !have.has(d.id)).map(d => {
        const e: TrayEntry = {
          entryId: d.id, photoId: a.photoId, group: d.group, kind: d.kind, key: d.deckKey,
          title: d.read.title, type: d.read.type, candidates: d.candidates,
          original: { kind: d.kind, key: d.deckKey }, removed: false,
        };
        if (d.identityCandidates) e.identityCandidates = d.identityCandidates;
        if (d.near) e.near = d.near;
        return e;
      });
      return withDefaultZones(s, { ...done, entries: [...done.entries, ...fresh] });
    }
    case 'photoFailed':
      return patchPhoto(s, a.photoId, { status: 'failed', error: a.error });
    case 'photoRemoved': {
      const prefix = `${a.photoId}:`;
      const groupZones: Record<string, Zone> = {};
      for (const [k, z] of Object.entries(s.groupZones)) if (!k.startsWith(prefix)) groupZones[k] = z;
      const gone = new Set(s.entries.filter(e => e.photoId === a.photoId).map(e => e.entryId));
      const lastRemoved = s.lastRemoved
        ? { entryIds: s.lastRemoved.entryIds.filter(id => !gone.has(id)) }
        : null;
      return {
        ...s,
        photos: s.photos.filter(p => p.photoId !== a.photoId),
        entries: s.entries.filter(e => e.photoId !== a.photoId),
        groupZones,
        lastRemoved: lastRemoved && lastRemoved.entryIds.length > 0 ? lastRemoved : null,
      };
    }
    case 'photoRetry':
      return patchPhoto(s, a.photoId, { status: 'queued', error: undefined, startedAt: undefined, busy: a.busy || undefined });
    case 'setCard': {
      const r = rowEntries(s, a.rowKey);
      if (!r) return s;
      return patchEntries(s, r.ids, e => ({ ...e, kind: 'matched', key: a.key, ...(a.candidates ? { candidates: a.candidates } : {}) }));
    }
    case 'setCardOne': {
      const r = rowEntries(s, a.rowKey);
      if (!r) return s;
      return patchEntries(s, new Set([r.row.readIds[0]]), e => ({ ...e, kind: 'matched', key: a.key, ...(a.candidates ? { candidates: a.candidates } : {}) }));
    }
    case 'setQty': {
      const r = rowEntries(s, a.rowKey);
      if (!r) return s;
      if (!Number.isFinite(a.qty)) return s;
      const n = Math.min(MAX_QTY, Math.max(0, Math.round(a.qty)));
      const q = r.entries.length;
      if (n === q) return s;
      if (n < q) {
        const drop = new Set(r.entries.slice(n).map(e => e.entryId));
        return patchEntries(s, drop, e => ({ ...e, removed: true }));
      }
      let next = s;
      for (let i = q; i < n; i++) {
        next = { ...next, entries: [...next.entries, addedEntry(next, r.entries[0])], addSeq: next.addSeq + 1 };
      }
      return next;
    }
    case 'removeRow': {
      const r = rowEntries(s, a.rowKey);
      if (!r) return s;
      return { ...patchEntries(s, r.ids, e => ({ ...e, removed: true })), lastRemoved: { entryIds: [...r.ids] } };
    }
    case 'undoRemove': {
      if (!s.lastRemoved) return s;
      return { ...patchEntries(s, new Set(s.lastRemoved.entryIds), e => ({ ...e, removed: false })), lastRemoved: null };
    }
    case 'moveRow': {
      const r = rowEntries(s, a.rowKey);
      if (!r) return s;
      return patchEntries(s, r.ids, e => ({ ...e, zone: a.zone }));
    }
    case 'setGroupZone':
      return { ...s, groupZones: { ...s.groupZones, [a.groupKey]: a.zone } };
    case 'addCard': {
      const i = a.groupKey.lastIndexOf(':');
      const photoId = a.groupKey.slice(0, i);
      const group = Number(a.groupKey.slice(i + 1));
      if (!s.photos.some(p => p.photoId === photoId) || !Number.isFinite(group)) return s;
      const e = addedEntry(s, { photoId, group, kind: 'matched', key: a.key, title: null, type: '', candidates: a.candidates });
      return { ...s, entries: [...s.entries, e], addSeq: s.addSeq + 1 };
    }
    case 'setLostSoulPicks':
      return { ...s, lostSoulPicks: a.picks, lostSoulsSkipped: false };
    case 'skipLostSouls':
      return { ...s, lostSoulPicks: [], lostSoulsSkipped: true };
    case 'saving':
      return { ...s, phase: 'saving' };
    case 'saved':
      return { ...s, phase: 'saved', savedDeckId: a.deckId };
    case 'saveFailed':
      return { ...s, phase: 'editing' };
  }
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');

const KINDS = ['matched', 'which', 'read_as', 'not_found', 'unread', 'lost_soul'];

function cleanEntry(e: unknown): TrayEntry | null {
  if (!(isObj(e) && typeof e.entryId === 'string' && typeof e.photoId === 'string' && Number.isFinite(e.group) &&
    KINDS.includes(e.kind) && (e.key === null || typeof e.key === 'string') &&
    (e.title === null || typeof e.title === 'string') && typeof e.type === 'string' && typeof e.removed === 'boolean' &&
    (e.original === null || (isObj(e.original) && typeof e.original.kind === 'string')) &&
    (e.identityCandidates === undefined || isStrArr(e.identityCandidates)))) return null;
  const out = { ...e } as TrayEntry;
  out.candidates = Array.isArray(e.candidates) ? e.candidates : [];
  if (e.near !== undefined && !Array.isArray(e.near)) delete out.near;
  if (e.zone !== 'main' && e.zone !== 'reserve') delete out.zone;
  return out;
}

const validGroup = (g: unknown): boolean =>
  isObj(g) && Number.isFinite(g.id) && typeof g.orientation === 'string' &&
  Array.isArray(g.bbox) && g.bbox.length === 4 && g.bbox.every((n: unknown) => Number.isFinite(n)) &&
  Number.isFinite(g.cardCount);

function cleanPhoto(p: unknown): DeckPhoto | null {
  if (!(isObj(p) && typeof p.photoId === 'string' && typeof p.n === 'number' &&
    ['queued', 'reading', 'done', 'failed'].includes(p.status) && Array.isArray(p.groups))) return null;
  return { ...p, groups: p.groups.filter(validGroup) } as DeckPhoto;
}

export function restoreDeckTray(raw: unknown, userId: string): DeckTrayState {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!isObj(v) || v.userId !== userId) return initialDeckTray(userId);
    const photos = (Array.isArray(v.photos) ? v.photos : []).map(cleanPhoto).filter((p): p is DeckPhoto => p !== null).map((p): DeckPhoto =>
      p.status === 'queued' || p.status === 'reading'
        ? { ...p, status: 'failed', startedAt: undefined, busy: undefined, error: { status: 0, body: { code: 'lost_on_reload' } } }
        : p,
    );
    const ids = new Set(photos.map(p => p.photoId));
    const entries = (Array.isArray(v.entries) ? v.entries : []).map(cleanEntry).filter((e): e is TrayEntry => e !== null && ids.has(e.photoId));
    const groupZones: Record<string, Zone> = {};
    if (isObj(v.groupZones)) {
      for (const [k, z] of Object.entries(v.groupZones)) if ((z === 'main' || z === 'reserve') && ids.has(k.slice(0, k.lastIndexOf(':')))) groupZones[k] = z;
    }
    const picks = (Array.isArray(v.lostSoulPicks) ? v.lostSoulPicks : [])
      .filter((p: unknown) => isObj(p) && typeof p.key === 'string' && typeof p.qty === 'number');
    const entryIds = new Set(entries.map(e => e.entryId));
    const lastIds = isObj(v.lastRemoved) && Array.isArray(v.lastRemoved.entryIds)
      ? v.lastRemoved.entryIds.filter((id: unknown) => typeof id === 'string' && entryIds.has(id))
      : [];
    return {
      userId, photos, entries, groupZones, lostSoulPicks: picks,
      lostSoulsSkipped: v.lostSoulsSkipped === true,
      lastRemoved: lastIds.length > 0 ? { entryIds: lastIds } : null,
      addSeq: typeof v.addSeq === 'number' ? v.addSeq : 0,
      // A save in flight when the page went away may or may not have gone through: reopen for editing.
      phase: v.phase === 'saved' && typeof v.savedDeckId === 'string' ? 'saved' : 'editing',
      savedDeckId: v.phase === 'saved' && typeof v.savedDeckId === 'string' ? v.savedDeckId : null,
    };
  } catch {
    return initialDeckTray(userId);
  }
}
