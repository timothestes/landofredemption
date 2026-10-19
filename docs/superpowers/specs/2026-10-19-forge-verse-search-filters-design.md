# Forge verse finder — interactive search: scope from the box, sort, paging, highlights, Esc back

**Date:** 2026-10-19 (revised after an adversarial UX review the same day)
**Status:** Approved design, pre-implementation (follow-up to #492)
**Context:** The verse finder's keyword search is a single box that returns the top
20 relevance hits across the whole Bible, replaces them with the chapter the moment
one is opened, and offers no way to narrow, sort, page, or return. Typing a book
name before keywords ("Psalms shepherd"), the most natural way to narrow, is
treated as an error today.

API.Bible search (verified live 2026-10-19 on NASB 2020): `range` is ONE book id
or ONE contiguous span (`GEN-MAL`, `MAT-JHN`; comma lists are unreliable); `sort` =
`relevance` | `canonical`; `fuzziness` = `AUTO` (default) | `0`; `offset` paging;
`limit` ≤ 25; quoted phrases work except around small-caps LORD/GOD; multi-word
queries behave as AND; no hits → `total: 0`, but some word combinations answer
`400 "search error"`, which the finder today shows as an outage.

## 1. Purpose

Make search the fast way to *find* a verse. The common loop must work from the
keyboard with no new controls: type the words (with the book, if you know it),
Enter, ↓ Enter to open a hit, Esc to come back to the same list, ↓ Enter for the
next one. Every API call stays a deliberate action.

## 2. Goals

- **Scope from the box:** `Psalms shepherd`, `Ps shepherd`, `Matthew fishers` search inside that book. The hint says so before Enter.
- **Scope chips** for the cases a book can't express: Anywhere · Old Testament · New Testament · Gospels · Letters. Not remembered across cards.
- **Sort:** Relevance / Bible order, remembered for the session.
- **Exact spelling** as a link on the count line, not a control in the bar.
- **Count line** that says where you looked (`12 in Psalms · showing 12`) and what to do when nothing matched (`None in Psalms.` + **Search everywhere**).
- **Paging:** Show more, 25 at a time, up to 125; ↓ past the last row also pages.
- **Highlights:** query words in bold inside each row; rows with no bold word carry a muted `similar wording` tag.
- **Esc steps back one level:** chapter opened from a hit → the results with the same row highlighted; results → collapse. A pinned `← Results (N)` button does the same with the mouse.
- **Card name prefilled** in the box (selected) when the card has no reference, so Enter searches it and any keystroke replaces it. No automatic fetch.
- An upstream `400` on search reads as no matches, never as an outage.

## 3. Non-goals

- A book select, section scopes beyond Gospels and Letters, chapter-span scopes, saved searches, search history, server-side highlighting.
- Any change to the chapter view's handles, excerpt rules, commit, or the edition switch.

## 4. Constraints

- API.Bible terms as in #492: no fetch on keystroke; a chip or sort click re-runs the current search only while results are on screen (one call per click); the Lockman notice and api.bible link stay in the footer; FUMS `trackView` per response.
- `limit` 25 per page; `offset` ≤ 100 (five pages, 125 rows). One API call per page.
- `range` sent upstream is a single book id or a single contiguous span, validated against `BOOKS`.
- Green stays reserved for **Use on card** and the selection highlight. Highlighting is weight, not color. No focus rings, no toasts.
- vitest is node-only: pure helpers and the route get tests; the UI gets a browser drive.

## 5. Design

### 5.1 Parser — `classify` gains a `scoped` kind (`app/forge/lib/scriptureRef.ts`)

```ts
| { kind: "scoped"; book: Book; rest: string }   // "Psalms shepherd" → book Psalm, rest "shepherd"
```
Returned when the leading token(s) resolve to a book through the alias table, the
book token is a full name or an abbreviation of **three or more letters** (two-letter
aliases like `is`, `am`, `ex` never scope: "Is anything too difficult" stays a plain
search), and the remainder is non-empty and does not start with a digit. The
existing rules stand for `ref`, `suggest`, `invalid` (empty or digit-led remainder
that fails the grammar) and `search`. Numbered books work (`1 Sam Goliath`).

Known false positives ("mark of the beast" → in Mark, "song of Moses" → in Song of
Solomon) are made visible by the hint (`Keyword search · in Mark`) and recoverable
by the count line's **Search everywhere** (§5.4). Accepted.

### 5.2 Helpers — `app/forge/lib/searchScope.ts` (pure)

```ts
export type Scope = { id: "any" | "ot" | "nt" | "gospels" | "letters"; label: string; range: string | null };
export const SCOPES: Scope[]   // Anywhere null · Old Testament GEN-MAL · New Testament MAT-REV · Gospels MAT-JHN · Letters ROM-JUD
export function highlightSegments(text: string, query: string): { text: string; hit: boolean }[]
  // tokens: a double-quoted phrase is one token; else whitespace words of ≥ 2 letters, minus a leading
  // scoped book token (the caller passes `rest`), minus the stopwords a an the of and in to for is;
  // case-insensitive; every match starts at a Unicode word start ((?<![\p{L}\p{N}]), `u` flag); a token
  // of ≤ 3 letters matches whole words only ("my" marks "My", not "Myself"; "of" never marks "offered"),
  // a longer one is a prefix, so "shepherd" marks "shepherds"; returns [{text, hit:false}] when nothing
  // matches, including a query made only of stopwords
export function scopeNameFor(book: { id: string; name: string }): string
  // the book as the hint and count line name it: "Psalms" for PSA, else book.name
export function cardNameQuery(name: string | null | undefined): string | null
  // strip [bracket] and (paren) tags; cut at the first , : ; – — or " - "; drop stopwords
  // (a an the of and in to for is); null when fewer than 2 letters remain.
  // "Sower [EoT]" → "Sower"; "Patmos, Land of Exile" → "Patmos"; "Fishing Boat" → "Fishing Boat"; "[EoT]" → null
```

### 5.3 Route and client

`GET /forge/api/scripture?q=…` accepts, validated, all optional:

| param | values | upstream |
|---|---|---|
| `range` | a `BOOKS` id, or `A-B` with both in `BOOKS` and A before B canonically | `range` |
| `sort` | `relevance` (default) · `canonical` | `sort` |
| `exact` | `1` | `fuzziness=0` (absent → `AUTO`) |
| `offset` | integer 0–100 | `offset` |

Invalid → `400 { error: "bad_request" }`. `limit` is fixed at 25. The body adds
`offset` and `limit` beside `total`. `searchVerses(query, { limit?, offset?,
range?, sort?, exact? }, edition)`; an upstream `400` from the search endpoint
resolves to `{ total: 0, verses: [] , …}` with a `console.warn`, not a throw.

### 5.4 Panel behaviour (`VerseFinderPanel.tsx` + new presentational `VerseSearch.tsx`)

**State added to the panel:** `scope` (chip id; starts `any` on every mount — scope
is per card), `sort` and `exact` (read from / written to
`sessionStorage["forge.verseFinder.search"]`), `lastSearch: { words, range, sort,
exact } | null` (what the results on screen came from, so paging and chip clicks
re-run the same words even after the box is edited), `offset`. `results` survives
opening a hit; it is cleared only by a new search or a reference lookup.

**Submit (Enter / Look up):**
- `ref` → chapter (unchanged).
- `scoped` → search `rest` with `range = book.id`; the chip row shows no selection (the book wins); hint before Enter: `Keyword search · in Psalms`.
- `search` → search the words with the selected chip's range.
- `suggest` / `invalid` / `empty` → unchanged.

**Box prefill:** `initialQuery` is the card's reference when it parses (unchanged);
otherwise `cardNameQuery(snapshot.name)` with the whole text selected (`select()`
after focus), hint `Keyword search`. Nothing fetches until Enter. When that text alone
classifies as `invalid` (a bare book name: "Daniel (CoW)" → `Daniel`), it is prefilled
double-quoted (`"Daniel"`), which classifies as a phrase search instead of dead-ending on
the reference hint.

**`VerseSearch` renders, in order, only while the last action was a search:**
1. **Chip row:** the five scopes as small toggle buttons (`aria-pressed`), then a two-button **Relevance / Bible order** segment drawn like the edition switch. Clicking any of them while results are on screen re-runs `lastSearch` at offset 0 with the new value (one call). While a scoped-from-the-box search is on screen the chips are shown unpressed and disabled, with the book named on the count line.
2. **Count line** (`tabular-nums`, muted): `105 matches · showing 25` / `12 in Psalms · showing 12` / `40 in Gospels · showing 25`; when `total > 125`: `900 matches · showing 25 of the first 125`. Trailing link: `Only exact spelling` (re-runs with `exact`) or, when exact is on, `· exact spelling · Allow similar words`. Zero results: `No verses matched.` unscoped; `None in Psalms.` scoped, with a **Search everywhere** button that re-runs the same words with no range (and, for a box-scoped search, rewrites the box to the bare words).
3. **Results list:** listbox as today, `max-h-[50vh]`; row text muted with hit segments `font-semibold text-foreground`; a row with no hit shows a trailing `similar wording` tag (`text-[11px] text-muted-foreground`). After Show more, the first new row is scrolled into view within the list (container `scrollTop`); highlight index is unchanged; focus stays on the list.
4. **Show more:** secondary button while `offset + 25 < min(total, 125)`; disabled and reading `Narrow the search to see more` when the cap is reached with more available; absent when everything is shown. ↓ on the last row with another page available triggers it.

**Chapter opened from a hit:** a header row above the chapter box (outside its
scroll) holds a ghost button `← Results (105)` on the left; it restores the list
with the previously highlighted row and focuses the list, no fetch. The hint
reads `Esc · back to results` while this is the state and the box still holds the
search on screen; once the builder types something else the box's normal hint returns.
‹ › from a hit chapter keep it a hit chapter: the neighbouring chapter keeps the list
behind it, `← Results (N)` and Esc still go back.

**Esc (panel root):** if a chapter is shown and `results` exist → back to results
(same as the button); otherwise → `onClose()` as today.

### 5.5 Keyboard

| Where | Key | Does |
|---|---|---|
| Box | Enter | lookup / scoped search / search / accept suggestion |
| Results | ↑ ↓ | move; ↓ past the last row pages when more is available |
| Results | Enter | open the hit's chapter |
| Chapter from a hit | Esc | back to results, same row highlighted |
| Results | Esc | collapse the panel |
| Chips / sort / links | Tab, Enter, Space | native buttons |

### 5.6 Copy (fixed)

`Anywhere` `Old Testament` `New Testament` `Gospels` `Letters` · `Relevance` `Bible order` · `Keyword search · in <Book>` · `Esc · back to results` · `N matches · showing M` · `N in <Scope or Book> · showing M` · `N matches · showing M of the first 125` · `Only exact spelling` · `exact spelling` · `Allow similar words` · `No verses matched.` · `None in <Scope or Book>.` · `Search everywhere` · `Show more` · `Narrow the search to see more` · `similar wording` · `← Results (N)`. A book named
from the box reads as `scopeNameFor` gives it: `in Psalms`, though a reference keeps the
house form `Psalm 23:1`.

## 6. Testing

- `scriptureRef.test.ts`: `classify("Psalms shepherd")` → scoped Psalm, rest "shepherd"; `"Ps shepherd"` scoped; `"1 Sam Goliath"` scoped I Samuel; `"Is anything too difficult"` → search (2-letter alias never scopes); `"Genesis"` still invalid; `"Genesis 6:2"` still ref; `"Pslam 23"` still suggest.
- `searchScope.test.ts`: every scope range is a `BOOKS` id or canonical span; `highlightSegments` prefix / case / quoted phrase / two tokens / no hit; `cardNameQuery` for the four examples.
- `apiBible.test.ts`: `searchVerses` builds `range`, `sort=canonical`, `fuzziness=0`, `offset`, `limit=25`; upstream 400 → `total 0`, no throw.
- `route.test.ts`: each param forwarded; `range=XYZ`, `range=MAL-GEN`, `sort=random`, `offset=101`, `offset=abc` → 400; body carries `offset`/`limit`.
- Browser drive: `Psalms shepherd` → hint `in Psalms`, Psalm 23:1 among results, count `N in Psalms`; chip Old Testament + Bible order on `shepherd` → Genesis first; Show more appends and scrolls; ↓ Enter opens a hit, Esc returns with the same highlight; blank-reference card opens with its name selected in the box; `shepard` + Only exact spelling → `No verses matched.`; `None in Psalms.` + Search everywhere.

## 7. Left to the builder

- Exact layout of the chip row (one row on desktop, wrapping on phones) and the count line.
- Whether `VerseSearch` owns the listbox keyboard handler or keeps delegating to the existing `ResultsList`.
