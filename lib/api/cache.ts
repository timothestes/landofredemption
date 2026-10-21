import { unstable_cache } from "next/cache";
import { flattenCardMentions } from "@/app/articles/lib/markdown";
import { createAnonClient as anonClient } from "@/utils/supabase/anon";
import { normalizeFormat } from "@/lib/formats";

export const PUBLIC_DECKS_LIST_TAG = "public-decks-list" as const;
export const publicDeckTag = (id: string) => `public-deck:${id}` as const;

const SITE_URL = "https://landofredemption.com";
const PAGE_SIZE_ALLOWLIST = new Set([24, 50, 100]);
const SORTS = new Set(["newest", "most_viewed", "name"] as const);
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type ListSort = "newest" | "most_viewed" | "name";

export type ListParams = {
  page: number;
  page_size: number;
  format: string | null;
  username: string | null;
  sort: ListSort;
};

export type DeckPayload = {
  id: string;
  name: string;
  description: string | null;
  format: string | null;
  paragon: string | null;
  card_count: number;
  is_legal: boolean;
  view_count: number;
  username: string | null;
  created_at: string;
  updated_at: string;
  url: string;
};

export type ListPayload = {
  data: DeckPayload[];
  pagination: { page: number; page_size: number; total: number; has_more: boolean };
};

export type DetailPayload = DeckPayload & {
  cards: { name: string; set: string | null; card_img_file: string | null; quantity: number; zone: string }[];
};

export type ParseResult<T> =
  | { ok: true; value: T; message?: never }
  | { ok: false; message: string; value?: never };

export function parseListParams(sp: URLSearchParams): ParseResult<ListParams> {
  const pageRaw = sp.get("page");
  const page = pageRaw === null ? 1 : Number.parseInt(pageRaw, 10);
  if (!Number.isInteger(page) || page < 1 || page > 1000) {
    return { ok: false, message: "page must be an integer in [1, 1000]" };
  }

  const pageSizeRaw = sp.get("page_size");
  const page_size = pageSizeRaw === null ? 24 : Number.parseInt(pageSizeRaw, 10);
  if (!Number.isInteger(page_size) || !PAGE_SIZE_ALLOWLIST.has(page_size)) {
    return { ok: false, message: "page_size must be one of 24, 50, 100" };
  }

  const sortRaw = sp.get("sort");
  const sort = (sortRaw ?? "newest") as ListSort;
  if (!SORTS.has(sort)) {
    return { ok: false, message: "sort must be one of newest, most_viewed, name" };
  }

  const format = sp.get("format")?.trim() || null;
  const username = sp.get("username")?.trim() || null;

  return { ok: true, value: { page, page_size, format, username, sort } };
}

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export type DeckFormatFilter =
  | { kind: "or"; clause: string }
  | { kind: "in"; values: string[] }
  | { kind: "eq"; value: string };

/**
 * Pure format -> PostgREST filter mapping, shared by every `decks.format`
 * query site (the v1 public API below, and the community filter in
 * app/decklist/actions.ts) so all of them apply the exact same filter shape.
 * Dual-vocabulary by design: each branch lists both the legacy DB string and
 * the canonical id, so results are identical before and after the Task 9
 * backfill. The Limited branch's raw `.or()` clause deliberately matches the
 * unquoted encoding the library's own `.in()` produces for embedded-space
 * values (verified in __tests__/cache.test.ts against a real
 * PostgrestFilterBuilder) rather than hand-quoting — see that test for the
 * byte-for-byte comparison.
 */
export function deckFormatFilterFor(format: string): DeckFormatFilter {
  const norm = normalizeFormat(format);
  if (norm === "T2") return { kind: "in", values: ["Type 2", "T2"] };
  if (norm === "Unlimited") return { kind: "in", values: ["Unlimited", "Classic"] };
  if (norm === "Paragon") return { kind: "eq", value: "Paragon" };
  // Teams needs its own branch, not the Limited fallthrough: Teams decks are
  // stored as "Teams" and a Teams query must not return the Limited pile.
  if (norm === "Teams") return { kind: "eq", value: "Teams" };
  // Limited (the default): decks with null format default to Limited in the
  // UI, so include them here too.
  return { kind: "or", clause: "format.is.null,format.in.(Type 1,Limited)" };
}

/**
 * Format-family filter (Deck Bracket pickers): a 'T1' bracket accepts
 * Limited, Unlimited and Teams decks, plus null-format decks (Limited in the UI).
 */
export function deckFamilyFilterFor(family: "T1" | "T2" | "Paragon"): DeckFormatFilter {
  if (family === "T1") {
    return { kind: "or", clause: "format.is.null,format.in.(Type 1,Limited,Unlimited,Classic,Teams)" };
  }
  return deckFormatFilterFor(family);
}

function applyDeckFormatFilter<
  T extends { or(clause: string): T; in(column: string, values: string[]): T; eq(column: string, value: string): T },
>(query: T, format: string): T {
  const filter = deckFormatFilterFor(format);
  if (filter.kind === "or") return query.or(filter.clause);
  if (filter.kind === "in") return query.in("format", filter.values);
  return query.eq("format", filter.value);
}

function deckUrl(id: string): string {
  return `${SITE_URL}/decklist/${id}`;
}

type DeckRow = {
  id: string;
  user_id: string | null;
  name: string;
  description: string | null;
  format: string | null;
  paragon: string | null;
  card_count: number | null;
  is_legal: boolean | null;
  view_count: number | null;
  created_at: string;
  updated_at: string;
};

function rowToPayload(row: DeckRow, username: string | null): DeckPayload {
  return {
    id: row.id,
    name: row.name,
    // Consumers print this; card mentions go out as plain names.
    description: row.description === null ? null : flattenCardMentions(row.description),
    format: row.format,
    paragon: row.paragon,
    card_count: row.card_count ?? 0,
    is_legal: row.is_legal ?? false,
    view_count: row.view_count ?? 0,
    username,
    created_at: row.created_at,
    updated_at: row.updated_at,
    url: deckUrl(row.id),
  };
}

const DECK_COLUMNS =
  "id, user_id, name, description, format, paragon, card_count, is_legal, view_count, created_at, updated_at";

async function resolveUsernames(
  supabase: ReturnType<typeof anonClient>,
  userIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const { data } = await supabase
    .from("profiles")
    .select("id, username")
    .in("id", userIds);
  for (const row of data ?? []) {
    if (row.username) map.set(row.id, row.username);
  }
  return map;
}

async function loadListFresh(params: ListParams): Promise<ListPayload> {
  const supabase = anonClient();

  let userIdFilter: string | null = null;
  if (params.username) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", params.username)
      .maybeSingle();
    if (!profile) {
      return {
        data: [],
        pagination: { page: params.page, page_size: params.page_size, total: 0, has_more: false },
      };
    }
    userIdFilter = profile.id;
  }

  let q = supabase
    .from("decks")
    .select(DECK_COLUMNS, { count: "exact" })
    .eq("visibility", "public");

  if (params.format) q = applyDeckFormatFilter(q, params.format);
  if (userIdFilter) q = q.eq("user_id", userIdFilter);

  switch (params.sort) {
    case "most_viewed":
      q = q.order("view_count", { ascending: false, nullsFirst: false }).order("id", { ascending: true });
      break;
    case "name":
      q = q.order("name", { ascending: true }).order("id", { ascending: true });
      break;
    case "newest":
    default:
      q = q.order("updated_at", { ascending: false }).order("id", { ascending: true });
      break;
  }

  const offset = (params.page - 1) * params.page_size;
  q = q.range(offset, offset + params.page_size - 1);

  const { data, count, error } = await q;

  // PGRST103 = "Requested range not satisfiable" — caller paginated past the
  // last page. Return an empty page with the real total instead of erroring.
  if (error && error.code === "PGRST103") {
    let countQ = supabase
      .from("decks")
      .select("id", { head: true, count: "exact" })
      .eq("visibility", "public");
    if (params.format) countQ = applyDeckFormatFilter(countQ, params.format);
    if (userIdFilter) countQ = countQ.eq("user_id", userIdFilter);
    const { count: totalCount } = await countQ;
    return {
      data: [],
      pagination: {
        page: params.page,
        page_size: params.page_size,
        total: totalCount ?? 0,
        has_more: false,
      },
    };
  }
  if (error) throw error;

  const rows = (data ?? []) as unknown as DeckRow[];
  const userIds = [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))];
  const usernames = await resolveUsernames(supabase, userIds);

  return {
    data: rows.map((r) => rowToPayload(r, r.user_id ? usernames.get(r.user_id) ?? null : null)),
    pagination: {
      page: params.page,
      page_size: params.page_size,
      total: count ?? 0,
      has_more: (count ?? 0) > offset + rows.length,
    },
  };
}

async function loadDetailFresh(id: string): Promise<DetailPayload | null> {
  const supabase = anonClient();
  const { data: deck, error } = await supabase
    .from("decks")
    .select(DECK_COLUMNS)
    .eq("is_public", true)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!deck) return null;

  const row = deck as unknown as DeckRow;

  const { data: cards, error: cardsErr } = await supabase
    .from("deck_cards")
    .select("card_name, card_set, card_img_file, quantity, zone")
    .eq("deck_id", id);
  if (cardsErr) throw cardsErr;

  let username: string | null = null;
  if (row.user_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", row.user_id)
      .maybeSingle();
    username = profile?.username ?? null;
  }

  const payload = rowToPayload(row, username);
  return {
    ...payload,
    cards: (cards ?? []).map((c: { card_name: string; card_set: string | null; card_img_file: string | null; quantity: number; zone: string }) => ({
      name: c.card_name,
      set: c.card_set ?? null,
      card_img_file: c.card_img_file ?? null,
      quantity: c.quantity,
      zone: c.zone ?? "main",
    })),
  };
}

export function loadPublicDecksList(params: ListParams): Promise<ListPayload> {
  return unstable_cache(
    () => loadListFresh(params),
    ["public-decks-list", params.page.toString(), params.page_size.toString(), params.format ?? "", params.username ?? "", params.sort],
    { tags: [PUBLIC_DECKS_LIST_TAG], revalidate: 300 },
  )();
}

export function loadPublicDeckDetail(id: string): Promise<DetailPayload | null> {
  return unstable_cache(
    () => loadDetailFresh(id),
    ["public-deck-detail", id],
    { tags: [PUBLIC_DECKS_LIST_TAG, publicDeckTag(id)], revalidate: 3600 },
  )();
}
