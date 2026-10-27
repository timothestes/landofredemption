import type { Candidate, ScanDetectionView, ScanResponse } from '../types';

const SCAN = '11111111-2222-3333-4444-555555555555';
export const cand = (key: string, price: number | null): Candidate =>
  ({ key, name: key, set: 'S', officialSet: 'S', imgFile: key, legality: 'Legal', price }) as Candidate;

export function det(i: number, o: Partial<ScanDetectionView> & { row?: number; col?: number; scan?: string } = {}): ScanDetectionView {
  const key = 'chosenKey' in o ? o.chosenKey! : `K${i}`;
  return {
    id: `${o.scan ?? SCAN}:${i}`,
    grid: { row: o.row ?? 0, col: o.col ?? i },
    orientation: 'upright',
    read: { title: `T${i}` },
    status: key === null ? 'not_found' : 'matched',
    nameReason: 'exact',
    printingReason: 'single',
    chosenKey: key,
    scores: { matchScore: 1, runnerUpScore: 0, agreeingFields: [] },
    candidates: key === null ? [] : [cand(key, 3.5)],
    ...o,
  } as ScanDetectionView;
}
export const resp = (detections: ScanDetectionView[], scanId = SCAN): ScanResponse => ({
  scanId, photoQuality: 'good', detections, usage: { model: 'm', latencyMs: 1, attempts: 1 },
});
