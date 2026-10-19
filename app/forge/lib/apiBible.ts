// Server-only: reads API_BIBLE_KEY. Import from route handlers and server code only.
import { unstable_cache } from "next/cache";
import { BOOKS } from "@/app/forge/lib/scriptureRef";

export type BibleEdition = "2020" | "1995";
export const NASB_2020_ID = "a761ca71e0b3ddcf-01";
export const NASB_1995_ID = "b8ee27bcd1cae43a-01";
export const BIBLE_IDS: Record<BibleEdition, string> = { "2020": NASB_2020_ID, "1995": NASB_1995_ID };
export function isBibleEdition(v: unknown): v is BibleEdition {
  return v === "2020" || v === "1995";
}

// The rights notice the chapter endpoint returns for NASB 2020. Search responses carry none,
// but the terms require it wherever text is shown.
export const NASB_COPYRIGHT =
  "NEW AMERICAN STANDARD BIBLE® NASB® Copyright © 1960, 1971, 1977,1995, 2020 by The Lockman Foundation A Corporation Not for Profit La Habra, CA All Rights Reserved www.lockman.org";
export const NASB_1995_COPYRIGHT =
  "NEW AMERICAN STANDARD BIBLE® NASB® Copyright © 1960,1962,1963,1968,1971,1972,1973,1975,1977,1995 by The Lockman Foundation A Corporation Not for Profit La Habra, CA All Rights Reserved www.lockman.org";
export const NASB_COPYRIGHTS: Record<BibleEdition, string> = { "2020": NASB_COPYRIGHT, "1995": NASB_1995_COPYRIGHT };

const BASE = "https://rest.api.bible/v1";
const CHAPTER_PARAMS =
  "content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false&fums-version=3";

export type ChapterPayload = {
  bookId: string;
  chapter: number;
  verses: { n: number; text: string }[];
  prev: string | null;
  next: string | null;
  copyright: string;
  fumsToken: string;
};

export type SearchPayload = {
  total: number;
  verses: { id: string; reference: string; text: string }[];
  copyright: string;
  fumsToken: string;
};

export class UpstreamError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

// NASB marks a "historical present" (a Greek present tense rendered as past) with an
// asterisk glued to the verb: "they *took Him along". It is translator's apparatus, not
// wording; printed cards never carry it, so it is dropped wherever text is shown or stored.
export function stripNasbMarkers(text: string): string {
  return text.replace(/\*(?=\p{L})/gu, "");
}

export function splitChapterText(content: string): { n: number; text: string }[] {
  const parts = content.split(/\s*\[(\d+)\]\s*/);
  const verses: { n: number; text: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    verses.push({ n: Number(parts[i]), text: stripNasbMarkers(parts[i + 1].replace(/\s+/g, " ").trim()) });
  }
  return verses;
}

export function repairSearchText(text: string): string {
  return stripNasbMarkers(text)
    .replace(/\bL ord\b/g, "Lord")
    .replace(/\bG od\b/g, "God")
    .replace(/\s+/g, " ")
    .replace(/ ([,;.:!?])/g, "$1")
    .trim();
}

// NASB 2020 gives every book an `intro` pseudo-chapter, so GEN.1 has previous "GEN.intro" and MAL.4 has
// next "MAT.intro". Map those to real chapters (null before Genesis 1).
export function normalizeNeighbour(id: string | null, direction: "prev" | "next"): string | null {
  if (id === null || !id.endsWith(".intro")) return id;
  const book = id.slice(0, -".intro".length);
  if (direction === "next") return `${book}.1`;
  const i = BOOKS.findIndex((b) => b.id === book);
  return i > 0 ? `${BOOKS[i - 1].id}.${BOOKS[i - 1].chapters}` : null;
}

async function getJson(path: string): Promise<any> {
  const key = process.env.API_BIBLE_KEY;
  if (!key) throw new UpstreamError("API.Bible is not configured");
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "api-key": key, accept: "application/json" },
    });
  } catch {
    throw new UpstreamError("API.Bible request failed");
  }
  if (!res.ok) throw new UpstreamError(`API.Bible responded ${res.status}`, res.status);
  try {
    return await res.json();
  } catch {
    throw new UpstreamError("API.Bible returned an unreadable response", res.status);
  }
}

const fetchChapterCached = unstable_cache(
  async (chapterId: string, edition: BibleEdition): Promise<ChapterPayload> => {
    const json = await getJson(
      `/bibles/${BIBLE_IDS[edition]}/chapters/${encodeURIComponent(chapterId)}?${CHAPTER_PARAMS}`,
    );
    const d = json.data;
    return {
      bookId: d.bookId,
      chapter: Number(d.number),
      verses: splitChapterText(d.content),
      prev: normalizeNeighbour(d.previous?.id ?? null, "prev"),
      next: normalizeNeighbour(d.next?.id ?? null, "next"),
      copyright: d.copyright ?? NASB_COPYRIGHTS[edition],
      fumsToken: json.meta?.fumsToken ?? "",
    };
  },
  ["api-bible-chapter", "v2"], // v2: asterisk markers stripped; bumps past 7-day entries cached with them
  { revalidate: 604800 },
);

export function fetchChapter(chapterId: string, edition: BibleEdition = "2020"): Promise<ChapterPayload> {
  return fetchChapterCached(chapterId, edition);
}

export async function searchVerses(query: string, limit?: number, edition: BibleEdition = "2020"): Promise<SearchPayload> {
  const json = await getJson(
    `/bibles/${BIBLE_IDS[edition]}/search?query=${encodeURIComponent(query)}&limit=${limit ?? 20}&fums-version=3`,
  );
  const d = json.data;
  return {
    total: d.total ?? 0,
    verses: (d.verses ?? []).map((v: { id: string; reference: string; text: string }) => ({
      id: v.id,
      reference: v.reference,
      text: repairSearchText(v.text),
    })),
    copyright: NASB_COPYRIGHTS[edition],
    fumsToken: json.meta?.fumsToken ?? "",
  };
}
