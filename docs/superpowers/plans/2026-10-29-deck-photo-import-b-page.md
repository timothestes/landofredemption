# Deck Photo Import PR 2: the `/decklist/scan` page, correction in place, Lost Soul sheet, hand-off to the deck builder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in player drops, pastes or photographs a laid-out deck, sees it as grouped decklist rows beside a crop of each group, fixes misreads in one or two taps, picks the Lost Souls, and opens the result as a new deck in the builder (or copies it as text).

**Architecture:** The page reuses the collection scanner's queue, capture buttons, photo status and picker, each generalized just enough for a second caller. All deck logic is pure and tested in `app/decklist/scan/lib/`: a reducer over per-read entries (corrections are entry edits; rows are derived with PR 1's `mergeDeckRows`), outcome and save-row builders, suggestion ranking, crop geometry, the check walker. A server action creates the deck through `saveDeckAction` and writes the outcomes to `scan_events`. Components are thin.

**Tech Stack:** Next.js 15 App Router (server page + `"use client"` tray), React 19, Tailwind + the house `Dialog`, Supabase (server action + service-role write), Vitest node-only (no DOM: UI is verified by `tsc` and a Playwright walk in Task 10; the repo has no ESLint config).

**Spec:** `docs/superpowers/specs/2026-10-29-deck-photo-import-design.md` on branch `spec/deck-photo-import` (PR #547; read it from `/Users/timestes/projects/rtt-deck-scan-spec/docs/superpowers/specs/2026-10-29-deck-photo-import-design.md` until #547 merges). Sections: Correcting what was read, The flow (all of it), What is recorded, Copy, Files, Testing, Rollout step 2, Evaluation (labels, recordings, box check). PR 1 (#549, merged) provides `DeckScanResponse`, `DeckDetection`, `DeckRowKind` (`lib/scan/deckClassify.ts`, import **types only** from the client), `mergeDeckRows`, `rowKeyOf`, `DeckEntry`, `DeckRow`, `defaultReserveGroup`, `impliedFamily`, `GroupSize` (`lib/scan/deck.ts`, client-safe), and migration 124 (applied on production).

## Global Constraints

- Worktree `/Users/timestes/projects/rtt-deck-scan-page`, branch `feat/deck-scan-page` off `origin/main`; absolute paths; `git add` only your files.
- The collection scanner (`/collection/scan`) is live: every shared-module change keeps its behaviour, and `npx vitest run app/collection lib/scan app/api/scan` stays green.
- Shared scan components are **imported across routes** from `@/app/collection/scan/...`, not moved (smaller diff on a live page; the spec leaves this to the builder).
- Client files never import `@/lib/cards/lookup`, `@/lib/cards/generated/*`, `lib/scan/stemIndex` or `lib/scan/deckClassify` at runtime; catalog code loads only through the picker's existing lazy `import()` pattern.
- Copy is the spec's *Copy* table verbatim, in `app/decklist/scan/copy.ts` as `DECK_COPY` with the scanner's `fill()`; errors, the signed-out gate and the not-open state reuse the scanner's `COPY`.
- Sizes from `FORMATS` (`lib/formats.ts`); never hard-code 50/70/100/140/10/20.
- Deck format on save: `'Type 2'` when `impliedFamily(mainTotal) === 'T2'`, else `'Type 1'` (both are values the builder already stores; `normalizeFormat` maps them).
- Deck name: `fill(DECK_COPY.deckName, { 'Mon D': <en-US "Oct 29"> })`, i.e. `Deck from photo · Oct 29`.
- Tray persists in `sessionStorage` under `deck-scan-tray:v1:<userId>`; never thumbnails, strips or crops.
- Prices: `useShowPrices(false)` on this page.
- Design system: Tailwind tokens, green only as the accent, no focus rings (house preference), 44 px touch targets, amber (`amber-500`/`amber-600` as the collection `DetectionRow` uses) for Check this / Not found / Unread with a 2 px left edge.
- Tests: Vitest node only; pure modules only; no e2e.

## Review Focus

1. **A photo the server refused with `too_many_cards` (422)** shows the deck copy *Too many cards for one photo. Photograph the deck in two halves and add both.* with no Retry and with Choose another. Test added to Task 1 (`copy.test.ts`, "422 too_many_cards").
2. **Raising the quantity of a merged row that spans two groups, then moving one group to Reserve**: only that group's share moves, and the added copies stay in the group of the row's first entry. Test added to Task 2 (`deckTrayReducer.test.ts`, "quantity added to a merged row lands in its first group").
3. **A Lost Soul or Dominant row inside a Reserve group** is saved in `main` and the row carries the note; the hand-off never sends `zone: 'reserve'` for them. Test added to Task 3 (`handoff.test.ts`, "main-only rows are saved in main from a Reserve group").
4. **Reload mid-correction**: the persisted tray restores every correction, zone, pick and removal, but no strip or crop; a photo that was still reading comes back failed with `lost_on_reload`. Test added to Task 2 ("restore marks reading photos lost_on_reload and keeps corrections").
5. **The player opens with unresolved rows**: they are left out of the deck, the outcomes mark them `unresolved`, and the confirm says *Open with {n} cards?* with n = the cards that will be saved. Test added to Task 3 (`handoff.test.ts`, "unresolved rows are left out and counted").

---

### Task 1: Generalize the shared scanner pieces

**Files:**
- Modify: `app/collection/scan/hooks/useScanQueue.ts`, `app/collection/scan/components/PrintingPicker.tsx`, `app/collection/scan/components/CaptureButtons.tsx`, `app/collection/scan/copy.ts`, `app/collection/scan/client.tsx` (adapt to the picker's new props; add the cross-link line under the capture buttons)
- Test: `app/collection/scan/__tests__/copy.test.ts`

**Interfaces:**
- Produces:
  - `type QueueAction<R> = { type: 'photoAdded'; photoId: string } | { type: 'photoStarted'; photoId: string; at: number } | { type: 'photoDone'; photoId: string; response: R } | { type: 'photoFailed'; photoId: string; error: { status: number; body: ScanErrorBody; retryAfter?: number } } | { type: 'photoRemoved'; photoId: string } | { type: 'photoRetry'; photoId: string; busy?: boolean }` exported from `useScanQueue.ts`.
  - `useScanQueue<R = ScanResponse>(dispatch: (a: QueueAction<R>) => void, opts?: { mode?: 'collection' | 'deck' })` — appends `mode` to the form only when `opts.mode === 'deck'`; return value unchanged (`thumbs` is the prepared photo's object URL per photo id; the deck page crops from it).
  - `PrintingPicker` props: replace `row: TrayRow` with `subject: { readTitle: string | null; candidates: Candidate[]; currentKey: string | null }`; add optional `suggestions?: PickerHit[]` (rendered above the results under a `Suggestions` heading, one tap picks via `'search'`), optional `selectQueryOnOpen?: boolean` (focus the field and select its text on open), optional `title?: string` (header override). Collection passes `{ readTitle: row.detection.read.title, candidates: row.candidates, currentKey: row.key }` and nothing else, so it renders exactly as before.
  - `CaptureButtons` gains optional `tips?: string[]` (defaults to today's two tips).
  - `scanErrorView`: `code === 'too_many_cards'` (status 422) → `{ kind: 'too_many_cards', text: COPY.tooManyCardsDeck, retry: false, chooseAnother: true }`; `ScanErrorKind` gains `'too_many_cards'`; `COPY.tooManyCardsDeck = 'Too many cards for one photo. Photograph the deck in two halves and add both.'`; `COPY.crossLinkScanner = 'Scanning a whole deck? Use Deck from photo.'` rendered as one muted line with a link to `/decklist/scan` under the collection page's capture buttons.

- [ ] **Step 1: Failing test** in `copy.test.ts`: `it('422 too_many_cards', () => { const v = scanErrorView(422, { code: 'too_many_cards' }, null, new Date()); expect(v).toMatchObject({ kind: 'too_many_cards', retry: false, chooseAnother: true }); expect(v.text).toBe(COPY.tooManyCardsDeck); })`.
- [ ] **Step 2: Run** `npx vitest run app/collection/scan/__tests__/copy.test.ts` — FAIL.
- [ ] **Step 3: Implement** the Interfaces block. `useScanQueue`'s internals are untouched except the form field and the dispatch type.
- [ ] **Step 4: Run** `npx vitest run app/collection lib/scan app/api/scan` and `npx tsc --noEmit -p .` — PASS, clean.
- [ ] **Step 5: Commit** `feat(scan): generalize queue, picker and capture for a second caller; too_many_cards copy`.

---

### Task 2: `deckTrayReducer` — entries, corrections, zones, persistence

**Files:**
- Create: `app/decklist/scan/lib/deckTrayReducer.ts`, `app/decklist/scan/types.ts`
- Test: `app/decklist/scan/__tests__/deckTrayReducer.test.ts` (fixtures: hand-built `DeckScanResponse`s in `app/decklist/scan/__tests__/fixtures.ts`)

**Interfaces:**
- Consumes: `QueueAction<DeckScanResponse>` (Task 1); `DeckScanResponse`, `DeckDetection`, `DeckRowKind` as types; `mergeDeckRows`, `defaultReserveGroup`, `DeckRow` from `@/lib/scan/deck`.
- Produces (`types.ts` re-exports the PR 1 types):
  - `interface DeckPhoto { photoId: string; n: number; status: 'queued' | 'reading' | 'done' | 'failed'; scanId?: string; photoQuality?: string; error?: { status: number; body: ScanErrorBody; retryAfter?: number }; startedAt?: number; busy?: boolean; groups: { id: number; orientation: string; bbox: [number, number, number, number]; cardCount: number }[] }`
  - `interface TrayEntry { entryId: string /* readId, or `${scanId}:add:${n}` */; photoId: string; group: number; kind: DeckRowKind; key: string | null; title: string | null; type: string; identityCandidates?: string[]; near?: { stem: string; d: number }[]; candidates: Candidate[]; original: { kind: DeckRowKind; key: string | null } | null /* null for added */; removed: boolean; zone?: 'main' | 'reserve' /* row-level override */ }`
  - `interface DeckTrayState { userId: string; photos: DeckPhoto[]; entries: TrayEntry[]; groupZones: Record<string, 'main' | 'reserve'> /* key `${photoId}:${group}` */; lostSoulPicks: { key: string; qty: number }[]; lostSoulsSkipped: boolean; lastRemoved: { entryIds: string[] } | null; addSeq: number; phase: 'editing' | 'saving' | 'saved'; savedDeckId: string | null }`
  - `type DeckTrayAction = QueueAction<DeckScanResponse> | { type: 'setCard'; rowKey: string; key: string } | { type: 'setQty'; rowKey: string; qty: number } | { type: 'removeRow'; rowKey: string } | { type: 'undoRemove' } | { type: 'moveRow'; rowKey: string; zone: 'main' | 'reserve' } | { type: 'setGroupZone'; groupKey: string; zone: 'main' | 'reserve' } | { type: 'addCard'; groupKey: string; key: string } | { type: 'setLostSoulPicks'; picks: { key: string; qty: number }[] } | { type: 'skipLostSouls' } | { type: 'saving' } | { type: 'saved'; deckId: string } | { type: 'saveFailed' }`
  - `deckTrayReducer(s: DeckTrayState, a: DeckTrayAction): DeckTrayState`
  - `trayRows(s: DeckTrayState): (DeckRow & { groupKey: string })[]` — `mergeDeckRows` over non-removed entries (entries carry `photo` as the photo's index in `s.photos`); each row's `groupKey` is its first entry's group.
  - `zoneOf(s, row): 'main' | 'reserve'` — `row.mainOnly ? 'main' : (row-level override on its entries ?? groupZones[groupKey] ?? 'main')`.
  - `initialDeckTray(userId: string): DeckTrayState`, `restoreDeckTray(raw: unknown, userId: string): DeckTrayState` (drops anything malformed; `queued`/`reading` photos become `failed` with `{ status: 0, body: { code: 'lost_on_reload' } }`), `STORAGE_KEY = (userId) => \`deck-scan-tray:v1:${userId}\``.
- Rules the tests pin:
  - `photoDone` appends one entry per detection (`entryId = detection.id`, `kind`, `key = deckKey`, `original = { kind, key: deckKey }`), stores the photo's groups, and on the **first** `photoDone` that brings the deck to ≥ 2 groups sets `groupZones` from `defaultReserveGroup` over all groups (count = detections per group) only for groups that have no zone yet.
  - `setCard(rowKey, key)`: every non-removed entry of that row becomes `kind: 'matched', key` (it re-merges with any row of that card).
  - `setQty(rowKey, n)`: above the current quantity, appends `n − q` added entries copying the row's first entry's `photoId`, `group`, `kind`, `key`, `title`, `type` (ids `${scanId}:add:${addSeq}`); below it, marks the last `q − n` entries removed; `n` clamps to 0–99.
  - `removeRow` marks all its entries removed and records `lastRemoved`; `undoRemove` restores exactly those.
  - `moveRow` sets `zone` on the row's entries; `setGroupZone` sets `groupZones[groupKey]`.
  - `addCard(groupKey, key)`: one added `matched` entry in that group.
  - `photoRemoved` drops the photo, its entries and its group zones.

- [ ] **Step 1: Failing tests**, one `it` per rule above plus:
  - "quantity added to a merged row lands in its first group" (Review Focus 2): one card read once in group 1 and once in group 2 → `setQty(rowKey, 3)` → the added entry's `group` is 1; then `setGroupZone('<photoId>:2', 'reserve')` → `trayRows` has a main row of 2 and a reserve row of 1.
  - "a card split across a main and a Reserve group is two derived rows".
  - "restore marks reading photos lost_on_reload and keeps corrections" (Review Focus 4).
- [ ] **Step 2: Run** `npx vitest run app/decklist/scan/__tests__/deckTrayReducer.test.ts` — FAIL.
- [ ] **Step 3: Implement.** `trayRows` merges by `rowKeyOf(entry)` **and** effective zone, so one card split across main and reserve is two rows (the builder stores them as two rows too).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(deck-scan): tray reducer — entries, corrections, zones, persistence`.

---

### Task 3: Hand-off builders — save rows, outcomes, text, totals

**Files:**
- Create: `app/decklist/scan/lib/handoff.ts`, `app/decklist/scan/lib/deckText.ts`
- Test: `app/decklist/scan/__tests__/handoff.test.ts`, `app/decklist/scan/__tests__/deckText.test.ts`

**Interfaces:**
- Consumes: Task 2's state, `trayRows`, `zoneOf`.
- Produces:
  - `interface DeckOutcome { id: string; finalKey: string | null; nameChanged: boolean; printingChanged: boolean; removed: boolean; unresolved: boolean; zone: 'main' | 'reserve' | null; lostSoulPick: boolean }`
  - `saveRows(s): { card_name: string; card_set: string; card_img_file: string; quantity: number; zone: 'main' | 'reserve' }[]` — from resolved rows (`kind` `matched`, `which`, `read_as` with a key) plus Lost Soul picks (always `main`); key split as `name|set|imgFile` (split on the **last two** `|`, names never contain `|` but be safe); summed per key+zone; quantities capped at 99.
  - `deckOutcomes(s): Record<string, DeckOutcome[]>` keyed by scanId (the part before the first `:`): one per entry, read or added. With `stem(k)` = the key's name (`k.split('|')[0]`) minus a trailing ` (…)`: `printingChanged` = `finalKey !== original.key` and both non-null and `stem` equal; `nameChanged` = `finalKey !== original.key` and not `printingChanged` (an added entry has `original === null`: both false). `unresolved` = not removed and `finalKey === null`; `zone` = the entry's effective zone, `null` when removed; Lost Soul picks as `${firstScanId}:ls:${n}` with `lostSoulPick: true`.
  - `totals(s): { main: number; reserve: number; lostSoulsToPick: number; unread: number; toCheck: number; leftOut: number }` — `main`/`reserve` count saved cards; `toCheck` counts amber rows (`which`, `read_as`, `not_found`, `unread`); `leftOut` counts cards in `not_found` and `unread` rows; `lostSoulsToPick` = placeholders − picked quantity, floored at 0, and 0 once skipped (placeholders are never saved and never counted in `leftOut`).
  - `deckFormat(mainTotal: number): 'Type 1' | 'Type 2'`, `deckName(now: Date): string`.
  - `buildDeckText(s): string` — `qty\tname\tset\timgFile` per saved row, main first, then a `Reserve:` line and reserve rows when any.

- [ ] **Step 1: Failing tests:** "main-only rows are saved in main from a Reserve group" (Review Focus 3); "unresolved rows are left out and counted" (Review Focus 5: two not_found + one unread → absent from `saveRows`, `totals.leftOut === 3`, outcomes `unresolved: true`); "a name change and a printing change are told apart"; "added cards and Lost Soul picks carry synthetic ids under a scan id"; "removed reads are outcomes with removed: true and finalKey null"; "deckFormat reads FORMATS" (`deckFormat(FORMATS.T2.main.min) === 'Type 2'`, `deckFormat(60) === 'Type 1'`); `deckName(new Date('2026-10-29T12:00:00'))` → `'Deck from photo · Oct 29'`; `deckText` round-trip: `parseDeckText(buildDeckText(s), cards)` returns the same name/set/quantity/zone multiset (build `cards` as the builder's `Card[]` for the fixture's keys — read `parseDeckText`'s `Card` type in `app/decklist/card-search/utils/deckImportExport.ts`).
- [ ] **Step 2: Run** both test files — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(deck-scan): save rows, outcomes, deck text and totals`.

---

### Task 4: `createDeckFromScanAction`

**Files:**
- Modify: `app/decklist/actions.ts` (append the action)
- Create: `app/decklist/scan/lib/validateHandoff.ts` (pure validator)
- Test: `app/decklist/scan/__tests__/validateHandoff.test.ts`

**Interfaces:**
- Consumes: `saveRows` / `deckOutcomes` shapes (Task 3); `saveDeckAction` (same file); `getSupabaseAdmin` from `@/lib/pricing/supabase-admin`; card-key check as `isKnownCardKey` in `app/collection/actions.ts` does it (copy the 6-line helper or export it — export it, one word).
- Produces:
  - `validateHandoff(input: unknown, isKnownKey: (k: string) => boolean): { rows: SaveRow[]; outcomesByScanId: Record<string, DeckOutcome[]>; name: string; format: 'Type 1' | 'Type 2' } | null` — rows ≤ 300, each `quantity` integer 1–99, `zone` in `main|reserve`, key known; scanIds are UUIDs, ≤ 20 of them; outcome ids match `^<scanId>:(\d+|add:\d+|ls:\d+)$` with the scanId equal to their map key; ≤ 400 outcomes per scan; name 1–100 chars; format one of the two.
  - `createDeckFromScanAction(input: { rows; outcomesByScanId; name; format }): Promise<{ ok: true; deckId: string } | { ok: false; code: 'unauthorized' | 'bad_request' | 'save_failed' }>` — auth; validate; `saveDeckAction({ name, format, cards: rows })` (no folder, no description); on success, for each scanId, `admin.from('scan_events').update({ outcomes }).eq('id', scanId).eq('user_id', user.id).eq('mode', 'deck')` — a failed outcome write is logged and never fails the hand-off.
- [ ] **Step 1: Failing tests** for `validateHandoff`: accepts a good payload; rejects quantity 0 / 100 / 1.5, an unknown key, zone `'maybeboard'`, an outcome id under the wrong scanId, `x:ls:a`, 301 rows, a 101-char name, format `'T2'`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** both. **Step 4: Run** `npx vitest run app/decklist/scan` and `npx tsc --noEmit -p .` — PASS.
- [ ] **Step 5: Commit** `feat(deck-scan): createDeckFromScanAction — save through saveDeckAction, write outcomes`.

---

### Task 5: Pure helpers — suggestions, crop geometry, walker, row keys

**Files:**
- Create: `app/decklist/scan/lib/suggest.ts` (lazy-loaded with the picker search: it may import `searchPrintings` from `@/app/collection/scan/lib/pickerSearch`), `app/decklist/scan/lib/photoCrops.ts`, `app/decklist/scan/lib/walker.ts`
- Test: `app/decklist/scan/__tests__/suggest.test.ts`, `photoCrops.test.ts`, `walker.test.ts`

**Interfaces:**
- `suggestFor(readTitle: string | null, near: { stem: string; d: number }[] | undefined, max = 5): PickerHit[]` — near stems in ascending `d` first (each through `searchPrintings(stem)`, keeping hits whose identity is new), then `searchPrintings(readTitle)` hits; one printing per identity (prefer `legality === 'Rotation'`, then the first); at most `max`.
- `cropPlan(bbox: Box, img: { w: number; h: number }, orientation: string, maxEdge = 1200): { sx: number; sy: number; sw: number; sh: number; rotate: 0 | 90 | -90 | 180; outW: number; outH: number }` — bbox in 0–1 → pixels (rounded, clamped to the image); `rotated_cw → -90`, `rotated_ccw → 90`, `upside_down → 180`, else 0; output long edge ≤ `maxEdge` after rotation (never upscaled).
- `cropToUrl(photoUrl: string, plan): Promise<string>` — canvas implementation (untested; `URL.createObjectURL` of a JPEG blob at 0.85).
- `nextAmber(ids: string[], current: string | null): string | null` — the next id after `current` in order, wrapping; `null` when `ids` is empty.
- `rowKeyAction(e: { key: string }): 'open' | 'inc' | 'dec' | 'remove' | 'next' | 'prev' | null` — `Enter → open`, `+`/`= → inc`, `-` → `dec`, `Delete`/`Backspace → remove`, `ArrowDown → next`, `ArrowUp → prev`.
- [ ] **Step 1: Failing tests:** suggest — dedupe by identity; near stem beats a search hit at equal rank; ≤ 5; a Rotation printing is preferred. crops — each orientation's `rotate` and swapped output size; bbox `[0, 0, 1, 1]` on 4000×3000 → long edge 1200; clamping. walker — order, wrap, null. keys — each mapping and `null` for `a`.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS).
- [ ] **Step 5: Commit** `feat(deck-scan): suggestions, crop geometry, check walker, row keys`.

---

### Task 6: The page shell — gate, capture, drop and paste, photo status

**Files:**
- Create: `app/decklist/scan/page.tsx`, `app/decklist/scan/client.tsx`, `app/decklist/scan/copy.ts`, `app/decklist/scan/hooks/useDeckTray.ts`, `app/decklist/scan/hooks/usePhotoDropPaste.ts`
- Test: `app/decklist/scan/__tests__/copy.test.ts` (every key in the spec's Copy table exists and equals the spec text)

**Interfaces:**
- `page.tsx`: as `app/collection/scan/page.tsx` (same gate via `canScanForSession`, same markup), with `DECK_COPY.pageTitle`, `DECK_COPY.lead`, sign-in link `redirectTo=/decklist/scan`, metadata title `Deck from photo`.
- `useDeckTray(userId)`: `useReducer(deckTrayReducer, …, () => restoreDeckTray(sessionStorage…))`, writes on every state change (try/catch).
- `usePhotoDropPaste(addFiles: (f: File[]) => void, enabled: boolean): { dragging: boolean }` — window `dragover`/`drop` for `Files` (images only), document `paste` taking `clipboardData.files` images; ignores paste into inputs/textareas.
- `client.tsx`: mount gate (as the collection client); `useScanQueue<DeckScanResponse>(dispatch, { mode: 'deck' })`; `CaptureButtons` with `tips={[DECK_COPY.tips]}`; a full-page drop overlay while `dragging`; `PhotoGroup` per photo with `detectionCount` and a deck done line `fill(DECK_COPY.readDone, { n, g })`; the reverse cross-link line `DECK_COPY.crossLinkHere` linking `/collection/scan`. Pass `PhotoGroup` a `doneLine?: string` override (add that optional prop in this task; collection unaffected).
- [ ] **Step 1: Failing test** for the copy table. **Step 2:** run — FAIL. **Step 3:** implement. **Step 4:** `npx vitest run app/decklist/scan app/collection` and `npx tsc --noEmit -p .` — PASS.
- [ ] **Step 5: Commit** `feat(deck-scan): /decklist/scan page shell — gate, capture, drop and paste`.

---

### Task 7: Group sections and rows — correction in place

**Files:**
- Create: `app/decklist/scan/components/GroupSection.tsx`, `GroupStrip.tsx`, `DeckRow.tsx`, `RowMenu.tsx`, `AddCardRow.tsx`, `app/decklist/scan/hooks/useCheckWalker.ts`
- Modify: `app/decklist/scan/client.tsx`

**Interfaces (behaviour the spec's *The tray* and *Correcting what was read* fix; values verbatim from there):**
- `GroupSection`: header `fill(groupHeader…)` / `groupHeaderEstimate` when `cardCount ≠ read count`, a `sideways` note for non-upright groups, a `Main deck | Reserve` segmented control (`setGroupZone`); then `GroupStrip` (crop via `cropPlan`/`cropToUrl` from the queue's `thumbs.get(photoId)`; 72 px tall, horizontal scroll for wide strips, tap opens the house `Dialog` large; after a reload, no thumb → the header shows `Photo {n}` and no strip); rows; `AddCardRow` last.
- `DeckRow` at 390 px: `[thumb 44][text][− 36][qty 28][+ 36][⋯ 44]`; catalog thumbnail (tap → large); name taps open the picker; second line set · legality or the chip reason (`readAs`, `whichCard`, `notFound`, `unread`); amber rows get `border-l-2 border-amber-500` plus the chip; `Find card` on not_found/unread; Lost Soul placeholders render as the one summary row `lostSoulRow` / `lostSoulPicked` opening the sheet (Task 8); `tabIndex={0}` and `onKeyDown` via `rowKeyAction`; a main-only row inside a Reserve group shows a one-line note *Counted in main deck*.
- `RowMenu` (⋯): `menuPrinting` (picker in `printing` mode), `menuToReserve`/`menuToMain` (`moveRow`), `menuRemove` (`removeRow` + 5 s toast `fill(removed, { name })` with Undo → `undoRemove`). Swipe-left on touch = Remove.
- Picker wiring: name tap / Find card / Add a card → `PrintingPicker` in `search` mode with `subject.readTitle` = the read title (empty for Add), `selectQueryOnOpen`, `suggestions = suggestFor(title, near)` (loaded lazily with the picker); `which` rows open `candidates` mode with the row's candidates; pick → `setCard` (or `addCard` for Add).
- `useCheckWalker(ids)`: totals line's `toCheck` button calls it; scrolls `[data-row-id=…]` into view and focuses it, using `nextAmber`.
- Totals line above the footer, `aria-live="polite"`: `fill(DECK_COPY.totals, …)` from `totals(s)`.
- [ ] **Step 1: Implement** the components and wire them into `client.tsx`.
- [ ] **Step 2: Verify** `npx tsc --noEmit -p .` clean; `npx vitest run app/decklist/scan app/collection` green.
- [ ] **Step 3: Commit** `feat(deck-scan): group sections, strips, rows, menu, add a card, check walker`.

---

### Task 8: The Lost Soul sheet

**Files:**
- Create: `app/decklist/scan/components/LostSoulSheet.tsx`, `app/decklist/scan/lib/lostSouls.ts` (lazy-loaded: builds the list from `CARDS`)
- Test: `app/decklist/scan/__tests__/lostSouls.test.ts`

**Interfaces:**
- `lostSoulOptions(showAll: boolean): { key: string; name: string; nickname: string; reference: string; set: string; imgFile: string; rotation: boolean }[]` — every Lost Soul printing (`type` contains `Lost Soul`), Rotation-legal only unless `showAll`, sorted by nickname then reference; `nickname` from the quoted word in the name (`Lost Soul "Accusers" [Ezra 4:6]` → `Accusers`), empty for plain ones.
- `matchLostSouls(query: string, options): options` — case-insensitive over nickname, reference and set.
- Sheet: house `Dialog` as a bottom sheet with the picker's chrome and `useFocusTrap`; header `fill(sheetTitle, { picked, target })` turning amber past the target (target = `totals.lostSoulsToPick` + already picked); search field; rows `[thumb 44] nickname · reference · set` with a checkbox and a − / + stepper (max 4); *Show all printings* toggle; prefilled with picks plus any matched Lost Soul rows already in the tray; **Done** → `setLostSoulPicks`; **Skip** → `skipLostSouls`.
- [ ] **Step 1: Failing tests:** Rotation-only count equals the number of Rotation-legal Lost Soul printings in `CARDS` (compute in the test); `showAll` count equals all; nickname extraction for a quoted and a plain name; search matches nickname, reference and set.
- [ ] **Step 2–4:** run (FAIL), implement, run (PASS) + `tsc`.
- [ ] **Step 5: Commit** `feat(deck-scan): Lost Soul sheet`.

---

### Task 9: Hand-off bar, entry points, privacy, E3 queries, docs

**Files:**
- Create: `app/decklist/scan/components/HandoffBar.tsx`
- Modify: `app/decklist/scan/client.tsx`; `app/decklist/card-search/client.tsx` (New Deck modal: a `From a photo` link to `/decklist/scan` under the modal's buttons; Import modal: one line *Have a photo of the deck laid out? Read it from a photo* linking `/decklist/scan`); `app/decklist/my-decks/client.tsx` (a `From photo` link-button beside `+ New Deck`, same size, outline style, `/decklist/scan`); `app/privacy/page.tsx` (one `<li>`: `DECK_COPY.privacy`); `scripts/scan-eval/queries.sql` (E3 deck queries); `CLAUDE.md` (add `app/decklist/scan/` to the Deck photo import row)
- Test: none new (behaviour lives in Task 3's builders); `tsc`.

**Interfaces:**
- `HandoffBar`: sticky footer; `leftOut` line `fill(leftOut, { n })` when > 0; **Copy as text** (`navigator.clipboard.writeText(buildDeckText(s))`, toast `copied`); **Open in deck builder** (primary): when `leftOut > 0` first a confirm `fill(openConfirm, { n: saved card count })`; then `dispatch saving` → `createDeckFromScanAction({ rows: saveRows(s), outcomesByScanId: deckOutcomes(s), name: deckName(new Date()), format: deckFormat(totals.main) })` → on ok `dispatch saved`, clear the stored tray, `router.push(\`/decklist/card-search?deckId=${id}\`)`; on failure `saveFailed` and the scanner's `COPY.server` toast. Disabled while saving and after success.
- E3 queries (`mode = 'deck'`, `source = 'player'`): decks created per week (rows with non-null `outcomes`), corrected or removed rows per deck, unread rate, cost per deck, deck share of 30-day spend — each as a commented block in the file's style.
- [ ] **Step 1: Implement.** **Step 2: Verify** `tsc`, `npx vitest run app/decklist app/collection lib/scan` green. **Step 3: Commit** `feat(deck-scan): hand-off to the deck builder; entry points, privacy line, E3 queries`.

---

### Task 10: Walk the page and run E0 on the preview

Run by the controller with the `verify` skill's session recipe; no code unless the walk finds a bug (then a fix task through the normal review loop).

- [ ] **Step 1:** Open the PR; wait for the Vercel preview.
- [ ] **Step 2: Phone walk** (Playwright, 390×844, signed-in session cookie per the `verify` skill) with the four spike photos (`/Users/timestes/projects/redemption-tournament-tracker/tmp/tbd`): drop/choose each, fix one wrong card via a suggestion, change a quantity, move a group to Reserve, remove and undo, add a card, pick Lost Souls, Copy as text, Open in deck builder; screenshot each state into the scratchpad; confirm the deck opens with the expected counts. Delete the test decks afterwards.
- [ ] **Step 3: Labels:** write `scripts/scan-eval/labels-deck.json` per `labels-deck.schema.md` for the four photos (read each at full zoom; unreadable cards counted under `unreadable`). Copy photos to `scripts/scan-eval/photos-deck/` (git-ignored).
- [ ] **Step 4: Recordings:** `run.ts --mode deck` against the preview for the deck arm and one `effort: low` arm; commit outputs under `scripts/scan-eval/outputs/deck-*/` with a `.gitignore` negation for `outputs/deck-*/`; score with `deckScore.ts` and put the table in the PR body.
- [ ] **Step 5: Box check:** render each photo with its group boxes and title boxes drawn (a throwaway sharp script in the scratchpad), view them, and record the share of group boxes containing their whole group and of title boxes on the right card. Group strips stay when group boxes pass on all four photos; otherwise set the strip off (one constant in `GroupStrip.tsx`) and say so in the PR. Per-card title crops are not built in this PR; if ≥ 90% of title boxes are right, note it as the follow-up.
