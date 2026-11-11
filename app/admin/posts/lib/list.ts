// Server-only: do not import from "use client" files.
import type { PosterContext } from "./auth";

export const PAGE_SIZE = 25;

export interface PostListRow {
  id: string;
  title: string;
  status: "draft" | "published";
  published_at: string | null;
  scheduled_at: string | null;
  updated_at: string;
  author: { username: string | null } | null;
}

// No body_md: the list only needs headline fields, and 1,300+ article bodies
// made this page a multi-megabyte payload.
const LIST_COLS = "id, title, status, published_at, scheduled_at, updated_at, author:profiles(username)";

/** Escape LIKE wildcards so a search for "100%" matches literally. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function parsePage(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export function parseQuery(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw ?? "").trim().slice(0, 100);
}

export interface PostLists {
  scheduled: PostListRow[];
  drafts: PostListRow[];
  published: PostListRow[];
  publishedTotal: number;
  page: number;
  pageCount: number;
  error: string | null;
}

export async function loadPostLists(ctx: PosterContext, rawPage: number, q: string): Promise<PostLists> {
  const unpublishedQ = async () => {
    let query = ctx.supabase.from("posts").select(LIST_COLS).eq("status", "draft");
    if (!ctx.isSuperuser) query = query.eq("author_id", ctx.user.id);
    return query.order("updated_at", { ascending: false }).limit(500);
  };

  const run = async (page: number) => {
    let query = ctx.supabase.from("posts").select(LIST_COLS, { count: "exact" }).eq("status", "published");
    if (!ctx.isSuperuser) query = query.eq("author_id", ctx.user.id);
    if (q) query = query.ilike("title", likePattern(q));
    const from = (page - 1) * PAGE_SIZE;
    return query.order("published_at", { ascending: false, nullsFirst: false }).range(from, from + PAGE_SIZE - 1);
  };

  const [unpublished, pubFirst] = await Promise.all([unpublishedQ(), run(rawPage)]);
  let pub = pubFirst;
  let page = rawPage;

  // A stale ?page= past the end (after deletes or a narrower search) lands on the last page.
  const total0 = pub.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total0 / PAGE_SIZE));
  if (!pub.error && page > pageCount) {
    page = pageCount;
    pub = await run(page);
  }

  const failed = unpublished.error || pub.error;
  if (failed) console.error("loadPostLists:", failed);

  const unpub = (unpublished.data ?? []) as unknown as PostListRow[];
  return {
    scheduled: unpub
      .filter((p) => p.scheduled_at !== null)
      .sort((a, b) => a.scheduled_at!.localeCompare(b.scheduled_at!)),
    drafts: unpub.filter((p) => p.scheduled_at === null),
    published: (pub.data ?? []) as unknown as PostListRow[],
    publishedTotal: total0,
    page,
    pageCount,
    error: failed ? "Could not load posts" : null,
  };
}
