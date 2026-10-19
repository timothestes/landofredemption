# Forge Verse Search Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the verse finder's keyword search scopeable from the box or by chip, sortable, pageable, highlighted, and reversible (Esc back to the same results), with the card name prefilled when there is no reference.

**Architecture:** The parser gains a `scoped` kind; a pure `searchScope.ts` holds the five scope ranges, the highlighter and the card-name cleaner; the client's `searchVerses` takes options and the route validates and forwards them; the panel keeps owning fetches and state while a new presentational `VerseSearch.tsx` renders chips, sort, count line, highlighted results and Show more.

**Tech Stack:** Next.js 15 App Router route handler, React 19 client components, Tailwind, vitest (node-only).

**Spec:** `docs/superpowers/specs/2026-10-19-forge-verse-search-filters-design.md`

## Global Constraints

- Work only in `/Users/timestes/projects/rtt-verse-finder` (branch `forge-verse-search-filters`), absolute paths; never touch `/Users/timestes/projects/redemption-tournament-tracker`; no `git checkout/switch/reset/stash`.
- Upstream `range` is one `BOOKS` id or one `A-B` span with A before B canonically; `sort` ∈ `relevance`|`canonical`; `exact=1` → `fuzziness=0`, else `fuzziness=AUTO`; `offset` 0–100; `limit` fixed at 25; page cap 125 rows.
- No fetch on keystroke. One API call per Enter, chip click, sort click, Show more, ↓-past-last-row, Search everywhere, or exact/similar link.
- Two-letter aliases never scope a search; three-or-more-letter abbreviations and full names do.
- Green only for **Use on card** and the selection highlight; highlights are `font-semibold text-foreground`; no `focus:ring-*`; no `role="dialog"`; no toasts.
- Fixed copy (spec §5.6): `Anywhere` `Old Testament` `New Testament` `Gospels` `Letters`; `Relevance` `Bible order`; `Keyword search · in <Book>`; `Esc · back to results`; `N matches · showing M`; `N in <Scope or Book> · showing M`; `N matches · showing M of the first 125`; `Only exact spelling`; `exact spelling`; `Allow similar words`; `No verses matched.`; `None in <Scope or Book>.`; `Search everywhere`; `Show more`; `Narrow the search to see more`; `similar wording`; `← Results (N)`.
- Tests: `npx vitest run <path>`; types: `npx tsc --noEmit`. Node-only vitest: no component tests.
- Commits: explicit `git add` paths (quote `[cardId]` paths); message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A scoped query whose book token is a two-letter alias (`Is anything too difficult`, `Am I my brother's keeper`) must search, not scope. → Task 1 classify tests.
2. A numbered book with words (`1 Sam Goliath`, `II Kings chariot`) must scope to that book. → Task 1 classify tests.
3. `offset` beyond the cap or non-numeric, and `range=MAL-GEN` (reversed), must be 400, never forwarded. → Task 2 route tests.
4. An upstream 400 on search must become `total 0`, not a 502 and not an outage message. → Task 2 client test + route behaviour.
5. Esc with a chapter open from a hit must go back to results, while Esc on a chapter opened by reference lookup must still close the panel. → Task 3 self-review + controller drive.

---

### Task 1: Parser `scoped` kind and search helpers

**Files:**
- Modify: `app/forge/lib/scriptureRef.ts` (`leadingBook` ~103-110, `Classified` type, `classify` ~170-185)
- Create: `app/forge/lib/searchScope.ts`
- Test: `app/forge/lib/__tests__/scriptureRef.test.ts`, `app/forge/lib/__tests__/searchScope.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // scriptureRef.ts
  export type Classified = … | { kind: "scoped"; book: Book; rest: string };
  // searchScope.ts
  export type ScopeId = "any" | "ot" | "nt" | "gospels" | "letters";
  export type Scope = { id: ScopeId; label: string; range: string | null };
  export const SCOPES: readonly Scope[];                       // any null · ot GEN-MAL · nt MAT-REV · gospels MAT-JHN · letters ROM-JUD
  export function scopeById(id: string): Scope;                // falls back to "any"
  export function highlightSegments(text: string, words: string): { text: string; hit: boolean }[];
  export function cardNameQuery(name: string | null | undefined): string | null;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// scriptureRef.test.ts — add rows to the classify table
["Psalms shepherd", { kind: "scoped", book: { id: "PSA" }, rest: "shepherd" }],
["Ps shepherd", { kind: "scoped", book: { id: "PSA" }, rest: "shepherd" }],
["1 Sam Goliath", { kind: "scoped", book: { id: "1SA" }, rest: "Goliath" }],
["II Kings chariot of fire", { kind: "scoped", book: { id: "2KI" }, rest: "chariot of fire" }],
["Song of Solomon beloved", { kind: "scoped", book: { id: "SNG" }, rest: "beloved" }],
["Is anything too difficult for the Lord", { kind: "search" }],
["Am I my brother's keeper", { kind: "search" }],
["Genesis", { kind: "invalid" }], ["Genesis 6:2", { kind: "ref" }], ["Pslam 23", { kind: "suggest" }],
// searchScope.test.ts
it("every scope range is a BOOKS id or a canonical-order span", …);   // split on "-", look up indexes in BOOKS
it("highlightSegments marks prefix matches case-insensitively", () =>
  expect(highlightSegments("The Lord is my shepherd; the shepherds fled", "shepherd")).toEqual([
    { text: "The Lord is my ", hit: false }, { text: "shepherd", hit: true }, { text: "; the ", hit: false },
    { text: "shepherd", hit: true }, { text: "s fled", hit: false }]));
it("a quoted phrase is one token; two words are two tokens; no hit returns one segment", …);
it("cardNameQuery strips tags, cuts at punctuation, drops stopwords", () => {
  expect(cardNameQuery("Sower [EoT]")).toBe("Sower");
  expect(cardNameQuery("Patmos, Land of Exile")).toBe("Patmos");
  expect(cardNameQuery("Fishing Boat")).toBe("Fishing Boat");
  expect(cardNameQuery("The Ark of the Covenant (GoC)")).toBe("Ark Covenant");
  expect(cardNameQuery("[EoT]")).toBeNull(); expect(cardNameQuery(null)).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run app/forge/lib/__tests__/scriptureRef.test.ts app/forge/lib/__tests__/searchScope.test.ts` → FAIL.

- [ ] **Step 3: Implement.** `leadingBook` additionally returns `key: string` (the normalized matched text, numeral prefix removed). In `classify`, after the `invalid` check: if `lead` matched and `lead.rest` is non-empty and not digit-led and the key's letters (strip numerals/spaces) number ≥ 3 → `{ kind: "scoped", book: lead.book, rest: lead.rest }`; otherwise continue to the suggestion/search rules unchanged. `searchScope.ts`: literal `SCOPES`; `highlightSegments` builds tokens (quoted phrase → one token; else words with ≥ 2 letters), escapes them, matches `\b<token>` case-insensitively, merges overlapping ranges, returns alternating segments; `cardNameQuery` per the spec's rules.

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Commit** — `git add app/forge/lib/scriptureRef.ts app/forge/lib/searchScope.ts app/forge/lib/__tests__/scriptureRef.test.ts app/forge/lib/__tests__/searchScope.test.ts` · `feat(forge): scoped keyword search from the box; search scope helpers`.

---

### Task 2: Search options in the client and route

**Files:**
- Modify: `app/forge/lib/apiBible.ts` (`searchVerses` ~lines 130-150), `app/forge/api/scripture/route.ts` (the `q` branch ~lines 31-40)
- Test: `app/forge/lib/__tests__/apiBible.test.ts`, `app/forge/api/scripture/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `BOOKS` from Task 1's module (unchanged export).
- Produces:
  ```ts
  export type SearchOptions = { limit?: number; offset?: number; range?: string; sort?: "relevance" | "canonical"; exact?: boolean };
  export type SearchPayload = { total; verses; copyright; fumsToken; offset: number; limit: number };
  export async function searchVerses(query: string, opts: SearchOptions, edition: BibleEdition = "2020"): Promise<SearchPayload>;
  export function isValidRange(range: string): boolean;   // BOOKS id, or A-B with both ids and A before B
  // route: GET ?q=…&range=…&sort=…&exact=1&offset=… → 200 SearchPayload | 400 { error: "bad_request" }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// apiBible.test.ts
it("searchVerses forwards range, sort, exact and offset and fixes limit at 25", async () => {
  …stub fetch with searchWells…
  const s = await searchVerses("shepherd", { offset: 25, range: "PSA", sort: "canonical", exact: true });
  const url = String(f.mock.calls[0][0]);
  expect(url).toContain("limit=25"); expect(url).toContain("offset=25"); expect(url).toContain("range=PSA");
  expect(url).toContain("sort=canonical"); expect(url).toContain("fuzziness=0");
  expect(s).toMatchObject({ offset: 25, limit: 25 });
});
it("searchVerses sends fuzziness=AUTO by default and resolves an upstream 400 to zero matches", async () => {
  …fetch → Response("search error", { status: 400 })…
  const s = await searchVerses("ark gopher zebra", {});
  expect(s).toMatchObject({ total: 0, verses: [], offset: 0, limit: 25 });   // no throw; console.warn spied
});
it("isValidRange accepts ids and canonical spans, rejects reversed and unknown", () => {
  expect(isValidRange("PSA")).toBe(true); expect(isValidRange("GEN-MAL")).toBe(true); expect(isValidRange("MAT-JHN")).toBe(true);
  expect(isValidRange("MAL-GEN")).toBe(false); expect(isValidRange("XYZ")).toBe(false); expect(isValidRange("GEN-")).toBe(false);
});
// route.test.ts
it("q: forwards range, sort, exact and offset", …);       // get("q=shepherd&range=PSA&sort=canonical&exact=1&offset=50") → searchVerses("shepherd", { limit: 25, offset: 50, range: "PSA", sort: "canonical", exact: true }, "2020")
it.each(["range=XYZ", "range=MAL-GEN", "sort=random", "offset=101", "offset=abc", "offset=-1", "exact=2"])("q: 400 on %s", …);
it("q: defaults are offset 0, relevance, fuzzy, no range", …);  // searchVerses("shepherd", { limit: 25, offset: 0, range: undefined, sort: "relevance", exact: false }, "2020")
```
Existing `searchVerses(query, 20)` assertions in route.test.ts change to the new shape.

- [ ] **Step 2: Run to verify failure** — `npx vitest run app/forge/lib/__tests__/apiBible.test.ts app/forge/api/scripture/__tests__/route.test.ts` → FAIL.

- [ ] **Step 3: Implement.** `searchVerses` builds `query, limit=25 (opts.limit ?? 25), offset, range (if set), sort (if canonical), fuzziness=0|AUTO, fums-version=3`; catches an `UpstreamError` with `status === 400` from `getJson`, `console.warn("[scripture] search 400", query.length)`, and returns the empty payload with the edition's copyright. `isValidRange` uses `BOOKS` order. Route: read `range`, `sort`, `exact`, `offset`; validate (`offset` must match `/^\d{1,3}$/` and be ≤ 100); call `searchVerses(query, { limit: 25, offset, range, sort, exact }, bible)`.

- [ ] **Step 4: Run to verify pass** — same command → PASS; then `npx vitest run` → all green.

- [ ] **Step 5: Commit** — `git add app/forge/lib/apiBible.ts app/forge/api/scripture/route.ts app/forge/lib/__tests__/apiBible.test.ts app/forge/api/scripture/__tests__/route.test.ts` · `feat(forge): search options (range, sort, exact, offset) through the scripture route`.

---

### Task 3: VerseSearch and panel integration

**Files:**
- Create: `app/forge/cards/[cardId]/VerseSearch.tsx`
- Modify: `app/forge/cards/[cardId]/VerseFinderPanel.tsx` — state (~70-80), `run` (~88-133), `submit` (~135-141), `openHit` (~145), mount prefill (~170-180), `onRootKeyDown` (~232-241), `hintFor` (~329), the results/chapter JSX (~294-320), `ResultsList` (~463-530, moves into `VerseSearch.tsx`), `ChapterView` header (~531)

**Interfaces:**
- Consumes: Task 1 (`classify` `scoped`, `SCOPES`, `scopeById`, `highlightSegments`, `cardNameQuery`), Task 2 (`SearchPayload` with `offset`/`limit`, route params).
- Produces:
  ```tsx
  export default function VerseSearch(props: {
    listRef: RefObject<HTMLDivElement | null>;
    results: { total: number; verses: Hit[]; offset: number; limit: number };
    words: string;                              // the searched words (box-scoped: the rest), for highlighting
    scopeLabel: string | null;                  // "Psalms" / "Gospels" / null for Anywhere
    boxScoped: boolean;                         // chips unpressed + disabled while a book came from the box
    scope: ScopeId; onScope: (s: ScopeId) => void;
    sort: "relevance" | "canonical"; onSort: (s) => void;
    exact: boolean; onExact: (e: boolean) => void;
    highlight: number; setHighlight: (i: number) => void;
    loading: boolean;
    onOpen: (hit: Hit) => void;
    onMore: () => void;                         // Show more / ↓ past the last row
    onEverywhere: () => void;                   // Search everywhere
  }): JSX.Element;
  ```

- [ ] **Step 1: Panel state and search plumbing.** Add `scope: ScopeId` (starts `"any"` per mount), `sort`, `exact` (read/write `sessionStorage["forge.verseFinder.search"]` as `{ sort, exact }`), `lastSearch: { words; range: string | null; scopeLabel: string | null; boxScoped: boolean } | null`, `offset`. Change `run` so a search response at `offset > 0` appends `verses` to the existing results; a search at offset 0 replaces them and resets `highlight`. Do not clear `results` when a chapter opens from a hit (`openHit`); clear them on a reference lookup and on a new search. `submit`: `scoped` → `search(rest, { range: book.id, scopeLabel: book.name, boxScoped: true })`; `search` → `search(words, { range: scopeById(scope).range, scopeLabel: scope === "any" ? null : label, boxScoped: false })`. Helper `search(words, opts, offset = 0)` builds `q=…&offset=…&range=…&sort=…&exact=1` and records `lastSearch`.

- [ ] **Step 2: Prefill.** When `classify(initialQuery).kind !== "ref"` and the reference is blank, initial `query` = `cardNameQuery(snapshot.name) ?? ""`; after mount focus, `inputRef.current?.select()` when that prefill was used. No fetch.

- [ ] **Step 3: `VerseSearch.tsx`.** Chip row (five `aria-pressed` buttons + Relevance/Bible order segment drawn like the edition switch); count line per spec §5.4 item 2 with the exact-spelling link states and the zero states (`No verses matched.` / `None in <X>.` + **Search everywhere**); results list moved from the panel (`max-h-[50vh]`, rows rendered through `highlightSegments(hit.text, words)` with `font-semibold text-foreground` hits and a `similar wording` tag when no segment hit; ↓ on the last row with more available calls `onMore`); Show more button states; after new rows arrive, set the list's `scrollTop` so the first new row is visible.

- [ ] **Step 4: Back to results and Esc.** When `chapter` is shown and `results` exist and the chapter came from a hit (`fromHit` ref set in `openHit`, cleared by reference lookups), render a header row above the chapter box with a ghost `← Results (N)` button that sets `chapter`/`handles` to null and focuses the list; `onRootKeyDown` Escape: if that state → back to results, else `onClose()`. Hint while in that state: `Esc · back to results`; hint for `scoped`: `Keyword search · in <Book>`.

- [ ] **Step 5: Type-check and suite** — `npx tsc --noEmit && npx vitest run` → clean and green.

- [ ] **Step 6: Commit** — `git add 'app/forge/cards/[cardId]/VerseSearch.tsx' 'app/forge/cards/[cardId]/VerseFinderPanel.tsx'` · `feat(forge): interactive verse search — scope, sort, paging, highlights, Esc back`.

---

### Task 4: Drive, review, ship (controller)

- [ ] Browser drive per spec §6 against the worktree dev server with a minted session; restore any card touched.
- [ ] Commit the spec and plan; push; open the PR against `main`; confirm the preview deployment.
