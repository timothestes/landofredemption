# Card scanner — design

Date: 2026-10-26; rev 4.4 on 2026-10-27 after four review rounds
(sixteen reviewers; outcomes at the end, full log in
`2026-10-26-card-scanner-review-log.md`), a throwaway spike against
83 real photos and 148 catalog images, a second pass on Tim's review of
its output, and a versions pass with two more adversaries (E0 preview,
under Evaluation). Not yet approved.

**Surfaces:** `/collection` (toolbar, first-run banner), the deck
builder's owned-cards filter and Check my collection modal (entry links),
`/collection/scan`, `POST /api/scan`, `/privacy`, migration 122. v1.1
adds `/admin/scans`, `/admin/scans/image/[id]` and
`/api/cron/purge-scans`.

**How to read this.** Approving: Intent, Scope, Goals through Anti-goals,
Calls I made, Rollout. Building: Recognition and The flow are the
behavior, Data is the contract, Copy is the strings, Files is the map;
Evaluation gates every model-facing choice. Every dataset number is
quoted once, in Dataset numbers, and referenced by name elsewhere. Items
tagged **v1.1** or **v1.2** are designed here but not built first.

## Intent

Players own shoeboxes of Redemption cards and no fast way to get them
into the site's collection tracker, or to learn what a card sells for,
without typing names one at a time or hand-building a CSV. This feature
lets a signed-in player photograph one card or a flat spread of cards,
get the cards recognized, confirm or fix the matches on a tray, and add
them to their collection in one tap, with each card's Your Turn Games
(YTG) price and the running total always in view.

The inspiration is banana346-cyph's "redemption scanner". It proved
players want this, and its source showed the hard problem is telling
printings apart, not reading titles. Ours differs on every axis that
matters: account-backed, server-side recognition so every phone behaves
the same, every printing in the dataset, SKU-level YTG prices, and each
correction becomes labeled evaluation data. Details under "Why not the
alternatives first".

It is a slot-in: it reuses the collection tracker, the merge import, the
price cache and product links, the card identity module, the house
dialog and the card components; Files lists the additions.

**Who this is for, honestly.** Production on 2026-10-27: 622 accounts, 81
signed in within 30 days, 226 within 90; 36 players have ever added a
collection row (24 with 50 or more keys, 16 with 300 or more); 7 touched
a collection in the last 30 days; 1 player has a trade list; 4,900 of
5,693 printings are priced. The addressable audience is small, which is
why Scope cuts hard, why the front door is the deck builder and not only
`/collection`, and why there is a removal clause.

## Vocabulary

- **Photo**: one image the player captured or picked; one card or a flat
  spread.
- **Detection**: one card the recognizer believes is in a photo, with the
  transcribed fields in Recognition.
- **Stem**: the printed title with the dataset's printing decorations
  removed. `cardNameStem(name, type)` in `lib/cards/cardIdentity.ts`
  strips trailing bracketed groups and, except on Lost Souls, a trailing
  nickname: "Son of God (J)", "Son of God [K]" and "Son of God
  [Fundraiser]" share the stem "Son of God". It does not fold case,
  quotes or punctuation; the scanner's stem index does.
- **Identity**: the card a player would say they own regardless of
  printing. `cardIdentityKey` groups printings by stem plus type,
  brigade, alignment and `class` column, then unions on ability text or a
  shared scripture reference. It splits some true reprints that differ
  only in the `class` column's spelling; the matcher merges those back.
- **Printing**: one row of `CARDS`, identified by the app-wide card key
  `name|set|imgFile`, the key `collection_cards` and `card_prices` use.
  Printings of one identity are enumerated as
  `CARDS.filter(c => cardIdentityKey(c) === key)`; `printingsForKey`
  returns names, and names are not unique.
- **Special printings**: promos, AB reprints, Legacy Rares and UR+
  printings, defined from the data in Printing selection.
- **Candidate**: a printing a detection may be.
- **Tray**: the matched cards accumulated across photos in one session.
- **Commit**: writing the tray to the collection.
- **Matched / Check this / Not found** are row statuses; `matched` /
  `check` / `not_found` are their data values. "Amber" is only a color.
- **Tier** is the resolution the server encodes a photo to; **arm** is
  one condition in an evaluation run.

## Dataset numbers

Measured on 2026-10-27 against `cardData.json` and the live price map.
Prose elsewhere cites these by name.

| Quantity | Value |
|---|---|
| Printings | 5,693 |
| Distinct names | 5,681 |
| Names with two rows | 12 |
| Stems (`cardNameStem`) | 3,521 |
| Stems after normalization (case, quotes, punctuation) | 3,452 |
| Identities (`cardIdentityKey`) | 4,769 |
| Stems with two or more printings | 1,444 (3,616 printings, 63.5%) |
| Stems with an unsuffixed twin (a plain name plus decorated ones) | 757 (1,706 printings, 30.0%) |
| Homonym stems (more than one identity, excluding Lost Souls) | 959 (2,569 printings, 45%) |
| Homonym stems separable by reference, ability, type, brigade | 929 |
| Same, adding strength/toughness and identifier | 947 |
| Spelling-variant stem pairs within edit distance 2 sharing reference and type | 47 stems |
| Reprint identities split only by the `class` column's spelling | 43 pairs |
| Identities with more than one printing | 795 (1,719 printings, 30.2%) |
| Of those, printings differ in price or legality, no rules applied | 319 (708 printings, 12.4%) |
| Same, after the special-printing filter | 93 |
| Same, after the Rotation filter too | 64 (153 printings, 2.7%) |
| Identities with both a promo and a standard printing; promo pricier | 67; 62 (median gap $14, max $255) |
| Promo printings (definition in Printing selection) | 248 (245 excluding tokens) |
| Fundraiser printings (counted within promo) | 40 |
| Promos filed under `GoC`/`LoC` (counted within promo) | 9 |
| AB printings (`set` ends `(AB)`, equals `abMap.json`) | 387 |
| Legacy Rare printings | 72 |
| UR+ printings (`imgFile` ends `-UR+`) | 6 |
| Rotation-legal printings | 3,190 |
| Rotation printings whose `imgFile` starts with a bare print number | 1,750 |
| Same, under the Printing selection rule (adds `LoC_`-style prefixes); letter-prefixed codes pending E0 | 2,022 |
| Lost Soul printings / identities | 263 / 170 |
| Lost Soul references shared by more than one identity | 32 (69 identities) |
| Reference errors found so far (catalog override) | 6 (one to verify) |
| Identity unions the scanner adds on top of `cardIdentityKey` (AB pairs; class or decoration splits sharing a reference) | 78 |
| Multi-printing identities after those unions / their printings | 851 / 1,839 |
| Printings identical to a sibling on every transcribed field (data adversary) | 512 classes, 1,060 printings; 279 classes (590 printings) survive the filters, 273 within the price floor, 162 of them unpriced; survivors' silent value about $0.50 |
| Promo printings above their cheapest standard sibling | 77 priced pairs, median +$22, max +$288, sum $4,941 |
| Legacy Rare above standard; UR+ above standard | 38 pairs, median +$2, sum $160; 6 pairs, +$20 each |
| Per-printing cue table from catalog images (credit, © year) | 1,839 printings; credit read on all; year on 441, 2023-and-later sets only |
| Multi-printing identities whose printings carry different credits | 103 |
| AB pairs with different art / different credit / different year | 38 / 10 / 128 (T2C only, 2025 against 2026) of 387 |
| Printings with a corner code after the parser fixes | 2,652 |
| Stems with another stem at edit distance 1 / 2 | 131 / 389 |
| Stems of five characters or fewer; of those with a neighbor within distance 2 | 170; 147 |
| Different cards at distance 1 / 2 that type and brigade cannot separate | 9 / 42 |
| Set codes / official sets / `[Ban]` marker codes | 55 / 49 / 6 |
| Distinct `brigade` strings | 257 |
| Cards with a `reference` value | 5,687 |
| Priced printings (live price map) | 4,900 |

## Scope

**v1.0 (build first):** photograph, confirm, committed with prices.
Capture and client resize; the route with reservation, caps, sharp,
recognizer and matcher; print-number hint, special-printing and
Rotation filters, collapse with a price-delta floor; Lost Soul and
homonym resolution; guarded fuzzy; tray, chips, picker, footer;
idempotent commit through the merge import; undo; outcomes recorded;
entry links on `/collection` and in the deck builder; Beta label;
`/privacy`; eval harness and E0 stages 0 to 3 and 7; two dated audits;
soft launch.

**v1.1:** second look; crops and bounding boxes; set marking, set icon,
border and copyright fields with the set legend; photo retention toggle,
private Blob, purge cron, admin image proxy; `/admin/scans` and the cost
digest; one-tap labeling page; desktop drop target, table layout,
keyboard; Add to Haves; Copy priced list; post-commit Change printing
and the collection modal's Change printing; Beta as an env boolean.

**v1.2:** Stage A2 art tiebreaker; Add to Wants; Recent scans; deck
scanning.

**PR series for v1.0:** A `lib/scan` matcher, vocabulary, stem index,
schema, recognizer, the shared price loader and the eval harness (pure
code, no migration; golden tests follow E0 in a small follow-up);
B migration 122, `scan_reserve()`, the gate module and `POST /api/scan`,
gated to superusers; migration 122 is applied to production, then E0
runs through B on a preview deployment; C-core the scan page, tray,
picker, commit and undo; C-entry the `/collection` and deck-builder entry
links, `/privacy` and the small shared-file edits (kept separate because
those files are hot for sibling agents); then the gate opens to the
allowlist and then to everyone.

What the cut loses: "fixable after commit" degrades to the quantity
controls on `/collection` until v1.1; photo retention and the admin
table wait, so the day-14 and day-45 audits label from a SQL export plus
photos Tim and the allowlisted testers keep themselves. No anti-goal is
violated: E0 still gives a measured number before launch; no photo is
retained.

## Goals

1. From the phone camera to a reviewed, committed tray of a dozen cards
   in under a minute, with a per-photo latency budget that chooses the
   model (Cost and latency).
2. Name recognition good enough that the player corrects the exception,
   not the rule: measured in E0 as a screen and certified after launch by
   dated audits.
3. Printing chosen sensibly when the photo does not settle it, marked
   only when the choice matters (price or legality differ), and fixable
   in one tap during commit.
4. Bulk-friendly: many photos per session, many cards per photo, nothing
   important lost on a page refresh, commit whenever, undo after.
5. Every scan, correction, rejection and abandonment recorded as
   structured data so quality is observable and the evaluation set grows
   for free.
6. Spend bounded by construction: every model call is reserved against
   photo caps and a 30-day spend ceiling set below the Max plan's
   monthly credit (Reserve first), so no sequence of requests can exceed
   it.

## Non-goals

- On-device recognition or offline use.
- Prices from anyone but YTG.
- A trade flow. Trade lists exist; v1.1's success state can add
  committed cards to Haves and stops there.
- Scanning a deck into the deck builder (v1.2).
- A live viewfinder. The native camera is the viewfinder.
- Condition grading, counterfeit detection.
- Signed-out use. Wanted, but the anonymous rate limiter is dead
  (Constraints).

## Anti-goals

- A scanner that is confidently wrong. A vision model fails differently
  from OCR: OCR produces garbage you can distance-match, a vision model
  produces a plausible real card name. Every corroborating field below
  exists for this reason, and "silent wrong identity on a Matched row" is
  the number E0 and the audits gate hardest.
- A heavy page. Nothing recognition-related ships to the phone.
- Photos retained without the player saying so.
- A second collection. The tray is temporary; the durable store is
  `collection_cards`.
- Shipping without a measured accuracy number.
- A feature that can quietly spend money.
- A feature that lingers unused. The removal clause (Evaluation) says
  when it goes and how cheaply.

## Constraints

- **Recognition runs on Claude vision.** The app's key was rotated on
  2026-10-26 to the Max-plan organization (Tim's Individual Org), which
  receives $100 of API credit a month; unused credit expires monthly and
  the org has no card on file, so overrun is an outage, not a bill. The
  scanner gets its **own key in its own workspace** in that org (env
  `SCANNER_ANTHROPIC_API_KEY`) so its spend is visible by itself and
  revoking the key is an instant, no-deploy kill switch. The listings
  cron (Haiku, once a day, negligible) draws on the same credit.
- **Vercel function bodies are capped at 4.5 MB.** Above it Vercel
  answers before the route runs with a `text/plain` 413 and the header
  `x-vercel-error: FUNCTION_PAYLOAD_TOO_LARGE`; the client branches on
  that header.
- **The Upstash rate limiter is uninstalled.** Caps are enforced in
  Postgres per user and globally, which is why scanning requires
  sign-in. A Vercel WAF rate rule on `POST /api/scan` (about 30 per
  minute per IP; counters are per region) is belt and braces, not the
  control.
- **Identity is per printing in storage**, but ownership elsewhere is
  name-level ("Cards I own", "Check my collection" count any printing).
  A wrong printing does not break those views; it skews set completion
  (per `officialSet`) and the "to buy at YTG" total on `/collection`.
- **Printed titles carry no set.** A modern card prints: a corner print
  number with a rarity code ("81 UR", "LR65", "250"), a copyright year, a
  set icon, a border look that varies by set (Crown of Thorns AB is
  borderless; Tribulation to Conquest AB is a darker framed border), the
  scripture reference, strength and toughness, and an identifier badge
  ("Generic", "Idol"). Lost Souls are all titled "Lost Soul"; modern
  frames add a nickname badge ("Speed Bump", "Shut Door"). Redemption has
  no foils.
- **Dataset vocabulary is not printed vocabulary.** `type` values are
  codes (`GE`, `EE`, `GE/EE`, `Hero`, `Evil Character`, `Hero/Evil
  Character`, `Dominant`, `Artifact`, `Fortress`, `Site`, `City`,
  `Curse`, `Covenant`, `Lost Soul`, the three `… Token` types, slash
  combinations); `brigade` has 257 distinct strings; references use Roman
  numerals for numbered books ("II Timothy 2:26"). `lib/scan/vocab.ts`
  owns the mapping.
- **Blob card images are roughly 344 × 512 JPEGs**, not uniform.
- **Mobile first**, per CLAUDE.md. Design system:
  `prompt_context/design_system.md`; green is the single accent; amber
  is for warnings only.

## Recognition

### Transcription fields

One Claude request per photo returns structured JSON. For each card it
can see, the model transcribes exactly as printed, with `null` for
anything it cannot read. Schema types are `["string","null"]`; every
object has `additionalProperties: false` and `required`; no length or
numeric bounds (the API rejects them), so caps are enforced in code.

| Field | Transcribed as | Used by |
|---|---|---|
| `title` | the title band | stem lookup |
| `reference` | the scripture line | identity scoring; Lost Soul path; fuzzy guard |
| `nickname` | the Lost Soul badge | Lost Soul path |
| `abilityStart` | first six words of the special ability | identity scoring (last) |
| `abilityEnd` | last four words of the special ability | printing tiebreak where printings of one card differ only in the tail (Lost Souls Two Liner against Three Liner) |
| `promoText` | any tournament, event, placement or promotional text anywhere on the card, as printed ("25th Annual Redemption National Tournament, Knoxville, TN, August 1-3, 2019", "2nd Place Promo", "Redemption Gift Set") | promo printing hint; placement and year narrow it |
| `illustrator` | the artist credit line near the bottom, as printed ("Illus. © Cahaba Productions", "Illus. AI Generated") | version tiebreak against the per-printing cue table; read on 97% of single-card photos |
| `copyrightYear` | the four-digit year in the copyright line | version tiebreak against the cue table; printed only on 2023-and-later printings |
| `type` | icon-box type as printed (Hero, Evil Character, Enhancement, Lost Soul, Dominant, Site, Fortress, Artifact, Covenant, Curse, City, token, unknown) | identity scoring; Lost Soul routing |
| `brigade` | frame color words | identity scoring |
| `strength`, `toughness` | the two numbers top-left | identity scoring |
| `identifier` | the small badge text | identity scoring |
| `printNumber`, `rarityCode` | corner number and letters ("81", "UR+"; "LR65" is number "65", code "LR"); promo text printed in that corner ("State Promo", "2022 1st Place Promo National Tournament", a bare "P") goes in `rarityCode` | printing hints: number, UR+, LR, promo text |
| `grid` | row and column in reading order | ordering; crops (v1.1) |
| `orientation` | upright, rotated, upside-down | information |
| `confidence` | high, medium, low | stored; shown nowhere unless calibration earns it a chip |
| `setMarking`, `setIconNote` | **v1.1** | set legend hints; `border` and a free-text set-icon field were tried and rejected (E0 preview) |
| `bbox` | **v1.1**, normalized | crops |

Plus `photoQuality`: ok, blurry, dark, glare, too_many_cards, no_cards.

### The Claude call

`lib/scan/recognize.ts`, server only. Client
`new Anthropic({ apiKey: SCANNER_ANTHROPIC_API_KEY, maxRetries: 0,
timeout: 25_000 })`; one manual retry on 5xx, 529 or timeout, never on a
refusal; so a photo is at most two billed attempts in v1.0 (the event's
`attempts` column records them). `export const maxDuration = 90` on the
route.

- `messages.create` with the image as a base64 block after a fixed
  instruction block. Model, effort and thinking mode from constants:
  baseline `claude-sonnet-5-5` (Cost and latency says why) at `low`
  effort, thinking at the model's default unless E0's thinking-off arm
  wins. A superuser-only `arm` field on the request (model, effort,
  tier, thinking) overrides the constants for E0 and is ignored for
  everyone else. No `temperature` (rejected on these models), no
  `cache_control` in v1
  (the instruction and schema measure about 1,880 input tokens in the
  spike, so caching is possible, but traffic is too sparse for the
  five-minute window; E0 confirms with `cache_read_input_tokens`).
- Structured output through `output_config.format` with the JSON schema
  in `lib/scan/schema.ts`; no tools.
- **Image tokens follow the 28-pixel-patch rule**, `⌈w/28⌉ × ⌈h/28⌉`,
  capped at 4,784 for the high-resolution tier that Opus 5.5, Sonnet 5.5
  and Haiku 5.5 all belong to; a 4:3 photo is downscaled to about 2212 ×
  1659 regardless, so the server encodes to the tier itself and
  positions map one to one.
- **Thinking is billed as output** and the installed SDK (0.78) cannot
  separate it from text in `usage`. On Opus 5.5 it is always on and not
  bounded by effort; Sonnet 5.5 can turn it off with `thinking: { type:
  'between_tools' }` and Haiku 5.5 with `{ type: 'disabled' }`, both only
  at effort `high` or below, which E0 tests as its own arm. `max_tokens`
  is 16,000; a `max_tokens` stop spends the same single retry, at 32,000,
  and a second stop is a 502. It is never read as "too many cards". In
  the spike, Sonnet 5.5 at `low` returned no thinking blocks at all:
  output was about 170 tokens for a single card and 900 for a ten-card
  spread, so the retry path never fired.
- The instruction describes where each field sits on a Redemption card,
  says cards may be sleeved, in binder pages, rotated or upside down,
  says to transcribe exactly and return null rather than guess, asks for
  grid positions in reading order, and asks the model to assert nothing
  about which card it is. `response.model` is asserted against the
  constant on every call.
- Usage, latency, attempts and `cost_usd` go on the event. Anthropic 429s
  are distinguished from our caps; the page retries once after
  `Retry-After`, then shows the *Busy* copy with Retry.

### The matcher

`lib/scan/match.ts`, pure, unit-tested, no API. Prices are loaded before
it runs, because the collapse rule needs them. It imports `CARDS` from
`lib/cards/lookup.ts`, never the generated module: the
`LEGALITY_OVERRIDES` there are what make 3,190 printings Rotation-legal.

1. **Normalize.** Lowercase, straight quotes, punctuation stripped,
   whitespace collapsed; references with Arabic and Roman book numbers
   folded together; type and brigade mapped to dataset vocabulary
   ("Enhancement" becomes `GE` or `EE` by alignment; brigades compared as
   color-token sets).
2. **Stem lookup.** A stem index built once from `CARDS` on the
   normalized stem, with each half of a slash-joined dual name indexed
   on its own ("Ram, the Exalter / Ram, the Uplifted"; the spike found
   two such misses), the spelling-variant stem pairs (Wizard/Wizards,
   Elisabeth/Elizabeth, Judgements/Judgments) folded, and the unions of
   step 3 baked in. The transcribed title is tried as read, then with a
   trailing parenthesised group removed (the model copies "Shadrach
   (Hananiah)" exactly as printed), then as each half of a slash. Exact
   hit first. Otherwise **fuzzy**: normalized
   optimal-string-alignment distance over the normalized stems, accepted
   only if the distance is at most 0.20 **and** either the stem is eight
   or more characters or the transcribed reference agrees with the
   candidate, **and** the difference is never a digit or Roman numeral
   (Herod Agrippa I/II, King Jeroboam I/II, Seraphim Isaiah 6:2/6:6),
   with a margin over the runner-up set in E1. Short names are where
   fuzzy matching is unsafe (Cage/Rage, Dove/Love, Winds/Wings, Job/Lot,
   Jude/Luke; Dataset numbers). No acceptable hit is **Not found**.
3. **Identity within the stem.** Identities are first **unioned**, once
   at index build, without touching `cardIdentityKey`: every AB
   printing with its original through `abMap.json` (the key splits
   "Fourth Seal, Death (RoJ)" from "Fourth Seal (Death) (RoJ AB)" on the
   stem alone), and any two identities with the same stem, type, brigade
   and alignment that share a scripture reference and whose abilities
   are both empty, identical, or at least 60% token-overlapping (the
   `class`-split reprints, and old-frame reprints whose names differ
   only in decoration). The spike produced 78 unions on the current
   data. A reference is every component of the printed line: "James 4:6
   (Proverbs 3:34)" and "II Chronicles 33:12/II Kings 20:21" index as
   two each, on both the dataset and the transcribed side. If one
   identity, done. Otherwise score each identity on fields in this
   priority: reference, then strength and toughness, then **the corner
   print number** (a number matching a printing in exactly one of the
   tied identities decides a reprint whose ability text changed:
   Josiah's Covenant, Thievery of Judas, Astrologers), then identifier
   (exact above partial), then brigade, then the ability prefix (six
   words, falling back to four, with the "GE:", "EE:" and "STAR:"
   markers stripped from the dataset text), then type. A clear winner is
   taken, with one exception: when the winner won on the reference and
   another identity matched six words of ability text, the row is
   **Check this** with both as candidates, because that pattern is a
   data error or a printing the data lacks (King Asa's Ki and TxP rows
   carry each other's verse). Otherwise a tie is **Check this** with
   `identity_ambiguous` and the identities as candidates.
4. **Lost Souls.** Title "Lost Soul" skips steps 2 and 3: the normalized
   reference selects identities; ties are broken by the step-3 scoring
   plus three Lost Soul terms: the nickname badge (equal +2, different
   −2, both absent +0.5), a "Token" word in the title must agree with
   the token type (−3 otherwise), and a card with no ability read
   prefers a vanilla identity. No reference read is `reference_missing`;
   a reference still matching several identities is
   `reference_ambiguous`; both are **Check this** with the picker scoped
   to Lost Souls. Six dataset reference errors (Lost Soul "Blind",
   "Lawless" AB, "Retribution" stored as Acts 18:22 for a card printed
   Acts 16:22, "Lost Soul (Daniel 9:7) [Fundraiser]" stored as Daniel
   9:5, King Asa, whose Ki and TxP rows carry each other's verse, and
   the Baptism fundraiser Son of God, which prints Matthew 3:16 and is
   stored as 28:5-6) are verified against the printed card and, if wrong, fixed through
   the catalog override (`/admin/catalog`, live after a deploy),
   not in this migration; the fix reshapes `cardIdentityKey` unions,
   which is intended. Greek-language promo printings (Angel of the Lord,
   Son of Man) transcribe as Greek and stay Not found; a player adds
   those by hand.
5. **Printing selection** (next section).
6. **Score fields** on every detection: `matchScore`, `runnerUpScore`,
   `agreeingFields`.

### Printing selection

Among the identity's printings, **successive filters, then a collapse**:

1. **Hints and filters, in this order.** Each step keeps the printings
   it supports and drops the rest; a step that leaves one printing ends
   the selection with that step's reason.
   - `UR+` in `rarityCode` keeps UR+ printings (`imgFile` ends `-UR+` or
     `-UR-Plus`; the six LoC "UR-Plus" cards were invisible to the
     earlier pattern) (`ur_plus`). `LR` keeps Legacy Rares, by number
     when one was read (`legacy_rare`).
   - The **corner code** keeps printings whose code matches
     (`print_number`). The code is parsed from `imgFile`: a leading digit
     run after any letter prefix ending in `_`, with `N` or `LR` stripped
     ("081-…" → 81, "LoC_232-…" → 232, "CoW_AB_N114-…" → 114, "LR29-…" →
     29); a digit run before `_` for the II set ("81_Captain-…" → 81);
     `K13-` and `L20-` deck codes kept whole ("K13", matched against a
     read "K13" in either corner field); and CoW originals, which print
     the number but whose rows lack it, borrow their AB twin's through
     `abMap.json`. That takes printings with a code from 2,022 to 2,652.
     A code that matches an original and its AB twin keeps both: the
     number never decides that pair.
   - The **reference** keeps printings carrying the read verse when that
     is a strict subset (`reference`; Son of God's printings differ by
     verse on purpose).
   - The **illustrator credit** keeps printings whose credit in the cue
     table agrees with the read one, when at least two survivors have a
     known credit and the read one matches a strict subset
     (`illustrator`). Agreement is equality after stripping "Illus.",
     "©" and punctuation, or two shared name tokens.
   - The **copyright year** keeps the survivor whose printed year equals
     the read one, including when the others print no year
     (`copyright_year`; T2C originals print 2025 and their AB reprints
     2026; K-deck reprints print 2023 and the first prints none).
   - An **edition letter** A–H read alone in the corner keeps old-frame
     printings whose file carries that letter (`edition_letter`).
   - The **ability tail** keeps printings whose text ends as read
     (`ability_end`).
   - **Promo text** in `rarityCode` or `promoText` keeps promo printings
     when the identity has any (`promo_text`); among several, a
     placement (1st, 2nd, 3rd) or a year in the text picks by matching
     the printing's name, and an event word printed in a candidate's own
     name that the card does not carry counts against it, over the words
     cards print (Local, Seasonal, State, Regional, District, Winner,
     Gift Set), and "Special Promo" is what worker promos print ("Special
     Promo" rules out the "[2016 - Local]" and "[2026-Seasonal]" twins
     and leaves "[2025 - Worker]"); a tie leaves the choice to the picker,
     and a placement or year that contradicts the only promo printing
     makes the row Check this, because the data may lack that printing.
     When the cue table holds a printed caption for two or more promo
     candidates (it does for 115 of the 127 promo rows in multi-printing
     cards, and the captions differ inside 18 of 78 promo sets), a read
     caption that agrees with exactly one decides before any scoring
     (`caption`).
   - A read strength and toughness that match a strict subset keep it
     (`stats`; old reprints inside one identity can differ, Main 4/4
     against 2E 6/5).
   - Then steps 2 to 4 below. "Original wins" for an AB pair is no
     longer a hint; it is what step 2 does when nothing above separated
     the pair, and the printings line keeps the twin one tap away.

   **v1.1:** `set_hint` from the legend as a weak tiebreak. The cases no
   text settles: "Shipwreck (Promo)", a borderless reprint carrying the
   original's 142/UR corner ($65 against $0.25); the 258 RoJ and CoW AB
   pairs, which share art, credit, number and (no) year and differ only
   in frame texture; and Main against Main Unlimited, one catalog image
   per pair and no price on either.
2. **Special printings out.** Unless a hint supports one, remove special
   printings when at least one standard printing remains. A row that
   ends up decided only by this removal carries `printingReason:
   'default'` and lists the removed printings on the printings line, so
   a collector whose card is the promo or the alt-border is one tap from
   it; the removal never books a promo, and never crosses the set-to-promo
   line without a caption or corner match. Rules:

   | Class | Rule from the data |
   |---|---|
   | Promo | `set` starts `Pmo`, or `officialSet` starts `Promo`, or `rarity` in {Promo, National, Seasonal, Regional, State, Local, District, Winner, "National, Winner"}; this captures the 40 Fundraiser cards and nine promos filed under `GoC`/`LoC` |
   | AB | `set` ends `(AB)` |
   | Legacy Rare | `rarity === 'Legacy Rare'` |
   | UR+ | `imgFile` ends `-UR+` or `-UR-Plus` |

   Counts are in Dataset numbers. "Alternate border" is AB; there are no
   foils. Fundraiser is treated as promo on purpose; a real Fundraiser
   owner fixes it through the printings line.
3. **Rotation in.** If any survivor is `legality === 'Rotation'`, keep
   only those.
4. **Collapse.** If the survivors' prices span less than the price-delta
   floor (`PRICE_DELTA_FLOOR = $2.00`; all-unpriced counts as zero span)
   and share one legality, the row is **Matched** with `printingReason:
   'equivalent'` and a quiet printings line; the default is the cheapest
   priced survivor, else a survivor with a print number, else the first in
   `CARDS` order (v1.1's set-order table replaces this). If prices span
   the floor or legality differs, the row is **Check this** with
   `printing_ambiguous`, candidates listed with prices, and the cheapest
   priced survivor as the provisional choice. A single survivor is
   `only`.

Measured on the data: without rules 319 of the 795 multi-printing
identities would be Check this; after the special-printing filter 93;
after the Rotation filter 64 (2.7% of all printings), before the
price-delta floor lowers it further. Identity and reference ambiguity
add a few percent; E0 measures the real rate on photos.

### Reason fields

`nameReason` ∈ {exact, fuzzy, reference, none; v1.1 adds second_look}.
`printingReason` ∈ {only, default, print_number, ur_plus, legacy_rare,
reference, stats, illustrator, copyright_year, caption, edition_letter,
ability_end, promo_text, equivalent, printing_ambiguous,
identity_ambiguous,
reference_missing, reference_ambiguous; v1.1 adds set_hint, border,
copyright_year, second_look}. Chips key on status and
`printingReason`; a `fuzzy` name shows "Read as 'X'" on the row.

### Second look (v1.1)

One extra request per photo, made by the route when the photo has any
Check this or Not found rows (at most six per photo), carrying each
such row's crop and its top five candidates (names and thumbnails
downscaled to 172 × 256, about 70 tokens each), asking the model to pick
one or none per row. Printing selection re-runs on each pick. It reuses
the photo's reservation; its tokens and cost are added to the same
event; it gets no retry, so a photo stays within three billed attempts
and `maxDuration = 90`. Kept only if E0 stage 6 shows lift.

### Stage A2 (v1.2): art-similarity tiebreaker

A server-side descriptor index of all printings' Blob images (the
community tool uses a 420-byte color-layout vector per image; ours can
be that or a small embedding), compared against the card's crop to break
ties inside an identity when prices differ and no hint was read. Built
when the Stage A2 trigger in Kill, pivot and removal fires. Not in v1
because it depends on crop quality, which E0 measures first. After the
versions pass its job is narrow: the 258 RoJ and CoW AB pairs that
differ only in frame texture (same art, so a frame classifier rather
than an art hash), and the 38 AB pairs whose art differs on the cards
the model could not read a credit from.

### Why not the alternatives first

- **On-device OCR.** The community tool needs 11 border masks, Hough
  fallbacks, 4 to 7 binarizations, a lexicon repair step and a
  picture-match override to make Tesseract work, and still ships no
  accuracy number. Its "Read name with Claude" button is wired to the
  Claude Artifacts runtime and is hidden on the public site.
- **Fingerprint index alone.** Cannot tell an AB reprint from its
  original (387 pairs share art), is fragile under glare and
  perspective, and is a week or two before anything works. Right as a
  tiebreaker (Stage A2), wrong as the first pass.
- **Barcodes.** Redemption cards have none.

### Cost and latency

Baseline **Claude Sonnet 5.5** at low effort: reading printed text is
not an Opus-grade task, and the one-minute goal needs a per-photo budget
that Opus with always-on thinking will not meet. Budget: single p50 ≤ 5 s
and p95 ≤ 12 s; spread p95 ≤ 25 s, measured in E0 and E2. Opus 5.5 is
chosen only if Sonnet fails the singles screen, Opus passes it, and Opus
meets the budget; Haiku 5.5 is chosen if it is within three photos of
the leader on singles and no worse on the silent-wrong screen (in the
spike Haiku tied on singles with four times the silent-wrongs). Pre-E0
estimates (instruction and schema measured at about 1,880
tokens in the spike, not the 900 first assumed; output is JSON, plus
thinking only where the arm has it), with the spike's measured numbers
in E0 preview:

| Photo | Image tokens | Input total | Est. output | Sonnet 5.5 | Opus 5.5 | Haiku 5.5 |
|---|---|---|---|---|---|---|
| Single, low-res tier (4:3 at 1269 × 952) | 1,564 | ~2,450 | ~800 | ~$0.013 | ~$0.026 | ~$0.0006 |
| Spread, low-res tier | 1,564 | ~2,450 | ~2,000 | ~$0.025 | ~$0.050 | ~$0.0012 |
| Spread, high-res tier (4:3 at 2212 × 1659) | 4,740 | ~5,640 | ~2,000 | ~$0.031 | ~$0.063 | ~$0.0016 |
| Second look, six rows (v1.1; crops ~280 tokens, thumbnails 70) | ~3,800 | ~4,700 | ~500 | ~$0.014 | ~$0.029 | ~$0.0007 |

On a 4:3 high-res spread each of 12 cards is about 390 px wide; at the
low-res tier about 240 px, where corner numbers will mostly come back
null. E0 stage 3 decides whether the extra tokens buy printing accuracy.
At the photo cap of 1,500 a month, all high-res spreads at one attempt,
the expected month is about $47 on Sonnet, $95 on Opus, $2.40 on Haiku;
with a v1.1 second look on every photo, about $68 on Sonnet. The photo
cap bounds photos, not tokens: a photo that spends its retry at 32,000
output tokens can bill about $0.50, so the hard ceiling is the 30-day
spend cap in Reserve first, set below the credit. E0's measured costs
set the final constants.

## The flow

### Routes and entry points

| Route | Who | What |
|---|---|---|
| `/collection` | signed in | Toolbar: below `sm`, **Scan cards** (primary) and Build a deck (outline), with Set completion, Import and Export folded into the gear menu (the header already wraps at 390 px); on desktop Scan sits beside Import CSV at existing weights. First-run banner's call to action becomes Scan cards, Import CSV a text link. New `?format=Unlimited` and `?added=<scanIds>` params; the page selects those `scan_events` rows (RLS: own rows), reads the final keys from their outcomes, and sorts them first under a *Just added* header. **v1.1:** Change printing and a Close button in the card modal. |
| Deck builder | anyone | The Cards I own filter's empty state and the Check my collection modal get a "Scan your cards" link to `/collection/scan`. This is the front door: it is where players who have never opened `/collection` discover that a collection exists. |
| `/collection/scan` | signed in and `canScan` (Reserve first; Rollout) | The scanner. Signed out: the same page-level gate `/collection` renders today (neither route is in the middleware's protected prefixes), with the scanner's copy and `redirectTo=/collection/scan`. A route, not a modal, because a camera round-trip can evict the tab and a route restores cleanly. |
| `/privacy` | anyone | What is sent to Anthropic, what is kept, for how long. |

Lead copy everywhere is "see what your cards are worth"; adding to the
collection is the retention step.

### Capture

- **Take photo**: a hidden `<input type="file" accept="image/*"
  capture="environment">`. **Choose from photos**: the same without
  `capture`, with `multiple`. `accept` stays exactly `image/*` (listing
  HEIC changes what iOS hands over). iOS ignores `multiple` with
  `capture` and resets `input.files` to one each time, so the page
  accumulates `File` objects in state. If Safari evicts the tab while
  the camera is open that photo is lost; the *Batch tip* says to use the
  Camera app first for stacks.
- Client decode goes through an `<img>` element, not
  `createImageBitmap(file)`: WebKit drops EXIF orientation on the latter,
  and a canvas re-encode would ship sideways iPhone portraits with no tag
  left for the server to honor. Draw to a canvas at a long edge of at
  most 2576, JPEG 0.85, hard stop 3 MB; never decode a 48 MP file at full
  size. A decode failure (Samsung and Pixel HEIF; some HEIC) is not
  uploaded and gets the *HEIF* copy.
- Posted as `multipart/form-data` to `POST /api/scan`. The original never
  leaves the phone. Two uploads in flight at once; the rest queue.
  `navigator.onLine` is checked before upload.
- **v1.1:** page-wide drop target (the deck builder's
  `useExternalDropTarget` pattern), and a *Progress* line on desktop.

### Processing

Each photo is a hairline row group headed by a small thumbnail (or
"Photo 3" after a reload, when thumbnails are gone) and a `role="status"`
line: *Reading…* with elapsed seconds after 5 s, *Done*, or a failure
string from Copy, each with **Retry** (the file is still in memory) and
**Remove**, plus **Choose another** on the HEIF failure. Several photos
process while the player keeps taking more.

### The tray

One row per detection under its photo, in grid order. Identical keys
within the tray merge into one row with a summed quantity, as the CSV
merge import does; a duplicate from a later photo increments the earlier
row and adds no row under its own photo. The set is always shown.

Row at 390 px (content width 358): `[thumb 44] [8] [text 194] [8] [qty
56] [4] [remove 44]`. Line one: name (truncated) left, price right in
`text-sm tabular-nums` per `useShowPrices`, or *Unpriced* linking to the
YTG search page. Line two, 12 px: `Kings · own 2`, or `Check this · Which
printing? Prices differ` (truncate the reason, never the chip), or `3
printings`. On a `fuzzy` row the set moves to line one after the name
and line two reads *Read as "Saul"*. The quantity is a tappable "×1" that
opens a stepper. **Remove** is a visible 44 px control; swipe is a
shortcut. The name is a 44 px target that opens the picker, labeled
"Change printing: Son of God, Kings". The thumbnail is its own 44 px
target that opens the card at full size with its set and price (a tap
outside, Close, or Escape dismisses it); it stays live after the add.
Owned quantity
comes from `useCollectionState`, which the deck builder already mounts.

Chips:

- **Matched**: no chip for `only` and `print_number` (v1.1: `set_hint`,
  `border`, `copyright_year`); the printings line as muted text for
  `equivalent`.
- **Check this**: amber; reason on line two; `aria-describedby` points the
  row at it. The row holds the provisional choice; the amber is the ask.
  **v1.1:** a crop (44 to 56 px, `object-cover`, `ring-1 ring-border/60`)
  replaces the thumb on these rows, only if E0 proved crops.
- **Not found**: amber, the read title as text and **Find card**, which
  opens the picker with the search prefilled. Not counted until resolved.

The tray persists in `sessionStorage` keyed by user id: detections,
chosen keys, quantities, corrections, and the owned quantities before
commit (for undo). Not thumbnails and not crops.

**v1.1:** above `md` the tray renders as a table: thumb 56 · name and set
· status · owned · price · qty · remove; rows focusable, Enter opens the
picker, plus and minus change quantity, Delete removes.

### The picker

The house dialog (`components/ui/dialog.tsx`: portal, Escape,
`aria-modal`, scroll lock) styled as a bottom sheet on phones; the picker
adds its own focus trap and focus return, which that component lacks (a
local hook, not a new dependency, not a change to thirty call sites).
Header *Which printing?* or *Which card?*. Lists the identity's printings
with image, set, legality, YTG price and "2 in your collection", the
current one marked, and a search field backed by `searchCardNames`; its
hits carry `set` and `imgFile` but no key, and their `name` is the stem
when unique, so the builder resolves a hit through `findCard(name, set,
imgFile)` falling back to a `set|imgFile` lookup, then `cardIdentityKey`.
A change marks the row corrected.

### Commit

A sticky footer (`pb-[env(safe-area-inset-bottom)]`, `aria-live=
"polite"` on the total) with two lines: *Footer total* (the same "to buy
at YTG, not a resale value" framing and tooltip the collection page uses)
and **Add 12 to collection**. If unresolved rows exist, *Unresolved
warning*.

Commit is one server action, `commitScanAction(commitId, rows,
outcomesByScanId)`, idempotent on a client-generated `commitId`: it
inserts a `scan_commits` row first (`on conflict do nothing`), and if
the row already existed it returns that row's stored result, so a double
tap, or a retry after a timeout the server had already completed, never
adds twice. The button is disabled while in flight. The action then
performs the merge import (the same path as `bulkImportCollectionAction`
in `merge` mode, which sums quantities), stores the per-key deltas and
the result on the `scan_commits` row, and writes outcomes in one call.

### Success state

The committed rows stay on screen with their new owned totals, plus:

- **Undo**: `adjustCollectionQuantitiesAction(commitId)` reads the
  commit's stored deltas (server-authoritative, not from the tray) and
  subtracts them; a key whose quantity reaches zero is deleted (the table
  forbids 0) and never goes below; the merge import itself cannot
  decrement. Disabled after a later commit; toast *Undo done*.
- **Scan more**: clears the tray and stays.
- **View collection**: `/collection?format=Unlimited&added=<scanIds>`
  (the default Limited filter would hide every non-Rotation card just
  added).
- **v1.1:** **Add to Haves** (for each key, read the existing Have and
  put `existing + scanned`, since `putItems` overwrites; `kind: 'have'`,
  `anyVersion: false`, `priority: false`, `note: ''`; haves never exceed
  owned because this only exists after commit; undone with the commit),
  **Copy priced list**, and per-row Change printing (decrement old key,
  increment new).

### What is recorded

On commit each detection's outcome goes on its scan event: final key,
printing changed, name changed, removed with `removedAs: 'wrong' |
'unwanted'` (a two-option control at remove time), left unresolved, plus
the detection's reasons and scores. Abandonment is defined in E3.

## Data

### `POST /api/scan`

Request: `multipart/form-data` with `photo` (≤ 3 MB) and, for superusers
only, an optional `arm` JSON field (model, effort, tier, thinking) that
E0 uses and everyone else cannot. Order inside the route: session and
`canScan` before the body is read; `scan_reserve()`; sharp; prices
loaded once; recognizer; matcher; (v1.1) second look and printing
re-selection; finish event.

Sharp (already used in several route handlers; pattern in
`app/forge/lib/imageNormalize.ts`): `limitInputPixels` set to 60
megapixels, `rotate()` for any EXIF that survived, `resize` with the
documented reference algorithm to the chosen tier with
`withoutEnlargement: true`, JPEG quality 82, metadata stripped by
default. This bounds pixels and cost on the server, removes GPS before
anything reaches Anthropic, and sniffs the real format; undecodable is
415.

Response 200:

```
{
  scanId, photoQuality,
  detections: [{
    id, grid: { row, col }, orientation,
    read: { title, reference, nickname, abilityStart, type, brigade, strength, toughness,
            identifier, printNumber, rarityCode, confidence },     // v1.1 adds setMarking, setIconNote, border, copyrightYear, bbox
    status: 'matched' | 'check' | 'not_found',
    nameReason, printingReason, chosenKey | null,
    scores: { matchScore, runnerUpScore, agreeingFields },
    candidates: [{ key, name, set, officialSet, imgFile, legality, price | null }]
  }],
  usage: { model, latencyMs, attempts }
}
```

Owned quantities are not in the response; the client reads them from
`useCollectionState`, which it mounts anyway.

| HTTP | `code` | Trigger | Copy key |
|---|---|---|---|
| 401 | | no session | gate |
| 413 | | body too large (also Vercel's own `text/plain` 413 by header) | Too large |
| 415 | `undecodable` | sharp cannot decode | HEIF |
| 429 | `cap_user_10m` / `cap_user_24h` | user caps, with `resetsAt` | Ten-minute cap / Daily cap |
| 503 | `cap_global_30d` | global photo cap, `Retry-After` | Global cap |
| 503 | `cap_global_spend` | 30-day spend ceiling, `Retry-After` | Credit out |
| 503 | `upstream_rate_limit` / `upstream_overloaded` | Anthropic 429 / 529, `Retry-After` | Busy |
| 503 | `billing_error` | credit exhausted | Credit out |
| 502 | `recognizer_failed` | refusal, invalid JSON, truncated after retry | Generic |

Prices: `lib/scan/prices.ts` is the paginated `card_prices` loader
extracted from `/api/prices` (PostgREST caps an unbounded select at
1,000 rows) and used by both; the route attaches `price` to candidates
because the printing rules need it; the client builds product links with
`getProductUrl` from its own price map.

### Reserve first, then call

`scan_reserve()` is a SECURITY DEFINER RPC in the pattern of
`forge_add_art_candidate` (migration 082: advisory transaction lock,
`auth.uid()` under an empty search path), with the grant footer
migration 120 uses (`revoke all … from public, anon; grant execute … to
authenticated`). It takes **one constant-key lock**,
`pg_advisory_xact_lock(hashtext('scan_reserve'))`, because the global
cap counts every user's rows and a per-user key cannot serialize it;
every reserve serializes, which is fine at this volume. Under the lock
it counts the caller's rows in the trailing 10 minutes and 24 hours and
everyone's rows and summed `cost_usd` in the trailing 30 days, counting
`pending`, `done` and `failed`, excluding `rejected` and excluding
`source = 'eval'`, checking the user caps first, then the global photo
cap, then the spend ceiling. It then either inserts a `pending` row and
returns its id, or inserts a `rejected` row naming the cap and returns
the cap and `resets_at`. Only then does the route call the model, and it
finishes the row (`done` or `failed`, with model, tokens, latency,
attempts, cost) through the admin client. Cap hits are observable; model
latency is never a race window.

| Scope | Window | Limit |
|---|---|---|
| Per user | 10 minutes | 20 photos |
| Per user | 24 hours | 150 |
| Everyone | 30 days | 1,500 photos |
| Everyone | 30 days | $80 summed `cost_usd` (`cap_global_spend`) |

Copy for the caps interpolates the RPC's constants and `resets_at`.
`scan_reserve(p_source)` accepts `'eval'` only when the caller is a
superuser; eval rows are skipped by every cap and by every E3 query,
which is how E0's requests run through the deployed route without
consuming the launch month or polluting the metrics.

`lib/scan/gate.ts` exports `canScan(userId)`: superuser, or in
`SCANNER_ALLOWLIST`, or everyone once the launch flag flips. It is the
one gate the page and the route both call, so widening one never leaves
the other returning 401.

### Migration `122_scan_events.sql`

Latest migration on `origin/main` is 121; re-check at merge.

```
scan_events (
  id uuid pk default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null check (status in ('pending','done','failed','rejected')),
  source text not null default 'player' check (source in ('player','eval')),
  rejected_cap text,
  model text, attempts smallint, latency_ms integer,
  input_tokens integer, output_tokens integer,
  cost_usd numeric(8,5),               -- from a per-model price constant
  photo_quality text,
  detections jsonb,                    -- always stored; every read field capped in code (title 60, reference 40, nickname 30, ability 80, identifier 40, type 30, brigade 40, numbers 8; v1.1 marking 20, icon note 60)
  outcomes jsonb,                      -- set on commit
  commit_id uuid references scan_commits(commit_id),
  image_pathname text,                 -- created now, nullable, unwritten until v1.1
  image_expires_at timestamptz         -- same
)

scan_commits (
  commit_id uuid pk,                   -- client-generated; insert-first makes commit idempotent
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  deltas jsonb not null,               -- per-key quantities added; undo subtracts these
  result jsonb                         -- the response returned to the client, replayed on a repeat
)
```

RLS: `SELECT` own rows; superuser sees all through the existing
`is_superuser()` function (migration 062; a fixed-uid check, not a
table). **No INSERT or UPDATE grant to `authenticated`**: writes go
through `scan_reserve()` or the admin client, so nobody can forge
events, token counts or detections. `commitScanAction` filters by the
caller's `user_id`, validates the JSON shape, and caps its size.
`scan_commits` has the same RLS shape (own rows readable, no writes for
`authenticated`). Indexes on `(user_id, created_at desc)` and
`(created_at)`. **v1.1:** a boolean `keep_scan_photos` on `profiles`, in
its own migration.

### Retention and privacy

v1.0 keeps **no photos**. It keeps what was read (the capped detection
fields), tokens and cost, because that is the evaluation data Goal 5
depends on; detections of photos with no matched card are nulled after
30 days by the purge job (v1.1 cron; until then a monthly SQL step in
Rollout). The *Retention note* and `/privacy` say exactly this.

**v1.1:** a toggle, off by default, stored on `profiles`: *Retention
toggle*. When on, the re-encoded photo is written to the **Forge
private Blob store** under `scans/<user>/<scanId>.jpg` (the only private
store; Forge never lists it; spread the `storeId`/token options from
`app/forge/lib/art.ts`, exporting its auth helper; never set a global
`BLOB_STORE_ID`, which would hijack public-store calls). Private blobs
are not browser-loadable, so `/admin/scans/image/[id]` checks
`is_superuser()` and streams `get(pathname, { access: 'private',
...storeOpts })` as `app/forge/api/art/[cardId]/route.ts` does. A daily
cron lists the `scans/` prefix with a cursor and deletes blobs older
than 30 days by `uploadedAt`, nulls the columns, and nulls unmatched
detections; turning the toggle off deletes immediately (one control,
*Delete photos*). Same `CRON_SECRET` bearer pattern and failure alert as
its siblings.

### Admin and audits

v1.0 has no admin page. The E3 metrics and kill queries are SQL kept in
`scripts/scan-eval/queries.sql`, every one filtered to `source =
'player'`, and run through the Supabase MCP; the
two dated audits (E3) export from the same place. **v1.1:**
`/admin/scans`, superuser-only through `supabase.rpc('is_superuser')` as
`app/admin/permissions/lib/auth.ts` does, linked from the admin dropdown
in both the desktop and mobile nav: every E3 metric per day, the
kill-criteria queries with their windows, the most-corrected read
titles; a daily digest through `sendEmail` (the cron alert helper only
sends failure mail) when the day's or month-to-date cost crosses a
threshold; and a one-tap labeling page (photo beside chosen cards:
right, wrong, which) that replaces SQL-export labeling.

## Evaluation

E0 is a screen: it says whether the approach is hopeless and which arm
to ship; it cannot certify 90% on seventy photos. The dated audits
certify. One toolchain throughout: a photo folder, a labels file, a
scorer, a table with intervals.

### Units, labels, scoring

`scripts/scan-eval/labels.json`, validated against `CARDS` on load:

```
photo: { file, bucket, tags: ["sleeved","glare","binder","angled","old-frame",...],
         otherGame: bool,
         cards: [{ printing: key,          // the card physically in Tim's hand, always
                   identity, stem,         // derived on load
                   setVisible: bool,       // a human can name the set from the re-encoded high-res photo
                   inFrame: "full"|"partial",
                   grid: { row, col } }] }
```

Scoring per photo, position-free, at identity level by multiset: `tp =
min(labeled, predicted)` per identity, `fn` excludes partial cards, `fp`
counts extras. Each matched pair is classed `matched_correct`,
`matched_wrong` (the silent harm), `check_top1`, `check_in_candidates`,
`check_miss`, `not_found_miss` or `hallucination`; wrong-identity
predictions pair with leftover labels by grid cell when both have one.
Printing level, only on correct-identity pairs: if `setVisible`, correct
means `chosenKey === printing`; otherwise the choice is *defensible* when
it is within the identity and the status obeys the collapse rule, and
`silent_wrong_price` is flagged when a Matched row's price differs from
the true printing's price by the floor or more. Other-game photos: any
`matched` or `check` row is a hard fail; `not_found` rows are the desired
path (the model should transcribe "Lightning Bolt" and the matcher should
reject it). Grid usefulness is scored as cell match.

Harness rules: 429, 529, timeouts and unparseable responses go to
`errors.jsonl` and are never scored as misses; `max_tokens` stops are
`truncated` and excluded from accuracy; latency is the final successful
attempt; tokens from `usage`, cost from the row's model; every output
file stores `model`, prompt hash and `response.model`; the scorer is
smoke-tested on labels-as-predictions (must score 100%) and on empty
predictions (must score zero recall).

### The photo set

Seventy-six photos from Tim's own phone, plus, if five Discord players
will each send five shoebox photos before E0, a `wild` bucket from other
phones and rooms:

| Bucket | Count | What's in it |
|---|---|---|
| Single, easy | 25 | one card, flat, room light; mix of eras and types including Lost Souls, Sites, Dominants, a card with an unsuffixed twin, a UR+ |
| Single, hard | 15 | sleeved, glossy glare, angled 20°+, old-frame, promo, AB, upside down; each photo tagged |
| Spread 4–8 | 8 | flat with gaps |
| Spread 9–12 | 6 | |
| Binder page | 5 | nine cards touching, in sleeves |
| Spread 15–20 | 4 | the community tool claims about 30 works; we want the curve |
| Spread 25–30 | 3 | expected to fail; we want to see how |
| Not a card | 10 | six with no card at all (hands, tables, a booster wrapper) and exactly four cards from other games |

Photos live in `scripts/scan-eval/photos/`, git-ignored (Files says
where the shared copy goes). A development set: thresholds tuned here
are fits. The first 200 audited real cards after launch are the first
test set.

### E0: staged screen

Metrics split in two: **model-only** (normalized title equals the label
stem; reference equals; print number non-null on `setVisible` cards;
per-field agreement), which choose model, effort and tier; and
**matcher** metrics, which belong to E1 and are reported here as
information. E0 runs through the deployed route from PR B on a preview
URL, with a minted superuser session per the `verify` skill, the `arm`
override and `source = 'eval'`, after migration 122 is applied to
production (the preview shares the production database); so the resize
and upload path is measured from the start and the first photos come
from the real client. Stages, each paired on the same photos:

0. Smoke: five photos through every arm; assert model, stop reason,
   schema parse; run the scorer's self-tests.
1. Model screen: Sonnet 5.5, Opus 5.5, Haiku 5.5, each at `low` effort
   set explicitly (defaults differ by model), on the 40 singles and the
   14 spreads of twelve or fewer. Drop a model that is four or more
   photos behind the leader on paired singles.
2. Effort and thinking: the leader at `medium`, and, if the leader is
   Sonnet or Haiku, with thinking off at `low`, same 54 photos.
3. Tier: the leader, high-res versus low-res, all 26 spreads including
   binder pages. Decision: print-number lift versus cost and latency.
4. **v1.1** Position: bbox at the chosen tier on the spreads, only if
   crops are wanted; "none" as a control.
5. **v1.1** Legend image on the 40 singles, only if print number and
   set marking are null on more than half of `setVisible` cards.
6. **v1.1** Second look on the leader's Check this and Not found rows
   (needs at least twenty rows to mean anything).
7. Two more repetitions of the final arm on all photos: the noise floor
   every later comparison is judged against.

About 490 requests for v1.0's stages; stages 4 to 6 add about 90. A few
dollars either way.

Pre-registered pass rules, with what each buys printed by the script
beside the result:

| Screen | Unit, n | Pass iff | What it buys |
|---|---|---|---|
| Singles pooled, identity top-1 | photo, 40 | ≥ 34 | a 75% system passes 10% of the time; a 92% system 96% |
| Spreads ≤ 12 plus binder, false cards | card, ~150 | ≤ 4 in total, and 0 `matched`/`check` rows on other-game photos | |
| Spreads ≤ 12 plus binder, recall | card, ~150 | ≥ 85% with a cluster bootstrap over photos for the interval | |
| Silent wrong identity | matched rows, all photos | ≤ 2 | the anti-goal; the number that matters most |
| Non-card | photo, 10 | `no_cards` on ≥ 5 of the 6 true non-card photos; 0 `matched`/`check` on all 10 | |
| Latency | photo | the budget in Cost and latency at p50 and p95 | |
| Crops (v1.1) | cell, spreads | ≥ 90% of crops contain the right title, or crops do not ship | |

If the singles screen fails: the capture flow changes before PR C (one
card per photo, or a title-band instruction) and the second look moves
into v1.0. If only printing hints fail: ship with the collapse rule and
schedule the v1.1 legend fields and Stage A2. Numbers and decisions go in
the review log.

### E0 preview: the spike (2026-10-27)

Before any product code, a throwaway script in the session scratchpad
(not in the repo) ran the Transcription fields prompt and a 500-line
version of the matcher over two sets. Everything here is a development
measurement on unaudited labels; E0 proper still runs through the
deployed route. Baseline arm: `claude-sonnet-5-5`, `low` effort,
high-res tier, `output_config.format` with the v1.0 schema, no thinking
parameter.

**Catalog ceiling test.** 148 catalog images from the Blob store
(344 × 512, about 250 image tokens each), stratified: 40 standard
Rotation printings across 40 sets, 20 promos, 12 AB, 8 Legacy Rares,
all 6 UR+, 20 Lost Souls, 20 old-frame cards, 10 homonym stems, 5 Son
of God printings, 7 starters. The label is the file, so these numbers
are exact.

| Measure | Sonnet 5.5, low |
|---|---|
| One detection per image | 147 / 148 |
| Title equals the stem | 142 / 148 (96%) |
| Reference correct | 144 / 148 (97%) |
| Strength and toughness, characters only | 50 / 56 (89%) |
| Print number read where the card has one | 73 / 78 (94%), all correct |
| Identity top-1 | 144 / 148 (97%); 125 before the step-3 unions and print-number tiebreak |
| Matched / Check this / Not found | 139 / 7 / 2 |
| Printing exact among Matched | 117 / 139 (84%); AB pairs resolve to the original by rule |
| Silent wrong (Matched and wrong identity, or price off by the floor) | 2 of 139: the borderless Shipwreck promo, and a Legacy Rare whose corner was unreadable at 344 px |
| Latency p50 / p95 | 1.9 s / 2.8 s |
| Cost per image | $0.0059 |

The 7 Check this rows are five Son of God promos spanning $3 to $175
(the picker's job), one vanilla Lost Soul whose old printings differ in
legality, and one old-frame reprint pair with no stats. The 2 Not found
are the two dataset reference typos.

**Tim's photos.** 83 phone photos, re-encoded to the high-res tier: 39
singles (promos and foils in sleeves, mostly), 39 spreads of 2 to 12
(binder pages, table spreads, listing composites), 4 bulk shots of 25 to
45 cards, 1 photo of card stacks. Labels are the filenames, which name
some of the cards; 9 photos were checked by eye against the output and
every read on them was right, including three copies of one promo on a
binder page and five copies of one banned Lost Soul.

| Bucket | Photos | Detections | Matched | Check this | Not found | Latency p50 / p95 | Cost per photo |
|---|---|---|---|---|---|---|---|
| Single | 39 | 39 | 32 | 6 | 1 (the blurry one) | 1.9 s / 4.8 s | $0.010 |
| Spread 2–12 | 39 | 243 | 200 | 36 | 7 | 6.1 s / 9.2 s | $0.019 |
| Bulk 25–45 | 4 | 59 | 41 | 17 | 1 | 11.3 s / 11.7 s | $0.031 |
| Stacks | 1 | 0 | | | | 1.8 s | $0.007 |

All six single-card Check this rows are multi-year promos with different
prices. Matched rows by reason: `only` 119, `promo_text` 76,
`print_number` 39, `equivalent` 35, `legacy_rare` 2, `ur_plus` 1; 245
names were exact, 23 by Lost Soul reference, 4 fuzzy. Check rows:
`printing_ambiguous` 27, `identity_ambiguous` 24, `reference_missing` 8
(Lost Souls in bulk shots). Not found: seven cards with no readable
title, all `low` confidence, and two Greek-language promos. Stored
`confidence` already separates: 224 of 259 `high` rows Matched against
3 of 15 `low`. The model returns at most 14 to 17 cards from a bulk shot
and marks the photo `too_many_cards`, so bulk recall is bounded by the
request, not the matcher; the photo of stacks returned zero cards and
`too_many_cards`, which is the wanted behavior.

**Arms.** The same photos through four more arms, and the catalog
through two of them. Singles are paired on the baseline's 39: every arm
gave every single the same status; the only differences were a
different printing pick on one single (Haiku) and three (Haiku,
thinking off). Spread and bulk rows are not paired, because a photo's
bucket follows the arm's own detection count.

| Arm | Catalog identity | Catalog silent-wrong | Singles M / C / NF | Singles p50 / p95 | Spreads M / C / NF | Spreads p50 / p95 | Bulk detections | Cost single / spread |
|---|---|---|---|---|---|---|---|---|
| Sonnet 5.5 low, high-res (baseline) | 144 / 148 | 2 of 139 | 32 / 6 / 1 | 1.9 / 4.8 s | 200 / 36 / 7 | 6.1 / 9.2 s | 59 | $0.010 / $0.019 |
| Sonnet 5.5 low, low-res | not run | | 32 / 6 / 0 | 2.3 / 3.6 s | 201 / 32 / 12 | 5.5 / 9.6 s | 59 | $0.009 / $0.016 |
| Opus 5.5 low, high-res | not run | | 32 / 6 / 0 | 3.1 / 4.5 s | 201 / 26 / 6 | 8.3 / 12.6 s | 77 | $0.020 / $0.037 |
| Haiku 5.5 low, thinking on | 144 / 148 | 4 of 139 | 32 / 7 / 1 | 6.2 / 12.1 s | 181 / 36 / 14 | 9.6 / 17.0 s | 95 | $0.001 / $0.001 |
| Haiku 5.5 low, thinking off | 143 / 148 | 8 of 139 | 32 / 7 / 1 | 2.0 / 3.2 s | 183 / 29 / 20 | 4.6 / 6.4 s | 108 | $0.001 / $0.001 |

Reading it. **Model:** every model passes the singles. Opus turns ten
spread Check this rows into Matched and finds 18 more cards in the bulk
shots, at twice the cost and a spread p95 of 12.6 s. Haiku ties Sonnet
on singles and on catalog identity, but its extra silent-wrongs are
promos it booked as the standard printing because it did not read the
corner text (Wall of Protection, Clinging to Power, Gates of Jerusalem:
$15 cards at $3 to $7), so the promo corner is the field that separates
the models, and the Haiku rule in Cost and latency now also requires
the silent-wrong screen. Sonnet 5.5 at `low` stays the baseline.
**Tier:** low-res reads a print number on 15% of spread and bulk cards
against 20% at high-res, five points short of the ten the scoresheet
claimed, and loses more elsewhere: five more Not found on spreads, eight
more Check this on bulk, three invented titles on small cards, and one
Lost Soul reference misread by a digit (Hebrews 12:6 for 12:8). High-res
stays, for $0.003 more a spread. **Thinking:** at `low` effort neither
Sonnet nor Opus emitted thinking; Haiku did, and it cost 4 s a single
for no accuracy, so any Haiku arm runs thinking-off. The spike spent
about $6 over some 900 requests.

**Second pass, on Tim's review of the page.** Three photos he flagged
were all real misses: two 2019 Nationals promos (New Jerusalem, Son of
God) booked as standard printings because their tournament line sits
in the card body, not the corner the prompt asked about; three
alt-border Daniel cards booked as the originals by the v1.0 rule; and a
Lost Souls pair that differs only in the tail of the ability text. A
prompt v2 added `promoText`, `abilityEnd` and `border` and ran once on
the photos (Sonnet 5.5, low, about $1.40). `promoText` came back on 103
of 329 cards and, with placement and year matching, moved seven rows to
the right promo printing, among them Nationals promos at $175 and $199
that the corner text had missed, and turned a contradicted placement
into Check this. `abilityEnd` came back on 220 cards and separated the
Lost Souls pair: the cards read "by the same player to count", which
the data gives to the Three Liner. `border` read "standard" on every
real alt-border card and "alternate" on twelve that were not, one of
which sent a $150 promo to a $12 AB printing; it is rejected, and
alt-border printings stay the art tiebreaker's job (v1.2). Reference as
a printing filter, added the same pass, settled the Son of God family
on the catalog (141 Matched / 5 Check this). The two kept fields cost
about 11% more per photo and 1.5 s at p95 on spreads; with them,
singles were 33 / 5 / 1 and spreads 196 / 28 / 6 over 230 detections.
The review page was rebuilt to show, per card, the crop from the photo,
the printing mapped to, and every other printing of that card with set
and price; that is also the shape the picker should take.

**Versions pass, with two more adversaries.** Tim's next question was
why an alt-border card was booked as the original when its art plainly
differs. A data adversary measured the whole dataset and a visual one
inspected photos against the chosen versions. The data: of 851
multi-printing identities, 512 classes of printings are identical on
every transcribed field; after the filters 279 classes survive, but
their silent value is about fifty cents, because YTG prices an AB and
its original the same and lists neither Main nor Main Unlimited. The
money sits elsewhere: promos above their standard sibling (77 priced
pairs, median $22, sum $4,941), Legacy Rares ($160) and UR+ ($120), and
four parser gaps that booked the wrong printing on text that was not
identical: K and L deck codes unparsed (272 rows), the II set's "81_"
prefix eaten, LoC "UR-Plus" files missed, and CoW originals whose rows
lack the number their AB twin carries, so the number rule booked the AB
for an original (128 cards). The cue measurement: a Claude pass over
the catalog images of all 1,839 multi-printing rows ($4.30) read the
illustrator credit on every one and a © year on 441; the credit differs
on 10 of 387 AB pairs and separates 103 identities; the year is printed
only on 2023-and-later sets and differs on 128 of 129 T2C AB pairs. On
photos the model reads the credit on 77% of cards (97% of singles), the
year on 23%, and a set icon as inconsistent prose on 11%, so the credit
and the year are v1.0 fields and the icon is not. With those fields and
the parser fixes, and with the number no longer deciding an AB pair,
the photos went to singles 36 / 2 / 1 and spreads 206 / 18 / 6; the
credit decided 50 rows, the caption 5 and the year 4; every alt-border copy on Tim's
binder page now maps to its AB printing and his single original to the
original; catalog printing-exact rose from 84% to 88%, and the remaining
inexact rows are same-art AB pairs at equal price, one Legacy Rare whose
corner is unreadable at 344 px, and Main against Main Unlimited.
Tim's next two misses on the rebuilt page closed two more holes: a foil
"Special Promo" Lost Soul booked as its "[2016 - Local]" twin, because
the promo scorer only counted words it found (now an event word in a
candidate's name that the card lacks counts against it), and two King
Asa cards booked as the Ki printing because the dataset gives Ki the
verse the TxP card prints (now a reference that outvotes six words of
ability text is Check this, and the swap goes on the data-fix list).
The visual adversary inspected 59 of the 171 multi-printing rows by eye
against the version the matcher had chosen at that point: 20 wrong
versions, 18 of them silent Matched rows, 31 right, 5 undecidable from
the photo, 3 indistinguishable in print. Its classes, with what became
of each: T2C alt-border with new art (4 wrong; right now by credit and
year); CoW and RoJ same-art alt-border (3 wrong, all booked backwards
because only the AB rows carried the number; right now); promo against
set printing with different art (4 wrong; two of them, Golgotha and
Book of the Law, carry the same credit as the set printing and no
corner was read, so only the art or an unread "P" would tell); promo
against promo (4 wrong, all four printed captions the model had
transcribed verbatim; right now by promo text, and the cue table gains
the printed caption so the match is verbatim rather than scored); old
Limited against Unlimited and 2E reprints (3 wrong, two of them 4/4
cards booked as 6/5 and 5/4 printings, right now by a stats filter; the
Limited and Unlimited pair shares one catalog image and is unresolvable
there); and wording drift between old sets. It caught one identity-level
error: the fifth Lost Souls card in the row of five is the Two Liner,
and the model copied the Three Liner's text onto it. It also found that
the AB and original rows of one card can carry different verses by
data-entry noise, so the reference and ability-tail filters never
separate a card from its own AB twin. A sixth reference error joins the
list: the Baptism fundraiser Son of God prints Matthew 3:16 and is
stored as 28:5-6. Of its 20, three stay wrong (the art-only promos) and
one is the model's copy error. The extra fields cost: spreads $0.024 and p95 12.9 s
against the baseline's $0.019 and 9.2 s, measured with two fields
(border, set icon) that are now dropped.

**What changed because of it:** the step-3 unions, print number in
identity scoring, title variants, compound references, the LR and promo
hints (Recognition); the prompt-size and thinking lines (Cost and
latency); two more reference typos (Dataset numbers); the catalog
sample as the matcher's regression set (Files). The review page, the
re-encoded photos and a draft labels file in the spec's format sit in
`tmp/scan-spike/` (git-ignored) for Tim to correct; corrected, they
become the first `labels.json`.

### E1: during the build

- `lib/scan/match.ts` has golden tests from recorded E0 outputs per
  model; outputs are re-recorded when the model id, prompt or schema
  changes and quarterly as a drift check.
- A prompt change is accepted by a paired run on the same photos, two
  repetitions each: no screen regresses beyond the stage-7 noise floor,
  silent-wrong does not rise, cost per photo within +10%, and a sign test
  on discordant cards favors the change.
- Any PR touching the prompt, schema or matcher re-runs the scorer on
  saved outputs (free) and, when the prompt changed, live (cents).

### E2: before launch

- E0's photos through the deployed route on a preview URL twice: once as
  originals and once as the blobs the client's own resize produces (a
  Playwright run dumps them), so double-JPEG and the `<img>` decode path
  are measured; plus five concurrent uploads.
- Manual pass per the `verify` skill on phone-sized viewports and one
  real iPhone and one real Android: camera capture including a portrait
  iPhone photo through the client path, multi-select, a 48 MP photo, an
  HEIF photo, a 10-card spread, a binder page, a correction through the
  picker, a refresh mid-tray, whether the tray survives a camera-induced
  tab eviction, commit, a double tap on commit, undo, each cap's copy,
  the signed-out gate.

### E3: after launch

Definitions, each one query in `scripts/scan-eval/queries.sql`:

- correction rate = (name changed ∨ printing changed ∨ removed as
  wrong) ÷ committed detections with outcomes, split by status (`check`
  rows are prompted; `matched` rows are not, and mixing them hides the
  silent error).
- not-found rate = not_found ÷ detections; photos with zero detections
  reported separately.
- uncorrected rate by reason code and by stored confidence (not
  "accuracy": players fix what they notice).
- abandonment = done scans with no outcomes after 24 hours ÷ done scans.
- rejections by cap per day; failures ÷ all; p50 and p95 latency; cost
  per day over `done` and `failed`; distinct committing players.

**Audits**, on day 14 and day 45 (a weekly audit will not survive week
three; two dated ones might): export about 100 committed cards each,
stratified to over-sample untouched Matched rows, from players who kept
their photos (the allowlisted testers in week one; opted-in players once
v1.1 ships); Tim labels them in the E0 format; the scorer reports true
accuracy, silent-wrong rate, and the share of cards whose set is visible
in the wild, which is the number the whole printing story rests on.
About 100 cards gives ±6 points. If the audits lapse, Beta stays and no
accuracy claim is published.

**Calibration**: the stored `confidence` earns a chip only if accuracy
differs by at least 15 points between high and low with low covering at
least a tenth of rows. A reason code is useful only if `fuzzy` scores
below `exact`.

A model, effort, tier or prompt change ships only by the E1 acceptance
rule on the full eval set, with the table pasted into the PR.

### Kill, pivot and removal

| Signal | Window, minimum n | Action |
|---|---|---|
| Spend | always | bounded by the global cap and key revocation (Constraints) |
| Correction rate > 30% | days 7–14, ≥ 100 committed detections | keep Beta; pull the v1.1 legend fields and second look forward |
| Printing share of corrections > 0.5 | trailing 14 days, ≥ 30 corrections | start Stage A2 |
| Failure rate > 10%, or p95 latency > 20 s | trailing 3 days | investigate before anything else ships |
| Fewer than 10 distinct players have committed a scan, or the day-45 audit shows silent-wrong above 5% | launch + 90 days | **Removal clause**: one PR removes `/collection/scan`, the route, the entry links and the gear-menu fold; `lib/scan`, the eval harness and migration 122 stay (data is cheap and the matcher is reusable for deck scanning) |

### Scoresheet

Dated, resolvable claims; my estimates before E0; scored in the review
log at each date.

| # | Claim | Resolves | Source | Estimate |
|---|---|---|---|---|
| 1 | Best arm passes the pooled singles screen (≥ 34 of 40) | E0 | run.ts | 70% |
| 2 | Best arm passes the spread false-card and recall screens | E0 | run.ts | 55% |
| 3 | Silent wrong identity ≤ 2 across all E0 photos on the best arm | E0 | run.ts | 60% |
| 4 | High-res beats low-res on print-number non-null by ≥ 10 points | E0 | run.ts | 65% |
| 5 | Sonnet 5.5 passes every screen Opus 5.5 passes, within the latency budget | E0 | run.ts | 65% |
| 6 | Haiku 5.5 is within 3 photos of the leader on singles | E0 | run.ts | 40% |
| 7 | Day-45 audit accuracy on untouched Matched rows ≥ 90% | launch + 45 d | audit export | 60% |
| 8 | At least 10 distinct players commit a scan, with the deck-builder entry | launch + 30 d | scan_events | 50% |
| 9 | Printing share of corrections > 0.5 at n ≥ 30 | launch + 60 d | scan_events | 50% |
| 10 | Scanner workspace spend under the credit for three months | monthly | Console | 95% |
| 11 | v1.0 (PRs A to C) ships within six agent-days of approval, given the photos | merge | git | 55% |

Spike signal (2026-10-27; not a resolution, E0 runs through the route):
claim 1 looks likely (32 of 39 singles Matched, 6 Check this on
multi-year promos, 1 blurry Not found); claim 3 cannot be read without
labels, and the catalog ceiling test shows 2 silent-wrongs in 139
Matched; claim 4 leans no (the tier lift on print numbers was 5
points, not 10, though low-res lost on three other measures); claim 5
leans yes (Sonnet passed every screen Opus passed, within the budget);
claim 6 is met on its letter and fails its intent (Haiku was within
three photos on singles and had four times the silent-wrongs, which
the rule now screens).

## Copy and accessibility

| Key | String |
|---|---|
| Page title | Scan cards |
| First run | Photograph one card, or up to 12 laid flat with gaps. We read the names and prices; you confirm. |
| Capture primary | Take photo |
| Capture secondary | Choose from photos |
| Batch tip | For a stack, take the photos in your camera app first, then choose them here. |
| Binder tip | Binder pages work less well. Lay cards flat with gaps when you can. |
| Empty tray | No cards yet. Take a photo to start. |
| Reading | Reading… |
| Reading, slow | Reading… 12 s |
| Done | 9 cards |
| Progress (desktop, v1.1) | 12 of 40 photos read |
| Too dark | Too dark. Retake in better light. |
| Blurry | Blurry. Hold still and retake. |
| Glare | Glare hides the text. Tilt away from the light. |
| No cards | No cards found in this photo. |
| Too many | Too many cards for one photo. Try 12 or fewer. |
| HEIF | This photo's format can't be opened here. Turn off HEIF or "high efficiency" in your camera, or share it as a JPEG. |
| Too large | Photo is too large to upload. |
| Ten-minute cap | You've hit 20 photos in 10 minutes. Scanning opens again at 3:15 pm. |
| Daily cap | Daily limit reached (150 photos). Scanning opens again tomorrow at 9:02 am. |
| Global cap | The scanner has reached this month's limit for everyone. Back on 12 November. |
| Credit out | The scanner's monthly budget is used up. Back on 1 November. |
| Busy | Busy. Retrying… |
| Generic | Couldn't read this photo. |
| Offline | You're offline. Photos will wait here until you reconnect. |
| Failed-photo actions | Retry · Remove · Choose another |
| Chip check | Check this |
| Chip not found | Not found |
| Reasons | Which printing? Prices differ · Which printing? Legality differs · Two different cards have this name · Couldn't read the scripture reference · Several Lost Souls share this verse · Read as "Saul" |
| Printings line | 3 printings |
| Owned | own 2 |
| Unpriced | No YTG listing |
| Not found action | Find card |
| Picker header | Which printing? |
| Picker name-change header | Which card? |
| Picker search | Search by card name |
| Picker current | Current |
| Picker owned | 2 in your collection |
| Picker empty | No cards match. |
| Quantity label | Quantity |
| Remove | Remove |
| Remove reason | Wrong card · Don't want it |
| Footer total | $84.20 at YTG · 2 unpriced |
| Commit | Add 12 to collection |
| Committing | Adding… |
| Commit failed | Couldn't save. Your tray is still here. Try again. |
| Unresolved warning | 3 cards aren't matched and won't be added. |
| Success | Added 12 cards to your collection. |
| Post-commit actions | Undo · Scan more · View collection (v1.1 adds Add to Haves · Copy priced list) |
| Undo done | Removed 12 cards. |
| Haves done (v1.1) | Added 12 to Haves. |
| Copied (v1.1) | Copied |
| Just added header | Just added |
| Retention note | Photos are sent to Anthropic to read the cards. Anthropic deletes them within 30 days unless its safety systems flag them (then up to two years) and does not train on them. We keep the text we read from each card, not the photo. |
| Retention toggle (v1.1) | Keep my scan photos for 30 days to help improve the scanner |
| Delete photos (v1.1) | Delete my scan photos now |
| Gate | Sign in to scan cards, see what they're worth at YTG, and add them to your collection. |
| Deck-builder link | Scan your cards |
| Beta label | Beta |

Accessibility: chips carry text and `aria-describedby`; `role="status"`
on photo groups; `aria-live="polite"` on the footer total; thumbnail
button "Change printing: {name}, {set}"; crop `alt="Your photo of this
card"` (v1.1); quantity "Quantity 1, change" with "One more {name}" /
"One fewer {name}" on the stepper as the trade list does; focus order
capture → groups → footer; new animations added to the
`prefers-reduced-motion` list in `app/globals.css`; `CardImage` gets a
plain fallback instead of its emoji.

## Files

v1.0 unless tagged.

- `app/collection/scan/page.tsx`, `client.tsx`, `components/`
  (`CaptureButtons`, `PhotoGroup`, `DetectionRow`, `PrintingPicker`,
  `CommitBar`, `SuccessPanel`), `hooks/useScanTray.ts`,
  `hooks/useFocusTrap.ts`.
- `app/collection/client.tsx`: toolbar weights below `sm`, first-run
  banner, `format` and `added` params, Just added group. **v1.1:** Change
  printing and Close in the card modal.
- `app/decklist/card-search/`: the owned-filter empty state and
  `CollectionCheckModal` links; `components/CardImage.tsx` plain
  fallback.
- `app/collection/actions.ts`: `commitScanAction`,
  `adjustCollectionQuantitiesAction`. **v1.1:** `setKeepScanPhotosAction`,
  `deleteMyScanPhotosAction`.
- `app/api/scan/route.ts`; `app/api/prices/route.ts` switches to the
  shared loader.
- `lib/scan/recognize.ts`, `match.ts`, `stemIndex.ts`, `vocab.ts`,
  `schema.ts`, `prices.ts`, `cues.ts`, `gate.ts`, `__tests__/`;
  `lib/scan/generated/printingCues.json` (illustrator credit, © year and
  printed promo caption per printing, built by
  `scripts/scan-eval/build-cues.ts` from the catalog images with one
  Claude call each, about $4.50 for the 1,839 multi-printing rows, re-run
  when `CARDS` changes). **v1.1:**
  `secondLook.ts`.
- `scripts/scan-eval/run.ts`, `score.ts`, `export.ts`, `queries.sql`,
  `labels.json`, `catalog-sample.json` (the 148 labeled catalog printings
  the spike drew, the matcher's regression set), `photos/` (git-ignored;
  shared copy in the Forge private store under `scan-eval/`), `outputs/`
  (recorded model JSON, committed).
- `supabase/migrations/122_scan_events.sql`: both tables, RLS,
  `scan_reserve()`. **v1.1:** the `profiles` column, its own migration.
- `app/privacy/page.tsx`.
- `app/globals.css` reduced-motion list.
- **v1.1:** `lib/cards/setOrder.ts` (legend keyed on `officialSet`,
  per-set border look, set order, abbreviations; the `set_aliases` seed
  and `TAG_SET_TO_ABBREV` in `lib/pricing/matching.ts` are inputs; a
  coverage test against `CARDS`); `app/admin/scans/page.tsx`,
  `app/admin/scans/image/[id]/route.ts`, nav links in
  `components/top-nav.tsx`; `app/api/cron/purge-scans/route.ts` plus a
  daily `vercel.json` entry; the digest.

## Testing

- `lib/scan/match.ts`, `stemIndex.ts`, `vocab.ts`: normalization (case,
  curly quotes, double spaces, slash names, Roman numerals), the two
  index unions, exact and fuzzy rules including the short-name and
  numeral guards and the nine distance-1 pairs, identity scoring on
  Abel, Captain of the Host, The Depraved, King Saul, Pharaoh, Lost Soul
  reference matching with badges and the shared-verse cases, print-
  number extraction, every printing filter and the collapse with price
  fixtures and the floor, the special-printing definitions against
  Dataset numbers, type and brigade mapping, reason fields, and the
  golden set. Vitest, node only.
- `app/api/scan/route.ts`: error mapping and size and format checks with
  the recognizer stubbed; `tsc` clean against the baseline.
- `commitScanAction`: idempotency on a repeated `commitId`, including
  two concurrent calls; `adjustCollectionQuantitiesAction`: decrement to
  zero deletes, never below zero.
- The RPC: a scripted check against a branch database that two
  concurrent reserves at a cap yield exactly one `pending` and one
  `rejected` row, for a user cap, the global photo cap and the spend
  ceiling, and that `source = 'eval'` rows are not counted.
- The scorer's self-tests; the eval script as the recognizer's
  integration test (E0, E1, E2).
- Manual E2 as above.

## Rollout

1. **Tim, before PR B lands** (about 12 to 15 hours in total across the
   rollout): create the `scanner` workspace and key in the Max org, add
   `SCANNER_ANTHROPIC_API_KEY` to Vercel, check the workspace's rate
   tier; confirm reuse of the Forge private store for the eval photos;
   take the 76 photos and ask Discord for the wild bucket; label
   (printing-level, about 350 cards); confirm the three Lost Soul
   references against the printed cards; `/privacy` wording; recruit
   three named players for week one.
2. PR A (matcher, loader, harness), PR B (migration, RPC, gate, route).
   Apply migration 122 to production before E0, since the preview shares
   the database. Run E0 through B on a preview URL with a minted
   superuser session and the `arm` override; record numbers and
   decisions in the review log; pick model, effort, thinking, tier.
3. PR C-core (page, tray, picker, commit, undo) and PR C-entry (entry
   links, `/privacy`, shared-file edits). E2. Merge with `canScan` set to
   superuser plus an allowlist of the three testers' user ids (env
   `SCANNER_ALLOWLIST`), Beta label on.
4. Week two: open the gate; one What's New line; a 20-second Discord
   video; WAF rate rule.
5. Day 14 and day 45 audits; monthly SQL purge of unmatched detections
   until the v1.1 cron.

## Left to the builder

- Fuzzy margin, identity scoring weights, `max_tokens`, effort, tier:
  from E0 and E1.
- Whether `importRows`' deck-builder `Card` type is bridged or
  `bulkImportCollectionAction`'s row shape is called directly.
- Component split inside the client as long as the listed pieces exist.
- Request validators: the repo has no zod; hand-rolled validators for
  commit rows and detection caps.
- The gear menu below `sm` holds only Clear today; the fold adds three
  items.
- Exact copy beyond the table, within the design system's tone.
- **v1.1:** legend contents and set order (hand-written; the repo has no
  release years).

## Review outcomes

Four rounds, sixteen reviewers, then a spike against real photos and
catalog images (round 5 in the log). The full log with every finding is
in `2026-10-26-card-scanner-review-log.md`.

| Round | Finding | Change | Section |
|---|---|---|---|
| 1 | Names embed the printing; `CARD_BY_NAME_LOWER` is private and last-wins | Match on stems and identities | The matcher |
| 1 | Lost Souls all titled "Lost Soul" | Resolve by reference, nickname, ability | The matcher |
| 1 | A vision model returns a plausible wrong name | Transcribe corroborating fields; gate silent-wrong | Transcription fields; E0 |
| 1 | Two modes resolved the same photo differently | One flow; price always visible | The flow |
| 1 | Per-user cap racy; RLS forgeable; `registration_admin` retired | Reserve-first RPC; no writes for `authenticated`; `is_superuser()` | Reserve first; Migration |
| 1 | Spend on a personal credit with no isolation | Dedicated scanner key and workspace | Constraints |
| 1 | EXIF and oversized uploads | Server-side sharp re-encode | `POST /api/scan` |
| 2 | 64% of printings share a stem; promos pricier in 62 of 67 | Filters then collapse; special printings defined from data | Printing selection |
| 2 | 131 stems have a distance-1 neighbor | Guarded fuzzy | The matcher |
| 2 | Second look was uncapped and uncounted | One capped call under the same reservation (v1.1) | Second look |
| 2 | WebKit drops EXIF on `createImageBitmap(file)` | Decode through `<img>` | Capture |
| 2 | Thinking unbounded; SDK cannot attribute it | `max_tokens` 16k with retry; no "too many cards" mapping | The Claude call |
| 2 | 28-px patch rule and 4,784 cap | Tiers and cost table rebuilt | Cost and latency |
| 2 | Burst cap walled a shoebox evening; Haves before commit flagged rows; View collection hid added cards | 20 per 10 min; Haves after commit; `format` and `added` params | Reserve first, then call; Success state |
| 2 | 25 photos cannot certify 90% | Pre-registered screen; audits certify; dated scoresheet | Evaluation |
| 3 | 36 collectors; 7 active last month | Scope cut; deck-builder front door; removal clause; Sonnet under a latency budget | Scope; Routes; Kill |
| 3 | Per-user lock cannot serialize the global cap | One constant-key lock | Reserve first |
| 3 | House dialog has no focus trap; merge import cannot decrement; `putItems` overwrites | Local focus trap; `adjustCollectionQuantitiesAction`; add-to-existing Haves | Picker; Success state |
| 3 | Prices needed before matching; attempts vs calls; counts 248 / 6; row width left no room for Remove | Route order; attempts; Dataset numbers; row budget | `POST /api/scan`; The Claude call; The tray |
| 3 | Double-tap commit double-adds | Idempotent `commitScanAction` | Commit |
| 4 | E0's requests would run through player caps and pollute metrics; arms could not reach the deployed route | `source = 'eval'` exempt from caps and queries; superuser-only `arm` override | Reserve first, then call; `POST /api/scan` |
| 4 | Idempotency had no store and raced; undo relied on the tray | `scan_commits` insert-first; server-authoritative deltas; delete at zero | Commit; Success state |
| 4 | Photo caps bound photos, not tokens; Goal 6 overstated | 30-day spend ceiling in the RPC | Reserve first, then call |
| 4 | Thinking is not always on for Sonnet or Haiku; stage 1 was not paired on effort | Thinking-off arm; effort pinned per stage | The Claude call; E0 |
| 4 | Page and route gates could diverge; `added` carried scan ids, not keys; cross-photo duplicates undefined | `canScan` module; keys via outcomes; duplicates merge into the earlier row | Reserve first, then call; Routes; The tray |
| 5 | Spike: reprints with changed text tie on reference and stats; AB and decoration splits are separate identities; dual names and parenthesised subtitles have no stem; compound references miss | Unions; print number in identity scoring; title variants; component references | The matcher |
| 5 | Spike: promo text in the corner is read reliably; Legacy Rares print "LR"; AB cards print the plain number | `promo_text` and `legacy_rare` hints in v1.0; number parsing | Printing selection |
| 5 | Spike: instruction and schema are about 1,880 tokens; `low` effort runs without thinking; two more reference typos | Cost lines corrected; typo list; E0 preview | Cost and latency; Dataset numbers; Evaluation |
| 5 | Tim's review of the page: Nationals promos carry the tournament line in the card body; alt-border cards booked as originals; a Lost Souls pair differs only in the ability tail | `promoText` and `abilityEnd` fields; reference and ability-tail printing filters; placement and year matching; `border` tried and rejected | Transcription fields; Printing selection |
| 6 | Versions pass: text-identical printings are worth about $0.50; promos, Legacy Rares, UR+ and four parser gaps are where silent booking loses money; the credit separates different-art pairs, the year T2C AB and K-deck pairs; frame-only AB pairs need the art tiebreaker | `illustrator` and `copyrightYear` fields; per-printing cue table; parser fixes; the number no longer decides an AB pair; promo scorer restricted to placement and year | Transcription fields; Printing selection; Files; Dataset numbers |

Rejected or deferred: art tiebreaker in v1 (depends on unmeasured crop
quality); legend image in every prompt (E0 arm only); higher global caps
(exceed the credit); 20 to 30 card spreads as a target (measured bucket
only); Add to Wants and Recent scans (v1.2); dropping prices from
candidates (the rules need them); treating Fundraiser as standard; a
weekly audit (two dated audits instead); a new Radix dialog dependency
(local focus trap instead); dropping `confidence` from storage (stored,
not shown); an Opus baseline (Sonnet under a budget, Opus by exception);
an admin page in v1.0 (SQL through the MCP instead).

Unrelated finding, flagged once: `scripts/run-claude-matching.ts` calls
`claude-sonnet-4-20250514`, retired on 2026-06-15; current Sonnet is
`claude-sonnet-5-5`.

## Calls I made (for review)

1. Scope cut to v1.0 / v1.1 / v1.2 with a three-PR series, on the
   production usage numbers.
2. The deck builder's owned-cards filter and Check my collection modal
   are the front door, with "see what your cards are worth" as the lead.
3. Sonnet 5.5 baseline chosen by a latency budget; Opus only if it is
   the only model that passes and meets the budget.
4. A thin route behind the superuser gate lands before E0, so E0
   measures the deployed path.
5. Server-side vision; the model transcribes fields, the app matches on
   stem, identity and printing. The model never picks a key.
6. Printing rules are filters (hints, special printings out, Rotation
   in) then a collapse with a $2 price-delta floor.
7. Fuzzy matching guarded by length, reference agreement and a numeral
   rule rather than a bare threshold.
8. One flow, no modes; price always visible; Add to collection primary;
   undo by delta; Haves and the priced list in v1.1.
9. Sign-in required; reserve-first under one global lock; three caps;
   rejected rows recorded; a dedicated scanner key; soft launch behind
   an allowlist for a week.
10. Idempotent commit.
11. v1.0 keeps transcriptions, never photos; the privacy copy says so; a
    `/privacy` page exists.
12. Two dated audits instead of a weekly one; no admin page in v1.0.
13. A removal clause with a date and a criterion.
14. Review log moved to a sibling file; outcomes table inline.
15. E0 traffic is tagged `source = 'eval'` and exempt from caps and
    metrics; a 30-day spend ceiling sits beside the photo caps; commits
    are idempotent through `scan_commits`; thinking-off is an E0 arm.
16. Promo text in the corner is a v1.0 printing hint, on the spike's
    measurement rather than the earlier plan to wait for v1.1.
17. The 148-card catalog sample is the matcher's regression set, and
    the step-3 unions are the scanner's own, layered on
    `cardIdentityKey` without changing it.
18. `promoText` and `abilityEnd` are v1.0 transcription fields on the
    second pass's measurement; `border` is rejected on the same
    measurement.
19. The per-printing cue table (credit, year) is generated from the
    catalog images with the model, not hand-entered, and rebuilt when
    `CARDS` changes; `illustrator` and `copyrightYear` are v1.0 fields.
20. Frame-only AB pairs stay on "original wins" at equal price with the
    twin on the printings line; the art tiebreaker (v1.2) is scoped to
    them and to the different-art pairs whose credit was unreadable.
