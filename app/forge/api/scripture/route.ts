import { requireForge, notFoundResponse } from "@/app/forge/lib/auth";
import { parseRef, bookById } from "@/app/forge/lib/scriptureRef";
import { fetchChapter, searchVerses, isBibleEdition, isValidRange, UpstreamError } from "@/app/forge/lib/apiBible";

export const dynamic = "force-dynamic";

// Forge-gated Scripture lookup for the verse finder panel. Exactly one of
// ?ref= (free-text reference), ?chapter= (API.Bible chapter id) or ?q= (keywords).
// Upstream bodies, headers and the API key never leave this route.

const CHAPTER_ID = /^[1-3]?[A-Z]{2,3}\.\d{1,3}$/;

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function GET(req: Request): Promise<Response> {
  const ctx = await requireForge();
  if (!ctx) return notFoundResponse(); // 404, never 401/403 — the area stays secret

  const params = new URL(req.url).searchParams;
  const ref = params.get("ref");
  const chapter = params.get("chapter");
  const q = params.get("q");
  if ([ref, chapter, q].filter((v) => v !== null).length !== 1) {
    return json({ error: "bad_request" }, 400);
  }
  // Edition: NASB 2020 unless the panel asks for 1995.
  const bible = params.get("bible") ?? "2020";
  if (!isBibleEdition(bible)) return json({ error: "bad_request" }, 400);

  let chapterId: string;
  let range: { from: number; to: number };
  let strict = false;

  if (q !== null) {
    const query = q.trim().replace(/\s+/g, " ");
    if (!query) return json({ error: "empty_query" }, 400);
    if (query.length > 200) return json({ error: "bad_request" }, 400);
    const rangeParam = params.get("range");
    const sort = params.get("sort") ?? "relevance";
    const exactParam = params.get("exact");
    const offsetParam = params.get("offset") ?? "0";
    if (
      (rangeParam !== null && !isValidRange(rangeParam)) ||
      (sort !== "relevance" && sort !== "canonical") ||
      (exactParam !== null && exactParam !== "1") ||
      !/^\d{1,3}$/.test(offsetParam) ||
      Number(offsetParam) > 100
    ) {
      return json({ error: "bad_request" }, 400);
    }
    try {
      return json(
        await searchVerses(
          query,
          { limit: 25, offset: Number(offsetParam), range: rangeParam ?? undefined, sort, exact: exactParam === "1" },
          bible,
        ),
      );
    } catch (err) {
      return upstream(err);
    }
  } else if (ref !== null) {
    const parsed = parseRef(ref);
    if (!parsed) return json({ error: "unrecognized_reference" }, 400);
    chapterId = `${parsed.bookId}.${parsed.chapter}`;
    range = { from: parsed.from, to: parsed.to };
    strict = true;
  } else {
    if (!CHAPTER_ID.test(chapter!)) return json({ error: "bad_request" }, 400);
    chapterId = chapter!;
    range = { from: 1, to: 1 };
  }

  try {
    const payload = await fetchChapter(chapterId, bible);
    if (strict && range.to > payload.verses.length) {
      return json({ error: "verse_out_of_range", verseCount: payload.verses.length }, 404);
    }
    return json({
      ...payload,
      book: bookById(payload.bookId)?.name ?? payload.bookId,
      requested: range,
    });
  } catch (err) {
    return upstream(err);
  }
}

function upstream(err: unknown): Response {
  console.warn("[scripture] upstream", err instanceof UpstreamError ? err.status : undefined);
  return json({ error: "upstream" }, 502);
}
