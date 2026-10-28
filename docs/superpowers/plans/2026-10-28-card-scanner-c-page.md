# Card scanner PR C (scan page, tray, commit, undo; entry links and /privacy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gated `/collection/scan` page where a player photographs cards, reviews them in a tray, fixes printings, commits once (idempotently) to their collection and can undo; plus the entry links, `?format=`/`?added=` on `/collection`, and `/privacy`.

**Architecture:** Two independent branches off `origin/main`. **C-core** (`feat/scan-page`, worktree `../rtt-scan-c`) adds the page, its pure tray reducer and outcome builder, client image prep and upload queue, and two server actions whose logic lives in a dependency-injected core module so it is unit-testable. **C-entry** (`feat/scan-entry`, worktree `../rtt-scan-entry`) edits the hot shared files (`/collection` client, deck builder, `globals.css`) and adds `/privacy`. Neither imports the other; they can merge in either order.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (user client for `collection_cards`, service-role client for `scan_events`/`scan_commits`), Tailwind + house `components/ui/dialog.tsx`, Vitest (node only).

**Spec:** `docs/superpowers/specs/2026-10-26-card-scanner-design.md` rev 4.4 — The flow (614–757), `POST /api/scan` (760–815), Retention and privacy (899–921), Copy and accessibility (1353–1425), Files (1426–1469), Testing (1470–1494), Rollout step 3.

## Global Constraints

- All work in the task's worktree with absolute paths; `git add` named files only; never touch the main checkout.
- Client components import from `lib/scan/*` **type-only** (`import type`). Never value-import `lib/scan/schema.ts`, `match.ts`, `stemIndex.ts`, `gate.ts` in a `"use client"` file.
- The catalog (`lib/cards/search`, `lib/cards/lookup`, `lib/cards/cardIdentity`) may reach the client only through a lazy `import()` inside the picker's search.
- No direct client writes. Commit and undo are server actions in `app/collection/actions.ts`; `scan_events`/`scan_commits` writes use `getSupabaseAdmin()` (`lib/pricing/supabase-admin.ts`); `collection_cards` writes use the user's client exactly as `bulkImportCollectionAction` does.
- No new migration. No changes to migration 122 objects, caps, Vercel env, `tmp/card_images/`, `tmp/scan-spike/`, `scripts/scan-eval/labels.json`, `scripts/scan-eval/photos/`.
- Copy strings verbatim from the spec's Copy table; the copy module (Task 3) is the single source.
- Mobile first: 390 px layouts, 44 px touch targets (`min-h-11`/`min-w-11`), `pb-[env(safe-area-inset-bottom)]` on the sticky footer. No focus rings (`focus:outline-none`, no `ring` on focus), green (`primary`) only for actions/states, no decorative animation.
- Capture inputs: `accept="image/*"` exactly; Take photo adds `capture="environment"`; Choose from photos adds `multiple`.
- Client resize: decode via `<img>` (never `createImageBitmap(file)`), long edge ≤ 2576, JPEG 0.85, hard stop 3 MB (3 × 1024 × 1024 bytes).
- Two uploads in flight at most. `navigator.onLine` checked before each upload.
- `/collection/scan` returns `notFound()` for a signed-in user `canScanForSession` refuses; signed-out users get the sign-in gate with `redirectTo=/collection/scan`.
- Tests: `npm test -- <path>`; `npx tsc --noEmit` stays at 0 errors. No `next build`.
- Real `POST /api/scan` calls: at most ~$1 total; UI work uses fixtures.

## Review Focus

1. **A commit retried after a timeout the server had completed** must replay, not add twice; two concurrent calls with one `commitId` add once and the loser gets `in_progress` then the replay. → Task 2 tests `replays a completed commit` and `two concurrent commits add once`.
2. **Undo tapped twice, or after the player manually lowered a quantity on `/collection`**, must never subtract twice and never go below zero (delete at 0). → Task 2 tests `undo twice subtracts once` and `undo clamps at zero and deletes`.
3. **A tray that survives a reload** (sessionStorage) while photos were mid-upload: files are gone, so in-flight photos become failed "Photo N" groups with Remove only, and a pending `commitId` survives so the retry replays. → Task 1 test `rehydrate marks in-flight photos failed and keeps pendingCommitId`.
4. **The same card in two photos** merges into the earlier row (qty 2) yet both detections get outcomes. → Task 1 tests `duplicate key from a later photo increments the earlier row` and `outcomes cover every detection of a merged row`.
5. **Vercel's own 413** is `text/plain`, not JSON; a 503 busy carries `Retry-After`. The error mapper must not throw on a non-JSON body. → Task 3 test `maps a text/plain 413 to Too large`.

---

## Rulings (ledger; reported in both PR descriptions)

| # | Ruling | Cost if wrong |
|---|---|---|
| R1 | C-entry branches off `origin/main` independently (not stacked); C-core's `/privacy` link 404s until C-entry merges. | One dead link for the merge gap; gated to the allowlist anyway. |
| R2 | Commit reuses `bulkImportCollectionAction(rows, 'merge')` verbatim (spec "same path"); deltas = validated per-key quantities. | Inherits its read-modify-write race with a concurrent edit in another tab (existing behavior). |
| R3 | Server copies `status`, `nameReason`, `printingReason`, `scores` onto each outcome from the stored `scan_events.detections`, not from the client. Client sends only correction fields. `queries.sql` needs only its comment updated. | None for the queries; outcomes are larger (~150 B per detection). |
| R4 | Server requires outcomes to cover exactly the stored detection ids of each scan; otherwise `bad_request`. | A client bug blocks commit rather than writing partial metrics. |
| R5 | A merge failure after the `scan_commits` insert deletes that row so the same `commitId` can retry. | If the delete also fails, the retry returns `in_progress` forever; client falls back to Commit failed copy after 3 polls and a fresh commitId on the next tap. |
| R6 | Undo claims first (sets `result.undoneAt` with a conditional update) then decrements; a partial failure after the claim is reported, never retried. | A rare partial undo needs a manual fix on `/collection`; never a double subtraction. |
| R7 | Undo is refused if any later `scan_commits` row exists for the user (spec "disabled after a later commit"); after a successful undo the tray returns to editable with a new commitId and may be committed again; the last commit's outcomes overwrite earlier ones. | An undone-then-recommitted tray records its final state only. |
| R8 | Outcomes are kept on undo. | E3 counts an undone commit as committed. |
| R9 | `nameChanged` = final key not among the detection's `candidates` (picked via search) or a `not_found` row resolved by Find card; `printingChanged` = final key differs from `chosenKey` but is in `candidates`. | A search pick that lands on a same-identity printing counts as a name change; rare. |
| R10 | Picker changes do not re-merge rows; the server sums identical keys. | Two rows can show the same card briefly. |
| R11 | No swipe-to-remove in v1.0; the visible 44 px Remove opens the two-option Wrong card / Don't want it control. | Slightly slower bulk removal. |
| R12 | `owned before commit` is not persisted (undo is server-authoritative). | None. |
| R13 | Busy (503 upstream_*) auto-retries twice honoring `Retry-After` capped at 60 s; each retry is a new reserved photo. | Two extra cap slots per busy photo. |
| R14 | `billing_error` copy is Credit out without a date ("The scanner's monthly budget is used up."); `cap_global_spend` uses `resetsAt` for the date. | Slightly less specific copy. |
| R15 | Photos returning detections with `photoQuality !== 'ok'` show Done plus the quality line; zero detections show the quality copy (or No cards) as a failure with Retry · Remove · Choose another. | — |
| R16 | Deck builder learns `canScan` from a server action `canScanAction()` (keeps `/decklist/card-search` static); `/collection` gets it as a prop from its already-dynamic page. | One extra server-action round-trip in the deck builder, only for signed-in users when an entry point renders. |
| R17 | `/collection` toolbar is unchanged for users the gate refuses; the below-`sm` fold happens only when Scan is shown. | Two toolbar shapes. |
| R18 | Verification uses a non-Tim test account allowlisted via the worktree's own `.env.local`, seeded `source='eval'` `scan_events` rows for fixture commits, and one or two real scans. | ~$0.05 spend; eval rows never count in metrics. |

---

## File structure (C-core)

```
app/collection/scan/
  page.tsx                      server: auth, gate → notFound(), signed-out gate
  client.tsx                    composes the pieces; owns useScanTray + useScanQueue + useCollectionState
  types.ts                      client-side response types (type-only re-exports + ScanResponse)
  copy.ts                       every Copy-table string + scanErrorView()
  lib/trayReducer.ts            pure reducer, state shape, selectors
  lib/outcomes.ts               pure buildCommitPayload(state)
  lib/prepareImage.ts           fitWithin() pure + prepareImage(file) DOM
  lib/commitCore.ts             server-only, dependency-injected commit/undo logic + validators
  lib/pickerSearch.ts           lazily imported: searchPrintings(query)
  hooks/useScanTray.ts          useReducer + sessionStorage persistence
  hooks/useScanQueue.ts         upload queue (2 in flight, online check, busy retry)
  hooks/useFocusTrap.ts
  components/CaptureButtons.tsx PhotoGroup.tsx DetectionRow.tsx PrintingPicker.tsx CommitBar.tsx SuccessPanel.tsx
  __tests__/trayReducer.test.ts outcomes.test.ts copy.test.ts prepareImage.test.ts commitCore.test.ts
app/collection/actions.ts       + commitScanAction, adjustCollectionQuantitiesAction
scripts/scan-eval/fixture-responses.ts   recorded detections → route-shaped JSON (for Playwright mocks)
scripts/scan-eval/queries.sql   comment only: outcomes now written
```

---

### Task 0: Commit this plan (C-core branch)

- [ ] `git -C /Users/timestes/projects/rtt-scan-c add docs/superpowers/plans/2026-10-28-card-scanner-c-page.md && git -C … commit -m "docs(plans): card scanner PR C (page, tray, commit, undo; entry links, /privacy)"`

### Task 1: Tray reducer, outcome builder, response types

**Files:** Create `app/collection/scan/types.ts`, `lib/trayReducer.ts`, `lib/outcomes.ts`, `hooks/useScanTray.ts`; tests `__tests__/trayReducer.test.ts`, `__tests__/outcomes.test.ts`.

**Interfaces — Produces:**

```ts
// types.ts  (all `import type` from lib/scan)
export type { Candidate, NameReason, PrintingReason } from '@/lib/scan/match';
export interface ScanDetectionView { id: string; grid: {row:number;col:number}; orientation: string;
  read: { title: string|null; [k: string]: unknown }; status: 'matched'|'check'|'not_found';
  nameReason: NameReason; printingReason: PrintingReason; chosenKey: string|null;
  scores: { matchScore: number; runnerUpScore: number; agreeingFields: string[] }; candidates: Candidate[] }
export interface ScanResponse { scanId: string; photoQuality: string; detections: ScanDetectionView[]; usage: {model:string; latencyMs:number; attempts:number} }
export interface ScanErrorBody { code?: string; message?: string; resetsAt?: string; limit?: number }

// lib/trayReducer.ts
export type PhotoStatus = 'queued'|'reading'|'done'|'failed';
export interface TrayPhoto { photoId: string; n: number; status: PhotoStatus; scanId?: string;
  photoQuality?: string; error?: { status: number; body: ScanErrorBody; retryAfter?: number }; startedAt?: number; }
export interface TrayRow { rowId: string; photoId: string; detectionIds: string[]; detection: ScanDetectionView;
  key: string|null; candidates: Candidate[]; qty: number; corrected: 'none'|'printing'|'name';
  removedAs: 'wrong'|'unwanted'|null }
export interface TrayState { userId: string; photos: TrayPhoto[]; rows: TrayRow[];
  phase: 'editing'|'committing'|'committed'; pendingCommitId: string|null;
  committed: { commitId: string; added: number; scanIds: string[]; undone: boolean } | null }
export type TrayAction =
  | { type:'photoAdded'; photoId: string } | { type:'photoStarted'; photoId: string; at: number }
  | { type:'photoDone'; photoId: string; response: ScanResponse } | { type:'photoFailed'; photoId: string; error: TrayPhoto['error'] }
  | { type:'photoRemoved'; photoId: string } | { type:'photoRetry'; photoId: string }
  | { type:'setKey'; rowId: string; key: string; candidates?: Candidate[]; via: 'candidates'|'search' }
  | { type:'setQty'; rowId: string; qty: number } | { type:'removeRow'; rowId: string; as: 'wrong'|'unwanted' }
  | { type:'commitStarted'; commitId: string } | { type:'commitFailed' }
  | { type:'commitDone'; commitId: string; added: number; scanIds: string[] }
  | { type:'undoDone' } | { type:'scanMore' } | { type:'rehydrate'; state: TrayState };
export function initialTray(userId: string): TrayState;
export function trayReducer(s: TrayState, a: TrayAction): TrayState;
export function countedRows(s: TrayState): TrayRow[];          // not removed, key !== null
export function trayTotals(s: TrayState): { cards: number; priced: number; unpriced: number; unresolved: number };
export function rehydrateTray(raw: unknown, userId: string): TrayState; // in-flight photos → failed, n kept

// lib/outcomes.ts
export interface ClientOutcome { id: string; finalKey: string|null; printingChanged: boolean; nameChanged: boolean;
  removed: boolean; removedAs: 'wrong'|'unwanted'|null; unresolved: boolean }
export interface CommitPayload { rows: { key: string; qty: number }[]; outcomesByScanId: Record<string, ClientOutcome[]> }
export function buildCommitPayload(s: TrayState): CommitPayload;
```

Behaviors fixed here: `photoDone` appends one row per detection in grid order (row-major), `rowId` = detection id, `key` = `chosenKey`, `qty` 1; a detection whose `chosenKey` equals a non-removed row's `key` already in the tray (any earlier photo or same photo) increments that row's `qty` and appends its id to `detectionIds` instead. `setKey` sets `corrected` (`'printing'` if via `candidates` and the key ≠ the original `chosenKey`, `'name'` if via `search` or the row was `not_found`; back to `'none'` if the key returns to `chosenKey`). `setQty` clamps to 1..99. `photoRemoved` drops the photo and its rows (no outcomes: the scan is abandoned). `scanMore` → `initialTray(userId)`. `undoDone` → `phase:'editing'`, `committed.undone=true`, `pendingCommitId=null`. `price` for a row = the candidate with `key` (`price ?? null`); `trayTotals.priced` sums price × qty.

Outcome rules (R9): per detection id of every row: `finalKey` = row key when not removed, else null; `removed` = `removedAs !== null`; `unresolved` = not removed and key null; `printingChanged` = `corrected==='printing'`; `nameChanged` = `corrected==='name'`. `rows` = counted rows summed per key.

- [ ] **Step 1: failing tests** (`trayReducer.test.ts`): `photoDone adds one row per detection in grid order`; `duplicate key from a later photo increments the earlier row` (qty 2, `detectionIds` length 2, no row under photo 2); `setKey via candidates marks printing, via search marks name, back to chosenKey clears`; `not_found resolved by search counts and is name-corrected`; `trayTotals counts unpriced and unresolved` (fixture: one priced 3.50 ×2, one unpriced, one not_found → cards 3, priced 7, unpriced 1, unresolved 1); `removeRow excludes from countedRows`; `rehydrate marks in-flight photos failed and keeps pendingCommitId`; `rehydrate of another user's state returns an empty tray`. (`outcomes.test.ts`): `outcomes cover every detection of a merged row`; `removed rows carry removedAs and null finalKey`; `unresolved not_found row`; `payload rows sum identical keys across rows`; `outcome satisfies queries.sql assumptions` — for each outcome: exactly the seven keys, booleans are `typeof 'boolean'`, `removedAs ∈ {'wrong','unwanted',null}`, `id` matches `/^[0-9a-f-]{36}:\d+$/` and equals a detection id in the input, `JSON.parse(JSON.stringify(o))` round-trips equal.
- [ ] **Step 2:** `npm test -- app/collection/scan/__tests__` → FAIL (modules missing).
- [ ] **Step 3:** implement the three modules. `useScanTray(userId)` = `useReducer(trayReducer, …)` initialised by `rehydrateTray(sessionStorage['scan-tray:'+userId])` (try/catch), persisting on every state change (try/catch).
- [ ] **Step 4:** tests PASS; `npx tsc --noEmit` 0 errors.
- [ ] **Step 5:** commit `feat(scan): tray reducer, outcome builder and response types`.

### Task 2: Commit and undo (core + server actions)

**Files:** Create `app/collection/scan/lib/commitCore.ts`, `__tests__/commitCore.test.ts`; modify `app/collection/actions.ts` (append two actions); modify `scripts/scan-eval/queries.sql` header comment only.

**Interfaces — Consumes:** `ClientOutcome`, `CommitPayload` (Task 1, type-only). **Produces:**

```ts
// commitCore.ts (server-only; no "use server")
export type CommitResult =
  | { ok: true; commitId: string; added: number; scanIds: string[] }
  | { ok: false; code: 'unauthorized'|'bad_request'|'in_progress'|'commit_failed' };
export type UndoResult =
  | { ok: true; removed: number }
  | { ok: false; code: 'unauthorized'|'not_found'|'superseded'|'partial'|'undo_failed' };
export interface StoredScan { id: string; user_id: string; status: string; detections: Array<{ id: string; status: string; nameReason: string; printingReason: string; scores: unknown }> | null }
export interface CommitRow { commit_id: string; user_id: string; created_at: string; deltas: Record<string, number>; result: (CommitResult & { undoneAt?: string }) | null }
export interface CommitDeps {
  userId: string;
  loadScans(ids: string[]): Promise<StoredScan[]>;
  insertCommit(row: { commit_id: string; user_id: string; deltas: Record<string, number> }): Promise<boolean>; // false on conflict
  getCommit(id: string): Promise<CommitRow | null>;
  deleteCommit(id: string): Promise<void>;
  merge(rows: { card_name: string; card_set: string; card_img_file: string; quantity: number }[]): Promise<boolean>;
  writeOutcomes(scanId: string, outcomes: unknown[], commitId: string): Promise<void>;
  storeResult(id: string, result: CommitResult): Promise<void>;
}
export interface UndoDeps {
  userId: string;
  getCommit(id: string): Promise<CommitRow | null>;
  hasLaterCommit(userId: string, createdAt: string): Promise<boolean>;
  claimUndo(id: string, result: CommitRow['result']): Promise<boolean>; // conditional on undoneAt null; false if already claimed
  currentQuantities(keys: string[]): Promise<Record<string, number>>;
  setQuantity(key: string, qty: number): Promise<void>; // qty 0 deletes
}
export const COMMIT_LIMITS = { rows: 500, qty: 99, scans: 200, detectionsPerScan: 40 };
export function validateCommitInput(commitId: unknown, payload: unknown, isKnownKey: (k: string) => boolean): CommitPayload | null;
export async function runCommit(deps: CommitDeps, commitId: string, p: CommitPayload): Promise<CommitResult>;
export async function runUndo(deps: UndoDeps, commitId: string): Promise<UndoResult>;

// actions.ts (append)
export async function commitScanAction(commitId: string, rows: {key:string;qty:number}[], outcomesByScanId: Record<string, ClientOutcome[]>): Promise<CommitResult>;
export async function adjustCollectionQuantitiesAction(commitId: string): Promise<UndoResult>;
export async function canScanAction(): Promise<boolean>; // C-entry adds it if absent; C-core does NOT add it
```

`runCommit` order: validate scans (every scanId belongs to `userId`, `status==='done'`, outcome ids equal the stored detection ids exactly — R4) → `insertCommit` (if false: `getCommit`; other user → `bad_request`; `result` set → return it; else `in_progress`) → `merge` (false → `deleteCommit`, return `commit_failed` — R5) → for each scan `writeOutcomes` with each outcome enriched `{...clientOutcome, status, nameReason, printingReason, scores}` from the stored detection (R3; a write error is logged, not fatal) → `storeResult` → return `{ ok:true, commitId, added: sum qty, scanIds }`.

`runUndo`: `getCommit` (missing/other user → `not_found`; `result?.ok !== true` → `not_found`) → `result.undoneAt` already set → replay `{ ok:true, removed: result.removed }` → `hasLaterCommit` → `superseded` → compute `next[key] = max(0, current - delta)` for all keys, `removed = Σ(current - next)` → `claimUndo` with `{...result, undoneAt, removed}` (false → replay `{ok:true, removed: stored}`) → `setQuantity` each; any throw → `partial` (R6).

Validators: `commitId` a UUID; `rows` non-empty array ≤ 500, each `key` a string passing `isKnownKey`, `qty` integer 1..99; `outcomesByScanId` ≤ 200 scans, UUID keys, ≤ 40 outcomes each, each exactly the seven `ClientOutcome` fields with correct types and `id` starting `${scanId}:`; every row key must appear as a `finalKey` in some outcome.

Server action wiring: auth via existing `getAuthedClient()`; `isKnownKey = k => { const [n,s,i] = k.split('|'); const c = findCard(n,s,i); return !!c && \`${c.name}|${c.set}|${c.imgFile}\` === k }` (`@/lib/cards/lookup`); scans/commits via `getSupabaseAdmin()` filtered by `user_id`; `insertCommit` = `upsert(row, { onConflict: 'commit_id', ignoreDuplicates: true }).select('commit_id')` → inserted iff one row returned; `merge` = `(await bulkImportCollectionAction(rows, 'merge')).success` (R2); `claimUndo` = `admin.from('scan_commits').update({ result }).eq('commit_id', id).is('result->>undoneAt', null).select('commit_id')` → claimed iff one row; `currentQuantities`/`setQuantity` via the user client on `collection_cards` (delete at 0, upsert otherwise, same columns as `setCollectionCardQuantityAction`); `hasLaterCommit` = admin count of the user's `scan_commits` with `created_at > createdAt`.

- [ ] **Step 1: failing tests** with in-memory fakes (a `Map` store whose `insertCommit` is atomic): `commits once and returns added`; `replays a completed commit` (second call same id → same result, `merge` called once); `two concurrent commits add once` (`Promise.all` of two `runCommit` with a `merge` that awaits a tick → `merge` once, one `ok`, the other `in_progress`, then a third call replays); `refuses a scan owned by another user`; `refuses outcomes that do not cover the stored detections`; `merge failure deletes the commit row so a retry proceeds`; `enriches outcomes with stored status, reasons and scores` (and the client fields unchanged); `undo subtracts deltas`; `undo twice subtracts once`; `undo clamps at zero and deletes` (current 1, delta 3 → setQuantity 0, removed 1); `undo refused after a later commit`; `validator rejects unknown keys, qty 0 and 100, bad commitId, extra outcome fields`.
- [ ] **Step 2:** FAIL. **Step 3:** implement core, then actions. **Step 4:** PASS + tsc 0.
- [ ] **Step 5:** in `queries.sql` replace "NOT YET WRITTEN. Assumed shape, from the spec's…" with the written shape: the seven fields plus `status, nameReason, printingReason, scores` copied from the stored detection; one entry per detection of every committed scan. CTEs unchanged.
- [ ] **Step 6:** commit `feat(scan): idempotent commitScanAction and server-authoritative undo`.

### Task 3: Copy, error mapping, client image prep

**Files:** Create `app/collection/scan/copy.ts`, `lib/prepareImage.ts`; tests `__tests__/copy.test.ts`, `__tests__/prepareImage.test.ts`.

**Produces:**

```ts
export const COPY: Record<string, string>; // every v1.0 key of the spec's Copy table, verbatim
export type ScanErrorKind = 'gate'|'too_large'|'heif'|'cap_10m'|'cap_24h'|'cap_global'|'credit_out'|'busy'|'generic'|'offline';
export interface ScanErrorView { kind: ScanErrorKind; text: string; retry: boolean; chooseAnother: boolean; autoRetryAfterSec?: number }
export function scanErrorView(status: number, body: ScanErrorBody | null, retryAfter: string | null, now: Date): ScanErrorView;
export function qualityLine(q: string): string | null; // dark→Too dark, blurry→Blurry, glare→Glare, no_cards→No cards, too_many_cards→Too many, ok→null
export function doneLine(n: number): string;            // "9 cards" / "1 card"
export function readingLine(elapsedMs: number): string; // "Reading…" under 5 s, else "Reading… 12 s"
export function footerTotal(priced: number, unpriced: number): string; // "$84.20 at YTG · 2 unpriced" (omit the tail at 0)
// prepareImage.ts
export const MAX_EDGE = 2576, MAX_BYTES = 3 * 1024 * 1024;
export function fitWithin(w: number, h: number, max: number): { w: number; h: number };
export class PrepareError extends Error { kind: 'heif'|'too_large' }
export async function prepareImage(file: File): Promise<Blob>; // <img> via object URL → canvas → toBlob jpeg 0.85, then 0.75, 0.65; still > MAX_BYTES → too_large; decode error → heif
```

Mapping: 401 → gate; 413 (any content type) → too_large; 415 → heif; 429 `cap_user_10m` → "You've hit {limit} photos in 10 minutes. Scanning opens again at {h:mm am/pm}." ; `cap_user_24h` → "Daily limit reached ({limit} photos). Scanning opens again {today|tomorrow} at {h:mm am}."; 503 `cap_global_30d` → "…Back on {d Month}."; `cap_global_spend` → Credit out with "Back on {d Month}." from `resetsAt`; `billing_error` → "The scanner's monthly budget is used up." (R14); `upstream_rate_limit`/`upstream_overloaded` → busy with `autoRetryAfterSec = min(60, Retry-After || 30)`; 502/500/other/`reserve_failed` → generic with retry. `retry` true for generic, busy, too_large=false, heif=false (`chooseAnother` true). Times use `toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'})` lowercased; dates `en-GB` `{day:'numeric', month:'long'}`.

- [ ] **Step 1: failing tests:** `every spec copy key is present verbatim` (spot-check First run, HEIF, Retention note, Gate, Unresolved warning templates); `maps a text/plain 413 to Too large` (body null); `ten-minute cap interpolates limit and local time`; `daily cap says tomorrow when resetsAt is another day`; `busy honours Retry-After and caps at 60`; `billing_error has no date`; `unknown 500 is generic and retryable`; `qualityLine` table; `readingLine(4999)` / `readingLine(12400)`; `footerTotal(84.2, 2)` and `(10, 0)`; `fitWithin(4032,3024,2576)` → `{w:2576,h:1932}`, portrait, already-small unchanged.
- [ ] **Step 2:** FAIL. **Step 3:** implement (set the test TZ via `process.env.TZ='UTC'` at the top of the copy test). **Step 4:** PASS + tsc.
- [ ] **Step 5:** commit `feat(scan): copy table, error mapping and client image prep`.

### Task 4: Upload queue and fixture generator

**Files:** Create `app/collection/scan/hooks/useScanQueue.ts`, `scripts/scan-eval/fixture-responses.ts`.

**Produces:** `useScanQueue(dispatch): { addFiles(files: File[]): void; retry(photoId: string): void; remove(photoId: string): void; thumbs: Map<string,string>; online: boolean; errors: Map<string, ScanErrorView> }`. Keeps `File`s and prepared blobs in a ref (`photoId → { file, blob?, url? }`), never in reducer state; runs at most 2 uploads; checks `navigator.onLine` before each and resumes on the `online` event; posts `FormData{ photo: blob }` with `fetch('/api/scan', {method:'POST'})`; on non-OK reads `res.headers.get('content-type')` and parses JSON only when it includes `application/json`; busy errors re-queue after `autoRetryAfterSec`, at most 2 times (R13); dispatches `photoStarted`/`photoDone`/`photoFailed`. Thumbnails: object URL of the prepared blob, revoked on remove/unmount. `PrepareError('heif')` → failed with the heif view, no upload.

`fixture-responses.ts`: `npx tsx scripts/scan-eval/fixture-responses.ts <out.json> [n]` reads `scripts/scan-eval/outputs/catalog-sonnet55-low-v4.json`, takes `n` rows (default 6), runs `capDetection` + `matchDetection(read, loadPriceMap() or {} if env missing)` exactly as the route maps them, assigns `scanId = randomUUID()`, writes `ScanResponse[]`. No network to Anthropic.

- [ ] **Step 1:** implement both; `npx tsc --noEmit` 0. Run the generator into the scratchpad and check one response has ≥1 `matched` detection with `candidates.length ≥ 1`.
- [ ] **Step 2:** commit `feat(scan): upload queue and fixture generator`.

### Task 5: Page, capture, photo groups, tray rows

**Files:** Create `app/collection/scan/page.tsx`, `client.tsx`, `components/CaptureButtons.tsx`, `PhotoGroup.tsx`, `DetectionRow.tsx`.

**Consumes:** Tasks 1, 3, 4; `canScanForSession` (`lib/scan/gate.ts`, server only); `useCollectionState` (`app/collection/hooks/useCollectionState.ts`, `quantities.get(fullKey)`); `useShowPrices` (`hooks/useShowPrices.ts`); the card-image URL helper the collection page uses.

`page.tsx`: `metadata.title = "Scan cards"`; signed out → the `/collection` signed-out block with the Gate copy and `href="/sign-in?redirectTo=/collection/scan"`; `!allowed` → `notFound()`; else `<ScanClient userId={user.id} />`. Header: `h1` "Scan cards" (`font-cinzel`) + a muted "Beta" badge; First run line under it while the tray is empty; Retention note in `text-xs text-muted-foreground` with a link "Privacy" → `/privacy`.

`CaptureButtons`: primary "Take photo" (`min-h-11`, full width at 390 px) and outline "Choose from photos"; hidden inputs per Global Constraints; `onChange` copies `input.files` into an array, calls `addFiles`, then resets `input.value = ''`. Batch tip and Binder tip as muted text below.

`PhotoGroup`: hairline-divided group; header = 44 px thumbnail (or "Photo {n}" text when no thumb) + `role="status"` line (`readingLine` updated each second while reading / `doneLine` + `qualityLine` / the error text) + Retry · Remove · Choose another buttons per the error view; children = its rows.

`DetectionRow` (layout per spec 667–677): `[thumb 44][text][qty 56][remove 44]`. Thumb+name is one button labeled `Change printing: {name}, {set}` opening the picker. Line one: name (truncate) and price right (`text-sm tabular-nums`, hidden when `useShowPrices` is false; null price → "No YTG listing" linking to `https://www.yourturngames.biz/search?q={encoded name}`). Line two (`text-xs`): `{set} · own {n}` (omit "own" at 0) when matched; `equivalent` → "{k} printings" muted; `check` → amber chip "Check this" + reason text (id'd, row `aria-describedby`); fuzzy → set on line one, line two `Read as "{read.title}"`; `not_found` → amber chip "Not found", read title, and a "Find card" button opening the picker in search mode. Reason text map: `printing_ambiguous`→"Which printing? Prices differ" unless candidate legalities differ → "Which printing? Legality differs"; `identity_ambiguous`→"Two different cards have this name"; `reference_missing`→"Couldn't read the scripture reference"; `reference_ambiguous`→"Several Lost Souls share this verse". Qty: a "×{qty}" button (`aria-label="Quantity {qty}, change"`) toggling an inline stepper with "One fewer {name}" / "One more {name}" 44 px buttons. Remove → inline "Wrong card · Don't want it" choice (R11). Amber = `amber-600`/`dark:amber-400` text on `amber-500/10` background; no green except actions.

- [ ] **Step 1:** implement; tsc 0; `npm test -- app/collection/scan` still PASS.
- [ ] **Step 2:** commit `feat(scan): scan page, capture, photo groups and tray rows`.

### Task 6: Picker, commit bar, success state

**Files:** Create `components/PrintingPicker.tsx`, `CommitBar.tsx`, `SuccessPanel.tsx`, `hooks/useFocusTrap.ts`, `lib/pickerSearch.ts`; modify `client.tsx`.

`useFocusTrap(ref, active)`: on activate remember `document.activeElement`, focus the first focusable in `ref`; Tab/Shift+Tab cycle within; on deactivate restore focus. No dependency.

`PrintingPicker`: house `Dialog` (`components/ui/dialog.tsx`) with content classes making it a bottom sheet below `sm` (`fixed inset-x-0 bottom-0 rounded-t-xl max-h-[85vh] overflow-y-auto pb-[env(safe-area-inset-bottom)]`) and centered above; header "Which printing?" or "Which card?" (search mode / not_found); list of options: image (44×62), set, legality, price, "{n} in your collection", "Current" marker; a search input ("Search by card name") which on first keystroke `await import('../lib/pickerSearch')`. `pickerSearch.searchPrintings(query): Candidate[]` = for each `searchCardNames(query, 8)` hit, resolve `findCard(hit.name, hit.set, hit.imgFile)` (fallback to a `set|imgFile` scan of `CARDS`), then expand to `CARDS.filter(c => cardIdentityKey(c) === cardIdentityKey(card))`, map to `Candidate` with `price: null` (the client fills from `useCardPrices().getPrice(key)`), dedupe by key. Empty → "No cards match.". Selecting dispatches `setKey` with `via` = `'candidates'` or `'search'` and closes.

`CommitBar`: sticky bottom, `pb-[env(safe-area-inset-bottom)]`, line one `aria-live="polite"` `footerTotal(...)` with the `/collection` tooltip title ("Estimated cost to buy these cards at Your Turn Games retail prices — not a resale value."); Unresolved warning when `unresolved > 0` ("{n} cards aren't matched and won't be added." / singular); button "Add {n} to collection" (primary, disabled at 0 or while committing, label "Adding…"). On tap: `commitId = state.pendingCommitId ?? crypto.randomUUID()`; dispatch `commitStarted`; call `commitScanAction(commitId, payload.rows, payload.outcomesByScanId)`; `in_progress` → wait 1.5 s and call again (max 3) then fail; `ok` → `commitDone` + `collection.reload()`; else `commitFailed` and show "Couldn't save. Your tray is still here. Try again." (pendingCommitId kept for the retry).

`SuccessPanel` (phase committed): "Added {n} cards to your collection."; Undo (calls `adjustCollectionQuantitiesAction(commitId)`; ok → toast "Removed {removed} cards." via the house toast, `undoDone`, `collection.reload()`; `superseded` → disable with "A later commit can't be undone from here."; `partial` → "Couldn't undo everything. Check your collection."); Scan more (`scanMore`); View collection link `/collection?format=Unlimited&added={scanIds.join(',')}`. Rows stay visible with updated "own N".

- [ ] **Step 1:** implement; tsc 0; tests PASS.
- [ ] **Step 2:** commit `feat(scan): printing picker, commit bar and success state with undo`.

### Task 7: C-core verification and PR

- [ ] Read the `verify` skill. Pick a non-superuser test account; add its id to `SCANNER_ALLOWLIST` in `/Users/timestes/projects/rtt-scan-c/.env.local` only (R18). Start `next dev` on a free port in the worktree.
- [ ] Generate fixtures (Task 4) and seed matching `scan_events` rows for the test user via the service role: `status 'done'`, `source 'eval'`, `detections` = the fixture detections minus candidates. Record the ids for cleanup.
- [ ] Playwright (standalone script in scratchpad): mock `**/api/scan` with the fixtures; upload two files via `setInputFiles`; screenshot 390×844 and 1280×800 in light and dark: empty, tray with matched/check/not_found rows, picker open, success. Exercise: change a printing, remove one as wrong, commit, double-click commit (assert one `scan_commits` row and quantities increased once), undo twice (assert quantities back, never negative), reload mid-tray (tray restored).
- [ ] As a gate-refused account: `GET /collection/scan` → 404. Signed out → gate copy.
- [ ] One real scan (≤ 2) with a catalog image file from `public/` or a downloaded card image to confirm the real route round-trip; note cost.
- [ ] Query the seeded rows: outcomes present with the stored shape; run `correction_rate_by_status`'s CTE with `source = 'eval'` substituted to prove the join works. Delete the seeded rows, the test `scan_commits`, and restore the test account's collection.
- [ ] Push `feat/scan-page`; open PR "feat(scan): scan page, tray, picker, idempotent commit and undo (PR C-core)" with screenshots, tests, tsc, rulings ledger, spec deviations, footer.

---

## C-entry (`feat/scan-entry`, worktree `../rtt-scan-entry` off `origin/main`)

### Task 8: `/collection` entry, `?format=`, `?added=` and Just added

**Files:** Modify `app/collection/page.tsx`, `app/collection/client.tsx`; create `app/collection/justAdded.ts` + `__tests__/justAdded.test.ts`; append `canScanAction` to `app/collection/actions.ts`.

**Produces:** `export function justAddedKeys(outcomes: unknown[]): string[]` — `finalKey` strings of entries with `removed !== true` and `unresolved !== true`, de-duplicated, order kept. `export async function canScanAction(): Promise<boolean>` (uses `canScanForSession(await createClient())`).

`page.tsx`: `({ searchParams }: { searchParams: Promise<{ format?: string; added?: string }> })`; compute `const { allowed } = await canScanForSession(supabase)`; if `added` present, split on `,`, keep ≤ 50 UUIDs, select `outcomes` from `scan_events` `.in('id', ids)` with the user client (RLS own rows), flatten through `justAddedKeys`. Pass `canScan`, `initialFormat` (only if one of the `FORMAT_OPTIONS` values), `justAddedKeys` to `CollectionClient`.

`client.tsx`: `formatMode` initial = `initialFormat ?? DEFAULT_FORMAT`. When `justAddedKeys.length`, the cards view renders those cards first under an `h2` "Just added" then the rest unchanged (the same card tile component, filters still applied to the rest). When `canScan`: toolbar adds "Scan cards" `<a href="/collection/scan">`; below `sm`: Scan cards primary, Build a deck outline, Set completion / Import / Export hidden (`hidden sm:inline-flex`) and added as gear-menu items (`sm:hidden`); at `sm+` Scan sits beside Import with Import's outline weight and Build a deck keeps primary. First-run banner when `canScan`: primary "Scan cards" + text link "Import CSV". Otherwise everything unchanged (R17).

- [ ] **Step 1:** failing `justAdded.test.ts`: `drops removed and unresolved`, `dedupes keys keeping order`, `ignores malformed entries`. **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS + tsc 0. **Step 5:** commit `feat(collection): Scan cards entry, ?format and ?added with Just added`.

### Task 9: Deck-builder links, CardImage fallback, /privacy, reduced-motion

**Files:** Create `app/collection/hooks/useCanScan.ts`, `app/privacy/page.tsx`; modify `app/decklist/card-search/client.tsx` (owned empty state ~line 2796), `components/CollectionCheckModal.tsx`, `components/CardImage.tsx`, `app/globals.css` (only if a new animation class exists — none is planned, so expected no change; state so in the PR), `components/site-footer.tsx` (add a Privacy link if the footer has a links list).

`useCanScan(enabled: boolean): boolean` — calls `canScanAction()` once when `enabled`, caches in a module variable for the session (R16). Deck builder empty state "Your collection is empty": add, when `useCanScan(signedIn)`, a second line `<a href="/collection/scan">Scan your cards</a>`. `CollectionCheckModal`: a "Scan your cards" link in its footer area when allowed. `CardImage`: replace the emoji fallback with a plain muted box showing the card name in `text-xs`.

`/privacy` (server, static): `h1` "Privacy"; a "Card scanner" section stating: photos are sent to Anthropic to read the cards; Anthropic deletes them within 30 days unless its safety systems flag them (then up to two years) and does not train on them; Land of Redemption keeps the text read from each card, token counts and cost, not the photo; text read from photos where no card matched is deleted after 30 days; scanning requires an account and is limited per user. Plus a short "Account data" paragraph pointing to the existing account deletion path if one exists (else omit). Match the site's article typography.

- [ ] **Step 1:** implement; tsc 0; existing tests PASS. **Step 2:** commit `feat(scan): deck-builder entry links, CardImage plain fallback and /privacy`.

### Task 10: C-entry verification and PR

- [ ] Worktree `../rtt-scan-entry` with its own `node_modules` clone and `.env.local` (test account allowlisted). Screenshots 390/1280 light/dark: `/collection` toolbar (allowed vs refused), first-run banner, `/collection?format=Unlimited&added=<seeded ids>` showing Just added, deck builder empty state link, `/privacy`. Refused account: no entry links.
- [ ] Push, open PR "feat(scan): entry links, ?added Just added and /privacy (PR C-entry)" with the same sections.
