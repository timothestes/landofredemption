# Forge verse finder — NASB lookup, trim, and fit for the card studio

**Date:** 2026-10-18 (revised the same day after an adversarial UX review)
**Status:** Approved design, pre-implementation
**Context:** Forge cards carry two free-text fields, `reference` (the citation
printed under the verse) and `scripture` (the verse text itself). Builders fill
both by hand from a Bible in another tab. The result in production today:

| | Count |
|---|---|
| Forge cards | 834 |
| …with a reference | 649 |
| …with verse text | 219 |
| …verse uses an ellipsis | 99 (64 use `…`, 36 use `...`) |
| Longest verse text | 227 chars |

So about 430 cards cite a passage but print no verse. The 219 that exist are
NASB 2020 wording with drifting conventions (two ellipsis styles, straight vs
curly quotes), and at least one is wrong: a card cites Genesis 12:5 and carries
the text of Genesis 17:5. Official references use Roman numerals for numbered
books ("II Chronicles 5:11", 1,269 of 1,269 numbered-book cards) and singular
"Psalm".

An API.Bible Starter key (free, non-commercial) was created 2026-10-18 with
two licensed translations: NASB 2020 (`a761ca71e0b3ddcf-01`) and NASB 1995
(`b8ee27bcd1cae43a-01`). The verse, passage, chapter and search endpoints were
verified against it.

## 1. Purpose

A verse finder built into the card studio, directly under the ability text and
beside the live card preview. It fetches the NASB 2020 chapter for a reference
or a keyword search, lets the builder trim the excerpt with two word handles,
shows the excerpt wrapped exactly as the card will print it, and writes both
fields in the house style with one action. The live preview redraws on every
trim, so the builder watches the verse stack up and the "doesn't fit" pill
disappear. One PR.

Builders work in runs: 40 Genesis cards in a sitting, many from the same
chapter. The design optimizes the fiftieth card of a session, not the first.

## 2. Goals

- A card that already has a reference opens the finder on that chapter with the
  range selected, zero typing.
- Type a reference in any common form (`Gen 6:2`, `II Chr 5:11-12`,
  `1 Chronicles 5:11`, `Rev 12:7-8`, `Ps 60:5`) or keywords
  (`wells Philistines`); the box tells you which it will do before you press
  Enter, and catches typos like `Pslam 23`.
- See the whole chapter, hunt for the best line, step to neighbouring chapters.
- Trim by moving two handles, with the mouse or entirely from the keyboard; the
  ellipses appear live at the cut edges.
- See the excerpt as the card will wrap it, with the line count, and get a
  one-click "Trim to fit" when the ability text runs over.
- One commit writes `reference` (canonical, spanning exactly the selected
  verses) and `scripture`; focus returns to the page so `→` walks to the next
  card.
- Satisfy the API.Bible and Lockman terms: visible citation, api.bible link,
  FUMS view reporting, cache refreshed within 30 days, no wording changes.

## 3. Non-goals (this PR)

- NASB 1995. The key has it and it is one route parameter; a toggle is a
  follow-up if a set wants the older wording.
- Auditing or backfilling the 219 existing verse texts / 430 missing ones. A
  script can reuse the route later (§9).
- Rendering small-caps LORD on the card. The text endpoint returns "Lord" and
  that is what builders type today; keep it.
- "Also cited on card X" cross-references within a set (§9).
- Any surface outside the Forge card studio.
- A first-run tutorial or empty-state illustration. The placeholder and the
  recent-chapter chips are the onboarding; a quiet instrument does not explain
  itself twice.

## 4. Anti-goals

- Changing the wording of the verse in any way. Excerpting with an ellipsis is
  quotation, not modification; nothing else is touched (quotes, punctuation,
  capitalization all come from the source).
- Exposing the API key or the API.Bible route to non-members.
- Burning the 5,000-calls/month budget on keystrokes. Every fetch is an
  explicit submit (Enter, a result click, a chapter arrow, a chip), and
  chapters are cached server-side.
- A modal. The finder must never cover the live preview or lock the ability
  textarea; fit is a negotiation between the two texts and both stay in view.

## 5. Constraints

**API.Bible Starter terms (accepted 2026-10-18)**
- Non-commercial: no ads, in-app purchases, subscriptions, or revenue-generating
  use. (Recorded here so a future monetization decision sees it.)
- A visible citation and a hyperlink to `https://api.bible` must appear in the
  interface where the text is shown.
- Scripture quotations must carry the rights holder's notice. The API returns
  the exact Lockman string in `data.copyright`; display it verbatim.
- Cached content must be refreshed from API.Bible at least every 30 days.
- FUMS v3: every scripture response carries `meta.fumsToken` (request with
  `fums-version=3`); report it with `fums("trackView", token)` when the text is
  displayed in a web page. Script: `https://pkg.api.bible/fumsV3.min.js` plus
  the queue stub from the fair-use guide. No CSP headers exist in the app, so
  no header change is needed.
- 5,000 calls per month, then the key stops (no overage billing on Starter).
  Busiest month on record created 433 cards; at one search plus one chapter
  fetch per card that is under 1,000.

**Codebase**
- Next.js 15 App Router. Server route under `app/forge/api/`, gated with
  `requireForge()` from `app/forge/lib/auth.ts`; unauthenticated callers get
  `notFoundResponse()`, matching the art route. Route tests mock
  `@/app/forge/lib/auth` and `next/cache` with `vi.mock`; the export route's
  test is the template.
- Key in `API_BIBLE_KEY` (server-only env; already in the main checkout's
  `.env.local`, must be copied into the worktree and added to Vercel for all
  environments before merge).
- Fit math already exists in `app/forge/lib/textFit.ts`: `textFit(card)`
  returns `verseLines` and `over`; `wrapLines(text, "italic", TEXT_METRICS.verse.size, TEXT_WIDTH)`
  wraps a verse the way the card does. The italic advance table already covers
  `…`, curly quotes and dashes. Reuse; do not duplicate metrics.
- `StudioEditor.update(patch)` merges into the snapshot behind a 700 ms
  debounced autosave; one `{ reference, scripture }` patch is one save.
- The studio's `←`/`→` card navigation (StudioEditor) fires only when
  `document.activeElement` is the body and no `[role="dialog"]` is mounted.
- Testament derivation in `app/decklist/card-search/data/testament.ts` must
  keep classifying every canonical reference the finder writes.
- vitest here is node-only (no DOM); test pure modules and the route, not the
  panel's rendering.
- Design rules: green is the single accent, reserved for the primary action
  and active states; no focus rings on form controls; no gratuitous motion.

## 6. Design

### 6.1 Server route — `app/forge/api/scripture/route.ts`

`GET` with exactly one of:

- `?ref=<free text>` → parse (§6.2). Returns the whole **chapter** split into
  verses, which verses were asked for, and the neighbouring chapter ids:
  ```json
  { "bookId": "GEN", "chapter": 6, "book": "Genesis",
    "requested": { "from": 2, "to": 2 },
    "verses": [{ "n": 1, "text": "Now it came about, …" }, …],
    "prev": "GEN.5", "next": "GEN.7",
    "copyright": "NEW AMERICAN STANDARD BIBLE® …", "fumsToken": "…" }
  ```
  NASB 2020 exposes an `intro` pseudo-chapter per book, so the response's
  `previous`/`next` ids are normalized: an `.intro` next becomes that book's
  chapter 1, an `.intro` prev becomes the previous book's last chapter, and
  both are null at Genesis 1 and after Revelation 22. Unparseable input → `400`; chapter or
  verse out of range → `404`.
- `?chapter=GEN.7` → the same chapter payload with `requested` = `{1,1}`. Used
  by the ‹ › arrows and the recent-chapter chips.
- `?q=<keywords>` → `search?query=…&limit=20`. Returns
  `{ "total", "verses": [{ "id": "GEN.26.18", "reference": "Genesis 26:18",
  "text": "…" }], "fumsToken" }`. Query is trimmed and whitespace-collapsed;
  empty → `400`.

Upstream calls (NASB 2020 id as a named constant; the 1995 id in a comment):
- `GET /v1/bibles/{id}/chapters/{BOOK.CH}?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false&fums-version=3`
  → `content` is `" [1] Now it came … [2] that the sons …"`; split on the
  `[n]` markers, trim each piece, collapse whitespace runs to one space.
  (Verified 2026-10-18 on Genesis 6, 22 verses.)
- `GET /v1/bibles/{id}/search?query=…&limit=20&fums-version=3`.

**Search text hygiene (display only).** The search endpoint's `text` carries
small-caps breakage (`"the L ord ;"`, `"the Lord  G od ."`) and doubled spaces.
The route collapses whitespace and repairs the two known artefacts
(`L ord` → `Lord`, `G od` → `God`) in search rows only. Inserted text always
comes from the clean chapter endpoint, so nothing repaired is ever stored.

Upstream errors (non-2xx, network, missing key) → `502 { "error": "upstream" }`
with a server-side warning. Never forward the upstream body or headers.

**Caching:** chapters cached with `unstable_cache` keyed by `BOOK.CH`,
`revalidate: 7 days` (inside the 30-day rule). Searches are not cached. The
`fumsToken` is part of the cached payload; reporting a cached token on
re-display is what the fair-use guide expects.

### 6.2 Reference parser — `app/forge/lib/scriptureRef.ts` (pure)

Table of the 66 books: OSIS id (`GEN` … `REV`), canonical house name (Roman
numerals for numbered books, `Psalm` singular, `Song of Solomon`), chapter
count, and accepted aliases: the full name, standard abbreviations (`Gen`,
`Ex`/`Exod`, `Ps`/`Psa`, `Phil`, `Philem`, `Rev`), Arabic or Roman numerals
with or without a space (`1 Sam`, `I Sam`, `1Sam`), `Song of Songs`,
`Canticles`. Matching is case-insensitive and ignores a trailing period.

Grammar: `<book> <chapter>[:<verse>[-<verse2>]]`. A bare chapter is treated as
`{ from: 1, to: 1 }`; a chapter-only reference is never written to a card.
Same-chapter ranges only; cross-chapter ranges are rejected (none exist in the
official data).

```ts
parseRef(text): ParsedRef | null           // { bookId, book, chapter, from, to }
canonicalRef(bookId, chapter, from, to): string   // "II Chronicles 5:11-12" (hyphen, no spaces)
suggestBook(token): string | null          // "Pslam" → "Psalm"; Damerau-Levenshtein ≤ 2 over names + aliases
classify(text): { kind: "ref", ref } | { kind: "suggest", book, rest } | { kind: "search" } | { kind: "empty" }
```

`classify` drives the live hint (§6.4) and never fetches. A test asserts
`getTestamentForRef(canonicalRef(...))` is non-null for every book.

### 6.3 Placement — `ScriptureFields` under the ability text

The Reference and Scripture fields move out of the collapsed "Card details"
drawer in `CardDetailsFields.tsx` into a new `ScriptureFields.tsx` rendered by
`StudioEditor.tsx` directly beneath the ability textarea. They are printed
text, like the ability; they do not belong in the deck-metadata drawer. The
testament/gospel badges move with the Reference input unchanged.
`CardDetailsFields` keeps everything else; its header comment drops
"scripture".

Layout of `ScriptureFields`:
- Row 1: Reference input (as today, badges beneath) and, at its right, one
  button. Label reads **Look up Genesis 6:2** when the current reference
  parses, otherwise **Find verse**. Pressing it expands the panel in place
  beneath the row; when the reference parsed, the chapter is fetched
  immediately and the range is selected. Pressing it again, or Esc inside the
  panel, collapses it.
- Row 2: the Scripture textarea (as today).
- Beneath, when expanded: the panel (§6.4). A bordered `bg-card` block, no
  backdrop, no scroll lock, no `role="dialog"`.
- A one-line muted status slot under the fields: `Used · → next card` after a
  commit (cleared on the next edit), or the error text (§6.7).

### 6.4 Panel — `VerseFinderPanel.tsx`

**Input row.** One text box, placeholder `Genesis 6:2, or words you remember`,
prefilled with the card's reference. A live hint beneath it, computed by
`classify` on every keystroke with no fetch:
- `→ Genesis 6:2` (will look up)
- `Keyword search` (will search)
- `Did you mean Psalm 23?` (fuzzy book hit; Enter accepts the suggestion)
- `Try "Genesis 6:2" or words from the verse.` when a book matched but the
  rest does not parse.
Enter submits; a small secondary **Look up** button exists for discoverability
only. ‹ and › buttons at the right step to `prev`/`next` chapter when a chapter
is loaded.

**Empty state** (reference blank, nothing loaded): up to three recent-chapter
chips from `sessionStorage` key `forge.verseFinder.recent` (most recent first,
e.g. `Genesis 6 · last used`, `Genesis 5`, `Ezra 4`), each loads that chapter.
Nothing else.

**Search results.** Up to 20 rows: reference in medium weight, text beneath.
`↑`/`↓` move a highlight, Enter or click opens that verse's chapter with the
verse selected. `No verses matched.` when empty.

**Chapter view.** Every verse of the chapter, verse numbers as small
superscripts outside the word flow, requested range scrolled into view.
Every word is a span. Two handles, start and end, sit between words; the span
between them is the excerpt and is highlighted `bg-primary/15`; everything
outside is dimmed. The selection defaults to the requested range (or the
search hit). Ellipses render live at the cut edges, inside the highlight.

Handle mechanics:
- Click or tap a word: the nearer handle jumps to that side of the word.
- Handles are focusable buttons. `←`/`→` move the focused handle one word;
  `Home`/`End` snap it to the start/end of its verse; `Tab` moves between the
  two handles. A handle cannot cross the other.
- No native text selection in the chapter view (`select-none`), so the
  backdrop-click and drag-escape problems do not exist.

**Readout.** Beneath the chapter: the excerpt rendered one row per card line
using `wrapLines(excerpt, "italic", TEXT_METRICS.verse.size, TEXT_WIDTH)`, in
the card's italic face, with a `tabular-nums` tally `3 lines`. No fit sentence;
the live card preview already shows the red "Ability doesn't fit" pill, and
`textFit` with the candidate excerpt drives a muted `ability runs N over` note
next to the tally only when `over > 0`. In that state a secondary **Trim to
fit** button appears: it walks the end handle back one word at a time until
`over === 0`, stopping (and saying `Can't fit without the ability shrinking`)
if fewer than three words would remain. It is a suggestion the builder then
nudges; it never rewrites.

**Commit.** One primary button, **Use on card** (`⌘Enter` / `Ctrl+Enter`
anywhere in the panel). It writes
`update({ reference: canonicalRef(bookId, chapter, startVerse, endVerse), scripture: excerpt })`,
pushes the chapter onto the recent list, collapses the panel, blurs focus to
`document.body`, and sets the status slot to `Used · → next card`.

**Footer.** `data.copyright` verbatim at 11px muted, then `Scripture text from
API.Bible` linking to `https://api.bible`. The FUMS script is loaded once when
the panel first mounts; `fums("trackView", token)` fires each time a chapter or
results list renders.

### 6.5 Excerpt and ellipsis rules — `app/forge/lib/verseExcerpt.ts` (pure)

Input: the chapter's verses as word arrays, and the handles as
`{ verse, word }` positions (start inclusive, end exclusive). Output:
`{ text, from, to }` where `from..to` is the verse span the handles touch.

- Join the selected words with single spaces; verse boundaries are a single
  space.
- Prepend `…` when the start handle is not at the first word of verse `from`,
  **or** the first kept word begins with a lowercase letter (a verse that opens
  mid-sentence: Genesis 6:2 `…that the sons of God saw`). Append `…` when the
  end handle is not at the last word of verse `to`, **or** the last kept word
  ends in `,` `;` `:` (a verse that closes mid-sentence: Revelation 12:7
  `waged war…`). Single character U+2026, no surrounding spaces. This is what
  the existing cards already do and matches the API's own typographic
  punctuation.
- A trailing `…` replaces trailing `,` `;` `:` on the last kept word; sentence
  punctuation `.` `!` `?` (optionally followed by a closing quote) is kept
  (`chose.`) and no ellipsis is added after it, even mid-verse.
- A closing quotation mark immediately after a kept sentence end is kept; an
  opening quotation mark at the cut start is dropped.
- No other character is altered.

`trimToFit(verses, handles, card)` (pure, same module): moves the end handle
back one word at a time, recomputing `textFit` with the candidate excerpt,
until `over === 0`; returns the new handles or `null` if fewer than three words
would remain.

### 6.6 Keyboard, end to end

| Where | Key | Does |
|---|---|---|
| Reference row | click button | expand (and fetch if the reference parses) |
| Input | Enter | look up / search / accept suggestion |
| Results | ↑ ↓ Enter | move highlight, open chapter |
| Handle | ← → Home End Tab | move one word, snap to verse edge, switch handle |
| Anywhere in panel | ⌘Enter / Ctrl+Enter | Use on card |
| Anywhere in panel | Esc | collapse |
| After commit | → | next card (focus is on body) |

### 6.7 Error states (all in the status slot or the hint, never a toast)

- Typo or unparseable reference: handled by the hint before any fetch.
- No search hits: `No verses matched.`
- Upstream failure or quota exhausted: `Couldn't reach API.Bible. Type the
  verse by hand for now.` The textarea stays usable.

## 7. Testing

- `scriptureRef.test.ts`: every alias form in §6.2; canonical output; chapter
  counts; `suggestBook` on `Pslam`, `Genesis` (exact, no suggestion), `Jhn`;
  `classify` on each kind; testament agreement for all 66 books; rejects
  `Gen`, `Gen 6:`, `Gen 6:2-5:1`, `Genesis 51`.
- `verseExcerpt.test.ts`: no cut, leading cut, trailing cut, both, trailing
  comma replaced, sentence end kept, quotation marks, multi-verse join; `from`
  / `to` follow the handles (mid-6:1 to end-6:2 → `1..2` with a leading `…`;
  all of verse 8 after a 7-8 lookup → `8..8`, no ellipsis); `trimToFit`
  reaches `over === 0` on a long verse and returns `null` on a hopeless one.
- Chapter splitting: a fixture saved from the real Genesis 6 response; asserts
  22 verses, exact text for verses 2 and 3, and `prev`/`next`.
- Search hygiene: a fixture with `L ord` / `G od` / doubled spaces → repaired.
- `route.test.ts`: `fetch` mocked; `ref`, `chapter`, `q` happy paths; 400/404/
  502; the key goes out as the `api-key` header and never comes back.
- Fit readout and `trimToFit` rely on the existing `textFit` tests for metrics.

## 8. Rollout

No migration. Add `API_BIBLE_KEY` to Vercel (production, preview, development)
before merge; the route returns `502` with a logged warning if it is missing so
a missing key cannot break the studio.

## 9. Follow-ups (not in this PR)

- Audit script: for each card with a reference and verse text, fetch the
  chapter through the same cache and flag texts that do not appear in the
  cited range (catches the Genesis 12:5 case). Report only; a builder fixes it.
- NASB 1995 toggle per lookup.
- "Fill verse" for the 430 referenced-but-empty cards, as a reviewed batch.
- "Also cited on" — when the selected verse already appears on another card in
  the set, say so with a link. Needs the set's cards loaded in the studio.

## 10. Left to the builder

- Exact panel spacing and type sizes (follow the studio's existing fieldsets).
- How handles are drawn (a thin bar between words is enough; no icons).
- Whether the chapter view virtualizes (Psalm 119 is 176 verses; plain
  rendering is probably fine).
