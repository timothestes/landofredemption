# Deck Photo Import PR 1: deck schema, recognizer mode, read classification, route `mode=deck`, migration 124, eval harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `POST /api/scan` a `mode=deck` that reads a laid-out deck photo into grouped reads, matches and classifies each read for a decklist, and records the scan with `mode = 'deck'`, plus the pure merge and zone logic PR 2's page will use and an eval harness that can score deck photos. No UI.

**Architecture:** `recognize()` takes a mode object (instruction, JSON schema, parser, timeout, retry rule) instead of hard-coding the collection ones; `DECK_MODE` reads with Sonnet 5.5 at effort medium. The route converts each deck read to a `ScanDetection`, runs the existing `matchDetection`, and classifies the result server-side (`lib/scan/deckClassify.ts`, which needs the catalog index) into a row kind and a deck printing. The merge of reads into decklist rows and the reserve default live in `lib/scan/deck.ts`, which imports no catalog data so PR 2's client can use it.

**Tech Stack:** Next.js 15 route handler (Node runtime), `@anthropic-ai/sdk` 0.78 (`output_config.format` JSON schema, `output_config.effort`, per-request `timeout` option), Supabase SQL migration, Vitest (node only, `vi.mock`).

**Spec:** `docs/superpowers/specs/2026-10-29-deck-photo-import-design.md`. Sections this PR implements: Constraints, Recognition (The call, Instruction, Schema, From reads to rows, Groups and zones), Data (`POST /api/scan` with `mode=deck`, Migration 124), Evaluation (scorer and `run.ts --mode deck`), Testing (deckSchema, deck.ts, recognize, route), Rollout step 1. Builds on the scanner's code in `lib/scan/` and `app/api/scan/route.ts`; read `lib/scan/recognize.ts`, `lib/scan/schema.ts`, `lib/scan/match.ts` and the route before starting.

## Global Constraints

- Worktree off `origin/main` (CLAUDE.md): `git worktree add ../rtt-deck-scan-lib -b feat/deck-scan-lib origin/main`; absolute paths; `git add` only your files. Worktrees have no `node_modules`: `cp -Rc ../redemption-tournament-tracker/node_modules ./node_modules` (CoW clone, about 7 s); never symlink it.
- Deck arm: `{ model: 'claude-sonnet-5-5', effort: 'medium', tier: 'high', thinking: 'default' }`. The collection `DEFAULT_ARM` (effort `low`) is unchanged.
- Deck timing: per-call timeout 60,000 ms (collection keeps the client's 25,000); `max_tokens` 16,000; **no retry at 32,000** in deck mode: a `max_tokens` stop is the failure code `too_many_cards`.
- Deck detection cap 300 per photo (`COMMIT_LIMITS.detectionsPerScan` = 150 stays for collection mode).
- `settleAbPairs` is not called in deck mode.
- `maxDuration` stays 90 on the route.
- Format sizes come from `FORMATS` in `lib/formats.ts`: Type 1 main 50–70, reserve max 10 (`FORMATS.Limited`); Type 2 main 100–140, reserve max 20 (`FORMATS.T2`). Never hard-code 50/70/100/140/10/20.
- Rotation-legal means `CardData.legality === 'Rotation'`.
- Migration number 124 (123 is the latest on `origin/main` today); renumber if another lands first. Apply to production through the Supabase MCP only after the PR is approved and before PR 2's preview (Rollout step 1). Never from a test.
- Tests are Vitest, node only, no DOM; never hit the network; mock `@/lib/scan/recognize`, `@/utils/supabase/server`, `@/lib/pricing/supabase-admin`, `@/lib/scan/prices` in route tests as `app/api/scan/__tests__/route.test.ts` already does.
- `lib/scan/deck.ts` must not import `@/lib/cards/lookup`, `@/lib/cards/generated/*` or `./stemIndex` (it ships to the client in PR 2). `deckClassify.ts` may.
- Style: match `lib/scan/*`: terse one-line JSDoc, no zod, hand-rolled validation, `oneOf` style coercion.
- **Spec correction already made on the spec branch:** the spec's `stemIndex.ts` brigade-union fix is dropped. Forest Fire (FooF) and Forest Fire (Roots) differ in ability and are correctly two identities (`stemIndex.test.ts` "a reprint with a different ability stays its own card"). Do not change `stemIndex.ts`.
- Not in this PR (PR 2): E3 queries in `queries.sql`, `createDeckFromScanAction`, outcome writing, labels and recordings, the box-check contact sheet. `scripts/scan-eval/deck-instruction.txt` is not created: the instruction lives once, in `deckSchema.ts`.

## Review Focus

1. **A Lost Soul whose reference was read but matches nothing** (a misread verse on the fully visible card) must become a Lost Soul placeholder, not a Not found row: the player picks it in the Lost Soul sheet. Test added to Task 4 (`deckClassify.test.ts`, "a Lost Soul with an unmatched reference is a placeholder").
2. **A 5xx or 529 that arrives late in deck mode** must not be retried when the retry could run past the function budget: a retryable failure after 10 s in deck mode fails at once. Test added to Task 3 (`recognize.test.ts`, "deck mode does not retry a 5xx after 10 s").
3. **The model returns cards but no groups, or cards whose `group` names no group**: the cards survive in a synthetic group 0, never dropped. Test added to Task 2 (`deckSchema.test.ts`, "orphan cards land in group 0").
4. **A collection-mode request with no `mode` field** must behave exactly as today: collection instruction, effort low, 150 cap, AB comparison run, no `groups` key in the response, `mode: 'collection'` written. Test added to Task 6 (`route.test.ts`, "no mode field is collection mode").
5. **Boxes out of range or reversed** (`[0.9, 0.2, 0.1, 1.4]`): clamped to 0–1 and ordered so x0 ≤ x1, y0 ≤ y1; a box that is not four finite numbers is `null` for `titleBox` and `[0, 0, 1, 1]` for a group. Test added to Task 2 (`deckSchema.test.ts`, "boxes are clamped and ordered").

---

### Task 1: Migration 124 and `finishScan` mode

**Files:**
- Create: `supabase/migrations/124_scan_events_mode.sql`
- Modify: `lib/scan/events.ts` (`FinishPatch`, `finishScan`)
- Modify: `prompt_context/context.md` (the `scan_events` block near line 136: add the `mode` column)
- Test: `lib/scan/__tests__/events.test.ts` (create; no events test exists yet)

**Interfaces:**
- Produces: `FinishPatch.mode?: 'collection' | 'deck'`; `finishScan` writes it as `row.mode` when set.

- [ ] **Step 1: Write the failing test** — `finishScan` with a fake `admin.from()` that records the update row:

```ts
it('writes mode when given', async () => { const rows: any[] = []; const admin = { from: () => ({ update: (r: any) => { rows.push(r); return { eq: async () => ({ error: null }) }; } }) }; await finishScan(admin, 'id1', { status: 'done', attempts: 1, latencyMs: 5, mode: 'deck' }); expect(rows[0].mode).toBe('deck'); });
it('omits mode when not given', async () => { /* same fake */ await finishScan(admin, 'id1', { status: 'done', attempts: 1, latencyMs: 5 }); expect('mode' in rows[0]).toBe(false); });
```

- [ ] **Step 2: Run** `npx vitest run lib/scan/__tests__/events.test.ts` — Expected: FAIL (`mode` missing).
- [ ] **Step 3: Implement** the field in `FinishPatch` and one line in `finishScan`. Write the migration: header comment naming the spec section; `alter table public.scan_events add column if not exists mode text not null default 'collection' check (mode in ('collection', 'deck'));`. No index, no change to `scan_reserve`. Document the column in `prompt_context/context.md` in the block's existing style.
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/124_scan_events_mode.sql lib/scan/events.ts lib/scan/__tests__/events.test.ts prompt_context/context.md
git commit -m "feat(scan): migration 124 — scan_events.mode, written by finishScan"
```

---

### Task 2: `lib/scan/deckSchema.ts` — instruction, schema, parser

**Files:**
- Create: `lib/scan/deckSchema.ts`
- Test: `lib/scan/__tests__/deckSchema.test.ts`

**Interfaces:**
- Consumes: `CARD_TYPES`, `CONFIDENCES`, `FIELD_CAPS` from `./schema`.
- Produces:
  - `GROUP_ORIENTATIONS = ['upright', 'rotated_cw', 'rotated_ccw', 'upside_down'] as const`
  - `DECK_PHOTO_QUALITIES = ['ok', 'blurry', 'dark', 'glare', 'no_cards'] as const`
  - `type Box = [number, number, number, number]` (normalized `[x0, y0, x1, y1]`)
  - `interface DeckGroup { id: number; orientation: (typeof GROUP_ORIENTATIONS)[number]; bbox: Box; cardCount: number }`
  - `interface DeckRead { title: string | null; strength: string | null; toughness: string | null; type: (typeof CARD_TYPES)[number]; brigade: string | null; reference: string | null; group: number; position: number; titleBox: Box | null; confidence: (typeof CONFIDENCES)[number] }`
  - `interface DeckOutput { photoQuality: (typeof DECK_PHOTO_QUALITIES)[number]; groups: DeckGroup[]; cards: DeckRead[] }`
  - `DECK_INSTRUCTION: string`, `DECK_JSON_SCHEMA: Record<string, unknown>`, `DECK_PROMPT_HASH: string` (as `PROMPT_HASH` is built)
  - `DECK_DETECTION_CAP = 300`
  - `parseDeckOutput(text: string): DeckOutput | null`

- [ ] **Step 1: Write the failing tests**

```ts
const card = (p: object = {}) => ({ title: 'Abner', strength: '7', toughness: '6', type: 'Evil Character', brigade: 'Gray', reference: null, group: 1, position: 1, titleBox: [0.1, 0.1, 0.2, 0.12], confidence: 'high', ...p });
const out = (p: object = {}) => JSON.stringify({ photoQuality: 'ok', groups: [{ id: 1, orientation: 'upright', bbox: [0, 0, 0.5, 1], cardCount: 1 }], cards: [card()], ...p });

it('parses a good response', () => { const o = parseDeckOutput(out())!; expect(o.cards[0]).toMatchObject({ title: 'Abner', group: 1, position: 1 }); expect(o.groups[0].orientation).toBe('upright'); });
it('null on bad JSON or a missing cards array', () => { expect(parseDeckOutput('nope')).toBeNull(); expect(parseDeckOutput('{"photoQuality":"ok","groups":[]}')).toBeNull(); });
it('caps strings with the scanner caps', () => expect(parseDeckOutput(out({ cards: [card({ title: 'x'.repeat(200) })] }))!.cards[0].title).toHaveLength(FIELD_CAPS.title));
it('boxes are clamped and ordered', () => { const o = parseDeckOutput(out({ groups: [{ id: 1, orientation: 'upright', bbox: [0.9, 0.2, 0.1, 1.4], cardCount: 1 }], cards: [card({ titleBox: [0.3, 'x', 0.4, 0.5] })] }))!; expect(o.groups[0].bbox).toEqual([0.1, 0.2, 0.9, 1]); expect(o.cards[0].titleBox).toBeNull(); });
it('a malformed group bbox becomes the whole photo', () => expect(parseDeckOutput(out({ groups: [{ id: 1, orientation: 'upright', bbox: null, cardCount: 1 }] }))!.groups[0].bbox).toEqual([0, 0, 1, 1]));
it('orphan cards land in group 0', () => { const o = parseDeckOutput(out({ groups: [], cards: [card({ group: 4 }), card({ group: 4, position: 2 })] }))!; expect(o.cards.map(c => c.group)).toEqual([0, 0]); expect(o.groups).toContainEqual({ id: 0, orientation: 'upright', bbox: [0, 0, 1, 1], cardCount: 2 }); });
it('unknown enums coerce', () => { const o = parseDeckOutput(out({ photoQuality: 'too_many_cards', groups: [{ id: 1, orientation: 'sideways', bbox: [0, 0, 1, 1], cardCount: 1 }], cards: [card({ type: 'Wizard', confidence: 'sure' })] }))!; expect(o.photoQuality).toBe('ok'); expect(o.groups[0].orientation).toBe('upright'); expect(o.cards[0].type).toBe('unknown'); expect(o.cards[0].confidence).toBe('low'); });
it('a null title is kept (an unread card)', () => expect(parseDeckOutput(out({ cards: [card({ title: null })] }))!.cards[0].title).toBeNull());
it('the schema requires every card field', () => expect((DECK_JSON_SCHEMA as any).properties.cards.items.required).toEqual(['title', 'strength', 'toughness', 'type', 'brigade', 'reference', 'group', 'position', 'titleBox', 'confidence']));
```

- [ ] **Step 2: Run** `npx vitest run lib/scan/__tests__/deckSchema.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** `DECK_INSTRUCTION` starts from the spike's text in the main checkout's `tmp/spike-deck-photo.ts` (gitignored; ask Tim if absent) and adds every point in the spec's *Instruction* list: title null when unreadable (never a guess), reference only when the verse line is visible, `group` and `position` (1-based, top to bottom or left to right within the group), `titleBox`, groups with `orientation`, `bbox`, `cardCount` (a row along an edge is its own group), Lost Souls as "Lost Soul", no identifying from memory, no invented cards. JSON schema: boxes are `{ type: ['array', 'null'], items: { type: 'number' } }` for `titleBox` and `{ type: 'array', items: { type: 'number' } }` for `bbox` (the API rejects `minItems`/`maxItems` bounds, as `schema.ts` notes for lengths). Parser: a card's group not in `groups` (or `groups` empty) → group 0, with a synthetic `{ id: 0, orientation: 'upright', bbox: [0, 0, 1, 1], cardCount: <orphans> }` appended only when needed; `position`, `id` and `cardCount` coerce like `gridIndex` (finite ≥ 1, floored, else 1; `cardCount` ≥ 0).
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `git add lib/scan/deckSchema.ts lib/scan/__tests__/deckSchema.test.ts && git commit -m "feat(scan): deck photo instruction, schema and parser"`

---

### Task 3: `recognize()` modes, deck timing, `too_many_cards`

**Files:**
- Modify: `lib/scan/recognize.ts`
- Test: `lib/scan/__tests__/recognize.test.ts` (add a `describe('deck mode')`; existing tests must pass unchanged)

**Interfaces:**
- Consumes: Task 2's `DECK_INSTRUCTION`, `DECK_JSON_SCHEMA`, `parseDeckOutput`, `DeckOutput`.
- Produces:
  - `interface RecognizeMode<T> { name: 'collection' | 'deck'; instruction: string; schema: Record<string, unknown>; parse: (text: string) => T | null; timeoutMs?: number; retryLongOutput: boolean; retryWithinMs: number }`
  - `COLLECTION_MODE: RecognizeMode<ScanOutput>` (`timeoutMs` undefined → the client's 25 s; `retryLongOutput: true`; `retryWithinMs: Infinity`)
  - `DECK_MODE: RecognizeMode<DeckOutput>` (`timeoutMs: 60_000`; `retryLongOutput: false`; `retryWithinMs: 10_000`)
  - `DECK_ARM: Required<Arm>` = the Global Constraints deck arm
  - `type Create = (params: unknown, options?: { timeout?: number }) => Promise<unknown>`; the default client passes `options` through to `client.messages.create(params, options)`
  - `Deps` gains `now?: () => number` (default `Date.now`)
  - `RecognizeResult<T = ScanOutput>`; failure `code` union gains `'too_many_cards'`
  - `recognize<T = ScanOutput>(jpeg: Buffer, arm: Required<Arm>, deps?: Deps, mode?: RecognizeMode<T>): Promise<RecognizeResult<T>>` — `mode` defaults to `COLLECTION_MODE`, so every existing caller compiles unchanged.

- [ ] **Step 1: Write the failing tests** (reuse the file's `ok`, `httpErr`, `noSleep` helpers; `goodDeck = JSON.stringify({ photoQuality: 'ok', groups: [], cards: [] })`)

```ts
it('sends the deck instruction, schema and effort', async () => { let p: any; await recognize(Buffer.alloc(10), DECK_ARM, { create: async (x: any) => { p = x; return ok(goodDeck); } }, DECK_MODE); expect(p.messages[0].content[1].text).toBe(DECK_INSTRUCTION); expect(p.output_config.format.schema).toBe(DECK_JSON_SCHEMA); expect(p.output_config.effort).toBe('medium'); expect(p.max_tokens).toBe(16000); });
it('passes a 60 s timeout per call in deck mode and none in collection mode', async () => { const opts: any[] = []; const create = async (_p: any, o?: any) => { opts.push(o); return ok(goodDeck); }; await recognize(Buffer.alloc(10), DECK_ARM, { create }, DECK_MODE); await recognize(Buffer.alloc(10), DEFAULT_ARM, { create: async (_p: any, o?: any) => { opts.push(o); return ok(good); } }); expect(opts[0]).toEqual({ timeout: 60000 }); expect(opts[1]?.timeout).toBeUndefined(); });
it('a max_tokens stop in deck mode is too_many_cards with no retry', async () => { let n = 0; const r = await recognize(Buffer.alloc(10), DECK_ARM, { create: async () => { n++; return ok(goodDeck, 'max_tokens'); } }, DECK_MODE); expect(n).toBe(1); expect(r.ok === false && r.code).toBe('too_many_cards'); expect(r.ok === false && r.costUsd).toBeCloseTo(0.008, 6); });
it('deck mode retries a quick 5xx once', async () => { let n = 0; const r = await recognize(Buffer.alloc(10), DECK_ARM, { sleep: noSleep, create: async () => { if (++n === 1) throw httpErr(500); return ok(goodDeck); } }, DECK_MODE); expect(r.ok && r.attempts).toBe(2); });
it('deck mode does not retry a 5xx after 10 s', async () => { let t = 0, n = 0; const r = await recognize(Buffer.alloc(10), DECK_ARM, { sleep: noSleep, now: () => t, create: async () => { n++; t += 11_000; throw httpErr(503); } }, DECK_MODE); expect(n).toBe(1); expect(r.ok === false && r.code).toBe('recognizer_failed'); });
it('deck output is parsed with the deck parser', async () => { const r = await recognize(Buffer.alloc(10), DECK_ARM, { create: async () => ok(JSON.stringify({ photoQuality: 'ok', groups: [{ id: 1, orientation: 'upright', bbox: [0, 0, 1, 1], cardCount: 1 }], cards: [] })) }, DECK_MODE); expect(r.ok && r.output.groups).toHaveLength(1); });
```

- [ ] **Step 2: Run** `npx vitest run lib/scan/__tests__/recognize.test.ts` — Expected: the new tests FAIL, the old ones PASS.
- [ ] **Step 3: Implement.** `buildParams` takes the mode's instruction and schema. Retry gate: a retryable throw retries only when `canRetry && now() - started < mode.retryWithinMs`. On `max_tokens`: `if (!mode.retryLongOutput) return fail('too_many_cards', responseDetail(res, 'max_tokens'))`, else today's path. Pass `mode.timeoutMs !== undefined ? { timeout: mode.timeoutMs } : undefined` as the second argument to `create`. `latencyMs` keeps using `Date.now()`-style elapsed from `now()`.
- [ ] **Step 4: Run** the test file and `npx vitest run lib/scan app/api/scan` — Expected: PASS (the route and abCompare still compile against the default mode).
- [ ] **Step 5: Commit** `git add lib/scan/recognize.ts lib/scan/__tests__/recognize.test.ts && git commit -m "feat(scan): recognizer modes; deck mode with a 60 s timeout and too_many_cards"`

---

### Task 4: `near[]` on `MatchResult` and `lib/scan/deckClassify.ts`

**Files:**
- Modify: `lib/scan/match.ts` (`lookupStem`, `MatchResult`, `matchDetection`)
- Create: `lib/scan/deckClassify.ts`
- Test: `lib/scan/__tests__/match.test.ts` (add two tests), `lib/scan/__tests__/deckClassify.test.ts`

**Interfaces:**
- Consumes: Task 2's `DeckRead`; `matchDetection`, `MatchResult`, `PriceMap` from `./match`; `getScanIndex` from `./stemIndex`; `cardKey` from `./vocab`.
- Produces:
  - `MatchResult.near?: { stem: string; d: number }[]` — up to 5 nearest stems (normalized stem and OSA distance ratio, ascending), set on every result that went through the fuzzy search (fuzzy hits and `not_found` from a stem miss); absent on exact hits. The `note` strings stay as they are.
  - `type DeckRowKind = 'matched' | 'which' | 'read_as' | 'not_found' | 'unread' | 'lost_soul'`
  - `interface DeckClass { kind: DeckRowKind; key: string | null; identityCandidates?: string[] }` — `key` is the deck printing's `cardKey` (`name|set|imgFile`) for `matched`, `read_as` and `which` (the provisional choice), else `null`.
  - `deckReadToDetection(read: DeckRead): ScanDetection` — title, stats, type, brigade, reference copied; every other string field null; `grid: { row: read.position, col: read.group }`; `orientation: 'upright'`; `confidence` copied.
  - `deckPrinting(identityKey: string, matcherChosenKey?: string): string` — the identity's printing by the spec's *Printing preference*: the matcher's chosen printing when it is Rotation-legal; else the first Rotation-legal printing in `identity.cards` order (CARDS order, which is the carddata.txt order the builder lists printings in) that is not an AB printing (`isAB` from `./vocab`); else the first Rotation-legal; else the first printing.
  - `classifyDeckRead(read: DeckRead, m: MatchResult): DeckClass` — the spec's *From reads to rows* table, in this order:
    1. `read.title` null → `unread`.
    2. normalized title starts with `lost soul` and (`printingReason === 'reference_missing'` or `status === 'not_found'`) → `lost_soul`.
    3. `printingReason === 'identity_ambiguous'` → `which`, `identityCandidates` from `m`, `key = deckPrinting(provisional)` where provisional is the only candidate identity with a Rotation-legal printing, else `m.identityCandidates[0]`.
    4. `printingReason === 'reference_ambiguous'` (Lost Soul) → `matched` on `identityCandidates[0]`.
    5. `status === 'not_found'` → `not_found`.
    6. `nameReason === 'fuzzy' && read.confidence === 'low'` → `read_as`.
    7. otherwise (`matched`, or `check` with any printing reason) → `matched`, `key = deckPrinting(m.identityKey!, m.chosen?.key)`.

- [ ] **Step 1: Write the failing tests** (`deckClassify.test.ts` uses the real index; `read = (p) => ({ title: null, strength: null, toughness: null, type: 'unknown', brigade: null, reference: null, group: 1, position: 1, titleBox: null, confidence: 'high', ...p })`; `classify = (r) => classifyDeckRead(r, matchDetection(deckReadToDetection(r), {}))`)

```ts
// match.test.ts
it('a stem miss carries near stems, closest first', () => { const m = matchDetection(det({ title: 'Abnar' }), NO) /* 5 letters: within 0.2 of 'abner' but under the short-title guard, so not_found */; expect(m.near?.length).toBeGreaterThan(0); expect(m.near!.map(x => x.d)).toEqual([...m.near!.map(x => x.d)].sort((a, b) => a - b)); expect(m.near!.length).toBeLessThanOrEqual(5); });
it('an exact hit has no near list', () => expect(matchDetection(det({ title: 'Captive Priest' }), NO).near).toBeUndefined());

// deckClassify.test.ts
it('a title-only read of a unique card is matched to a Rotation printing', () => { const c = classify(read({ title: 'Captive Priest' })); expect(c.kind).toBe('matched'); expect(CARDS.find(x => cardKey(x) === c.key)!.legality).toBe('Rotation'); });
it('null title is unread', () => expect(classify(read({ title: null })).kind).toBe('unread'));
it('a fanned Lost Soul is a placeholder', () => expect(classify(read({ title: 'Lost Soul', type: 'Lost Soul' })).kind).toBe('lost_soul'));
it('a Lost Soul with an unmatched reference is a placeholder', () => expect(classify(read({ title: 'Lost Soul', type: 'Lost Soul', reference: 'Obadiah 9:99' })).kind).toBe('lost_soul'));
it('a Lost Soul with a read reference is matched', () => expect(classify(read({ title: 'Lost Soul', type: 'Lost Soul', reference: 'Ezekiel 34:12' })).kind).toBe('matched'));
it('Forest Fire by title alone is which-card with FooF and Roots', () => { const c = classify(read({ title: 'Forest Fire', brigade: 'Green/Crimson', type: 'Enhancement' })); expect(c.kind).toBe('which'); const names = c.identityCandidates!.flatMap(k => getScanIndex().identities.get(k)!.cards.map(x => x.name)); expect(names).toEqual(expect.arrayContaining(['Forest Fire (FooF)', 'Forest Fire (Roots)'])); });
it('which-card provisional is the only Rotation-legal identity', () => { /* pick a tie from the Forest Fire case: assert CARDS.find(key).legality === 'Rotation' when exactly one tied identity has a Rotation printing */ });
it('Amariah read as Clay is the Roots card', () => { const c = classify(read({ title: 'Amariah, the High Priest', brigade: 'Clay', type: 'Hero' })); expect(c.kind).toBe('matched'); expect(c.key).toMatch(/^Amariah, the High Priest \(Roots\)\|/); });
it('a low-confidence fuzzy hit is read_as; a sharp one stays matched', () => { expect(classify(read({ title: 'Captive Preist', confidence: 'low' })).kind).toBe('read_as'); expect(classify(read({ title: 'Captive Preist', confidence: 'high' })).kind).toBe('matched'); });
it('another game\'s card is not_found', () => expect(classify(read({ title: 'Lightning Bolt' })).kind).toBe('not_found'));
it('deckPrinting prefers the matcher choice when it is Rotation-legal, else a non-AB Rotation printing', () => { /* pick an identity with an AB and a non-AB Rotation printing from getScanIndex(); assert both branches */ });
```

The two tests left as comments are written by the implementer against the real index: find the fixture with a short script over `getScanIndex().identities` and hard-code the names found. If no identity in the catalog has both an AB and a non-AB Rotation printing, test the non-AB rule with a stub identity instead.

- [ ] **Step 2: Run** `npx vitest run lib/scan/__tests__/match.test.ts lib/scan/__tests__/deckClassify.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** In `lookupStem`, return `near: near.slice(0, 5).map(x => ({ stem: x.s, d: x.d }))` alongside both the fuzzy hit and the note, and copy it onto the `MatchResult` in `matchDetection` (and `notFound`). Then `deckClassify.ts` per the Interfaces block.
- [ ] **Step 4: Run** the two files plus `npx vitest run lib/scan` (the golden set must be unchanged) — Expected: PASS.
- [ ] **Step 5: Commit** `git add lib/scan/match.ts lib/scan/deckClassify.ts lib/scan/__tests__/match.test.ts lib/scan/__tests__/deckClassify.test.ts && git commit -m "feat(scan): near stems on MatchResult; classify deck reads into decklist rows"`

---

### Task 5: `lib/scan/deck.ts` — merge into rows, reserve default (client-safe)

**Files:**
- Create: `lib/scan/deck.ts`
- Test: `lib/scan/__tests__/deck.test.ts`

**Interfaces:**
- Consumes: `DeckRowKind` (type-only import from `./deckClassify`), `GROUP_ORIENTATIONS` type from `./deckSchema`, `FORMATS` from `@/lib/formats`, no `./vocab` import: `vocab.ts` imports `CARDS`, so copy its three-line `normalizeTitle` into `deck.ts` as a private helper with a comment naming the original.
- Produces:
  - `interface DeckEntry { readId: string; photo: number; group: number; kind: DeckRowKind; key: string | null; title: string | null; identityCandidates?: string[]; type: string }` — one per read; `photo` is the tray's photo index, `readId` is the route's `${scanId}:${i}`.
  - `interface DeckRow { rowKey: string; kind: DeckRowKind; key: string | null; title: string | null; identityCandidates?: string[]; quantity: number; shares: Record<string, number>; readIds: string[]; mainOnly: boolean }` — `shares` is keyed `${photo}:${group}`; `mainOnly` is true for Lost Souls and Dominants.
  - `rowKeyOf(e: DeckEntry): string` — `matched` → `m:${key}`; `read_as` → `r:${key}`; `which` → `w:${sorted identityCandidates joined by ','}`; `not_found` → `n:${normalizeTitle(title)}`; `unread` → `u:${photo}:${group}`; `lost_soul` → `l:${photo}:${group}`.
  - `mergeDeckRows(entries: DeckEntry[]): DeckRow[]` — first-seen order; quantity = entries merged; shares counted per group.
  - `impliedFamily(mainTotal: number): 'T1' | 'T2'` — `T2` when `FORMATS.T2.main.min ≤ total ≤ FORMATS.T2.main.max`, else `T1`.
  - `interface GroupSize { key: string; orientation: (typeof GROUP_ORIENTATIONS)[number]; count: number }` — `key` is `${photo}:${group}`, in reading order (photo, then group order as returned).
  - `defaultReserveGroup(groups: GroupSize[]): string | null` — the spec's *Groups and zones* rule. Candidate: the only non-upright group if exactly one exists, else the last group. It is Reserve when: total of the other groups ≥ `FORMATS.Limited.main.min`; and its count ≤ `FORMATS[impliedFamily(othersTotal) === 'T2' ? 'T2' : 'Limited'].reserveMax`. Else `null`. Fewer than two groups → `null`.

- [ ] **Step 1: Write the failing tests**

```ts
const e = (p: Partial<DeckEntry>): DeckEntry => ({ readId: 's:0', photo: 0, group: 1, kind: 'matched', key: 'Abner|K|abner', title: 'Abner', type: 'Evil Character', ...p });
it('merges matched reads across groups with per-group shares', () => { const rows = mergeDeckRows([e({ readId: 's:0' }), e({ readId: 's:1', group: 2 }), e({ readId: 's:2', group: 2 })]); expect(rows).toHaveLength(1); expect(rows[0].quantity).toBe(3); expect(rows[0].shares).toEqual({ '0:1': 1, '0:2': 2 }); expect(rows[0].readIds).toEqual(['s:0', 's:1', 's:2']); });
it('a read_as row never merges into a matched row of the same card', () => expect(mergeDeckRows([e({}), e({ kind: 'read_as' })])).toHaveLength(2));
it('Lost Soul placeholders and unread reads collapse per group', () => { const rows = mergeDeckRows([e({ kind: 'lost_soul', key: null, title: 'Lost Soul', type: 'Lost Soul' }), e({ kind: 'lost_soul', key: null, title: 'Lost Soul', type: 'Lost Soul' }), e({ kind: 'lost_soul', key: null, group: 2, title: 'Lost Soul', type: 'Lost Soul' }), e({ kind: 'unread', key: null, title: null })]); expect(rows.map(r => [r.kind, r.quantity])).toEqual([['lost_soul', 2], ['lost_soul', 1], ['unread', 1]]); });
it('not_found merges on the normalized read title', () => expect(mergeDeckRows([e({ kind: 'not_found', key: null, title: 'Fresh Bread' }), e({ kind: 'not_found', key: null, title: 'fresh  bread', group: 3 })])[0].quantity).toBe(2));
it('Lost Souls and Dominants are main-only', () => { const rows = mergeDeckRows([e({ kind: 'lost_soul', key: null, type: 'Lost Soul' }), e({ key: 'Son of God|P|sog', type: 'Dominant' })]); expect(rows.every(r => r.mainOnly)).toBe(true); });
it('impliedFamily reads FORMATS', () => { expect(impliedFamily(FORMATS.T2.main.min)).toBe('T2'); expect(impliedFamily(FORMATS.T2.main.min - 1)).toBe('T1'); expect(impliedFamily(FORMATS.T2.main.max + 1)).toBe('T1'); });
const g = (key: string, count: number, orientation: GroupSize['orientation'] = 'upright') => ({ key, count, orientation });
it('the last group is Reserve when the rest make a deck and it fits', () => expect(defaultReserveGroup([g('0:1', 25), g('0:2', 25), g('0:3', 10)])).toBe('0:3'));
it('the only sideways group is Reserve even when not last', () => expect(defaultReserveGroup([g('0:1', 8, 'rotated_cw'), g('0:2', 26), g('0:3', 26)])).toBe('0:1'));
it('no Reserve when the rest are under the main minimum', () => expect(defaultReserveGroup([g('0:1', 40), g('0:2', 9)])).toBeNull());
it('no Reserve when the group is over the reserve max', () => expect(defaultReserveGroup([g('0:1', 50), g('0:2', 11)])).toBeNull());
it('a Type 2 main allows a 20-card reserve', () => expect(defaultReserveGroup([g('0:1', 100), g('0:2', 20)])).toBe('0:2'));
it('two sideways groups fall back to the last group', () => expect(defaultReserveGroup([g('0:1', 5, 'rotated_cw'), g('0:2', 50), g('0:3', 5, 'rotated_ccw')])).toBe('0:3'));
it('one group is never Reserve', () => expect(defaultReserveGroup([g('0:1', 60)])).toBeNull());
```

- [ ] **Step 2: Run** `npx vitest run lib/scan/__tests__/deck.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces block, and add one more test that keeps it client-safe: `expect(fs.readFileSync('lib/scan/deck.ts', 'utf8')).not.toMatch(/lib\/cards|stemIndex|\.\/vocab/)`.
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `git add lib/scan/deck.ts lib/scan/__tests__/deck.test.ts && git commit -m "feat(scan): merge deck reads into rows; default reserve group from lib/formats"`

---

### Task 6: `POST /api/scan` with `mode=deck`

**Files:**
- Modify: `app/api/scan/route.ts`
- Test: `app/api/scan/__tests__/route.test.ts` (add a `describe('deck mode')`; existing tests unchanged)

**Interfaces:**
- Consumes: `DECK_MODE`, `DECK_ARM`, `recognize` (Task 3); `DECK_DETECTION_CAP`, `DeckOutput` (Task 2); `deckReadToDetection`, `classifyDeckRead` (Task 4); `FinishPatch.mode` (Task 1).
- Produces (PR 2 relies on this response shape):
  - Request: form field `mode`, `'collection'` (default when absent) or `'deck'`; any other value → 400 `bad_request` "mode must be collection or deck." (checked with the other body checks, before reserve).
  - Deck response: `{ scanId, mode: 'deck', photoQuality, groups: DeckGroup[], detections: DeckDetection[], usage }` where `DeckDetection = { id: string; group: number; position: number; titleBox: Box | null; read: ScanDetection; status; nameReason; printingReason; chosenKey: string | null; kind: DeckRowKind; deckKey: string | null; identityCandidates?: string[]; near?: { stem: string; d: number }[]; scores; candidates }`. Export `DeckDetection` and `DeckScanResponse` types from `lib/scan/deckClassify.ts` so PR 2's client imports types only.
  - Collection response gains `mode: 'collection'` and is otherwise unchanged.
  - `too_many_cards` → 422 `{ code: 'too_many_cards', message: 'Too many cards for one photo.' }`, row finished `failed` with its spend.
  - Every `finish(...)` call passes `mode`.

- [ ] **Step 1: Write the failing tests** (reuse the file's `session`, `det`, `jpeg` helpers and a `postForm(fields)` helper if one exists; mock `recognize` resolving `{ ok: true, output: deckOut, model: 'claude-sonnet-5-5', usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.04, latencyMs: 10, attempts: 1 }`)

```ts
it('deck mode calls recognize with DECK_MODE and DECK_ARM', async () => { /* post mode=deck */ expect((recognize as Mock).mock.calls[0][1]).toEqual(DECK_ARM); expect((recognize as Mock).mock.calls[0][3]).toBe(DECK_MODE); });
it('deck mode returns groups and classified detections', async () => { /* deckOut: one group, cards Captive Priest + Lost Soul */ expect(body.mode).toBe('deck'); expect(body.groups).toHaveLength(1); expect(body.detections.map((d: any) => d.kind)).toEqual(['matched', 'lost_soul']); expect(body.detections[0]).toMatchObject({ group: 1, position: 1 }); expect(body.detections[0].deckKey).toMatch(/^Captive Priest/); });
it('deck mode caps detections at 300', async () => { /* 320 cards */ expect(body.detections).toHaveLength(300); });
it('deck mode skips the AB comparison', async () => { /* vi.mock('@/lib/scan/abCompare') spy, or assert recognize called once and abCompare's settleAbPairs spy not called */ });
it('too_many_cards is 422 and finishes failed with its cost', async () => { /* recognize → { ok: false, code: 'too_many_cards', usage, costUsd: 0.16, latencyMs, attempts: 1 } */ expect(res.status).toBe(422); expect(update.mock.calls.at(-1)[0]).toMatchObject({ status: 'failed', cost_usd: 0.16, mode: 'deck' }); });
it('finish writes mode deck', async () => { expect(update.mock.calls.at(-1)[0].mode).toBe('deck'); });
it('a superuser arm override merges onto DECK_ARM in deck mode', async () => { /* superuser, arm {"effort":"low"} */ expect((recognize as Mock).mock.calls[0][1]).toEqual({ ...DECK_ARM, effort: 'low' }); });
it('an unknown mode is 400 before reserve', async () => { /* mode=binder */ expect(res.status).toBe(400); expect(adminRpc).not.toHaveBeenCalled(); });
it('no mode field is collection mode', async () => { /* existing happy path */ expect((recognize as Mock).mock.calls[0][1]).toEqual(DEFAULT_ARM); expect((recognize as Mock).mock.calls[0][3] ?? COLLECTION_MODE).toBe(COLLECTION_MODE); expect(body.mode).toBe('collection'); expect('groups' in body).toBe(false); expect(update.mock.calls.at(-1)[0].mode).toBe('collection'); });
```

If `settleAbPairs` is not mocked in the file today, add `vi.mock('@/lib/scan/abCompare', async (orig) => ({ ...(await orig()), settleAbPairs: vi.fn(...) }))` passing through the real implementation for collection tests (`vi.fn((...a) => real(...a))`).

- [ ] **Step 2: Run** `npx vitest run app/api/scan` — Expected: new tests FAIL, old ones PASS.
- [ ] **Step 3: Implement.** `parseArm(raw, base)` merges onto the mode's base arm. After the recognizer: branch on mode; the deck branch slices `r.output.cards` to `DECK_DETECTION_CAP`, maps each through `deckReadToDetection` → `capDetection` → `matchDetection(det, prices)` → `classifyDeckRead`, builds `DeckDetection`s with `id: \`${scanId}:${i}\``, finishes with `detections` minus `candidates` (as collection does) and `mode: 'deck'`. Keep the collection branch byte-for-byte except `mode` on finish and in the response. Update the route's header comment's order line to mention the deck branch.
- [ ] **Step 4: Run** `npx vitest run lib/scan app/api/scan` and `npx tsc --noEmit -p .` — Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `git add app/api/scan/route.ts app/api/scan/__tests__/route.test.ts lib/scan/deckClassify.ts && git commit -m "feat(scan): POST /api/scan mode=deck — grouped reads, classified rows, no AB pass"`

---

### Task 7: Eval harness — `run.ts --mode deck` and `deckScore.ts`

**Files:**
- Modify: `scripts/scan-eval/run.ts` (`RunOptions.mode`, `parseArgs`, form field)
- Create: `scripts/scan-eval/deckScore.ts`, `scripts/scan-eval/labels-deck.schema.md`
- Modify: `.gitignore` (add `scripts/scan-eval/photos-deck/` under the scanner block)
- Test: `scripts/scan-eval/__tests__/deckScore.test.ts` (check where `score.ts`'s tests live first: `grep -rl "scorePhoto" scripts lib --include=*.test.ts` and put the new file beside them)

**Interfaces:**
- Consumes: Task 6's `DeckScanResponse`; `getScanIndex`, `findCard` from `@/lib/cards/lookup`; Task 5's `mergeDeckRows`, `defaultReserveGroup`.
- Produces:
  - `run.ts`: `--mode collection|deck` (default `collection`), appended as the `mode` form field; with `--mode deck` and no `--arm`, no `arm` field is sent (the route's `DECK_ARM` applies) but `source=eval` is.
  - Labels file shape (document in `labels-deck.schema.md`): `{ photo: string; cards: { name: string; qty: number }[]; lostSouls: number; reserveSize: number; unreadable: number }[]` — `name` is an exact `CardData.name`; `cards` excludes Lost Souls.
  - `interface DeckPhotoScore { photo: string; precision: number; recall: number; invented: number; lostSoulError: number; reserveDefaultRight: boolean; groupCountError: number; costUsd: number | null; latencyMs: number | null }`
  - `scoreDeckPhoto(label: DeckLabel, resp: DeckScanResponse): DeckPhotoScore` — identities compared as multisets of `getScanIndex().identityOf(card).key`; predicted multiset from `matched` and `which` detections' `deckKey` (provisional counts; Lost Soul identities excluded); recall denominator = label qty total minus `unreadable`; `invented` = predicted copies whose identity is absent from the label; `lostSoulError` = `|lost_soul placeholders + matched Lost Souls − lostSouls|`; `reserveDefaultRight` = `defaultReserveGroup` over the response's groups (count = detections per group) is `null` when `reserveSize === 0`, else its group's count equals `reserveSize`; `groupCountError` = Σ |`cardCount` − detections in the group|.
  - CLI: `npx tsx scripts/scan-eval/deckScore.ts --labels scripts/scan-eval/labels-deck.json --outputs scripts/scan-eval/outputs/deck-<arm>/` prints one line per photo and the means.

- [ ] **Step 1: Write the failing tests** — a hand-written two-card label and a response fixture in the new shape:

```ts
it('perfect read scores 1/1 with nothing invented', () => { const s = scoreDeckPhoto(label, resp); expect([s.precision, s.recall, s.invented]).toEqual([1, 1, 0]); });
it('an invented card counts and lowers precision', () => { const s = scoreDeckPhoto(label, withExtra(resp, 'Lightning Bolt matched to Captive Priest')); expect(s.invented).toBe(1); expect(s.precision).toBeLessThan(1); });
it('unreadable cards leave the recall denominator', () => { expect(scoreDeckPhoto({ ...label, unreadable: 1 }, missingOne(resp)).recall).toBe(1); });
it('Lost Soul error counts placeholders and matched Lost Souls', () => { expect(scoreDeckPhoto({ ...label, lostSouls: 7 }, withLostSouls(resp, 6, 0)).lostSoulError).toBe(1); });
it('reserve default right when no reserve and none chosen', () => expect(scoreDeckPhoto({ ...label, reserveSize: 0 }, resp).reserveDefaultRight).toBe(true));
it('run.ts parses --mode and rejects other values', () => { expect(parseArgs(['--base-url', 'x', '--cookie', 'c', '--mode', 'deck']).mode).toBe('deck'); expect(() => parseArgs(['--base-url', 'x', '--cookie', 'c', '--mode', 'binder'])).toThrow(/--mode/); });
```

`withExtra`, `missingOne` and `withLostSouls` are small fixture builders in the test file.

- [ ] **Step 2: Run** the test file — Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces block. Update `run.ts`'s header usage comment with a `--mode deck` example.
- [ ] **Step 4: Run** the test file — Expected: PASS.
- [ ] **Step 5: Commit** `git add scripts/scan-eval/run.ts scripts/scan-eval/deckScore.ts scripts/scan-eval/labels-deck.schema.md scripts/scan-eval/__tests__/deckScore.test.ts .gitignore && git commit -m "feat(scan-eval): --mode deck runner and deck photo scorer"`

---

### Task 8: Docs, full check, PR

**Files:**
- Modify: `CLAUDE.md` (Key References: one row, *Deck photo import* → spec path + `lib/scan/deck.ts`, `lib/scan/deckClassify.ts`, `deckSchema.ts`; `POST /api/scan mode=deck`)

- [ ] **Step 1: Add the CLAUDE.md row** in the table's existing style, after the *Card scanner* row.
- [ ] **Step 2: Run** `npx vitest run lib/scan app/api/scan scripts/scan-eval` and `npx tsc --noEmit -p .` — Expected: all PASS, no type errors. (No full `next build`: Tim's standing preference.)
- [ ] **Step 3: Commit** `git add CLAUDE.md && git commit -m "docs: deck photo import in Key References"`
- [ ] **Step 4: Open the PR** from the worktree: `git fetch && git rebase origin/main`, push `feat/deck-scan-lib`, `gh pr create --base main` with a body that lists: the route contract (`mode`, response shape, 422 `too_many_cards`), migration 124 to apply to production before PR 2's preview, the dropped `stemIndex` change and why, and that no UI ships.
