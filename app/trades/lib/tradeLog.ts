// Trade log: a private record of completed trades. Logging one adjusts the
// collection (received cards added, given cards removed) and can offer
// matching trade-list updates for the user to confirm.

import { clampTradeQuantity, type TradeItem } from "./tradeList";

export type TradeDirection = "gave" | "received";

export interface TradeLogCard {
  direction: TradeDirection;
  cardName: string;
  cardSet: string;
  cardImgFile: string;
  quantity: number;
  /** YTG retail price per copy when the trade was logged; null if unpriced. */
  unitPrice: number | null;
}

export interface TradeLogEntry {
  id: string;
  /** YYYY-MM-DD */
  tradedOn: string;
  partner: string;
  notes: string;
  cards: TradeLogCard[];
  createdAt: string;
}

export const MAX_PARTNER_LENGTH = 60;
export const MAX_TRADE_LOG_NOTES_LENGTH = 2000;

function cardKey(c: { cardName: string; cardSet: string; cardImgFile: string }): string {
  return `${c.cardName}|${c.cardSet}|${c.cardImgFile}`;
}

/** Net collection change per printing (name|set|imgFile): received minus given. */
export function collectionDeltas(cards: TradeLogCard[]): Map<string, number> {
  const deltas = new Map<string, number>();
  for (const c of cards) {
    const key = cardKey(c);
    const change = c.direction === "received" ? c.quantity : -c.quantity;
    deltas.set(key, (deltas.get(key) || 0) + change);
  }
  for (const [key, delta] of deltas) if (delta === 0) deltas.delete(key);
  return deltas;
}

/**
 * New quantities for every printing the trade touches. Giving away more
 * copies than are tracked floors at 0 (the collection may be incomplete).
 */
export function applyCollectionDeltas(
  current: Map<string, number>,
  deltas: Map<string, number>
): Map<string, number> {
  const next = new Map<string, number>();
  for (const [key, delta] of deltas) {
    next.set(key, Math.max(0, (current.get(key) || 0) + delta));
  }
  return next;
}

export interface TradeListSuggestion {
  item: TradeItem;
  /** 0 removes the item. */
  newQuantity: number;
  reason: string;
}

/**
 * Trade-list changes implied by a trade: received cards fill Wants (same
 * printing, or any printing of the same card when the Want allows it); given
 * cards use up Haves of the same printing.
 */
export function suggestTradeListUpdates(
  cards: TradeLogCard[],
  tradeItems: TradeItem[]
): TradeListSuggestion[] {
  const remaining = new Map<TradeItem, number>(tradeItems.map((i) => [i, i.quantity]));
  const reasons = new Map<TradeItem, string[]>();

  for (const c of cards) {
    let qty = c.quantity;
    const kind = c.direction === "received" ? "want" : "have";
    // Exact-printing matches first, then any-printing Wants.
    const matches = tradeItems
      .filter(
        (i) =>
          i.kind === kind &&
          (cardKey(i) === cardKey(c) || (kind === "want" && i.anyVersion && i.cardName === c.cardName))
      )
      .sort((a, b) => Number(cardKey(b) === cardKey(c)) - Number(cardKey(a) === cardKey(c)));
    for (const item of matches) {
      if (qty <= 0) break;
      const left = remaining.get(item) || 0;
      const used = Math.min(left, qty);
      if (used === 0) continue;
      remaining.set(item, left - used);
      qty -= used;
      const verb = c.direction === "received" ? "Received" : "Gave";
      reasons.set(item, [...(reasons.get(item) || []), `${verb} ${used}`]);
    }
  }

  return tradeItems
    .filter((i) => reasons.has(i))
    .map((item) => ({
      item,
      newQuantity: clampTradeQuantity(remaining.get(item) || 0),
      reason: reasons.get(item)!.join(", "),
    }));
}

/** Total YTG value of one side of a trade, and how many copies had no price. */
export function tradeSideValue(
  cards: TradeLogCard[],
  direction: TradeDirection
): { total: number; unpriced: number } {
  let total = 0;
  let unpriced = 0;
  for (const c of cards) {
    if (c.direction !== direction) continue;
    if (c.unitPrice == null) unpriced += c.quantity;
    else total += c.unitPrice * c.quantity;
  }
  return { total: Math.round(total * 100) / 100, unpriced };
}

export function cleanTradeLogText(text: string, max: number): string {
  return text.trim().slice(0, max);
}
