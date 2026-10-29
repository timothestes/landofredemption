import type { DeckDetection, DeckRowKind, DeckScanResponse } from '../types';

export interface DetSpec {
  group: number;
  key: string | null;
  title?: string;
  kind?: DeckRowKind;
  type?: string;
  identityCandidates?: string[];
}

/** Hand-built deck response; read ids are `${scanId}:${i}`. */
export function deckResponse(
  scanId: string,
  dets: DetSpec[],
  groups: { id: number; orientation?: string; cardCount?: number }[] = [{ id: 1 }],
): DeckScanResponse {
  const detections = dets.map((d, i) => ({
    id: `${scanId}:${i}`,
    group: d.group,
    position: i,
    titleBox: null,
    read: { title: d.title ?? d.key, type: d.type ?? 'Hero' },
    status: 'matched',
    nameReason: 'exact',
    printingReason: null,
    chosenKey: d.key,
    kind: d.kind ?? 'matched',
    deckKey: d.key,
    ...(d.identityCandidates ? { identityCandidates: d.identityCandidates } : {}),
    candidates: [],
    scores: {},
  })) as unknown as DeckDetection[];
  return {
    scanId,
    mode: 'deck',
    photoQuality: 'ok',
    groups: groups.map(g => ({
      id: g.id,
      orientation: (g.orientation ?? 'upright') as 'upright',
      bbox: [0, 0, 1, 1],
      cardCount: g.cardCount ?? dets.filter(d => d.group === g.id).length,
    })),
    detections,
    usage: { model: 'm', latencyMs: 1, attempts: 1 },
  };
}

export const rep = (n: number, d: DetSpec): DetSpec[] => Array.from({ length: n }, () => d);
