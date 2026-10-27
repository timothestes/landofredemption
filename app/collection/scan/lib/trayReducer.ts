import type { Candidate, ScanDetectionView, ScanErrorBody, ScanResponse } from '../types';

export type PhotoStatus = 'queued' | 'reading' | 'done' | 'failed';

export interface TrayPhoto {
  photoId: string;
  n: number;
  status: PhotoStatus;
  scanId?: string;
  photoQuality?: string;
  error?: { status: number; body: ScanErrorBody; retryAfter?: number };
  startedAt?: number;
}

export interface TrayRow {
  rowId: string;
  photoId: string;
  detectionIds: string[];
  detection: ScanDetectionView;
  key: string | null;
  candidates: Candidate[];
  qty: number;
  corrected: 'none' | 'printing' | 'name';
  removedAs: 'wrong' | 'unwanted' | null;
}

export interface TrayState {
  userId: string;
  photos: TrayPhoto[];
  rows: TrayRow[];
  phase: 'editing' | 'committing' | 'committed';
  pendingCommitId: string | null;
  committed: { commitId: string; added: number; scanIds: string[]; undone: boolean } | null;
}

export type TrayAction =
  | { type: 'photoAdded'; photoId: string }
  | { type: 'photoStarted'; photoId: string; at: number }
  | { type: 'photoDone'; photoId: string; response: ScanResponse }
  | { type: 'photoFailed'; photoId: string; error: TrayPhoto['error'] }
  | { type: 'photoRemoved'; photoId: string }
  | { type: 'photoRetry'; photoId: string }
  | { type: 'setKey'; rowId: string; key: string; candidates?: Candidate[]; via: 'candidates' | 'search' }
  | { type: 'setQty'; rowId: string; qty: number }
  | { type: 'removeRow'; rowId: string; as: 'wrong' | 'unwanted' }
  | { type: 'commitStarted'; commitId: string }
  | { type: 'commitFailed' }
  | { type: 'commitDone'; commitId: string; added: number; scanIds: string[] }
  | { type: 'undoDone' }
  | { type: 'scanMore' }
  | { type: 'rehydrate'; state: TrayState };

export function initialTray(userId: string): TrayState {
  return { userId, photos: [], rows: [], phase: 'editing', pendingCommitId: null, committed: null };
}

const patchPhoto = (s: TrayState, photoId: string, patch: Partial<TrayPhoto>): TrayState => ({
  ...s,
  photos: s.photos.map(p => (p.photoId === photoId ? { ...p, ...patch } : p)),
});

const patchRow = (s: TrayState, rowId: string, fn: (r: TrayRow) => TrayRow): TrayState => ({
  ...s,
  rows: s.rows.map(r => (r.rowId === rowId ? fn(r) : r)),
});

const gridOrder = (a: ScanDetectionView, b: ScanDetectionView) =>
  a.grid.row - b.grid.row || a.grid.col - b.grid.col;

export function trayReducer(s: TrayState, a: TrayAction): TrayState {
  switch (a.type) {
    case 'photoAdded': {
      if (s.photos.some(p => p.photoId === a.photoId)) return s;
      const n = s.photos.reduce((m, p) => Math.max(m, p.n), 0) + 1;
      return { ...s, photos: [...s.photos, { photoId: a.photoId, n, status: 'queued' }] };
    }
    case 'photoStarted':
      return patchPhoto(s, a.photoId, { status: 'reading', startedAt: a.at, error: undefined });
    case 'photoDone': {
      if (!s.photos.some(p => p.photoId === a.photoId)) return s;
      let rows = s.rows.map(r => ({ ...r }));
      for (const det of [...a.response.detections].sort(gridOrder)) {
        const same = det.chosenKey
          ? rows.find(r => r.removedAs === null && r.key === det.chosenKey)
          : undefined;
        if (same) {
          same.qty = Math.min(99, same.qty + 1);
          same.detectionIds = [...same.detectionIds, det.id];
        } else {
          rows.push({
            rowId: det.id,
            photoId: a.photoId,
            detectionIds: [det.id],
            detection: det,
            key: det.chosenKey,
            candidates: det.candidates,
            qty: 1,
            corrected: 'none',
            removedAs: null,
          });
        }
      }
      const done = patchPhoto(s, a.photoId, {
        status: 'done',
        scanId: a.response.scanId,
        photoQuality: a.response.photoQuality,
        error: undefined,
      });
      return { ...done, rows };
    }
    case 'photoFailed':
      return patchPhoto(s, a.photoId, { status: 'failed', error: a.error });
    case 'photoRemoved':
      return {
        ...s,
        photos: s.photos.filter(p => p.photoId !== a.photoId),
        rows: s.rows.filter(r => r.photoId !== a.photoId),
      };
    case 'photoRetry':
      return patchPhoto(s, a.photoId, { status: 'queued', error: undefined, startedAt: undefined });
    case 'setKey':
      return patchRow(s, a.rowId, r => {
        const corrected: TrayRow['corrected'] =
          a.key === r.detection.chosenKey
            ? 'none'
            : a.via === 'candidates' && r.detection.status !== 'not_found'
              ? 'printing'
              : 'name';
        return { ...r, key: a.key, candidates: a.candidates ?? r.candidates, corrected };
      });
    case 'setQty':
      return patchRow(s, a.rowId, r => ({ ...r, qty: Math.min(99, Math.max(1, Math.round(a.qty) || 1)) }));
    case 'removeRow':
      return patchRow(s, a.rowId, r => ({ ...r, removedAs: a.as }));
    case 'commitStarted':
      return { ...s, phase: 'committing', pendingCommitId: a.commitId };
    case 'commitFailed':
      return { ...s, phase: 'editing' };
    case 'commitDone':
      return {
        ...s,
        phase: 'committed',
        pendingCommitId: null,
        committed: { commitId: a.commitId, added: a.added, scanIds: a.scanIds, undone: false },
      };
    case 'undoDone':
      return {
        ...s,
        phase: 'editing',
        pendingCommitId: null,
        committed: s.committed ? { ...s.committed, undone: true } : s.committed,
      };
    case 'scanMore':
      return initialTray(s.userId);
    case 'rehydrate':
      return a.state;
  }
}

export function countedRows(s: TrayState): TrayRow[] {
  return s.rows.filter(r => r.removedAs === null && r.key !== null);
}

export function rowPrice(r: TrayRow): number | null {
  return r.candidates.find(c => c.key === r.key)?.price ?? null;
}

export function trayTotals(s: TrayState): { cards: number; priced: number; unpriced: number; unresolved: number } {
  let cards = 0, priced = 0, unpriced = 0;
  for (const r of countedRows(s)) {
    cards += r.qty;
    const p = rowPrice(r);
    if (p == null) unpriced += r.qty;
    else priced += p * r.qty;
  }
  const unresolved = s.rows.filter(r => r.removedAs === null && r.key === null).length;
  return { cards, priced, unpriced, unresolved };
}

export function rehydrateTray(raw: unknown, userId: string): TrayState {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!v || typeof v !== 'object') return initialTray(userId);
    const o = v as Partial<TrayState>;
    if (o.userId !== userId || !Array.isArray(o.photos) || !Array.isArray(o.rows)) return initialTray(userId);
    const photos = o.photos.map((p): TrayPhoto =>
      p.status === 'queued' || p.status === 'reading'
        ? { ...p, status: 'failed', startedAt: undefined, error: { status: 0, body: { code: 'lost_on_reload' } } }
        : p,
    );
    return {
      userId,
      photos,
      rows: o.rows,
      phase: o.phase === 'committing' || o.phase === 'committed' ? o.phase : 'editing',
      pendingCommitId: o.pendingCommitId ?? null,
      committed: o.committed ?? null,
    };
  } catch {
    return initialTray(userId);
  }
}
