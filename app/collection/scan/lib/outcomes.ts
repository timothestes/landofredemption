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
  const outcomesByScanId: Record<string, ClientOutcome[]> = {};
  for (const r of s.rows) {
    const removed = r.removedAs !== null;
    for (const src of r.sources) {
      const id = src.id;
      const scanId = id.split(':')[0];
      const finalKey = removed ? null : r.key;
      const changed = finalKey !== null && finalKey !== src.chosenKey;
      // With no provisional pick (identity or reference ambiguous) the player chose which card, not which printing.
      const printingChanged =
        changed && src.chosenKey !== null && src.candidateKeys.includes(finalKey) && src.status !== 'not_found';
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
  // Rows go unsummed: each is capped at 99, the server sums per key, and a summed total over 99 would be refused.
  return { rows: countedRows(s).map(r => ({ key: r.key as string, qty: r.qty })), outcomesByScanId };
}
