# Card Scanner PR B: migration 122, `scan_reserve()`, gate, recognizer, `POST /api/scan` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the data contract and the server path: the `scan_events` and `scan_commits` tables with a reserve-first RPC that enforces every cap under one lock, the `canScan` gate, the Claude recognizer, and `POST /api/scan`, so E0 can run through the deployed route on a preview URL and PR C has a route to call.

**Architecture:** The route reads the session and the gate before the body, reserves a `pending` row through `scan_reserve()` (SECURITY DEFINER, one constant-key advisory lock, caps counted in SQL), re-encodes the photo with sharp to the tier, loads prices once, calls the recognizer, runs PR A's matcher, and finishes the row through the service-role client. `authenticated` has no INSERT or UPDATE on either table. Superusers may pass an `arm` override and `source = 'eval'`, which every cap and metric ignores.

**Tech Stack:** Next.js 15 App Router route handler (Node runtime), Supabase (SQL migration, SECURITY DEFINER RPC, RLS), `@supabase/supabase-js` service client (`lib/pricing/supabase-admin.ts`), `sharp` 0.35, `@anthropic-ai/sdk` 0.78 (`output_config.format` JSON schema, `output_config.effort`, no `temperature`), Vitest with `vi.mock`.

**Spec:** `docs/superpowers/specs/2026-10-26-card-scanner-design.md` (rev 4.4). Sections: Constraints, The Claude call, Cost and latency, Data (`POST /api/scan`, Reserve first, Migration 122, Retention, Admin and audits), E3 definitions, Testing, Rollout. Depends on PR A's interfaces (`docs/superpowers/plans/2026-10-27-card-scanner-a-matcher.md`): `ScanDetection`, `ScanOutput`, `SCAN_JSON_SCHEMA`, `SCAN_INSTRUCTION`, `PROMPT_HASH`, `parseScanOutput`, `capDetection` from `@/lib/scan/schema`; `matchDetection`, `MatchResult`, `Candidate` from `@/lib/scan/match`; `loadPriceMap`, `PriceMap` from `@/lib/scan/prices`. Until PR A merges, develop against its branch (`git merge origin/feat/scan-matcher` into this worktree) and rebase before opening the PR.

## Global Constraints

- Worktree off `origin/main` (CLAUDE.md): `git worktree add ../rtt-scan-b -b feat/scan-route origin/main`; absolute paths; `git add` only your files.
- Migration file is `supabase/migrations/122_scan_events.sql`; confirm 121 is still the latest on `origin/main` at merge time and renumber if not. Apply to production only when Rollout step 2 says so (before E0), through the Supabase MCP, after the PR is approved; never from a test.
- RPC pattern: migration 082 (`SECURITY DEFINER`, `set search_path = ''`, `auth.uid()`, `pg_advisory_xact_lock`); grant footer as migration 120 (`revoke all on function … from public, anon; grant execute on function … to authenticated`).
- Superuser check is `public.is_superuser()` (migration 062, fixed uid) via `supabase.rpc('is_superuser')`, as `app/admin/permissions/lib/auth.ts` does. Pages respond 404 to non-superusers; this API responds 401 to no session and 403 to a session the gate refuses.
- Env: `SCANNER_ANTHROPIC_API_KEY` (required at request time, never at import), `SCANNER_ALLOWLIST` (comma-separated user ids), `SCANNER_OPEN` (`'1'` opens the gate to every signed-in user). Document all three in `.env.example` if the repo has one, else in `prompt_context/context.md` next to the tables.
- Caps, from the spec: per user 20 photos per 10 minutes and 150 per 24 hours; everyone 1,500 photos per 30 days and $80 summed `cost_usd` per 30 days. Counted statuses `pending`, `done`, `failed`; excluded `rejected` and `source = 'eval'`.
- Model constants: baseline `claude-sonnet-5-5`, `effort: 'low'`, high-res tier, no thinking parameter; `max_tokens` 16,000, one retry at 32,000 on a `max_tokens` stop; SDK client `maxRetries: 0`, `timeout: 25_000`; one manual retry on 5xx, 529 or timeout; never on a refusal. Prices per million tokens for `cost_usd`: Sonnet 5.5 $2 in / $10 out, Opus 5.5 $4 / $20, Haiku 5.5 $0.10 / $0.50.
- Tier math: scale the decoded image so that `⌈w/28⌉ × ⌈h/28⌉ ≤ 4,784` (high) or `≤ 1,568` (low), `withoutEnlargement: true`, JPEG quality 82, metadata stripped (sharp default), `limitInputPixels: 60_000_000`, `.rotate()` first.
- Request body cap 3 MB for `photo`; Vercel's own 4.5 MB 413 arrives before the route runs.
- `export const maxDuration = 90` on the route; Node runtime (no `edge`).
- Tests: Vitest node only; mock `@/utils/supabase/server`, `@/lib/pricing/supabase-admin`, `@/lib/scan/recognize` with `vi.mock`; never hit the network.
- Stored detections are capped with `capDetection` before insert; `detections` jsonb holds the full response's `detections` array minus `candidates` (candidates are recomputable).

## Review Focus

1. A client that sends two uploads in parallel at 19 of 20 in the ten-minute window must get exactly one `pending` and one `rejected` row; the lock, not the client, decides. Test: Task 2 (`check-reserve.ts`, run against a branch database).
2. A photo that sharp decodes but that is 48 MP must be refused as 413/415 before any model call, and a HEIC body must map to `undecodable` 415 with the HEIF copy key. Test added to Task 5 (`route.test.ts`, "oversized and undecodable").
3. The recognizer must never retry on `stop_reason: 'refusal'` and must count a retried `max_tokens` stop as two attempts with the second at 32,000. Test added to Task 4 (`recognize.test.ts`).
4. `arm` and `source = 'eval'` from a non-superuser must be ignored and treated as `player`, with no error that reveals the field exists. Test added to Task 5 ("arm is superuser only").
5. When the recognizer fails after the row is `pending`, the row must end `failed` with `attempts` and `latency_ms` set, so caps still count it and E3 sees it. Test added to Task 5 ("finish on failure").

---

### Task 1: Migration 122 — tables, RLS, indexes, `scan_reserve()`

**Files:**
- Create: `supabase/migrations/122_scan_events.sql`
- Modify: `prompt_context/context.md` (append the two tables and the RPC under the schema section)

**Interfaces:**
- Tables exactly as the spec's Migration section: `scan_events` (`id`, `user_id`, `created_at`, `status` check in `pending|done|failed|rejected`, `source` default `player` check in `player|eval`, `rejected_cap`, `model`, `attempts smallint`, `latency_ms integer`, `input_tokens integer`, `output_tokens integer`, `cost_usd numeric(8,5)`, `photo_quality text`, `detections jsonb`, `outcomes jsonb`, `commit_id uuid references scan_commits(commit_id)`, `image_pathname text`, `image_expires_at timestamptz`); `scan_commits` (`commit_id uuid primary key`, `user_id`, `created_at`, `deltas jsonb not null`, `result jsonb`). Create `scan_commits` first (the FK).
- Indexes: `scan_events (user_id, created_at desc)`, `scan_events (created_at)`, `scan_commits (user_id, created_at desc)`.
- RLS on both: `SELECT` where `user_id = auth.uid() or public.is_superuser()`; no INSERT/UPDATE/DELETE policies for `authenticated`; `revoke insert, update, delete on … from authenticated, anon` explicitly.
- `create or replace function public.scan_reserve(p_source text default 'player') returns jsonb language plpgsql security definer set search_path = ''`: `v_uid := auth.uid()` (raise if null); `p_source = 'eval'` allowed only when `public.is_superuser()`, else treated as `player`; `perform pg_advisory_xact_lock(hashtext('scan_reserve'))`; constants `c_user_10m := 20`, `c_user_24h := 150`, `c_global_30d := 1500`, `c_spend_30d := 80.00`; counts over `public.scan_events where status in ('pending','done','failed') and source = 'player'`; checks in order user 10m, user 24h, global photos, global spend (`coalesce(sum(cost_usd),0)`); on a hit insert a `rejected` row with `rejected_cap` and return `jsonb_build_object('ok', false, 'cap', <code>, 'limit', <n>, 'resets_at', <oldest counted row in the window + window>)`; else insert `pending` with `source` and return `jsonb_build_object('ok', true, 'id', v_id)`. Cap codes: `cap_user_10m`, `cap_user_24h`, `cap_global_30d`, `cap_global_spend`. Eval rows are inserted but never counted.
- Grant footer: `revoke all on function public.scan_reserve(text) from public, anon; grant execute on function public.scan_reserve(text) to authenticated;`

- [ ] **Step 1: Write the migration** per the Interfaces block, with a header comment that names the spec section and the lock key.

- [ ] **Step 2: Lint it the way the repo can**: `psql`-free check by applying it to a Supabase branch (`mcp__supabase__create_branch` → `apply_migration` on the branch) or a local stack if one is running; confirm `select public.scan_reserve('player')` as an authenticated test user returns `{"ok": true, "id": …}` and that `insert into public.scan_events …` as `authenticated` is refused.

- [ ] **Step 3: Document the tables** in `prompt_context/context.md` (columns, statuses, caps, the eval exemption) in the file's existing style.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/122_scan_events.sql prompt_context/context.md
git commit -m "feat(scan): migration 122 — scan_events, scan_commits, scan_reserve() under one lock"
```

---

### Task 2: `scripts/scan-eval/check-reserve.ts` — the concurrency check

**Files:**
- Create: `scripts/scan-eval/check-reserve.ts`

**Interfaces:**
- `npx tsx scripts/scan-eval/check-reserve.ts --url <branch supabase url> --anon-key <key> --service-key <key> --email <test user> --password <pw>`; signs in as the test user, seeds rows through the service client to sit at 19 in the ten-minute window, fires two `rpc('scan_reserve')` calls concurrently, asserts exactly one `ok: true` and one `cap: 'cap_user_10m'`; repeats for the 24-hour cap (seed 149), the global cap (seed 1,499 rows across a second user) and the spend ceiling (seed `cost_usd` summing to 79.99 then 0.02); finally seeds 50 `source = 'eval'` rows and asserts a fresh reserve still succeeds. Cleans up its rows. Exits non-zero on any failure and prints a table.

- [ ] **Step 1: Write the script.** Seeding goes through the service-role client because `authenticated` cannot insert (that is the point).

- [ ] **Step 2: Run it against the branch from Task 1**

Run: `npx tsx scripts/scan-eval/check-reserve.ts --url … (branch credentials)`
Expected: five lines of `PASS`, exit 0. Paste the table into the PR description.

- [ ] **Step 3: Commit**

```bash
git add scripts/scan-eval/check-reserve.ts
git commit -m "test(scan): concurrency check for scan_reserve caps and the eval exemption"
```

---

### Task 3: `lib/scan/gate.ts`

**Files:**
- Create: `lib/scan/gate.ts`
- Test: `lib/scan/__tests__/gate.test.ts`

**Interfaces:**
- `interface GateDeps { isSuperuser: () => Promise<boolean>; env?: NodeJS.ProcessEnv }`
- `canScan(userId: string, deps: GateDeps): Promise<boolean>` — true when `isSuperuser()` resolves true, or `SCANNER_ALLOWLIST` (comma/space separated) contains `userId`, or `SCANNER_OPEN === '1'`.
- `canScanForSession(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ user: { id: string } | null; allowed: boolean }>` — reads `auth.getUser()`, calls `rpc('is_superuser')` lazily, applies `canScan`. Server-only module (imports `@/utils/supabase/server` types only; the page in PR C and the route both call this).

- [ ] **Step 1: Write the failing test**

```ts
// lib/scan/__tests__/gate.test.ts
import { describe, it, expect } from 'vitest';
import { canScan } from '../gate';
const no = async () => false, yes = async () => true;
describe('canScan', () => {
  it('superuser always', async () => expect(await canScan('u1', { isSuperuser: yes, env: {} })).toBe(true));
  it('allowlist by id', async () => { expect(await canScan('u1', { isSuperuser: no, env: { SCANNER_ALLOWLIST: 'u0, u1' } })).toBe(true); expect(await canScan('u2', { isSuperuser: no, env: { SCANNER_ALLOWLIST: 'u0, u1' } })).toBe(false); });
  it('open flag', async () => expect(await canScan('anyone', { isSuperuser: no, env: { SCANNER_OPEN: '1' } })).toBe(true));
  it('closed by default', async () => expect(await canScan('anyone', { isSuperuser: no, env: {} })).toBe(false));
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- lib/scan/__tests__/gate.test.ts` → FAIL.
- [ ] **Step 3: Implement `lib/scan/gate.ts`.**
- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Commit** — `git add lib/scan/gate.ts lib/scan/__tests__/gate.test.ts && git commit -m "feat(scan): canScan gate (superuser, allowlist, open flag)"`

---

### Task 4: `lib/scan/image.ts` and `lib/scan/recognize.ts`

**Files:**
- Create: `lib/scan/image.ts`, `lib/scan/recognize.ts`
- Test: `lib/scan/__tests__/image.test.ts`, `lib/scan/__tests__/recognize.test.ts`

**Interfaces:**
- `image.ts`:
  - `type Tier = 'high' | 'low'`; `TIER_PATCH_CAP: Record<Tier, number> = { high: 4784, low: 1568 }`
  - `fitToTier(width: number, height: number, tier: Tier): { width: number; height: number; imageTokens: number }` — pure; the largest size with `⌈w/28⌉×⌈h/28⌉ ≤ cap` at the same aspect, never enlarging.
  - `encodeForScan(input: Buffer, tier: Tier): Promise<{ jpeg: Buffer; width: number; height: number; imageTokens: number }>` — sharp with `limitInputPixels: 60_000_000`, `.rotate()`, resize per `fitToTier`, `.jpeg({ quality: 82, mozjpeg: true })`; throws `ScanImageError('undecodable')` when sharp cannot read it and `ScanImageError('too_large')` when the decoded pixel count exceeds the limit.
- `recognize.ts`:
  - `interface Arm { model?: 'claude-sonnet-5-5' | 'claude-opus-5-5' | 'claude-haiku-5-5'; effort?: 'low' | 'medium' | 'high'; tier?: Tier; thinking?: 'default' | 'off' }`; `DEFAULT_ARM: Required<Arm> = { model: 'claude-sonnet-5-5', effort: 'low', tier: 'high', thinking: 'default' }`
  - `MODEL_PRICES: Record<Arm['model'] & string, { input: number; output: number }>` per million tokens (Global Constraints).
  - `type RecognizeResult = { ok: true; output: ScanOutput; model: string; usage: { inputTokens: number; outputTokens: number }; costUsd: number; latencyMs: number; attempts: number } | { ok: false; code: 'upstream_rate_limit' | 'upstream_overloaded' | 'billing_error' | 'recognizer_failed'; retryAfterSeconds?: number; latencyMs: number; attempts: number }`
  - `recognize(jpeg: Buffer, arm: Required<Arm>, deps?: { create?: (params: unknown) => Promise<unknown> }): Promise<RecognizeResult>` — builds the request: `messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }, { type: 'text', text: SCAN_INSTRUCTION }] }]`, `output_config: { effort, format: { type: 'json_schema', schema: SCAN_JSON_SCHEMA } }`, `max_tokens: 16000`; `thinking: 'off'` → `{ type: 'between_tools' }` for Sonnet, `{ type: 'disabled' }` for Haiku, ignored for Opus; `max_tokens` stop → retry once at 32,000; 5xx/529/timeout → one retry after 2 s; 429 → `upstream_rate_limit` with `retry-after`; 529 after retry → `upstream_overloaded`; 402/`billing` → `billing_error`; refusal, unparseable (`parseScanOutput` null) or second `max_tokens` → `recognizer_failed`; asserts `response.model` starts with `arm.model`. Default `create` builds `new Anthropic({ apiKey: process.env.SCANNER_ANTHROPIC_API_KEY, maxRetries: 0, timeout: 25_000 }).messages.create` lazily and throws a clear error when the env is missing.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/scan/__tests__/image.test.ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { fitToTier, encodeForScan } from '../image';
describe('fitToTier', () => {
  it('4:3 high tier lands at the spec size and token count', () => { const r = fitToTier(4032, 3024, 'high'); expect(r.width).toBeLessThanOrEqual(2212); expect(r.imageTokens).toBeLessThanOrEqual(4784); expect(r.imageTokens).toBeGreaterThan(4600); });
  it('never enlarges', () => expect(fitToTier(600, 800, 'high')).toEqual({ width: 600, height: 800, imageTokens: 22 * 29 }));
  it('low tier caps at 1568 patches', () => expect(fitToTier(4032, 3024, 'low').imageTokens).toBeLessThanOrEqual(1568));
});
describe('encodeForScan', () => {
  it('re-encodes a PNG to JPEG at the tier', async () => { const png = await sharp({ create: { width: 3000, height: 4000, channels: 3, background: '#888' } }).png().toBuffer(); const r = await encodeForScan(png, 'high'); expect(r.imageTokens).toBeLessThanOrEqual(4784); expect(r.jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); });
  it('rejects garbage as undecodable', async () => { await expect(encodeForScan(Buffer.from('not an image'), 'high')).rejects.toMatchObject({ code: 'undecodable' }); });
});
```

```ts
// lib/scan/__tests__/recognize.test.ts
import { describe, it, expect } from 'vitest';
import { recognize, DEFAULT_ARM } from '../recognize';
const ok = (text: string, stop = 'end_turn', model = 'claude-sonnet-5-5-20260901') => ({ model, stop_reason: stop, content: [{ type: 'text', text }], usage: { input_tokens: 3000, output_tokens: 200 } });
const good = JSON.stringify({ photoQuality: 'ok', cards: [] });
describe('recognize', () => {
  it('parses a good response and prices it', async () => { const r = await recognize(Buffer.alloc(10), DEFAULT_ARM, { create: async () => ok(good) }); expect(r.ok && r.costUsd).toBeCloseTo(3000 * 2e-6 + 200 * 10e-6, 6); expect(r.ok && r.attempts).toBe(1); });
  it('retries a max_tokens stop once at 32000 and counts two attempts', async () => { const calls: any[] = []; const r = await recognize(Buffer.alloc(10), DEFAULT_ARM, { create: async (p: any) => { calls.push(p.max_tokens); return calls.length === 1 ? ok(good, 'max_tokens') : ok(good); } }); expect(calls).toEqual([16000, 32000]); expect(r.ok && r.attempts).toBe(2); });
  it('never retries a refusal', async () => { let n = 0; const r = await recognize(Buffer.alloc(10), DEFAULT_ARM, { create: async () => { n++; return ok('', 'refusal'); } }); expect(n).toBe(1); expect(!r.ok && r.code).toBe('recognizer_failed'); });
  it('maps a 429 with retry-after', async () => { const r = await recognize(Buffer.alloc(10), DEFAULT_ARM, { create: async () => { throw Object.assign(new Error('rl'), { status: 429, headers: { 'retry-after': '7' } }); } }); expect(!r.ok && r.code).toBe('upstream_rate_limit'); expect(!r.ok && r.retryAfterSeconds).toBe(7); });
  it('sends thinking off only for Sonnet and Haiku', async () => { let p: any; await recognize(Buffer.alloc(10), { ...DEFAULT_ARM, thinking: 'off' }, { create: async (x: any) => { p = x; return ok(good); } }); expect(p.thinking).toEqual({ type: 'between_tools' }); await recognize(Buffer.alloc(10), { ...DEFAULT_ARM, model: 'claude-opus-5-5', thinking: 'off' }, { create: async (x: any) => { p = x; return ok(good, 'end_turn', 'claude-opus-5-5'); } }); expect(p.thinking).toBeUndefined(); });
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- lib/scan/__tests__/image.test.ts lib/scan/__tests__/recognize.test.ts` → FAIL.
- [ ] **Step 3: Implement both modules.** `image.ts` is the only place sharp is configured; `recognize.ts` never reads the env at import.
- [ ] **Step 4: Run to verify they pass** — PASS.
- [ ] **Step 5: Commit** — `git add lib/scan/image.ts lib/scan/recognize.ts lib/scan/__tests__/image.test.ts lib/scan/__tests__/recognize.test.ts && git commit -m "feat(scan): tier encoder and Claude recognizer with retry and error mapping"`

---

### Task 5: `app/api/scan/route.ts`

**Files:**
- Create: `app/api/scan/route.ts`, `lib/scan/events.ts`
- Test: `app/api/scan/__tests__/route.test.ts`

**Interfaces:**
- `lib/scan/events.ts` (service-role writes; server-only):
  - `reserveScan(supabase, source: 'player' | 'eval'): Promise<{ ok: true; id: string } | { ok: false; cap: string; limit: number; resetsAt: string }>` — `rpc('scan_reserve', { p_source })` with the user's client (the RPC reads `auth.uid()`).
  - `finishScan(admin, id: string, patch: { status: 'done' | 'failed'; model?: string; attempts: number; latencyMs: number; inputTokens?: number; outputTokens?: number; costUsd?: number; photoQuality?: string; detections?: unknown[] }): Promise<void>` — one `update … eq('id', id)` through `getSupabaseAdmin()`.
- Route `POST` order: `createClient()` → `canScanForSession` (401 no user, 403 not allowed) → parse `multipart/form-data` (`photo` file required; size > 3 MB → 413; `arm` and `source` fields read only when `rpc('is_superuser')` is true, else dropped) → `reserveScan` (cap → 429 for `cap_user_*` with `resetsAt`, 503 for `cap_global_*` with `Retry-After`) → `encodeForScan(buffer, arm.tier)` (`undecodable` → 415 `{ code: 'undecodable' }`; `too_large` → 413) → `loadPriceMap()` → `recognize()` → on `ok: false`: `finishScan(failed)` then 503 `{ code }` with `Retry-After` for the upstream codes and `billing_error`, 502 `{ code: 'recognizer_failed' }` → on `ok: true`: `matchDetection` per card, build the response of the spec (`scanId`, `photoQuality`, `detections[{ id, grid, orientation, read, status, nameReason, printingReason, chosenKey, scores, candidates }]`, `usage: { model, latencyMs, attempts }`), `finishScan(done, …, detections without candidates, capped)`, 200.
- Detection `id`s are `${scanId}:${index}`. `read` is the capped `ScanDetection`. Every error body is `{ code, message, resetsAt?, limit? }`; copy keys are the client's business.
- `export const runtime = 'nodejs'; export const maxDuration = 90;`

- [ ] **Step 1: Write the failing tests** (mock the four modules with `vi.mock`: `@/utils/supabase/server` → `createClient` returning `{ auth: { getUser }, rpc }`; `@/lib/pricing/supabase-admin`; `@/lib/scan/recognize`; `@/lib/scan/prices`), build `Request`s with `FormData` and a small real JPEG from sharp:

```ts
// app/api/scan/__tests__/route.test.ts — cases
it('401 without a session');
it('403 when the gate refuses');
it('reserve happens before the body is decoded: a cap returns 429 with resetsAt and the recognizer is never called');
it('oversized and undecodable: a 4 MB body is 413 before reserve; a text body after reserve is 415 undecodable and the row is finished failed');
it('arm is superuser only: a player sending arm and source=eval gets a player row with the default arm');
it('finish on failure: recognizer upstream_rate_limit → 503 with Retry-After and the event row is failed with attempts and latency');
it('happy path: response shape matches the spec and detections are stored without candidates and capped');
```

Write each as a real test with the assertions implied (status code, body `code`, which mock was called with what).

- [ ] **Step 2: Run to verify they fail** — `npm test -- app/api/scan/__tests__/route.test.ts` → FAIL.
- [ ] **Step 3: Implement `lib/scan/events.ts` and the route.** Read the body with `await req.formData()` only after the gate; check `file.size` before `arrayBuffer()`.
- [ ] **Step 4: Run to verify they pass, then type-check** — `npm test -- app/api/scan/__tests__/route.test.ts && npx tsc --noEmit` → PASS, no new errors.
- [ ] **Step 5: Commit** — `git add app/api/scan/route.ts lib/scan/events.ts app/api/scan/__tests__/route.test.ts && git commit -m "feat(scan): POST /api/scan — gate, reserve, encode, recognize, match, finish"`

---

### Task 6: E3 queries and the audit export

**Files:**
- Create: `scripts/scan-eval/queries.sql`, `scripts/scan-eval/export.ts`

**Interfaces:**
- `queries.sql`: one named query per E3 definition, every one `where source = 'player'`: correction rate split by status (needs `outcomes`, written by PR C; include the query now), not-found rate, uncorrected rate by `printingReason` and by stored confidence, abandonment at 24 h, rejections by cap per day, failures ÷ all, p50/p95 `latency_ms`, cost per day over `done` and `failed`, distinct committing players; plus the three kill criteria with their windows (correction rate > 30% at ≥ 100 detections in days 7–14; printing share of corrections > 0.5 at ≥ 30; failure rate > 10% or p95 > 20 s over 3 days).
- `export.ts`: `npx tsx scripts/scan-eval/export.ts --since <date> --limit 100 --out scripts/scan-eval/audit-<date>.json` — selects `done` player events with detections, stratified to over-sample untouched Matched rows (half the sample from rows with no outcome), and writes the scorer's label skeleton (`file` = `scanId`, `cards[].printing` = `chosenKey`, `setVisible: null`) for Tim to correct. Service-role client via `getSupabaseAdmin()`; dotenv as `scripts/export-prices-json.ts`.

- [ ] **Step 1: Write both files.** Run `export.ts` against the branch database from Task 1 with a seeded `done` row and confirm the skeleton shape.
- [ ] **Step 2: Commit** — `git add scripts/scan-eval/queries.sql scripts/scan-eval/export.ts && git commit -m "feat(scan-eval): E3 queries and the audit export skeleton"`

---

### Task 7: Env, WAF note, PR

- [ ] **Step 1:** Add `SCANNER_ANTHROPIC_API_KEY`, `SCANNER_ALLOWLIST`, `SCANNER_OPEN` to `.env.example` (or the env table in `prompt_context/context.md`), with one line each on what they do and that the key lives in its own workspace of the Max org.
- [ ] **Step 2:** `npm test -- lib/scan app/api/scan scripts/__tests__/scan-eval && npx tsc --noEmit` → green.
- [ ] **Step 3:** Open the PR: `gh pr create --base main --title "feat(scan): migration 122, scan_reserve, gate, recognizer, POST /api/scan (PR B)"` with the concurrency-check table, the note that migration 122 must be applied to production before E0 (preview shares the database), the three env vars Tim must set in Vercel (`SCANNER_ANTHROPIC_API_KEY` in all environments; `SCANNER_ALLOWLIST` with the superuser id for now), and the attribution footer. Do not apply the migration or set env from the agent; both are Tim's steps in Rollout.

---

## Self-review notes

- Spec coverage: `POST /api/scan` request, order, response and error table → Task 5; Reserve first and the caps table → Tasks 1–2; Migration 122 → Task 1; `canScan` → Task 3; The Claude call and Cost constants → Task 4; Retention (no photos stored; capped detections) → Task 5; Admin and audits (SQL, export) → Task 6; Testing bullets for the route, the RPC and the gate → Tasks 2, 3, 5. Left to PR C: `commitScanAction`, `adjustCollectionQuantitiesAction`, the page, the picker, `/privacy`, entry links, and the `outcomes` writes that the correction-rate query reads.
- Names consumed from PR A match its plan: `ScanDetection`, `ScanOutput`, `SCAN_JSON_SCHEMA`, `SCAN_INSTRUCTION`, `PROMPT_HASH`, `parseScanOutput`, `capDetection`, `matchDetection`, `MatchResult`, `Candidate`, `PriceMap`, `loadPriceMap`.
- Review Focus tests live in Tasks 2, 4 and 5 as listed.
