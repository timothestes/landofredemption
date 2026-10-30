# Deck Photo Import PR 3: the crop pass over groups that need it — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the whole-photo read, re-read each group that has an unread card, fewer reads than its own count, or a sideways orientation, from a tight upscaled crop of the photo, so dark 1024 px deck photos go from about 55% to about 80% recall at the same precision.

**Architecture:** Pure geometry and the sharp crop live in `lib/scan/crop.ts`; the orchestration (which groups, four at a time with a time budget, filter, replace, sums) lives in `lib/scan/cropPass.ts` and calls the existing `recognize()` with a crop mode at effort medium. The route runs the pass between the first pass and classification, sums its spend into the scan event, and reports which groups were cropped. Nothing changes for the client except a longer request timeout; the tray already renders whatever reads come back.

**Tech Stack:** Next.js 15 route handler (Node runtime), sharp (extract, rotate, resize), `@anthropic-ai/sdk` 0.78 through `recognize()`, Vitest (node only; sharp works in tests, see `lib/scan/__tests__/image.test.ts`).

> **As built (2026-10-30):** this plan was executed in #552 with three changes found during review and E0; the spec's *Amendments after PR 3* is the record. `needsCrop` fires only for non-upright groups (upright re-reads were net negative); `CROP_EDGE` was removed and crops fill the high tier's patch budget (`fillToTier`); the pass ends by a hard deadline (`requestStart + 140 s`, `MIN_CROP_REMAINING_MS` 12 s, `cropCallTiming`). #553 added `inferSidewaysRows`. Tests and constants below that say otherwise describe the plan, not the code.

**Spec:** `docs/superpowers/specs/2026-10-29-deck-photo-import-design.md`. Sections this PR implements: *Amendments after E0* (the PR 3 paragraph: measured numbers, pad, filter, concurrency, retry, budget), *Second pass over groups that need it (PR 3)*, *Cost and latency* (`maxDuration` 150, client timeout 170 s), Evaluation (the posted-grade target applies from here), Rollout step 3. Read `lib/scan/recognize.ts`, `lib/scan/deckSchema.ts`, `lib/scan/deckClassify.ts` and the deck branch of `app/api/scan/route.ts` before starting; the experiment that produced the numbers is in the session scratchpad as `zoom-pass.ts` and is reproduced in Task 5.

## Global Constraints

- Worktree off `origin/main` (CLAUDE.md): `git worktree add ../rtt-deck-scan-crops -b feat/deck-scan-crops origin/main`; absolute paths; `git add` only your files. Worktrees have no `node_modules`: `cp -Rc ../redemption-tournament-tracker/node_modules ./node_modules` (CoW clone); never symlink it. No `.env.local` either; tests need none.
- Crop pass constants, verbatim from the spec: pad **4%** of the image on each side (`CROP_PAD = 0.04`); long edge **1600 px** (`CROP_EDGE = 1600`), `lanczos3`, JPEG quality 85 with mozjpeg; title-box filter tolerance **1.5%** (`CROP_FILTER_TOL = 0.015`); **four** crops in flight (`CROP_CONCURRENCY = 4`); at most **12** groups cropped per photo (`MAX_CROP_GROUPS = 12`, builder's cap: no deck photo in the eval set has more than 8); crop calls at **effort medium** (`CROP_ARM = { ...DECK_ARM, effort: 'medium' }`); per-crop-call timeout **30,000 ms**; one retry on a connection error or 5xx within 15 s of the call's start.
- A group needs a crop when any read in it has `title === null`, or it has fewer reads than its `cardCount`, or its `orientation !== 'upright'`. Group 0 (the parser's synthetic orphan group, bbox `[0,0,1,1]`) is never cropped.
- Orientation to rotation, verbatim from the instruction's definitions: `rotated_ccw` (tops toward the left edge, text bottom to top) → rotate **90°** clockwise (`sharp.rotate(90)`); `rotated_cw` → **270**; `upside_down` → **180**; `upright` → 0.
- Crop source is the tier-fit JPEG the first pass used (what `encodeForScan` returned, already EXIF-oriented); its `width`/`height` come from the same call. Boxes are normalized to that image.
- Crop reads replace the group's first-pass reads only when the crop call succeeds; a failed crop keeps the first-pass reads and is logged with the scan id, group id and the recognizer detail, never the image.
- Budget: the route's `maxDuration` becomes **150**; the pass gets a time budget and starts no crop once it is used up. `REQUEST_TIMEOUT_MS` in `app/collection/scan/hooks/useScanQueue.ts` becomes **170_000**.
- The first pass is unchanged: `DECK_ARM` stays effort high, `DECK_MODE` stays 80 s, `settleAbPairs` stays skipped in deck mode, `DECK_DETECTION_CAP` (300) applies after the crop pass.
- Scan event sums: `inputTokens`, `outputTokens`, `costUsd` and `latencyMs` add every crop call to the first pass; `attempts` = first-pass attempts + crop calls made (including retries).
- Tests are Vitest, node only, no DOM, never the network. `lib/scan/cropPass.ts` takes its `recognize` and `crop` as injectable deps so its tests need neither sharp nor Claude; `crop.ts` tests use sharp on synthetic images as `image.test.ts` does. Route tests mock `@/lib/scan/cropPass` the way they mock `@/lib/scan/abCompare` (pass-through spy) and feed the crop pass through the mocked `recognize`.
- Style: match `lib/scan/*`: terse one-line JSDoc, hand-rolled validation, no zod.
- Not in this PR: group strips (stay off), per-card title crops as thumbnails, the deck-mode cap (the spec names it as the first lever only if the deck share of spend grows; E3 queries watch it), copy for a second pass in progress (one request, nothing to show mid-flight).

## Review Focus

1. **The first pass used most of the budget** (an 80 s dark Type 2 photo): the crop pass must start no crop once its budget is spent and must never push the request past `maxDuration`. Test in Task 3 (`cropPass.test.ts`, "starts no crop after the budget is used up").
2. **A crop read with no `titleBox` on an upright group** has nowhere to be placed; it is kept (dropping it would lose a card the model saw), and a read whose centre lands in a neighbouring column is dropped. Test in Task 3 ("keeps a boxless read and drops a neighbour's").
3. **A rotated group's crop reads are kept whatever their boxes say**: the box filter is for upright groups only, since a rotated crop's coordinates are not the photo's. Test in Task 3 ("a rotated group keeps every read").
4. **A failed crop call** (connection error twice, 5xx twice, `max_tokens`, unparseable) keeps the group's first-pass reads including its unread rows, costs what it billed, and never fails the request. Tests in Task 3 ("a failed crop keeps the first-pass reads") and Task 4 (route, "a failed crop keeps the first-pass reads and the row is still done").
5. **A degenerate box** (zero width after clamping, or a box that is the whole image) must not throw inside sharp: `cropRect` returns at least 1×1 and the pass skips group 0 by rule. Test in Task 1 ("a zero-width box gives a 1 px rect") and Task 3 ("group 0 is never cropped").

---

### Task 1: `lib/scan/crop.ts` — geometry and the sharp crop

**Files:**
- Create: `lib/scan/crop.ts`
- Test: `lib/scan/__tests__/crop.test.ts`

**Interfaces:**
- Produces:
  - `export const CROP_PAD = 0.04; export const CROP_EDGE = 1600; export const CROP_FILTER_TOL = 0.015;`
  - `export interface CropRect { left: number; top: number; width: number; height: number }` (integer pixels in the source image)
  - `export function cropRect(bbox: Box, width: number, height: number, pad = CROP_PAD): CropRect` — pad is a fraction of the image's width (left/right) and height (top/bottom); clamp to the image; `width`/`height` at least 1.
  - `export function rotationFor(orientation: DeckGroup['orientation']): 0 | 90 | 180 | 270`
  - `export function needsCrop(group: DeckGroup, reads: DeckRead[]): boolean` — the three conditions in Global Constraints; `false` for `group.id === 0`.
  - `export function titleCentreInBox(titleBox: Box, rect: CropRect, bbox: Box, width: number, height: number, tol = CROP_FILTER_TOL): boolean` — the read's box is normalized to the (unrotated) crop; map its centre to image coordinates through `rect`; true when the centre lies within `bbox` widened by `tol` on each side (tol is a fraction of the image).
  - `export function keepCropRead(read: DeckRead, group: DeckGroup, rect: CropRect, width: number, height: number): boolean` — `true` for a non-upright group or a read with `titleBox === null`; else `titleCentreInBox`.
  - `export async function cropGroup(jpeg: Buffer, group: DeckGroup, width: number, height: number): Promise<Buffer>` — `sharp(jpeg).extract(cropRect(...))` to a buffer, then a second pipeline `sharp(buf).rotate(rotationFor(...)).resize(...)` to a long edge of `CROP_EDGE` (enlarging allowed, `kernel: 'lanczos3'`, keep aspect) `.jpeg({ quality: 85, mozjpeg: true })`. Two pipelines on purpose: sharp applies `rotate` before `extract` within one pipeline.

- [ ] **Step 1: Write the failing tests** in `lib/scan/__tests__/crop.test.ts`:

```ts
it('pads by 4% of each dimension and clamps', () => expect(cropRect([0.5, 0.5, 0.6, 0.9], 1000, 500, 0.04)).toEqual({ left: 460, top: 230, width: 180, height: 240 }));
it('clamps at the image edges', () => expect(cropRect([0, 0.9, 0.1, 1], 1000, 500)).toEqual({ left: 0, top: 430, width: 140, height: 70 }));
it('a zero-width box gives a 1 px rect', () => { const r = cropRect([0.5, 0.5, 0.5, 0.5], 1000, 500, 0); expect(r.width).toBe(1); expect(r.height).toBe(1); });
it('maps orientations to rotations', () => expect(['upright', 'rotated_ccw', 'rotated_cw', 'upside_down'].map(o => rotationFor(o as any))).toEqual([0, 90, 270, 180]));
it('needsCrop: unread, short, or sideways; never group 0', () => { /* four groups: one with a null title read → true; one with 3 reads and cardCount 4 → true; one rotated_ccw with full reads → true; one upright and complete → false; group 0 with a null title → false */ });
it('titleCentreInBox: inside, outside, and within tolerance', () => { const rect = { left: 460, top: 230, width: 180, height: 240 }; const bbox: Box = [0.5, 0.5, 0.6, 0.9]; expect(titleCentreInBox([0.4, 0.4, 0.6, 0.5], rect, bbox, 1000, 500)).toBe(true); expect(titleCentreInBox([0.9, 0.4, 1, 0.5], rect, bbox, 1000, 500)).toBe(false); expect(titleCentreInBox([0.0, 0.4, 0.1, 0.5], rect, bbox, 1000, 500, 0.015)).toBe(false); expect(titleCentreInBox([0.0, 0.4, 0.1, 0.5], rect, bbox, 1000, 500, 0.05)).toBe(true); });
it('keepCropRead keeps boxless reads and everything in a rotated group', () => { /* upright + null titleBox → true; rotated_ccw + a box far outside → true; upright + a box far outside → false */ });
it('cropGroup rotates a sideways group upright and upscales to the long edge', async () => { const src = await sharp({ create: { width: 1000, height: 500, channels: 3, background: '#888' } }).jpeg().toBuffer(); const out = await cropGroup(src, { id: 1, orientation: 'rotated_ccw', bbox: [0.1, 0.1, 0.5, 0.3], cardCount: 5 }, 1000, 500); const m = await sharp(out).metadata(); expect(m.format).toBe('jpeg'); expect(Math.max(m.width!, m.height!)).toBe(1600); expect(m.height!).toBeGreaterThan(m.width!); });
it('cropGroup keeps an upright group landscape', async () => { /* same source, orientation upright → width > height, long edge 1600 */ });
```

Derive the first expectation by hand: pad 40 px left/right, 20 px top/bottom; bbox 500..600 × 250..450 → 460..640 × 230..470.

- [ ] **Step 2: Run** `npx vitest run lib/scan/__tests__/crop.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `lib/scan/crop.ts` with the signatures above. `cropRect` uses `Math.floor` for `left`/`top` and `Math.ceil` for the far edges before subtracting, then clamps to `[0, width]`/`[0, height]` and applies `Math.max(1, …)`.
- [ ] **Step 4: Run** the test file — Expected: PASS.
- [ ] **Step 5: Commit** `git add lib/scan/crop.ts lib/scan/__tests__/crop.test.ts && git commit -m "feat(deck-scan): crop geometry and the sharp group crop"`.

---

### Task 2: `recognize()` retries a connection error once

**Files:**
- Modify: `lib/scan/recognize.ts` (`classify`)
- Test: `lib/scan/__tests__/recognize.test.ts`

**Interfaces:**
- Produces: a thrown `APIConnectionError` (the SDK's class, of which `APIConnectionTimeoutError` is a subclass) classifies as `{ kind: 'retryable', overloaded: false }`, so it gets the single retry inside `retryWithinMs` like a 5xx does. Collection mode gains the same retry (its `retryWithinMs` is `Infinity`); the spec's "one retry on a connection error" needs it and a lost socket is as transient as a 500.

- [ ] **Step 1: Write the failing tests** (same style as the file's existing cases):

```ts
it('a connection error retries once, then succeeds', async () => { let n = 0; const r = await recognize(Buffer.alloc(10), DEFAULT_ARM, { sleep: noSleep, create: async () => { if (++n === 1) throw new APIConnectionError({ message: 'Connection error.' }); return ok(good); } }); expect(r.ok && r.attempts).toBe(2); });
it('a connection error twice is recognizer_failed and unbilled', async () => { const r = await recognize(Buffer.alloc(10), DEFAULT_ARM, { sleep: noSleep, create: async () => { throw new APIConnectionError({ message: 'Connection error.' }); } }); expect(r.ok === false && r.code).toBe('recognizer_failed'); expect('usage' in r).toBe(false); });
it('deck mode does not retry a connection error after retryWithinMs', async () => { let t = 0; let n = 0; const r = await recognize(Buffer.alloc(10), DECK_ARM, { now: () => t, sleep: noSleep, create: async () => { n++; t += 11_000; throw new APIConnectionError({ message: 'Connection error.' }); } }, DECK_MODE); expect(n).toBe(1); expect(r.ok).toBe(false); });
```

`APIConnectionError` is imported from `@anthropic-ai/sdk` next to `APIConnectionTimeoutError`.

- [ ] **Step 2: Run** `npx vitest run lib/scan/__tests__/recognize.test.ts` — Expected: the first and third FAIL (one attempt, `recognizer_failed`).
- [ ] **Step 3: Implement**: in `classify`, after the `APIConnectionTimeoutError` check, `if (err instanceof APIConnectionError) return { kind: 'retryable', overloaded: false };`. Nothing else changes.
- [ ] **Step 4: Run** the file — Expected: PASS, all existing cases still green.
- [ ] **Step 5: Commit** `git add lib/scan/recognize.ts lib/scan/__tests__/recognize.test.ts && git commit -m "fix(scan): retry a connection error once like a 5xx"`.

---

### Task 3: `lib/scan/cropPass.ts` — which groups, four at a time, filter, replace, sums

**Files:**
- Create: `lib/scan/cropPass.ts`
- Test: `lib/scan/__tests__/cropPass.test.ts`

**Interfaces:**
- Consumes: Task 1's `needsCrop`, `cropRect`, `keepCropRead`, `cropGroup`; `recognize`, `DECK_ARM`, `DECK_MODE`, `RecognizeMode`, `RecognizeResult` from `recognize.ts`; `DeckOutput`, `DeckRead`, `DeckGroup`, `DECK_INSTRUCTION` from `deckSchema.ts`.
- Produces:
  - `export const CROP_CONCURRENCY = 4; export const MAX_CROP_GROUPS = 12; export const CROP_CALL_TIMEOUT_MS = 30_000;`
  - `export const CROP_PREFIX = 'This is one group cropped from a larger deck photo and turned upright; read every card in it. Report it as a single group with id 1.\n\n';`
  - `export const CROP_MODE: RecognizeMode<DeckOutput> = { ...DECK_MODE, instruction: CROP_PREFIX + DECK_INSTRUCTION, timeoutMs: CROP_CALL_TIMEOUT_MS, retryWithinMs: 15_000 };`
  - `export const CROP_ARM: Required<Arm> = { ...DECK_ARM, effort: 'medium' };`
  - `export interface CropPassDeps { recognize?: typeof recognize; crop?: typeof cropGroup; now?: () => number }`
  - `export interface CropPassResult { cards: DeckRead[]; cropped: number[]; failed: number[]; skipped: number[]; usage: { inputTokens: number; outputTokens: number }; costUsd: number; latencyMs: number; calls: number; failures: { group: number; code: string; detail?: unknown }[] }`
  - `export async function runCropPass(jpeg: Buffer, out: DeckOutput, image: { width: number; height: number }, budgetMs: number, deps: CropPassDeps = {}): Promise<CropPassResult>`

Behaviour, in order: candidates are `out.groups` with `needsCrop(g, readsOf(g))`, in ascending `id`, truncated to `MAX_CROP_GROUPS` (the rest go to `skipped`). Run them through a pool of `CROP_CONCURRENCY` workers; before a worker starts a group it checks `now() - started < budgetMs`, else the group goes to `skipped`. Per group: `crop(jpeg, g, width, height)` → `recognize(buf, CROP_ARM, {}, CROP_MODE)`. On `ok`: `kept = r.output.cards.filter(read => keepCropRead(read, g, rect, width, height))`, each kept read gets `group: g.id` and `position: i + 1` (renumbered), and `cropped` gains the id. On failure (or a throw from `crop`/`recognize`, caught per group): `failed` gains the id and `failures` the code and `detail`. `cards` is rebuilt in `out.groups` order: a cropped group's kept reads, otherwise its first-pass reads; reads of group 0 last, unchanged. Sums: `usage`, `costUsd` from every result that carries them (failures included), `calls` = sum of `attempts` over results, `latencyMs` = wall time of the pass.

- [ ] **Step 1: Write the failing tests** in `lib/scan/__tests__/cropPass.test.ts` with a `read()` helper like the route test's and stubs `crop = async () => Buffer.alloc(1)` and a `recognize` stub returning `{ ok: true, output: { photoQuality: 'ok', groups: [g1], cards }, model: 'claude-sonnet-5-5', usage: { inputTokens: 1000, outputTokens: 100 }, costUsd: 0.003, latencyMs: 50, attempts: 1 }`:

```ts
it('crops only the groups that need it, in id order, and caps at MAX_CROP_GROUPS', ...); // 14 needy groups → cropped has 12 ids ascending, skipped the other 2
it('group 0 is never cropped', ...);
it('runs at most four crops at a time', ...); // recognize stub increments/decrements an in-flight counter around an awaited promise it resolves later; assert max in-flight === 4 with 9 needy groups
it('replaces a cropped group’s reads, renumbers positions, keeps the other groups’ reads in order', ...); // group 2 needy: result cards = g1 first-pass, g2 crop reads with group 2 and positions 1..n, g3 first-pass
it('keeps a boxless read and drops a neighbour’s', ...); // upright group, crop reads: one titleBox null (kept), one centred inside (kept), one centred outside (dropped)
it('a rotated group keeps every read', ...);
it('a failed crop keeps the first-pass reads', ...); // recognize returns { ok: false, code: 'recognizer_failed', latencyMs, attempts: 2, usage, costUsd } → cards unchanged for that group, failed has it, failures[0].code === 'recognizer_failed', costUsd summed
it('a throw from crop is a failure, not a rejection', ...);
it('starts no crop after the budget is used up', ...); // now() advances 20_000 per call, budgetMs 30_000, 4 needy groups with concurrency 1 (stub 2 of them) → cropped 2, skipped 2 — use a deps.now sequence
it('sums usage, cost and calls across crops', ...); // 3 crops with attempts 1, 2, 1 → calls 4, usage summed
it('uses CROP_ARM at effort medium and CROP_MODE with the prefix and 30 s timeout', ...); // capture the stub's args
```

- [ ] **Step 2: Run** `npx vitest run lib/scan/__tests__/cropPass.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `lib/scan/cropPass.ts`. The pool is a small loop: an index shared by `CROP_CONCURRENCY` async workers started with `Promise.all`, each taking the next group until none remain (the same shape as `run.ts`'s worker in `scripts/scan-eval`). Wrap each group's crop and call in `try/catch` so one throw cannot reject the pass.
- [ ] **Step 4: Run** the file — Expected: PASS.
- [ ] **Step 5: Commit** `git add lib/scan/cropPass.ts lib/scan/__tests__/cropPass.test.ts && git commit -m "feat(deck-scan): crop pass over the groups that need it"`.

---

### Task 4: Route integration, budget, response field, client timeout

**Files:**
- Modify: `app/api/scan/route.ts` (`maxDuration`, the `mode === 'deck'` branch)
- Modify: `lib/scan/deckClassify.ts` (`DeckScanResponse`)
- Modify: `app/collection/scan/hooks/useScanQueue.ts` (`REQUEST_TIMEOUT_MS` and its comment)
- Test: `app/api/scan/__tests__/route.test.ts` (the `deck mode` describe)

**Interfaces:**
- Consumes: Task 3's `runCropPass`, `CROP_ARM`, `CROP_MODE`.
- Produces: `DeckScanResponse.crops: { cropped: number[]; failed: number[]; skipped: number[] }` (always present in deck mode); `export const maxDuration = 150;` `REQUEST_TIMEOUT_MS = 170_000`.

Route behaviour: `encodeForScan` already returns `{ jpeg, width, height }`; keep `width`/`height`. In the deck branch, after `r.ok` and before `reads = out.cards.slice(...)`: `const budgetMs = Math.max(0, ROUTE_BUDGET_MS - r.latencyMs)` where `const ROUTE_BUDGET_MS = 130_000` (20 s under `maxDuration` for encode, prices, classify and finish); `const cp = await runCropPass(jpeg, out, { width, height }, budgetMs)`; for each entry in `cp.failures` log `console.error('[scan] crop failed', { scanId, group, code, detail })`; then `reads = cp.cards.slice(0, DECK_DETECTION_CAP)`. Sums: `usage = { inputTokens: r.usage.inputTokens + cp.usage.inputTokens, … }`, `costUsd = r.costUsd + cp.costUsd`, `latencyMs = r.latencyMs + cp.latencyMs`, `attempts = r.attempts + cp.calls`; `spent` is updated to the sums before `finish` (so an unexpected throw after the pass records the crop spend); `finish` and the response `usage` use the sums; the response gains `crops: { cropped: cp.cropped, failed: cp.failed, skipped: cp.skipped }`.

- [ ] **Step 1: Write the failing tests** in the `deck mode` describe. Mock `@/lib/scan/cropPass` as a pass-through spy on `runCropPass` (the `abCompare` pattern at the top of the file) so the real pass runs against the mocked `recognize` and a stubbed crop: to avoid sharp on a 10-byte buffer, give the spy `deps` with `crop: async () => Buffer.alloc(1)` by wrapping: `runCropPass: vi.fn((jpeg, out, image, budget, deps) => real.runCropPass(jpeg, out, image, budget, { ...deps, crop: async () => Buffer.alloc(1) }))`. Then:

```ts
it('runs the crop pass on groups that need it and replaces their reads', ...); // recognize: first call → deckOk with group 1 complete + group 2 with a null-title read; second call (the crop) → group-1-shaped output with two titled reads → response.detections for group 2 are the two crop reads, crops.cropped === [2], crops.failed === []
it('a complete upright photo makes no crop call', ...); // recognize called once; crops.cropped === []
it('sums crop spend and calls into the event row and usage', ...); // finish patch: input_tokens, output_tokens, cost_usd, attempts, latency_ms equal first pass + crop; response.usage.latencyMs is the sum; superuser sees the summed costUsd
it('a failed crop keeps the first-pass reads and the row is still done', ...); // second recognize call → { ok: false, code: 'recognizer_failed', attempts: 2, latencyMs: 5, usage: {…}, costUsd: 0.01 } → detections for the group unchanged (null-title read still present), crops.failed === [2], status 200, row status 'done', cost summed, console.error called with scanId and group
it('passes a budget that shrinks with the first pass latency', ...); // first-pass latencyMs 100_000 → runCropPass called with budgetMs 30_000; latencyMs 140_000 → 0
it('maxDuration is 150', () => expect(maxDuration).toBe(150)); // import { maxDuration } from the route
```

- [ ] **Step 2: Run** `npx vitest run app/api/scan/__tests__/route.test.ts` — Expected: the new cases FAIL.
- [ ] **Step 3: Implement** the route changes, the `crops` field on `DeckScanResponse` (also add it to the stored `finish` detections? No: `crops` is response-only; the event row keeps `detections` as today), and the client timeout with its comment updated to "Just past the route's maxDuration (150 s)".
- [ ] **Step 4: Run** the route tests, then `npx vitest run app/decklist/scan app/collection/scan` — Expected: PASS; the deck page's reducer ignores unknown response fields, so nothing there changes.
- [ ] **Step 5: Run** `npx tsc --noEmit -p tsconfig.json` — Expected: clean.
- [ ] **Step 6: Commit** `git add app/api/scan/route.ts lib/scan/deckClassify.ts app/collection/scan/hooks/useScanQueue.ts app/api/scan/__tests__/route.test.ts && git commit -m "feat(deck-scan): run the crop pass in the route; maxDuration 150; client timeout 170 s"`.

---

### Task 5: `scripts/scan-eval/cropReplay.ts` — replay the pass on recorded first passes

**Files:**
- Create: `scripts/scan-eval/cropReplay.ts`
- Modify: `scripts/scan-eval/deckScore.ts` (one summary column)
- Test: none (a tool; it calls Claude)

**Interfaces:**
- Consumes: `runCropPass` (Task 3), `deckReadToDetection`, `classifyDeckRead`, `DeckDetection` from `deckClassify.ts`, `matchDetection`, `capDetection`, `encodeForScan`.
- Produces: a CLI, header comment in `run.ts`'s style:

```
npx tsx scripts/scan-eval/cropReplay.ts --in scripts/scan-eval/outputs/deck-<arm>/ --photos scripts/scan-eval/photos-deck \
  --out scripts/scan-eval/outputs/deck-<arm>-crops/ [--only <file>,<file>] [--budget 130000]
```

For each `<file>.json` in `--in`: rebuild a `DeckOutput` from the record (`groups` as stored; each detection back to a `DeckRead`: `title`, `strength`, `toughness`, `type`, `brigade`, `reference` from `read`, plus `group`, `position`, `titleBox`, and `confidence` from `read.confidence`); `encodeForScan` the photo at tier `high`; `runCropPass` with the real recognizer (needs `SCANNER_ANTHROPIC_API_KEY`; load `.env.local` through `dotenv` with `ENV_FILE` override as the spike scripts do); classify the resulting cards exactly as the route does (empty price map); write a record in `run.ts`'s shape (`{ ...response, file, status: 200, latencyMs, attempts }`) with `crops` filled and `usage.costUsd` = the crop cost, printing per photo the cropped, failed and skipped ids, cost and wall time. `deckScore.ts` prints a `crops` column (count of `crops.cropped`, blank when the field is absent).

- [ ] **Step 1: Implement** the script and the scorer column.
- [ ] **Step 2: Verify** on the committed medium-arm recordings without spending: `npx tsx scripts/scan-eval/cropReplay.ts --in scripts/scan-eval/outputs/deck-sonnet55-medium --photos scripts/scan-eval/photos-deck --out /tmp/replay --only none` — Expected: "0 photos" and no crash (the `--only` filter matches nothing). Then one real photo if the key is set locally: `--only 20260811_134449.webp` — Expected: about 8 crops, about $0.13, recall in `deckScore` above 0.75 for that photo.
- [ ] **Step 3: Commit** `git add scripts/scan-eval/cropReplay.ts scripts/scan-eval/deckScore.ts && git commit -m "feat(scan-eval): replay the crop pass on recorded first passes"`.

---

### Task 6: E0 through the preview, docs, PR

**Files:**
- Modify: `CLAUDE.md` (the Deck photo import row: add `lib/scan/crop.ts`, `lib/scan/cropPass.ts`, `cropReplay.ts`)
- Create: `scripts/scan-eval/outputs/deck-sonnet55-high-crops/*.json` (the four recordings; `.gitignore` line 126 ignores `outputs/*/`, so add `!scripts/scan-eval/outputs/deck-sonnet55-high-crops/` below it as PR 2 did for its recordings)

- [ ] **Step 1: Open the PR** from the worktree: `gh pr create --base main --head feat/deck-scan-crops --title "feat(deck-scan): crop pass over the groups that need it (PR 3)"`, body per the repo's PR style, ending with the attribution line.
- [ ] **Step 2: Run E0 through the preview.** The preview is behind Vercel Authentication; `run.ts` cannot pass it, `vercel curl` can. Mint a superuser session per `.claude/skills/verify/SKILL.md` into a scratchpad file, then for each photo:

```bash
npx -y vercel@latest curl "$PREVIEW/api/scan" -X POST -H "Cookie: $(cat "$S/.scan-session")" \
  -F "photo=@scripts/scan-eval/photos-deck/$f;type=image/jpeg" -F mode=deck -F source=eval -s -o "$OUT/$f.raw"
```

Wrap each body as `run.ts` would (`{ ...body, file, status: 200, latencyMs: body.usage.latencyMs, attempts: body.usage.attempts }`) into `$OUT/$f.json`, then `npx tsx scripts/scan-eval/deckScore.ts --labels scripts/scan-eval/labels-deck.json --outputs $OUT`. Delete the session file afterwards.

Expected, against the PR 2 baseline recorded on #550 (sharp 1.00/1.00; Star Wars 1.00/0.92; dark 0.83/0.56 and 0.77/0.53):
- sharp photo: `crops.cropped` empty, precision and recall unchanged at 1.00, cost unchanged within $0.02;
- both dark photos: recall ≥ 0.75, precision ≥ 0.75, `crops.cropped` with 6–8 ids, cost ≤ $0.25, `usage.latencyMs` ≤ 90 s;
- no photo returns a 5xx or times out.

If a dark photo misses the recall floor, replay it locally with `cropReplay.ts` at pad 0.03 and 0.05 (add a `--pad` flag if needed) and record the better value in the spec's amendment before changing the constant.

- [ ] **Step 3: Commit the recordings and docs** `git add CLAUDE.md .gitignore scripts/scan-eval/outputs/deck-sonnet55-high-crops && git commit -m "test(deck-scan): E0 recordings with the crop pass; docs"`; push.
- [ ] **Step 4: Full check** `npx vitest run && npx tsc --noEmit -p tsconfig.json` — Expected: green. Post the E0 table as a PR comment in the same shape as #550's.
