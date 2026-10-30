import type { Candidate, ScanErrorBody } from '@/app/collection/scan/types';
import type { DeckRowKind } from '@/lib/scan/deckClassify';

export type { DeckScanResponse, DeckDetection, DeckRowKind } from '@/lib/scan/deckClassify';
export type { DeckEntry, DeckRow, GroupSize } from '@/lib/scan/deck';
export type { Candidate, ScanErrorBody };

export type Zone = 'main' | 'reserve';

export interface DeckPhoto {
  photoId: string;
  n: number;
  status: 'queued' | 'reading' | 'done' | 'failed';
  scanId?: string;
  photoQuality?: string;
  /** Long edge of the image the scanner read, in px; under SMALL_PHOTO_EDGE the done line says so. */
  longEdge?: number;
  error?: { status: number; body: ScanErrorBody; retryAfter?: number };
  startedAt?: number;
  /** Queued behind a busy auto-retry. */
  busy?: boolean;
  groups: { id: number; orientation: string; bbox: [number, number, number, number]; cardCount: number }[];
}

export interface TrayEntry {
  /** The read's id, or `${scanId}:add:${n}` for a card the player added. */
  entryId: string;
  photoId: string;
  group: number;
  kind: DeckRowKind;
  key: string | null;
  title: string | null;
  type: string;
  identityCandidates?: string[];
  near?: { stem: string; d: number }[];
  candidates: Candidate[];
  /** What the scan said; null for an added card. */
  original: { kind: DeckRowKind; key: string | null } | null;
  removed: boolean;
  /** Row-level zone override. */
  zone?: Zone;
}

export interface DeckTrayState {
  userId: string;
  photos: DeckPhoto[];
  entries: TrayEntry[];
  /** Keyed `${photoId}:${group}`. */
  groupZones: Record<string, Zone>;
  lostSoulPicks: { key: string; qty: number }[];
  lostSoulsSkipped: boolean;
  lastRemoved: { entryIds: string[] } | null;
  addSeq: number;
  phase: 'editing' | 'saving' | 'saved';
  savedDeckId: string | null;
}
