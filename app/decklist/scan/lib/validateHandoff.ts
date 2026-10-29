import { UUID } from '@/app/collection/scan/lib/commitCore';
import type { DeckOutcome, SaveRow } from './handoff';

export interface Handoff {
  rows: SaveRow[];
  outcomesByScanId: Record<string, DeckOutcome[]>;
  name: string;
  format: 'Type 1' | 'Type 2';
}

const MAX_ROWS = 300;
const MAX_SCANS = 20;
const MAX_OUTCOMES = 400;

/** Shape-check the client's hand-off payload. Returns a clean copy, or null if anything is off. */
export function validateHandoff(input: unknown, isKnownKey: (k: string) => boolean): Handoff | null {
  if (!input || typeof input !== 'object') return null;
  const { rows, outcomesByScanId, name, format } = input as Record<string, unknown>;

  if (typeof name !== 'string' || name.length < 1 || name.length > 100) return null;
  if (format !== 'Type 1' && format !== 'Type 2') return null;

  if (!Array.isArray(rows) || rows.length > MAX_ROWS) return null;
  const cleanRows: SaveRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') return null;
    const { card_name, card_set, card_img_file, quantity, zone } = r as Record<string, unknown>;
    if (typeof card_name !== 'string' || typeof card_set !== 'string' || typeof card_img_file !== 'string') return null;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) return null;
    if (zone !== 'main' && zone !== 'reserve') return null;
    if (!isKnownKey(`${card_name}|${card_set}|${card_img_file}`)) return null;
    cleanRows.push({ card_name, card_set, card_img_file, quantity, zone });
  }

  if (!outcomesByScanId || typeof outcomesByScanId !== 'object' || Array.isArray(outcomesByScanId)) return null;
  const scanIds = Object.keys(outcomesByScanId);
  if (scanIds.length > MAX_SCANS) return null;
  const cleanOutcomes: Record<string, DeckOutcome[]> = {};
  for (const scanId of scanIds) {
    if (!UUID.test(scanId)) return null;
    const list = (outcomesByScanId as Record<string, unknown>)[scanId];
    if (!Array.isArray(list) || list.length > MAX_OUTCOMES) return null;
    const idRe = new RegExp(`^${scanId}:(\\d+|add:\\d+|ls:\\d+)$`, 'i');
    for (const o of list) {
      if (!o || typeof o !== 'object' || typeof (o as { id?: unknown }).id !== 'string') return null;
      if (!idRe.test((o as { id: string }).id)) return null;
    }
    cleanOutcomes[scanId] = list as DeckOutcome[];
  }

  return { rows: cleanRows, outcomesByScanId: cleanOutcomes, name, format };
}
