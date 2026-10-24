// Shared trade-list model: used by the editor on /collection, the server
// actions, and the public /trades/<username> page.

export type TradeKind = "want" | "have";

export interface TradeItem {
  kind: TradeKind;
  cardName: string;
  cardSet: string;
  cardImgFile: string;
  /** Wants only: any printing of this card will do. */
  anyVersion: boolean;
  quantity: number;
  note: string;
}

export const MAX_TRADE_QUANTITY = 99;
export const MAX_TRADE_NOTE_LENGTH = 120;

type CardIdentity = { name: string; set: string; imgFile: string };

export function tradeItemKey(kind: TradeKind, card: CardIdentity): string {
  return `${kind}|${card.name}|${card.set}|${card.imgFile}`;
}

export function keyOfItem(item: TradeItem): string {
  return tradeItemKey(item.kind, {
    name: item.cardName,
    set: item.cardSet,
    imgFile: item.cardImgFile,
  });
}

/** 0 means "remove"; anything else lands in 1..MAX_TRADE_QUANTITY. */
export function clampTradeQuantity(quantity: number): number {
  const n = Math.floor(quantity) || 0;
  if (n <= 0) return 0;
  return Math.min(MAX_TRADE_QUANTITY, n);
}

export function cleanTradeNote(note: string): string {
  return note.replace(/\s+/g, " ").trim().slice(0, MAX_TRADE_NOTE_LENGTH);
}

/** Normalizes an item before it is stored. Only Wants can be "any version". */
export function normalizeTradeItem(item: TradeItem): TradeItem {
  return {
    ...item,
    anyVersion: item.kind === "want" && item.anyVersion,
    quantity: clampTradeQuantity(item.quantity),
    note: cleanTradeNote(item.note),
  };
}

/** How many more copies a Have offers than the owner's collection holds. */
export function haveShortfall(item: TradeItem, ownedQuantity: number): number {
  if (item.kind !== "have") return 0;
  return Math.max(0, item.quantity - ownedQuantity);
}

export function sortTradeItems(items: TradeItem[]): TradeItem[] {
  return [...items].sort(
    (a, b) =>
      a.cardName.localeCompare(b.cardName) ||
      a.cardSet.localeCompare(b.cardSet) ||
      a.cardImgFile.localeCompare(b.cardImgFile)
  );
}

export function splitTradeItems(items: TradeItem[]): { wants: TradeItem[]; haves: TradeItem[] } {
  const sorted = sortTradeItems(items);
  return {
    wants: sorted.filter((i) => i.kind === "want"),
    haves: sorted.filter((i) => i.kind === "have"),
  };
}

export function totalCopies(items: TradeItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}
