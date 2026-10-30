// Pure helpers shared by the renderer, the editor, and the server actions.
// No React, no Supabase, no Node-only APIs — keep it unit-testable.
import { cardNameKey } from "@/lib/cards/nameKey";

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** YouTube video id from any common URL shape, or null. */
export function youtubeId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (!YT_HOSTS.has(u.hostname)) return null;
  let id: string | null = null;
  if (u.hostname === "youtu.be") {
    id = u.pathname.slice(1).split("/")[0] || null;
  } else if (u.pathname === "/watch") {
    id = u.searchParams.get("v");
  } else {
    const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/);
    id = m ? m[1] : null;
  }
  return id && YT_ID.test(id) ? id : null;
}

const AUDIO_EXT = /\.(mp3|m4a|ogg|wav)$/i;

/** True when the URL's path ends in an audio extension (query string ignored). */
export function isAudioUrl(url: string): boolean {
  if (!url) return false;
  try {
    return AUDIO_EXT.test(new URL(url, "https://placeholder.invalid").pathname);
  } catch {
    return false;
  }
}

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MAX_SLUG = 80;

/** URL slug from a title: ascii, lowercase, hyphen-joined, ≤ 80 chars. */
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019""\u201c\u201d]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, "");
}

/** Plain-text excerpt for cards, metadata, and the feed. */
export function excerptFromMarkdown(md: string, max = 200): string {
  const text = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\[([^\[\]\n]+?)\]\]/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s,;:.!?-]+$/, "") + "…";
}

// ---------------------------------------------------------------------------
// Card mentions and deck embeds
// (docs/superpowers/specs/2026-09-07-article-card-deck-embeds-design.md)
// ---------------------------------------------------------------------------

/** `[[Card Name]]` — no brackets or newlines inside; whitespace around the name is ignored. */
export const CARD_MENTION_RE = /\[\[([^\[\]\n]+?)\]\]/g;

/** Lookup key for a mention — the shared loose card-name key. */
export const mentionKey = cardNameKey;

/**
 * `[[Card Name]]`, or `[[Card Name|as written]]` when the words on the page are
 * not the card's name — an author's shorthand, or a name like "Jacob" that the
 * index would resolve to somebody else's Jacob.
 */
export function parseMention(inner: string): { target: string; label: string } {
  const bar = inner.indexOf("|");
  const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
  if (bar < 0) {
    const target = tidy(inner);
    return { target, label: target };
  }
  const target = tidy(inner.slice(0, bar));
  const label = tidy(inner.slice(bar + 1));
  return { target, label: label || target };
}

const FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;

/**
 * `[[Son of God]]` → `Son of God`, for the places a description is shown as
 * plain text (meta/OG tags, the public API) where the brackets read as a typo.
 */
export function flattenCardMentions(text: string): string {
  return text.replace(CARD_MENTION_RE, (_match, inner: string) => parseMention(inner).label);
}

const IMAGE_RE = /!\[[^\]]*\]\(\s*<?(https?:\/\/[^\s)>]+)/g;

/** Distinct absolute image URLs (`![alt](url)`) outside code, in document order, capped. */
export function extractImageUrls(md: string, max = 30): string[] {
  const text = md.replace(FENCE_RE, "").replace(INLINE_CODE_RE, "");
  const urls = new Set<string>();
  for (const m of text.matchAll(IMAGE_RE)) {
    urls.add(m[1]);
    if (urls.size >= max) break;
  }
  return [...urls];
}

// A paragraph that is one link and nothing else: bare, `<url>`, or `[text](url)`.
const SOLE_LINK_RE = /^(?:<(\S+)>|\[[^\]]*\]\((\S+?)\)|(\S+))$/;

/**
 * Id of the first YouTube video the body embeds, or null. Same rule as the
 * renderer: only a paragraph that is nothing but the link becomes an embed.
 */
export function embeddedYoutubeId(md: string): string | null {
  for (const para of md.replace(FENCE_RE, "").split(/\n\s*\n/)) {
    const m = para.trim().match(SOLE_LINK_RE);
    const id = m ? youtubeId(m[1] ?? m[2] ?? m[3]) : null;
    if (id) return id;
  }
  return null;
}

/** Distinct mention names (as typed) outside code, in document order, capped. */
export function extractCardMentions(md: string, max = 200): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const text = md.replace(FENCE_RE, " ").replace(INLINE_CODE_RE, " ");
  for (const m of text.matchAll(CARD_MENTION_RE)) {
    const name = parseMention(m[1]).target;
    const key = mentionKey(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length === max) break;
  }
  return out;
}

/**
 * True when the edit that just landed completed a fresh `[[` at the caret, so
 * the editor should open the card picker. Shared by the article editor and the
 * deck-description editors.
 *
 * `inputType` is skipped for undo: reverting a pick leaves the "[[" behind and
 * must not reopen the dialog. A third bracket on either side means the author
 * is typing something else.
 */
export function opensCardPicker(value: string, caret: number, inputType?: string): boolean {
  return (
    inputType !== "historyUndo" &&
    caret >= 2 &&
    value.slice(caret - 2, caret) === "[[" &&
    value[caret - 3] !== "[" &&
    value[caret] !== "["
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Hosts whose /decklist/<uuid> links embed. Anything else stays a plain link.
const DECK_HOSTS = [/(^|\.)landofredemption\.com$/, /(^|\.)redemptionccg\.app$/, /^localhost$/, /^127\.0\.0\.1$/, /\.vercel\.app$/];

/** Deck id from a deck-page URL (absolute on one of our hosts, or root-relative), else null. */
export function deckIdFromUrl(url: string): string | null {
  const s = url.trim();
  let u: URL;
  try {
    u = new URL(s, "https://placeholder.invalid");
  } catch {
    return null;
  }
  const relative = u.hostname === "placeholder.invalid";
  if (relative ? !s.startsWith("/") : !DECK_HOSTS.some((re) => re.test(u.hostname))) return null;
  const m = u.pathname.match(/^\/decklist\/([^/]+)\/?$/);
  return m && UUID_RE.test(m[1]) ? m[1].toLowerCase() : null;
}

const DECK_URL_RE = /(?:https?:\/\/[^\s<>()\[\]]+)?\/decklist\/[0-9a-fA-F-]{36}\b/g;

/** Distinct deck ids referenced anywhere in the markdown, in document order, capped. */
export function extractDeckIds(md: string, max = 10): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(DECK_URL_RE)) {
    const id = deckIdFromUrl(m[0]);
    if (id && !out.includes(id)) out.push(id);
    if (out.length === max) break;
  }
  return out;
}
