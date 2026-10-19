// Server-only: reads API_BIBLE_KEY. Import from route handlers and server code only.
import { unstable_cache } from "next/cache";

// NASB 2020. (NASB 1995 is b8ee27bcd1cae43a-01.)
export const NASB_2020_ID = "a761ca71e0b3ddcf-01";

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

export function splitChapterText(content: string): { n: number; text: string }[] {
  const parts = content.split(/\s*\[(\d+)\]\s*/);
  const verses: { n: number; text: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    verses.push({ n: Number(parts[i]), text: parts[i + 1].replace(/\s+/g, " ").trim() });
  }
  return verses;
}

export function repairSearchText(text: string): string {
  return text
    .replace(/\bL ord\b/g, "Lord")
    .replace(/\bG od\b/g, "God")
    .replace(/\s+/g, " ")
    .replace(/ ([,;.:!?])/g, "$1")
    .trim();
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
  async (chapterId: string): Promise<ChapterPayload> => {
    const json = await getJson(
      `/bibles/${NASB_2020_ID}/chapters/${encodeURIComponent(chapterId)}?${CHAPTER_PARAMS}`,
    );
    const d = json.data;
    return {
      bookId: d.bookId,
      chapter: Number(d.number),
      verses: splitChapterText(d.content),
      prev: d.previous?.id ?? null,
      next: d.next?.id ?? null,
      copyright: d.copyright,
      fumsToken: json.meta?.fumsToken ?? "",
    };
  },
  ["api-bible-chapter"],
  { revalidate: 604800 },
);

export function fetchChapter(chapterId: string): Promise<ChapterPayload> {
  return fetchChapterCached(chapterId);
}

export async function searchVerses(query: string, limit?: number): Promise<SearchPayload> {
  const json = await getJson(
    `/bibles/${NASB_2020_ID}/search?query=${encodeURIComponent(query)}&limit=${limit ?? 20}&fums-version=3`,
  );
  const d = json.data;
  return {
    total: d.total ?? 0,
    verses: (d.verses ?? []).map((v: { id: string; reference: string; text: string }) => ({
      id: v.id,
      reference: v.reference,
      text: repairSearchText(v.text),
    })),
    fumsToken: json.meta?.fumsToken ?? "",
  };
}
