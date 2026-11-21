// Client-safe: type imports only, nothing that loads the card catalog.
import type { DeckSnapshotCard } from "./deckSubmission";

export type SnapshotZone = DeckSnapshotCard["zone"];

export const EDIT_MAX_QTY = 99;

/** A printing as the pickers name it: `name|set|imgFile`. */
export const cardKeyOf = (c: Pick<DeckSnapshotCard, "name" | "set" | "imgFile">): string =>
  `${c.name}|${c.set}|${c.imgFile ?? ""}`;

/** One row of the list: a printing in a zone. */
export const rowIdOf = (c: DeckSnapshotCard): string => `${c.zone}|${cardKeyOf(c)}`;

/** `name|set|imgFile`, split on the last two pipes (a card name may hold one). */
export function parseCardKey(key: string): Pick<DeckSnapshotCard, "name" | "set" | "imgFile"> | null {
  const b = key.lastIndexOf("|");
  const a = b > 0 ? key.lastIndexOf("|", b - 1) : -1;
  if (a < 1) return null;
  return { name: key.slice(0, a), set: key.slice(a + 1, b), imgFile: key.slice(b + 1) || null };
}

/** Rows of the same printing in the same zone become one; a row at zero or less is dropped. Order is kept. */
function merged(cards: DeckSnapshotCard[]): DeckSnapshotCard[] {
  const out = new Map<string, DeckSnapshotCard>();
  for (const c of cards) {
    if (c.quantity < 1) continue;
    const id = rowIdOf(c);
    const held = out.get(id);
    if (held) held.quantity = Math.min(EDIT_MAX_QTY, held.quantity + c.quantity);
    else out.set(id, { ...c, quantity: Math.min(EDIT_MAX_QTY, c.quantity) });
  }
  return [...out.values()];
}

/** Sets a row's quantity; zero or less removes the row. */
export function setQuantity(cards: DeckSnapshotCard[], rowId: string, quantity: number): DeckSnapshotCard[] {
  const n = Number.isFinite(quantity) ? Math.round(quantity) : 0;
  return merged(cards.map((c) => (rowIdOf(c) === rowId ? { ...c, quantity: n } : c)));
}

export function removeRow(cards: DeckSnapshotCard[], rowId: string): DeckSnapshotCard[] {
  return cards.filter((c) => rowIdOf(c) !== rowId);
}

/** Moves a row to the other zone, joining a row of the same printing already there. */
export function moveRow(cards: DeckSnapshotCard[], rowId: string, zone: SnapshotZone): DeckSnapshotCard[] {
  return merged(cards.map((c) => (rowIdOf(c) === rowId ? { ...c, zone } : c)));
}

/** Swaps a row's card or printing for another, keeping its zone, quantity and place in the list. */
export function replaceCard(cards: DeckSnapshotCard[], rowId: string, key: string): DeckSnapshotCard[] {
  const next = parseCardKey(key);
  if (!next) return cards;
  return merged(cards.map((c) => (rowIdOf(c) === rowId ? { ...c, ...next } : c)));
}

/** Adds copies of a printing to a zone, onto its row when the list already has one. */
export function addCard(cards: DeckSnapshotCard[], key: string, zone: SnapshotZone, quantity = 1): DeckSnapshotCard[] {
  const card = parseCardKey(key);
  if (!card) return cards;
  return merged([...cards, { ...card, quantity, zone }]);
}

export function zoneTotals(cards: DeckSnapshotCard[]): { main: number; reserve: number } {
  let main = 0;
  let reserve = 0;
  for (const c of cards) {
    if (c.zone === "main") main += c.quantity;
    else reserve += c.quantity;
  }
  return { main, reserve };
}

/** True when two lists hold the same printings in the same zones and numbers, whatever their order. */
export function sameCards(a: DeckSnapshotCard[], b: DeckSnapshotCard[]): boolean {
  const count = (cards: DeckSnapshotCard[]) => {
    const m = new Map<string, number>();
    for (const c of cards) m.set(rowIdOf(c), (m.get(rowIdOf(c)) ?? 0) + c.quantity);
    return m;
  };
  const ma = count(a);
  const mb = count(b);
  if (ma.size !== mb.size) return false;
  for (const [k, n] of ma) if (mb.get(k) !== n) return false;
  return true;
}
