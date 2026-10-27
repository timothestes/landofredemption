# Card scanner — design

Date: 2026-10-26; rev 4 on 2026-10-27 after three review rounds (fourteen
reviewers; outcomes at the end, full log in
`2026-10-26-card-scanner-review-log.md`). Not yet approved.

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
| AB printings (`set` ends `(AB)`, equals `abMap.json`) | 387 |
| Legacy Rare printings | 72 |
| UR+ printings (`imgFile` ends `-UR+`) | 6 |
| Rotation-legal printings | 3,190 |
| Rotation printings whose `imgFile` starts with a print number | 1,750 (2,548 counting letter-prefixed codes whose meaning E0 must confirm) |
| Lost Soul printings / identities | 263 / 170 |
| Lost Soul references shared by more than one identity | 32 (69 identities) |
| Stems with another stem at edit distance 1 / 2 | 131 / 389 |
| Stems of five characters or fewer; of those with a neighbor within distance 2 | 170; 147 |
| Different cards at distance 1 / 2 that type and brigade cannot separate | 9 / 42 |
| Set codes / official sets / `[Ban]` marker codes | 55 / 49 / 6 |
| Distinct `brigade` strings | 257 |
| Cards with a `reference` value | 5,687 |

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
schema, recognizer and the eval harness (pure code, no migration);
B migration 122, `scan_reserve()`, the shared price loader and
`POST /api/scan` behind `is_superuser()`; E0 runs through B on a preview
deployment; C the scan page, tray, commit, undo and the entry links,
then the gate opens to the allowlist and then to everyone.

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
6. Spend bounded by construction: no path can exceed the global cap,
   which is set below the Max plan's monthly credit (Constraints; Reserve
   first).

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
| `type` | icon-box type as printed (Hero, Evil Character, Enhancement, Lost Soul, Dominant, Site, Fortress, Artifact, Covenant, Curse, City, token, unknown) | identity scoring; Lost Soul routing |
| `brigade` | frame color words | identity scoring |
| `strength`, `toughness` | the two numbers top-left | identity scoring |
| `identifier` | the small badge text | identity scoring |
| `printNumber`, `rarityCode` | corner number and letters ("81", "UR+"; "LR65" is number "65", code "LR") | printing hint |
| `grid` | row and column in reading order | ordering; crops (v1.1) |
| `orientation` | upright, rotated, upside-down | information |
| `confidence` | high, medium, low | stored; shown nowhere unless calibration earns it a chip |
| `setMarking`, `setIconNote`, `border`, `copyrightYear` | **v1.1** | set legend hints |
| `bbox` | **v1.1**, normalized | crops |

Plus `photoQuality`: ok, blurry, dark, glare, too_many_cards, no_cards.

### The Claude call

`lib/scan/recognize.ts`, server only. Client
`new Anthropic({ apiKey: SCANNER_ANTHROPIC_API_KEY, maxRetries: 0,
timeout: 25_000 })`; one manual retry on 5xx, 529 or timeout, never on a
refusal; so a photo is at most two billed attempts in v1.0 (`calls`
records attempts). `export const maxDuration = 90` on the route.

- `messages.create` with the image as a base64 block after a fixed
  instruction block. Model from a constant, baseline `claude-sonnet-5-5`
  (Cost and latency says why), `output_config.effort` from a constant
  (E0 picks `low` or `medium`), adaptive thinking at its default, no
  `temperature` (rejected on these models), no `cache_control` in v1
  (the prompt sits near the 512-token caching minimum and traffic is too
  sparse for the five-minute window; E0 confirms with
  `cache_read_input_tokens`).
- Structured output through `output_config.format` with the JSON schema
  in `lib/scan/schema.ts`; no tools.
- **Image tokens follow the 28-pixel-patch rule**, `⌈w/28⌉ × ⌈h/28⌉`,
  capped at 4,784 for the high-resolution tier that Opus 5.5, Sonnet 5.5
  and Haiku 5.5 all belong to; a 4:3 photo is downscaled to about 2212 ×
  1659 regardless, so the server encodes to the tier itself and
  positions map one to one.
- **Thinking is always on and billed as output** on these models, is not
  bounded by effort, and the installed SDK (0.78) cannot separate it
  from text in `usage`. `max_tokens` is 16,000; a `max_tokens` stop
  retries once at 32,000 and then is a 502. It is never read as "too
  many cards".
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
it runs, because the collapse rule needs them.

1. **Normalize.** Lowercase, straight quotes, punctuation stripped,
   whitespace collapsed; references with Arabic and Roman book numbers
   folded together; type and brigade mapped to dataset vocabulary
   ("Enhancement" becomes `GE` or `EE` by alignment; brigades compared as
   color-token sets).
2. **Stem lookup.** A stem index built once from `CARDS` on the
   normalized stem, with two unions baked in: the spelling-variant stem
   pairs (Wizard/Wizards, Elisabeth/Elizabeth, Judgements/Judgments) and
   the reprint identities split only by the `class` column (Dataset
   numbers). Exact hit first. Otherwise **fuzzy**: normalized
   optimal-string-alignment distance over the normalized stems, accepted
   only if the distance is at most 0.20 **and** either the stem is eight
   or more characters or the transcribed reference agrees with the
   candidate, **and** the difference is never a digit or Roman numeral
   (Herod Agrippa I/II, King Jeroboam I/II, Seraphim Isaiah 6:2/6:6),
   with a margin over the runner-up set in E1. Short names are where
   fuzzy matching is unsafe (Cage/Rage, Dove/Love, Winds/Wings, Job/Lot,
   Jude/Luke; Dataset numbers). No acceptable hit is **Not found**.
3. **Identity within the stem.** If one identity, done. Otherwise score
   each identity on fields in this priority: reference, then strength
   and toughness, then identifier, then brigade, then ability prefix (the
   least reliably read). A clear winner is taken; otherwise the row is
   **Check this** with `identity_ambiguous` and the identities as
   candidates.
4. **Lost Souls.** Title "Lost Soul" skips steps 2 and 3: the normalized
   reference selects identities; the nickname badge and ability prefix
   break ties. No reference read is `reference_missing`; a reference
   still matching several identities is `reference_ambiguous`; both are
   **Check this** with the picker scoped to Lost Souls. Three dataset
   reference typos (Lost Soul "Blind", "Lawless" AB, "Retribution") are
   verified against the printed card and, if wrong, fixed through the
   catalog override (`/admin/catalog`, live after a deploy), not in this
   migration; the fix reshapes `cardIdentityKey` unions, which is
   intended.
5. **Printing selection** (next section).
6. **Score fields** on every detection: `matchScore`, `runnerUpScore`,
   `agreeingFields`.

### Printing selection

Among the identity's printings, **successive filters, then a collapse**:

1. **Hints.** A corner print number matching one printing's `imgFile`
   number chooses it (`print_number`). The number is the leading digit
   run of `imgFile` after any set prefix ending in `_` ("081-Authority-
   of-Christ-UR+" → 81; "LoC_232-…" → 232); letter-prefixed forms
   ("L20-", "K13-", "CoW_AB_N03-") count only if E0 shows the card prints
   them that way. AB reprints share the number with their original; in
   v1.0 the original wins that pair (v1.1's border and copyright fields
   break it). A transcribed `rarityCode` of `UR+` matching an `imgFile`
   ending `-UR+` chooses the UR+ printing. **v1.1:** `set_hint` from the
   legend, `border`, `copyright_year` as a weak tiebreak.
2. **Special printings out.** Unless a hint supports one, remove special
   printings when at least one standard printing remains:

   | Class | Rule from the data |
   |---|---|
   | Promo | `set` starts `Pmo`, or `officialSet` starts `Promo`, or `rarity` in {Promo, National, Seasonal, Regional, State, Local, District, Winner, "National, Winner"}; this captures the 40 Fundraiser cards and nine promos filed under `GoC`/`LoC` |
   | AB | `set` ends `(AB)` |
   | Legacy Rare | `rarity === 'Legacy Rare'` |
   | UR+ | `imgFile` ends `-UR+` |

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

`nameReason` ∈ {exact, fuzzy, reference, second_look, none}.
`printingReason` ∈ {only, print_number, set_hint, border, copyright_year,
second_look, equivalent, printing_ambiguous, identity_ambiguous,
reference_missing, reference_ambiguous}. Chips key on status and
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
because it depends on crop quality, which E0 measures first.

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
the leader on singles. Pre-E0 estimates (instruction and schema about
900 tokens; output is JSON plus thinking), replaced by measured `usage`:

| Photo | Image tokens | Input total | Est. output | Sonnet 5.5 | Opus 5.5 | Haiku 5.5 |
|---|---|---|---|---|---|---|
| Single, low-res tier (4:3 at 1269 × 952) | 1,564 | ~2,450 | ~800 | ~$0.013 | ~$0.026 | ~$0.0006 |
| Spread, low-res tier | 1,564 | ~2,450 | ~2,000 | ~$0.025 | ~$0.050 | ~$0.0012 |
| Spread, high-res tier (4:3 at 2212 × 1659) | 4,740 | ~5,640 | ~2,000 | ~$0.031 | ~$0.063 | ~$0.0016 |
| Second look, six rows (v1.1) | ~9,200 | ~10,100 | ~500 | ~$0.025 | ~$0.048 | ~$0.0013 |

On a 4:3 high-res spread each of 12 cards is about 390 px wide; at the
low-res tier about 240 px, where corner numbers will mostly come back
null. E0 stage 3 decides whether the extra tokens buy printing accuracy.
At the global cap of 1,500 photos a month, all high-res spreads, the
worst case is about $47 on Sonnet, $95 on Opus, $2.40 on Haiku; with a
v1.1 second look on every photo, $85 on Sonnet. E0's measured costs set
the final cap constants so the worst case on the chosen model sits under
the credit.

## The flow

### Routes and entry points

| Route | Who | What |
|---|---|---|
| `/collection` | signed in | Toolbar: below `sm`, **Scan cards** (primary) and Build a deck (outline), with Set completion, Import and Export folded into the gear menu (the header already wraps at 390 px); on desktop Scan sits beside Import CSV at existing weights. First-run banner's call to action becomes Scan cards, Import CSV a text link. New `?format=Unlimited` and `?added=<scanIds>` params; `added` sorts those keys first under a *Just added* header. **v1.1:** Change printing and a Close button in the card modal. |
| Deck builder | anyone | The Cards I own filter's empty state and the Check my collection modal get a "Scan your cards" link to `/collection/scan`. This is the front door: it is where players who have never opened `/collection` discover that a collection exists. |
| `/collection/scan` | signed in; soft launch gate (Rollout) | The scanner. Signed out: the existing gate with the scanner's copy and `redirectTo=/collection/scan`. A route, not a modal, because a camera round-trip can evict the tab and a route restores cleanly. |
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
merge import does. The set is always shown.

Row at 390 px (content width 358): `[thumb 44] [8] [text 194] [8] [qty
56] [4] [remove 44]`. Line one: name (truncated) left, price right in
`text-sm tabular-nums` per `useShowPrices`, or *Unpriced* linking to the
YTG search page. Line two, 12 px: `Kings · own 2`, or `Check this · Which
printing? Prices differ` (truncate the reason, never the chip), or `3
printings`. On a `fuzzy` row the set moves to line one after the name
and line two reads *Read as "Saul"*. The quantity is a tappable "×1" that
opens a stepper. **Remove** is a visible 44 px control; swipe is a
shortcut. The thumbnail-plus-name is one 44 px target that opens the
picker, labeled "Change printing: Son of God, Kings". Owned quantity
comes from `useCollectionState`, which the deck builder already mounts.

Chips:

- **Matched**: no chip for `only`, `print_number`, `set_hint`, `border`,
  `copyright_year`; the printings line as muted text for `equivalent`.
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
outcomesByScanId)`, idempotent on a client-generated `commitId` stored
on the scan events: a double tap, or a retry after a timeout the server
had already completed, returns the stored result instead of adding
twice. The button is disabled while in flight. The action performs the
merge import (the same path as `bulkImportCollectionAction` in `merge`
mode, which sums quantities) and writes outcomes in one call.

### Success state

The committed rows stay on screen with their new owned totals, plus:

- **Undo**: a new `adjustCollectionQuantitiesAction(deltas)` subtracts
  this commit's per-key deltas (the merge import drops non-positive
  rows and cannot decrement); disabled after a later commit; toast *Undo
  done*.
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

Request: `multipart/form-data` with `photo` (≤ 3 MB). Order inside the
route: session check before the body is read; `scan_reserve()`; sharp;
prices loaded once; recognizer; matcher; (v1.1) second look and printing
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
    candidates: [{ key, name, set, officialSet, imgFile, legality, price | null, owned }]
  }],
  usage: { model, latencyMs, attempts }
}
```

| HTTP | `code` | Trigger | Copy key |
|---|---|---|---|
| 401 | | no session | gate |
| 413 | | body too large (also Vercel's own `text/plain` 413 by header) | Too large |
| 415 | `undecodable` | sharp cannot decode | HEIF |
| 429 | `cap_user_10m` / `cap_user_24h` | user caps, with `resetsAt` | Ten-minute cap / Daily cap |
| 503 | `cap_global_30d` | global cap, `Retry-After` | Global cap |
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
everyone's rows in the trailing 30 days, counting `pending`, `done` and
`failed` and excluding `rejected`, checking the user caps first. It then
either inserts a `pending` row and returns its id, or inserts a
`rejected` row naming the cap and returns the cap and `resets_at`. Only
then does the route call the model, and it finishes the row (`done` or
`failed`, with model, tokens, latency, attempts, cost) through the admin
client. Cap hits are observable; model latency is never a race window.

| Scope | Window | Limit |
|---|---|---|
| Per user | 10 minutes | 20 photos |
| Per user | 24 hours | 150 |
| Everyone | 30 days | 1,500 |

Copy for the caps interpolates the RPC's constants and `resets_at`.

### Migration `122_scan_events.sql`

Latest migration on `origin/main` is 121; re-check at merge.

```
scan_events (
  id uuid pk default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null check (status in ('pending','done','failed','rejected')),
  rejected_cap text,
  model text, attempts smallint, latency_ms integer,
  input_tokens integer, output_tokens integer,
  cost_usd numeric(8,5),               -- from a per-model price constant
  photo_quality text,
  detections jsonb,                    -- always stored; every read field capped in code (title 60, reference 40, nickname 30, ability 80, identifier 40, type 30, brigade 40, numbers 8; v1.1 marking 20, icon note 60)
  outcomes jsonb,                      -- set on commit
  commit_id uuid,                      -- idempotency key of the commit that wrote outcomes
  image_pathname text,                 -- v1.1: private Blob pathname when opted in
  image_expires_at timestamptz         -- v1.1
)
```

RLS: `SELECT` own rows; superuser sees all through the existing
`is_superuser()` function (migration 062; a fixed-uid check, not a
table). **No INSERT or UPDATE grant to `authenticated`**: writes go
through `scan_reserve()` or the admin client, so nobody can forge
events, token counts or detections. `commitScanAction` filters by the
caller's `user_id`, validates the JSON shape, and caps its size. Indexes
on `(user_id, created_at desc)` and `(created_at)`. **v1.1:** a boolean
`keep_scan_photos` on `profiles`.

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
`scripts/scan-eval/queries.sql` and run through the Supabase MCP; the
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
URL, so the resize and upload path is measured from the start; the
first photos come from the real client. Stages, each paired on the same
photos:

0. Smoke: five photos through every arm; assert model, stop reason,
   schema parse; run the scorer's self-tests.
1. Model screen: Sonnet 5.5, Opus 5.5, Haiku 5.5 at default effort on
   the 40 singles and the 14 spreads of twelve or fewer. Drop a model
   that is four or more photos behind the leader on paired singles.
2. Effort: the leader at the other effort, same 54 photos.
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

About 440 requests for v1.0's stages; stages 4 to 6 add about 90. A few
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
  `schema.ts`, `prices.ts`, `__tests__/`. **v1.1:** `secondLook.ts`.
- `scripts/scan-eval/run.ts`, `score.ts`, `export.ts`, `queries.sql`,
  `labels.json`, `photos/` (git-ignored; shared copy in the Forge private
  store under `scan-eval/`), `outputs/` (recorded model JSON, committed).
- `supabase/migrations/122_scan_events.sql`: table, RLS, `scan_reserve()`.
  **v1.1:** the `profiles` column.
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
- `commitScanAction`: idempotency on a repeated `commitId`.
- The RPC: a scripted check that two concurrent reserves at a cap yield
  exactly one `pending` and one `rejected` row, for a user cap and for
  the global cap.
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
2. PR A (matcher, harness), PR B (migration, RPC, route behind
   `is_superuser()`). Apply migration 122 before merging B. Run E0
   through B on a preview URL; record numbers and decisions in the
   review log; pick model, effort, tier.
3. PR C (page, commit, entry links). E2. Merge with the gate set to
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
- Exact copy beyond the table, within the design system's tone.
- **v1.1:** legend contents and set order (hand-written; the repo has no
  release years).

## Review outcomes

Three rounds, fourteen reviewers. The full log with every finding is in
`2026-10-26-card-scanner-review-log.md`.

| Round | Finding | Change | Section |
|---|---|---|---|
| 1 | Names embed the printing; `CARD_BY_NAME_LOWER` is private and last-wins | Match on stems and identities | The matcher |
| 1 | Lost Souls all titled "Lost Soul" | Resolve by reference, nickname, ability | The matcher |
| 1 | A vision model returns a plausible wrong name | Transcribe corroborating fields; gate silent-wrong | Transcription fields; E0 |
| 1 | Two modes resolved the same photo differently | One flow; price always visible | The flow |
| 1 | Per-user cap racy; RLS forgeable; `registration_admin` retired | Reserve-first RPC; no writes for `authenticated`; `is_superuser()` | Reserve first; Migration |
| 1 | Spend on a personal credit with no isolation | Dedicated scanner key and workspace | Constraints |
| 1 | EXIF and oversized uploads | Server-side sharp re-encode | API |
| 2 | 64% of printings share a stem; promos pricier in 62 of 67 | Filters then collapse; special printings defined from data | Printing selection |
| 2 | 131 stems have a distance-1 neighbor | Guarded fuzzy | The matcher |
| 2 | Second look was uncapped and uncounted | One capped call under the same reservation (v1.1) | Second look |
| 2 | WebKit drops EXIF on `createImageBitmap(file)` | Decode through `<img>` | Capture |
| 2 | Thinking unbounded; SDK cannot attribute it | `max_tokens` 16k with retry; no "too many cards" mapping | The Claude call |
| 2 | 28-px patch rule and 4,784 cap | Tiers and cost table rebuilt | Cost and latency |
| 2 | Burst cap walled a shoebox evening; Haves before commit flagged rows; View collection hid added cards | 20 per 10 min; Haves after commit; `format` and `added` params | Caps; Success state |
| 2 | 25 photos cannot certify 90% | Pre-registered screen; audits certify; dated scoresheet | Evaluation |
| 3 | 36 collectors; 7 active last month | Scope cut; deck-builder front door; removal clause; Sonnet under a latency budget | Scope; Routes; Kill |
| 3 | Per-user lock cannot serialize the global cap | One constant-key lock | Reserve first |
| 3 | House dialog has no focus trap; merge import cannot decrement; `putItems` overwrites | Local focus trap; `adjustCollectionQuantitiesAction`; add-to-existing Haves | Picker; Success state |
| 3 | Prices needed before matching; attempts vs calls; counts 248 / 6; row width left no room for Remove | Route order; attempts; Dataset numbers; row budget | API; Claude call; Tray |
| 3 | Double-tap commit double-adds | Idempotent `commitScanAction` | Commit |

Rejected or deferred: art tiebreaker in v1 (depends on unmeasured crop
quality); legend image in every prompt (E0 arm only); higher global caps
(exceed the credit); 20 to 30 card spreads as a target (measured bucket
only); Add to Wants and Recent scans (v1.2); dropping prices from
candidates (the rules need them); treating Fundraiser as standard; a
weekly audit (two dated audits instead); a new Radix dialog dependency
(local focus trap instead).

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
