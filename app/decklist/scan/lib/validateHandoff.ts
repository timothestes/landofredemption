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

/** Rebuild an outcome from its known fields only; null if any field is off. */
function validDeckOutcome(o: unknown, idRe: RegExp, isKnownKey: (k: string) => boolean): DeckOutcome | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (typeof r.id !== 'string' || !idRe.test(r.id)) return null;
  if (r.finalKey !== null && (typeof r.finalKey !== 'string' || !isKnownKey(r.finalKey))) return null;
  for (const f of ['nameChanged', 'printingChanged', 'removed', 'unresolved', 'lostSoulPick'] as const) {
    if (typeof r[f] !== 'boolean') return null;
  }
  if (r.zone !== null && r.zone !== 'main' && r.zone !== 'reserve') return null;
  return {
    id: r.id,
    finalKey: r.finalKey as string | null,
    nameChanged: r.nameChanged as boolean,
    printingChanged: r.printingChanged as boolean,
    removed: r.removed as boolean,
    unresolved: r.unresolved as boolean,
    zone: r.zone as DeckOutcome['zone'],
    lostSoulPick: r.lostSoulPick as boolean,
  };
}

/** Shape-check the client's hand-off payload. Returns a clean copy, or null if a row or the name/format is off; bad outcomes are dropped. */
export function validateHandoff(input: unknown, isKnownKey: (k: string) => boolean): Handoff | null {
  if (!input || typeof input !== 'object') return null;
  const { rows, outcomesByScanId, name, format } = input as Record<string, unknown>;

  if (typeof name !== 'string' || name.length < 1 || name.length > 100) return null;
  if (format !== 'Type 1' && format !== 'Type 2') return null;

  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS) return null;
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

  // Outcomes only feed the eval data, so a bad one is dropped; it never costs the player their deck.
  const cleanOutcomes: Record<string, DeckOutcome[]> = {};
  if (outcomesByScanId && typeof outcomesByScanId === 'object' && !Array.isArray(outcomesByScanId)) {
    const scanIds = Object.keys(outcomesByScanId);
    if (scanIds.length <= MAX_SCANS) {
      for (const scanId of scanIds) {
        if (!UUID.test(scanId)) continue;
        const list = (outcomesByScanId as Record<string, unknown>)[scanId];
        if (!Array.isArray(list) || list.length > MAX_OUTCOMES) continue;
        const idRe = new RegExp(`^${scanId}:(\\d+|add:\\d+|ls:\\d+)$`, 'i');
        const clean: DeckOutcome[] = [];
        for (const o of list) {
          const v = validDeckOutcome(o, idRe, isKnownKey);
          if (v) clean.push(v);
        }
        cleanOutcomes[scanId] = clean;
      }
    }
  }

  return { rows: cleanRows, outcomesByScanId: cleanOutcomes, name, format };
}
