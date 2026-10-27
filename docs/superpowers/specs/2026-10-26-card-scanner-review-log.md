# Card scanner — adversarial review log

Companion to `2026-10-26-card-scanner-design.md`. Three rounds, fourteen
reviewers, each a fresh agent with a single lens, read-only against the
spec and the codebase at `origin/main`. Each round's findings were
folded into the next revision; rejections are recorded with reasons.
Later entries will hold E0 numbers and scoresheet resolutions.

## Round 1 (2026-10-26) — rev 1 → rev 2

Reviewers: a study of the community tool's source; a recognition and
evaluation adversary with measurements over `cardData.json`; a product
and slot-in adversary; a security, cost and operations adversary; a
builder check.

**Community-tool study.** Single 2,829-line `index.html`; picture-first
matching with 420-byte color-layout descriptors and a sureness ratio,
then Tesseract PSM 7 on the title band with lexicon repair; identity =
Shopify handle (3,688 names, 5,219 printings, YTG listing only); "Read
name with Claude" uses the Artifacts runtime and is hidden on GitHub
Pages; "Teach this" learns card *type* per phone; about 7 MB first load;
no accuracy numbers anywhere. Implications adopted: printing is the hard
problem; Lost Souls need the verse; bbox or crop quality is load-bearing
for confirmation; a vision model's failures are plausible names, so ask
for type and brigade; default rules must not pick promos.

**Recognition adversary.** Names embed the printing (5,681 names, 3,494
case-folded stems, 64% of printings share a stem, 31% have an unsuffixed
twin); `CARD_BY_NAME_LOWER` private and last-wins; Lost Souls
unidentifiable by title; set icons unreadable at 1568 px in a 12-card
spread; `searchCardNames` unscored; 40-photo gates too weak (binomial
intervals); cost understated 1.6× once output and thinking are counted;
grid positions over pixel boxes.

**Product adversary.** Two modes resolved the same photo differently and
"Save as collection" wrote the price-mode guess; increment with no owned
quantity and no undo; `bulkImportCollectionAction` merge already exists;
wrong printing slow to fix later; sessionStorage cannot hold thumbnails;
iOS `capture` ignores `multiple`, HEIF on Android, 48 MP decode; nine
elements per row at 390 px; amber on half the rows; a second primary on
`/collection`; admin page needs the permission pattern and nav links;
migration 121 taken; Add to Haves is one call away.

**Security adversary.** Count-then-call cap racy for the whole model
latency, no global cap, bare sign-up; "users insert their own" lets
anyone forge events, and no UPDATE policy; SDK default retries;
`maxDuration`; private Blob needs a private store and a proxy; sharp
re-encode server-side; the credit is a personal perk and the listings
cron shares the key; detections can hold personal text; purge semantics;
`max_tokens` and thinking; rate tier unknown; prompt caching won't pay;
PostgREST `.in()` quote trap; 413 handling; no `temperature`.

**Builder check.** Printing unit is identity groups, not `name`; no fuzzy
matcher exists; where opted-in photos live; "newest printing" has no data
source; false claims listed (migration number, private map, BuyDeckModal
builds cart URLs, image sizes not uniform); retired Sonnet 4 in
`scripts/run-claude-matching.ts`.

**Changed in rev 2:** matching on stems and identities; Lost Souls by
reference; corroborating fields transcribed; real fuzzy matcher; measured
second look; modes removed; owned quantity, no checkboxes, merged
duplicates, undo, post-commit printing change; commit through the merge
import; tray without images; capture realities; higher resolution with
grid positions; reserve-first caps with a global ceiling; no
INSERT/UPDATE for `authenticated`; superuser pattern; dedicated scanner
key; server-side sharp; private store, image proxy, daily purge;
migration 122; eval set grown with non-card photos, multiset scoring,
precision gate, intervals; cost table with output tokens; prior-art
paragraph corrected.

**Rejected or deferred:** art tiebreaker in v1 (unmeasured crop quality);
legend image in every prompt (E0 arm only); the reviewer's higher global
caps (exceed the credit); 20 to 30 card spreads as a target (measured
bucket only).

## Round 2 (2026-10-27) — rev 2 → rev 3

Reviewers: a consistency auditor; a data scientist who prototyped the
matcher against the dataset and the live price map; a product designer
and accessibility reviewer walking three personas; a platform engineer
verifying library and browser claims; an evaluation designer.

**Consistency auditor (20 defects).** Second look uncapped and
uncounted (could exceed the credit alone); detections storage rule
contradicted the purge; "from $X" contradicted the equivalent rule;
rules 3 and 4 interacted so any card with a priced promo stayed amber;
`cardNameStem` does no case folding; stem counts off; Lost Soul step
underspecified (dataset names embed the verse; bracket can disagree with
`reference`); `printingsForKey` returns non-unique names; one reason
field for compounding stages; null vs `UNREADABLE`; outcomes per scan
id; `putItems` overwrites; prices RPC duplicated `/api/prices`;
`is_superuser()` is a fixed-uid check; legend location; type vocabulary;
no privacy page; `maxDuration` budget; cost table input column; minor
items (Aaron has four printings, `sendCronAlert` is failure-only, mixed
windows, Forge store reachability, `get` needs store options,
`searchCardNames` hits carry no key, Files omissions, "613 stems"
undefined, `rotated` loses upside-down, `max_tokens` misfire).

**Matcher data prototype.** `cardIdentityKey` splits 43 true reprints
by `class` spelling and the stem index keeps 47 spelling variants apart;
795 multi-printing identities, 319 amber under the collapse alone, 93
after the special-printing filter, 64 after Rotation as a filter;
promo/AB/Legacy/UR+ definitions from data (Fundraiser is promo by
rarity; UR+ exists; no foils); cards print a corner number and rarity
code that `imgFile` encodes; Lost Souls: 32 references shared, nickname
badge resolves most, dataset typos listed; 959 homonym stems, 929
separable by reference+ability+type+brigade, 947 with stats and
identifier; fuzzy: 131 stems at distance 1, nine distance-1 pairs are
different cards; set legend must key on `officialSet` (49) with no
release years anywhere; vocabulary mapping needed (257 brigade strings);
price-map gaps (T2C AB unpriced).

**Product and accessibility (second pass).** Hourly burst cap walls a
shoebox evening; Add to Haves before commit flags every row; the CSV
modal pattern has no focus trap; View collection lands on the Limited
filter and hides added cards; price should be on line one; failure rows
need Retry and Remove; the `/collection` header cannot take a sixth
button; Not found should open the picker; undo semantics; binder pages;
desktop drop target and table; set completion per `officialSet`; no
privacy page; "worth" vs "to buy" framing; a full copy table and
accessibility specifics.

**Platform verifier.** `@vercel/blob` `get` private streaming, two
stores, `list` pagination, `del` arrays verified; SDK `output_config`
verified; schema cannot carry length bounds; 28-pixel-patch rule with the
4,784 cap (4:3 → 2212 × 1659); thinking unbounded and SDK cannot
attribute it (refutes the `max_tokens` → too many cards mapping);
`maxDuration` fine; `formData()` fine; sharp in routes already; WebKit
drops EXIF on `createImageBitmap(Blob)` (refutes the client decode
path); HEIC and `accept`; iOS resets `input.files`; sessionStorage quota;
082's definer RPC pattern and 120's grant footer; WAF and cron on Pro;
Anthropic retention copy overstated.

**Evaluation designer.** Gates cannot use lower bounds at n = 25;
pre-registered (unit, n, pass count, false-pass odds); label schema and
position-free multiset scoring with a silent-wrong class; other-game
photos should yield `not_found`; E0 circular if the matcher is tuned on
the same photos (model-only vs matcher metrics; dev set); 637 requests
as written, staged design about 410; crop usefulness needs grid labels;
E3 denominators, abandonment, rejected rows, weekly audit sample;
calibration rules; drift and paired acceptance; the probability table
mixed rates and probabilities (Brier sheet instead); kill criteria need
windows and minimum n.

**Changed in rev 3:** everything above except the rejections; see the
rev 3 review log section (preserved in git history at the rev 3 commit).

**Rejected or deferred:** Add to Wants and Recent scans (v1.2);
dropping prices from candidates (the rules need them); higher global
caps; treating Fundraiser as standard.

## Round 3 (2026-10-27) — rev 3 → rev 4

Reviewers: a consistency auditor on the rewrite; a builder check; a red
team on scope and failure modes; a readability editor.

**Consistency auditor (19 defects).** Route order had the matcher before
prices; the per-user advisory lock cannot serialize the global cap;
`components/ui/dialog.tsx` is hand-rolled (no focus trap, no Radix dep);
"two calls per photo" ignored retries (four billed attempts) and the
duration budget; second-look cost understated 2.5× (six rows ≈ 9,200
image tokens); "$90 realistic" below the no-second-look floor and Goal 6
contradicted the planned exhaustion; cap table vs copy (no global
monthly string; per-user 30 d equal to global 30 d); "about 410" was
455 to 525; promo count 248 and UR+ 6 under the stated definitions, and
the print-number claim unreproducible without an extraction rule; row
width budget left 0 px for Remove; `printing_ambiguous` fires on
legality too; `?format` param does not exist; confidence chip referenced
but never defined; Files omissions; Haiku claim vs drop rule; "at least
four" vs six true non-card; ambiguities (enlargement, second-look
re-selection, toggle-off, who retries, fuzzy rows' set, cap list, token
types); audit precision arithmetic; 1,564 tokens.

**Builder check.** Must product code wait for E0 (70% of the build does
not depend on it)? Privacy copy "we keep nothing" is false while
detections are stored; dialog dependency choice; Lost Soul fixes belong
in the catalog override, not migration 122, and reshape identity unions;
global cap race; soft launch; false claims (`searchCardNames` names are
stems so `findCard` by name fails, UR+ 6, 082 lock key, merge import
cannot decrement, no shared price loader, `forgeAuth` not exported,
`importRows` typed on the deck-builder `Card`, `/collection` reads no
URL params); an 18-task breakdown in worktree lanes; a three-PR cut.

**Red team.** Production usage pulled read-only: 622 accounts, 81 active
in 30 days, 36 ever added a collection row, 7 touched one last month, 1
trade list. Failure stories: nobody comes and every post-launch
mechanism starves; quietly wrong printings nobody can detect without
photos; slower than typing on Opus with thinking. Scope cut to v1.0 /
v1.1 / v1.2 with a PR series; a thin slice before E0; the deck builder
as the front door with "see what your cards are worth"; Sonnet baseline
under a latency budget; price-delta floor on amber; commit idempotency;
sharp `limitInputPixels`; two dated audits instead of weekly; a removal
clause; Tim's hours (12 to 15 pre-launch); over-engineering list (five
caps, Opus, calibration, legend, second look, Haves, 15 claims).

**Readability editor.** Surfaces line and "How to read this"; table of
contents reordered; dataset numbers quoted once; field list, special
classes, errors and kill criteria as tables; redundancy cuts; vocabulary
rules (Check this as status, amber as color; tray; `class` column vs
special printings; tier vs arm); review log to a sibling file with an
outcomes table inline; American spelling; title style.

**Changed in rev 4:** all of the above except the rejections.

**Rejected or deferred:** a new Radix dialog dependency (local focus
trap instead); a weekly audit (two dated audits); dropping `confidence`
from storage (stored, not shown); Opus baseline (Sonnet under a budget,
Opus by exception); building the admin page in v1.0 (SQL via MCP
instead).

## Round 4 (2026-10-27) — rev 4 → rev 4.1

Reviewers: a consistency auditor on rev 4; a builder check planning
v1.0 only.

**Builder check.** E0's requests would run through the player caps and
seed the live metrics (needs an eval source the RPC and queries skip,
and migration 122 on production before E0); E0 arms cannot reach the
route without a superuser override on the request; `commitId` had no
store and two racing commits both pass (needs an insert-first
`scan_commits` table, which also makes undo server-authoritative);
Sonnet 5.5 and Haiku 5.5 can turn thinking off at effort high or below
(the constraint overstated it; worth an E0 arm), and stage 1 was not
paired on effort; `CARDS` must come from `lookup.ts` for the legality
overrides; `/collection` is page-gated, not middleware-gated;
`adjustCollectionQuantitiesAction` must delete at zero; `owned` on
candidates duplicates `useCollectionState`; PR cut: price loader to A,
split C into core and entry, golden tests after E0; a 29-task breakdown
in three worktree lanes.

**Consistency auditor (16 defects).** Stage 1 "default effort" differs
per model; the photo cap bounds photos, not tokens (a retried photo can
bill about $0.50, so Goal 6 needed a spend ceiling); `calls` vs
`attempts`; undo at zero violates the table's check; page and route
gates described separately; `added` carried scan ids with no path to
keys; cross-photo duplicates undefined; retry budget read two ways;
`image_*` columns' timing; second-look token arithmetic; print-number
counts (1,750 bare, 2,022 under the rule, 2,548 unreproducible); v1.1
reason values untagged; three dataset numbers quoted without rows;
outcomes-table section names; three round-3 rejections missing from the
inline list; `run.ts` authentication unstated. Everything else,
including every dataset count and every code claim, verified.

**Changed in rev 4.1:** all of the above.

**Rejected or deferred:** none this round.

## Scoresheet resolutions

To be filled at each resolution date: claim number, outcome, date,
source, and the Brier contribution.

## E0 results

To be filled after the run: arms, screens, intervals, decisions on
model, effort, tier, crops and second look.
