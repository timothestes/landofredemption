"use server";

import { del, list } from "@vercel/blob";
import { revalidateArticles } from "@/app/articles/lib/revalidate";
import { slugify, MAX_SLUG } from "@/app/articles/lib/markdown";
import { requirePoster, type PosterContext } from "./lib/auth";
import { normalizeTags, validatePatch, validateForPublish, canEditPost, type PostPatch } from "./lib/validate";
import { searchCardNames, type CardSearchHit } from "@/lib/cards/search";
import { resolveArticleRefs } from "@/app/articles/lib/refs";
import type { ArticleRefs } from "@/app/articles/lib/refTypes";

export interface PostRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body_md: string;
  cover_image_url: string | null;
  tags: string[];
  status: "draft" | "published";
  author_id: string;
  published_at: string | null;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  author?: { username: string | null } | null;
}

export type ActionResult<T = object> = ({ success: true } & T) | { success: false; error: string };

const ROW =
  "id, slug, title, excerpt, body_md, cover_image_url, tags, status, author_id, published_at, scheduled_at, created_at, updated_at";

function fail(e: unknown): { success: false; error: string } {
  const msg = e instanceof Error ? e.message : "";
  if (msg.startsWith("Unauthorized")) return { success: false, error: "Unauthorized" };
  console.error("posts action failed:", e);
  return { success: false, error: "An unexpected error occurred" };
}

// RLS hides other posters' drafts from this query, so a collision with an
// invisible draft still surfaces as a 23505 on insert — callers map that to a
// friendly "slug is taken" message.
async function uniqueSlug(ctx: PosterContext, base: string): Promise<string> {
  const { data } = await ctx.supabase.from("posts").select("slug").like("slug", `${base}%`);
  const taken = new Set((data ?? []).map((r) => r.slug as string));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, MAX_SLUG - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 60).replace(/-+$/, "")}-${Date.now()}`;
}

// posts_select_published lets ANY authenticated user read ANY published
// post, so this only proves the row is visible to the caller — never that
// they may edit it. Callers must run canEditPost() before mutating.
async function loadVisiblePost(ctx: PosterContext, id: string): Promise<PostRow | null> {
  const { data } = await ctx.supabase.from("posts").select(ROW).eq("id", id).maybeSingle();
  return (data as PostRow | null) ?? null;
}

export async function createDraftAction(input: { title: string }): Promise<ActionResult<{ post: PostRow }>> {
  try {
    const ctx = await requirePoster();
    const title = input.title.trim().slice(0, 200) || "Untitled";
    const slug = await uniqueSlug(ctx, slugify(title) || "post");
    const { data, error } = await ctx.supabase
      .from("posts")
      .insert({ title, slug, author_id: ctx.user.id })
      .select(ROW)
      .single();
    if (error || !data) {
      if (error?.code === "23505") return { success: false, error: "That slug is taken; change the title and try again" };
      console.error("createDraft:", error);
      return { success: false, error: "Could not create the draft" };
    }
    return { success: true, post: data as PostRow };
  } catch (e) {
    return fail(e);
  }
}

export async function updatePostAction(id: string, patch: PostPatch): Promise<ActionResult<{ post: PostRow }>> {
  try {
    const ctx = await requirePoster();
    const current = await loadVisiblePost(ctx, id);
    if (!current) return { success: false, error: "Post not found" };
    if (!canEditPost({ userId: ctx.user.id, isSuperuser: ctx.isSuperuser }, current)) {
      return { success: false, error: "You can only edit your own posts" };
    }

    const clean: PostPatch = {
      title: patch.title.trim(),
      slug: patch.slug.trim(),
      excerpt: patch.excerpt && patch.excerpt.trim() ? patch.excerpt.trim() : null,
      body_md: patch.body_md,
      cover_image_url: patch.cover_image_url && patch.cover_image_url.trim() ? patch.cover_image_url.trim() : null,
      tags: normalizeTags(patch.tags),
      published_at: patch.published_at,
    };
    const problem = validatePatch(clean);
    if (problem) return { success: false, error: problem };
    if (current.status === "published" && clean.slug !== current.slug) {
      return { success: false, error: "The slug is locked once a post is published" };
    }
    if (current.status === "published" && clean.published_at === null) {
      return { success: false, error: "A published post needs a publish date" };
    }

    const { data, error } = await ctx.supabase
      .from("posts")
      .update({ ...clean, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(ROW)
      .single();
    if (error || !data) {
      if (error?.code === "23505") return { success: false, error: "That slug is already taken" };
      console.error("updatePost:", error);
      return { success: false, error: "Could not save the post" };
    }
    if (current.status === "published") revalidateArticles([current.slug]);
    return { success: true, post: data as PostRow };
  } catch (e) {
    return fail(e);
  }
}

export async function publishPostAction(id: string): Promise<ActionResult<{ post: PostRow }>> {
  try {
    const ctx = await requirePoster();
    const current = await loadVisiblePost(ctx, id);
    if (!current) return { success: false, error: "Post not found" };
    if (!canEditPost({ userId: ctx.user.id, isSuperuser: ctx.isSuperuser }, current)) {
      return { success: false, error: "You can only edit your own posts" };
    }
    const problem = validateForPublish(current);
    if (problem) return { success: false, error: problem };

    const now = new Date().toISOString();
    const { data, error } = await ctx.supabase
      .from("posts")
      // The caller's save() (onPublish awaits it first) already wrote any
      // backdated published_at the poster typed; default to now only when
      // they left the field empty. Clear scheduled_at in case this post had
      // a pending schedule and the poster published it early by hand.
      .update({ status: "published", published_at: current.published_at ?? now, scheduled_at: null, updated_at: now })
      .eq("id", id)
      .select(ROW)
      .single();
    if (error || !data) {
      console.error("publishPost:", error);
      return { success: false, error: "Could not publish the post" };
    }
    revalidateArticles([current.slug]);
    return { success: true, post: data as PostRow };
  } catch (e) {
    return fail(e);
  }
}

/** Keeps the post a draft but marks it due to auto-publish at `scheduledAtIso`. */
export async function schedulePostAction(id: string, scheduledAtIso: string): Promise<ActionResult<{ post: PostRow }>> {
  try {
    const ctx = await requirePoster();
    const current = await loadVisiblePost(ctx, id);
    if (!current) return { success: false, error: "Post not found" };
    if (!canEditPost({ userId: ctx.user.id, isSuperuser: ctx.isSuperuser }, current)) {
      return { success: false, error: "You can only edit your own posts" };
    }
    if (current.status === "published") return { success: false, error: "This post is already published" };
    const when = new Date(scheduledAtIso);
    if (Number.isNaN(when.getTime())) return { success: false, error: "Schedule date is invalid" };
    if (when.getTime() <= Date.now()) return { success: false, error: "Schedule a time in the future" };
    const problem = validateForPublish(current);
    if (problem) return { success: false, error: problem };

    const { data, error } = await ctx.supabase
      .from("posts")
      .update({ scheduled_at: when.toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(ROW)
      .single();
    if (error || !data) {
      console.error("schedulePost:", error);
      return { success: false, error: "Could not schedule the post" };
    }
    return { success: true, post: data as PostRow };
  } catch (e) {
    return fail(e);
  }
}

/** Clears a pending schedule; the post stays a draft you can publish or reschedule normally. */
export async function cancelScheduleAction(id: string): Promise<ActionResult<{ post: PostRow }>> {
  try {
    const ctx = await requirePoster();
    const current = await loadVisiblePost(ctx, id);
    if (!current) return { success: false, error: "Post not found" };
    if (!canEditPost({ userId: ctx.user.id, isSuperuser: ctx.isSuperuser }, current)) {
      return { success: false, error: "You can only edit your own posts" };
    }
    const { data, error } = await ctx.supabase
      .from("posts")
      .update({ scheduled_at: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(ROW)
      .single();
    if (error || !data) {
      console.error("cancelSchedule:", error);
      return { success: false, error: "Could not cancel the schedule" };
    }
    return { success: true, post: data as PostRow };
  } catch (e) {
    return fail(e);
  }
}

export async function unpublishPostAction(id: string): Promise<ActionResult<{ post: PostRow }>> {
  try {
    const ctx = await requirePoster();
    const current = await loadVisiblePost(ctx, id);
    if (!current) return { success: false, error: "Post not found" };
    if (!canEditPost({ userId: ctx.user.id, isSuperuser: ctx.isSuperuser }, current)) {
      return { success: false, error: "You can only edit your own posts" };
    }
    const { data, error } = await ctx.supabase
      .from("posts")
      .update({ status: "draft", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(ROW)
      .single();
    if (error || !data) {
      console.error("unpublishPost:", error);
      return { success: false, error: "Could not unpublish the post" };
    }
    revalidateArticles([current.slug]);
    return { success: true, post: data as PostRow };
  } catch (e) {
    return fail(e);
  }
}

export async function deletePostAction(id: string): Promise<ActionResult> {
  try {
    const ctx = await requirePoster();
    const current = await loadVisiblePost(ctx, id);
    if (!current) return { success: false, error: "Post not found" };
    if (!canEditPost({ userId: ctx.user.id, isSuperuser: ctx.isSuperuser }, current)) {
      return { success: false, error: "You can only edit your own posts" };
    }
    // .select("id") makes a zero-row RLS-blocked delete distinguishable from
    // a real one: without it a blocked delete still comes back error === null.
    const { data: deleted, error } = await ctx.supabase.from("posts").delete().eq("id", id).select("id");
    if (error || !deleted || deleted.length === 0) {
      if (error) console.error("deletePost:", error);
      return { success: false, error: "Could not delete the post" };
    }
    if (current.status === "published") revalidateArticles([current.slug]);

    // Best-effort Blob cleanup under posts/<id>/. Never surfaces to the poster.
    try {
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      if (token) {
        const { blobs } = await list({ prefix: `posts/${id}/`, token });
        if (blobs.length > 0) await del(blobs.map((b) => b.url), { token });
      }
    } catch (cleanupError) {
      console.error("post blob cleanup failed:", cleanupError);
    }
    return { success: true };
  } catch (e) {
    return fail(e);
  }
}

export async function listMyPostsAction(): Promise<ActionResult<{ posts: PostRow[] }>> {
  try {
    const ctx = await requirePoster();
    // PostgREST caps a single .select() at 1000 rows regardless of table size (see
    // scripts/backfill-wp-post-ids.ts), so page through with .range() — without it,
    // superusers silently lose posts past the first 1000 and the admin page's
    // "Published · N" count reads a truncated 1000 instead of the real total.
    const PAGE_SIZE = 1000;
    const posts: PostRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let q = ctx.supabase
        .from("posts")
        .select(`${ROW}, author:profiles(username)`)
        .order("updated_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (!ctx.isSuperuser) q = q.eq("author_id", ctx.user.id);
      const { data, error } = await q;
      if (error) {
        console.error("listMyPosts:", error);
        return { success: false, error: "Could not load posts" };
      }
      posts.push(...((data ?? []) as unknown as PostRow[]));
      if (!data || data.length < PAGE_SIZE) break;
    }
    return { success: true, posts };
  } catch (e) {
    return fail(e);
  }
}

/** Tags from every post the caller can see (published + own drafts), most used first. */
export async function listTagsAction(): Promise<ActionResult<{ tags: string[] }>> {
  try {
    const ctx = await requirePoster();
    const { data, error } = await ctx.supabase.from("posts").select("tags");
    if (error) {
      console.error("listTags:", error);
      return { success: false, error: "Could not load tags" };
    }
    const counts = new Map<string, number>();
    for (const row of data ?? []) {
      for (const t of (row.tags as string[] | null) ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
    return { success: true, tags };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Card mentions and deck embeds (editor pickers + preview)
// ---------------------------------------------------------------------------

export async function searchCardsAction(query: string): Promise<ActionResult<{ cards: CardSearchHit[] }>> {
  try {
    await requirePoster();
    return { success: true, cards: searchCardNames(String(query ?? "").slice(0, 80), 12) };
  } catch (e) {
    return fail(e);
  }
}

export interface EmbeddableDeck {
  id: string;
  name: string;
  format: string | null;
  visibility: "private" | "unlisted" | "public";
  card_count: number;
  updated_at: string;
}

/** The poster's own decks, newest first, for the deck picker. */
export async function listMyDecksForEmbedAction(): Promise<ActionResult<{ decks: EmbeddableDeck[] }>> {
  try {
    const ctx = await requirePoster();
    const { data, error } = await ctx.supabase
      .from("decks")
      .select("id, name, format, visibility, card_count, updated_at")
      .eq("user_id", ctx.user.id)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return { success: true, decks: (data ?? []) as EmbeddableDeck[] };
  } catch (e) {
    return fail(e);
  }
}

const MAX_RESOLVE_BODY = 200_000;

/** Same resolution the public article page does, for the editor preview. */
export async function resolveArticleRefsAction(markdown: string): Promise<ActionResult<{ refs: ArticleRefs }>> {
  try {
    await requirePoster();
    const refs = await resolveArticleRefs(String(markdown ?? "").slice(0, MAX_RESOLVE_BODY));
    return { success: true, refs };
  } catch (e) {
    return fail(e);
  }
}
