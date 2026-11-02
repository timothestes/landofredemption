import type { Candidate, NameReason, PrintingReason } from '@/lib/scan/match';

export type { Candidate, NameReason, PrintingReason };

export interface ScanDetectionView {
  id: string;
  grid: { row: number; col: number };
  orientation: string;
  read: { title: string | null; [k: string]: unknown };
  status: 'matched' | 'check' | 'not_found';
  nameReason: NameReason;
  printingReason: PrintingReason;
  chosenKey: string | null;
  scores: { matchScore: number; runnerUpScore: number; agreeingFields: string[] };
  candidates: Candidate[];
}

export interface ScanResponse {
  scanId: string;
  photoQuality: string;
  detections: ScanDetectionView[];
  usage: { model: string; latencyMs: number; attempts: number };
}

export interface ScanErrorBody {
  code?: string;
  message?: string;
  resetsAt?: string;
  limit?: number;
  /** small_photo (client-side, before the upload): the photo's long edge in px. */
  longEdge?: number;
}
