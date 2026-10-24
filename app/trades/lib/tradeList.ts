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
  /** Wants only: listed in the highlighted "Priority wants" group. */
  priority: boolean;
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

/** Normalizes an item before it is stored. Only Wants can be "any version" or priority. */
export function normalizeTradeItem(item: TradeItem): TradeItem {
  return {
    ...item,
    anyVersion: item.kind === "want" && item.anyVersion,
    priority: item.kind === "want" && !!item.priority,
    quantity: clampTradeQuantity(item.quantity),
    note: cleanTradeNote(item.note),
  };
}

/** How many more copies a Have offers than the owner's collection holds. */
export function haveShortfall(item: TradeItem, ownedQuantity: number): number {
  if (item.kind !== "have") return 0;
  return Math.max(0, item.quantity - ownedQuantity);
}

/** A TradeItem joined to the catalog for display, filtering and sorting. */
export type DisplayTradeItem = TradeItem & { setName: string; rarity: string };

export type TradeSort = "name" | "set" | "rarity";

export interface TradeFilters {
  query: string;
  set: string;
  rarity: string;
  sort: TradeSort;
}

export const DEFAULT_TRADE_FILTERS: TradeFilters = { query: "", set: "", rarity: "", sort: "name" };

// Rarest first, so "sort by rarity" leads with the cards traders care about most.
const RARITY_ORDER = ["Ultra Rare", "Rare", "Promo", "Common"];

function rarityRank(rarity: string): number {
  const i = RARITY_ORDER.indexOf(rarity);
  return i === -1 ? RARITY_ORDER.length : i;
}

function byName(a: TradeItem, b: TradeItem): number {
  return (
    a.cardName.localeCompare(b.cardName) ||
    a.cardSet.localeCompare(b.cardSet) ||
    a.cardImgFile.localeCompare(b.cardImgFile)
  );
}

export function sortTradeItems<T extends TradeItem>(items: T[], sort: TradeSort = "name"): T[] {
  return [...items].sort((a, b) => {
    if (sort === "set") {
      const sa = (a as Partial<DisplayTradeItem>).setName ?? a.cardSet;
      const sb = (b as Partial<DisplayTradeItem>).setName ?? b.cardSet;
      return sa.localeCompare(sb) || byName(a, b);
    }
    if (sort === "rarity") {
      const ra = rarityRank((a as Partial<DisplayTradeItem>).rarity ?? "");
      const rb = rarityRank((b as Partial<DisplayTradeItem>).rarity ?? "");
      return ra - rb || byName(a, b);
    }
    return byName(a, b);
  });
}

/** Search matches card name, set and note; set/rarity are exact matches. */
export function filterTradeItems<T extends DisplayTradeItem>(items: T[], filters: TradeFilters): T[] {
  const q = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.set && item.setName !== filters.set) return false;
    if (filters.rarity && item.rarity !== filters.rarity) return false;
    if (q) {
      const haystack = `${item.cardName} ${item.setName} ${item.cardSet} ${item.note}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/** Sets and rarities present in a list, for the filter dropdowns. */
export function tradeFilterOptions(items: DisplayTradeItem[]): { sets: string[]; rarities: string[] } {
  const sets = Array.from(new Set(items.map((i) => i.setName).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
  const present = new Set(items.map((i) => i.rarity));
  return { sets, rarities: RARITY_ORDER.filter((r) => present.has(r)) };
}

/** Priority wants are pulled out of Wants into their own group. */
export function splitTradeItems<T extends TradeItem>(
  items: T[],
  sort: TradeSort = "name"
): { priorityWants: T[]; wants: T[]; haves: T[] } {
  const sorted = sortTradeItems(items, sort);
  return {
    priorityWants: sorted.filter((i) => i.kind === "want" && i.priority),
    wants: sorted.filter((i) => i.kind === "want" && !i.priority),
    haves: sorted.filter((i) => i.kind === "have"),
  };
}

export function totalCopies(items: TradeItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}

// ---------------------------------------------------------------------------
// Matching a visitor against a list owner

export interface TradeMatches {
  /** Keys of the owner's Wants that the visitor owns. */
  youOwn: Set<string>;
  /** Keys of the owner's Haves that the visitor wants. */
  youWant: Set<string>;
}

/**
 * Where a visitor's cards line up with someone's trade list. An owner's
 * any-printing Want is covered by any printing the visitor owns; a visitor's
 * any-printing Want matches any printing the owner has.
 */
export function findTradeMatches(
  ownerItems: TradeItem[],
  /** Visitor's owned quantities by name|set|imgFile. */
  visitorOwned: Map<string, number>,
  visitorWants: TradeItem[]
): TradeMatches {
  const ownedNames = new Set<string>();
  for (const [key, qty] of visitorOwned) if (qty > 0) ownedNames.add(key.split("|")[0]);
  const wantKeys = new Set(visitorWants.filter((w) => w.kind === "want").map(keyOfItem));
  const wantAnyNames = new Set(
    visitorWants.filter((w) => w.kind === "want" && w.anyVersion).map((w) => w.cardName)
  );

  const youOwn = new Set<string>();
  const youWant = new Set<string>();
  for (const item of ownerItems) {
    const printing = `${item.cardName}|${item.cardSet}|${item.cardImgFile}`;
    if (item.kind === "want") {
      const owns = item.anyVersion ? ownedNames.has(item.cardName) : (visitorOwned.get(printing) || 0) > 0;
      if (owns) youOwn.add(keyOfItem(item));
    } else {
      const asWant = tradeItemKey("want", { name: item.cardName, set: item.cardSet, imgFile: item.cardImgFile });
      if (wantKeys.has(asWant) || wantAnyNames.has(item.cardName)) youWant.add(keyOfItem(item));
    }
  }
  return { youOwn, youWant };
}

// ---------------------------------------------------------------------------
// Bulk adds

/**
 * Haves for every printing owned beyond `keep` copies, offering the extras.
 * Printings already listed as Haves are left alone (their notes/quantities
 * were set by hand).
 */
export function spareHaves(
  owned: Map<string, number>,
  keep: number,
  existing: TradeItem[]
): TradeItem[] {
  const listed = new Set(existing.filter((i) => i.kind === "have").map(keyOfItem));
  const result: TradeItem[] = [];
  for (const [key, qty] of owned) {
    const spare = qty - Math.max(0, Math.floor(keep));
    if (spare <= 0) continue;
    const [cardName, cardSet, cardImgFile] = key.split("|");
    if (listed.has(tradeItemKey("have", { name: cardName, set: cardSet, imgFile: cardImgFile }))) continue;
    result.push({
      kind: "have",
      cardName,
      cardSet,
      cardImgFile,
      anyVersion: false,
      priority: false,
      quantity: clampTradeQuantity(spare),
      note: "",
    });
  }
  return sortTradeItems(result);
}

/**
 * Merges incoming Wants into existing ones. An existing Want of the same
 * printing keeps its note/flags and rises to the larger quantity (so adding
 * the same deck twice doesn't double up). An incoming any-printing Want also
 * matches an existing any-printing Want of the same card, whichever printing
 * holds its image, so a deck built on another printing doesn't list the card
 * twice. Returns only items that change.
 */
export function mergeWants(existing: TradeItem[], incoming: TradeItem[]): TradeItem[] {
  const wants = existing.filter((i) => i.kind === "want");
  const byKey = new Map(wants.map((i) => [keyOfItem(i), i]));
  const anyByName = new Map(wants.filter((i) => i.anyVersion).map((i) => [i.cardName, i]));
  const changes = new Map<string, TradeItem>();
  for (const raw of incoming) {
    const want = normalizeTradeItem({ ...raw, kind: "want" });
    if (want.quantity === 0) continue;
    const match = (want.anyVersion ? anyByName.get(want.cardName) : undefined) ?? byKey.get(keyOfItem(want));
    const key = keyOfItem(match ?? want);
    const current = changes.get(key) ?? match;
    const next = !current ? want : want.quantity > current.quantity ? { ...current, quantity: want.quantity } : null;
    if (!next) continue;
    changes.set(key, next);
    if (next.anyVersion) anyByName.set(next.cardName, next);
  }
  return Array.from(changes.values());
}

// ---------------------------------------------------------------------------
// Plain-text export (for Facebook groups, Discord, etc.)

/** `username` is null for an owner who hasn't picked one yet. */
export function tradeListText(username: string | null, items: DisplayTradeItem[], url: string | null): string {
  const { priorityWants, wants, haves } = splitTradeItems(items);
  const line = (i: DisplayTradeItem) =>
    `${i.quantity}x ${i.cardName} (${i.anyVersion ? "any printing" : i.setName})${i.note ? ` — ${i.note}` : ""}`;
  const section = (title: string, list: DisplayTradeItem[]) =>
    list.length ? [`${title} (${totalCopies(list)})`, ...list.map(line), ""] : [];

  return [
    username ? `${username}'s trade list` : "My trade list",
    ...(url ? [url] : []),
    "",
    ...section("★ PRIORITY WANTS", priorityWants),
    ...section("WANTS", wants),
    ...section("HAVES", haves),
  ]
    .join("\n")
    .trim();
}
