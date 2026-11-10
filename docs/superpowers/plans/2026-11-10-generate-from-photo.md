# Deck Check PDF From a Photo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in player photographs a deck on `/decklist/generate`, fixes misreads in a tray that shows each card's title crop and one-tap suggestions, and generates the deck-check PDF or opens the deck in the builder.

**Architecture:** The reader on `/decklist/scan` is extracted into `DeckPhotoReader`, which owns the tray and the upload queue and reports its state to a host. PR A adds row evidence (title-band strips cut from one turned canvas per photo) and suggestion chips to that reader. PR B mounts the reader as a third source on the generate page, which derives two-column text from the tray state and sends it through the existing generators.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript (`strict: false`), Tailwind, vitest (node only, no DOM), canvas 2D in the browser.

**Spec:** `docs/superpowers/specs/2026-11-03-generate-from-photo-design.md`

## Global Constraints

- No new model call, route, table or migration. `POST /api/scan` stays the authority on who may scan.
- `lib/decksheets/parse.ts` is not touched.
- Green only for the one CTA, active state and the *New* pill (`bg-primary/15 text-primary text-[10px] font-bold uppercase rounded px-1.5 py-0.5`); amber for warnings; `bg-card` for a lifted panel; 44 px targets (`min-h-11`); no gradients or new colours; no focus rings (`focus:outline-none`).
- Row width does not change: the grid stays `grid-cols-[44px_minmax(0,1fr)_36px_28px_36px_48px]`.
- Tray storage key stays `deck-scan-tray:v1:<uid>`; strips are never stored.
- Copy is the spec's Copy table, verbatim, added to `DECK_COPY` in `app/decklist/scan/copy.ts`.
- Tests are vitest, node only: pure modules get tests; components are checked with `tsc` and a browser walk.
- Worktrees: PR A in `../rtt-row-evidence` (`feat/deck-scan-row-evidence`), PR B in `../rtt-generate-photo-build` (`feat/generate-from-photo`, branched from PR A's branch and opened against it; retarget to `main` after A merges). `git add` named files only.
- Test command: `npx vitest run <path>`; type check: `npx tsc --noEmit`.

## Deliberate departures from the spec (all inside "Left to the builder")

1. `DeckPhotoReader` takes `onChange(state)` instead of `onDeckText(text, totals)` + `columns`. The host derives text, totals, the reading flag and outcomes from the state with the existing pure functions, so the reader needs no format knowledge.
2. The generate page's two tab panels become one panel with one `DeckSourcePicker`; only the header, the options and the button differ by tab. The picker (and the reader in it) is then never unmounted by a tab change. The `<form>` wrapper goes with it (buttons become `type="button"`), so Enter in the tray's quantity input cannot submit anything.
3. The reader stays mounted but hidden when the player switches to *Paste text* or *My saved decks* after opening it, so an in-flight read and the photos' strips survive.
4. Photo text is held apart from the typed decklist; the generators get whichever the active source owns. A typed list is not overwritten by opening the photo source.
5. Strips and the viewer are `<canvas>` elements drawn from the turned photo, not object URLs with an SVG overlay: no URL lifecycle.

## Review Focus

1. **A title box that is garbage** (`[0,0,10,10]`, `x1 < x0`, NaN): no strip, no throw. → Task 1 tests.
2. **A restored tray with no photo in memory**: rows render without strips; a persisted `titleBox` or `rotation` that is malformed is dropped, not trusted. → Task 2 tests.
3. **Generating from a photo after a saved deck was loaded**: the request must carry the photo's text and no `deck_id`, or the PDF is the saved deck. → Task 8 test (`effectiveDeck`).
4. **Pasted text with CRLF endings, four columns, or a `Tokens:` tail**: normalized lines parse; nothing after `Tokens:` is altered. → Task 8 tests.
5. **A chip on a `Not found ×3` row**: corrects one read, two stay. Two candidates with the same name get distinguishable labels. → Task 4 and Task 2 tests.

---

# PR A — `feat/deck-scan-row-evidence`

### Task 1: Title-strip geometry

**Files:**
- Create: `app/decklist/scan/lib/titleCrop.ts`
- Modify: `app/decklist/scan/lib/photoCrops.ts` (add `drawCrop`, remove `cropToUrl`)
- Test: `app/decklist/scan/__tests__/titleCrop.test.ts`

**Interfaces:**
- Consumes: `cropPlan(bbox, img, orientation, maxEdge)` and `CropPlan` from `photoCrops.ts`; `Box` from `@/lib/scan/deckSchema`.
- Produces:
  - `type Turn = 0 | 90 | 180 | 270`
  - `turnedSize(img: { w: number; h: number }, turn: Turn): { w: number; h: number }`
  - `turnPoint(p: [number, number], turn: Turn): [number, number]` — a normalized point of the original photo, in the frame turned clockwise by `turn`.
  - `titleStripPlan(box: Box | null | undefined, img: { w: number; h: number }, orientation: string, maxEdge = 480): CropPlan | null` — `img` is the turned frame.
  - `drawCrop(source: CanvasImageSource, plan: CropPlan, canvas: HTMLCanvasElement): void` in `photoCrops.ts` (the drawing half of the old `cropToUrl`; sets the canvas size to `outW × outH`).

Rules for `titleStripPlan` (upright frame = after the group's orientation is undone; for `rotated_cw`/`rotated_ccw` the box's pixel width and height swap):
- Not four finite numbers, any value outside `[0, 1]`, or `x1 <= x0` / `y1 <= y0` → `null`.
- Upright height fraction = the box's extent along the photo axis that is "up" for the card (photo height for upright/upside_down, photo width for quarter turns).
- Height fraction > `0.10` → cut to the top band: keep the full upright width, band height = upright width px / `3.5`, taken from the card's top edge (photo top for `upright`, right for `rotated_cw`, left for `rotated_ccw`, bottom for `upside_down`). Then pad.
- Else upright width px / upright height px < `2` → `null`.
- Padding: 4% of upright width on each side, 25% of upright height above and below, clamped to the photo.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { titleStripPlan, turnPoint, turnedSize } from '../lib/titleCrop';

const img = { w: 2000, h: 1500 };

describe('titleStripPlan', () => {
  it('pads a title band: 4% of width sideways, 25% of height above and below', () => {
    // 400 x 60 px band at (400, 300)
    const p = titleStripPlan([0.2, 0.2, 0.4, 0.24], img, 'upright')!;
    expect(p).toMatchObject({ sx: 384, sy: 285, sw: 432, sh: 90, rotate: 0 });
  });
  it('clamps padding at the photo edge', () => {
    const p = titleStripPlan([0, 0, 0.2, 0.04], img, 'upright')!;
    expect([p.sx, p.sy]).toEqual([0, 0]);
  });
  it('drops a box under 2:1 that is not tall', () => {
    expect(titleStripPlan([0.2, 0.2, 0.25, 0.26], img, 'upright')).toBeNull(); // 100 x 90 px
  });
  it('cuts a whole-card box to its top band at 3.5:1', () => {
    // 280 x 390 px, 26% of the height
    const p = titleStripPlan([0.5, 0.5, 0.64, 0.76], img, 'upright')!;
    expect(p.sy).toBe(750 - 20);        // band top less 25% of the 80 px band
    expect(p.sh).toBe(80 + 40);
  });
  it('takes the band from the card top for each orientation', () => {
    const box: [number, number, number, number] = [0.5, 0.2, 0.76, 0.4]; // 520 x 300 px, sideways whole card
    const cw = titleStripPlan(box, img, 'rotated_cw')!;   // top toward the right edge
    expect(cw.sx + cw.sw).toBeGreaterThan(1520);
    expect(cw.rotate).toBe(-90);
    const ccw = titleStripPlan(box, img, 'rotated_ccw')!; // top toward the left edge
    expect(ccw.sx).toBeLessThan(1000);
    const flip = titleStripPlan([0.5, 0.5, 0.64, 0.76], img, 'upside_down')!;
    expect(flip.sy + flip.sh).toBeGreaterThan(1140);
  });
  it('gives an upright strip (wider than tall) for a sideways title band', () => {
    const p = titleStripPlan([0.2, 0.2, 0.23, 0.4], img, 'rotated_cw')!; // 60 x 300 px
    expect(p.outW).toBeGreaterThan(p.outH * 2);
  });
  it.each([
    [null], [undefined], [[0, 0, 10, 10]], [[0.4, 0.2, 0.2, 0.3]], [[0.1, 0.1, NaN, 0.2]], [[0.1, 0.1, 0.3]],
  ])('returns null for %j', (box) => {
    expect(titleStripPlan(box as never, img, 'upright')).toBeNull();
  });
});

describe('turns', () => {
  it('swaps the size on quarter turns', () => {
    expect(turnedSize(img, 90)).toEqual({ w: 1500, h: 2000 });
    expect(turnedSize(img, 180)).toEqual(img);
  });
  it('maps the original top-left corner clockwise', () => {
    expect(turnPoint([0, 0], 0)).toEqual([0, 0]);
    expect(turnPoint([0, 0], 90)).toEqual([1, 0]);
    expect(turnPoint([0, 0], 180)).toEqual([1, 1]);
    expect(turnPoint([0, 0], 270)).toEqual([0, 1]);
  });
  it.each([0, 90, 180, 270] as const)('a band turned by %i still yields a wide upright strip for the matching orientation', (turn) => {
    // An upright 400 x 60 band in the original; in the turned frame its orientation is what undoes the turn.
    const a = turnPoint([0.2, 0.2], turn), b = turnPoint([0.4, 0.24], turn);
    const box: [number, number, number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    const orientation = { 0: 'upright', 90: 'rotated_cw', 180: 'upside_down', 270: 'rotated_ccw' }[turn];
    const p = titleStripPlan(box, turnedSize(img, turn), orientation)!;
    expect(p.outW).toBeGreaterThan(p.outH * 2);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run app/decklist/scan/__tests__/titleCrop.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `titleCrop.ts` to the rules above (compute the adjusted normalized box, then delegate to `cropPlan`). In `photoCrops.ts`, replace `cropToUrl` with `drawCrop` (same translate/rotate/drawImage body, no fetch, no blob).
- [ ] **Step 4: Run** the test file and `app/decklist/scan/__tests__/photoCrops.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(deck-scan): title-strip geometry`.

### Task 2: `titleBox` and `rotation` through the tray

**Files:**
- Modify: `app/decklist/scan/types.ts`, `app/decklist/scan/lib/deckTrayReducer.ts`, `app/decklist/scan/__tests__/fixtures.ts` (`DetSpec.titleBox?`, `deckResponse(..., rotation = 0)`)
- Test: `app/decklist/scan/__tests__/deckTrayReducer.test.ts` (append)

**Interfaces:**
- Produces: `TrayEntry.titleBox?: Box`; `DeckPhoto.rotation?: 0 | 90 | 180 | 270`. `photoDone` copies `d.titleBox` (when not null) and `r.rotation`. `addedEntry` never copies `titleBox`. `restoreDeckTray` keeps a `titleBox` only when it is four finite numbers and a `rotation` only when it is one of the four values.

- [ ] **Step 1: Write the failing tests**

```ts
describe('row evidence fields', () => {
  const resp = deckResponse('s1', [
    { group: 1, key: 'Moses|RoJ|moses', titleBox: [0.1, 0.1, 0.3, 0.14] },
    { group: 1, key: 'Aaron|Pr|aaron' },
    ...rep(3, { group: 1, key: null, kind: 'not_found', title: 'Zed' }),
  ], [{ id: 1 }], 270);
  const s = run(initialDeckTray('u1'),
    { type: 'photoAdded', photoId: 'p1' }, { type: 'photoStarted', photoId: 'p1', at: 1 }, { type: 'photoDone', photoId: 'p1', response: resp });

  it('photoDone copies titleBox and rotation', () => {
    expect(s.entries[0].titleBox).toEqual([0.1, 0.1, 0.3, 0.14]);
    expect(s.entries[1].titleBox).toBeUndefined();
    expect(s.photos[0].rotation).toBe(270);
  });
  it('survive persistence and restore', () => {
    const back = restoreDeckTray(JSON.parse(JSON.stringify(s)), 'u1');
    expect(back.entries[0].titleBox).toEqual([0.1, 0.1, 0.3, 0.14]);
    expect(back.photos[0].rotation).toBe(270);
  });
  it('restore drops a malformed titleBox or rotation', () => {
    const raw = JSON.parse(JSON.stringify(s));
    raw.entries[0].titleBox = [0.1, 'x', 0.3];
    raw.photos[0].rotation = 45;
    const back = restoreDeckTray(raw, 'u1');
    expect(back.entries[0].titleBox).toBeUndefined();
    expect(back.photos[0].rotation).toBeUndefined();
  });
  it('a card added by + has no titleBox', () => {
    const more = run(s, { type: 'setQty', rowKey: trayRows(s)[0].rowKey, qty: 2 });
    expect(more.entries.at(-1)!.titleBox).toBeUndefined();
  });
  it('setCardOne on Not found x3 corrects one read and records a name change', () => {
    const row = trayRows(s).find(r => r.kind === 'not_found')!;
    const next = run(s, { type: 'setCardOne', rowKey: row.rowKey, key: 'Zadok|Pr|zadok' });
    expect(trayRows(next).find(r => r.kind === 'not_found')!.quantity).toBe(2);
    const o = deckOutcomes(next).s1.find(x => x.finalKey === 'Zadok|Pr|zadok')!;
    expect(o.nameChanged).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run app/decklist/scan/__tests__/deckTrayReducer.test.ts` — Expected: FAIL on the new block.
- [ ] **Step 3: Implement** the type fields, the two copies in `photoDone`, and the two guards in `cleanEntry` / `cleanPhoto`.
- [ ] **Step 4: Run** the whole `app/decklist/scan/__tests__` folder — Expected: PASS.
- [ ] **Step 5: Commit** `feat(deck-scan): carry title boxes and the photo turn through the tray`.

### Task 3: Two-column deck text

**Files:**
- Modify: `app/decklist/scan/lib/deckText.ts`
- Test: `app/decklist/scan/__tests__/deckText.test.ts` (append)

**Interfaces:**
- Produces: `buildDeckText(s: DeckTrayState, opts?: { columns?: 2 | 4 }): string` — default 4, byte-identical to today; 2 emits `qty\tname`.

- [ ] **Step 1: Write the failing test** (inside the existing `describe`, reusing `s`)

```ts
it('columns: 2 parses through the PDF parser with every card', () => {
  const parsed = parseDecklistText(buildDeckText(s, { columns: 2 }));
  expect(parsed.main).toEqual([{ quantity: 3, name: 'Moses' }, { quantity: 1, name: 'Aaron' }, { quantity: 2, name: 'Lost Soul' }]);
  expect(parsed.reserve).toEqual([{ quantity: 2, name: 'Joshua' }]);
});
it('columns: 4 is the default', () => {
  expect(buildDeckText(s, { columns: 4 })).toBe(buildDeckText(s));
});
```
(`parseDecklistText` from `@/lib/decksheets/parse`.)

- [ ] **Step 2: Run** — Expected: FAIL (names carry the set and image file).
- [ ] **Step 3: Implement** the option.
- [ ] **Step 4: Run** — Expected: PASS, including the existing byte-exact test.
- [ ] **Step 5: Commit** `feat(deck-scan): two-column deck text`.

### Task 4: Chip ranking

**Files:**
- Modify: `app/decklist/scan/lib/suggest.ts`, `app/collection/scan/lib/pickerSearch.ts` (export `printingsForIdentity(identity: string): PickerHit[]`, built from the existing private `printingsOf`)
- Test: `app/decklist/scan/__tests__/suggest.test.ts` (append; follow the file's existing catalog-backed style)

**Interfaces:**
- Produces: `type Chip = { key: string; label: string; siblings: Candidate[] }` and
  `chipsFor(e: { kind: DeckRowKind; title: string | null; near?: { stem: string; d: number }[]; identityCandidates?: string[] }, max = 3): Chip[]`.
  - `unread`, `matched`, `lost_soul` → `[]`.
  - `which`: one chip per `identityCandidates` entry first (its Rotation printing if any, else its first), then `suggestFor(title, near)` hits, de-duplicated by identity, cut to `max`.
  - `read_as`, `not_found`: `suggestFor(title, near, max)`.
  - `label` is the card name; when two chips share a name, each gets ` · {set}` appended.
  - `siblings` is every printing of the chip's identity (so *Change printing* lists the right card afterwards).

- [ ] **Step 1: Write the failing tests** — using real catalog names already used in `suggest.test.ts`: an `unread` entry gives `[]`; a `not_found` entry with a misspelt real title gives 1–3 chips whose first label is the real card; a `which` entry built from two identities of one real duplicated name (pick one from the catalog with `CARDS` in the test: two cards with the same `name` and different `cardIdentityKey`) puts both first and gives them different labels; every chip's `siblings` includes its own `key`.
- [ ] **Step 2: Run** `npx vitest run app/decklist/scan/__tests__/suggest.test.ts` — Expected: FAIL, `chipsFor` not exported.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(deck-scan): rank one-tap suggestions for a flagged row`.

### Task 5: Row evidence in the tray

**Files:**
- Create: `app/decklist/scan/hooks/useTurnedPhotos.ts`, `app/decklist/scan/components/RowEvidence.tsx`
- Modify: `app/decklist/scan/components/DeckRow.tsx`, `DeckTray.tsx`, `GroupSection.tsx`, `copy.ts`
- Delete: `app/decklist/scan/components/GroupStrip.tsx`

**Interfaces:**
- Consumes: `titleStripPlan`, `Turn`, `drawCrop`, `TrayEntry.titleBox`, `DeckPhoto.rotation`.
- Produces:
  - `useTurnedPhotos(thumbs: Map<string, string>, photos: DeckPhoto[]): Map<string, HTMLCanvasElement>` — one decode per done photo (`createImageBitmap` of the fetched object URL), drawn into a canvas already turned clockwise by `photo.rotation ?? 0`; entries are dropped when the photo or its thumb goes. A failed decode leaves the photo out of the map.
  - `RowEvidence({ source, box, orientation, label }: { source: HTMLCanvasElement; box: Box; orientation: string; label: string })` — renders nothing when `titleStripPlan` is null; else a `<button type="button" aria-label={DECK_COPY.stripLabel}>` holding a `<canvas>` (`h-12 w-full max-w-[240px] sm:h-16 rounded-sm object-cover`) drawn with `drawCrop`. Click opens the house `Dialog` (the old `StripViewer` shell, moved here) with a canvas of the whole turned photo and the title box stroked (`stroke` = `hsl(var(--primary))` read off the document, line width `max(3, w / 300)`), sized `max-h-[80dvh] max-w-full`.
  - `DeckRow` gains optional prop `evidence?: ReactNode`, rendered at the top of the text column as a sibling above the name button (the text column becomes a `div` holding the strip, then the existing button). Not rendered for a Lost Soul row.
- `DECK_COPY.stripLabel = 'Tap to see it in the photo'`; `stripHint` is removed.
- `GroupSection` loses the `GroupStrip` import and block; its `thumb` prop stays (the heading uses it).

In `DeckTray`: `const turned = useTurnedPhotos(thumbs, state.photos)`; for each row, `e = firstEntry(row)`; pass `evidence` when `row.kind !== 'lost_soul' && e?.original && e.titleBox && turned.get(e.photoId)`, with `orientation` = the entry's group's orientation (`'upright'` for the orphan group).

- [ ] **Step 1: Implement** the hook, the component, and the wiring.
- [ ] **Step 2: Run** `npx tsc --noEmit` and `npx vitest run app/decklist/scan app/collection/scan` — Expected: no errors, PASS (fix `copy.test.ts` if it lists keys).
- [ ] **Step 3: Commit** `feat(deck-scan): show each row's title crop from the photo`.

### Task 6: Suggestion chips in the row

**Files:**
- Create: `app/decklist/scan/components/SuggestionChips.tsx`
- Modify: `DeckRow.tsx`, `DeckTray.tsx`

**Interfaces:**
- Consumes: `chipsFor`, `Chip` (lazy, through the existing `loadSuggest()` in `DeckTray`).
- Produces: `SuggestionChips({ chips, disabled, onPick, onOther }: { chips: Chip[]; disabled: boolean; onPick: (c: Chip) => void; onOther: () => void })` — a wrapping row of buttons, each `rounded-full border border-border text-sm min-h-11 px-3`, then **Other…** (`DECK_COPY.chipOther = 'Other…'`). `DeckRow` gains `chips?: ReactNode`, rendered under the grid row, indented `pl-[60px]`, for `which`, `read_as`, `not_found` rows only.

In `DeckTray`: a `chipsByRow: Map<string, Chip[]>` state filled by an effect that runs when the set of amber row keys changes: loads the suggest module once and computes `chipsFor(firstEntry(row))` per amber non-unread row. Pick dispatches `setCardOne` when the row is `not_found` with `quantity > 1`, else `setCard`, both with `candidates: chip.siblings`. *Other…* calls the row's existing `onOpenPicker`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npx tsc --noEmit` and `npx vitest run app/decklist/scan` — Expected: clean, PASS.
- [ ] **Step 3: Commit** `feat(deck-scan): one-tap suggestion chips on flagged rows`.

### Task 7: Extract `DeckPhotoReader`, verify, open PR A

**Files:**
- Create: `app/decklist/scan/components/DeckPhotoReader.tsx`
- Modify: `app/decklist/scan/client.tsx` (thin wrapper), `DeckTray.tsx` (`signInHref` prop passed to `PhotoGroup`)

**Interfaces:**
- Produces:
```ts
export interface DeckPhotoReaderProps {
  userId: string;
  /** Called after every tray change, and once on mount. */
  onChange?: (state: DeckTrayState) => void;
  /** The host's hand-off, rendered under the tray when it is not empty. */
  footer?: (ctx: { state: DeckTrayState; dispatch: Dispatch<DeckTrayAction> }) => ReactNode;
  /** Where a 401 on a photo sends the player. Default '/sign-in?redirectTo=/decklist/scan'. */
  signInHref?: string;
  /** False while the host hides the reader: page-wide drop and paste are off. Default true. */
  active?: boolean;
  /** Extra classes on the tray's wrapper (the generate page bleeds it past its panel). */
  trayClassName?: string;
}
```
The component keeps the mount gate, `useDeckTray`, `useScanQueue`, the drop overlay, capture buttons, cross link, retention details, offline line, empty line and `DeckTray`, exactly as `client.tsx` has them. `client.tsx` becomes `<DeckPhotoReader userId={userId} footer={({ state, dispatch }) => <HandoffBar state={state} dispatch={dispatch} />} />`.

- [ ] **Step 1: Implement** the extraction.
- [ ] **Step 2: Run** `npx tsc --noEmit` and `npx vitest run` — Expected: clean; the suite passes.
- [ ] **Step 3: Browser walk** on the dev server (the `verify` skill for a signed-in session): `/decklist/scan` at 390 px, read one eval photo from `scripts/scan-eval/` (one sharp, and one turned if the budget allows: each read costs about $0.10). Check: strips show the title of the card each row names; tapping a strip opens the photo with the box outlined; an amber row shows chips and one tap resolves it; *Other…* opens the picker; reload drops the strips and keeps the rows. Screenshot under `.playwright-mcp/`.
- [ ] **Step 4: Commit, push, open PR A** against `main`.

---

# PR B — `feat/generate-from-photo`

### Task 8: Pure helpers for the generate page

**Files:**
- Create: `app/decklist/generate/decklistText.ts`
- Test: `app/decklist/generate/__tests__/decklistText.test.ts`

**Interfaces:**
- Produces:
  - `normalizeDecklist(text: string): string` — every line before a line starting `Tokens:` that contains a tab keeps its first two tab-separated fields; `\r` at a line end is removed; all other lines and everything from `Tokens:` on are unchanged.
  - `deckTypeFromMain(mainTotal: number): 'type_1' | 'type_2'` — `impliedFamily(mainTotal) === 'T2' ? 'type_2' : 'type_1'`.
  - `type Source = 'photo' | 'paste' | 'decks'`
  - `effectiveDeck(a: { source: Source; typed: string; photoText: string; loadedDeckId: string | null }): { decklist: string; deckId: string | null }` — photo source → `{ decklist: photoText, deckId: null }`; otherwise `{ decklist: normalizeDecklist(typed), deckId: loadedDeckId }`.
  - `outcomesSignature(o: Record<string, unknown[]>): string` — `JSON.stringify`, used for the once-per-tray guard.

- [ ] **Step 1: Write the failing tests**

```ts
describe('normalizeDecklist', () => {
  it('cuts four columns to two', () => {
    expect(normalizeDecklist('2\tSaul\tRoots\tsaul.jpg\nReserve:\n1\tDavid\tPr\tdavid.jpg'))
      .toBe('2\tSaul\nReserve:\n1\tDavid');
  });
  it('leaves two columns, blank lines and space-separated lines alone', () => {
    const t = '2\tSaul\n\nReserve:\n1 David';
    expect(normalizeDecklist(t)).toBe(t);
  });
  it('strips CRLF', () => {
    expect(normalizeDecklist('2\tSaul\tRoots\tsaul.jpg\r\n1\tDavid\r\n')).toBe('2\tSaul\n1\tDavid\n');
  });
  it('does not touch Tokens: and what follows', () => {
    expect(normalizeDecklist('1\tA\tx\ty\nTokens:\n1\tT\tx\ty')).toBe('1\tA\nTokens:\n1\tT\tx\ty');
  });
  it('a normalized four-column export parses to the right names', () => {
    expect(parseDecklistText(normalizeDecklist('2\tSaul\tRoots\tsaul.jpg')).main).toEqual([{ quantity: 2, name: 'Saul' }]);
  });
});
describe('deckTypeFromMain', () => {
  it('follows the Type 2 range', () => {
    expect(deckTypeFromMain(FORMATS.T2.main.min)).toBe('type_2');
    expect(deckTypeFromMain(FORMATS.T2.main.min - 1)).toBe('type_1');
    expect(deckTypeFromMain(FORMATS.T2.main.max + 1)).toBe('type_1');
  });
});
describe('effectiveDeck', () => {
  it('photo source sends the photo text and no deck id', () => {
    expect(effectiveDeck({ source: 'photo', typed: '1\tOld', photoText: '2\tSaul', loadedDeckId: 'd1' }))
      .toEqual({ decklist: '2\tSaul', deckId: null });
  });
  it('paste source normalizes and keeps the loaded deck id', () => {
    expect(effectiveDeck({ source: 'paste', typed: '2\tSaul\tR\ts.jpg', photoText: 'x', loadedDeckId: 'd1' }))
      .toEqual({ decklist: '2\tSaul', deckId: 'd1' });
  });
});
```
(`FORMATS` imported the way `lib/scan/__tests__/deck.test.ts` imports it.)

- [ ] **Step 2: Run** `npx vitest run app/decklist/generate` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(generate): decklist normalization and photo-source helpers`.

### Task 9: `recordScanOutcomesAction`

**Files:**
- Modify: `app/decklist/scan/lib/validateHandoff.ts` (export the outcomes half as `cleanOutcomes(input: unknown, isKnownKey): Record<string, DeckOutcome[]>`; `validateHandoff` calls it), `app/decklist/actions.ts`
- Test: `app/decklist/scan/__tests__/validateHandoff.test.ts` (append)

**Interfaces:**
- Produces: `recordScanOutcomesAction(outcomesByScanId: Record<string, DeckOutcome[]>): Promise<{ ok: boolean }>` — `unauthorized` → `{ ok: false }`; otherwise `cleanOutcomes`, then the same `scan_events` update loop `createDeckFromScanAction` runs (`.eq('id').eq('user_id').eq('mode', 'deck')`), errors logged, `{ ok: true }`. `createDeckFromScanAction` is refactored to share that loop through one private helper in `actions.ts`.

- [ ] **Step 1: Write the failing tests** — `cleanOutcomes` drops a non-UUID scan id, drops an outcome whose id does not belong to its scan, drops an outcome with an unknown `finalKey`, keeps a good one, returns `{}` for `null`, an array, and more than 20 scans.
- [ ] **Step 2: Run** `npx vitest run app/decklist/scan/__tests__/validateHandoff.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS, the existing `validateHandoff` cases included.
- [ ] **Step 5: Commit** `feat(deck-scan): record outcomes without saving a deck`.

### Task 10: Hand-off variants and copy

**Files:**
- Modify: `app/decklist/scan/components/HandoffBar.tsx`, `app/decklist/scan/copy.ts`, `app/decklist/scan/__tests__/copy.test.ts` if it enumerates keys

**Interfaces:**
- Produces: `HandoffBar` prop `variant?: 'sticky' | 'builderOnly'` (default `'sticky'`).
  - `sticky`: as today, plus a line above the buttons: *Need the tournament PDF instead?* `<Link href="/decklist/generate?source=photo">Deck check PDF</Link>` (`text-xs text-muted-foreground`, link underlined).
  - `builderOnly`: no sticky bar, no copy button, no left-out line; one outline button (`min-h-11 w-full sm:w-auto rounded-lg border border-border bg-card px-4 text-sm font-medium`) labelled `DECK_COPY.open`, with the same confirm dialog and save path.
- New `DECK_COPY` keys, text from the spec's table: `sourcePhoto`, `pillNew`, `calloutHeading`, `calloutBody`, `calloutButton`, `signedOutTitle`, `generateConfirm` (`'Generate with {n} cards?'`), `pdfLinkLead` (`'Need the tournament PDF instead?'`), `pdfLink` (`'Deck check PDF'`), `pasteHint` (`'Or read it from a photo'`).

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npx tsc --noEmit` and `npx vitest run app/decklist/scan` — Expected: clean, PASS.
- [ ] **Step 3: Commit** `feat(deck-scan): builder-only hand-off and a Deck check PDF link`.

### Task 11: The photo source, the callout, the picker's third mode

**Files:**
- Create: `app/decklist/generate/PhotoSource.tsx`, `app/decklist/generate/NewFeatureCallout.tsx`
- Modify: `app/decklist/generate/DeckSourcePicker.tsx`

**Interfaces:**
- Consumes: `DeckPhotoReader`, `HandoffBar` (`builderOnly`), `Source`.
- Produces:
  - `PhotoSource({ userId, active, onChange }: { userId: string | null; active: boolean; onChange: (s: DeckTrayState) => void })` — `userId === null`: the signed-out panel (`bg-card rounded-md p-6 text-center`, Lucide `Camera`, `DECK_COPY.signedOutTitle`, **Sign in** → `/sign-in?redirectTo=${encodeURIComponent('/decklist/generate?source=photo')}` primary, **Create an account** → `/sign-up?redirectTo=…` outline). Otherwise `<DeckPhotoReader userId active onChange signInHref={same sign-in href} trayClassName="-mx-6 sm:mx-0" footer={ctx => <HandoffBar {...ctx} variant="builderOnly" />} />`.
  - `NewFeatureCallout({ onRead }: { onRead: () => void })` — the spec's band (`bg-card rounded-md px-4 py-3`, icon in a `bg-primary/15 text-primary` circle, pill, `text-sm font-semibold` heading, `text-sm text-muted-foreground` body, `bg-primary` button full width on a phone and inline right from `sm`). Hidden when `localStorage['generate-photo-callout:v1'] === 'done'` (read in an effect, in try/catch; renders nothing until read). Exports `markPhotoCalloutDone(): void`.
  - `DeckSourcePicker` new props: `source: Source`, `onSourceChange: (s: Source) => void`, `photoSlot: (userId: string | null) => ReactNode`, `photoMounted: boolean`, `lockSource?: boolean`. It drops its own `mode` state and exposes the signed-in user's id it already resolves. The source row is shown to everyone, order *From a photo* (Lucide `Camera`, then the pill), *Paste text*, *My saved decks* (signed in only). Selecting a saved deck calls `onSourceChange('paste')`. When `photoMounted`, the slot is rendered in a wrapper with `hidden={source !== 'photo'}`; before that, only when `source === 'photo'` and auth has resolved. `lockSource` disables the two non-photo chips (a read is in flight). Under the textarea in paste mode: a `type="button"` text link `DECK_COPY.pasteHint` that calls `onSourceChange('photo')`. The `required` attribute comes off the textarea (there is no form any more).

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npx tsc --noEmit` — Expected: errors only in `page.tsx` (its two picker call sites), fixed in Task 12.
- [ ] **Step 3: Commit** `feat(generate): photo source, sign-in panel and callout`.

### Task 12: The generate page

**Files:**
- Modify: `app/decklist/generate/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 8–11; `buildDeckText(state, { columns: 2 })`, `totals`, `deckOutcomes` from the reader's lib; `recordScanOutcomesAction`.

Changes, in order:
1. State: `source: Source` (initial `'paste'`; a mount effect sets `'photo'` when `new URLSearchParams(window.location.search).get('source') === 'photo'`), `photoMounted` (set true the first time `source` is `'photo'`), `photo: { text: string; main: number; cards: number; leftOut: number; reading: boolean; done: number; outcomes: Record<string, DeckOutcome[]> }` derived in `onPhotoChange(state)`, `confirm: null | 'pdf' | 'image'`, refs `deckTypeTouched` and `lastRecorded`.
2. `onPhotoChange`: compute the fields (`reading` = any photo queued or reading; `done` = count of done photos). When `done` rises: if `!deckTypeTouched.current` set the deck type to `deckTypeFromMain(main)`; then `deckTypeTouched.current = false`; call `markPhotoCalloutDone()` unless this is the first report after mount (a restored tray is not a read on this page).
3. Both Deck Type selects set `deckTypeTouched.current = true` in `onChange`.
4. One panel: the header and lead by tab, the tab's options, then the single `DeckSourcePicker`, then the left-out line, then the tab's button. The `<form>` becomes a `div`; both buttons are `type="button"`.
5. `generate(kind: 'pdf' | 'image')`: `const { decklist, deckId } = effectiveDeck(...)`; validate that `decklist`; run the existing PDF or image request with it and `deckId` (also passed to `checkLegality`). On success with `source === 'photo'`: if `outcomesSignature(photo.outcomes) !== lastRecorded.current`, `void recordScanOutcomesAction(photo.outcomes)` and remember the signature.
6. Button click: in photo mode with `photo.leftOut > 0` → `setConfirm(kind)`; else `generate(kind)`. The confirm dialog is the house `Dialog` with title `fill(DECK_COPY.generateConfirm, { n: photo.cards })`, body `fill(DECK_COPY.leftOut, { n: photo.leftOut })`, **Cancel** and **Generate**.
7. Button disabled: loading, or (photo mode: `photo.reading || !photo.text`), or (other modes: `!decklist.trim()`). Label `DECK_COPY.reading` while `source === 'photo' && photo.reading`.
8. Left-out line above the button in photo mode when `photo.leftOut > 0`: `text-sm text-amber-600 dark:text-amber-400`.
9. `<NewFeatureCallout onRead={...} />` between the lead sentence and the tabs; `onRead` sets the source to photo and scrolls the picker's wrapper (`ref`) into view.
10. `lockSource={photo.reading}` on the picker.
11. Download name: the PDF download uses `loadedDeckName` only when `source !== 'photo'`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Run** `npx tsc --noEmit` and `npx vitest run app/decklist` — Expected: clean, PASS.
- [ ] **Step 3: Commit** `feat(generate): deck check PDF and deck image from a photo`.

### Task 13: Nav pill, docs, verify, open PR B

**Files:**
- Modify: `components/top-nav.tsx` (`isNew: true` on *Deck Check PDF*), `CLAUDE.md` (the *Deck photo import* row gains: `app/decklist/generate/PhotoSource.tsx` — the same reader as a source on /decklist/generate; `decklistText.ts` normalizes what goes to the generators)

- [ ] **Step 1: Edit** both files.
- [ ] **Step 2: Run** `npx tsc --noEmit` and `npx vitest run` — Expected: clean, PASS.
- [ ] **Step 3: Browser walk** at 390 px and 1280 px, signed out then signed in: signed out, `/decklist/generate?source=photo` shows the sign-in panel and the three-chip row without *My saved decks*; paste `2\tSaul\tRoots\tsaul.jpg`-style four-column text of two real cards and generate a PDF that lists them. Signed in: the callout shows; **Read a photo** opens the photo source; read one eval photo; switch tab to Visual Screenshot and back while it reads and confirm the read lands; fix one row by chip; pick Lost Souls; Generate; open the PDF and compare its card count to the tray's totals; the callout is gone on reload; *Open in deck builder* opens the deck. On `/decklist/scan` the PDF link lands on the generate page with the same tray.
- [ ] **Step 4: Commit, push, open PR B** against `feat/deck-scan-row-evidence`.
