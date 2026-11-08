// What a set grid or the Ideas page is filtered to, as it travels in the URL, and where the grid
// should land when you come back from a card. Pure, so the grids, the card page and the tests
// all read it the same way.

import { BRIGADES, CARD_TYPES, type Brigade, type CardType } from "./designCard";

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
