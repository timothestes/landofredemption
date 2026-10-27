import { countedRows, type TrayState } from './trayReducer';

export interface ClientOutcome {
  id: string;
  finalKey: string | null;
  printingChanged: boolean;
  nameChanged: boolean;
  removed: boolean;
  removedAs: 'wrong' | 'unwanted' | null;
  unresolved: boolean;
}

export interface CommitPayload {
  rows: { key: string; qty: number }[];
  outcomesByScanId: Record<string, ClientOutcome[]>;
}

export function buildCommitPayload(s: TrayState): CommitPayload {
  const sums = new Map<string, number>();
  for (const r of countedRows(s)) sums.set(r.key as string, (sums.get(r.key as string) ?? 0) + r.qty);

  const outcomesByScanId: Record<string, ClientOutcome[]> = {};
  for (const r of s.rows) {
    const removed = r.removedAs !== null;
    for (const src of r.sources) {
      const id = src.id;
      const scanId = id.split(':')[0];
      const finalKey = removed ? null : r.key;
      const changed = finalKey !== null && finalKey !== src.chosenKey;
      const printingChanged = changed && src.candidateKeys.includes(finalKey) && src.status !== 'not_found';
      (outcomesByScanId[scanId] ??= []).push({
        id,
        finalKey,
        printingChanged,
        nameChanged: changed && !printingChanged,
        removed,
        removedAs: r.removedAs,
        unresolved: !removed && r.key === null,
      });
    }
  }
  return { rows: [...sums].map(([key, qty]) => ({ key, qty })), outcomesByScanId };
}
