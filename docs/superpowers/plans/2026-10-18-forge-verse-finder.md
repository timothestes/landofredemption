# Forge Verse Finder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A verse finder under the ability text in the Forge card studio that fetches NASB 2020 chapters from API.Bible, trims an excerpt with two word handles, shows it wrapped as the card prints it, and writes `reference` + `scripture` with one action.

**Architecture:** Three pure modules (reference parser, excerpt/trim, API.Bible text handling) carry all the logic and all the unit tests. One forge-gated GET route wraps API.Bible with a 7-day chapter cache. Two client components: `ScriptureFields` (the two fields, moved out of the Card details drawer, plus the toggle button and status slot) and `VerseFinderPanel` (input + hint, search results, chapter view with handles, readout, commit, footer).

**Tech Stack:** Next.js 15 App Router route handler, `unstable_cache`, React 19 client components, Tailwind, vitest (node, no DOM), existing `textFit`/`wrapLines`.

**Spec:** `docs/superpowers/specs/2026-10-18-forge-verse-finder-design.md`

## Global Constraints

- Work only in the worktree `/Users/timestes/projects/rtt-verse-finder` (branch `forge-verse-finder`), absolute paths; never touch `/Users/timestes/projects/redemption-tournament-tracker`.
- NASB 2020 bible id `a761ca71e0b3ddcf-01` (named constant); NASB 1995 `b8ee27bcd1cae43a-01` in a comment only.
- Upstream base `https://rest.api.bible/v1`, header `api-key: <API_BIBLE_KEY>`, always `fums-version=3`.
- Chapter request params exactly: `content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false&fums-version=3`.
- Ellipsis is U+2026 `…` with no surrounding spaces. Verse wording is never altered.
- Canonical references: Roman numerals (`I Samuel`, `II Chronicles`, `III John`), `Psalm` singular, `Song of Solomon`, hyphen ranges with no spaces (`5:11-12`).
- Chapter cache: `unstable_cache`, key `["api-bible-chapter", chapterId]`, `revalidate: 604800`. Searches uncached.
- Route is forge-gated: `requireForge()` null → `notFoundResponse()`. Upstream failure or missing key → `502 { error: "upstream" }`. Never forward upstream bodies/headers.
- UI: green (`primary`) only for the **Use on card** button and the selection highlight `bg-primary/15`; no `focus:ring-*`; no `role="dialog"`; no backdrop; no toasts.
- Copy fixed by the spec: button labels `Look up <canonical>` / `Find verse`; input placeholder `Genesis 6:2, or words you remember`; hints `→ <canonical>`, `Keyword search`, `Did you mean <Book>?`, `Try "Genesis 6:2" or words from the verse.`; status `Used · → next card`; errors `No verses matched.`, `Couldn't reach API.Bible. Type the verse by hand for now.`, `Can't fit without the ability shrinking`; footer `Scripture text from API.Bible` linking `https://api.bible`; chip suffix ` · last used` on the first chip.
- Tests: `npx vitest run <path>`; types: `npx tsc --noEmit`. Node-only vitest: no component rendering tests.
- Commits: `git add` only the task's files; message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A verse past the chapter's end (`Genesis 6:30`, 22 verses): the parser accepts it; the route must 404 and the panel must say so, not show a blank chapter. → Task 4 route test `verse out of range → 404 with verseCount`; Task 6 renders `Genesis 6 has 22 verses.` from that body.
2. Multi-reference strings already on cards (`Genesis 6:2; Matthew 1:1`, `Rev 19:15 (Rev 19:11)`): the hint must say the reference is invalid and never fetch or search. → Task 1 `classify` test.
3. Bracketed text inside a verse: splitting must only consume `[digits]` markers. → Task 3 split test with `[Selah]`-style content.
4. Handles meeting: an empty excerpt must be impossible; `trimToFit` must stop at three words. → Task 2 tests `start never passes end` and `trimToFit floor`.
5. Quota exhausted (upstream `429`) or key unset: route `502`, panel shows the by-hand message, textarea still editable. → Task 4 tests `429 → 502`, `missing key → 502 without calling fetch`.

## Setup (once, before Task 1)

```bash
cd /Users/timestes/projects/rtt-verse-finder
cp -Rc /Users/timestes/projects/redemption-tournament-tracker/node_modules ./node_modules   # CoW clone, ~7 s; never symlink
cp /Users/timestes/projects/redemption-tournament-tracker/.env.local .env.local               # carries API_BIBLE_KEY
npx vitest run app/forge/lib/__tests__/textFit.test.ts   # sanity: PASS
```

---

### Task 1: Reference parser

**Files:**
- Create: `app/forge/lib/scriptureRef.ts`
- Test: `app/forge/lib/__tests__/scriptureRef.test.ts`

**Interfaces:**
- Consumes: `getTestamentForRef` from `@/app/decklist/card-search/data/testament`.
- Produces:
  ```ts
  export type ParsedRef = { bookId: string; book: string; chapter: number; from: number; to: number };
  export type Book = { id: string; name: string; chapters: number; aliases: string[] };
  export const BOOKS: readonly Book[];                       // 66, canonical order GEN…REV
  export function parseRef(text: string): ParsedRef | null;
  export function canonicalRef(bookId: string, chapter: number, from: number, to: number): string;
  export function bookById(id: string): Book | undefined;
  export function suggestBook(token: string): string | null;  // canonical name or null
  export type Classified =
    | { kind: "empty" } | { kind: "ref"; ref: ParsedRef } | { kind: "suggest"; book: string; rest: string }
    | { kind: "invalid"; book: string } | { kind: "search" };
  export function classify(text: string): Classified;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
describe("parseRef", () => {
  it.each([
    ["Gen 6:2", { bookId: "GEN", book: "Genesis", chapter: 6, from: 2, to: 2 }],
    ["genesis 6:2.", { bookId: "GEN", chapter: 6, from: 2, to: 2 }],
    ["II Chr 5:11-12", { bookId: "2CH", book: "II Chronicles", chapter: 5, from: 11, to: 12 }],
    ["1 Chronicles 5:11", { bookId: "1CH", book: "I Chronicles" }],
    ["1Sam 17:4", { bookId: "1SA" }], ["I Sam 17:4", { bookId: "1SA" }],
    ["Ps 60:5", { bookId: "PSA", book: "Psalm" }], ["Psalms 23", { bookId: "PSA", chapter: 23, from: 1, to: 1 }],
    ["Song of Songs 2:1", { bookId: "SNG", book: "Song of Solomon" }], ["Canticles 2:1", { bookId: "SNG" }],
    ["Rev 12:7-8", { bookId: "REV", from: 7, to: 8 }], ["Phil 4:13", { bookId: "PHP" }], ["Philem 1:6", { bookId: "PHM" }],
    ["3 John 1:4", { bookId: "3JN", book: "III John" }], ["Jude 1:3", { bookId: "JUD" }],
  ])("parses %s", (text, expected) => expect(parseRef(text)).toMatchObject(expected));
  it.each(["Gen", "Gen 6:", "Gen 6:2-5:1", "Genesis 51", "Genesis 0:1", "Gen 6:5-2", "wells Philistines", ""])(
    "rejects %s", (text) => expect(parseRef(text)).toBeNull());
});
describe("canonicalRef", () => {
  it("formats single verses and ranges", () => {
    expect(canonicalRef("2CH", 5, 11, 12)).toBe("II Chronicles 5:11-12");
    expect(canonicalRef("PSA", 60, 5, 5)).toBe("Psalm 60:5");
  });
  it("classifies as a testament for every book", () => {
    for (const b of BOOKS) expect(getTestamentForRef(canonicalRef(b.id, 1, 1, 1)), b.name).not.toBeNull();
  });
});
describe("suggestBook", () => {
  it("fixes near misses and ignores exact names", () => {
    expect(suggestBook("Pslam")).toBe("Psalm"); expect(suggestBook("Jhn")).toBe("John");
    expect(suggestBook("Genesis")).toBeNull(); expect(suggestBook("wells")).toBeNull();
  });
});
describe("classify", () => {
  it.each([
    ["", { kind: "empty" }], ["Gen 6:2", { kind: "ref" }], ["Pslam 23", { kind: "suggest", book: "Psalm", rest: "23" }],
    ["Genesis 6:2; Matthew 1:1", { kind: "invalid", book: "Genesis" }], ["Rev 19:15 (Rev 19:11)", { kind: "invalid" }],
    ["Genesis", { kind: "invalid", book: "Genesis" }], ["wells Philistines", { kind: "search" }],
  ])("classifies %s", (text, expected) => expect(classify(text)).toMatchObject(expected));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/forge/lib/__tests__/scriptureRef.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `app/forge/lib/scriptureRef.ts`**

`BOOKS` is a literal array of 66 entries with OSIS ids (`GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV`), canonical names per Global Constraints, real chapter counts, and aliases in lowercase without numerals (the numeral prefix is normalized separately: `1`/`I`/`i`, `2`/`II`, `3`/`III`, with or without a space). Matching: lowercase, strip a trailing `.`, longest alias first. Grammar: `^<book>\s+(\d+)(?::(\d+)(?:-(\d+))?)?$`; chapter must be `1..chapters`; verses ≥ 1 and `to ≥ from`. `suggestBook`: Damerau-Levenshtein ≤ 2 against every name and alias (lowercased), return the canonical name, `null` on an exact match or no hit. `classify`: empty → `empty`; `parseRef` ok → `ref`; leading token(s) match a book but the rest fails the grammar → `invalid`; first token suggests a book → `suggest` with `rest` = the remainder; else `search`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run app/forge/lib/__tests__/scriptureRef.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/scriptureRef.ts app/forge/lib/__tests__/scriptureRef.test.ts
git commit -m "feat(forge): scripture reference parser with canonical house form"
```

---

### Task 2: Excerpt and trim-to-fit

**Files:**
- Create: `app/forge/lib/verseExcerpt.ts`
- Test: `app/forge/lib/__tests__/verseExcerpt.test.ts`

**Interfaces:**
- Consumes: `textFit` and `DesignCard` (`@/app/forge/lib/textFit`, `@/app/forge/lib/designCard`).
- Produces:
  ```ts
  export type Verse = { n: number; text: string };
  export type Handle = { verse: number; word: number };          // verse = Verse.n; word index, start inclusive / end exclusive
  export type Handles = { start: Handle; end: Handle };
  export function words(text: string): string[];                 // split on whitespace runs
  export function excerpt(verses: Verse[], h: Handles): { text: string; from: number; to: number };
  export function clampHandles(verses: Verse[], h: Handles): Handles;  // keeps ≥ 1 word selected, inside the chapter
  export function moveHandle(verses: Verse[], h: Handles, which: "start" | "end", delta: -1 | 1): Handles;
  export function snapHandle(verses: Verse[], h: Handles, which: "start" | "end", edge: "home" | "end"): Handles;
  export function wholeRange(verses: Verse[], from: number, to: number): Handles;
  export function trimToFit(verses: Verse[], h: Handles, card: DesignCard): Handles | null;
  ```

- [ ] **Step 1: Write the failing tests**

Fixture verses (NASB 2020 Genesis 6:1-3 and Revelation 12:7-8 exactly as the API returns them):
```ts
const gen6 = [
  { n: 1, text: "Now it came about, when mankind began to multiply on the face of the land, and daughters were born to them," },
  { n: 2, text: "that the sons of God saw that the daughters of mankind were beautiful; and they took wives for themselves, whomever they chose." },
  { n: 3, text: "Then the Lord said, “My Spirit will not remain with man forever, because he is also flesh; nevertheless his days shall be 120 years.”" },
];
const rev12 = [
  { n: 7, text: "And there was war in heaven, Michael and his angels waging war with the dragon. The dragon and his angels waged war," },
  { n: 8, text: "and they did not prevail, and there was no longer a place found for them in heaven." },
];
it("a whole verse that is a whole sentence gets no ellipsis", () =>
  expect(excerpt(gen6, wholeRange(gen6, 3, 3))).toEqual({ text: gen6[2].text, from: 3, to: 3 }));
it("a whole verse that opens mid-sentence (lowercase) gets a leading …", () =>
  expect(excerpt(gen6, wholeRange(gen6, 2, 2))).toEqual({ text: "…" + gen6[1].text, from: 2, to: 2 }));
it("a whole verse that closes mid-sentence (trailing comma) gets a trailing … in place of the comma", () =>
  expect(excerpt(rev12, wholeRange(rev12, 7, 7)).text)
    .toBe("And there was war in heaven, Michael and his angels waging war with the dragon. The dragon and his angels waged war…"));
it("leading cut adds … with no space and keeps the sentence end", () =>
  expect(excerpt(gen6, { start: { verse: 2, word: 1 }, end: { verse: 2, word: words(gen6[1].text).length } }).text)
    .toBe("…the sons of God saw that the daughters of mankind were beautiful; and they took wives for themselves, whomever they chose."));
it("a mid-verse trailing cut adds …", () =>
  expect(excerpt(rev12, { start: { verse: 7, word: 0 }, end: { verse: 7, word: 20 } }).text)
    .toBe("And there was war in heaven, Michael and his angels waging war with the dragon. The dragon and his angels…"));
it("mid-6:1 to end-6:2 spans 1..2 with a leading …", () => {
  const r = excerpt(gen6, { start: { verse: 1, word: 10 }, end: { verse: 2, word: words(gen6[1].text).length } });
  expect(r).toMatchObject({ from: 1, to: 2 }); expect(r.text.startsWith("…the face of the land,")).toBe(true);
});
it("all of verse 8 after a 7-8 lookup is 8..8 (leading … because it opens lowercase, no trailing)", () =>
  expect(excerpt(rev12, wholeRange(rev12, 8, 8))).toEqual({ text: "…" + rev12[1].text, from: 8, to: 8 }));
it("a cut after a sentence end adds no ellipsis", () =>
  expect(excerpt(rev12, { start: { verse: 7, word: 0 }, end: { verse: 7, word: 15 } }).text.endsWith("dragon.")).toBe(true));
it("drops an opening quote at the cut start and keeps a closing quote after a sentence end", () => {
  const v = [{ n: 1, text: "Then the Lord said to Noah, “Enter the ark, you and all your household.”" }];
  expect(excerpt(v, { start: { verse: 1, word: 6 }, end: { verse: 1, word: 14 } }).text).toBe("…Enter the ark, you and all your household.”");
});
it("start never passes end; at least one word stays selected", () => {
  const h = clampHandles(gen6, { start: { verse: 2, word: 5 }, end: { verse: 2, word: 5 } });
  expect(excerpt(gen6, h).text.length).toBeGreaterThan(0);
  expect(moveHandle(gen6, { start: { verse: 2, word: 4 }, end: { verse: 2, word: 5 } }, "start", 1).start).toEqual({ verse: 2, word: 4 });
});
it("moveHandle crosses verse boundaries; snapHandle goes to the verse edge", () => {
  expect(moveHandle(gen6, wholeRange(gen6, 2, 2), "start", -1).start).toEqual({ verse: 1, word: words(gen6[0].text).length - 1 });
  expect(snapHandle(gen6, { start: { verse: 2, word: 5 }, end: { verse: 2, word: 9 } }, "end", "end").end).toEqual({ verse: 2, word: words(gen6[1].text).length });
});
it("trimToFit: unchanged when it fits, shorter with over === 0 when it can, null at the three-word floor", () => {
  const h = wholeRange(gen6, 1, 2);
  expect(trimToFit(gen6, h, { rawText: "Negate an Enhancement." } as DesignCard)).toEqual(h);
  // Pick a sentence count that overflows against both verses but fits against a shorter excerpt
  // (confirm with textFit while writing the test; 5–7 sentences of this length lands in that window).
  const medium = { rawText: Array(6).fill("Negate and discard an evil character in battle.").join(" ") } as DesignCard;
  expect(textFit({ ...medium, scripture: excerpt(gen6, h).text }).over).toBeGreaterThan(0);
  const trimmed = trimToFit(gen6, h, medium)!;
  expect(trimmed).not.toBeNull();
  expect(textFit({ ...medium, scripture: excerpt(gen6, trimmed).text }).over).toBe(0);
  expect(excerpt(gen6, trimmed).text.length).toBeLessThan(excerpt(gen6, h).text.length);
  const hopeless = { rawText: Array(12).fill("Negate and discard an evil character in battle.").join(" ") } as DesignCard;
  expect(trimToFit(gen6, h, hopeless)).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/forge/lib/__tests__/verseExcerpt.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `app/forge/lib/verseExcerpt.ts`**

`excerpt`: slice words per verse between the handles, join with single spaces. Leading `…` iff `start.word > 0` **or** the first kept word (after stripping a leading `“` `‘` `"`) starts with a lowercase letter; trailing `…` iff (`end.word < words(verse to).length` **or** the last kept word ends in `,` `;` `:`) **and** the last kept word does not end in `.` `!` `?` (optionally followed by `”` `’` `"`). When adding a trailing `…`, first strip a trailing `,` `;` `:`; when adding a leading `…`, strip the leading opening quote. `trimToFit`: loop `moveHandle(…, "end", -1)` while `textFit({ ...card, scripture: excerpt(...).text }).over > 0`; stop with `null` when fewer than three words would remain; return the input unchanged when it already fits.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run app/forge/lib/__tests__/verseExcerpt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/verseExcerpt.ts app/forge/lib/__tests__/verseExcerpt.test.ts
git commit -m "feat(forge): verse excerpt with ellipsis rules and trim-to-fit"
```

---

### Task 3: API.Bible client (server-only)

**Files:**
- Create: `app/forge/lib/apiBible.ts`
- Create: `app/forge/lib/__tests__/fixtures/apiBible/genesis-6.json` (copy the `data` object of `/private/tmp/claude-501/-Users-timestes-projects-redemption-tournament-tracker/b205a21c-c6ff-4273-9261-c751353dd8f7/scratchpad/chapter-text.json`, wrapped as `{ "data": …, "meta": { "fumsToken": "fixture-token" } }`)
- Create: `app/forge/lib/__tests__/fixtures/apiBible/search-wells.json` (same treatment of `…/scratchpad/search.json`; it contains the `L ord` / `G od` artefacts on Amos 1:8, Genesis 26:18, 1 Chronicles 11:18, 2 Samuel 23:16)
- Test: `app/forge/lib/__tests__/apiBible.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const NASB_2020_ID = "a761ca71e0b3ddcf-01";
  export type ChapterPayload = { bookId: string; chapter: number; verses: { n: number; text: string }[]; prev: string | null; next: string | null; copyright: string; fumsToken: string };
  export type SearchPayload = { total: number; verses: { id: string; reference: string; text: string }[]; fumsToken: string };
  export class UpstreamError extends Error { status?: number }
  export function splitChapterText(content: string): { n: number; text: string }[];
  export function repairSearchText(text: string): string;
  export function fetchChapter(chapterId: string): Promise<ChapterPayload>;   // unstable_cache, 7 days; throws UpstreamError
  export function searchVerses(query: string, limit?: number): Promise<SearchPayload>;  // uncached; throws UpstreamError
  ```

- [ ] **Step 1: Write the failing tests**

```ts
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
it("splits [n] markers into 22 verses with exact text", () => {
  const v = splitChapterText(genesis6.data.content);
  expect(v).toHaveLength(22);
  expect(v[1]).toEqual({ n: 2, text: "that the sons of God saw that the daughters of mankind were beautiful; and they took wives for themselves, whomever they chose." });
  expect(v[2].text.startsWith("Then the Lord said, “My Spirit")).toBe(true);
});
it("only [digits] split; other brackets survive", () =>
  expect(splitChapterText(" [1] Praise Him [Selah] now [2] again")).toEqual([{ n: 1, text: "Praise Him [Selah] now" }, { n: 2, text: "again" }]));
it("repairs small-caps artefacts and doubled spaces for display", () => {
  expect(repairSearchText("to the L ord ; and  then")).toBe("to the Lord; and then");
  expect(repairSearchText("Says the Lord  G od .")).toBe("Says the Lord God.");
});
it("fetchChapter sends the key and the exact params, returns prev/next and the token", async () => {
  process.env.API_BIBLE_KEY = "k";
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(genesis6), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const c = await fetchChapter("GEN.6");
  expect(fetchMock.mock.calls[0][0]).toBe(`https://rest.api.bible/v1/bibles/${NASB_2020_ID}/chapters/GEN.6?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false&fums-version=3`);
  expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ "api-key": "k" });
  expect(c).toMatchObject({ bookId: "GEN", chapter: 6, prev: "GEN.5", next: "GEN.7", fumsToken: "fixture-token" });
  expect(c.copyright.startsWith("NEW AMERICAN STANDARD BIBLE")).toBe(true);
});
it("fetchChapter throws UpstreamError with the status on non-2xx, and without the key before fetching", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 429 })));
  await expect(fetchChapter("GEN.6")).rejects.toMatchObject({ status: 429 });
  delete process.env.API_BIBLE_KEY;
  const f = vi.fn(); vi.stubGlobal("fetch", f);
  await expect(fetchChapter("GEN.6")).rejects.toBeInstanceOf(UpstreamError);
  expect(f).not.toHaveBeenCalled();
});
it("searchVerses repairs text, collapses whitespace, and forwards total", async () => {
  process.env.API_BIBLE_KEY = "k";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(searchWells), { status: 200 })));
  const s = await searchVerses("wells Philistines");
  expect(s.total).toBe(5);
  expect(s.verses.find((v) => v.id === "GEN.26.18")!.text).not.toMatch(/L ord|  /);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/forge/lib/__tests__/apiBible.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `app/forge/lib/apiBible.ts`**

No `server-only` import (it throws under vitest and nothing else in `app/forge/lib` uses it); instead a header comment: `// Server-only: reads API_BIBLE_KEY. Import from route handlers and server code only.` `splitChapterText`: `content.split(/\s*\[(\d+)\]\s*/)` pairs numbers with the following text; trim and collapse `\s+` to one space. `repairSearchText`: replace `/\bL ord\b/g` → `Lord`, `/\bG od\b/g` → `God`, then collapse whitespace and remove a space before `,;.:!?`. `fetchChapter` is `unstable_cache(async (id) => …, ["api-bible-chapter"], { revalidate: 604800 })` applied around the raw fetch; `prev`/`next` from `data.previous?.id ?? null` / `data.next?.id ?? null`; `chapter` is `Number(data.number)`. Search URL: `/bibles/${NASB_2020_ID}/search?query=${encodeURIComponent(q)}&limit=${limit ?? 20}&fums-version=3`. `UpstreamError` is thrown for a missing key (no fetch), network errors, and non-2xx.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run app/forge/lib/__tests__/apiBible.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/apiBible.ts app/forge/lib/__tests__/apiBible.test.ts app/forge/lib/__tests__/fixtures/apiBible/
git commit -m "feat(forge): API.Bible client with cached chapters and search hygiene"
```

---

### Task 4: Scripture route

**Files:**
- Create: `app/forge/api/scripture/route.ts`
- Test: `app/forge/api/scripture/__tests__/route.test.ts`
- Modify: `.env.example` (append `API_BIBLE_KEY=`)

**Interfaces:**
- Consumes: Task 1 `parseRef`, `bookById`; Task 3 `fetchChapter`, `searchVerses`, `UpstreamError`; `requireForge`, `notFoundResponse` from `@/app/forge/lib/auth`.
- Produces (JSON bodies the panel reads):
  ```ts
  // GET ?ref=<text>  |  ?chapter=GEN.7  |  ?q=<keywords>
  type ChapterResponse = ChapterPayload & { book: string; requested: { from: number; to: number } };
  type SearchResponse = SearchPayload;
  // errors: 400 { error: "unrecognized_reference" | "empty_query" | "bad_request" }
  //         404 { error: "verse_out_of_range", verseCount: number }   (also 404 for non-members, no body)
  //         502 { error: "upstream" }
  ```

- [ ] **Step 1: Write the failing tests** (mock `@/app/forge/lib/auth` like the export route test; mock `@/app/forge/lib/apiBible` with `vi.fn()`s)

```ts
it("404s non-members without touching API.Bible", …);                           // requireForge → null
it("ref: returns the chapter, book name and requested range", …);               // ?ref=Gen%206:2 → 200, body.requested {2,2}, body.book "Genesis", fetchChapter called with "GEN.6"
it("ref: 400 unrecognized_reference and no fetch", …);                           // ?ref=Pslam%2023
it("ref: 404 verse_out_of_range with verseCount", …);                            // ?ref=Genesis%206:30 against a 22-verse chapter
it("chapter: requested defaults to 1..1", …);                                    // ?chapter=GEN.7
it("chapter: 400 bad_request on a malformed id", …);                             // ?chapter=../etc
it("q: trims and collapses whitespace, 400 empty_query on blank", …);           // ?q=%20wells%20%20Philistines%20 → searchVerses("wells Philistines")
it("502 upstream when the client throws, for 429 and for a missing key", …);    // body { error: "upstream" }, no upstream text leaks
it("400 when none or more than one of ref/chapter/q is given", …);
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/forge/api/scripture/__tests__/route.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `app/forge/api/scripture/route.ts`**

`export const dynamic = "force-dynamic"`; `export async function GET(req: Request): Promise<Response>`. Chapter id validation `^[1-3]?[A-Z]{2,3}\.\d{1,3}$`. For `ref`, `requested.to > verses.length` → 404 with `verseCount`. Catch `UpstreamError` (and any thrown error) → `console.warn("[scripture] upstream", err.status)` and `502`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run app/forge/api/scripture/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Smoke the gate** (worktree `.env.local` copied in Setup)

Run: `npm run dev -- -p 3011` in the background, then `curl -s -o /dev/null -w "%{http_code}" "http://localhost:3011/forge/api/scripture?ref=Gen%206:2"`.
Expected: `404` for an anonymous caller. Stop the dev server. (The authenticated path is driven end to end in Task 7, Step 4.)

- [ ] **Step 6: Commit**

```bash
git add app/forge/api/scripture/route.ts app/forge/api/scripture/__tests__/route.test.ts .env.example
git commit -m "feat(forge): forge-gated scripture lookup route"
```

---

### Task 5: Recent chapters helper

**Files:**
- Create: `app/forge/lib/recentChapters.ts`
- Test: `app/forge/lib/__tests__/recentChapters.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const RECENT_KEY = "forge.verseFinder.recent";
  export type RecentChapter = { id: string; label: string };          // { id: "GEN.6", label: "Genesis 6" }
  export function pushRecent(list: RecentChapter[], item: RecentChapter): RecentChapter[];  // dedupe by id, newest first, max 3
  export function readRecent(): RecentChapter[];                        // sessionStorage, [] when blocked/absent/corrupt
  export function writeRecent(list: RecentChapter[]): void;             // try/catch
  ```

- [ ] **Step 1: Write the failing tests**

```ts
it("pushRecent puts the newest first, dedupes by id, caps at 3", () => {
  const a = { id: "GEN.5", label: "Genesis 5" }, b = { id: "GEN.6", label: "Genesis 6" }, c = { id: "EZR.4", label: "Ezra 4" }, d = { id: "NEH.3", label: "Nehemiah 3" };
  expect(pushRecent([a, b, c], d)).toEqual([d, a, b]);
  expect(pushRecent([a, b, c], b)).toEqual([b, a, c]);
});
it("readRecent returns [] when storage is unavailable or corrupt", () => {
  expect(readRecent()).toEqual([]);                                                       // no window in node
  vi.stubGlobal("window", { sessionStorage: { getItem: () => "{not json" } });
  expect(readRecent()).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run app/forge/lib/__tests__/recentChapters.test.ts` → FAIL.
- [ ] **Step 3: Implement** the four exports; `readRecent` guards `typeof window === "undefined"`.
- [ ] **Step 4: Run to verify pass** — same command → PASS.
- [ ] **Step 5: Commit**

```bash
git add app/forge/lib/recentChapters.ts app/forge/lib/__tests__/recentChapters.test.ts
git commit -m "feat(forge): remember recent chapters for the verse finder"
```

---

### Task 6: VerseFinderPanel

**Files:**
- Create: `app/forge/cards/[cardId]/VerseFinderPanel.tsx`

**Interfaces:**
- Consumes: Task 1 `classify`, `parseRef`, `canonicalRef`, `bookById`; Task 2 everything; Task 4 response shapes; Task 5 helpers; `wrapLines`, `textFit`, `TEXT_METRICS`, `TEXT_WIDTH` from `@/app/forge/lib/textFit`; `Button` from `@/components/ui/button`; `cn` from `@/lib/utils`; `ChevronLeft`, `ChevronRight` from `lucide-react`.
- Produces:
  ```tsx
  export default function VerseFinderPanel(props: {
    snapshot: DesignCard;                       // for the live fit readout
    initialQuery: string;                       // the card's reference; looked up on mount when it parses
    onUse: (patch: { reference: string; scripture: string }) => void;
    onClose: () => void;
  }): JSX.Element;
  ```

- [ ] **Step 1: Build the panel** as one client component with these parts, in this order, each a small inner component in the same file:
  - **Input row:** `<input>` (placeholder per Global Constraints, no focus ring), hint line from `classify(query)`, secondary **Look up** button, ‹ › chapter buttons (disabled when no chapter or `prev`/`next` null). Enter: `ref` → `GET /forge/api/scripture?ref=`; `suggest` → replace the first token with the suggestion and re-classify; `search` → `?q=`; `invalid`/`empty` → nothing. On mount, if `classify(initialQuery).kind === "ref"`, fetch immediately.
  - **Empty state:** when no chapter and no results: chips from `readRecent()`, first chip label gets ` · last used`; click → `?chapter=<id>`.
  - **Results list:** rows `{ reference, text }`; `highlight` index state; `↑`/`↓`/Enter on the list; click or Enter → `?chapter=<BOOK.CH>` then `wholeRange(verses, v, v)` for that verse.
  - **Chapter view:** `select-none`; each verse: `<sup>` number, then word `<button>`s. Handle positions render as a 2px tall bar between words (`bg-primary` when focused, `bg-foreground/50` otherwise) and are `<button aria-label="start handle" | "end handle">`. Selected span words get `bg-primary/15`; outside `text-muted-foreground/60`. Live `…` rendered as a span at the cut edges inside the highlight. Word click → nearer handle (by absolute word index) moves to that word's near side. Handle keys: `←`/`→` `moveHandle`, `Home`/`End` `snapHandle`, `Tab` native. On chapter load, `scrollIntoView({ block: "center" })` on the first selected word.
  - **Readout:** `wrapLines(excerpt.text, "italic", TEXT_METRICS.verse.size, TEXT_WIDTH)` rendered one row per line in `italic`, tally `N lines` with `tabular-nums`; when `textFit({ ...snapshot, scripture: excerpt.text }).over > 0` show `ability runs N over` and a secondary **Trim to fit** button calling `trimToFit`; `null` result shows `Can't fit without the ability shrinking` in the status line.
  - **Commit:** primary **Use on card**; handler builds `canonicalRef(bookId, chapter, from, to)` and `excerpt.text`, calls `writeRecent(pushRecent(readRecent(), { id, label }))`, `onUse(...)`. `⌘Enter`/`Ctrl+Enter` on the panel's root `onKeyDown` triggers it; `Esc` → `onClose()`.
  - **Footer:** `copyright` verbatim in `text-[11px] text-muted-foreground`, then `Scripture text from <a href="https://api.bible" target="_blank" rel="noreferrer">API.Bible</a>`.
  - **FUMS:** `useEffect` on mount injects `<script src="https://pkg.api.bible/fumsV3.min.js">` once (guard `document.querySelector('script[src*="fumsV3"]')`) and the queue stub `window.fumsData = window.fumsData || []; window.fums = window.fums || function(){ window.fumsData.push(arguments) }`; after a chapter or results render, `window.fums?.("trackView", fumsToken)`. Add `declare global { interface Window { fums?: (...args: unknown[]) => void; fumsData?: unknown[] } }`.
  - **Errors:** 404 `verse_out_of_range` → `<Book> <chapter> has <verseCount> verses.`; empty results → `No verses matched.`; any 502/network → `Couldn't reach API.Bible. Type the verse by hand for now.`; shown in a status line under the input.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add 'app/forge/cards/[cardId]/VerseFinderPanel.tsx'
git commit -m "feat(forge): verse finder panel with word handles and live fit readout"
```

---

### Task 7: ScriptureFields, field move, and studio wiring

**Files:**
- Create: `app/forge/cards/[cardId]/ScriptureFields.tsx`
- Modify: `app/forge/cards/[cardId]/CardDetailsFields.tsx:14` (drop the testament import), `:52` (drop "scripture" from the comment), `:74-78` (drop the derivation), `:235-267` (drop the Reference and Scripture blocks)
- Modify: `app/forge/cards/[cardId]/StudioEditor.tsx:27` (import), `:356-360` (render `<ScriptureFields>` between the ability textarea and `<CardDetailsFields>`)

**Interfaces:**
- Consumes: Task 6 `VerseFinderPanel`; Task 1 `parseRef`, `canonicalRef`; `deriveTestamentAndGospel`, `formatTestament`.
- Produces: `export default function ScriptureFields({ snapshot, update }: { snapshot: DesignCard; update: (patch: Partial<DesignCard>) => void })`.

- [ ] **Step 1: Create `ScriptureFields.tsx`**: Reference label + input + the moved testament/gospel badges, with the toggle button at the input's right (`Look up <canonical>` when `parseRef(snapshot.reference)` is non-null, else `Find verse`; `aria-expanded`); Scripture textarea exactly as it was; `open` state; when open render `<VerseFinderPanel initialQuery={snapshot.reference ?? ""} snapshot={snapshot} onUse={…} onClose={() => setOpen(false)} />`. `onUse`: `update(patch)`, `setOpen(false)`, `(document.activeElement as HTMLElement | null)?.blur()`, `setStatus("Used · → next card")`; any `update` from typing in the two fields clears the status.

- [ ] **Step 2: Remove the two blocks from `CardDetailsFields.tsx`** and wire `ScriptureFields` into `StudioEditor.tsx` beneath the ability textarea.

- [ ] **Step 3: Type-check and run the whole suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests PASS (including the existing `CardSvg`/`ForgeCardPreview` tests, untouched).

- [ ] **Step 4: Drive it in the browser** with the project's `verify` skill (mint a Forge member session; dev server on a spare port in the worktree):
  1. Open a card whose reference is `Genesis 6:2`: the button reads `Look up Genesis 6:2`; click; the chapter appears with verse 2 highlighted and scrolled into view; the card preview still visible beside it.
  2. Click the start handle, press `→` three times: `…` appears and the readout line count updates; the preview's verse redraws.
  3. `⌘Enter`: panel closes, Reference reads `Genesis 6:2`, Scripture holds the excerpt starting with `…`, status reads `Used · → next card`; press `→`: the next card opens.
  4. On a card with no reference: chips show `Genesis 6 · last used`; type `Pslam 23` → hint `Did you mean Psalm 23?`; Enter twice → Psalm 23 chapter.
  5. Type `wells Philistines` → results list, `↓` + Enter → Genesis 26:18 chapter selected.
  6. Paste a 12-sentence ability, open `Rev 12:7-8`: `ability runs N over` + **Trim to fit** → `over` reaches 0 or the floor message appears.
  Save a screenshot of state 1 to the scratchpad and note anything off.

- [ ] **Step 5: Commit**

```bash
git add 'app/forge/cards/[cardId]/ScriptureFields.tsx' 'app/forge/cards/[cardId]/CardDetailsFields.tsx' 'app/forge/cards/[cardId]/StudioEditor.tsx'
git commit -m "feat(forge): scripture fields under the ability text with the verse finder"
```

---

### Task 8: Ship

**Files:** none new; `docs/superpowers/specs/2026-10-18-forge-verse-finder-design.md` and this plan are committed with the branch.

- [ ] **Step 1:** `git add docs/superpowers/specs/2026-10-18-forge-verse-finder-design.md docs/superpowers/plans/2026-10-18-forge-verse-finder.md && git commit -m "docs(forge): verse finder design and plan"`.
- [ ] **Step 2:** From the **main checkout** (where the key lives): `vercel env add API_BIBLE_KEY production`, `… preview`, `… development`, pasting the value from `.env.local`. Verify with `vercel env ls | grep API_BIBLE_KEY` → three rows.
- [ ] **Step 3:** `git push -u origin forge-verse-finder` and `gh pr create --base main` with a body that links the spec, lists the API.Bible terms the UI satisfies (citation, api.bible link, FUMS, 7-day cache), and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 4:** Confirm the Vercel preview deployment exists for the PR (a squash-merge has missed deploys before; check again after merge).
