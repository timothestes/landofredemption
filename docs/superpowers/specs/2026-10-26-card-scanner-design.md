# Card scanner: photograph cards, add them to your collection, see what they're worth — design

Date: 2026-10-27. Status: **rev 3, after two adversarial rounds** (ten
reviewers in total; log at the end). Not yet approved.

## Intent

Players own shoeboxes of Redemption cards and no fast way to get them into
the site's collection tracker, or to learn what a card sells for, without
typing names one at a time or hand-building a CSV. This feature lets a
signed-in player photograph one card or a flat spread of cards, get the
cards recognised, confirm or fix the matches on a review list, and add
them to their collection in one tap, with each card's Your Turn Games
(YTG) price and the running total always in view.

The inspiration is a community tool (banana346-cyph's "redemption
scanner"). It proved players want this, and studying its source taught
us what the hard problem is: not reading titles, but telling printings
apart. We are not copying it. That tool runs entirely on the phone
(a 7 MB first load of OCR data and image descriptors), keeps the
collection only on the device, knows only the cards YTG lists, learns
card *types* per phone and never names, and has no accuracy measurement
anywhere. Ours is account-backed, recognises on the server so a cheap
Android and an iPhone behave the same, covers every printing in the card
dataset, prices through the existing SKU-level YTG matching, and turns
every correction into labelled evaluation data for everyone.

The scanner must be a smooth slot-in. It reuses the collection tracker
and its merge import, the trade list's Haves, the price cache and
product links, the card identity module, the Radix dialog, and the
existing card components. It adds one page, one API route, one small
library, one migration, one admin table, one cron, one short privacy
page and one evaluation script.

## Vocabulary

- **Photo**: one image the player captured or picked; one card or a flat
  spread.
- **Detection**: one card the recogniser believes is in a photo, with
  everything it could transcribe (fields below).
- **Stem**: the printed title with the dataset's printing decorations
  removed. `cardNameStem(name, type)` in `lib/cards/cardIdentity.ts`
  strips trailing bracketed groups and, except on Lost Souls, a trailing
  nickname: "Son of God (J)", "Son of God [K]" and "Son of God
  [Fundraiser]" share the stem "Son of God". It does **not** fold case,
  quotes or punctuation; the scanner's stem index does.
- **Identity**: the card a player would say they own regardless of
  printing. `cardIdentityKey` groups printings by stem plus type,
  brigade, alignment and class, then unions on ability text or a shared
  scripture reference. It splits a few true reprints that differ only in
  `class` spelling (43 pairs); the matcher merges those back.
- **Printing**: one row of `CARDS`, identified by the app-wide card key
  `name|set|imgFile`, the key `collection_cards` and `card_prices` use.
  Printings of one identity are enumerated as
  `CARDS.filter(c => cardIdentityKey(c) === key)`; `printingsForKey`
  returns names, and twelve names have two rows.
- **Candidate**: a printing a detection may be.
- **Tray**: the matched cards accumulated across photos in one session.
- **Commit**: writing the tray to the collection.

Dataset numbers behind this design, measured on 2026-10-27 against
`cardData.json` and the live price map:

| Quantity | Value |
|---|---|
| Printings / distinct names / stems / identities | 5,693 / 5,681 / 3,521 (3,452 after normalisation) / 4,769 |
| Stems with two or more printings | 1,444 (3,616 printings, 63.5%) |
| Stems with an unsuffixed twin (a plain name plus decorated ones) | 757 (1,706 printings, 30.0%) |
| Stems holding more than one identity (homonyms, excluding Lost Souls) | 959 (2,569 printings, 45%) |
| Identities with more than one printing | 795 (1,719 printings, 30.2%) |
| Identities whose printings differ in price or legality, before any rule | 319 (708 printings, 12.4%) |
| Same, after the printing filters below | 64 (153 printings, 2.7%) |
| Identities with both a promo and a standard printing, promo pricier | 62 of 67, median gap $14, max $255 |
| Lost Soul printings / identities / references shared by more than one identity | 263 / 170 / 32 (69 identities) |
| Printings whose corner print number is encoded in `imgFile` | 2,529 (2,521 of the 3,190 Rotation-legal) |
| Stems with another stem at edit distance 1 / 2 | 131 / 389 |
| Different cards at distance 1 / 2 that type and brigade cannot separate | 9 / 42 |
| Set codes / official sets / AB pairs / Legacy Rares / UR+ printings | 55 / 49 / 387 / 72 / 12 |
| Cards with a `reference` value | 5,687 of 5,693 |

## Goals

1. From the phone camera to a reviewed, committed tray of a dozen cards
   in under a minute.
2. Name recognition good enough that the player corrects the exception,
   not the rule: measured in E0 as a screen and certified after launch by
   an audit sample (see Evaluation).
3. Printing chosen sensibly when the photo does not settle it, marked
   only when the choice matters (price or legality differ), and fixable
   in one tap during and after commit.
4. Bulk-friendly: many photos per session, many cards per photo, nothing
   important lost on a page refresh, commit whenever, undo after.
5. Every scan, correction, rejection and abandonment recorded as
   structured data so quality is observable week over week and the
   evaluation set grows for free.
6. Spend bounded by construction: every model call is reserved against
   per-user and global caps in Postgres before it is made, the scanner
   has its own API key, and no path can exceed the Max plan's monthly
   credit.

## Non-goals

- On-device recognition or offline use.
- Prices from anyone but YTG.
- A trade flow. Trade lists exist; the success state can add committed
  cards to Haves and stops there.
- Scanning a deck into the deck builder. Same engine, different flow,
  later.
- A live viewfinder. The native camera is the viewfinder.
- Condition grading, counterfeit detection.
- Signed-out use. Wanted, but the anonymous rate limiter is dead
  (Constraints).

## Anti-goals

- A scanner that is confidently wrong. A vision model fails differently
  from OCR: OCR produces garbage you can distance-match, a vision model
  produces a plausible real card name. Every rule below that asks for a
  corroborating field exists for this reason, and "silent wrong
  identity on a Matched row" is the one number E0 and E3 gate hardest.
- A heavy page. Nothing recognition-related ships to the phone.
- Photos retained without the player saying so.
- A second collection. The tray is temporary; the durable store is
  `collection_cards`.
- Shipping without a measured accuracy number.
- A feature that can quietly spend money.

## Constraints

- **Recognition runs on Claude vision.** The app's key was rotated on
  2026-10-26 to the Max-plan organisation (Tim's Individual Org), which
  receives $100 of API credit a month; unused credit expires monthly and
  the org has no card on file, so overrun is an outage, not a bill. The
  scanner gets its **own key in its own workspace** in that org (env
  `SCANNER_ANTHROPIC_API_KEY`) so its spend is visible by itself in the
  Console and revoking the key is an instant, no-deploy kill switch. The
  listings cron keeps the shared key.
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
  (which is per `officialSet`) and the "to buy at YTG" total on
  `/collection`.
- **Printed titles carry no set.** What a modern card does print: a
  corner print number with a rarity code ("81 UR", "LR65", "250"), a
  copyright year, a set icon, a border look that varies by set
  (Crown of Thorns AB is borderless; Tribulation to Conquest AB is a
  darker framed border), the scripture reference, strength and
  toughness, and an identifier badge ("Generic", "Idol"). Lost Souls
  are all titled "Lost Soul"; modern frames add a nickname badge
  ("Speed Bump", "Shut Door"). Redemption has no foils.
- **Dataset vocabulary is not printed vocabulary.** `type` values are
  codes (`GE`, `EE`, `GE/EE`, `Hero`, `Evil Character`, `Hero/Evil
  Character`, `Dominant`, `Artifact`, `Fortress`, `Site`, `City`,
  `Curse`, `Covenant`, `Lost Soul`, slash combinations); `brigade` has
  257 distinct strings ("Blue (Blue/Red)", "Purple (Clay)"); references
  use Roman numerals for numbered books ("II Timothy 2:26"). The matcher
  owns a mapping layer.
- **Image tokens follow the 28-pixel-patch rule**, `⌈w/28⌉ × ⌈h/28⌉`,
  capped at 4,784 tokens for the high-resolution tier that Claude Opus
  5.5, Sonnet 5.5 and Haiku 5.5 all belong to. A 4:3 photo is therefore
  downscaled to about 2212 × 1659 regardless of what we send; only 16:9
  keeps a 2576 long edge. The server resizes with the documented
  reference algorithm so positions map one to one.
- **On Opus 5.5 thinking is always on and is billed as output**, it is
  not bounded by effort, and the installed SDK (0.78) cannot separate it
  from text in `usage`. `max_tokens` is a ceiling on both together.
- **Blob card images are roughly 344 × 512 JPEGs**, not uniform.
- **Mobile first**, per CLAUDE.md. Design system:
  `prompt_context/design_system.md`; green is the single accent; amber
  is for warnings only.
- Latest migration on `origin/main` is `121_deck_folder_visibility.sql`;
  this feature's migration is 122 and is re-checked at merge.

## Recognition approach

### Stage A (v1): the model transcribes, the app matches

One Claude request per photo returns structured JSON. For each card it
can see, the model transcribes exactly as printed, with `null` for
anything it cannot read (schema types are `["string","null"]`; the
schema has `additionalProperties: false` and `required` on every object
and no length or numeric bounds, which the API rejects; length caps are
enforced in code):

- `title`
- `reference`: the scripture line
- `nickname`: the Lost Soul badge, if any
- `abilityStart`: the first six words of the special ability
- `type`: the icon-box type as printed (Hero, Evil Character,
  Enhancement, Lost Soul, Dominant, Site, Fortress, Artifact, Covenant,
  Curse, City, unknown)
- `brigade`: colour words of the frame
- `strength`, `toughness`: the two numbers top-left, if present
- `identifier`: the small badge text ("Generic", "Idol", "Greek")
- `printNumber`, `rarityCode`: the corner number and letters ("81",
  "UR+"; "LR65" is number "65" code "LR")
- `copyrightYear`
- `border`: white border, borderless full-bleed, dark framed, unknown
- `setMarking`: any set abbreviation or word; `setIconNote`: shape and
  colour of the set icon when seen but not read
- `grid`: row and column in reading order; `bbox` optional, normalised
- `orientation`: upright, rotated, upside-down
- `confidence`: high, medium, low

Plus `photoQuality`: ok, blurry, dark, glare, too_many_cards, no_cards.

The model never sees the card list and never picks a key. The matcher
(`lib/scan/match.ts`, pure, unit-tested, no API) does the rest, in this
order:

1. **Normalise.** Lowercase, straight quotes, punctuation stripped,
   whitespace collapsed; references with Arabic and Roman book numbers
   folded together; the transcribed type and brigade mapped to dataset
   vocabulary by `lib/scan/vocab.ts` ("Enhancement" becomes `GE` or `EE`
   by alignment; brigades compared as colour-token sets).
2. **Stem lookup.** A stem index built once from `CARDS` on the
   normalised stem, with two unions baked in: stems within edit
   distance 2 that share reference and type (spelling variants such as
   Wizard/Wizards, Elisabeth/Elizabeth, Judgements/Judgments; 47 stems),
   and identities under one stem whose normalised reference and full
   ability text are identical (the 43 class-spelling splits). Exact hit
   on the index first. Otherwise **fuzzy**: normalised optimal-string-
   alignment distance over the 3,452 stems, accepted only if the
   distance is at most 0.20 **and** either the stem is eight or more
   characters or the transcribed reference agrees with the candidate,
   **and** the difference is never a digit or Roman numeral (Herod
   Agrippa I/II, King Jeroboam I/II, Seraphim Isaiah 6:2/6:6), with a
   margin over the runner-up set in E1. Short names are where fuzzy
   matching is unsafe (Cage/Rage, Dove/Love, Winds/Wings, Job/Lot,
   Jude/Luke): 147 of the 170 stems of five characters or fewer have a
   neighbour within distance 2. No acceptable hit is **Not found**.
3. **Identity within the stem.** If one identity, done. Otherwise score
   each identity on fields in this priority: reference, then strength
   and toughness, then identifier, then brigade, then ability prefix.
   The ability text is last because it is the least reliably read.
   Reference plus ability, type and brigade separate 929 of the 959
   homonym stems; stats and identifier raise that to 947. A clear winner
   is taken; otherwise the row is **Check this** with
   `identity_ambiguous` and the identities as candidates.
4. **Lost Souls.** Title "Lost Soul" skips steps 2 and 3: the normalised
   reference selects identities; the nickname badge and ability prefix
   break ties. 32 references are shared by more than one identity; the
   badge resolves nearly all. No reference read is `reference_missing`;
   a reference matching several identities after the badge is
   `reference_ambiguous`; both are **Check this** with the picker scoped
   to Lost Souls. Known dataset typos (Lost Soul "Blind" is named Job
   29:15 but carries Job 33:27; "Lawless" AB has Hebrews 12:18 for
   12:8; "Retribution" Acts 16:22 for 18:22) are fixed in the data, not
   worked around.
5. **Printing selection** inside the identity (next section).
6. **Score fields** on every detection for calibration: `matchScore`,
   `runnerUpScore`, `agreeingFields` (how many transcribed fields agreed
   with the chosen candidate).

The **second look** is not part of the matcher. It is one extra request
per photo, made by the route when the photo has any **Check this** or
**Not found** rows (at most six per photo; beyond that, none), carrying
each such row's crop and its top five candidates (names and Blob
thumbnails), asking the model to pick one or none per row. It reuses the
photo's reservation and its tokens and cost are added to the same event,
so a photo costs at most two calls. Rows it resolves carry
`nameReason: 'second_look'`. Whether it ships is an E0 decision.

### Printing selection

Among the identity's printings (enumerated by identity key), applied as
**successive filters, then a collapse**:

1. **Hints.** A corner print number matching one printing's `imgFile`
   prefix within the identity chooses it (`print_number`): 2,521 of the
   3,190 Rotation-legal printings carry one, and AB reprints share the
   number with their original, so the border look or copyright year
   breaks that pair. A set marking or icon description matching one
   printing through the legend chooses it (`set_hint`). A border look
   that only some printings can have narrows the set (`border`). A
   copyright year is a weak tiebreak only.
2. **Special classes out.** Unless a hint supports one, remove promo,
   AB, Legacy Rare and UR+ printings when at least one standard printing
   remains. Definitions, from the data: promo is `set` starting `Pmo`,
   or `officialSet` starting `Promo`, or `rarity` in {Promo, National,
   Seasonal, Regional, State, Local, District, Winner, "National,
   Winner"}, which also captures the 40 Fundraiser cards and nine promos
   filed under `GoC`/`LoC` (205 printings); AB is `set` ending `(AB)`
   (exactly the 387 pairs in `abMap.json`); Legacy Rare is `rarity ===
   'Legacy Rare'` (72); UR+ is a `rarityCode` of `UR+` or an `imgFile`
   ending `-UR+` (12, each $15 to $20 above its UR twin). "Alternate
   border" is AB; there is no separate class, and there are no foils.
3. **Rotation in.** If any survivor is `legality === 'Rotation'`, keep
   only those.
4. **Collapse.** If the survivors all share one price (or are all
   unpriced) and one legality, the row is **Matched** with
   `printingReason: 'equivalent'` and a quiet "N printings" line; the
   default is a priced survivor if any, else the newest by the set-order
   table. If prices or legality differ, the row is **Check this** with
   `printing_ambiguous`, the candidates listed with prices, and the
   newest standard printing as the provisional choice. A single survivor
   is `only`.

Measured on the data and the live price map: without filters 319 of the
795 multi-printing identities would be amber; with the class filter 93;
with Rotation as a filter too, **64 identities, 153 printings, 2.7% of
all printings**. Identity and reference ambiguity add a few percent on
top; E0 measures the real amber rate on photos.

Reasons are two fields. `nameReason` ∈ {exact, fuzzy, reference,
second_look, none}; `printingReason` ∈ {only, print_number, set_hint,
border, equivalent, printing_ambiguous, identity_ambiguous,
reference_missing, reference_ambiguous}. Chips key on status and
`printingReason`; line two shows "Read as 'X'" when `nameReason` is
`fuzzy`.

### Stage A2 (v1.1, planned, with a trigger): art-similarity tiebreaker

A server-side descriptor index of all printings' Blob images (the
community tool uses a 420-byte colour-layout vector per image; ours can
be that or a small embedding), compared against the card's crop to break
ties inside an identity when prices differ and no hint was read. Built
when E3's audit shows printing corrections are the dominant correction
over a trailing fortnight with at least thirty corrections. Not in v1
because it depends on crop quality, which E0 measures first.

### Why not the alternatives first

- **On-device OCR.** The community tool needs 11 border masks, Hough
  fallbacks, 4 to 7 binarisations, a lexicon repair step and a
  picture-match override to make Tesseract work, and still ships no
  accuracy number. Its "Read name with Claude" button is wired to the
  Claude Artifacts runtime and is hidden on the public site.
- **Fingerprint index alone.** Cannot tell an AB reprint from its
  original (387 pairs share art), is fragile under glare and
  perspective, and is a week or two before anything works. Right as a
  tiebreaker (Stage A2), wrong as the first pass.
- **Barcodes.** Redemption cards have none.

### Model, effort, resolution are evaluation outcomes

Baseline Claude Opus 5.5. E0 screens model and effort, then resolution
and position format on spreads. The shipped choices live in one constant
each. Pre-E0 cost estimates, replaced by measured `usage` in E0
(instruction and schema about 900 tokens; output is JSON plus thinking):

| Photo | Image tokens | Input total | Est. output | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 |
|---|---|---|---|---|---|---|
| Single, low-res arm (4:3 at 1269 × 952) | ~1,550 | ~2,450 | ~800 | ~$0.026 | ~$0.013 | ~$0.0007 |
| Spread, low-res arm | ~1,550 | ~2,450 | ~2,000 | ~$0.05 | ~$0.025 | ~$0.0013 |
| Spread, high-res arm (4:3 at 2212 × 1659) | ~4,740 | ~5,640 | ~2,000 | ~$0.063 | ~$0.031 | ~$0.0016 |
| Second look (crops + 5 thumbnails per row) | ~1,800 | ~2,000 | ~500 | ~$0.02 | ~$0.01 | ~$0.0005 |

On a 4:3 high-res spread each of 12 cards is about 390 px wide; at the
low-res arm about 240 px, where corner numbers and icons will mostly come
back null. E0 decides whether the extra tokens buy printing accuracy.

## The flow

### Entry points

- `/collection` gets **Scan cards**. Below the `sm` breakpoint the
  toolbar shows Scan cards (primary) and Build a deck (outline) and folds
  Set completion, Import and Export into the gear menu; the header
  already wraps onto two rows at 390 px and cannot take a sixth button.
  On desktop Scan sits beside Import CSV at the existing weights. The
  first-run banner's call to action becomes Scan cards with Import CSV as
  a text link. Signed out, the page shows the existing gate with the
  scanner's copy and `redirectTo=/collection/scan`.
- `/collection/scan` is a route, not a modal, because a camera round-trip
  can evict the tab and a route restores cleanly.

Price display follows `useShowPrices`. There is no mode switch: the same
photo always resolves the same way, and the success state offers the
other outcomes.

### Capture

- **Take photo**: a hidden `<input type="file" accept="image/*"
  capture="environment">`. **Choose from photos**: the same without
  `capture`, with `multiple`. `accept` stays exactly `image/*` (listing
  HEIC changes what iOS hands over). iOS ignores `multiple` with
  `capture` and resets `input.files` to one each time, so the page
  accumulates `File` objects in state. If Safari evicts the tab while
  the camera is open that photo is lost; the batch tip says to use the
  Camera app first for stacks.
- Client decode goes through an `<img>` element, not
  `createImageBitmap(file)`: WebKit drops EXIF orientation on the latter
  and a canvas re-encode would then ship sideways iPhone portraits with
  no tag left for the server to honour. Draw to a canvas at a long edge
  of at most 2576, JPEG 0.85, hard stop 3 MB; never decode a 48 MP file
  at full size. A decode failure (Samsung and Pixel HEIF; some HEIC) is
  not uploaded and gets the HEIF copy.
- Posted as `multipart/form-data` to `POST /api/scan`. The original never
  leaves the phone. Two uploads in flight at once; the rest queue.
  `navigator.onLine` is checked before upload and the offline copy shown.
- Desktop: the whole page is a drop target (the deck builder's
  `useExternalDropTarget` pattern), multi-select works, and a progress
  line reads "12 of 40 photos read".

### Processing

Each photo is a hairline row group headed by a small thumbnail (or
"Photo 3" after a reload, when thumbnails are gone) and a state with
`role="status"`: *Reading…*, *9 cards*, or one of the failure strings in
the copy table, each with **Retry** (the file is still in memory) and
**Remove**, plus **Choose another** on the HEIF failure. Several photos
process while the player keeps taking more.

### Review list (the tray)

One row per detection under its photo, in grid order. Identical keys
within the tray merge into one row with a summed quantity, as the CSV
merge import does. The set is always shown.

Row at 390 px (content width 358): `[thumb 44] [12] [text 238] [8] [qty
56]`. Line one: name (truncated) left, price right in `text-sm
tabular-nums`, or "No YTG listing" linking to the YTG search page. Line
two, 12 px: `Kings · own 2`, or `Check this · Which printing? Prices
differ` (truncate the reason, never the chip), or `3 printings`. The
quantity is a tappable "×1" that opens a stepper. **Remove** is a
visible 44 px control at the row end (swipe is a shortcut, not the only
way). The whole thumbnail-plus-name is one 44 px target that opens the
picker, labelled "Change printing: Son of God, Kings". The current
owned quantity comes from `useCollectionState`, which the deck builder
already mounts the same way.

Chips:

- **Matched**: no chip for `only`, `print_number`, `set_hint`, `border`;
  "3 printings" as muted text for `equivalent`.
- **Check this**: amber; reason on line two; `aria-describedby` points
  the row at it. The row holds the provisional choice; the amber is the
  ask. Only these rows show the photo crop (44 to 56 px, `object-cover`,
  `ring-1 ring-border/60`, never larger than the card thumb), and only
  if E0 proved crops.
- **Not found**: amber, with the read title as text and **Find card**,
  which opens the picker with the search prefilled. Not counted until
  resolved.

The **printing picker** is the Radix dialog (`components/ui/dialog.tsx`:
focus trap, Escape, focus return) styled as a bottom sheet on phones,
header "Which printing?" or "Which card?", listing the identity's
printings with image, set, legality, YTG price and "2 in your
collection", the current one marked, and a search field backed by
`searchCardNames` (its hits carry no identity key; the builder resolves
through `findCard` then `cardIdentityKey`). A change marks the row
corrected.

Above `md` the tray renders as a table: thumb 56 · name and set · status
· owned · price · qty · remove; rows focusable, Enter opens the picker,
plus and minus change quantity, Delete removes.

The tray persists in `sessionStorage` keyed by user id: detections,
chosen keys, quantities, corrections, and the previous owned quantities
needed for undo. Not thumbnails and not crops.

### Commit

A sticky footer (`pb-[env(safe-area-inset-bottom)]`, `aria-live=
"polite"` on the total) with two lines: `$84.20 at YTG · 2 unpriced`
(the same "to buy at YTG, not a resale value" framing and tooltip the
collection page uses) and **Add 12 to collection**. If unresolved rows
exist: "3 cards aren't matched and won't be added."

Commit calls the existing merge import (`importRows(rows, "merge")`,
which wraps `bulkImportCollectionAction` and reloads the collection), then
`recordScanOutcomesAction(outcomesByScanId)`, since one tray spans many
scan events. The success state keeps the committed rows on screen with
their new owned totals, each still tappable to change printing (which
decrements the old key and increments the new one), and offers:

- **Undo**: subtracts this commit's per-key deltas; disabled after a
  post-commit printing change or the next commit; toast "Removed 12
  cards"; also reverts a Haves write made from this success state.
- **Add to Haves**: for each committed key, reads the existing Have via
  the trade list hook and puts `existing + scanned` (`putItems`
  overwrites, it does not add), with `kind: 'have'`, `anyVersion:
  false`, `priority: false`, `note: ''`. Haves never exceed owned
  because this only exists after commit.
- **Copy priced list**: quantity, name, set, price, total, as text.
- **Scan more**: clears the tray and stays.
- **View collection**: `/collection` with the format filter showing all
  cards (the default Limited filter would hide every non-Rotation card
  just added) and an `added` param listing the scan ids; the page sorts
  those keys first under a quiet "Just added" header.

`/collection`'s own card modal gains **Change printing** using the same
picker, and a Close button while it is being touched.

### What is recorded

On commit each detection's outcome goes on its scan event: final key,
printing changed, name changed, removed (with `removedAs: 'wrong' |
'unwanted'`, asked at remove time as a two-option control), left
unresolved, plus the detection's reasons and scores. Scans with no
outcomes after 24 hours are abandonment.

## Data

### `POST /api/scan`

Request: `multipart/form-data` with `photo` (≤ 3 MB). Session required
and checked before the body is read. Server-side with `sharp` (already
used in several route handlers; pattern in
`app/forge/lib/imageNormalize.ts`): `rotate()` for any EXIF that
survived, resize with the documented reference algorithm to the chosen
tier (high-res 4,784 tokens or low-res about 1,550), JPEG quality 82,
metadata stripped by default. This bounds pixels and cost on the server,
removes GPS before anything reaches Anthropic or Blob, and sniffs the
real format; undecodable is 415.

Response 200:

```
{
  scanId, photoQuality,
  detections: [{
    id, grid: { row, col }, bbox | null, orientation,
    read: { title, reference, nickname, abilityStart, type, brigade, strength, toughness,
            identifier, printNumber, rarityCode, copyrightYear, border, setMarking, setIconNote, confidence },
    status: 'matched' | 'check' | 'not_found',
    nameReason, printingReason, chosenKey | null,
    scores: { matchScore, runnerUpScore, agreeingFields },
    candidates: [{ key, name, set, officialSet, imgFile, legality, price | null, owned }]
  }],
  usage: { model, latencyMs, calls }
}
```

Errors, all JSON from the route: 401; 413 (and the client also handles
Vercel's own `text/plain` 413 by header); 415; 429 user cap with
`resetsAt` and which cap; 503 with `Retry-After` and a distinct `code`
for the global cap, an Anthropic rate limit, an Anthropic overload, and
an exhausted credit (`billing_error`); 502 recogniser failure (refusal,
invalid JSON, truncated output after retry).

Prices: the route loads the full `card_prices` table once per request
through the same paginated loader `/api/prices` uses (PostgREST caps an
unbounded select at 1,000 rows), attaches `price` to candidates because
the printing rules need it, and the client builds product links with
`getProductUrl` from its own price map.

### Reserve first, then call

`scan_reserve()` is a SECURITY DEFINER RPC in the pattern of
`forge_add_art_candidate` (migration 082: `perform
pg_advisory_xact_lock(hashtext(auth.uid()::text))`, `auth.uid()` under
an empty search path), with the grant footer migration 120 uses (`revoke
all … from public, anon; grant execute … to authenticated`). Under the
lock it counts the caller's rows in the trailing 10 minutes, 24 hours
and 30 days and everyone's rows in the trailing 24 hours and 30 days,
counting `pending`, `done` and `failed` and excluding `rejected`. It
then either inserts a `pending` row and returns its id, or inserts a
`rejected` row naming the cap and returns the cap and `resets_at`. Only
then does the route call the model, and it finishes the row (`done` or
`failed`, with model, tokens, latency, calls, cost) through the admin
client. The model latency is never a race window, and cap hits are
observable.

Caps, constants in the RPC, all rolling windows:

| Scope | Limit |
|---|---|
| Per user, 10 minutes | 20 photos |
| Per user, 24 hours | 150 |
| Per user, 30 days | 1,500 |
| Everyone, 24 hours | 250 |
| Everyone, 30 days | 1,500 |

A photo is at most two model calls. At the Opus high-res estimate with a
second look on every photo the global monthly cap is about $125 in the
worst case and about $90 at a realistic second-look rate; on Sonnet it is
half. E0's measured costs set the final constants so the worst case sits
under the credit, and the global cap is what makes the kill criterion
enforceable.

### Migration `122_scan_events.sql`

```
scan_events (
  id uuid pk default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null check (status in ('pending','done','failed','rejected')),
  rejected_cap text,                   -- which cap, on rejected rows
  model text, calls smallint, latency_ms integer,
  input_tokens integer, output_tokens integer,
  cost_usd numeric(8,5),               -- from a per-model price constant
  photo_quality text,
  detections jsonb,                    -- always stored; read fields capped in code (title 60, reference 40, nickname 30, ability 80, identifier 40, marking 20, icon note 60)
  outcomes jsonb,                      -- set on commit
  image_pathname text,                 -- private Blob pathname when opted in
  image_expires_at timestamptz
)
```

RLS: `SELECT` own rows; superuser sees all through the existing
`is_superuser()` function (migration 062; it is a fixed-uid check, not a
table). **No INSERT or UPDATE grant to `authenticated`**: writes go
through `scan_reserve()` or the admin client, so nobody can forge
events, token counts or detections. `recordScanOutcomesAction` filters by
the caller's `user_id`, validates the JSON shape, and caps its size.
Indexes on `(user_id, created_at desc)` and `(created_at)`. A boolean
`keep_scan_photos` on `profiles`.

### Photo retention (opt-in)

A toggle on the scan page, off by default: "Keep my scan photos for 30
days to help improve the scanner." When on, the re-encoded photo is
written to the **Forge private Blob store** under `scans/<user>/
<scanId>.jpg` (the only private store today; Forge never lists the
store, so a `scans/` prefix is safe; the builder spreads the same
`storeId`/token options `app/forge/lib/art.ts` uses, and never sets a
global `BLOB_STORE_ID`, which would hijack the public-store calls).
Private blobs are not browser-loadable, so the admin page reads them
through `/admin/scans/image/[id]`, which checks `is_superuser()` and
streams `get(pathname, { access: 'private', ...storeOpts })` as
`app/forge/api/art/[cardId]/route.ts` does.

A **daily** cron lists the `scans/` prefix with a cursor and deletes
blobs older than 30 days by `uploadedAt`, then nulls the columns; it also
nulls `detections` on events older than 30 days that had no matched
card, since those can hold whatever text was in a non-card photo.
Turning the toggle off calls "Delete my scan photos now", which deletes
immediately. Same `CRON_SECRET` bearer pattern and failure alert as its
siblings.

Copy beside the toggle and on the gate: "Photos are sent to Anthropic to
read the cards. Anthropic deletes them within 30 days unless its safety
systems flag them (then up to two years) and does not train on them. We
keep nothing unless this is on." A short `/privacy` page is added with
the same facts; the site has none today.

### Admin view

`/admin/scans`: a table, superuser-only in v1 through
`supabase.rpc('is_superuser')` as `app/admin/permissions/lib/auth.ts`
does, linked from the admin dropdown in both the desktop and mobile nav
like its siblings. Per day: scans, failures, rejections by cap, cost,
p50 and p95 latency, abandonment, correction rate split by status and by
reason code, printing-change rate split by status, uncorrected rate by
confidence bucket, and the most-corrected read titles. The kill-criteria
queries below are shown as numbers with their windows. A daily digest
through `sendEmail` (the cron alert helper only sends failure mails)
fires when the day's or month-to-date cost crosses a threshold.

## The Claude call

`lib/scan/recognize.ts`, server only. Client
`new Anthropic({ apiKey: SCANNER_ANTHROPIC_API_KEY, maxRetries: 0,
timeout: 25_000 })`; one manual retry on 5xx, 529 or timeout, never on a
refusal; `export const maxDuration = 90` on the route (two attempts plus
sharp, the reservation and a possible second look).

- `messages.create` with the image as a base64 block after a fixed
  instruction block. Model from a constant, baseline `claude-opus-5-5`,
  `output_config.effort` from a constant (E0 picks `low` or `medium`),
  adaptive thinking left at its default, no `temperature` (rejected on
  these models), no `cache_control` in v1 (the prompt is near Opus 5.5's
  512-token caching minimum and the traffic is too sparse for the
  five-minute window; E0 confirms with `cache_read_input_tokens`).
- Structured output through `output_config.format` with the JSON schema
  in `lib/scan/schema.ts`; no tools.
- The instruction describes where each field sits on a Redemption card,
  says cards may be sleeved, in binder pages, rotated or upside down,
  says to transcribe exactly and return null rather than guess, asks
  for grid positions in reading order, and asks the model to assert
  nothing about which card it is. A set-icon legend image is an E0 arm,
  not a default.
- `max_tokens` 16,000. A `max_tokens` stop retries once at 32,000 and
  then is a 502; it is **not** read as "too many cards", because
  thinking length is not a card count. `response.model` is asserted
  against the constant on every call.
- Usage, latency, calls and `cost_usd` go on the event. Anthropic 429s
  are distinguished from our caps and surfaced as "Busy, retrying" with
  `Retry-After`. The scanner workspace's rate-limit tier is checked in
  the Console before E0 (a fresh workspace may sit at a low tier).

## Evaluation: continuous, with a screen, an audit and a scoresheet

The recogniser is a probabilistic component inside a deterministic app.
E0 is a **screen**: it tells us whether the approach is hopeless and
which arm to ship. It cannot certify "90%" on seventy photos, and the
document says so. The 90% claim is certified after launch by an audit
sample of real photos. Everything is measured with the same tooling: a
folder of photos, a labels file, a scorer, a table with intervals.

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
min(labelled, predicted)` per identity, `fn` excludes partial cards,
`fp` counts extras. Each matched pair is classed `matched_correct`,
`matched_wrong` (the silent harm), `check_top1`, `check_in_candidates`,
`check_miss`, `not_found_miss` or `hallucination`; wrong-identity
predictions pair with leftover labels by grid cell when both have one.
Printing level, only on correct-identity pairs: if `setVisible`, correct
means `chosenKey === printing`; otherwise the choice is *defensible* when
it is within the identity and the status obeys the collapse rule, and
`silent_wrong_price` is flagged when a Matched row's price differs from
the true printing's price. Other-game photos: any `matched` or `check`
row is a hard fail; `not_found` rows are the desired path (the model
*should* transcribe "Lightning Bolt" and the matcher should reject it).
Grid usefulness is scored as cell match; bbox, if tried, by hand on five
spreads.

Harness rules: 429, 529, timeouts and unparseable responses go to
`errors.jsonl` and are never scored as misses; `max_tokens` stops are
`truncated` and excluded from accuracy; latency is the final successful
attempt; tokens from `usage`, cost from the row's model; every output
file stores `model`, prompt hash and `response.model`; the scorer is
smoke-tested on labels-as-predictions (must score 100%) and on empty
predictions (must score zero recall).

### The photo set (and the answer to "do you need loads of pictures")

No. About seventy-five photos from Tim's own phone, plus, if five Discord
players will each send five shoebox photos before E0, a `wild` bucket
from other phones and rooms:

| Bucket | Count | What's in it |
|---|---|---|
| Single, easy | 25 | one card, flat, room light; mix of eras and types including Lost Souls, Sites, Dominants, a card with an unsuffixed twin, a UR+ |
| Single, hard | 15 | sleeved, glossy glare, angled 20°+, old-frame, promo, AB, upside down; each photo tagged so the breakdown exists when the set grows |
| Spread 4–8 | 8 | flat with gaps |
| Spread 9–12 | 6 | |
| Binder page | 5 | nine cards touching, in sleeves |
| Spread 15–20 | 4 | the community tool claims about 30 works; we want the curve |
| Spread 25–30 | 3 | expected to fail; we want to see how |
| Not a card | 10 | hands, tables, a booster wrapper, and at least four cards from other games |

Photos live in `scripts/scan-eval/photos/`, git-ignored, with a copy in
the private store so a worktree can fetch them. This is a **development
set**: thresholds tuned on it are fits, not measurements. The first two
hundred audited real cards after launch are the first test set.

### E0: staged screen, before any product code

About a day, most of it labelling. Metrics split in two: **model-only**
(normalised title equals the label stem; reference equals; print number
or set marking non-null on `setVisible` cards; per-field agreement),
which choose model, effort, resolution and position; and **matcher**
metrics, which belong to E1 and are reported here only as information.
Stages, each paired on the same photos:

0. Smoke: five photos through every arm; assert model, stop reason,
   schema parse; run the scorer's self-tests.
1. Model screen: Opus 5.5, Sonnet 5.5, Haiku 5.5 at default effort on
   the 40 singles and the 14 spreads of twelve or fewer. Drop a model
   that is four or more photos behind the leader on paired singles.
2. Effort: the leader at the other effort, same 54 photos.
3. Resolution: the leader, high-res versus low-res, grid only, all
   spreads including binder pages. Decision: printing-hint lift versus
   cost.
4. Position: bbox at the chosen resolution on the spreads, only if crops
   are wanted; "none" as a control for whether asking for position
   hurts transcription.
5. Legend image on the 40 singles, only if print number and set marking
   are null on more than half of `setVisible` cards.
6. Second look on the leader's Check this and Not found rows (needs at
   least twenty rows to mean anything).
7. Two more repetitions of the final arm on all photos: the noise floor
   every later comparison is judged against.

About 410 requests and a few dollars.

Pre-registered pass rules (unit, n, pass count), with what each buys
printed by the script beside the result:

| Screen | Unit, n | Pass iff | Chance a bad system passes |
|---|---|---|---|
| Singles pooled, identity top-1 | photo, 40 | ≥ 34 | a 75% system passes 10% of the time; a 92% system 96% |
| Spreads ≤ 12 plus binder, false cards | card, ~150 | ≤ 4 in total, and 0 `matched`/`check` rows on other-game photos | |
| Spreads ≤ 12 plus binder, recall | card, ~150 | ≥ 85% with a cluster bootstrap over photos for the interval | |
| Silent wrong identity | matched rows, all photos | ≤ 2 | this is the anti-goal and the number that matters most |
| Non-card | photo, 10 | `no_cards` on ≥ 5 of the 6 true non-card photos; 0 `matched`/`check` on all 10 | |
| Crops | cell, spreads | ≥ 90% of crops contain the right title, or crops do not ship | |

If the singles screen fails: the capture flow changes before building
(one card per photo, or a title-band instruction) and the second look
becomes mandatory. If only printing hints fail: ship with the collapse
rule and schedule Stage A2. Numbers and decisions go in the review log.

### E1: during the build

- `lib/scan/match.ts` has golden tests from recorded E0 outputs per
  model; outputs are re-recorded when the model id, prompt or schema
  changes and quarterly as a drift check.
- A prompt change is accepted by a paired run on the same photos, two
  repetitions each: no screen regresses beyond the stage-7 noise floor,
  silent-wrong does not rise, cost per photo within +10%, and a sign
  test on discordant cards favours the change.
- Any PR touching the prompt, schema or matcher re-runs the scorer on
  saved outputs (free) and, when the prompt changed, live (cents).

### E2: before launch

- E0's photos through the deployed `/api/scan` on a preview URL twice:
  once as originals and once as the blobs the client's own downscale
  produces (a Playwright run dumps them), so double-JPEG and the `<img>`
  decode path are measured; plus five concurrent uploads.
- Manual pass per the `verify` skill on phone-sized viewports and one
  real iPhone and one real Android: camera capture including a portrait
  iPhone photo through the client path, multi-select, a 48 MP photo, an
  HEIF photo, a 10-card spread, a binder page, a correction through the
  picker, a refresh mid-tray, whether the tray survives a camera-induced
  tab eviction, commit, undo, change printing after commit, Add to
  Haves, Copy priced list, each cap's copy, the signed-out gate.

### E3: after launch, continuously

Definitions, each one query over `scan_events` shown on `/admin/scans`:

- correction rate = (name changed ∨ printing changed ∨ removed as
  wrong) ÷ committed detections with outcomes, split by status
  (`check` rows are prompted; `matched` rows are not, and mixing them
  hides the silent error).
- not-found rate = not_found ÷ detections; photos with zero detections
  reported separately.
- uncorrected rate by confidence bucket and by reason code (not
  "accuracy": players fix what they notice).
- abandonment = done scans with no outcomes after 24 hours ÷ done scans.
- rejections by cap per day; failures ÷ all; p50 and p95 latency; cost
  per day over `done` and `failed`.

**Audit**, weekly for the first two months then monthly: `export.ts`
pulls thirty random opted-in photos, stratified to over-sample untouched
Matched rows; Tim labels them in the E0 format; the scorer reports true
accuracy, silent-wrong rate, and the share of cards whose set is visible
in the wild, which is the number the whole printing story rests on.
About eighty cards a week gives ±8 points a month.

**Calibration**: a confidence bucket earns its chip only if accuracy
differs by at least 15 points between high and low with low covering at
least a tenth of rows; otherwise the chip is dropped and "Check this" is
driven by matcher margins and `agreeingFields`. A reason code is useful
only if `fuzzy` scores below `exact`.

A model, effort, resolution or prompt change ships only by the E1
acceptance rule on the full eval set, with the table pasted into the PR.

### Kill and pivot criteria

- Spend is bounded by the global cap; an exhausted credit shows as
  "resting until next month", not a bill. Revoking the scanner key in
  the Console stops everything in seconds without a deploy.
- Correction rate on at least 100 committed detections in days 7 to 14
  above 30%: the Scan button gets a "Beta" label (a server-read env
  boolean; the page stays up) and Stage A2 is pulled forward.
- Printing share of corrections above half over a trailing 14 days with
  at least 30 corrections: Stage A2 starts.
- Failure rate above 10% over three days, or p95 latency above 20 s:
  investigate before anything else ships.

### Scoresheet (dated, resolvable claims)

Each claim is scored at its resolution date in the review log; the
estimate is mine, before E0.

| # | Claim | Resolves | Source | Estimate |
|---|---|---|---|---|
| 1 | Best arm passes the pooled singles screen (≥ 34 of 40) | E0 | run.ts | 70% |
| 2 | Best arm passes the spread false-card and recall screens | E0 | run.ts | 55% |
| 3 | Silent wrong identity ≤ 2 across all E0 photos on the best arm | E0 | run.ts | 60% |
| 4 | High-res beats low-res on print-number or set-marking non-null by ≥ 10 points | E0 | run.ts | 65% |
| 5 | Haiku 5.5 is within 4 photos of the leader on singles | E0 | run.ts | 40% |
| 6 | Sonnet 5.5 passes every screen Opus 5.5 passes | E0 | run.ts | 60% |
| 7 | Grid-cell crops contain the right title ≥ 90% of the time | E0 | run.ts | 65% |
| 8 | The second look lifts check_top1 by ≥ 15 points on ≥ 20 rows | E0 | run.ts | 50% |
| 9 | Audit accuracy on untouched Matched rows ≥ 90% | launch + 30 d | audit export | 60% |
| 10 | Abandonment ≤ 25% | launch + 30 d | scan_events | 55% |
| 11 | At least 10 distinct players commit a scan | launch + 30 d | scan_events | 65% |
| 12 | Printing share of corrections > 0.5 at n ≥ 30 (Stage A2 trigger) | launch + 60 d | scan_events | 50% |
| 13 | Any `rejected` row from the 24-hour user cap | launch + 90 d | scan_events | 15% |
| 14 | Scanner workspace spend under the credit for three months | monthly | Console | 95% |
| 15 | v1 ships within six agent-days of approval, given the photos | merge | git | 50% |

Expected rates, from the data rather than guesses: Check this from
printing ambiguity on about 3% of printings after the filters; identity
and Lost Soul ambiguity add low single digits; E0 measures the total.

## Copy

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
| Done | 9 cards |
| Progress (desktop) | 12 of 40 photos read |
| Too dark | Too dark. Retake in better light. |
| Blurry | Blurry. Hold still and retake. |
| Glare | Glare hides the text. Tilt away from the light. |
| No cards | No cards found in this photo. |
| Too many | Too many cards for one photo. Try 12 or fewer. |
| HEIF | This photo's format can't be opened here. Turn off HEIF or "high efficiency" in your camera, or share it as a JPEG. |
| Too large | Photo is too large to upload. |
| Ten-minute cap | You've hit 20 photos in 10 minutes. Scanning opens again at 3:15 pm. |
| Daily cap | Daily limit reached (150 photos). Scanning opens again tomorrow at 9:02 am. |
| Monthly cap | Monthly limit reached. Scanning opens again on 12 November. |
| Global cap | The scanner has reached today's limit for everyone. Back tomorrow. |
| Credit out | The scanner's monthly budget is used up. Back on 1 November. |
| Busy | Busy. Retrying… |
| Generic | Couldn't read this photo. |
| Offline | You're offline. Photos will wait here until you reconnect. |
| Failed-photo actions | Retry · Remove · Choose another |
| Chip check | Check this |
| Chip not found | Not found |
| Reasons | Which printing? Prices differ · Two different cards have this name · Couldn't read the scripture reference · Several Lost Souls share this verse · Read as "Saul" |
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
| Post-commit actions | Undo · Add to Haves · Copy priced list · Scan more · View collection |
| Undo done | Removed 12 cards. |
| Haves done | Added 12 to Haves. |
| Copied | Copied |
| Just added header | Just added |
| Retention toggle | Keep my scan photos for 30 days to help improve the scanner |
| Retention note | Photos are sent to Anthropic to read the cards. Anthropic deletes them within 30 days unless its safety systems flag them (then up to two years) and does not train on them. We keep nothing unless this is on. |
| Delete photos | Delete my scan photos now |
| Gate | Sign in to scan cards, add them to your collection and see YTG prices. |
| Beta label | Beta |

Accessibility: chips carry text and `aria-describedby`; `role="status"`
on photo groups; `aria-live="polite"` on the footer total; thumbnail
button "Change printing: {name}, {set}"; crop `alt="Your photo of this
card"`; quantity "Quantity 1, change" with "One more {name}" / "One
fewer {name}" on the stepper as the trade list does; focus order capture
→ groups → footer; new animations added to the `prefers-reduced-motion`
list; `CardImage` gets a plain fallback instead of its emoji.

## Files

- `app/collection/scan/page.tsx`, `client.tsx`, `components/`
  (`CaptureButtons`, `PhotoGroup`, `DetectionRow`, `PrintingPicker`,
  `CommitBar`, `SuccessPanel`, `RetentionToggle`),
  `hooks/useScanTray.ts`.
- `app/collection/client.tsx`: toolbar weights below `sm`, first-run
  banner, `added` param and "Just added" group, Change printing and
  Close in the card modal.
- `app/collection/actions.ts`: `recordScanOutcomesAction`,
  `setKeepScanPhotosAction`, `deleteMyScanPhotosAction`.
- `app/api/scan/route.ts`: session, `scan_reserve()`, sharp, recogniser,
  matcher, second look, prices, finish event; `maxDuration = 90`.
- `lib/scan/recognize.ts`, `secondLook.ts`, `match.ts`, `stemIndex.ts`,
  `vocab.ts`, `schema.ts`, `prices.ts` (shared paginated loader with
  `/api/prices`), `__tests__/`.
- `lib/cards/setOrder.ts`: the legend keyed on `officialSet` (49
  values; the six `[Ban]` codes map after stripping), per-set border
  look, set order, abbreviations (the `set_aliases` seed and
  `TAG_SET_TO_ABBREV` in `lib/pricing/matching.ts` are inputs), with a
  coverage test against `CARDS`.
- `scripts/scan-eval/run.ts`, `score.ts`, `export.ts`, `labels.json`,
  `photos/` (git-ignored), `outputs/` (recorded model JSON, committed).
- `supabase/migrations/122_scan_events.sql`: table, RLS, `scan_reserve()`,
  the `profiles` column, the three Lost Soul reference fixes if they
  live in the overlay rather than upstream.
- `app/admin/scans/page.tsx`, `app/admin/scans/image/[id]/route.ts`, nav
  links in `components/top-nav.tsx` (desktop and mobile).
- `app/api/cron/purge-scans/route.ts` plus a daily `vercel.json` entry.
- `app/privacy/page.tsx`.

## Testing

- `lib/scan/match.ts`, `stemIndex.ts`, `vocab.ts`: normalisation
  (case, curly quotes, double spaces, slash names, Roman numerals), the
  two index unions, exact and fuzzy rules including the short-name and
  numeral guards and the nine distance-1 pairs, identity scoring on
  Abel, Captain of the Host, The Depraved, King Saul, Pharaoh, Lost Soul
  reference matching with badges and the shared-verse cases, every
  printing filter and the collapse with price fixtures, the special-
  class definitions against the counts above (205 / 387 / 72 / 12), type
  and brigade mapping, reason fields, and the golden set. Vitest, node
  only.
- `lib/cards/setOrder.ts`: every set code in `CARDS` has an order, an
  official set and a border look.
- `app/api/scan/route.ts`: error mapping and size and format checks
  with the recogniser stubbed; `tsc` clean against the baseline.
- The RPC: a scripted check that two concurrent reserves at a cap yield
  exactly one `pending` and one `rejected` row.
- The scorer's self-tests; the eval script as the recogniser's
  integration test (E0, E1, E2).
- Manual E2 as above.

## Rollout

1. Tim: create the `scanner` workspace and key in the Max org and add
   `SCANNER_ANTHROPIC_API_KEY` to Vercel; confirm reuse of the Forge
   private store; take the photos (and ask Discord for the wild
   bucket); add the WAF rate rule; check the workspace's rate tier.
2. E0; record numbers and decisions in the review log; pick model,
   effort, resolution, position format; decide crops and the second
   look.
3. Build. Apply migration 122 before merging the route.
4. E2 on the preview URL; merge; one What's New line; `/privacy` live.
5. E3 weekly audit for two months.

## Calls I made (for review)

1. Server-side vision; the model transcribes many fields, the app
   matches on stem, identity and printing. The model never picks a key.
2. Print number, stats, identifier, nickname, reference and ability are
   transcribed so a plausible-but-wrong title is caught and a printing
   can be pinned from the card itself.
3. One flow, no modes; price always visible; Add to collection primary;
   Haves, priced list and undo live in the success state.
4. Printing rules are filters (hints, special classes out, Rotation in)
   then a collapse; amber only when price or legality differ among
   survivors.
5. Fuzzy matching is guarded by length, reference agreement and a
   numeral rule rather than a bare threshold.
6. The second look is one capped call per photo under the same
   reservation, kept only if E0 shows lift.
7. Sign-in required; reserve-first caps with rejected rows recorded;
   per-user and global rolling windows; a dedicated scanner key.
8. Server-side sharp re-encode to the model's own tier.
9. Client decodes through an image element because WebKit drops EXIF on
   `createImageBitmap(file)`.
10. Commit through the existing merge import; undo by delta; Haves by
    add-to-existing.
11. Tray in `sessionStorage` without images.
12. Photos not kept unless opted in; Forge's private store under a
    prefix; daily purge; unmatched detections purged at 30 days; a
    `/privacy` page.
13. Stage A2 planned with a windowed data trigger.
14. E0 is a pre-registered screen; the 90% claim is certified by the
    post-launch audit; claims are dated and scored.
15. Admin view superuser-only in v1, plain table.

## Left to the builder

- Fuzzy margin, identity scoring weights, `max_tokens`, effort,
  resolution: from E0 and E1.
- Legend contents and the set order (hand-written; the repo has no
  release years).
- Component split inside the client as long as the listed pieces exist.
- Whether `added` on `/collection` sorts or filters.
- Exact copy beyond the table, within the design system's tone.

## Open questions for Tim

1. Create the scanner workspace and key (I cannot create secrets).
   Confirm reusing the Forge private store under `scans/`.
2. The photos per the table, and whether to ask Discord for the wild
   bucket.
3. `/privacy` page: the proposed facts, or your own wording.

## Adversarial review log

### Round 1 (2026-10-26, five reviewers → rev 2)

Reviewers: a study of the community tool's source; a recognition and
evaluation adversary with measurements over `cardData.json`; a product
and slot-in adversary; a security, cost and operations adversary; a
builder check.

Changed: matching moved from `name` to stems and identities (names embed
the printing; `CARD_BY_NAME_LOWER` is private and last-wins); Lost Souls
by reference; the model transcribes corroborating fields; a real fuzzy
matcher instead of `searchCardNames`; a measured second look; modes
removed; owned quantity, no checkboxes, merged duplicates, undo,
post-commit printing change, Change printing in the collection modal;
commit through the merge import; tray without images; iOS capture
realities; spreads at higher resolution with grid positions; reserve-
first caps with a global ceiling; no INSERT/UPDATE for `authenticated`;
superuser pattern instead of the retired `registration_admin`; dedicated
scanner key; server-side sharp; private store, admin image proxy, daily
purge; migration 122; eval set grown with non-card photos, multiset
scoring, precision gate, intervals; cost table with output tokens; the
prior-art paragraph corrected (the community tool's Claude button is
wired to the Artifacts runtime and hidden on the public site).

Rejected or deferred: the art tiebreaker in v1 (depends on unmeasured
crop quality); a legend image in every prompt (E0 arm only); the
reviewer's higher global caps (exceed the credit); 20 to 30 card spreads
as a target (kept as a measured bucket).

### Round 2 (2026-10-27, five reviewers → rev 3)

Reviewers: a consistency auditor; a data scientist who prototyped the
matcher against the dataset and the live price map; a product designer
and accessibility reviewer walking three personas; a platform engineer
verifying library and browser claims; an evaluation designer.

Changed:

- **Matcher, from the data prototype.** Stem index normalised with
  spelling-variant and reprint-split unions; fuzzy guarded by length,
  reference and numerals (131 stems have a neighbour at distance 1; nine
  distance-1 pairs are different cards type and brigade cannot
  separate); identity scoring adds strength/toughness and identifier
  (929 → 947 of 959 homonym stems separable); print number and rarity
  code transcribed (2,521 of 3,190 Rotation printings carry one); Lost
  Soul nickname badge; special classes defined from data with UR+ added
  and "foil" and "alternate border" removed; printing rules restated as
  filters then collapse (amber 319 → 93 → 64 identities); reasons split
  into name and printing fields; vocabulary mapping layer; dataset
  numbers corrected (3,521 stems, 757 twin stems, 30.0%).
- **Consistency.** Second look moved out of the matcher, capped at one
  call per photo under the same reservation, costed; detections always
  stored and purged for unmatched photos; "from $X" removed; printings
  enumerated by identity key (`printingsForKey` returns non-unique
  names); `putItems` overwrites, so Haves add to existing; outcomes
  recorded per scan id; `is_superuser()` described correctly; legend
  moved to `setOrder.ts` keyed on `officialSet`; rolling windows
  everywhere with `resets_at`; `maxDuration` 90 with 25 s timeouts;
  `sendEmail` for digests; `/privacy` page added; type vocabulary fixed.
- **Platform.** Client decode through `<img>` (WebKit drops EXIF on
  `createImageBitmap(file)`); `max_tokens` stop no longer read as "too
  many cards" (thinking is unbounded and the SDK cannot attribute it),
  cap raised to 16k with one retry; image tokens restated on the 28-px
  patch rule with the 4,784 cap (4:3 → 2212 × 1659; low-res arm defined
  by tokens, not "1568"); schema without length bounds; `accept`
  unchanged; `File` accumulation on iOS; 413 by `x-vercel-error`; the
  082 definer pattern for the RPC; Anthropic retention copy corrected to
  30-day deletion with the flagged-content exception.
- **Product.** Burst cap 20 per 10 minutes; Haves, priced list and undo
  in the success state; Radix dialog for the picker; View collection
  with the format filter cleared and a Just added group; price on line
  one; failed photos get Retry and Remove; toolbar folding below `sm`;
  Find card instead of an inline input; undo by delta with disable
  rules; binder-page bucket and tip; desktop drop target, table layout
  and keyboard; set always shown; "to buy at YTG" framing; the full copy
  table; accessibility specifics; safe-area footer.
- **Evaluation.** E0 reframed as a pre-registered screen with pass
  counts and false-pass odds; label schema and position-free multiset
  scoring with a silent-wrong class; other-game photos expected to yield
  `not_found`; model-only versus matcher metrics; staged arms (about
  410 requests) with two repetitions as a noise floor; harness rules; E2
  on originals and client-resized blobs; E3 denominators, abandonment,
  rejected rows, a weekly audit sample, calibration rules, paired
  acceptance for prompt changes; windowed kill criteria with minimum
  sizes; the probability table replaced by a dated scoresheet.

Rejected or deferred: "Add to Wants" from the tray and a "Recent scans"
list (week-one asks; v1.1); dropping prices from candidates (the printing
rules need them server-side; the loader is shared instead); higher
global caps; treating Fundraiser as standard (it is filed as promo by
rarity and filtered like one; the "N printings" line lets a real
Fundraiser owner fix it).

**Unrelated finding, flagged once:** `scripts/run-claude-matching.ts`
calls `claude-sonnet-4-20250514`, retired on 2026-06-15; current Sonnet
is `claude-sonnet-5-5`.
