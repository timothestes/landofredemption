# Card Scanner PR A: matcher, cue table, price loader, eval harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `lib/scan/` (vocabulary, identity index, matcher, cue table, price loader, transcription schema) and `scripts/scan-eval/` (scorer, runner, catalog regression set) as a pure, unit-tested package with no API calls at test time, so PR B's route and PR C's page can import it and E0 can run against it.

**Architecture:** The model transcribes a card as text; `lib/scan/match.ts` maps that text to an identity (a group of printings of one card) and then to one printing, through ordered filters, and never picks a key itself. The index in `stemIndex.ts` is built once from `CARDS` and layers the scanner's own unions on `cardIdentityKey` without changing it. A per-printing cue table (illustrator credit, © year, printed promo caption), generated from the catalog images, is what separates printings whose text is identical. Everything here is deterministic and runs under Vitest in Node.

**Tech Stack:** TypeScript, Vitest (node only, no DOM), `lib/cards/lookup.ts` (`CARDS`, `CardData`), `lib/cards/cardIdentity.ts` (`cardIdentityKey`, `cardNameStem`), `lib/cards/generated/abMap.json`, `@anthropic-ai/sdk` 0.78 (build script only), `tsx` for scripts.

**Spec:** `docs/superpowers/specs/2026-10-26-card-scanner-design.md` (rev 4.4). Sections this plan implements: Vocabulary, Dataset numbers, Recognition (Transcription fields, The matcher, Printing selection, Reason fields), Evaluation (Units, labels, scoring; E0 preview), Files, Testing. A working reference for every rule below is the spike matcher at `tmp/scan-spike/spike/match.ts` (git-ignored, 301 lines, measured on 83 photos and 148 catalog images); port it, do not import it.

## Global Constraints

- Work in a git worktree off `origin/main` (CLAUDE.md): `git worktree add ../rtt-scan-a -b feat/scan-matcher origin/main`; absolute paths; `git add` only your files; PR bases on `origin/main`.
- `lib/scan/**` is pure: no Supabase, no Anthropic, no `fetch` at import or test time. The only network code in this PR is `scripts/scan-eval/build-cues.ts` and `scripts/scan-eval/run.ts`, both behind `main()`.
- Import card data only from `@/lib/cards/lookup` (its `LEGALITY_OVERRIDES` make 3,190 printings Rotation-legal); never from `lib/cards/generated/cardData`.
- Card key everywhere is `` `${name}|${set}|${imgFile}` `` (the key `collection_cards` and `card_prices` use).
- `PRICE_DELTA_FLOOR = 2.00`. Price map: `Record<cardKey, number>`; an unpriced printing is absent, never `0`.
- Transcription schema: every leaf `["string","null"]` except enums and the two grid integers; every object `additionalProperties: false` with a full `required` list; no `minLength`/`maxLength`/numeric bounds (the API rejects them). Stored-field caps are enforced in code: title 60, reference 40, nickname 30, ability 80, identifier 40, type 30, brigade 40, numbers 8, promoText 120, illustrator 60, copyrightYear 4.
- Tests: Vitest, `npm test -- <path>`; files under `__tests__/` named `*.test.ts`; node only (no `document`, no React).
- No zod: hand-rolled validators.
- `npx tsc --noEmit` must stay as clean as on `origin/main`.
- The spec's Dataset numbers are the source of truth for counts asserted in tests; where this plan quotes one, the test asserts that value.

## Review Focus

1. A photo of a card from another game ("Lightning Bolt", a Pokémon name) must come back `not_found`, never a fuzzy hit on a short Redemption stem. Test added to Task 5 (`match.test.ts`, "other-game titles").
2. A transcription with `title: null` but a reference (the model read the verse, not the band) must not throw and must not match a Lost Soul unless `type` is `Lost Soul`. Test added to Task 5 ("null title").
3. Curly apostrophes and non-breaking spaces in titles ("Aaron’s Staff", "Josiah’s Covenant") must hit the same stem as straight ones. Test added to Task 1 (`vocab.test.ts`, "normalizeTitle folds quotes").
4. A price map missing every printing of an identity must still collapse (all-unpriced counts as zero span) and must never pick `undefined` as a price. Test added to Task 5 ("all unpriced").
5. The generated cue JSON may lack a printing (new card, failed read): the credit, year and caption filters must skip, not throw, and must not treat a missing credit as "disagrees". Test added to Task 4 (`cues.test.ts`, "missing entries are neutral").

---

### Task 1: `lib/scan/vocab.ts` — normalization and printing predicates

**Files:**
- Create: `lib/scan/vocab.ts`
- Test: `lib/scan/__tests__/vocab.test.ts`

**Interfaces:**
- Consumes: `CardData` from `@/lib/cards/lookup`; `abMap` from `@/lib/cards/generated/abMap.json`.
- Produces:
  - `cardKey(c: CardData): string`
  - `normalizeTitle(s: string | null | undefined): string` — lowercase; curly and straight apostrophes removed; every other non-alphanumeric run becomes one space; trimmed.
  - `normalizeRef(s: string | null | undefined): string` — lowercase; en/em dash → `-`; periods dropped; a leading `i`/`ii`/`iii`/`1st`/`2nd`/`3rd`/`first`/`second`/`third` book number → `1`/`2`/`3`; `psalms` → `psalm`, `song of songs` → `song of solomon`, `revelations` → `revelation`; then everything except `[a-z0-9:,-]` removed (so `"I Kings 1:41"` → `"1kings1:41"`).
  - `refsOf(s: string | null | undefined): string[]` — split on `/`, `;`, `(`, `)`; drop `good`/`evil` words; `normalizeRef` each; keep parts containing a digit (`"James 4:6 (Proverbs 3:34)"` → `["james4:6","proverbs3:34"]`).
  - `normalizeAbility(s: string | null | undefined): string` — strip a leading `GE:` / `EE:` / `STAR:` / `Gospel:` marker, then `normalizeTitle`.
  - `isPromo(c)`, `isAB(c)`, `isLegacyRare(c)`, `isUrPlus(c)`, `isLostSoul(c)` — the Printing selection table: promo = `set` starts `Pmo` or `officialSet` starts `Promo` or `rarity` in {Promo, National, Seasonal, Regional, State, Local, District, Winner, "National, Winner"}; AB = `set` ends `(AB)`; Legacy Rare = `rarity === 'Legacy Rare'`; UR+ = `imgFile` ends `-UR+` or `-UR-Plus`; Lost Soul = `type` contains `lost soul` (case-insensitive).
  - `cornerCode(c: CardData): string | null` — the printed corner code parsed from `imgFile`: a digit run before `_` (II set, `"81_Captain-…"` → `"81"`); else `K`/`L` + digits before `-` kept whole (`"K13-1P-Abandoned"` → `"K13"`); else strip every leading `Letters_` prefix and read `^(?:LR|N)?(\d+)-` (`"081-Authority-of-Christ-UR+"` → `"81"`, `"LoC_232-…"` → `"232"`, `"CoW_AB_N114-…"` → `"114"`, `"LR29-…"` → `"29"`); else the AB twin's code when this printing is an original listed in `abMap.json` whose own file has none (`"Aarons_Staff_(CoW)"` → `"3"`); else `null`.
  - `editionLetter(c: CardData): 'A'|…|'H'|null` — from a trailing `_(X)` in `imgFile`.
  - `nicknameOf(c: CardData): string` — the quoted word in `identifier` or `name`, normalized, else `''`.
  - `typeAgrees(read: string | null, c: CardData): boolean` — `Enhancement` agrees with `GE`/`EE` types; `token` with any `… Token`; otherwise the read word appears in the dataset type (case-insensitive); `unknown`/`null` never agree.
  - `brigadeAgrees(read: string | null, c: CardData): boolean` — any color token shared.
  - `SPELLING_VARIANT_STEMS: [string, string][]` — `[['wizard','wizards'],['elisabeth','elizabeth'],['judgements','judgments']]` (normalized stems; Task 2 unions them).
  - `readCornerCode(printNumber: string | null, rarityCode: string | null): string | null` — `K`/`L` + 1–3 digits anywhere in either field → that code (`"K13"`); else the digits of `printNumber` as a number string (`"081"` → `"81"`); `"0"`/empty → `null`.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/scan/__tests__/vocab.test.ts
import { describe, it, expect } from 'vitest';
import { CARDS } from '@/lib/cards/lookup';
import { normalizeTitle, normalizeRef, refsOf, cornerCode, isUrPlus, isPromo, editionLetter, readCornerCode, typeAgrees } from '../vocab';
const byFile = (f: string) => CARDS.find(c => c.imgFile === f)!;

describe('normalizeTitle folds quotes', () => {
  it('curly and straight apostrophes meet', () => {
    expect(normalizeTitle('Aaron’s Staff')).toBe('aarons staff');
    expect(normalizeTitle("Aaron's  Staff ")).toBe('aarons staff');
    expect(normalizeTitle('Ram, the Exalter / Ram, the Uplifted')).toBe('ram the exalter ram the uplifted');
  });
});
describe('normalizeRef', () => {
  it('folds Roman book numbers and spacing', () => {
    expect(normalizeRef('I Kings 1:41')).toBe('1kings1:41');
    expect(normalizeRef('II Chronicles 14:2-3')).toBe('2chronicles14:2-3');
    expect(normalizeRef('Luke 15: 6')).toBe('luke15:6');
    expect(normalizeRef('Isaiah 11:10')).toBe('isaiah11:10'); // "I" inside a word is not a book number
  });
  it('splits compound references', () => {
    expect(refsOf('James 4:6 (Proverbs 3:34)')).toEqual(['james4:6', 'proverbs3:34']);
    expect(refsOf('II Chronicles 33:12/II Kings 20:21')).toEqual(['2chronicles33:12', '2kings20:21']);
  });
});
describe('cornerCode', () => {
  it.each([
    ['081-Authority-of-Christ-UR+', '81'], ['LoC_232-Abducted-Subjects', '232'], ['CoW_AB_N114-The-Murdering-Pharaoh', '114'],
    ['LR29-Astrologers', '29'], ['1_Called-to-Prophesy-R', '1'], ['K13-1P-Abandoned', 'K13'], ['K13-Abandoned', 'K13'],
    ['Aarons_Staff_(CoW)', '3'], ['Promo_Son-of-God-Christmas', null], ['Lost_Soul_Ezekiel_34_12_(A)', null],
  ])('%s → %s', (file, code) => expect(cornerCode(byFile(file))).toBe(code));
  it('counts printings with a code', () => expect(CARDS.filter(c => cornerCode(c)).length).toBe(2652));
});
describe('predicates', () => {
  it('UR+ includes the LoC UR-Plus files', () => { expect(isUrPlus(byFile('001-Chronicles-of-the-Kings-UR-Plus'))).toBe(true); expect(CARDS.filter(isUrPlus).length).toBe(12); });
  it('promo count matches Dataset numbers', () => expect(CARDS.filter(isPromo).length).toBe(248));
  it('edition letter', () => expect(editionLetter(byFile('Son_of_God_(F)'))).toBe('F'));
});
describe('readCornerCode', () => {
  it('keeps deck codes and strips zero padding', () => {
    expect(readCornerCode('081', 'UR+')).toBe('81');
    expect(readCornerCode(null, 'K10')).toBe('K10');
    expect(readCornerCode('P', null)).toBe(null);
  });
});
describe('typeAgrees', () => {
  it('maps Enhancement to GE and EE', () => { expect(typeAgrees('Enhancement', byFile('210-A-Royal-Priesthood-R'))).toBe(true); expect(typeAgrees('unknown', byFile('210-A-Royal-Priesthood-R'))).toBe(false); });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/scan/__tests__/vocab.test.ts`
Expected: FAIL, cannot resolve `../vocab`.

- [ ] **Step 3: Implement `lib/scan/vocab.ts`** with the signatures above. `cornerCode`'s borrowed numbers come from a module-level `Map` built once from `abMap.json` (`"AB name|set" → "original name|set"`), filled only where the original's own file yields nothing. The UR+ count of 12 is the 6 `-UR+` files plus the 6 LoC `-UR-Plus` files; if `CARDS` has changed, update the asserted counts from Dataset numbers, not the rule.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/scan/__tests__/vocab.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scan/vocab.ts lib/scan/__tests__/vocab.test.ts
git commit -m "feat(scan): vocabulary, reference and corner-code parsing, printing predicates"
```

---

### Task 2: `lib/scan/stemIndex.ts` — identities with the scanner's unions

**Files:**
- Create: `lib/scan/stemIndex.ts`
- Test: `lib/scan/__tests__/stemIndex.test.ts`

**Interfaces:**
- Consumes: Task 1; `cardIdentityKey`, `cardNameStem` from `@/lib/cards/cardIdentity`; `abMap.json`.
- Produces:
  - `interface ScanIdentity { key: string; members: string[]; stem: string; normalizedStem: string; cards: CardData[]; refs: Set<string>; lostSoul: boolean; token: boolean }` — `refs` holds every `refsOf` component of every member printing.
  - `interface ScanIndex { identities: Map<string, ScanIdentity>; byStem: Map<string, ScanIdentity[]>; stems: string[]; lostSoulByRef: Map<string, ScanIdentity[]>; canonicalIdentity(cardIdentityKeyValue: string): string; identityOf(card: CardData): ScanIdentity; abTwinKey(cardKey: string): string | undefined; stats: { identities: number; stems: number; unions: number } }`
  - `getScanIndex(): ScanIndex` — built once, memoized.
  - Union rules (applied once, by union-find over `cardIdentityKey` values): (a) each AB printing with its original through `abMap.json`; (b) two identities whose first cards share normalized stem (Lost Souls: the constant `lost soul`), normalized `type`, normalized `brigade` and `alignment`, share at least one `refsOf` component, and whose abilities are both empty, identical after `normalizeAbility`, or overlap at Jaccard ≥ 0.6 on tokens; Lost Souls union only when `nicknameOf` agrees; (c) the `SPELLING_VARIANT_STEMS` pairs union identities whose stems are the pair when they also share a reference.
  - `byStem` indexes each identity under every member printing's normalized stem and, for stems containing ` / `, under each half.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/scan/__tests__/stemIndex.test.ts
import { describe, it, expect } from 'vitest';
import { CARDS } from '@/lib/cards/lookup';
import { getScanIndex } from '../stemIndex';
import { cardKey } from '../vocab';
const byName = (n: string) => CARDS.find(c => c.name === n)!;
const idx = getScanIndex();
const same = (a: string, b: string) => idx.identityOf(byName(a)).key === idx.identityOf(byName(b)).key;

describe('unions', () => {
  it('AB pairs merge, including the stem-split Fourth Seal', () => { expect(same('Fourth Seal, Death (RoJ)', 'Fourth Seal (Death) (RoJ AB)')).toBe(true); expect(same('The Murdering Pharaoh', 'The Murdering Pharaoh (CoW AB)')).toBe(true); });
  it('vanilla Lost Souls on one verse merge across name decorations', () => expect(same('Lost Soul (Proverbs 21:16) (LoC)', 'Lost Soul Proverbs 21:16 (I)')).toBe(true));
  it('a reprint with a different ability stays its own card', () => { expect(same("Josiah's Covenant", 'Josiah’s Covenant (LoC)')).toBe(false); expect(same('Thievery of Judas', 'Thievery of Judas (GoC)')).toBe(false); });
  it('a nicknamed Lost Soul never merges with the plain one', () => expect(same('Lost Soul  Ezekiel 34:12', 'Lost Soul "Lost Boy" [Ezekiel 34:12 - PoC]')).toBe(false));
  it('counts', () => { expect(idx.stats.identities).toBeLessThanOrEqual(4705); expect(idx.stats.unions).toBeGreaterThanOrEqual(78); });
});
describe('stem index', () => {
  it('indexes both halves of a dual name', () => { expect(idx.byStem.get('ram the exalter')).toBeTruthy(); expect(idx.byStem.get('whirlwind')).toBeTruthy(); });
  it('Lost Souls are reachable by every component reference', () => { expect(idx.lostSoulByRef.get('james4:6')?.length).toBeGreaterThan(0); expect(idx.lostSoulByRef.get('proverbs3:34')?.length).toBeGreaterThan(0); });
  it('abTwinKey is symmetric', () => { const o = byName('Aaron\'s Staff (CoW)'), a = byName('Aaron\'s Staff (CoW AB)'); expect(idx.abTwinKey(cardKey(o))).toBe(cardKey(a)); expect(idx.abTwinKey(cardKey(a))).toBe(cardKey(o)); });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/scan/__tests__/stemIndex.test.ts`
Expected: FAIL, cannot resolve `../stemIndex`.

- [ ] **Step 3: Implement `lib/scan/stemIndex.ts`** per the Interfaces block. The spike's `applyUnions()` (`tmp/scan-spike/spike/match.ts` lines 60–95) is the reference for rule (b); rule (c) is new. Keep the union log as `stats.unions`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/scan/__tests__/stemIndex.test.ts`
Expected: PASS. If `identities` differs from 4,705 by more than the three spelling pairs, inspect before adjusting the assertion.

- [ ] **Step 5: Commit**

```bash
git add lib/scan/stemIndex.ts lib/scan/__tests__/stemIndex.test.ts
git commit -m "feat(scan): identity index with AB, decoration and spelling unions"
```

---

### Task 3: `lib/scan/schema.ts` — the transcription contract

**Files:**
- Create: `lib/scan/schema.ts`
- Test: `lib/scan/__tests__/schema.test.ts`

**Interfaces:**
- Produces:
  - `interface ScanDetection { title: string|null; reference: string|null; nickname: string|null; abilityStart: string|null; abilityEnd: string|null; type: 'Hero'|'Evil Character'|'Enhancement'|'Lost Soul'|'Dominant'|'Site'|'Fortress'|'Artifact'|'Covenant'|'Curse'|'City'|'token'|'unknown'; brigade: string|null; strength: string|null; toughness: string|null; identifier: string|null; printNumber: string|null; rarityCode: string|null; promoText: string|null; illustrator: string|null; copyrightYear: string|null; grid: { row: number; col: number }; orientation: 'upright'|'rotated'|'upside_down'; confidence: 'high'|'medium'|'low' }`
  - `interface ScanOutput { photoQuality: 'ok'|'blurry'|'dark'|'glare'|'too_many_cards'|'no_cards'; cards: ScanDetection[] }`
  - `SCAN_JSON_SCHEMA: Record<string, unknown>` — the JSON schema for `output_config.format`, matching the two interfaces (enums as `enum`, `grid` integers, every other leaf `["string","null"]`).
  - `SCAN_INSTRUCTION: string` — the prompt text: port `tmp/scan-spike/spike/prompt_v4.mjs`'s instruction, dropping the `border` and `setIcon` bullets, keeping `abilityEnd`, `promoText`, `illustrator`, `copyrightYear`.
  - `PROMPT_HASH: string` — first 12 hex of sha256 over `SCAN_INSTRUCTION + JSON.stringify(SCAN_JSON_SCHEMA)`.
  - `FIELD_CAPS: Record<keyof ScanDetection, number>` for the string fields (Global Constraints) and `capDetection(d: ScanDetection): ScanDetection` (truncates strings, never throws on non-string input, coerces unknown enums to `'unknown'`/`'upright'`/`'low'`).
  - `parseScanOutput(text: string): ScanOutput | null` — `JSON.parse` + shape check (`cards` is an array of objects with a `grid` object), capped; `null` on any failure.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/scan/__tests__/schema.test.ts
import { describe, it, expect } from 'vitest';
import { SCAN_JSON_SCHEMA, SCAN_INSTRUCTION, PROMPT_HASH, capDetection, parseScanOutput } from '../schema';
const walk = (node: any, visit: (n: any) => void) => { if (!node || typeof node !== 'object') return; visit(node); for (const v of Object.values(node)) walk(v, visit); };
describe('schema', () => {
  it('every object forbids extra properties and lists all required keys', () => {
    walk(SCAN_JSON_SCHEMA, n => { if (n.type === 'object') { expect(n.additionalProperties).toBe(false); expect(Object.keys(n.properties).sort()).toEqual([...n.required].sort()); } });
  });
  it('carries no bounds the API rejects', () => walk(SCAN_JSON_SCHEMA, n => { for (const k of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems']) expect(n[k]).toBeUndefined(); }));
  it('has the v1.0 fields and not the rejected ones', () => {
    const props = (SCAN_JSON_SCHEMA as any).properties.cards.items.properties;
    for (const k of ['abilityEnd', 'promoText', 'illustrator', 'copyrightYear']) expect(props[k]).toBeTruthy();
    for (const k of ['border', 'setIcon']) expect(props[k]).toBeUndefined();
    expect(SCAN_INSTRUCTION).not.toMatch(/alternate-border|set symbol/);
  });
  it('hash is stable and 12 hex chars', () => expect(PROMPT_HASH).toMatch(/^[0-9a-f]{12}$/));
});
describe('capDetection / parseScanOutput', () => {
  it('caps and coerces', () => { const d = capDetection({ title: 'x'.repeat(100), type: 'Dragon', confidence: 'certain', grid: { row: 1, col: 1 } } as any); expect(d.title!.length).toBe(60); expect(d.type).toBe('unknown'); expect(d.confidence).toBe('low'); });
  it('rejects malformed output', () => { expect(parseScanOutput('not json')).toBeNull(); expect(parseScanOutput('{"photoQuality":"ok","cards":"nope"}')).toBeNull(); expect(parseScanOutput('{"photoQuality":"ok","cards":[]}')).toEqual({ photoQuality: 'ok', cards: [] }); });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/scan/__tests__/schema.test.ts`
Expected: FAIL, cannot resolve `../schema`.

- [ ] **Step 3: Implement `lib/scan/schema.ts`.** Use `node:crypto` for the hash (server/script only; nothing in `lib/scan` is imported by client components).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/scan/__tests__/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scan/schema.ts lib/scan/__tests__/schema.test.ts
git commit -m "feat(scan): transcription schema, instruction, caps and parser"
```

---

### Task 4: `lib/scan/cues.ts`, the generated cue table and its builder

**Files:**
- Create: `lib/scan/cues.ts`, `lib/scan/generated/printingCues.json`, `scripts/scan-eval/build-cues.ts`
- Modify: `Makefile` (add `update-scan-cues` target next to `update-cards`)
- Test: `lib/scan/__tests__/cues.test.ts`

**Interfaces:**
- Produces:
  - `interface PrintingCue { illustrator: string | null; year: string | null; caption: string | null }`
  - `PRINTING_CUES: Record<string /* cardKey */, PrintingCue>` loaded from the generated JSON.
  - `normalizeCredit(s: string | null | undefined): string` — lowercase; drop `illus`, `illustration`, `illustrated by`, `art`, `artist` words and `©®™`; keep `[a-z0-9 ]`; collapse spaces.
  - `creditAgrees(a: string, b: string): boolean` — equal after normalization, or two shared tokens of length ≥ 3, or one shared token when either side has only one token.
  - `normalizeCaption(s: string | null | undefined): string` — lowercase, `[a-z0-9 ]` only, collapsed.
  - `cueFor(cardKey: string): PrintingCue | undefined`.
- Generated JSON: seed it by converting `tmp/scan-spike/results/illustrators.json` (keys are card keys; fields `illustrator`, `year`, `caption`) to `{ [cardKey]: { illustrator, year, caption } }`; 1,839 entries. The builder reproduces it.
- `scripts/scan-eval/build-cues.ts`: `npx tsx scripts/scan-eval/build-cues.ts [--only-missing] [--concurrency 3]`; for every printing in a multi-printing identity (`getScanIndex()`), fetches `${NEXT_PUBLIC_BLOB_BASE_URL}/card-images/${sanitizeImgFile(imgFile)}.jpg` (`sanitizeImgFile` from `@/app/shared/utils/cardImageUrl`), calls `claude-sonnet-5-5` at `effort: 'low'` with a 3-field schema (title, illustrator, copyrightYear, caption — all `["string","null"]`), key from `SCANNER_ANTHROPIC_API_KEY` falling back to `ANTHROPIC_API_KEY`, `maxRetries: 0`, one retry on 5xx/529, writes the JSON sorted by key, prints count, read rates and cost (about $4.50 at $0.0023 an image). Resumable: `--only-missing` skips keys already present.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/scan/__tests__/cues.test.ts
import { describe, it, expect } from 'vitest';
import { PRINTING_CUES, normalizeCredit, creditAgrees, normalizeCaption, cueFor } from '../cues';
describe('credits', () => {
  it('normalizes the credit line', () => { expect(normalizeCredit('Illus. © Cahaba Productions')).toBe('cahaba productions'); expect(normalizeCredit('Illus. J.J. Tissot')).toBe('j j tissot'); });
  it('agrees across punctuation and disagrees across artists', () => { expect(creditAgrees(normalizeCredit('Illus. J.J. Tissot'), normalizeCredit('Illus. JJ Tissot'))).toBe(true); expect(creditAgrees('ai generated', 'cahaba productions')).toBe(false); expect(creditAgrees('todd demelli', 'todd demelle')).toBe(true); });
});
describe('table', () => {
  it('covers the multi-printing rows and separates the T2C AB pairs by year', () => {
    expect(Object.keys(PRINTING_CUES).length).toBeGreaterThanOrEqual(1800);
    expect(cueFor('The Prince of Persia [T2C]|T2C|076-The-Prince-of-Persia-UR')?.year).toBe('2025');
    expect(cueFor('The Prince of Persia [T2C AB]|T2C (AB)|076-The-Prince-of-Persia-UR-AB')?.year).toBe('2026');
    expect(normalizeCaption(cueFor('Lost Soul "Crowds" [Luke 5:15] [2025 - Worker]|Pmo-P3|Lost-Soul-Crowds-Worker')?.caption)).toBe('special promo');
  });
  it('missing entries are neutral', () => { expect(cueFor('No Such Card|XX|nope')).toBeUndefined(); expect(normalizeCredit(undefined)).toBe(''); expect(creditAgrees('', 'tissot')).toBe(false); });
});
```

If the Worker promo's `imgFile` differs from the literal above, take the key from `CARDS` in the test rather than editing the rule.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/scan/__tests__/cues.test.ts`
Expected: FAIL, cannot resolve `../cues`.

- [ ] **Step 3: Seed `lib/scan/generated/printingCues.json`** from `tmp/scan-spike/results/illustrators.json` with a one-off node command (map each value to `{ illustrator, year, caption: caption ?? null }`), then implement `lib/scan/cues.ts` (import the JSON with `resolveJsonModule`, as `lib/cards/lookup.ts` imports `abMap.json`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/scan/__tests__/cues.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `scripts/scan-eval/build-cues.ts`** with the behavior in the Interfaces block (header and `dotenv` pattern as `scripts/export-prices-json.ts`). Do not run it against the API in this task; run `npx tsx scripts/scan-eval/build-cues.ts --only-missing` and confirm it reports `0 to fetch` against the seeded table.

- [ ] **Step 6: Add the Makefile target**

```make
update-scan-cues:  ## Rebuild lib/scan/generated/printingCues.json from the catalog images (Claude, ~$4.50)
	npx tsx scripts/scan-eval/build-cues.ts --only-missing
```

- [ ] **Step 7: Commit**

```bash
git add lib/scan/cues.ts lib/scan/generated/printingCues.json lib/scan/__tests__/cues.test.ts scripts/scan-eval/build-cues.ts Makefile
git commit -m "feat(scan): per-printing cue table (credit, year, caption) with its builder"
```

---

### Task 5: `lib/scan/match.ts` — identity, then printing

**Files:**
- Create: `lib/scan/match.ts`
- Test: `lib/scan/__tests__/match.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `type PriceMap = Record<string, number>`
  - `interface Candidate { key: string; name: string; set: string; officialSet: string; imgFile: string; legality: string; price: number | null }`
  - `type NameReason = 'exact' | 'fuzzy' | 'reference' | 'none'`
  - `type PrintingReason = 'only' | 'default' | 'print_number' | 'ur_plus' | 'legacy_rare' | 'reference' | 'stats' | 'illustrator' | 'copyright_year' | 'caption' | 'edition_letter' | 'ability_end' | 'promo_text' | 'equivalent' | 'printing_ambiguous' | 'identity_ambiguous' | 'reference_missing' | 'reference_ambiguous' | 'none'`
  - `interface MatchResult { status: 'matched' | 'check' | 'not_found'; nameReason: NameReason; printingReason: PrintingReason; identityKey?: string; stem?: string; chosen?: Candidate; candidates: Candidate[]; identityCandidates?: string[]; scores: { matchScore: number; runnerUpScore: number; agreeingFields: string[] }; fuzzyFrom?: string; note?: string }`
  - `PRICE_DELTA_FLOOR = 2.0`
  - `matchDetection(det: ScanDetection, prices: PriceMap): MatchResult`
  - `selectPrinting(identity: ScanIdentity, det: ScanDetection, prices: PriceMap): Pick<MatchResult, 'status' | 'printingReason' | 'chosen' | 'candidates'>` (exported for tests)
- Rules, in order (the spec's The matcher and Printing selection; the spike is the worked reference):
  1. Empty normalized title → `not_found`/`none`.
  2. Lost Soul path when the normalized title starts `lost soul` or `det.type === 'Lost Soul'`: no reference → `check`/`reference_missing`; identities from `lostSoulByRef` over every `refsOf(det.reference)`; score them (step 4 scoring plus nickname ±2/+0.5, token word −3, vanilla +0.5); a strict winner proceeds to printing selection with `nameReason: 'reference'`; a tie → `check`/`reference_ambiguous`; no identity and a bare "Lost Soul" title → `not_found`.
  3. Stem lookup: try the title as read, then with a trailing `(…)`/`[…]` group removed, then each half of a `/`; exact hit first; else fuzzy over all stems: normalized optimal-string-alignment distance ≤ 0.20, digit and Roman-numeral token sets equal, and (title length ≥ 8 or a read reference matches a candidate identity), unique minimum; else `not_found` with a `note`.
  4. Identity scoring when the stem has several: reference +8, strength/toughness +4, corner code matching a printing in the identity +3, identifier exact +2 / partial +1, brigade +1, six-word ability prefix +0.75 (four-word +0.5; `vanilla` +0.5 when nothing was read and the identity has no ability), type +0.25. Strict winner wins, except: winner has `reference` but not `ability6` while another identity has `ability6` → `check`/`identity_ambiguous` with both, `note: 'reference and ability text disagree'`. Tie → `check`/`identity_ambiguous` with the tied identities.
  5. Printing selection, each step keeps the survivors it supports and returns when one remains: `UR+` in `rarityCode` → UR+ printings; `LR` → Legacy Rares (code narrows if it hits); `readCornerCode` → printings with that `cornerCode` (never a decision between a card and its AB twin: when hits are an AB pair both stay); reference (skip when it would only split a card from its `abTwinKey`); strength/toughness subset; credit via `creditAgrees` against `PRINTING_CUES` when ≥ 2 survivors have credits; year via `PRINTING_CUES` (a single survivor whose year equals the read year wins even if others have none); edition letter A–H in `rarityCode`; ability tail (last three normalized words of `abilityEnd`, skip when it would only split AB twins); promo text from `promoText` and `rarityCode`: keep promos when the identity has any; caption from `PRINTING_CUES` agreeing with exactly one decides; else score promos: placement word `1st|2nd|3rd` +3 / wrong placement −3, year +2 / other year −2, event words (national→`nat`, state, regional, local, district, seasonal, gift set, participant, worker, fundraiser, winner) +1 each, printed event words in the candidate's name absent from the text (local, seasonal, state, regional, district, winner, gift set) −1 each, `special promo` ↔ name contains `worker` +1; a strict top wins; a placement or year contradicting the only promo printing → `check`/`printing_ambiguous`. Then special printings out (promo, AB, Legacy Rare, UR+) when a standard printing remains, remembering that it happened; Rotation-legal in; collapse: one survivor → `only`, or `default` when the removal happened; else price span `< PRICE_DELTA_FLOOR` and one legality → `matched`/`equivalent` with the cheapest priced survivor (else a survivor with a corner code, else the first); else `check`/`printing_ambiguous` with the cheapest priced as provisional `chosen`.
  6. `candidates` on a matched row lists every printing of the identity; on a check row the survivors.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/scan/__tests__/match.test.ts
import { describe, it, expect } from 'vitest';
import { CARDS } from '@/lib/cards/lookup';
import { matchDetection, selectPrinting, PRICE_DELTA_FLOOR } from '../match';
import { getScanIndex } from '../stemIndex';
import { cardKey } from '../vocab';
import type { ScanDetection } from '../schema';
const det = (p: Partial<ScanDetection>): ScanDetection => ({ title: null, reference: null, nickname: null, abilityStart: null, abilityEnd: null, type: 'unknown', brigade: null, strength: null, toughness: null, identifier: null, printNumber: null, rarityCode: null, promoText: null, illustrator: null, copyrightYear: null, grid: { row: 1, col: 1 }, orientation: 'upright', confidence: 'high', ...p });
const byName = (n: string) => CARDS.find(c => c.name === n)!;
const priced = (pairs: [string, number][]): Record<string, number> => Object.fromEntries(pairs.map(([n, p]) => [cardKey(byName(n)), p]));
const NO = {};

describe('names', () => {
  it('exact stem with one identity matches', () => { const m = matchDetection(det({ title: 'Captive Priest', reference: 'Judges 18:27', printNumber: '98' }), NO); expect(m.status).toBe('matched'); expect(m.chosen?.name).toBe('Captive Priest'); expect(m.printingReason).toBe('print_number'); });
  it('other-game titles are not found', () => { for (const t of ['Lightning Bolt', 'Pikachu', 'Dark Magician']) expect(matchDetection(det({ title: t }), NO).status).toBe('not_found'); });
  it('null title does not throw and is not found', () => expect(matchDetection(det({ title: null, reference: 'John 3:16' }), NO).status).toBe('not_found'));
  it('trailing parenthetical and dual-name halves resolve', () => { expect(matchDetection(det({ title: 'Shadrach (Hananiah)', reference: 'Daniel 3:12' }), NO).status).not.toBe('not_found'); expect(matchDetection(det({ title: 'Ram, the Exalter', reference: 'I Chronicles 2:9' }), NO).status).not.toBe('not_found'); });
  it('fuzzy respects the short-name and numeral guards', () => { expect(matchDetection(det({ title: 'Herod Agrippa I', reference: 'Acts 12:1' }), NO).chosen?.name).toMatch(/Agrippa I\b/); expect(matchDetection(det({ title: 'Cage' }), NO).nameReason).not.toBe('fuzzy'); });
});
describe('identity', () => {
  it('Son of God printings resolve by verse', () => { const m = matchDetection(det({ title: 'Son of God', reference: 'Revelation 3:12', type: 'Dominant' }), NO); expect(m.chosen?.name).toBe('Son of God (2019) (Promo)'); expect(m.printingReason).toBe('reference'); });
  it('reprints with changed text split on the corner code', () => { const m = matchDetection(det({ title: "Josiah's Covenant", reference: 'II Kings 23:3', printNumber: '12', abilityStart: 'Discard an evil card. Cannot be negated' }), NO); expect(m.status).toBe('matched'); expect(m.chosen?.name).toBe('Josiah’s Covenant (LoC)'); });
  it('reference against six words of ability text is Check this', () => { const m = matchDetection(det({ title: 'King Asa', reference: 'II Chronicles 14:2-3', abilityStart: 'Discard High Places and Queen Maachah.', strength: '7', toughness: '5' }), NO); expect(m.status).toBe('check'); expect(m.note).toMatch(/disagree/); });
});
describe('Lost Souls', () => {
  it('plain verse beats the nicknamed twin when no nickname is read', () => expect(matchDetection(det({ title: 'Lost Soul', reference: 'Ezekiel 34:12', type: 'Lost Soul' }), NO).chosen?.name).toMatch(/^Lost Soul\s+Ezekiel 34:12/));
  it('token word must agree', () => expect(matchDetection(det({ title: 'Lost Soul Token', reference: 'John 4:35', nickname: 'Harvest', type: 'Lost Soul' }), NO).chosen?.name).toMatch(/Token/));
  it('compound verse reaches the card', () => expect(matchDetection(det({ title: 'Lost Soul', reference: 'James 4:6 (Proverbs 3:34)', nickname: 'Humble', type: 'Lost Soul' }), NO).status).toBe('matched'));
  it('no verse is reference_missing', () => expect(matchDetection(det({ title: 'Lost Soul', type: 'Lost Soul' }), NO).printingReason).toBe('reference_missing'));
});
describe('printing filters', () => {
  const pop = det({ title: 'The Prince of Persia', reference: 'Daniel 10:13', strength: '7', toughness: '8', printNumber: '76', rarityCode: 'UR' });
  it('the shared number never decides an AB pair; credit and year do', () => {
    expect(matchDetection({ ...pop, illustrator: 'Illus. © Cahaba Productions', copyrightYear: '2026' }, NO).chosen?.name).toBe('The Prince of Persia [T2C AB]');
    expect(matchDetection({ ...pop, illustrator: 'Illus. AI Generated', copyrightYear: '2025' }, NO).chosen?.name).toBe('The Prince of Persia [T2C]');
    const bare = matchDetection(pop, NO); expect(bare.chosen?.name).toBe('The Prince of Persia [T2C]'); expect(bare.printingReason).toBe('default');
  });
  it('UR+ and LR codes pick their printings, including LoC UR-Plus', () => { expect(matchDetection(det({ title: 'Doubt', reference: 'Deuteronomy 28:66', rarityCode: 'UR+' }), NO).chosen?.imgFile).toMatch(/UR-Plus$/); expect(matchDetection(det({ title: 'Mayhem', reference: 'Isaiah 59:7', rarityCode: 'LR', printNumber: '16' }), NO).chosen?.name).toBe('Mayhem (FoM)'); });
  it('caption and printed event words choose among promos', () => {
    const crowds = det({ title: 'Lost Soul', reference: 'Luke 5:15', nickname: 'Crowds', type: 'Lost Soul' });
    expect(matchDetection({ ...crowds, promoText: 'Special Promo' }, NO).chosen?.name).toMatch(/Worker/);
    expect(matchDetection({ ...crowds, promoText: 'Local Redemption Tournament Participant' }, NO).chosen?.name).toMatch(/Local/);
    expect(matchDetection({ ...crowds, promoText: 'Seasonal Promo' }, NO).chosen?.name).toMatch(/Seasonal/);
  });
  it('a contradicted placement is Check this', () => { const m = matchDetection(det({ title: 'Warrior Overtaken', reference: 'II Chronicles 18:33', promoText: '2nd Place Promo' }), NO); expect(m.status).toBe('check'); });
  it('stats split old reprints', () => expect(matchDetection(det({ title: 'Christian Soldier', strength: '4', toughness: '4', reference: 'II Timothy 2:3' }), NO).chosen?.name).not.toMatch(/\( C\)/));
  it('promo text in the corner books the promo', () => expect(matchDetection(det({ title: 'Gates of Jerusalem', reference: 'Nehemiah 3:1', rarityCode: 'P' }), NO).chosen?.name).toBe('Gates of Jerusalem (Promo)'));
});
describe('collapse', () => {
  const id = getScanIndex().identityOf(byName('Son of God (1st Print - L)'));
  const sog = det({ title: 'Son of God', type: 'Dominant' });
  it('prices under the floor collapse to the cheapest, over it ask', () => {
    const cheap = priced([['Son of God (1st Print - L)', 3], ['Son of God (1st Print - K)', 3.5], ['Son of God [K]', 4.9], ['Son of God [L]', 3]]);
    expect(selectPrinting(id, sog, cheap).status).toBe('matched');
    const wide = { ...cheap, [cardKey(byName('Son of God [K]'))]: 3 + PRICE_DELTA_FLOOR };
    expect(selectPrinting(id, sog, wide).status).toBe('check');
  });
  it('all unpriced counts as zero span and picks a real printing', () => { const r = selectPrinting(id, sog, NO); expect(r.chosen?.price).toBeNull(); expect(r.chosen?.key).toBeTruthy(); });
});
```

Where a literal name or verse above does not exist in `CARDS` (the dataset moves), replace it with a card that exercises the same rule and note the swap in the commit message; never weaken the rule.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/scan/__tests__/match.test.ts`
Expected: FAIL, cannot resolve `../match`.

- [ ] **Step 3: Implement `lib/scan/match.ts`** per the rule list, porting `selectPrinting` and `matchDetection` from the spike (lines 150–300 of `tmp/scan-spike/spike/match.ts`) onto the Task 1–4 modules. Keep each filter a small named function so the order reads as the spec's list.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/scan/__tests__/match.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scan/match.ts lib/scan/__tests__/match.test.ts
git commit -m "feat(scan): matcher — stem, identity, then ordered printing filters"
```

---

### Task 6: Catalog golden set

**Files:**
- Create: `scripts/scan-eval/catalog-sample.json`, `scripts/scan-eval/outputs/catalog-sonnet55-low-v4.json`
- Test: `lib/scan/__tests__/golden.test.ts`

**Interfaces:**
- `catalog-sample.json`: array of `{ id, stratum, label: { key, name, set, imgFile, identity, stem } }` — copy `tmp/scan-spike/catalog-sample.json` dropping `enc`/`bytes`.
- `outputs/catalog-sonnet55-low-v4.json`: `{ model, promptHash, arm: { model: 'claude-sonnet-5-5', effort: 'low', tier: 'high' }, recordedAt, rows: [{ id, detections: ScanDetection[] }] }` — built from `tmp/scan-spike/out_v4/c_*.json` (`parsed.cards`, capped with `capDetection`).
- The golden test is the regression gate E1 names: re-record when the prompt, schema or model changes.

- [ ] **Step 1: Write the failing test**

```ts
// lib/scan/__tests__/golden.test.ts
import { describe, it, expect } from 'vitest';
import sample from '@/scripts/scan-eval/catalog-sample.json';
import recorded from '@/scripts/scan-eval/outputs/catalog-sonnet55-low-v4.json';
import { matchDetection } from '../match';
import { getScanIndex } from '../stemIndex';
describe('catalog golden set (148 labeled printings, recorded Sonnet 5.5 reads)', () => {
  const idx = getScanIndex();
  const rows = (recorded as any).rows as { id: string; detections: any[] }[];
  const labelById = new Map((sample as any[]).map(e => [e.id, e.label]));
  it('identity top-1 at least 144 and at most 2 silent wrongs', () => {
    let identityOk = 0, silent = 0, matched = 0;
    for (const r of rows) { const L = labelById.get(r.id)!; const d = r.detections[0]; if (!d) continue; const m = matchDetection(d, {}); const ok = m.identityKey === idx.canonicalIdentity(L.identity); if (ok) identityOk++; if (m.status === 'matched') { matched++; if (!ok) silent++; } }
    expect(identityOk).toBeGreaterThanOrEqual(144); expect(silent).toBeLessThanOrEqual(2); expect(matched).toBeGreaterThanOrEqual(140);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/scan/__tests__/golden.test.ts`
Expected: FAIL, cannot resolve the JSON files.

- [ ] **Step 3: Produce both JSON files** with a one-off node script from the spike folder (do not commit the script). Confirm `rows.length === 148`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/scan/__tests__/golden.test.ts`
Expected: PASS. If identity lands at 143 because of the Task 2 spelling unions, inspect the row; adjust the data fix list in the spec, not the threshold, unless the miss is a dataset error.

- [ ] **Step 5: Commit**

```bash
git add scripts/scan-eval/catalog-sample.json scripts/scan-eval/outputs/catalog-sonnet55-low-v4.json lib/scan/__tests__/golden.test.ts
git commit -m "test(scan): catalog golden set with recorded Sonnet 5.5 reads"
```

---

### Task 7: `lib/scan/prices.ts` and the shared loader in `/api/prices`

**Files:**
- Create: `lib/scan/prices.ts`
- Modify: `app/api/prices/route.ts` (replace its inline pagination with the loader; response unchanged)
- Test: `lib/scan/__tests__/prices.test.ts`

**Interfaces:**
- Produces:
  - `interface PriceRow { card_key: string; price: number; shopify_handle: string | null; shopify_title: string | null; updated_at: string }`
  - `loadPriceRows(client: { from(table: string): any }, pageSize = 1000): Promise<PriceRow[]>` — pages `card_prices` with `.range(offset, offset + pageSize - 1)` until a page is short; `price` parsed with `parseFloat`.
  - `toPriceMap(rows: PriceRow[]): PriceMap` — only finite prices.
  - `loadPriceMap(client = getSupabaseAdmin()): Promise<PriceMap>`.
  - `/api/prices` keeps its exact JSON shape and headers.

- [ ] **Step 1: Write the failing test**

```ts
// lib/scan/__tests__/prices.test.ts
import { describe, it, expect } from 'vitest';
import { loadPriceRows, toPriceMap } from '../prices';
const fakeClient = (total: number) => ({ from: () => ({ select: () => ({ range: async (a: number, b: number) => ({ data: Array.from({ length: Math.max(0, Math.min(total, b + 1) - a) }, (_, i) => ({ card_key: `k${a + i}`, price: String(a + i), shopify_handle: null, shopify_title: null, updated_at: '2026-10-27' })), error: null }) }) }) });
describe('loadPriceRows', () => {
  it('pages past 1000 and stops on a short page', async () => { expect((await loadPriceRows(fakeClient(2500), 1000)).length).toBe(2500); expect((await loadPriceRows(fakeClient(1000), 1000)).length).toBe(1000); });
  it('maps to numbers and drops NaN', () => { const m = toPriceMap([{ card_key: 'a', price: 2.5 } as any, { card_key: 'b', price: NaN } as any]); expect(m).toEqual({ a: 2.5 }); });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/scan/__tests__/prices.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `lib/scan/prices.ts`; switch `app/api/prices/route.ts` to `loadPriceRows(getSupabaseAdmin())`** keeping `revalidate`, the `updated_at` max and the headers exactly.

- [ ] **Step 4: Run the test and the type check**

Run: `npm test -- lib/scan/__tests__/prices.test.ts && npx tsc --noEmit`
Expected: PASS; `tsc` reports no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/scan/prices.ts lib/scan/__tests__/prices.test.ts app/api/prices/route.ts
git commit -m "feat(scan): shared paginated card_prices loader; /api/prices uses it"
```

---

### Task 8: `scripts/scan-eval/score.ts` — labels, scorer, self-tests

**Files:**
- Create: `scripts/scan-eval/score.ts`, `scripts/scan-eval/labels.schema.md` (one paragraph: the label shape from the spec, so Tim can write labels)
- Test: `scripts/__tests__/scan-eval-score.test.ts`

**Interfaces:**
- Produces (exported for tests; `main()` behind `require.main === module`):
  - `interface LabelPhoto { file: string; bucket: string; tags: string[]; otherGame: boolean; cards: { printing: string; setVisible: boolean; inFrame: 'full' | 'partial'; grid?: { row: number; col: number } }[] }`
  - `loadLabels(path: string): LabelPhoto[]` — validates every `printing` against `CARDS` keys and throws listing the unknown ones.
  - `interface Prediction { file: string; detections: (ScanDetection & { match: MatchResult })[]; error?: string; truncated?: boolean }`
  - `scorePhoto(label: LabelPhoto, pred: Prediction | undefined, prices: PriceMap): PhotoScore` — identity-level multiset: `tp = min(labeled, predicted)` per canonical identity; `fn` excludes `partial`; `fp` counts extras; pair classes `matched_correct | matched_wrong | check_top1 | check_in_candidates | check_miss | not_found_miss | hallucination`; printing level only on correct pairs (`setVisible` → `chosenKey === printing`, else defensible) and `silent_wrong_price` when a matched row's price differs from the labeled printing's by ≥ `PRICE_DELTA_FLOOR`; other-game photo: any `matched`/`check` row is `hard_fail`; grid usefulness as cell match.
  - `summarize(scores: PhotoScore[]): Summary` — per bucket: photos, tp, fp, fn, recall, precision, silent wrongs, by class; pooled singles top-1; latency p50/p95 and cost from the prediction records when present.
  - `labelsAsPredictions(labels: LabelPhoto[]): Prediction[]` and `emptyPredictions(labels): Prediction[]` for the self-tests.
  - CLI: `npx tsx scripts/scan-eval/score.ts --labels scripts/scan-eval/labels.json --outputs scripts/scan-eval/outputs/<arm>/ [--photos scripts/scan-eval/photos]` prints the Summary as a markdown table and writes `scripts/scan-eval/outputs/<arm>/score.json`.

- [ ] **Step 1: Write the failing tests**

```ts
// scripts/__tests__/scan-eval-score.test.ts
import { describe, it, expect } from 'vitest';
import { CARDS } from '@/lib/cards/lookup';
import { cardKey } from '@/lib/scan/vocab';
import { scorePhoto, summarize, labelsAsPredictions, emptyPredictions, loadLabelsFrom } from '@/scripts/scan-eval/score';
const k = (n: string) => cardKey(CARDS.find(c => c.name === n)!);
const labels = [
  { file: 'a.jpg', bucket: 'single', tags: [], otherGame: false, cards: [{ printing: k('Captive Priest'), setVisible: true, inFrame: 'full' as const }] },
  { file: 'b.jpg', bucket: 'spread', tags: [], otherGame: false, cards: [{ printing: k('Captive Priest'), setVisible: false, inFrame: 'full' as const }, { printing: k('Son of God [L]'), setVisible: false, inFrame: 'partial' as const }] },
  { file: 'c.jpg', bucket: 'none', tags: [], otherGame: true, cards: [] },
];
describe('scorer self-tests', () => {
  it('labels as predictions score 100%', () => { const s = summarize(labels.map((l, i) => scorePhoto(l, labelsAsPredictions(labels)[i], {}))); expect(s.pooled.recall).toBe(1); expect(s.pooled.fp).toBe(0); expect(s.pooled.silentWrong).toBe(0); });
  it('empty predictions score zero recall and no false positives', () => { const s = summarize(labels.map((l, i) => scorePhoto(l, emptyPredictions(labels)[i], {}))); expect(s.pooled.recall).toBe(0); expect(s.pooled.fp).toBe(0); });
  it('a matched row on an other-game photo is a hard fail', () => { const p = labelsAsPredictions(labels)[0]; const s = scorePhoto(labels[2], { ...p, file: 'c.jpg' }, {}); expect(s.hardFail).toBe(true); });
  it('partial cards do not count as misses', () => { const p = labelsAsPredictions(labels)[1]; p.detections = p.detections.slice(0, 1); expect(scorePhoto(labels[1], p, {}).fn).toBe(0); });
  it('unknown printing keys are rejected on load', () => expect(() => loadLabelsFrom([{ ...labels[0], cards: [{ printing: 'No|Such|Key', setVisible: true, inFrame: 'full' }] }])).toThrow(/No\|Such\|Key/));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- scripts/__tests__/scan-eval-score.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `scripts/scan-eval/score.ts`** (`loadLabelsFrom(json)` does the validation; `loadLabels(path)` reads then calls it). Harness rules from the spec: records with `error` are counted in an errors tally and never as misses; `truncated` rows are excluded from accuracy.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- scripts/__tests__/scan-eval-score.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/scan-eval/score.ts scripts/scan-eval/labels.schema.md scripts/__tests__/scan-eval-score.test.ts
git commit -m "feat(scan-eval): scorer with multiset identity scoring and self-tests"
```

---

### Task 9: `scripts/scan-eval/run.ts` — the E0 runner against the deployed route

**Files:**
- Create: `scripts/scan-eval/run.ts`
- Test: `scripts/__tests__/scan-eval-run.test.ts`

**Interfaces:**
- CLI: `npx tsx scripts/scan-eval/run.ts --base-url https://<preview>.vercel.app --cookie "$(cat .scan-session)" --photos scripts/scan-eval/photos --arm '{"model":"claude-sonnet-5-5","effort":"low","tier":"high"}' --out scripts/scan-eval/outputs/sonnet55-low-high [--concurrency 2] [--only <glob>]`
- Posts each photo as `multipart/form-data` field `photo` plus `arm` (JSON string) and `source=eval` to `POST ${baseUrl}/api/scan` with the `Cookie` header (the `verify` skill mints the superuser session); writes one `<file>.json` per photo with the route's response plus `{ latencyMs, status, attempts }`; skips files already present; on HTTP 429/503 with `Retry-After` sleeps and retries up to 5 times; on other non-200 writes `{ file, status, body }` to `errors.jsonl` and continues; prints a running cost total from `usage` when present.
- Exported for tests: `parseArgs(argv: string[]): RunOptions` and `recordFor(file: string, res: { status: number; headers: Headers; json: unknown }, latencyMs: number, attempts: number): RunRecord`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/__tests__/scan-eval-run.test.ts
import { describe, it, expect } from 'vitest';
import { parseArgs, recordFor } from '@/scripts/scan-eval/run';
describe('run.ts', () => {
  it('parses the arm and defaults', () => { const o = parseArgs(['--base-url', 'https://x', '--cookie', 'c', '--arm', '{"model":"claude-haiku-5-5"}']); expect(o.arm.model).toBe('claude-haiku-5-5'); expect(o.concurrency).toBe(2); expect(o.source).toBe('eval'); });
  it('a 200 becomes a record, a 429 is not a miss', () => {
    expect(recordFor('a.jpg', { status: 200, headers: new Headers(), json: { scanId: 's', detections: [], usage: { model: 'm' } } }, 1200, 1).detections).toEqual([]);
    expect(recordFor('a.jpg', { status: 429, headers: new Headers({ 'retry-after': '5' }), json: { code: 'upstream_rate_limit' } }, 10, 3).error).toBe('upstream_rate_limit');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- scripts/__tests__/scan-eval-run.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `scripts/scan-eval/run.ts`** (Node 20 `fetch` and `FormData`/`Blob`; no new dependency).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- scripts/__tests__/scan-eval-run.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/scan-eval/run.ts scripts/__tests__/scan-eval-run.test.ts
git commit -m "feat(scan-eval): runner that drives the deployed route with an arm override"
```

---

### Task 10: Whole-package checks, git-ignores, PR

**Files:**
- Modify: `.gitignore` (add `scripts/scan-eval/photos/` and `scripts/scan-eval/outputs/*/` except the committed `catalog-*.json`), `CLAUDE.md` Key References table (one row: Card scanner → spec, `lib/scan/`, `scripts/scan-eval/`).

- [ ] **Step 1: Run everything**

Run: `npm test -- lib/scan scripts/__tests__/scan-eval && npx tsc --noEmit`
Expected: all green; no new `tsc` errors.

- [ ] **Step 2: Commit the ignores and the reference row**

```bash
git add .gitignore CLAUDE.md
git commit -m "chore(scan): ignore eval photos and outputs; reference row"
```

- [ ] **Step 3: Open the PR**

Push `feat/scan-matcher`; `gh pr create --base main --title "feat(scan): matcher, cue table, price loader and eval harness (PR A)" --body` with: what is in the package, the golden-set numbers, that nothing is wired to a route or page yet, and the attribution footer. Remove the worktree after merge.

---

## Self-review notes

- Spec coverage: Transcription fields → Task 3; The matcher steps 1–6 → Tasks 1, 2, 5; Printing selection → Task 5 (every named reason appears in `PrintingReason`); cue table and builder → Task 4; prices loader → Task 7; labels/scoring/harness rules → Tasks 8–9; catalog golden set → Task 6. Not in this plan, by design: `recognize.ts`, `gate.ts`, route, migration (PR B); page, commit, undo (PR C); `queries.sql`, `export.ts` (PR B, they need the tables).
- Names used across tasks: `ScanDetection`, `ScanOutput`, `capDetection`, `parseScanOutput` (Task 3) are what PR B's `recognize.ts` consumes; `matchDetection`, `MatchResult`, `Candidate`, `PriceMap`, `loadPriceMap` (Tasks 5, 7) are what PR B's route consumes; `PROMPT_HASH` is what the harness records.
- Review Focus tests live in Tasks 1, 4 and 5 as listed.
