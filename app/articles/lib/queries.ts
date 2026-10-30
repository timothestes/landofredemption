import { unstable_cache } from "next/cache";
import { createAnonClient } from "@/utils/supabase/anon";
import { withVideoCovers } from "./coverImage";
import { excerptFromMarkdown } from "./markdown";

// Public, cookie-less, cached reads. Every loader is wrapped in unstable_cache
// under ARTICLES_TAG; the server actions in app/admin/posts/actions.ts call
// revalidateTag(ARTICLES_TAG) after every write, so readers never wait out
// the hour. RLS already hides drafts from anon; the explicit status filter
// just makes the intent visible here.

export const PAGE_SIZE = 20;
export const FEED_SIZE = 30;
export const ARTICLES_TAG = "articles" as const;

export interface PublicPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body_md: string;
  cover_image_url: string | null;
  /** Computed by the loaders, not a column: a live embedded video whose thumbnail stands in for a missing cover. */
  cover_video_id?: string | null;
  tags: string[];
  status: "draft" | "published";
  author_id: string;
  author_name: string | null;
  published_at: string | null;
  updated_at: string | null;
  author: { username: string | null; avatar_url: string | null; bio: string | null } | null;
}

const COLUMNS =
  "id, slug, title, excerpt, body_md, cover_image_url, tags, status, author_id, author_name, published_at, updated_at, author:profiles(username, avatar_url, bio)";

export function postExcerpt(post: Pick<PublicPost, "excerpt" | "body_md">): string {
  const explicit = post.excerpt?.trim();
  return explicit ? explicit : excerptFromMarkdown(post.body_md);
}

/** Byline: the import's author_name, else the owner's username, else the site name. */
export function postByline(post: Pick<PublicPost, "author_name" | "author">): string {
  return post.author_name ?? post.author?.username ?? "Land of Redemption";
}

/** PostgREST array literal for `tags cs {"tag"}` — quotes and backslashes escaped. */
const tagContains = (tag: string) => `{"${tag.replace(/["\\]/g, (c) => "\\" + c)}"}`;

async function loadPublishedPostsFresh(page: number, tag: string | null) {
  const from = (page - 1) * PAGE_SIZE;
  let q = createAnonClient()
    .from("posts")
    .select(COLUMNS, { count: "exact" })
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .range(from, from + PAGE_SIZE - 1);
  if (tag) q = q.filter("tags", "cs", tagContains(tag));
  const { data, error, count } = await q;
  if (error) {
    // PGRST103 = "Requested range not satisfiable" — caller paginated past
    // the last page. Return an empty page with the real total instead of
    // erroring (see lib/api/cache.ts for the same precedent).
    if (error.code === "PGRST103") {
      if (count != null) return { posts: [], total: count };
      let countQ = createAnonClient().from("posts").select("id", { head: true, count: "exact" }).eq("status", "published");
      if (tag) countQ = countQ.filter("tags", "cs", tagContains(tag));
      const { count: totalCount } = await countQ;
      return { posts: [], total: totalCount ?? 0 };
    }
    throw new Error(`loadPublishedPosts: ${error.message}`);
  }
  return { posts: await withVideoCovers((data ?? []) as unknown as PublicPost[]), total: count ?? 0 };
}

export function loadPublishedPosts(opts: { page?: number; tag?: string | null }) {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const tag = opts.tag?.trim() || null;
  return unstable_cache(
    () => loadPublishedPostsFresh(page, tag),
    ["articles-list", String(page), tag ?? ""],
    { tags: [ARTICLES_TAG], revalidate: 3600 },
  )().then((r) => ({ ...r, page }));
}

async function loadPostBySlugFresh(slug: string): Promise<PublicPost | null> {
  const { data, error } = await createAnonClient()
    .from("posts")
    .select(COLUMNS)
    .eq("status", "published")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    throw new Error(`loadPostBySlug: ${error.message}`);
  }
  const post = data as unknown as PublicPost | null;
  return post ? (await withVideoCovers([post]))[0] : null;
}

export function loadPostBySlug(slug: string): Promise<PublicPost | null> {
  return unstable_cache(() => loadPostBySlugFresh(slug), ["articles-post", slug], {
    tags: [ARTICLES_TAG],
    revalidate: 3600,
  })();
}

async function loadFeedPostsFresh(): Promise<PublicPost[]> {
  const { data, error } = await createAnonClient()
    .from("posts")
    .select(COLUMNS)
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(FEED_SIZE);
  if (error) {
    throw new Error(`loadFeedPosts: ${error.message}`);
  }
  return (data ?? []) as unknown as PublicPost[];
}

export function loadFeedPosts(): Promise<PublicPost[]> {
  return unstable_cache(loadFeedPostsFresh, ["articles-feed"], { tags: [ARTICLES_TAG], revalidate: 3600 })();
}

async function listPublishedTagsFresh(): Promise<string[]> {
  const { data, error } = await createAnonClient().from("posts").select("tags").eq("status", "published");
  if (error) {
    throw new Error(`listPublishedTags: ${error.message}`);
  }
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    for (const t of (row.tags as string[] | null) ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

export function listPublishedTags(): Promise<string[]> {
  return unstable_cache(listPublishedTagsFresh, ["articles-tags"], { tags: [ARTICLES_TAG], revalidate: 3600 })();
}

async function loadPostsByTagFresh(tag: string, limit: number): Promise<PublicPost[]> {
  const { data, error } = await createAnonClient()
    .from("posts")
    .select(COLUMNS)
    .eq("status", "published")
    .filter("tags", "cs", tagContains(tag))
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) {
    throw new Error(`loadPostsByTag: ${error.message}`);
  }
  return withVideoCovers((data ?? []) as unknown as PublicPost[]);
}

/** Newest `limit` posts in a tag (= series) — the article page's "More in …" strip. */
export function loadPostsByTag(tag: string, limit = 4): Promise<PublicPost[]> {
  return unstable_cache(() => loadPostsByTagFresh(tag, limit), ["articles-by-tag", tag, String(limit)], {
    tags: [ARTICLES_TAG],
    revalidate: 3600,
  })();
}

/** Token format minted by createPreviewLinkAction: 24 random bytes, base64url. */
export const PREVIEW_TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

/**
 * The post behind a draft preview link, whatever its status, or null. Never
 * cached: turning a link off has to take effect on the next request.
 */
export async function loadPostPreview(token: string): Promise<PublicPost | null> {
  if (!PREVIEW_TOKEN_RE.test(token)) return null;
  const { data, error } = await createAnonClient()
    .rpc("get_post_preview", { p_token: token })
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    throw new Error(`loadPostPreview: ${error.message}`);
  }
  return (data as unknown as PublicPost | null) ?? null;
}
