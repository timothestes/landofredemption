// What a set grid or the Ideas page is filtered to, as it travels in the URL, which cards that
// leaves, and where the grid should land when you come back from a card. Pure, so the grid, the
// card page's arrows and the tests all answer the same way and can't disagree.

import { BRIGADES, CARD_TYPES, cardRawText, type Brigade, type CardType } from "./designCard";
import type { ForgeCardFull } from "./cards";
import type { ReleaseInfo } from "./versions";

export const SET_STATUSES = ["draft", "playtesting", "approved", "archived"] as const;

export type CardFilters = {
  q: string;
  status: string;
  type: CardType | "";
  brigade: Brigade | "";
  since: string; // yyyy-mm-dd
};

export const NO_FILTERS: CardFilters = { q: "", status: "", type: "", brigade: "", since: "" };

const FILTER_KEYS = ["q", "status", "type", "brigade", "since"] as const;

type Params = { get(key: string): string | null } | Record<string, unknown>;

function read(params: Params, key: string): string {
  const v = typeof params.get === "function"
    ? (params as { get(key: string): string | null }).get(key)
    : (params as Record<string, unknown>)[key];
  const first = Array.isArray(v) ? v[0] : v;
  return typeof first === "string" ? first : "";
}

function oneOf<T extends string>(value: string, allowed: readonly T[]): T | "" {
  return (allowed as readonly string[]).includes(value) ? (value as T) : "";
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(value);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(value);
}

/** Takes useSearchParams() or a page's searchParams. Anything that isn't a real value is dropped,
 *  so a stale link can't blank the grid or leave a select showing nothing. */
export function parseCardFilters(params: Params): CardFilters {
  const since = read(params, "since");
  return {
    q: read(params, "q"),
    status: oneOf(read(params, "status"), SET_STATUSES),
    type: oneOf(read(params, "type"), CARD_TYPES),
    brigade: oneOf(read(params, "brigade"), BRIGADES),
    since: isDate(since) ? since : "",
  };
}

/** "" with no filters, else "?type=Hero&…", in a stable order. */
export function filterQuery(filters: CardFilters): string {
  const out = new URLSearchParams();
  for (const key of FILTER_KEYS) if (filters[key]) out.set(key, filters[key]);
  const s = out.toString();
  return s ? `?${s}` : "";
}

export const TILE_ID_PREFIX = "card-";
export const tileId = (cardId: string) => `${TILE_ID_PREFIX}${cardId}`;

/** The way back from a card: its grid, filtered as it was, naming the card so the grid can find
 *  your place. */
export function gridHref(setId: string | null, cardId: string, filters: CardFilters): string {
  const path = setId ? `/forge/sets/${setId}/cards` : "/forge/ideas";
  return `${path}${filterQuery(filters)}#${tileId(cardId)}`;
}

/** Where a grid should scroll to on the way back from a card. The place you left from, as long as
 *  the card you ended on is on screen there; arrows can walk far from it, so otherwise that card,
 *  centred. All in document pixels; chrome is the sticky bars' height. */
export function gridReturnY({ savedY, tile, viewportHeight, chrome }: {
  savedY: number | null;
  tile: { top: number; height: number } | null;
  viewportHeight: number;
  chrome: number;
}): number {
  const base = savedY ?? 0;
  if (!tile) return base;
  const onScreen = savedY !== null && tile.top >= base + chrome && tile.top + tile.height <= base + viewportHeight;
  if (onScreen) return base;
  return Math.max(0, tile.top - (viewportHeight - tile.height) / 2);
}

export type FilterableCard = Pick<ForgeCardFull, "id" | "title" | "status" | "snapshot">;
type Releases = Record<string, ReleaseInfo>;

export function cardMatchesFilters(card: FilterableCard, filters: CardFilters, releases?: Releases): boolean {
  const s = card.snapshot ?? {};
  if (filters.q) {
    const hay = `${card.title ?? ""}\n${cardRawText(s)}`.toLowerCase();
    if (!hay.includes(filters.q.toLowerCase())) return false;
  }
  if (filters.status && card.status !== filters.status) return false;
  if (filters.type && !(s.cardType ?? []).includes(filters.type)) return false;
  if (filters.brigade && !(s.brigades ?? []).includes(filters.brigade)) return false;
  if (filters.since) {
    const rel = releases?.[card.id];
    if (!rel || Date.parse(rel.releasedAt) < Date.parse(filters.since)) return false;
  }
  return true;
}

/** The cards a set grid shows, in the order it shows them. Takes them in grid order; a date
 *  filter puts the newest version first. */
export function visibleSetCards<C extends FilterableCard>(sorted: C[], filters: CardFilters, releases?: Releases): C[] {
  const list = sorted.filter((c) => cardMatchesFilters(c, filters, releases));
  if (!filters.since) return list;
  return list.sort((a, b) => Date.parse(releases![b.id].releasedAt) - Date.parse(releases![a.id].releasedAt));
}

// index is 0 for a card outside the filter.
export type WalkPosition = { index: number; total: number; filtered: boolean };

/** A card page's arrows and position hint: the grid's list, with no wrap at the ends. A card that
 *  no longer matches, as after changing its type, stays reachable and walks on to its neighbours
 *  in the list. */
export function walkSet(sorted: FilterableCard[], cardId: string, filters: CardFilters, releases?: Releases): {
  prevId: string | null;
  nextId: string | null;
  position: WalkPosition | null;
} {
  const filtered = filterQuery(filters) !== "";
  const list = visibleSetCards(sorted, filters, releases);
  const idx = list.findIndex((c) => c.id === cardId);
  if (idx >= 0) {
    return {
      prevId: list[idx - 1]?.id ?? null,
      nextId: list[idx + 1]?.id ?? null,
      position: filtered || list.length > 1 ? { index: idx + 1, total: list.length, filtered } : null,
    };
  }
  const here = sorted.findIndex((c) => c.id === cardId);
  if (here < 0) return { prevId: null, nextId: null, position: null };
  const shown = new Set(list.map((c) => c.id));
  return {
    prevId: sorted.slice(0, here).reverse().find((c) => shown.has(c.id))?.id ?? null,
    nextId: sorted.slice(here + 1).find((c) => shown.has(c.id))?.id ?? null,
    position: { index: 0, total: list.length, filtered },
  };
}

export function walkHint({ index, total, filtered }: WalkPosition): string {
  if (index === 0) return "Not in this filter";
  return `${index} of ${total}${filtered ? " in this filter" : ""}`;
}

export function noMatchCopy(noun: "cards" | "ideas", filters: CardFilters): string {
  const onlySearch = filters.q && filterQuery({ ...filters, q: "" }) === "";
  const base = onlySearch ? `No ${noun} match “${filters.q}”.` : `No ${noun} match your filters.`;
  return filters.since ? `${base} Only a release or an accepted proposal makes a new version; saved edits don't.` : base;
}
