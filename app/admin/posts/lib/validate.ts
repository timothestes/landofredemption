import { SLUG_RE, MAX_SLUG } from "@/app/articles/lib/markdown";

export const MAX_TITLE = 200;
export const MAX_EXCERPT = 500;
export const MAX_TAGS = 10;
export const MAX_TAG_LEN = 40;

export interface PostPatch {
  title: string;
  slug: string;
  excerpt: string | null;
  body_md: string;
  cover_image_url: string | null;
  tags: string[];
  published_at: string | null;
}

/** Trim, collapse whitespace, drop empties/overlong, dedupe case-insensitively (first spelling wins), cap at MAX_TAGS. */
export function normalizeTags(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const t = r.trim().replace(/\s+/g, " ");
    const key = t.toLowerCase();
    if (!t || t.length > MAX_TAG_LEN || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/** Error message for a save, or null when the patch is acceptable. */
export function validatePatch(p: PostPatch): string | null {
  const title = p.title.trim();
  if (title.length === 0) return "Title is required";
  if (title.length > MAX_TITLE) return `Title must be ${MAX_TITLE} characters or fewer`;
  if (!SLUG_RE.test(p.slug) || p.slug.length > MAX_SLUG) {
    return "Slug may only contain lowercase letters, numbers and single hyphens";
  }
  if (p.excerpt !== null && p.excerpt.length > MAX_EXCERPT) return `Excerpt must be ${MAX_EXCERPT} characters or fewer`;
  if (p.tags.length > MAX_TAGS) return `At most ${MAX_TAGS} tags`;
  if (p.cover_image_url !== null && !/^https:\/\//.test(p.cover_image_url)) return "Cover image must be an https URL";
  if (p.published_at !== null && Number.isNaN(Date.parse(p.published_at))) return "Publish date is invalid";
  return null;
}

/** Extra gate for Publish: drafts may be empty, published posts may not. */
export function validateForPublish(row: { title: string; body_md: string }): string | null {
  const title = row.title.trim();
  if (!title || title.toLowerCase() === "untitled") return "Give the post a title before publishing";
  if (!row.body_md.trim()) return "Write something before publishing";
  return null;
}

/**
 * Edit/delete predicate: RLS's posts_select_published policy lets any
 * authenticated user READ another poster's published post, so visibility
 * must never be mistaken for editability. Only the owner or the superuser
 * may mutate a row.
 */
export function canEditPost(ctx: { userId: string; isSuperuser: boolean }, row: { author_id: string }): boolean {
  return ctx.isSuperuser || row.author_id === ctx.userId;
}
