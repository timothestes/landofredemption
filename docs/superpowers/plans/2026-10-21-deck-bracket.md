# Deck Bracket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in player builds a single-elimination bracket of their own decks, plays every match solo on the `/play` table (one human, both seats), and watches results write themselves into the bracket.

**Architecture:** Four new Supabase tables with a pure `lib/bracket/` module for all bracket math; new `/brackets/*` pages that reuse the `/play` deck picker tiles; a `SoloGame` marker table in the SpacetimeDB module plus a hinted seat-resolution helper so one identity can act as either seat; the `/play` client learns a `solo` role, a reveal-all board, a swap pill, and a bracket game-over screen that calls a server action to record the result. Friend mode (an invite page and a bracket-scoped deck load) is last and droppable.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (Postgres + RLS, server actions), SpacetimeDB TypeScript module + generated bindings, Tailwind + shadcn primitives, vitest (node-only).

**Spec:** `docs/superpowers/specs/2026-10-21-deck-bracket-design.md`

## Global Constraints

- Work only in the worktree `/Users/timestes/projects/rtt-deck-bracket` (branch `feat/deck-bracket`), absolute paths, `git add <specific files>` only.
- `lib/cards/lookup.ts` is never imported by client code; deck enrichment stays in server actions. Bracket pages render from snapshotted entry fields.
- SpacetimeDB: new state is the marker table `SoloGame`; no new `Game` columns. Any column added to an existing table goes at the END. After any `spacetimedb/src` change, publish with the `spacetimedb-deploy` skill and regenerate bindings. Read `spacetimedb/CLAUDE.md` first. BigInt literals (`0n`), object-syntax reducer calls, `SenderError` for validation.
- Migration file is `supabase/migrations/113_deck_brackets.sql`. Do not apply it to prod from a task; the final task applies it.
- Design: `prompt_context/design_system.md`. Green only for primary actions and the winning row. Cinzel only for the page H1. Hairline rows for lists. Touch targets `min-h-11`. No toasts that repeat the screen, no confetti. Copy as fixed in the spec ("Play game 2", "Resume game 2", "Record result by hand", "Reset match", "Abandon this game", "Choose a soul for <deck>", "Concede as <deck>?").
- Formats: bracket `format` is a family `'T1' | 'T2' | 'Paragon'`; a deck belongs to a family via `getFormatDef(deck.format).family` from `lib/formats.ts`.
- vitest is node-only (no DOM); tests live under `**/__tests__/**` or `*.test.ts`. Run with `npx vitest run <path>`.
- No new npm dependencies.
- Commit after every task with the attribution line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A deck in an active bracket is deleted: `entries.deck_id` goes null; "Play" must disappear for its matches while "Record result by hand" still works. Pinned in Task 1 (`matchState` / `canPlayMatch`).
2. The writeback effect fires twice (React strict mode, reconnect): the second call must change nothing. Pinned in Task 1 (`applyGameResult` on an already-decided game returns no updates) and Task 3 (action returns early when `winner_entry_id` is set).
3. A result recorded against a match that is already `done` (stale page) must be refused, not applied. Pinned in Task 1.
4. A two-deck bracket (size 2) is just the final; a three-deck bracket has one bye. Pinned in Task 1.
5. A normal two-human game must be untouched by the solo hint: with one sender row, the hint is ignored. Pinned in Task 10 (`pickSoloRow`).

---

## Phase 1: Bracket core (works on its own with hand-recorded results)

### Task 1: Pure bracket logic

**Files:**
- Create: `lib/bracket/types.ts`, `lib/bracket/index.ts`
- Test: `lib/bracket/__tests__/bracket.test.ts`

**Interfaces:**
- Produces (all exported from `lib/bracket/index.ts`):

```ts
// lib/bracket/types.ts
export type BracketFormat = 'T1' | 'T2' | 'Paragon';
export type BestOf = 1 | 3 | 5;
export type BracketSize = 2 | 4 | 8 | 16;
export interface BracketEntry { id: string; seed: number; deckId: string | null; deckName: string;
  deckFormat: string; previewCard1: string | null; previewCard2: string | null; paragon: string | null }
export interface BracketMatch { id: string; round: number; position: number;
  entryAId: string | null; entryBId: string | null; winnerEntryId: string | null; isBye: boolean }
export type GameMode = 'solo' | 'online' | 'manual';
export interface BracketGame { id: string; matchId: string; gameNumber: number; mode: GameMode;
  code: string | null; firstEntryId: string | null; winnerEntryId: string | null;
  soulsA: number | null; soulsB: number | null }
export interface Bracket { id: string; name: string; format: BracketFormat; size: BracketSize;
  bestOf: BestOf; status: 'active' | 'complete'; championEntryId: string | null }
export type MatchState = 'bye' | 'waiting' | 'ready' | 'live' | 'done';
export interface SeriesState { winsA: number; winsB: number; needed: number; decided: boolean;
  winner: 'a' | 'b' | null; nextGameNumber: number; inProgress: BracketGame | null }
export type Slot = { position: number; side: 'a' | 'b' };
export type RowUpdate =
  | { kind: 'game'; gameId: string; winnerEntryId: string }
  | { kind: 'match-winner'; matchId: string; winnerEntryId: string }
  | { kind: 'match-slot'; matchId: string; side: 'a' | 'b'; entryId: string | null }
  | { kind: 'champion'; entryId: string | null };
```

```ts
// lib/bracket/index.ts
export function sizeFor(entryCount: number): BracketSize;            // throws RangeError outside 2..16
export function roundCount(size: BracketSize): number;               // log2
export function slotOrder(size: BracketSize): Slot[];                // all 'a' top-down, then all 'b' top-down
export function roundNames(size: BracketSize): string[];             // ['Quarterfinals','Semifinals','Final'] for 8
export function matchLabel(size: BracketSize, round: number, position: number): string; // 'QF1', 'SF2', 'Final', 'R16-3'
export function nextSlot(round: number, position: number): Slot & { round: number }; // round+1, floor(p/2), p%2 ? 'b' : 'a'
export function buildBracket(entries: BracketEntry[], ids: () => string): BracketMatch[]; // every round; byes decided
export function seriesState(games: BracketGame[], match: BracketMatch, bestOf: BestOf): SeriesState;
export function firstEntryForGame(games: BracketGame[], match: BracketMatch, coinFlip: 'a' | 'b'): string;
export function matchState(match: BracketMatch, games: BracketGame[], bestOf: BestOf): MatchState;
export function canPlayMatch(match: BracketMatch, entriesById: Map<string, BracketEntry>, state: MatchState): boolean;
export function applyGameResult(args: { bracket: Bracket; matches: BracketMatch[]; games: BracketGame[];
  gameId: string; winnerEntryId: string }): RowUpdate[];             // throws Error('match already decided') / ('game already decided') / ('winner is not in this match')
export function resetMatchAllowed(matches: BracketMatch[], games: BracketGame[], matchId: string): boolean;
export function resetMatchUpdates(matches: BracketMatch[], bracket: Bracket, matchId: string): RowUpdate[];
export function currentRoundName(bracket: Bracket, matches: BracketMatch[], games: BracketGame[]): string; // first round with an undecided non-bye match, or 'Complete'
```

- [ ] **Step 1: Write the failing tests**

```ts
// lib/bracket/__tests__/bracket.test.ts
import { describe, it, expect } from 'vitest';
import { sizeFor, slotOrder, roundNames, matchLabel, nextSlot, buildBracket, seriesState,
  firstEntryForGame, matchState, canPlayMatch, applyGameResult, resetMatchAllowed, resetMatchUpdates } from '../index';
import type { BracketEntry, BracketMatch, BracketGame, Bracket } from '../types';

const entry = (i: number, deckId: string | null = `d${i}`): BracketEntry =>
  ({ id: `e${i}`, seed: i, deckId, deckName: `Deck ${i}`, deckFormat: 'Limited', previewCard1: null, previewCard2: null, paragon: null });
const entries = (n: number) => Array.from({ length: n }, (_, i) => entry(i + 1));
let counter = 0; const ids = () => `m${++counter}`;

describe('sizeFor', () => {
  it.each([[2, 2], [3, 4], [4, 4], [5, 8], [8, 8], [9, 16], [16, 16]])('%i decks → size %i', (n, size) => expect(sizeFor(n)).toBe(size));
  it('rejects 1 and 17', () => { expect(() => sizeFor(1)).toThrow(RangeError); expect(() => sizeFor(17)).toThrow(RangeError); });
});

describe('slotOrder', () => {
  it('fills every a slot top-down, then every b slot', () => {
    expect(slotOrder(8)).toEqual([
      { position: 0, side: 'a' }, { position: 1, side: 'a' }, { position: 2, side: 'a' }, { position: 3, side: 'a' },
      { position: 0, side: 'b' }, { position: 1, side: 'b' }, { position: 2, side: 'b' }, { position: 3, side: 'b' }]);
  });
  it('never produces a bye-vs-bye for any count 2..16', () => {
    for (let n = 2; n <= 16; n++) {
      const ms = buildBracket(entries(n), ids).filter(m => m.round === 1);
      expect(ms.every(m => m.entryAId !== null)).toBe(true);
    }
  });
});

describe('roundNames / matchLabel / nextSlot', () => {
  it('names rounds by size', () => {
    expect(roundNames(2)).toEqual(['Final']);
    expect(roundNames(4)).toEqual(['Semifinals', 'Final']);
    expect(roundNames(8)).toEqual(['Quarterfinals', 'Semifinals', 'Final']);
    expect(roundNames(16)).toEqual(['Round of 16', 'Quarterfinals', 'Semifinals', 'Final']);
  });
  it('labels matches', () => {
    expect(matchLabel(8, 1, 0)).toBe('QF1'); expect(matchLabel(8, 2, 1)).toBe('SF2');
    expect(matchLabel(8, 3, 0)).toBe('Final'); expect(matchLabel(16, 1, 2)).toBe('R16-3');
  });
  it('feeds the next round', () => {
    expect(nextSlot(1, 0)).toEqual({ round: 2, position: 0, side: 'a' });
    expect(nextSlot(1, 3)).toEqual({ round: 2, position: 1, side: 'b' });
  });
});

describe('buildBracket', () => {
  it('builds 7 matches for 8 decks with no byes', () => {
    const ms = buildBracket(entries(8), ids);
    expect(ms).toHaveLength(7);
    expect(ms.filter(m => m.isBye)).toHaveLength(0);
    expect(ms.find(m => m.round === 3)!.entryAId).toBeNull();
  });
  it('decides byes at creation and advances them', () => {
    const ms = buildBracket(entries(6), ids);
    const byes = ms.filter(m => m.isBye);
    expect(byes.map(m => m.position)).toEqual([2, 3]);
    expect(byes[0].winnerEntryId).toBe('e3');
    const sf2 = ms.find(m => m.round === 2 && m.position === 1)!;
    expect(sf2.entryAId).toBe('e3'); expect(sf2.entryBId).toBe('e4');
  });
  it('two decks is just the final', () => {
    const ms = buildBracket(entries(2), ids);
    expect(ms).toHaveLength(1); expect(ms[0].round).toBe(1);
    expect(ms[0].entryAId).toBe('e1'); expect(ms[0].entryBId).toBe('e2');
  });
  it('three decks has one bye', () => {
    // slotOrder(4) = a0, a1, b0, b1 → e1 v e3 in match 0, e2 v bye in match 1
    const ms = buildBracket(entries(3), ids);
    expect(ms.filter(m => m.isBye)).toHaveLength(1);
    expect(ms.find(m => m.round === 2)!.entryBId).toBe('e2');
  });
});

const match = (over: Partial<BracketMatch> = {}): BracketMatch =>
  ({ id: 'm1', round: 1, position: 0, entryAId: 'e1', entryBId: 'e2', winnerEntryId: null, isBye: false, ...over });
const game = (n: number, winner: string | null, over: Partial<BracketGame> = {}): BracketGame =>
  ({ id: `g${n}`, matchId: 'm1', gameNumber: n, mode: 'manual', code: null, firstEntryId: null, winnerEntryId: winner, soulsA: null, soulsB: null, ...over });

describe('seriesState', () => {
  it('Bo3 at 1–1 needs one more', () => {
    const s = seriesState([game(1, 'e1'), game(2, 'e2')], match(), 3);
    expect(s).toMatchObject({ winsA: 1, winsB: 1, needed: 2, decided: false, winner: null, nextGameNumber: 3, inProgress: null });
  });
  it('Bo3 at 2–0 is decided for a', () => {
    expect(seriesState([game(1, 'e1'), game(2, 'e1')], match(), 3)).toMatchObject({ decided: true, winner: 'a' });
  });
  it('Bo1 decides after one game; an unfinished game is inProgress', () => {
    expect(seriesState([game(1, 'e2')], match(), 1)).toMatchObject({ decided: true, winner: 'b' });
    expect(seriesState([game(1, null)], match(), 5).inProgress?.id).toBe('g1');
  });
});

describe('firstEntryForGame', () => {
  it('game 1 is the coin flip', () => expect(firstEntryForGame([], match(), 'b')).toBe('e2'));
  it('later games go to the loser of the previous game', () =>
    expect(firstEntryForGame([game(1, 'e1')], match(), 'a')).toBe('e2'));
});

describe('matchState / canPlayMatch', () => {
  it('derives every state', () => {
    expect(matchState(match({ isBye: true, entryBId: null, winnerEntryId: 'e1' }), [], 3)).toBe('bye');
    expect(matchState(match({ entryBId: null }), [], 3)).toBe('waiting');
    expect(matchState(match(), [], 3)).toBe('ready');
    expect(matchState(match(), [game(1, null)], 3)).toBe('live');
    expect(matchState(match({ winnerEntryId: 'e1' }), [game(1, 'e1'), game(2, 'e1')], 3)).toBe('done');
  });
  it('a deleted deck blocks play but not recording', () => {
    const byId = new Map([['e1', entry(1, null)], ['e2', entry(2)]]);
    expect(canPlayMatch(match(), byId, 'ready')).toBe(false);
    expect(canPlayMatch(match(), new Map([['e1', entry(1)], ['e2', entry(2)]]), 'ready')).toBe(true);
  });
});

describe('applyGameResult', () => {
  const bracket: Bracket = { id: 'b', name: 'x', format: 'T1', size: 4, bestOf: 3, status: 'active', championEntryId: null };
  const matches = (): BracketMatch[] => [
    match({ id: 'm1', round: 1, position: 0 }),
    match({ id: 'm2', round: 1, position: 1, entryAId: 'e3', entryBId: 'e4' }),
    match({ id: 'm3', round: 2, position: 0, entryAId: null, entryBId: null }),
  ];
  it('records an undecided series game only', () => {
    const ups = applyGameResult({ bracket, matches: matches(), games: [game(1, null)], gameId: 'g1', winnerEntryId: 'e1' });
    expect(ups).toEqual([{ kind: 'game', gameId: 'g1', winnerEntryId: 'e1' }]);
  });
  it('advances the winner into the next slot when the series is decided', () => {
    const ups = applyGameResult({ bracket, matches: matches(), games: [game(1, 'e1'), game(2, null)], gameId: 'g2', winnerEntryId: 'e1' });
    expect(ups).toEqual([
      { kind: 'game', gameId: 'g2', winnerEntryId: 'e1' },
      { kind: 'match-winner', matchId: 'm1', winnerEntryId: 'e1' },
      { kind: 'match-slot', matchId: 'm3', side: 'a', entryId: 'e1' },
    ]);
  });
  it('crowns the champion after the final', () => {
    const ms = matches(); ms[2].entryAId = 'e1'; ms[2].entryBId = 'e3';
    const gs = [game(1, 'e3', { id: 'f1', matchId: 'm3' }), game(2, null, { id: 'f2', matchId: 'm3' })];
    const ups = applyGameResult({ bracket, matches: ms, games: gs, gameId: 'f2', winnerEntryId: 'e3' });
    expect(ups.at(-1)).toEqual({ kind: 'champion', entryId: 'e3' });
  });
  it('refuses a decided game, a decided match, and a foreign winner', () => {
    expect(() => applyGameResult({ bracket, matches: matches(), games: [game(1, 'e1')], gameId: 'g1', winnerEntryId: 'e1' })).toThrow('game already decided');
    const ms = matches(); ms[0].winnerEntryId = 'e1';
    expect(() => applyGameResult({ bracket, matches: ms, games: [game(1, null)], gameId: 'g1', winnerEntryId: 'e1' })).toThrow('match already decided');
    expect(() => applyGameResult({ bracket, matches: matches(), games: [game(1, null)], gameId: 'g1', winnerEntryId: 'e9' })).toThrow('winner is not in this match');
  });
});

describe('reset', () => {
  const bracket: Bracket = { id: 'b', name: 'x', format: 'T1', size: 4, bestOf: 1, status: 'complete', championEntryId: 'e1' };
  const ms: BracketMatch[] = [
    match({ id: 'm1', winnerEntryId: 'e1' }),
    match({ id: 'm2', position: 1, entryAId: 'e3', entryBId: 'e4', winnerEntryId: 'e3' }),
    match({ id: 'm3', round: 2, entryAId: 'e1', entryBId: 'e3', winnerEntryId: 'e1' }),
  ];
  it('allows a reset only while the fed match has no games', () => {
    expect(resetMatchAllowed(ms, [game(1, 'e1', { id: 'f1', matchId: 'm3' })], 'm1')).toBe(false);
    expect(resetMatchAllowed(ms, [], 'm1')).toBe(true);
    expect(resetMatchAllowed(ms, [game(1, 'e1', { id: 'f1', matchId: 'm3' })], 'm3')).toBe(true);
    expect(resetMatchAllowed([match({ isBye: true })], [], 'm1')).toBe(false);
  });
  it('clears the winner, the fed slot and the champion', () => {
    expect(resetMatchUpdates(ms, bracket, 'm3')).toEqual([
      { kind: 'match-winner', matchId: 'm3', winnerEntryId: '' },
      { kind: 'champion', entryId: null },
    ]);
    expect(resetMatchUpdates(ms, bracket, 'm1')).toEqual([
      { kind: 'match-winner', matchId: 'm1', winnerEntryId: '' },
      { kind: 'match-slot', matchId: 'm3', side: 'a', entryId: null },
    ]);
  });
});
```

(A `match-winner` update with `winnerEntryId: ''` means "clear". The server action maps `''` to SQL null.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/timestes/projects/rtt-deck-bracket && npx vitest run lib/bracket`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/bracket/types.ts` and `lib/bracket/index.ts`**

`buildBracket`: `size = sizeFor(entries.length)`; create `size/2` round-1 matches then halve each round; place entries sorted by `seed` along `slotOrder(size)`; a round-1 match with `entryBId === null` gets `isBye: true`, `winnerEntryId = entryAId`, and `nextSlot` of it is filled. `applyGameResult` throws in this order: game not found / `game already decided` / `match already decided` / `winner is not in this match`; then emits `game`, and when `seriesState` becomes decided, `match-winner`, `match-slot` (unless it is the last round), and `champion` (last round only). `resetMatchUpdates` emits `match-winner` with `''`, then `match-slot … null` for the fed match, or `champion null` for the final.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/bracket`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/bracket
git commit -m "feat(brackets): pure bracket logic (sizes, slots, series, advancement)"
```

---

### Task 2: Migration 113 and server types

**Files:**
- Create: `supabase/migrations/113_deck_brackets.sql`
- Create: `app/brackets/types.ts`
- Test: none (SQL); `tsc` for the types

**Interfaces:**
- Produces: the four tables exactly as the spec's "Data model" block; `app/brackets/types.ts` exports row types `DeckBracketRow`, `DeckBracketEntryRow`, `DeckBracketMatchRow`, `DeckBracketGameRow` (snake_case columns) and `toBracket/toEntry/toMatch/toGame` mappers to the `lib/bracket/types` shapes, plus `BracketPageData = { bracket: Bracket; entries: BracketEntry[]; matches: BracketMatch[]; games: BracketGame[]; ownerId: string; createdAt: string }`.

- [ ] **Step 1: Write the migration**

Follow `supabase/migrations/112_post_preview_links.sql` for style (header comment, `revoke all … from anon` is NOT wanted here since reads are public; grant `select` to `anon, authenticated` and `insert, update, delete` to `authenticated`). Tables and columns per the spec; `check` constraints: `format in ('T1','T2','Paragon')`, `size in (2,4,8,16)`, `best_of in (1,3,5)`, `status in ('active','complete')`, `mode in ('solo','online','manual')`; unique `(bracket_id, seed)`, `(bracket_id, round, position)`, `(match_id, game_number)`. `champion_entry_id` references `deck_bracket_entries(id) on delete set null`. `updated_at` trigger reusing the existing `update_updated_at_column()` function if present in `001_create_deck_tables.sql` (check its name; otherwise set `updated_at` from the actions).

Policies (name them `deck_brackets_select_all`, `deck_brackets_owner_write`, `deck_bracket_entries_select_all`, `deck_bracket_entries_owner_write`, and the same for matches and games): select `using (true)` for `anon, authenticated`; `for insert/update/delete to authenticated` with `using/with check (auth.uid() = owner_id)` on the parent and `exists (select 1 from public.deck_brackets b where b.id = bracket_id and b.owner_id = auth.uid())` on children (games join through `deck_bracket_matches`).

- [ ] **Step 2: Write `app/brackets/types.ts`**

Row interfaces mirror the columns; mappers are one-liners. `toGame` maps `souls_a/souls_b` to `soulsA/soulsB`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/113_deck_brackets.sql app/brackets/types.ts
git commit -m "feat(brackets): deck bracket tables, RLS, and row types"
```

---

### Task 3: Bracket server actions

**Files:**
- Create: `app/brackets/actions.ts` (`"use server"`)
- Create: `app/brackets/lib/gameCode.ts` + test `app/brackets/lib/__tests__/gameCode.test.ts`

**Interfaces:**
- Consumes: Task 1 functions, Task 2 types, `createClient` from `@/utils/supabase/server`, `findCard` from `@/lib/cards/lookup` (server only), `GameCardData` from `app/play/actions.ts`.
- Produces:

```ts
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
export async function createBracketAction(input: { name: string; format: BracketFormat; bestOf: BestOf; deckIds: string[] }): Promise<ActionResult<{ id: string }>>;
export async function listMyBracketsAction(): Promise<ActionResult<Array<{ id: string; name: string; format: BracketFormat; entryCount: number; bestOf: BestOf; status: 'active' | 'complete'; currentRound: string; championName: string | null; createdAt: string }>>>;
export async function loadBracketAction(id: string): Promise<ActionResult<BracketPageData & { isOwner: boolean }>>;
export async function startBracketGameAction(matchId: string, mode: 'solo' | 'online'): Promise<ActionResult<{ gameId: string; code: string; firstSeat: 0 | 1; gameNumber: number; bestOf: BestOf; bracketId: string; entryAId: string; entryBId: string; deckAId: string; deckBId: string; deckAName: string; deckBName: string; format: BracketFormat }>>;
export async function recordBracketGameResultAction(input: { gameId: string; winnerEntryId: string; soulsA?: number; soulsB?: number }): Promise<ActionResult<{ series: SeriesState; matchId: string; decided: boolean; nextReadyMatch: { id: string; deckAName: string; deckBName: string } | null; nextRoundName: string | null; champion: boolean }>>;
// nextRoundName: the name of the round the decided match's winner advanced into (null when not decided or when the final was decided).
export async function recordManualResultAction(input: { matchId: string; winnerEntryId: string; soulsA?: number; soulsB?: number }): Promise<ActionResult<{ matchId: string; gameId: string }>>;
export async function abandonBracketGameAction(gameId: string): Promise<ActionResult<{ matchId: string }>>;
export async function resetMatchAction(matchId: string): Promise<ActionResult<null>>;
export async function deleteBracketAction(id: string): Promise<ActionResult<null>>;
```

- `app/brackets/lib/gameCode.ts`: `export function generateGameCode(random: () => number = Math.random): string` → six characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I).

- [ ] **Step 1: Write the failing code-generator test**

```ts
// app/brackets/lib/__tests__/gameCode.test.ts
import { describe, it, expect } from 'vitest';
import { generateGameCode } from '../gameCode';
describe('generateGameCode', () => {
  it('is six characters from the unambiguous alphabet', () => {
    const code = generateGameCode();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });
  it('is deterministic for a fixed random source', () => {
    expect(generateGameCode(() => 0)).toBe('AAAAAA');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/brackets/lib`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `gameCode.ts`, then `actions.ts`**

Patterns to follow: `requireHost` in `app/tracker/tournaments/actions.ts:40-53` (a user-scoped read proves ownership) → write `requireBracketOwner(supabase, bracketId)`; errors are returned, never thrown, except from the pure functions, which are caught and returned as `{ ok: false, error }`.

- `createBracketAction`: user required; `deckIds` 2..16, unique; load those decks with `select id, name, format, preview_card_1, preview_card_2, paragon, user_id, is_public` and keep only the user's own or `is_public`; every deck's `getFormatDef(format).family` must equal `format` else `{ ok: false, error: 'Every deck must be a <format> deck.' }`; insert the bracket (`size = sizeFor(n)`), insert entries with `seed` = index+1 (select back ids), run `buildBracket` with the real entry ids, insert matches, then `update champion_entry_id` if size happened to be … (never at creation; skip).
- `loadBracketAction`: three selects (bracket by id; entries; matches with `deck_bracket_games(*)` embedded) ordered by `round, position` / `game_number`; `isOwner = user?.id === bracket.owner_id`.
- `listMyBracketsAction`: brackets where `owner_id = user.id`, with `deck_bracket_entries(count)` and the matches+games needed for `currentRoundName`; `championName` from the champion entry; order `created_at desc`, limit 100.
- `startBracketGameAction`: owner; load match + games + both entries; `matchState` must be `'ready'` and `canPlayMatch` true; `firstEntryId = firstEntryForGame(games, match, Math.random() < 0.5 ? 'a' : 'b')`; `firstSeat = firstEntryId === entryAId ? 0 : 1`; insert the game row (`mode`, `code = generateGameCode()`, `game_number = series.nextGameNumber`, `first_entry_id`); return the bundle.
- `recordBracketGameResultAction`: owner (through the game → match → bracket); if the game already has `winner_entry_id`, return the current series state with `decided` etc. and change nothing; else `applyGameResult` and apply each `RowUpdate` in order (`game` → update `winner_entry_id`, `souls_a/b`, `finished_at = now()`; `match-winner` → update; `match-slot` → update `entry_a_id`/`entry_b_id`; `champion` → update bracket `champion_entry_id`, `status = 'complete'`, `completed_at`). `nextReadyMatch`: the first match (by round, position) whose `matchState` is `'ready'` after the updates, excluding the one just decided.
- `recordManualResultAction`: owner; insert a `manual` game with `game_number = series.nextGameNumber` and no winner, then reuse the same apply path as `recordBracketGameResultAction` in-process (factor `applyAndPersist(supabase, bracketId, gameId, winnerEntryId, souls)`).
- `abandonBracketGameAction`: owner; the game must have no winner; delete the row.
- `resetMatchAction`: owner; `resetMatchAllowed` else error `'Reset is not possible while the next match has results.'`; delete the match's games; apply `resetMatchUpdates` (map `''` → null); set bracket `status = 'active'` and `completed_at = null` when the champion was cleared.
- `deleteBracketAction`: owner; delete the bracket (cascades).

- [ ] **Step 4: Run the test and type-check**

Run: `npx vitest run app/brackets/lib && npx tsc --noEmit -p tsconfig.json`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add app/brackets/actions.ts app/brackets/lib
git commit -m "feat(brackets): server actions for create, play, record, reset, delete"
```

---

### Task 4: Family filter for the paged deck loaders

**Files:**
- Modify: `lib/api/cache.ts:98-120` (`deckFormatFilterFor`, `applyDeckFormatFilter`)
- Modify: `app/play/actions.ts` (`LoadUserDecksPagedParams`, `loadUserDecksPaged`)
- Modify: `app/decklist/actions.ts` (`LoadPublicDecksParams`, `loadPublicDecksAction`) — find the params type with `grep -n "LoadPublicDecksParams" app/decklist/actions.ts`
- Test: `lib/api/__tests__/deckFormatFilter.test.ts` (create; check whether `lib/api/__tests__/` exists first and add to it)

**Interfaces:**
- Produces: `export function deckFamilyFilterFor(family: 'T1' | 'T2' | 'Paragon'): DeckFormatFilter` in `lib/api/cache.ts`; both loaders accept `family?: 'T1' | 'T2' | 'Paragon'` and, when present, apply `deckFamilyFilterFor(family)` instead of the `format` filter.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { deckFamilyFilterFor } from '../cache';
describe('deckFamilyFilterFor', () => {
  it('T1 covers Limited, Unlimited, Teams and null', () =>
    expect(deckFamilyFilterFor('T1')).toEqual({ kind: 'or', clause: 'format.is.null,format.in.(Type 1,Limited,Unlimited,Classic,Teams)' }));
  it('T2 and Paragon match deckFormatFilterFor', () => {
    expect(deckFamilyFilterFor('T2')).toEqual({ kind: 'in', values: ['Type 2', 'T2'] });
    expect(deckFamilyFilterFor('Paragon')).toEqual({ kind: 'eq', value: 'Paragon' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run lib/api` → FAIL.

- [ ] **Step 3: Implement** `deckFamilyFilterFor` next to `deckFormatFilterFor`; thread `family` through both loaders (`family` wins over `format` when both are given).

- [ ] **Step 4: Run the test and `tsc`** → PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/api/cache.ts lib/api/__tests__ app/play/actions.ts app/decklist/actions.ts
git commit -m "feat(decks): family filter for the paged deck loaders"
```

---

### Task 5: Extract the deck picker content with a multi-select mode

**Files:**
- Create: `app/play/components/DeckPickerContent.tsx` (move `DeckPickerContent`, `SkeletonCard`, `PickerTab`, the loaders' state, out of `DeckPickerModal.tsx`)
- Modify: `app/play/components/DeckPickerModal.tsx` (imports the content; behaviour unchanged)
- Modify: `app/play/components/DeckPickerCard.tsx` (add `badge?: React.ReactNode` rendered top-right over the image header)
- Test: existing `app/play/components/__tests__` must still pass; no new DOM tests (node-only vitest)

**Interfaces:**
- Produces:

```ts
export type PickerTab = 'starter' | 'my' | 'community';
export interface DeckPickerContentProps {
  onSelect: (deck: DeckOption) => void;          // single mode: pick; multi mode: toggle
  selectedDeckId?: string | null;                // single mode highlight (existing)
  selectedDeckIds?: ReadonlySet<string>;         // multi mode: tiles in the set render selected with a check badge
  lockedFamily?: 'T1' | 'T2' | 'Paragon';        // hides the format selects and passes `family` to the loaders
  initialTab?: PickerTab;
}
export function DeckPickerContent(props: DeckPickerContentProps): JSX.Element;
```

- [ ] **Step 1: Move the component** into its own file with the props above. In multi mode a tile's `selected` is `selectedDeckIds.has(deck.id)` and its `badge` is a check icon (lucide `Check`) in a `bg-primary text-primary-foreground rounded-full` 20px circle. With `lockedFamily`, omit the two format `<select>`s and call `loadUserDecksPaged({ …, family })` / `loadPublicDecksAction({ …, family })`.

- [ ] **Step 2: Keep `DeckPickerModal` identical** from the outside (`DeckPickerModalProps` unchanged); it renders `<DeckPickerContent selectedDeckId onSelect initialTab />`.

- [ ] **Step 3: Verify** — `npx tsc --noEmit -p tsconfig.json && npx vitest run app/play` → clean and passing.

- [ ] **Step 4: Commit**

```bash
git add app/play/components/DeckPickerContent.tsx app/play/components/DeckPickerModal.tsx app/play/components/DeckPickerCard.tsx
git commit -m "refactor(play): extract DeckPickerContent with a multi-select mode and a locked family"
```

---

### Task 6: Bracket view components

**Files:**
- Create: `app/brackets/components/MatchBlock.tsx`, `app/brackets/components/BracketView.tsx`, `app/brackets/components/ChampionPanel.tsx`, `app/brackets/components/DeckThumb.tsx`
- Create: `app/brackets/lib/view.ts` + test `app/brackets/lib/__tests__/view.test.ts`

**Interfaces:**
- Consumes: Task 1 (`roundNames`, `matchLabel`, `matchState`, `seriesState`, `nextSlot`), `getCardImageUrlOrNull` from `app/shared/utils/cardImageUrl.ts`.
- Produces:

```ts
// app/brackets/lib/view.ts (pure)
export interface MatchView { match: BracketMatch; label: string; state: MatchState; series: SeriesState;
  a: BracketEntry | null; b: BracketEntry | null; placeholderA: string; placeholderB: string; // 'Winner of QF2' | 'Bye' | ''
  firstToPlayName: string | null;  // spec: shown for game 2+ when ready
  canPlay: boolean }
export function buildMatchViews(data: { bracket: Bracket; entries: BracketEntry[]; matches: BracketMatch[]; games: BracketGame[] }): MatchView[][]; // [round-1][position]
export function championPath(data: …, championEntryId: string): string[]; // ['Beat Gold Temple 2–0', …], byes excluded
export function firstActionableMatchId(views: MatchView[][]): string | null; // first 'ready' or 'live'

// components
export function DeckThumb({ entry, size = 40, dimmed }: { entry: BracketEntry | null; size?: number; dimmed?: boolean });
export function MatchBlock(props: { view: MatchView; isOwner: boolean; highlight?: 'write-in' | null;
  onPlay?: (matchId: string) => void; onPlayOnline?: (matchId: string) => void; onResume?: (game: BracketGame) => void;
  onRecord?: (matchId: string) => void; onAbandon?: (game: BracketGame) => void; onReset?: (matchId: string) => void;
  canReset?: boolean; onRemoveEntry?: (entryId: string) => void /* creation page only */ });
export function BracketView(props: { views: MatchView[][]; size: BracketSize; isOwner: boolean; decidedMatchId?: string | null; …same callbacks… });
export function ChampionPanel({ entry, path, animate }: { entry: BracketEntry; path: string[]; animate: boolean });
```

- [ ] **Step 1: Write the failing view tests**

```ts
import { describe, it, expect } from 'vitest';
import { buildMatchViews, championPath, firstActionableMatchId } from '../view';
// build a 4-deck Bo3 bracket via lib/bracket buildBracket; record games with the test helpers from Task 1 (copy the small factories)
describe('buildMatchViews', () => {
  it('fills placeholders and labels', () => {
    const data = fourDeckBo3();                       // entries e1..e4, matches from buildBracket, no games
    const views = buildMatchViews(data);
    expect(views[0][0].label).toBe('SF1');
    expect(views[1][0].placeholderA).toBe('Winner of SF1');
    expect(views[1][0].placeholderB).toBe('Winner of SF2');
    expect(views[0][0].state).toBe('ready');
    expect(views[0][0].firstToPlayName).toBeNull();
  });
  it('names the first player from game 2 on', () => {
    // slotOrder(4) seats e1 v e3 in SF1 and e2 v e4 in SF2; e3 lost game 1, so e3 goes first
    const data = fourDeckBo3([game(1, 'e1', { matchId: sf1Id })]);
    expect(buildMatchViews(data)[0][0].firstToPlayName).toBe('Deck 3');
  });
  it('marks a bye block', () => {
    const views = buildMatchViews(threeDeck());
    expect(views[0][1].state).toBe('bye');
    expect(views[0][1].placeholderB).toBe('Bye');
  });
});
describe('championPath', () => {
  it('lists one line per won round, byes excluded', () => {
    // 3-deck Bo3: e2 has the bye (match 1); e1 beats e3 in SF1; e2 beats e1 2–0 in the final
    expect(championPath(threeDeckWon(), 'e2')).toEqual(['Beat Deck 1 2–0']);
  });
});
describe('firstActionableMatchId', () => {
  it('prefers live, then ready, in round order', () => {
    const views = buildMatchViews(fourDeckBo3([game(1, null, { matchId: sf2Id })]));
    expect(firstActionableMatchId(views)).toBe(sf2Id);
  });
});
```

`fourDeckBo3(games?)`, `threeDeck()`, `threeDeckWon()` are small fixtures built in the test file from Task 1's `buildBracket` and the `entry`/`game` factories (copy them in); `sf1Id`/`sf2Id` are the ids of round-1 positions 0 and 1.

- [ ] **Step 2: Run to verify failure** — `npx vitest run app/brackets/lib` → FAIL.

- [ ] **Step 3: Implement `view.ts`, then the components**

`MatchBlock` per the spec's "Match block": hairline box (`rounded-md border border-border/60 bg-card`), label row (`text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground` with the label and, when relevant, "2–1" or "Game 2 live"), two 44px rows separated by `divide-y divide-border/60`, each row `DeckThumb` + name (`truncate`) + wins (`tabular-nums`). `done`: winner row `text-primary` with a `border-l-2 border-primary` edge; loser row `text-muted-foreground` and thumb `opacity-60`. Owner controls under the rows: primary `Button` "Play game N" / "Play" (Bo1) (hidden when `!canPlay`, replaced by "Deck no longer available" in muted text), overflow (`DropdownMenu` from `components/ui/dropdown-menu.tsx`) with "Play online with a friend" (only when `onPlayOnline` is given), "Record result by hand"; `live`: "Resume game N" + overflow "Record result by hand", "Abandon this game"; `done` + `canReset`: overflow "Reset match". `highlight === 'write-in'` adds the transition classes used by the write-in (Task 8).

`BracketView`: `md:` grid of round columns with small-caps headers and a last "Champion" column; connector lines as `::before/::after` borders on a wrapper per match (vertical centering via `justify-around` per column; each column's blocks spaced so a block in round r+1 centers on its two feeders: use `flex-1` wrappers with `justify-center`). Below `md`: one column, every round under a small-caps header with a hairline, `id={"match-" + match.id}` on each block for scrolling.

`ChampionPanel`: `bg-card rounded-md p-6`, two preview images (`h-40`), "Champion" small-caps label, deck name `text-2xl font-semibold tracking-tight`, path lines `text-sm text-muted-foreground`; `animate` applies `motion.div` (framer-motion is a dependency; `grep framer-motion package.json`) initial `{ opacity: 0, y: 6 }` → `{ opacity: 1, y: 0 }`, 400 ms.

- [ ] **Step 4: Run tests and `tsc`** → PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/brackets/components app/brackets/lib/view.ts app/brackets/lib/__tests__/view.test.ts
git commit -m "feat(brackets): match block, bracket view, champion panel"
```

---

### Task 7: `/brackets/new`

**Files:**
- Create: `app/brackets/new/page.tsx` (server: auth gate like `app/play/page.tsx:12-40`, reads `?decks=`, renders the client), `app/brackets/new/NewBracketClient.tsx`
- Create: `app/brackets/lib/draft.ts` + test `app/brackets/lib/__tests__/draft.test.ts`

**Interfaces:**
- Consumes: Task 3 `createBracketAction`, Task 5 `DeckPickerContent`, Task 6 `MatchBlock`/`buildMatchViews`, Task 1 `sizeFor`/`buildBracket`.
- Produces: `app/brackets/lib/draft.ts`:

```ts
export interface DraftDeck { id: string; name: string; format: string | null; preview_card_1: string | null; preview_card_2: string | null; paragon: string | null }
export function toggleDraftDeck(picked: DraftDeck[], deck: DraftDeck, max = 16): DraftDeck[];  // add if absent (ignore past max), remove if present
export function shuffleDraft(picked: DraftDeck[], random: () => number): DraftDeck[];
export function pruneForFamily(picked: DraftDeck[], family: BracketFormat): { kept: DraftDeck[]; dropped: DraftDeck[] };
export function draftSummary(count: number): string; // '6 decks · 8 slots · 2 byes' | '4 decks · no byes' | '1 deck · pick at least 2'
export function draftEntries(picked: DraftDeck[]): BracketEntry[]; // ids 'draft-<deckId>', seeds by order — feeds buildBracket for the round-1 preview
```

- [ ] **Step 1: Write the failing draft tests**

```ts
const d = (id: string, format: string | null = 'Limited'): DraftDeck => ({ id, name: id, format, preview_card_1: null, preview_card_2: null, paragon: null });
describe('draft', () => {
  it('toggleDraftDeck adds, removes, and caps at 16', () => {
    expect(toggleDraftDeck([], d('a'))).toEqual([d('a')]);
    expect(toggleDraftDeck([d('a'), d('b')], d('a'))).toEqual([d('b')]);
    const sixteen = Array.from({ length: 16 }, (_, i) => d(`x${i}`));
    expect(toggleDraftDeck(sixteen, d('y'))).toHaveLength(16);
  });
  it('pruneForFamily drops decks of another family', () => {
    const r = pruneForFamily([d('a', 'Limited'), d('b', 'Unlimited'), d('c', 'Type 2')], 'T1');
    expect(r.kept.map(x => x.id)).toEqual(['a', 'b']);
    expect(r.dropped.map(x => x.id)).toEqual(['c']);
  });
  it('draftSummary', () => {
    expect(draftSummary(6)).toBe('6 decks · 8 slots · 2 byes');
    expect(draftSummary(4)).toBe('4 decks · no byes');
    expect(draftSummary(1)).toBe('1 deck · pick at least 2');
  });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `draft.ts`, then the page**

`page.tsx`: signed-out → the same sign-in CTA block as `/play` with `redirectTo=/brackets/new`; otherwise, for `?decks=`, load those decks (own or public) in that order and pass them as `initialDecks`.

`NewBracketClient`: state `{ name, format, bestOf, picked: DraftDeck[] }`. Default name `` `Deck Bracket · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` ``. Settings row: name `Input`; two segmented controls built from the chip style in the design system (`rounded-full border border-border text-sm min-h-11`, active `bg-foreground text-background`). Changing format runs `pruneForFamily` and shows the inline note "Removed <n> deck(s) that are not <format> decks." for 5 s.

Desktop (`hidden md:block`): left column = round 1 of `buildBracket(draftEntries(picked))` rendered with `MatchBlock` (`isOwner={false}`, `onRemoveEntry` makes each filled row a remove button; placeholder copy: 'Tap a deck' while `picked.length < size/2 + 1`… use the spec rule: "Bye" once filled past half the current size, else "Tap a deck"); a **Shuffle** `Button variant="outline"` (disabled under two decks); right column = `DeckPickerContent` with `selectedDeckIds`, `lockedFamily={format}`, `onSelect={toggle}`.

Phone (`md:hidden`): sticky bar (`sticky top-0 z-20 bg-background/95 border-b border-border/60`) with `draftSummary`, a horizontal scroll of 36px `DeckThumb`s each a remove button (`aria-label="Remove <name>"`), and the **Start bracket** button; the picker content below.

**Start bracket** (both layouts): disabled under two decks; calls `createBracketAction({ name, format, bestOf, deckIds })`; on `ok` → `router.push('/brackets/' + id)`; on error → inline `text-destructive` line.

- [ ] **Step 4: Run tests and `tsc`** → PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add app/brackets/new app/brackets/lib/draft.ts app/brackets/lib/__tests__/draft.test.ts
git commit -m "feat(brackets): /brackets/new with the bracket-as-you-build-it picker"
```

---

### Task 8: `/brackets/[id]` page

**Files:**
- Create: `app/brackets/[id]/page.tsx` (server; `force-dynamic`; `notFound()` when missing; `generateMetadata` title = bracket name), `app/brackets/[id]/BracketClient.tsx`, `app/brackets/[id]/RecordResultDialog.tsx`
- Create: `app/brackets/lib/gameParams.ts` (shared with the play client in Task 12; see Interfaces)
- Create: `app/brackets/page.tsx` (`redirect('/tracker/tournaments')`)
- Test: `app/brackets/lib/__tests__/gameParams.test.ts`

**Interfaces:**
- Consumes: Task 3 actions, Task 6 components.
- Produces `app/brackets/lib/gameParams.ts` (client-safe, no server imports):

```ts
export const SESSION_KEY_PREFIX = 'stdb_game_params_';   // same constant the play client uses
export interface BracketGameParams { gameId: string; bracketId: string; matchId: string; gameNumber: number; bestOf: BestOf;
  mode: 'solo' | 'online'; entryAId: string; entryBId: string; deckAName: string; deckBName: string; returnTo: string }
export function writeSoloGameParams(code: string, p: { deckAId: string; deckBId: string; displayName: string; supabaseUserId: string; format: string; firstSeat: 0 | 1; bracket: BracketGameParams }): void;
export function writeHostGameParams(code: string, p: { deckAId: string; deckAName: string; displayName: string; supabaseUserId: string; format: string; bracket: BracketGameParams }): void;   // role 'create', isPublic false, lobbyMessage ''
export function writeJoinGameParams(code: string, p: { deckBId: string; deckBName: string; displayName: string; supabaseUserId: string; format: string; bracket: BracketGameParams }): void;   // role 'join'
export function stdbFormatFor(family: BracketFormat): string;   // 'T1' → 'Type 1', 'T2' → 'Type 2', 'Paragon' → 'Paragon'
export const DECIDED_KEY = 'bracket_decided_match';            // sessionStorage key used by the overlay's "Next match"
```

- [ ] **Step 1: Write the failing params test**

```ts
describe('gameParams', () => {
  it('writes the solo params under the play client key', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { setItem: (k: string, v: string) => store.set(k, v) });
    writeSoloGameParams('ABC234', { deckAId: 'a', deckBId: 'b', displayName: 'Tim', supabaseUserId: 'u', format: 'Type 1', firstSeat: 1, bracket: bracketParams });
    const parsed = JSON.parse(store.get('stdb_game_params_ABC234')!);
    expect(parsed).toMatchObject({ role: 'solo', deckId: 'a', soloDeckBId: 'b', firstSeat: 1, format: 'Type 1' });
    expect(parsed.bracket.matchId).toBe(bracketParams.matchId);
  });
  it('maps families to the play format strings', () => { expect(stdbFormatFor('T1')).toBe('Type 1'); expect(stdbFormatFor('T2')).toBe('Type 2'); });
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `gameParams.ts`, then the page**

`page.tsx` loads with `loadBracketAction(id)`; also fetches the viewer's `profiles.username` (needed as `displayName` for the game params) and passes `{ data, isOwner, viewer: { id, displayName } | null, searchParams: { decided, record } }` to `BracketClient`.

`BracketClient`:
- Header per spec: H1 `font-cinzel text-2xl font-bold tracking-tight sm:text-3xl`, meta line "T1 · 6 decks · Best of 3 · <currentRoundName>", **Share** (`navigator.clipboard.writeText(location.href)` + the existing toast primitive — use `ToastNotification` from `components/ui/toast-notification` or the one `/decklist` pages use; pick one), owner overflow with Delete (confirm `Dialog`, then `deleteBracketAction` → `router.push('/tracker/tournaments')`).
- `views = buildMatchViews(data)`; `ChampionPanel` when `bracket.status === 'complete'` (above the bracket on phones, in the Champion column on desktop; `BracketView` takes a `champion` slot).
- Callbacks: `onPlay` → `startBracketGameAction(matchId, 'solo')` → `writeSoloGameParams` → `router.push('/play/' + code)`; `onPlayOnline` (wired in Task 15; until then omit the prop so the menu item is hidden); `onResume` → `writeSoloGameParams` again from the game row (`mode` from the row) → push; `onRecord` → open `RecordResultDialog`; `onAbandon` → confirm → `abandonBracketGameAction` → `router.refresh()`; `onReset` → confirm dialog with copy "This clears the <label> result and removes <winner> from <next label>." → `resetMatchAction` → refresh.
- Phone auto-scroll: on mount, `document.getElementById('match-' + firstActionableMatchId(views))?.scrollIntoView({ block: 'center' })` when `window.innerWidth < 768`.
- The write-in: `decidedMatchId = searchParams.decided ?? sessionStorage.getItem(DECIDED_KEY)`; pass to `BracketView`; `MatchBlock` with `highlight='write-in'` starts with the winner row un-accented and the fed slot empty, then on the next frame applies the accent and fades the fed slot's `DeckThumb` + name in (`transition-[color,opacity,border-color] duration-500 [transition-timing-function:var(--ease-out-quart)]`); the connector of that match gets `border-primary` with the same transition; `ChampionPanel animate` when the decided match is the final. Afterwards `router.replace(pathname)` and `sessionStorage.removeItem(DECIDED_KEY)`.
- `?record=<gameId>` opens `RecordResultDialog` for that game's match on mount.

`RecordResultDialog` (`Dialog size="sm"`): title "Record result by hand", "<label> · Game N", two `min-h-11` buttons with `DeckThumb` + name (selected = `border-primary`), two optional number inputs "Souls" (0–7), **Save** → `recordManualResultAction` → close → `router.refresh()` and set `decidedMatchId` locally so the write-in plays.

- [ ] **Step 4: Run tests and `tsc`** → PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add "app/brackets/[id]" app/brackets/page.tsx app/brackets/lib/gameParams.ts app/brackets/lib/__tests__/gameParams.test.ts
git commit -m "feat(brackets): bracket page with owner controls, write-in, and manual results"
```

---

### Task 9: Entry points

**Files:**
- Modify: `app/tracker/tournaments/page.tsx:318-345` (buttons) and after the tournament groups (section)
- Create: `app/tracker/tournaments/MyBracketsSection.tsx`
- Modify: `app/decklist/my-decks/client.tsx:1009-1070` (selection bar)

- [ ] **Step 1: Tracker page** — add `<Button variant="outline" asChild><Link href="/brackets/new">New deck bracket</Link></Button>` between "Join a Tournament" and "Host a Tournament"; render `<MyBracketsSection />` after the tournament list (also when there are no tournaments).

- [ ] **Step 2: `MyBracketsSection`** — `"use client"`; on mount `listMyBracketsAction()`; small-caps header "Deck brackets" with a hairline; rows `divide-y divide-border/60`, each a `Link` to `/brackets/[id]`: name (`font-medium`), meta "T1 · 6 decks · Bo3", status (`currentRound` or "Champion: <name>"), date (`tabular-nums`, fixed-width column), and an overflow with Delete (confirm → `deleteBracketAction` → reload the list). Empty state: "Seat your own decks in a bracket and play every match yourself." + the button. Loading: three skeleton rows.

- [ ] **Step 3: My Decks bar** — next to "Move to", add a button "Start a bracket" (same classes as "Move to"), `disabled={selectedIds.length < 2 || selectedIds.length > 16}`, `onClick={() => router.push('/brackets/new?decks=' + selectedIds.join(','))}` (the file already uses `useRouter`; confirm with `grep -n useRouter app/decklist/my-decks/client.tsx`).

- [ ] **Step 4: `tsc`** → clean.

- [ ] **Step 5: Commit**

```bash
git add app/tracker/tournaments/page.tsx app/tracker/tournaments/MyBracketsSection.tsx app/decklist/my-decks/client.tsx
git commit -m "feat(brackets): entry points on My Tournaments and the My Decks selection bar"
```

---

## Phase 2: Solo mode in the SpacetimeDB module

### Task 10: `SoloGame`, hinted seat resolution, `create_solo_game`, swap, auto-swap

**Files:**
- Modify: `spacetimedb/src/schema.ts` (add `SoloGame` after `TurnStop`/the last table; register in `schema({...})`)
- Create: `spacetimedb/src/soloSeat.ts` (pure) + test `spacetimedb/__tests__/soloSeat.test.ts`
- Modify: `spacetimedb/src/index.ts`: `findPlayerBySender` (169-176), new reducers after `create_game` (~912), `performTurnFlip` (2849), `register_presence` (2140-2163)

**Interfaces:**
- Produces:

```ts
// spacetimedb/src/schema.ts
export const SoloGame = table({ name: 'solo_game', public: true }, { gameId: t.u64().primaryKey(), activeSeat: t.u64() });

// spacetimedb/src/soloSeat.ts
export type SeatHint = { cardId: bigint } | { seat: bigint } | { playerId: bigint } | undefined;
export interface SeatRow { id: bigint; seat: bigint }
export function pickSoloRow<R extends SeatRow>(rows: R[], hint: SeatHint, activeSeat: bigint, cardOwnerId: bigint | null): R | undefined;
// rows = the sender's Player rows in this game. One row → return it (hint ignored).
// Two rows: {playerId} → that row; {seat} → that seat; {cardId} → the row whose id === cardOwnerId, else activeSeat; none → activeSeat.

// spacetimedb/src/index.ts
function findPlayerBySender(ctx: any, gameId: bigint, hint?: SeatHint): PlayerRow;  // throws SenderError('Player not found in this game')
function soloGameRow(ctx: any, gameId: bigint): SoloGameRow | undefined;
export const create_solo_game = spacetimedb.reducer({ code, format, supabaseUserId, displayNameA, deckIdA, deckDataA, paragonA, displayNameB, deckIdB, deckDataB, paragonB, firstSeat: t.u64() }, …);
export const solo_swap_seat = spacetimedb.reducer({ gameId: t.u64() }, …);
```

- [ ] **Step 1: Write the failing `pickSoloRow` test**

```ts
// spacetimedb/__tests__/soloSeat.test.ts
import { describe, it, expect } from 'vitest';
import { pickSoloRow } from '../src/soloSeat';
const s0 = { id: 10n, seat: 0n }, s1 = { id: 11n, seat: 1n };
describe('pickSoloRow', () => {
  it('ignores every hint when the sender holds one row (two-human game)', () => {
    expect(pickSoloRow([s1], { seat: 0n }, 0n, null)).toBe(s1);
    expect(pickSoloRow([s1], { cardId: 5n }, 0n, 10n)).toBe(s1);
  });
  it('uses the seat in hand with no hint', () => expect(pickSoloRow([s0, s1], undefined, 1n, null)).toBe(s1));
  it('resolves seat, playerId and card-owner hints', () => {
    expect(pickSoloRow([s0, s1], { seat: 0n }, 1n, null)).toBe(s0);
    expect(pickSoloRow([s0, s1], { playerId: 11n }, 0n, null)).toBe(s1);
    expect(pickSoloRow([s0, s1], { cardId: 5n }, 1n, 10n)).toBe(s0);
  });
  it('falls back to the seat in hand for a shared card', () => expect(pickSoloRow([s0, s1], { cardId: 5n }, 1n, 0n)).toBe(s1));
  it('returns undefined with no rows', () => expect(pickSoloRow([], undefined, 0n, null)).toBeUndefined());
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run spacetimedb/__tests__/soloSeat.test.ts` → FAIL.

- [ ] **Step 3: Implement**

- `soloSeat.ts` per the interface (no spacetimedb imports; it must stay publishable and testable like `battlePlacement.ts`).
- `findPlayerBySender(ctx, gameId, hint?)`: collect the sender's rows for the game; `solo = soloGameRow(ctx, gameId)`; `cardOwnerId` = `ctx.db.CardInstance.id.find(hint.cardId)?.ownerId ?? null` when the hint is a card; `pickSoloRow(rows, solo ? hint : undefined, solo?.activeSeat ?? 0n, cardOwnerId)`; throw the existing error when undefined.
- `create_solo_game`: reject a code in use (as `createGameCore`); validate `firstSeat` is `0n`/`1n`; insert the `Game` row exactly as `createGameCore` does but with `status: 'playing'`, `currentTurn: firstSeat`, `turnNumber: 1n`, `pregameReady0/1: true`, `isPublic: false`, `createdByName: displayNameA`; insert two `Player` rows (same `identity: ctx.sender`, same `supabaseUserId`, seats `0n`/`1n`, the A/B names, decks, paragons, `pendingDeckData`); for both, `insertCardsShuffleDraw` then clear `pendingDeckData` (as `joinGameCore` lines 858-872); Paragon → `initializeSoulDeck`; insert `SoloGame { gameId, activeSeat: firstSeat }`; log `GAME_CREATED` and `PLAYER_JOINED`; finally call `finishPregame(ctx, game.id)` (it tolerates no `PregameState` row: check `ctx.db.PregameState.gameId.delete` on a missing key does not throw; if it does, guard with a `find`). Result must match a normal game right after `finishPregame`: `pregamePhase: ''`, `playingStartedAtMicros` set, `GAME_STARTED` logged.
- `solo_swap_seat`: require `soloGameRow`; require the sender to hold both rows; `update({ ...row, activeSeat: row.activeSeat === 0n ? 1n : 0n })`.
- `performTurnFlip`: after the `Game` update, if `soloGameRow` exists, `update({ ...solo, activeSeat: nextSeat })`.
- `register_presence`: replace the early `return` so every matching row is revived (remove `return;` and apply the `disconnectTimeoutFired` reset once after the loop).

- [ ] **Step 4: Run the test, then build the module locally**

Run: `npx vitest run spacetimedb/__tests__/soloSeat.test.ts` → PASS.
Run: `cd /Users/timestes/projects/rtt-deck-bracket/spacetimedb && npx tsc --noEmit -p tsconfig.json` → clean.

- [ ] **Step 5: Publish to the dev module and regenerate bindings**

Use the `spacetimedb-deploy` skill (dev module, no `--clear`). Confirm `module_bindings` now export `SoloGame` and `createSoloGame` / `soloSwapSeat` reducers: `grep -rn "soloSwapSeat\|SoloGame" app/play/module_bindings | head` (find the bindings dir with `grep -rn "module_bindings" app/play/hooks/useGameState.ts | head -1`).

- [ ] **Step 6: Commit**

```bash
git add spacetimedb/src/schema.ts spacetimedb/src/index.ts spacetimedb/src/soloSeat.ts spacetimedb/__tests__/soloSeat.test.ts <bindings dir>
git commit -m "feat(stdb): solo games — SoloGame marker, hinted seat resolution, create_solo_game, swap, auto-swap on turn flip"
```

---

### Task 11: Hinted gates, consent auto-approve, presence audit

**Files:**
- Modify: `spacetimedb/src/index.ts` at the sites below.

**Interfaces:**
- Consumes: Task 10 `findPlayerBySender(ctx, gameId, hint)`, `soloGameRow`.
- Produces: no new reducers. Behaviour: in a solo game the human can block, enhance, win, choose the soul and end the turn without a swap; consent requests auto-approve except `keep_one_shuffle_draw` and `three_nails_reset`; no TIMEOUT/claim path arms.

- [ ] **Step 1: Pass hints at every gated site** (grep each; line numbers are from the current file):

| Site | Change |
|---|---|
| `enter_battle` 3356 | `findPlayerBySender(ctx, gameId, { cardId: cardInstanceId })` |
| `surrender_lost_soul` 6121 | `{ cardId: cardInstanceId }` |
| `rescue_lost_soul` 6174 | find the card first; `{ seat: ownerSeat === 0n ? 1n : 0n }` where `ownerSeat` is the owner's seat (shared soul: no hint) |
| `set_phase` 2888, `end_turn` 2926, `end_battle` 3229, `resolve_battle` 3509, `release_turn_stop` 2703 | read `game` first; `{ seat: game.currentTurn }` |
| `surrender_soul` 3554 | `{ seat }` = defender (T1) or attacker (other) from `game.battleAttackerSeat` |
| `approve_zone_search` 8631, `deny_zone_search` 8659 | find `req` first; `{ playerId: req.targetPlayerId }` |
| `complete_zone_search` 8683, `move_opponent_card` 8771, `shuffle_opponent_deck` 8886, `random_opponent_hand_to_zone` 6759, `opponent_shuffle_and_draw` 6866, `discard_reserve_characters_execute` 7134 | `{ playerId: req.requesterId }` |
| `opponent_keep_one_shuffle_draw` 6961, `three_nails_reset_execute` 6997 | whichever seat the reducer's existing check requires (`req.targetPlayerId` or `req.requesterId`), as a hint |

Then grep for any remaining `throw new SenderError('Not your turn')`, `card.ownerId !== player.id`, `!== player.id` guards in reducers not listed and decide per the rule "act as the seat the action belongs to"; list what you changed in the commit body.

- [ ] **Step 2: Consent auto-approve** — in `request_zone_search` and `request_opponent_action`, when `soloGameRow(ctx, gameId)` exists and `action` is not `'keep_one_shuffle_draw'` or `'three_nails_reset'`, insert with `status: 'approved'` (keep the log line). For `zone === 'hand-reveal'`, `'action-priority'`, `'initiative'` in solo, also insert approved (the client hides those buttons; harmless).

- [ ] **Step 3: Presence and timeouts audit** — `handle_disconnect_timeout`: return early for solo games (both rows are the one human; a refresh revives them). `claim_timeout_victory`: throw `SenderError('Not available in a solo game')` when solo. `cleanup_stale_games`: unchanged (the spec accepts the 30-minute idle rule). `leave_game`, `send_chat`, `update_lobby_message`, `set_game_public`: confirm they tolerate two rows for one identity (they iterate or use `createdBy`); fix only if they throw. `join_game` on a solo game's code must fail with the ordinary 'No waiting game found with that code' (it will, since the game is never `'waiting'`); `join_as_spectator` may succeed (spectating a solo game is harmless and the spec lists it as a non-goal, not a prohibition).

- [ ] **Step 4: Build, publish dev, regenerate bindings**

`cd spacetimedb && npx tsc --noEmit -p tsconfig.json` → clean; `spacetimedb-deploy` skill (dev). `npx vitest run spacetimedb` → PASS.

- [ ] **Step 5: Commit**

```bash
git add spacetimedb/src/index.ts <bindings dir>
git commit -m "feat(stdb): solo games act as the seat each action belongs to; consent auto-approves; no timeout claims"
```

---

## Phase 3: The play client

### Task 12: `useGameState` learns solo

**Files:**
- Modify: `app/play/hooks/useGameState.ts:252-290` (subscriptions), `320-334` (myPlayer/opponentPlayer), `353` (isMyTurn), `478-486` (requests), the `GameState` interface, the callbacks block.

**Interfaces:**
- Produces on `GameState`: `isSolo: boolean`, `activeSeat: 0 | 1 | null`, `swapSeat: () => void`. In solo: `myPlayer` = seat `activeSeat`, `opponentPlayer` = the other; `isMyTurn` = true; `incomingSearchRequest` = first pending request whose target is either seat; `approvedSearchRequest` = first approved request whose requester is either seat.

- [ ] **Step 1: Subscribe** — `const [soloRows] = useTable(tables.SoloGame.where(r => r.gameId.eq(gameId)))`; `const soloRow = soloRows[0] ?? null`; `isSolo = soloRow !== null`; `activeSeat = soloRow ? Number(soloRow.activeSeat) as 0 | 1 : null`.

- [ ] **Step 2: Seat selection** — when `isSolo`, `myPlayer = gamePlayers.find(p => p.seat === BigInt(activeSeat))`, `opponentPlayer = gamePlayers.find(p => p.seat !== BigInt(activeSeat))`; otherwise unchanged. Add `isSolo` to the `opponentConnectionStatus` memo: solo → `'connected'`.

- [ ] **Step 3: `isMyTurn`, requests, callback** — `isMyTurn = isSolo ? true : <existing>`; the two request memos accept either seat's id in solo (`const mine = new Set(isSolo ? gamePlayers.map(p => p.id) : [myPlayer?.id])`); `swapSeat = useCallback(() => conn?.reducers.soloSwapSeat({ gameId }), [conn, gameId])`.

- [ ] **Step 4: `tsc` and the existing hook tests** — `npx tsc --noEmit -p tsconfig.json && npx vitest run app/play` → clean, PASS.

- [ ] **Step 5: Commit**

```bash
git add app/play/hooks/useGameState.ts
git commit -m "feat(play): useGameState derives the seat in hand from SoloGame"
```

---

### Task 13: Solo create path and recovery screen in the play client

**Files:**
- Modify: `app/play/[code]/client.tsx`: `GameParams` (63-74), the deck-load effect (315-349), the create/join effect (756-958), the lifecycle sync (985-1005), the loading-screen branch (1253)
- Create: `app/play/lib/bracketGameParams.ts` (re-exports the types from `app/brackets/lib/gameParams.ts`; the play client imports from here to keep the dependency direction visible)
- Create: `app/play/components/BracketRecoveryScreen.tsx`
- Create: `app/play/lib/bracketResult.ts` + test `app/play/lib/__tests__/bracketResult.test.ts`

**Interfaces:**
- Consumes: Task 8 `BracketGameParams`, Task 3 `abandonBracketGameAction`/`startBracketGameAction`, Task 12 `GameState`.
- Produces:

```ts
// GameParams gains
role: 'create' | 'join' | 'solo';
soloDeckBId?: string; firstSeat?: 0 | 1; bracket?: BracketGameParams;

// app/play/lib/bracketResult.ts (pure)
export type EndKind = 'win' | 'resign' | 'timeout' | 'none';
export function resolveWinnerSeat(actions: Array<{ actionType: string; playerId: bigint }>, players: Array<{ id: bigint; seat: bigint }>): { kind: EndKind; winnerSeat: 0 | 1 | null };
// WIN → that player's seat; RESIGN → the other seat; TIMEOUT → that player's seat (the claimer); none → null. Scans from the end.
```

- [ ] **Step 1: Write the failing result test**

```ts
const players = [{ id: 10n, seat: 0n }, { id: 11n, seat: 1n }];
describe('resolveWinnerSeat', () => {
  it('WIN names the winner', () => expect(resolveWinnerSeat([{ actionType: 'WIN', playerId: 11n }], players)).toEqual({ kind: 'win', winnerSeat: 1 }));
  it('RESIGN names the loser', () => expect(resolveWinnerSeat([{ actionType: 'RESIGN', playerId: 11n }], players)).toEqual({ kind: 'resign', winnerSeat: 0 }));
  it('TIMEOUT names the claimer', () => expect(resolveWinnerSeat([{ actionType: 'TIMEOUT', playerId: 10n }], players)).toEqual({ kind: 'timeout', winnerSeat: 0 }));
  it('no ending action → none', () => expect(resolveWinnerSeat([{ actionType: 'MOVE', playerId: 10n }], players)).toEqual({ kind: 'none', winnerSeat: null }));
  it('uses the last ending action', () => expect(resolveWinnerSeat([{ actionType: 'WIN', playerId: 10n }, { actionType: 'RESIGN', playerId: 10n }], players).winnerSeat).toBe(1));
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.

- [ ] **Step 3: Implement `bracketResult.ts`, then the client changes**

- Deck-load effect: when `role === 'solo'`, load both decks (`Promise.all([loadDeckForGame(deckId), loadDeckForGame(soloDeckBId)])`) into `deckData` (A) and a new `deckDataB` state.
- Create/join effect: a `role === 'solo'` branch before the Forge branch: wait for `deckDataB`; reconnect check as today (`alreadyJoined`); then `conn.reducers.createSoloGame({ code, format, supabaseUserId, displayNameA: bracket.deckAName, deckIdA: deckId, deckDataA: deckData, paragonA: gameParams.paragon ?? '', displayNameB: bracket.deckBName, deckIdB: soloDeckBId, deckDataB, paragonB: '', firstSeat: BigInt(firstSeat) })` with `.catch` → error state; `setLifecycle('creating')`. (Paragon decks carry their paragon in the deck row; load it from `loadDeckForGame`'s `deck` result — extend `LoadDeckResult.deck` with `paragon` if missing.)
- Lifecycle sync: unchanged (status `'playing'` → `'playing'`).
- Recovery: in the finished branch and the discovery effect, when `gameParams?.bracket` exists and (a) `game.status === 'finished'` and `resolveWinnerSeat(...).kind === 'none'`, or (b) `role === 'solo'` and the game exists but `alreadyJoined` is false → render `BracketRecoveryScreen` instead of the table/overlay. The screen: a centered panel with the heading from the spec ("This game ended without a result" / "This game was started on another device"), one line of explanation, **Start game N over** (`abandonBracketGameAction(gameId)` then `startBracketGameAction(matchId, mode)` then write params and `router.replace('/play/' + newCode)`), **Record result by hand** (`router.push(returnTo + '?record=' + gameId)`), **Back to bracket** (`router.push(returnTo)`).

- [ ] **Step 4: Run tests and `tsc`** → PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add "app/play/[code]/client.tsx" app/play/lib/bracketGameParams.ts app/play/lib/bracketResult.ts app/play/lib/__tests__/bracketResult.test.ts app/play/components/BracketRecoveryScreen.tsx
git commit -m "feat(play): solo create path and bracket recovery screen"
```

---

### Task 14: The solo table: reveal all, both sides yours, swap pill, hidden chrome

**Files:**
- Modify: `app/play/components/MultiplayerCanvas.tsx` (visibility helpers 347-401 and their call sites ~9420, ~9548, ~8826, ~9152, ~9166, ~9326; `canViewOppReserve` 1243-1249; `isCardFaceHiddenFromViewer` 1256-1278; band header status 6560-6580; consent UI 10540-10706; stop/hold/priority/initiative banners 10589-10665)
- Modify: `app/play/components/BattleResolutionUI.tsx:225-260` (`isChooser`, title/subtitle)
- Modify: `app/play/components/TurnIndicator.tsx` (props: `isSolo?: boolean`, `seatInHandName?: string`, `onSwapSeat?: () => void`; hide chat/pause/rematch/stops/claim/priority controls in solo; concede confirm copy)
- Modify: `app/shared/components/GameToolbar.tsx:130-170` (shortcut list entry for the swap key)
- Modify: `app/play/[code]/client.tsx` (pass the new props; keyboard handler for the swap key; hide `ChatPanel`/`PauseConsentToast` in solo)
- Create: `app/play/components/SeatSwapPill.tsx`

**Interfaces:**
- Consumes: Task 12 `gameState.isSolo`, `gameState.activeSeat`, `gameState.swapSeat`.
- Produces: `SeatSwapPill({ deckName, onSwap })` — a 44px pill (`rounded-full border border-border bg-card/95 px-3 text-sm`) with lucide `ArrowLeftRight` and the deck name; `isHandCardFaceVisible(card, viewerKind, owner, now, revealAll = false)`, `isFaceDownInPlayCardVisible(viewerKind, ownerId, share, revealAll = false)`.

- [ ] **Step 1: Visibility** — add the `revealAll` parameter (true short-circuits to visible) to the two helpers and thread `gameState.isSolo` into every call site; `canViewOppReserve = isSolo || <existing>`; `isCardFaceHiddenFromViewer` returns false when `isSolo`. The far hand (`OpponentHand`) renders faces through `isHandCardFaceVisible`, so no separate change; confirm its cards are draggable when visible (`isDraggable={!isSpectator}`).

- [ ] **Step 2: Both sides yours** — `BattleResolutionUI`: new prop `isSolo`; `isChooser = isSolo ? true : <existing>`; in solo the title is "Choose a Lost Soul to surrender" / "…to rescue" as today and the subtitle names the chooser deck ("Choose a soul for <chooser name>"). Band header (6560-6580): in solo, `statusText = 'Choose a soul for <chooser name>'`. End Turn / phase tabs already follow `isMyTurn` (true in solo).

- [ ] **Step 3: Swap pill and key** — render `SeatSwapPill` in `client.tsx` for solo games, positioned `fixed bottom-[calc(var(--hand-height,140px)+12px)] right-3 z-30` on phones and in the toolbar row on desktop (pick the spot that does not overlap the hand or the band; verify visually in Task 17). Key: `W` (confirm unused: `grep -n "'w'\|\"w\"\|KeyW" app/play app/shared | head`); add `{ label: 'Swap seat', shortcut: 'W' }` to the toolbar's shortcut list only when solo.

- [ ] **Step 4: Hide in solo** — `TurnIndicator`: when `isSolo`, do not render the stop toggles, hold banner, priority/initiative buttons, pause controls, rematch controls, disconnect countdown, claim-victory button, or the opponent connection dot; the concede confirm text becomes `Concede as ${seatInHandName}?`. `MultiplayerCanvas`: skip the consent-related context-menu items ("Ask to reveal hand", "Ask to reveal reserve", request priority/initiative) in solo; `BoardRequestBanner`s for stops/priority/initiative are not rendered in solo; `ConsentDialog` still renders for a pending request (only the two target-choice actions can be pending). `client.tsx`: no `ChatPanel`, no `PauseConsentToast`, no `SpectatorHandRequestBanner` in solo.

- [ ] **Step 5: `tsc` and tests** → clean, PASS.

- [ ] **Step 6: Commit**

```bash
git add app/play/components/MultiplayerCanvas.tsx app/play/components/BattleResolutionUI.tsx app/play/components/TurnIndicator.tsx app/play/components/SeatSwapPill.tsx app/shared/components/GameToolbar.tsx "app/play/[code]/client.tsx"
git commit -m "feat(play): solo table — everything face-up, both sides playable, swap pill, no prompts"
```

---

### Task 15: Bracket game-over: writeback and the series overlay

**Files:**
- Create: `app/play/components/BracketGameOverOverlay.tsx`
- Modify: `app/play/[code]/client.tsx` (finished branches 1677-1800 and 1895-1925: render the bracket overlay instead of `GameOverOverlay` when `gameParams.bracket` is set; the writeback effect)
- Modify: `app/play/components/GameOverOverlay.tsx` and `TurnIndicator.tsx`: `hideRematch?: boolean` (true for any bracket game, both seats)

**Interfaces:**
- Consumes: Task 3 `recordBracketGameResultAction`, `startBracketGameAction`; Task 8 `writeSoloGameParams`/`writeHostGameParams`, `DECIDED_KEY`; Task 13 `resolveWinnerSeat`.
- Produces: `BracketGameOverOverlay(props: { bracket: BracketGameParams; result: { winnerSeat: 0 | 1; winnerName: string }; series: ActionResult<…> | 'pending' | 'failed'; onRetry: () => void; onPlayNext: () => void; onBack: () => void; onNextMatch: (matchId: string) => void })`.

- [ ] **Step 1: Writeback effect** in `client.tsx`: when `lifecycle === 'finished'`, `gameParams?.bracket`, the viewer is the host (solo: always; online: `myPlayer.seat === 0n`), and `resolveWinnerSeat(gameState.gameActions, gameState.allPlayers.filter(p => p.gameId === gameId)).winnerSeat !== null`, call `recordBracketGameResultAction({ gameId: bracket.gameId, winnerEntryId: winnerSeat === 0 ? bracket.entryAId : bracket.entryBId, soulsA, soulsB })` once (a `useRef` guard keyed by `gameId`), store the result in state (`'pending' | 'failed' | ActionResult`). Souls: seat 0's and seat 1's counts from `gameState.soulsRescued` mapped through `activeSeat` (in solo `me` is the seat in hand), or recount from `gameState.adaptedCardsById` by owner and zone `land-of-redemption`; pick the simpler one that is seat-correct.

- [ ] **Step 2: Overlay** — result line "<winner deck> wins game N" (`text-xl font-semibold`); series line "Series 1–1" with `needed`-length pip rows per side (filled `bg-primary`, empty `border border-border`); then the buttons per the spec: undecided → **Play game N+1** (primary) + **Back to bracket**; decided → "<winner> advances to <next round name>" / "<winner> is the champion", **Back to bracket** (primary → `router.push(returnTo + '?decided=' + matchId)`), and **Next match: <A> vs <B>** when `nextReadyMatch` is non-null (sets `sessionStorage[DECIDED_KEY] = matchId`, calls `startBracketGameAction(next.id, 'solo')`, writes solo params, `router.replace('/play/' + code)`). `'failed'` → "Could not save this result." + **Retry** + **Back to bracket**. Reuse `GameOverOverlay`'s container styling (`toastFocusShadow`, touch `min-h-11`).

- [ ] **Step 3: Hide rematch** in `GameOverOverlay`/`TurnIndicator` when `hideRematch` (friend's seat in online bracket games gets the standard overlay with rematch hidden; the host gets `BracketGameOverOverlay`).

- [ ] **Step 4: `tsc` and tests** → clean, PASS.

- [ ] **Step 5: Commit**

```bash
git add app/play/components/BracketGameOverOverlay.tsx app/play/components/GameOverOverlay.tsx app/play/components/TurnIndicator.tsx "app/play/[code]/client.tsx"
git commit -m "feat(play): bracket game-over — record the result, series pips, next game / next match"
```

---

## Phase 4: Friend mode (last; droppable)

### Task 16: Online bracket games with a friend

**Files:**
- Modify: `app/brackets/actions.ts` (add `loadBracketSeatDeckAction(gameId: string): Promise<ActionResult<{ deck: { id: string; name: string; format: string; paragon: string | null }; deckData: GameCardData[]; code: string; bracket: BracketGameParams }>>`; factor the enrichment loop out of `app/play/actions.ts loadDeckForGame` into `app/play/lib/deckToGameData.ts` (server-only) and call it from both)
- Create: `app/brackets/[id]/join/[gameId]/page.tsx` + `JoinBracketGameClient.tsx`
- Modify: `app/brackets/[id]/BracketClient.tsx` (wire `onPlayOnline`: `startBracketGameAction(matchId, 'online')` → `writeHostGameParams` → push)
- Modify: `app/play/[code]/client.tsx` (join path: when `gameParams.bracket` and `role === 'join'`, load through `loadBracketSeatDeckAction(bracket.gameId)`; pass `hideRematch`)
- Modify: `app/play/components/PregameScreen.tsx:252-258` (`GameCodeHeader` takes `inviteUrl?: string`; bracket games pass `${origin}/brackets/${bracketId}/join/${gameId}`)

- [ ] **Step 1: `loadBracketSeatDeckAction`** — signed-in caller; game row `mode = 'online'`, `winner_entry_id` null; caller `!== bracket.owner_id`; deck = the match's `entry_b` deck (`deck_id` not null) loaded with the admin-free path: select the deck by id with no ownership filter is blocked by RLS for private decks, so use the service-role client the tracker actions use (`grep -n "createAdminClient\|SUPABASE_SERVICE_ROLE" app/tracker/tournaments/actions.ts | head -3`) for this one read; enrich with `deckToGameData`.

- [ ] **Step 2: Invite page** — server page: sign-in gate with `redirectTo`; `loadBracketSeatDeckAction` is not called here (it stamps nothing but is heavy); instead load bracket + match + entries + game via `loadBracketAction` and render: "<host username> invited you to play **<deck B>** against **<deck A>** · Game N of the <round name> in <bracket name>", both `DeckThumb`s at 64px, **Join game** (primary; writes `writeJoinGameParams(code, { deckBId, deckBName, displayName, supabaseUserId, format: stdbFormatFor(bracket.format), bracket })` and pushes `/play/<code>`). States: game has a winner → "This game is already finished."; game row missing → "This game was cancelled."; viewer is the owner → "This is your own bracket; open it to play." with a link.

- [ ] **Step 3: Client join path** — in the deck-load effect, `if (gameParams.role === 'join' && gameParams.bracket)` → `loadBracketSeatDeckAction(bracket.gameId)` → `setDeckData(JSON.stringify(r.data.deckData))`. Everything after is the normal join.

- [ ] **Step 4: Host side** — `onPlayOnline` in `BracketClient`; `GameCodeHeader inviteUrl`; the host's `GameOverOverlay` is replaced by `BracketGameOverOverlay` (Task 15 already keys on `gameParams.bracket`), with "Play game N+1" creating an online game again (`mode` from `bracket.mode`).

- [ ] **Step 5: `tsc` and tests** → clean, PASS.

- [ ] **Step 6: Commit**

```bash
git add app/brackets/actions.ts app/play/lib/deckToGameData.ts app/play/actions.ts "app/brackets/[id]/join" "app/brackets/[id]/BracketClient.tsx" "app/play/[code]/client.tsx" app/play/components/PregameScreen.tsx
git commit -m "feat(brackets): play a bracket game online with a friend via a designated-deck invite link"
```

---

## Phase 5: Verification and PR

### Task 17: End-to-end verification, migration, PR

**Files:** none new (screenshots go to the scratchpad directory).

- [ ] **Step 1: Static checks** — `npx tsc --noEmit -p tsconfig.json && npx vitest run` → clean, all PASS.

- [ ] **Step 2: Apply migration 113** to the Supabase project with the Supabase MCP `apply_migration` (name `113_deck_brackets`), then `get_advisors` (security) and fix any flagged policy.

- [ ] **Step 3: Manual pass** per the `verify` skill (mint a session, `npm run dev` in the worktree on a free port, Playwright at 390×844 and 1280×800): create a 6-deck Bo3 T1 bracket from `/tracker/tournaments` (two byes visible), open it signed out in a second context, "Play game 1" → the solo table: both hands face-up; drag a hero into the band, drag the far deck's evil character in as the block, an enhancement from each hand, Win Battle, choose a soul, End Turn flips the pill; resign as the seat in hand; the overlay shows "Series 0–1" and "Play game 2"; "Back to bracket" plays the write-in; "Record result by hand" on another match; "Reset match"; close a solo tab and reopen from "Resume". Save screenshots of the phone bracket, the phone picker, the solo table with the pill, and the champion panel to the scratchpad.

- [ ] **Step 4: Dev-module smoke** — in a solo game, open an opponent-deck search from the far deck's menu: no prompt, the search opens; leave the tab idle five minutes: no disconnect banner.

- [ ] **Step 5: PR** — `git push -u origin feat/deck-bracket`; `gh pr create --base main` with a body that links the spec and the plan, lists the migration, notes that CI published the dev module and that merging publishes prod, and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
