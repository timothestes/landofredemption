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
  /** Queued behind a busy auto-retry. */
  busy?: boolean;
}

export interface TraySource {
  id: string;
  photoId: string;
  chosenKey: string | null;
  status: ScanDetectionView['status'];
  candidateKeys: string[];
  detection: ScanDetectionView;
}

export interface TrayRow {
  rowId: string;
  photoId: string;
  sources: TraySource[];
  detection: ScanDetectionView;
  key: string | null;
  candidates: Candidate[];
  qty: number;
  corrected: 'none' | 'printing' | 'name';
  /** The player picked this row's card in the picker, even if it was our guess: a Check row stops asking. */
  confirmed?: boolean;
  removedAs: 'wrong' | 'unwanted' | null;
}

export interface TrayState {
  userId: string;
  photos: TrayPhoto[];
  rows: TrayRow[];
  phase: 'editing' | 'committing' | 'committed';
  /**
   * Set from the first commit attempt until the server answers for certain. While it is set after a
   * failed attempt the save may have gone through, so the tray is locked: an edit sent under the same
   * id would be ignored by the server, and a fresh id could add the cards twice.
   */
  pendingCommitId: string | null;
  committed: { commitId: string; added: number; scanIds: string[]; undone: boolean } | null;
}

export type TrayAction =
  | { type: 'photoAdded'; photoId: string }
  | { type: 'photoStarted'; photoId: string; at: number }
  | { type: 'photoDone'; photoId: string; response: ScanResponse }
  | { type: 'photoFailed'; photoId: string; error: TrayPhoto['error'] }
  | { type: 'photoRemoved'; photoId: string }
  | { type: 'photoRetry'; photoId: string; busy?: boolean }
  | { type: 'setKey'; rowId: string; key: string; candidates?: Candidate[]; via: 'candidates' | 'search' }
  | { type: 'setQty'; rowId: string; qty: number }
  | { type: 'removeRow'; rowId: string; as: 'wrong' | 'unwanted' }
  | { type: 'restoreRow'; rowId: string }
  | { type: 'commitStarted'; commitId: string }
  /** nothingSaved: the server said for certain nothing was added, so the next attempt may use a fresh id. */
  | { type: 'commitFailed'; nothingSaved: boolean }
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

const sourceOf = (det: ScanDetectionView, photoId: string): TraySource => ({
  id: det.id,
  photoId,
  chosenKey: det.chosenKey,
  status: det.status,
  candidateKeys: det.candidates.map(c => c.key),
  detection: det,
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
      return patchPhoto(s, a.photoId, { status: 'reading', startedAt: a.at, error: undefined, busy: undefined });
    case 'photoDone': {
      if (!s.photos.some(p => p.photoId === a.photoId)) return s;
      const done = patchPhoto(s, a.photoId, {
        status: 'done',
        scanId: a.response.scanId,
        photoQuality: a.response.photoQuality,
        error: undefined,
      });
      // A read that lands during or after a commit was not in its payload: never show it as added.
      if (s.phase !== 'editing') return done;
      const rows = s.rows.map(r => ({ ...r }));
      for (const det of [...a.response.detections].sort(gridOrder)) {
        // Only certain reads merge: a Check row's key is a guess, and folding it into another row would hide it.
        const same = det.chosenKey && det.status === 'matched'
          ? rows.find(r => r.removedAs === null && r.key === det.chosenKey && isSettled(r))
          : undefined;
        if (same) {
          same.qty = Math.min(99, same.qty + 1);
          same.sources = [...same.sources, sourceOf(det, a.photoId)];
        } else {
          rows.push({
            rowId: det.id,
            photoId: a.photoId,
            sources: [sourceOf(det, a.photoId)],
            detection: det,
            key: det.chosenKey,
            candidates: det.candidates,
            qty: 1,
            corrected: 'none',
            removedAs: null,
          });
        }
      }
      return { ...done, rows };
    }
    case 'photoFailed':
      return patchPhoto(s, a.photoId, { status: 'failed', error: a.error });
    case 'photoRemoved': {
      const rows: TrayRow[] = [];
      for (const r of s.rows) {
        const kept = r.sources.filter(x => x.photoId !== a.photoId);
        if (kept.length === r.sources.length) rows.push(r);
        else if (kept.length > 0) {
          const first = kept[0];
          const reseat = first.photoId !== r.photoId;
          rows.push({
            ...r,
            sources: kept,
            qty: Math.max(1, r.qty - (r.sources.length - kept.length)),
            photoId: first.photoId,
            detection: reseat ? first.detection : r.detection,
            candidates: reseat && r.corrected === 'none' ? first.detection.candidates : r.candidates,
            corrected: reseat && r.key === first.chosenKey ? 'none' : r.corrected,
          });
        }
      }
      return { ...s, photos: s.photos.filter(p => p.photoId !== a.photoId), rows };
    }
    case 'photoRetry':
      return patchPhoto(s, a.photoId, { status: 'queued', error: undefined, startedAt: undefined, busy: a.busy || undefined });
    case 'setKey':
      return patchRow(s, a.rowId, r => {
        const corrected: TrayRow['corrected'] =
          a.key === r.detection.chosenKey
            ? 'none'
            : a.via === 'candidates' && r.detection.status !== 'not_found'
              ? 'printing'
              : 'name';
        return { ...r, key: a.key, candidates: a.candidates ?? r.candidates, corrected, confirmed: true };
      });
    case 'setQty':
      return patchRow(s, a.rowId, r => ({ ...r, qty: Math.min(99, Math.max(1, Math.round(a.qty) || 1)) }));
    case 'removeRow':
      return patchRow(s, a.rowId, r => ({ ...r, removedAs: a.as }));
    case 'restoreRow':
      return patchRow(s, a.rowId, r => ({ ...r, removedAs: null }));
    case 'commitStarted':
      return { ...s, phase: 'committing', pendingCommitId: a.commitId };
    case 'commitFailed':
      return { ...s, phase: 'editing', pendingCommitId: a.nothingSaved ? null : s.pendingCommitId };
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

/** The tray can be edited: not mid-commit, and no earlier attempt that may have saved. */
export function isEditable(s: TrayState): boolean {
  return s.phase === 'editing' && s.pendingCommitId === null;
}

/** Every read behind the row was certain, or the player picked the card. */
function isSettled(r: TrayRow): boolean {
  return r.confirmed === true || r.corrected !== 'none' || r.sources.every(x => x.status === 'matched');
}

/** A row added on our guess of the printing that the player has not looked at. */
export function needsCheck(r: TrayRow): boolean {
  return r.removedAs === null && r.key !== null && !isSettled(r);
}

export function countedRows(s: TrayState): TrayRow[] {
  return s.rows.filter(r => r.removedAs === null && r.key !== null);
}

/** fallback: the catalog price map, for a search pick made before the map had loaded. */
export function rowPrice(r: TrayRow, fallback?: (key: string) => number | null): number | null {
  const own = r.candidates.find(c => c.key === r.key)?.price ?? null;
  return own ?? (r.key && fallback ? fallback(r.key) : null);
}

export interface TrayTotals {
  cards: number;
  /** Distinct rows the commit would send; the server refuses more than COMMIT_LIMITS.rows. */
  rows: number;
  priced: number;
  unpriced: number;
  /** Rows with no card picked: not added. */
  unresolved: number;
  /** Rows added on a guessed printing the player has not checked. */
  toCheck: number;
}

export function trayTotals(s: TrayState, fallback?: (key: string) => number | null): TrayTotals {
  let cards = 0, priced = 0, unpriced = 0;
  const counted = countedRows(s);
  for (const r of counted) {
    cards += r.qty;
    const p = rowPrice(r, fallback);
    if (p == null) unpriced += r.qty;
    else priced += p * r.qty;
  }
  const unresolved = s.rows.filter(r => r.removedAs === null && r.key === null).length;
  const toCheck = s.rows.filter(needsCheck).length;
  return { cards, rows: counted.length, priced, unpriced, unresolved, toCheck };
}

export function rehydrateTray(raw: unknown, userId: string): TrayState {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!v || typeof v !== 'object') return initialTray(userId);
    const o = v as Partial<TrayState>;
    if (o.userId !== userId || !Array.isArray(o.photos) || !Array.isArray(o.rows)) return initialTray(userId);
    // A tray saved by an older build has a different row shape: start fresh rather than crash on it.
    if (!o.rows.every(r => r && Array.isArray(r.sources) && r.sources.length > 0 && r.detection)) return initialTray(userId);
    const photos = o.photos.map((p): TrayPhoto =>
      p.status === 'queued' || p.status === 'reading'
        ? { ...p, status: 'failed', startedAt: undefined, busy: undefined, error: { status: 0, body: { code: 'lost_on_reload' } } }
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
