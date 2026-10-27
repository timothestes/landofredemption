# Card scanner: photograph cards, add them to your collection, see what they're worth — design

Date: 2026-10-26. Status: **rev 2, after adversarial review** (five
reviewers; log at the end). Not yet approved.

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
and its merge import, the trade list's "Haves", the price cache and
product links, the card identity module, and the existing card
components. It adds one page, one API route, one small library, one
migration, one admin table, one cron and one evaluation script.

## Vocabulary

- **Photo**: one image the player captured or picked; one card or a flat
  spread.
- **Detection**: one card the recogniser believes is in a photo, with
  everything it could transcribe: title, scripture reference, opening
  words of the ability, card type, brigade colour, border style, set
  marking, position, confidence.
- **Stem**: the printed title with the dataset's printing decorations
  removed. `cardNameStem` in `lib/cards/cardIdentity.ts` already does
  this: "Son of God (J)", "Son of God [K]" and "Son of God [Fundraiser]"
  share the stem "Son of God". The dataset has 5,681 distinct names but
  3,494 stems; 1,465 stems have two or more printings, covering 64% of
  all printings.
- **Identity**: the card a player would say they own, regardless of
  printing: `cardIdentityKey` groups printings by stem plus type,
  brigade, alignment and class, then unions on ability text or shared
  scripture reference. Some stems hold several identities ("Aaron" in
  two sets with different abilities, three different "The Depraved" by
  brigade).
- **Printing**: one row of `CARDS`, identified by the app-wide card key
  `name|set|imgFile`, the key `collection_cards` and `card_prices` use.
- **Candidate**: a printing a detection may be.
- **Tray**: the matched cards accumulated across photos in one session,
  before anything is written.
- **Commit**: writing the tray to the collection.

## Goals

1. From the phone camera to a reviewed, committed tray of a dozen cards
   in under a minute.
2. Name recognition good enough that the player corrects the exception,
   not the rule: measured, not assumed (see Evaluation).
3. Printing chosen sensibly when the photo does not settle it, marked
   only when the choice matters (price or legality differ), and fixable
   in one tap during and after commit.
4. Bulk-friendly: many photos per session, many cards per photo, nothing
   important lost on a page refresh, one commit at the end, undo after.
5. Every scan and every correction recorded as structured data so quality
   is observable week over week and the evaluation set grows for free.
6. Spend bounded by construction: per-user and global caps in Postgres, a
   dedicated API key, and no path where a burst of requests can exceed
   the Max plan's monthly credit.

## Non-goals

- On-device recognition or offline use.
- Prices from anyone but YTG.
- A trade flow. Trade lists exist; the tray can add to Haves (below) and
  stops there.
- Scanning a deck into the deck builder. Same engine, different flow,
  later.
- A live viewfinder. The native camera is the viewfinder.
- Condition grading, counterfeit detection.
- Signed-out use. Wanted, but the anonymous rate limiter is dead
  (Constraints).

## Anti-goals

- A scanner that is confidently wrong. A vision model fails differently
  from OCR: OCR produces garbage you can distance-match, a vision model
  produces a plausible real card name. Every rule below that asks for
  corroborating fields (reference, ability, type, brigade) exists for
  this reason.
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
  listings cron keeps the shared key and is not affected by scanner
  traffic.
- **Vercel function bodies are capped at 4.5 MB**, and above it Vercel
  returns its own non-JSON 413 before the route runs. The client
  downscales before upload and branches on content type when reading
  errors.
- **The Upstash rate limiter is uninstalled.** Nothing new depends on it.
  Caps are enforced in Postgres per user and globally, which is why
  scanning requires sign-in. A Vercel WAF rate rule on `POST /api/scan`
  (about 30 per minute per IP) is added in the dashboard as belt and
  braces; it is not the control.
- **Identity is per printing in storage**, but ownership elsewhere is
  name-level ("Cards I own", "Check my collection" count any printing).
  A wrong printing therefore does not break those views; it skews set
  completion and the "to buy at YTG" total on `/collection`.
- **Printed titles carry no set.** Set membership is an icon, a border
  style, sometimes a small abbreviation or year. Lost Souls are all
  titled "Lost Soul"; their identity is the scripture reference, which
  the `reference` field holds for 5,687 of 5,693 cards.
- **Blob card images are roughly 344 × 512 JPEGs**, not uniform. Fine for
  thumbnails and for a later art-similarity index, too small to read set
  icons from.
- **Mobile first**, per CLAUDE.md. Design system:
  `prompt_context/design_system.md`; green is the single accent; amber
  is for warnings only.
- Latest migration on `origin/main` is `121_deck_folder_visibility.sql`;
  this feature's migration is 122 and is re-checked at merge.

## Recognition approach

### Stage A (v1): the model transcribes, the app matches

One Claude request per photo returns structured JSON. For each card the
model can see it transcribes, exactly as printed and without guessing:

- the title;
- the scripture reference line, if any;
- the first six words of the special ability text, if legible;
- the card type as shown in the icon box (Hero, Evil Character,
  Enhancement, Lost Soul, Dominant, Site, Fortress, Artifact, Covenant,
  Curse, City, Territory-class, unknown);
- the brigade colour or colours of the frame;
- the border style: white border, full art, alternate border, foil,
  promo frame, unknown;
- any set marking it can read: an abbreviation, a year, a word; plus a
  one-line description of the set icon (shape and colour) when it can
  see one but not read it;
- its position in the spread as a grid cell (row, column in reading
  order) and, optionally, a normalised bounding box;
- whether the card is rotated or upside down;
- a confidence bucket.

Plus a photo-quality verdict (`ok`, `blurry`, `dark`, `glare`,
`too_many_cards`, `no_cards`).

The model never sees the card list and never picks a key. The matcher
(pure, unit-tested, no API) does the rest:

1. **Stem resolution.** Normalise the transcribed title the way
   `cardNameStem` normalises dataset names (case, curly quotes,
   punctuation, whitespace). Look it up in a stem index built once from
   `CARDS`. If absent, score every stem with normalised
   Damerau-Levenshtein and accept the best when it clears a threshold
   and leads the runner-up by a margin; both numbers are set from E0
   outputs. `searchCardNames` is not used here: it is unscored and built
   for the article picker. It is used for the picker's search box.
2. **Identity resolution.** If the stem maps to one identity, done. If
   several, score each identity on the reference (normalised book names
   and numerals), the ability prefix, the type and the brigade; pick a
   clear winner, else the row is **Check this** with the identities as
   candidates.
3. **Lost Souls.** Title "Lost Soul" skips steps 1 and 2 and resolves by
   reference against Lost Soul printings; a missing or unmatched
   reference is **Check this** with the picker scoped to Lost Souls.
4. **Printing selection** inside the identity (rules below).
5. **Second look** for **Check this** and **Not found** rows only: a
   second, small request with the card's crop and the top five
   candidates (names and thumbnails) asking the model to pick one or
   none. This is where "the model sees candidates" pays, at pennies, and
   it is measured in E0 before it is kept.

### Printing selection

Among the identity's printings:

1. A set marking or icon description that matches exactly one printing
   (through a set-icon and abbreviation legend the builder maintains
   beside the `set_aliases` seed, covering the 55 set codes) chooses it:
   reason `set_hint`.
2. Border style and frame narrow the set: alternate border, full art,
   promo frame and foil each exclude printings that cannot look like
   that. The legend records which sets have which looks.
3. Among what remains, de-prioritise promos, alternate borders, legacy
   rares and AB reprints unless a hint supports them (a shoebox is mostly
   standard prints, and the price of a promo must never be reported for
   a common card), prefer `legality === 'Rotation'`, then printings with
   a YTG price, then the newest by a set-order table the builder adds
   (`lib/cards/setOrder.ts`, with a test that fails when `make
   update-cards` introduces a set it does not know).
4. If the surviving candidates all share the same price (or are all
   unpriced) and the same legality, the choice does not change anything
   the player sees except set completion: the row is **Matched** with a
   quiet "3 printings" affordance and reason `equivalent`. If they
   differ in price or legality, the row is **Check this** with reason
   `printing_ambiguous` and the candidates listed with their prices.

Reason codes on every detection: `exact`, `fuzzy`, `reference`,
`set_hint`, `border`, `equivalent`, `printing_ambiguous`,
`identity_ambiguous`, `second_look`, `none`.

### Stage A2 (v1.1, planned, with a trigger): art-similarity tiebreaker

A server-side descriptor index of all printings' Blob images (the
community tool uses a 420-byte colour-layout vector per image; ours can
be that or a small embedding), compared against the card's crop to break
ties inside an identity when prices differ and no set hint was read.
Built when E0 or E3 shows printing corrections are the dominant
correction, which the dataset numbers say is likely (probabilities
below). It is not in v1 because it depends on crop quality, which E0
measures first.

### Why not the alternatives first

- **On-device OCR.** The community tool needs 11 border masks, Hough
  fallbacks, 4 to 7 binarisations, a lexicon repair step and a
  picture-match override to make Tesseract work, and still ships no
  accuracy number. Its "Read name with Claude" button is wired to the
  Claude Artifacts runtime and is hidden on the public site.
- **Fingerprint index alone.** Cannot tell an AB reprint from its
  original (387 pairs share art), is fragile under glare and
  perspective, and is a week or two before anything works. It is the
  right tiebreaker, so it is Stage A2, not Stage A.
- **Barcodes.** Redemption cards have none.

### Model, effort, resolution are evaluation outcomes

Baseline Claude Opus 5.5. E0 (below) sweeps model × effort, and
resolution × position format on spreads. The shipped choices live in one
constant each. Costs use Anthropic's rule of thumb (width × height / 750
image tokens); output includes the JSON and the model's thinking, which
on Opus 5.5 cannot be turned off and bills as output. These are
pre-E0 estimates and E0 rewrites this table from measured
`usage.output_tokens`:

| Photo | Long edge | Input tokens | Est. output | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 |
|---|---|---|---|---|---|---|
| Single card | 1568 | ~1,600 | ~600 | ~$0.02 | ~$0.01 | ~$0.0005 |
| 12-card spread | 1568 | ~2,500 | ~1,500 | ~$0.04 | ~$0.02 | ~$0.001 |
| 12-card spread | 2576 | ~4,800 | ~1,500 | ~$0.05 | ~$0.025 | ~$0.0013 |

At 2576 px a 12-card spread gives each card about 450 px of width, which
is what makes a set icon or copyright line readable at all; at 1568 px
each card is about 280 px and set markings will mostly come back null.
E0 decides whether the extra cost buys printing accuracy.

## The flow

### Entry points

- `/collection` gets a **Scan cards** button. On phones it is the primary
  action and **Build a deck** drops to the outline style; on desktop both
  keep their current weights with Scan beside Import CSV. The first-run
  banner's call to action becomes Scan cards, with Import CSV as a text
  link. Signed out, the page shows the existing gate with copy that says
  what scanning does and `redirectTo=/collection/scan`.
- `/collection/scan` is a route, not a modal, because a camera round-trip
  can evict the tab and a route restores cleanly.

Price display follows the existing `useShowPrices` preference. There is
no mode switch: the same photo always resolves the same way, and the
footer offers both outcomes.

### Capture

- **Take photo**: a hidden `<input type="file" accept="image/*"
  capture="environment">`. **Choose from photos**: the same input without
  `capture`, with `multiple`. iOS ignores `multiple` when `capture` is
  set and hands back a temporary file that is not saved to the camera
  roll; if Safari evicts the tab while the camera is open, that photo is
  gone. The guidance says so and recommends the Camera app plus Choose
  from photos for batches: "For a stack: take the photos in your camera
  app first, then choose them here. One card, or up to 12 laid flat
  with gaps."
- Client downscale with `createImageBitmap(file, { resizeWidth })` and an
  `<img>` fallback, never a full-size canvas decode (48 MP photos kill
  the tab on iOS). Long edge 2576, JPEG 0.82, hard stop 3 MB. If decode
  fails (Samsung and Pixel HEIF, some HEIC), the photo is not uploaded and
  the message says: "Your camera saved this in a format the browser can't
  read. In camera settings choose 'Most compatible' and try again."
- The photo is posted as `multipart/form-data` to `POST /api/scan`. The
  original never leaves the phone. At most two uploads are in flight at
  once; more queue on the client.

### Processing

Each photo is a hairline row group headed by a small thumbnail and a
state: *Reading…*, *N cards*, or a specific failure: "Too dark",
"Blurry", "More than about 12 cards. Split it up", "You've scanned 150
photos today, the daily limit. Scanning opens again at 3:15 pm",
"Scanner is busy, retrying", "Scanner is paused for today" (global cap),
"Scanner is resting until next month" (credit exhausted), "Couldn't read
this photo, try again" (other errors). Several photos process while the
player keeps taking more.

### Review list (the tray)

One row per detection under its photo, in grid order. Identical keys
within the tray merge into one row with a summed quantity, the way the
CSV merge import already does.

A row holds, left to right: the matched printing's thumbnail (existing
`CardImage`), then a two-line text block (name and set on line one;
chip and reason, or price and "you own 2", on line two), then the
quantity as a tappable "×1" that opens a stepper. No checkboxes: a row
is in the tray or removed (swipe or the row's remove control). The
current owned quantity comes from `useCollectionState`, which the deck
builder already mounts the same way.

Chips:

- **Matched**: neutral; no chip text when the reason is `exact` or
  `set_hint`; "3 printings" as a quiet outline when `equivalent`.
- **Check this**: amber. Reason on line two: "Which printing? Prices
  differ", "Two cards share this name", "Couldn't read the verse". The
  row is in the tray with the current best guess; the amber is the ask.
  Only these rows show the photo crop beside the thumbnail, and only if
  E0 found crops reliable.
- **Not found**: amber, with the read title in a search field. Not
  counted in the total until resolved.

Tap the thumbnail or name to open the **printing picker**: a bottom
sheet (the pattern `ImportCsvModal` uses) listing the identity's
printings with image, set, legality and YTG price, the current choice
marked, and a search field at the top backed by `searchCardNames` for
changing the name entirely. A change marks the row corrected.

The tray persists in `sessionStorage` keyed by user id: detections,
chosen keys, quantities, corrections. Not thumbnails and not crops;
those are in memory and are simply absent after a reload (Safari's
sessionStorage quota is about 5 MB).

### Commit

A sticky footer with **Add N to collection** (primary; N is the summed
quantity of resolved rows) and the running total of priced rows, with
"from $X" on rows whose equivalent printings differ in price. A secondary
**Add to Haves** puts the same rows on the player's trade list through
the existing `putItems`, which is what a player pricing a stack at a
kitchen table is usually about to do.

Commit calls the existing merge import (`importRows(rows, "merge")`,
which wraps `bulkImportCollectionAction` and reloads the collection), then
`recordScanOutcomesAction(scanId, outcomes)`. The success state keeps
the committed rows on screen with their new owned totals, each still
tappable to change printing (which decrements the old key and increments
the new one), plus **Undo** (restores the previous quantities recorded
before commit), **Scan more** and **View collection**.

`/collection`'s own card modal gains a **Change printing** control using
the same picker, so a wrong printing found later is a two-tap fix rather
than a search, a decrement, a search and an add. This helps CSV imports
as much as scans.

### What is recorded

On commit each detection's outcome goes on its scan event: final key,
printing changed, name changed, removed, left unresolved, and which
reason code it had. That is the labelled data E3 lives on.

## Data

### `POST /api/scan`

Request: `multipart/form-data` with `photo` (≤ 3 MB). Session required
and checked before the body is read. Server-side with `sharp`:
`rotate()` (EXIF orientation), `resize` inside 2576 × 2576 without
enlarging, JPEG quality 82, metadata stripped. This bounds pixels and
cost on the server rather than trusting the client, removes GPS and
other EXIF before anything reaches Anthropic or Blob, and sniffs the real
format; a file sharp cannot decode is a 415.

Response 200:

```
{
  scanId, photoQuality,
  detections: [{
    id, grid: { row, col }, bbox | null, rotated,
    read: { title, reference, abilityStart, type, brigade, border, setMarking, setIconNote, confidence },
    status: 'matched' | 'check' | 'not_found',
    reason, chosenKey | null,
    candidates: [{ key, name, set, officialSet, imgFile, legality, price | null, shopifyHandle | null }]
  }],
  usage: { model, latencyMs }
}
```

Errors, all JSON: 401; 413 (and the client also handles Vercel's own
non-JSON 413); 415 undecodable; 429 user cap with `resetsAt`; 503 with
`Retry-After` for the global cap, an Anthropic rate limit, an Anthropic
overload, or an exhausted credit (`billing_error`), each with a distinct
`code`; 502 recogniser failure (refusal, invalid JSON) marked retryable
or not.

Prices for candidate keys come from `card_prices` through an RPC taking
`text[]` (keys contain quotes, which corrupts PostgREST `.in()`); the
client builds product links with the existing `getProductUrl` from
`useCardPrices`.

### Reserve first, then call

A SECURITY DEFINER RPC `scan_reserve()` takes
`pg_advisory_xact_lock(hashtext(auth.uid()::text))`, counts the caller's
events in the last hour, day and 30 days **including pending and failed
rows**, counts everyone's events today and this month, and either inserts
a `status = 'pending'` row and returns its id or raises with the cap that
was hit. Only then does the route call the model, and it finishes the
row (`done` or `failed`, with model, tokens, latency, cost) through the
admin client. The 2 to 8 second model latency is therefore never a race
window.

Caps, as constants in the RPC, changeable by migration:

| Scope | Limit |
|---|---|
| Per user, burst | 20 photos per hour |
| Per user, day | 150 |
| Per user, 30 days | 1,500 |
| Everyone, day | 300 |
| Everyone, month | 2,000 |

At Opus spread cost the global monthly cap is about $80 to $100; on
Sonnet it is half. The global cap is what makes the kill criterion
enforceable rather than aspirational.

### Migration `122_scan_events.sql`

```
scan_events (
  id uuid pk default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null check (status in ('pending','done','failed')),
  model text, latency_ms integer, input_tokens integer, output_tokens integer,
  cost_usd numeric(8,5),               -- from a price constant per model
  photo_quality text,
  detections jsonb,                    -- read fields capped (title 60, reference 40, ability 80, marking 20 chars); stored only when ≥1 detection matched
  outcomes jsonb,                      -- set on commit
  image_pathname text,                 -- private Blob pathname when opted in
  image_expires_at timestamptz
)
```

RLS: `SELECT` own rows, and `is_superuser()` sees all. **No INSERT or
UPDATE grant to `authenticated`**: every write goes through the
`scan_reserve()` RPC or the admin client, so a user cannot forge events,
token counts or detections. `recordScanOutcomesAction` filters by the
caller's `user_id`, validates the JSON shape against the schema, and
caps its size. Index on `(user_id, created_at desc)` and on
`(created_at)` for the global counts.

### Photo retention (opt-in)

A toggle on the scan page, off by default, stored as a boolean on
`profiles`: "Keep my scan photos for 30 days to help improve the
scanner." When on, the re-encoded photo is written to a **private Blob
store** at `scans/<user>/<scanId>.jpg`; private access needs a store
configured for it, and the only one today is Forge's dedicated store
(`FORGE_BLOB_STORE_ID`, OIDC in prod), so the builder reuses it under the
`scans/` prefix or Tim provisions a new private store (a dashboard
action). Private blobs are not browser-loadable, so the admin page reads
them through `/admin/scans/image/[id]`, which checks `is_superuser()` and
streams `get(pathname, { access: 'private' })`.

A **daily** cron lists the `scans/` prefix and deletes blobs older than
30 days by `uploadedAt` (paginated, so cascade-deleted accounts do not
orphan blobs), then nulls the columns; it also purges `detections` on
events older than 30 days that had no matched card, since those can
contain whatever text was in a non-card photo. Turning the toggle off
deletes the player's stored photos immediately. The cron uses the same
`CRON_SECRET` and alerting as its siblings.

Copy on the gate and beside the toggle: "Photos are sent to Anthropic to
read the card names. Anthropic may keep them up to 30 days for abuse
monitoring and does not train on them. We keep nothing unless you turn
on 'Keep my scan photos'." The privacy policy gets a matching line.

### Admin view

`/admin/scans`: a table, superuser-only in v1 through the existing
`admin_users` / `is_superuser()` pattern (the `registration_admin` role
named in CLAUDE.md was retired by migration 005), linked from the admin
dropdown in both the desktop and mobile nav like its siblings. Columns
per day: scans, failures, cost, p50 and p95 latency, correction rate by
reason code, printing-change rate, accuracy by confidence bucket, and a
list of the most-corrected read titles. A daily digest email through the
existing cron alert helper fires when the day's or month-to-date cost
crosses a threshold.

## The Claude call

`lib/scan/recognize.ts`, server only. Client
`new Anthropic({ apiKey: SCANNER_ANTHROPIC_API_KEY, maxRetries: 0,
timeout: 30_000 })` (the SDK default of two retries plus ours would reach
six attempts). One manual retry on 5xx, 529 or timeout, never on a
refusal. `export const maxDuration = 60` on the route.

- `messages.create` with the image as a base64 block after a fixed
  instruction block. Model from a constant, baseline `claude-opus-5-5`,
  `output_config.effort` from a constant (E0 picks `low` or `medium`),
  adaptive thinking left at its default, no `temperature` (the current
  API version rejects it), no `cache_control` in v1 (a short prompt is
  under Opus 5.5's 512-token caching minimum and the traffic is too
  sparse for the five-minute window; E0 confirms with
  `cache_read_input_tokens`).
- Structured output through `output_config.format` with the JSON schema
  in `lib/scan/schema.ts`; no tools, no forced tool choice.
- The instruction describes what a Redemption card looks like and where
  each field is (title band at top, type icon box top-left, brigade in
  the frame colour, set icon and copyright bottom, reference above or
  within the ability text), says cards may be sleeved, rotated or upside
  down, says to transcribe exactly and return `UNREADABLE` fields rather
  than guesses, and asks for grid positions in reading order. A set-icon
  legend image is an E0 arm, not a default.
- `max_tokens` starts at 8,000 and is set from E0's p99 output × 2.
  `stop_reason === 'max_tokens'` maps to `too_many_cards`, not to a
  generic failure. Invalid JSON after schema validation is a 502.
- Usage, latency and `cost_usd` go on the event. Anthropic 429s are
  distinguished from our caps and surfaced as "busy, retrying" with
  `Retry-After`. The Console's rate-limit tier for the new workspace is
  checked before E2.

## Evaluation: continuous, with gates

The recogniser is a probabilistic component inside a deterministic app.
It is measured at every stage with the same tooling: a folder of photos,
a labels file, a script that prints a table with confidence intervals.

### The photo set (the answer to "do you need loads of pictures")

No. About seventy photos from Tim's own phone, in a mix chosen so the
gates mean something:

| Bucket | Count | What's in it |
|---|---|---|
| Single, easy | 25 | one card, flat, room light; mix of eras and types including Lost Souls, Sites, Dominants, a card with an unsuffixed twin |
| Single, hard | 15 | sleeved, glossy glare, foil, angled 20°+, old-frame, promo, alternate border, AB twin, upside down |
| Spread 4–8 | 8 | flat with gaps |
| Spread 9–12 | 6 | |
| Spread 15–20 | 4 | the community tool claims about 30 works; we want the curve |
| Spread 25–30 | 3 | expected to fail; we want to see how |
| Not a card | 10 | hands, tables, a booster wrapper, and at least four cards from other games (the real false-positive risk is the model transcribing a Magic title and the fuzzy matcher adopting it) |

Labels (`scripts/scan-eval/labels.json`): per photo, the multiset of
expected keys (not reading order), and per card `setVisible: true/false`
and the stem, so name accuracy and printing accuracy are scored
separately. Every key is validated against the card index when the file
loads (names contain double spaces and odd parentheses). Photos live in
`scripts/scan-eval/photos/`, git-ignored, with a copy in the private Blob
store so a worktree can fetch them. After launch the set grows from
opted-in photos plus their recorded corrections, which arrive labelled.

### E0: feasibility gate, before any product code

About a day. `scripts/scan-eval/run.ts` sends every photo to each arm,
runs the matcher, and prints per arm:

- stem accuracy on singles (top-1), with a Wilson 95% interval;
- per-card precision and recall on spreads, scored as multisets, with
  false cards reported as a maximum per photo as well as a rate;
- printing accuracy on cards with `setVisible`;
- accuracy by the model's own confidence bucket (if "high" and "low"
  score alike the chip is theatre and is dropped);
- grid and bbox usefulness: share of crops that contain the right title;
- second-look lift on Check this and Not found rows;
- latency p50 and p95, `usage` tokens, cost per photo, cache reads.

Arms: models {Opus 5.5, Sonnet 5.5, Haiku 5.5} × effort {low, medium} on
all photos; then, on spreads with the best model, long edge {1568, 2576}
× position {grid, bbox, none}; then the set-icon legend on singles. A
few dollars in total.

Gates, stated as smoke tests on small samples (the script prints the
interval and the decision uses the interval's lower bound where it can):

- Single easy: ≥ 90% stem top-1 (23 of 25).
- Single hard: ≥ 75% (12 of 15).
- Spreads up to 12: per-card **precision ≥ 97%**, recall ≥ 85%, at most
  one false card on any photo. Precision outranks recall: a hallucinated
  card corrupts a collection, a miss costs a rescan.
- Not a card: zero detections on at least 9 of 10, and never a matched
  row from another game's card.
- Crops ship only if ≥ 90% of them contain the right title.

If names fail: the capture flow changes before building (one card per
photo, or a title-band crop instruction) and the second look becomes
mandatory rather than measured. If only printing fails: ship as designed
and schedule Stage A2. Numbers and the decision go in the review log.

### E1: during the build

- `lib/scan/match.ts` has golden tests from recorded E0 model outputs
  per model, so the matcher is tested on real transcriptions without an
  API call; outputs are re-recorded when the model changes.
- Any PR touching the prompt, schema or matcher re-runs the script on
  the saved outputs (free) and, when the prompt changed, live (cents).

### E2: before launch

- E0's set through the deployed `/api/scan` on a preview URL, so the
  downscale, re-encode and upload path is measured too, including five
  concurrent uploads.
- Manual pass per the `verify` skill on phone-sized viewports and one
  real iPhone and one real Android: camera capture, multi-select, a
  48 MP photo, an HEIF photo, a 10-card spread, a correction through the
  picker, a refresh mid-tray, commit, undo, change printing after commit,
  Add to Haves, the 429 copy, the signed-out gate.

### E3: after launch, continuously

- The `/admin/scans` table above, checked weekly for a month then
  monthly, and reconciled against the scanner workspace's spend in the
  Console.
- An export script turns events with outcomes (and opted-in photos) into
  the eval folder format; the eval set grows.
- A model, effort, resolution or prompt change ships only when it beats
  the current arm on the full eval set, with the table pasted into the
  PR.

### Kill and pivot criteria

- Spend is bounded by the global cap; the credit being exhausted shows
  as "resting until next month", not a bill. Revoking the scanner key in
  the Console stops everything in seconds without a deploy.
- Correction rate above 30% in week two: the Scan button gets a "beta"
  label (a server-read boolean; the page stays up) and Stage A2 is
  pulled forward.
- Printing changes above half of all corrections at any point: Stage A2
  starts.

## Probability estimates

Pre-E0 estimates for this design in this app; E0 replaces them. The
dataset numbers behind several of them: 64% of printings share a stem
with another printing; 31% have an unsuffixed twin; `newest` is
undefined for 613 stems without a set-order table; 258 Lost Soul
printings share one title.

| Claim | Estimate |
|---|---|
| Best arm clears the single-easy gate (23 of 25) | 75% |
| Best arm clears the single-hard gate (12 of 15) | 65% |
| Best arm clears the 12-card spread gate at 2576 px | 50% |
| Same at 1568 px | 40% |
| 15–20 card spreads usable without splitting | 30% |
| 25–30 card spreads usable | 10% |
| Printing correct without a visible set marking, by the rules above (icon description, border, priority) | 50% |
| Same once Stage A2 exists | 75% |
| Grid-cell crops contain the right title ≥ 90% of the time | 65% |
| Pixel bounding boxes do | 30% |
| The second look lifts Check this rows by ≥ 15 points | 60% |
| Haiku 5.5 alone clears the single-easy gate | 45% |
| Sonnet 5.5 clears every gate Opus 5.5 clears | 60% |
| Monthly spend stays under the credit in the first three months (caps make this structural) | 95% |
| v1 ships within six agent-days after approval, given the photos | 55% |
| Players use the scanner more than CSV import within a month | 70% |
| Stage A2 is needed within three months | 70% |
| An honest player hits the 150-a-day cap (a 3,000-card shoebox at 10 cards a photo is 300 photos) | 20% |

## Files

- `app/collection/scan/page.tsx`: auth gate with `redirectTo`, metadata,
  renders the client.
- `app/collection/scan/client.tsx` and `components/`: `CaptureButtons`,
  `PhotoGroup`, `DetectionRow`, `PrintingPicker`, `CommitBar`,
  `RetentionToggle`.
- `app/collection/scan/hooks/useScanTray.ts`: tray state with
  `sessionStorage` persistence of detections, keys, quantities.
- `app/collection/client.tsx`: Scan button weights, first-run banner,
  Change printing in the card modal.
- `app/collection/actions.ts`: `recordScanOutcomesAction`; commit reuses
  `bulkImportCollectionAction` through `importRows`.
- `app/api/scan/route.ts`: session, `scan_reserve()`, sharp re-encode,
  recogniser, matcher, prices RPC, finish event; `maxDuration = 60`.
- `lib/scan/recognize.ts`, `lib/scan/match.ts`, `lib/scan/schema.ts`,
  `lib/scan/stemIndex.ts`, `lib/scan/__tests__/`.
- `lib/cards/setOrder.ts` and the set-icon and abbreviation legend, with
  a coverage test against `CARDS`.
- `scripts/scan-eval/run.ts`, `labels.json`, `photos/` (git-ignored),
  `outputs/` (recorded model JSON per model, committed), `export.ts`.
- `supabase/migrations/122_scan_events.sql`: table, RLS, `scan_reserve()`,
  the prices-by-keys RPC, the `profiles` retention column.
- `app/admin/scans/page.tsx`, `app/admin/scans/image/[id]/route.ts`, nav
  links.
- `app/api/cron/purge-scans/route.ts` plus a daily `vercel.json` entry.

## Testing

- `lib/scan/match.ts` and `stemIndex.ts`: stem normalisation (quotes,
  brackets, case, slash names, double spaces), exact and fuzzy
  thresholds with margins, identity scoring on reference, ability, type
  and brigade (Aaron, The Depraved, Captain of the Host), Lost Soul
  reference matching with inconsistent bracket styles, every printing
  rule and reason code, promo de-prioritisation, AB-twin default, the
  `equivalent` collapse, and the golden set. Vitest, node only.
- `lib/cards/setOrder.ts`: every set code in `CARDS` has an order and a
  legend entry.
- `app/api/scan/route.ts`: cap and size checks and error mapping with the
  recogniser stubbed; `tsc` clean against the baseline.
- The RPC: a SQL test or a scripted check that two concurrent reserves at
  the cap yield exactly one row.
- The eval script is the recogniser's integration test (E0, E1, E2).
- Manual E2 as above.

## Rollout

1. Tim: create a `scanner` workspace and key in the Max org, add
   `SCANNER_ANTHROPIC_API_KEY` to Vercel; decide the private Blob store;
   take the seventy photos; add the WAF rate rule.
2. E0; record numbers and decisions in the review log; pick model,
   effort, resolution, position format; decide whether crops and the
   second look ship.
3. Build. Apply migration 122 before merging the route.
4. E2 on the preview URL; merge; one What's New line; privacy policy
   line.
5. E3 weekly for a month.

## Calls I made (for review)

1. Server-side vision; the model transcribes fields, the app matches on
   stem, identity and printing. The model never picks a key.
2. Transcribe reference, ability opening, type, brigade and border, not
   just the title, so a plausible-but-wrong title is caught by a
   disagreeing field.
3. One flow, no modes; price always visible per `useShowPrices`; Add to
   collection primary, Add to Haves secondary.
4. Amber only when the choice matters (price or legality differ) or
   nothing matched; equivalent printings collapse to a quiet count.
5. Promos, alternate borders, legacy rares and AB reprints are never the
   default without a hint.
6. Sign-in required; reserve-first caps in Postgres with per-user and
   global limits; a dedicated scanner key and workspace.
7. Server-side sharp re-encode of every upload.
8. Commit through the existing merge import; undo and post-commit
   printing change in the success state; Change printing added to the
   collection card modal.
9. Tray in `sessionStorage` without images.
10. Photos not kept unless opted in; private store; daily purge; raw
    detections of unmatched photos purged at 30 days.
11. Stage A2 (art tiebreaker) planned with a data trigger, not built in
    v1.
12. Baseline Opus 5.5; model, effort, resolution, position format,
    crops and second look are all E0 outcomes.
13. Admin view superuser-only in v1, plain table.

## Left to the builder

- Fuzzy thresholds and margins, identity scoring weights, `max_tokens`,
  effort, resolution: all from E0 outputs.
- The set-icon and abbreviation legend contents and the set-order list.
- Whether Forge's private store is reachable from the main app in prod,
  or a new store is needed (then Tim provisions it).
- Component split inside the client as long as the listed pieces exist.
- Exact copy within the design system's tone.

## Open questions for Tim

1. Create the scanner workspace and key (I cannot create secrets). Reuse
   Forge's private Blob store, or provision a new one?
2. The seventy photos in the mix above.
3. Privacy policy wording: use the copy proposed here, or your own?

## Adversarial review log

Rev 1 was reviewed by five independent agents on 2026-10-26: a study of
the community tool's source, a recognition and evaluation adversary (with
measurements over `cardData.json`), a product and slot-in adversary, a
security, cost and operations adversary, and a builder check.

**Changed in rev 2:**

- Matching now works on stems and identity groups through
  `cardIdentity.ts`, not on `name`; `CARD_BY_NAME_LOWER` is private and
  single-valued and names embed the printing (builder check, recognition
  adversary). Lost Souls resolve by scripture reference (all three).
  The model transcribes reference, ability opening, type, brigade and
  border (recognition adversary, community-tool study).
- A real fuzzy matcher over 3,494 stems replaces the unscored
  `searchCardNames`; a measured second-look call for uncertain rows
  (recognition adversary, builder check).
- "Printing guessed" no longer fires on two thirds of rows: equivalent
  printings collapse to a quiet count, amber only when price or legality
  differ; promos and alternate borders are never the default; the
  `newest` rule gains a set-order table (recognition adversary, product
  adversary, community-tool study).
- Modes removed; the same photo resolves the same way; price always
  visible; Add to Haves added now (product adversary).
- Rows show owned quantity; no checkboxes; merged duplicates; undo and
  post-commit printing change; Change printing in the collection modal
  (product adversary).
- Commit reuses `bulkImportCollectionAction` merge; `outcomes` written
  by a small action (product adversary, security adversary).
- Tray persists detections only (product and recognition adversaries).
- Capture: iOS `capture` ignores `multiple` and loses the photo on tab
  eviction; HEIF decode failure handled; `createImageBitmap` resize;
  48 MP in E2 (product adversary).
- Spreads sent at up to 2576 px with E0 deciding; grid positions instead
  of pixel boxes by default; crops only if E0 proves them (recognition
  adversary, community-tool study).
- Reserve-first `scan_reserve()` RPC with an advisory lock counting
  pending and failed rows; burst, daily, monthly and global caps; no
  INSERT or UPDATE for `authenticated`; admin client for writes
  (security adversary).
- `registration_admin` replaced by the `admin_users` / `is_superuser()`
  pattern; nav links (security and product adversaries).
- Dedicated scanner key and workspace; `billing_error` handling; cost
  per event; digest alert (security adversary).
- Server-side sharp re-encode; 415; `maxDuration`; `maxRetries: 0` with
  one manual retry; distinct 503 codes; no `temperature`; no
  `cache_control`; `max_tokens` from E0 with `max_tokens` stop mapped to
  too many cards (security and recognition adversaries).
- Private Blob store named; admin image proxy; daily prefix-driven purge;
  detections capped and purged for unmatched photos; copy about
  Anthropic's handling (security adversary).
- Prices by keys through a `text[]` RPC; product links through
  `getProductUrl` (security and product adversaries, builder check).
- Migration 122 (all reviewers).
- Eval set grown to about seventy with ten non-card photos including
  other games' cards; multiset scoring; precision gate; `setVisible`
  labels; accuracy by confidence bucket; intervals printed; effort and
  resolution arms (recognition adversary).
- Cost table rewritten with output and thinking tokens; probabilities
  revised (recognition adversary, security adversary, builder check).
- Prior-art paragraph corrected: the community tool's Claude button is
  wired to the Artifacts runtime and hidden on the public site; its real
  strength is picture-first matching with a sureness ratio
  (community-tool study).

**Rejected or deferred, with reasons:**

- Building the art-similarity tiebreaker in v1 (community-tool study,
  recognition adversary leaning that way): deferred to Stage A2 with a
  data trigger, because it depends on crop quality that E0 has not yet
  measured, and the equivalent-printing collapse removes most of the
  user-visible pain in the meantime.
- A set-icon legend image in every prompt (recognition adversary): E0
  arm only; it costs tokens on every call and may not help.
- Global caps at the security reviewer's suggested 600 a day and 6,000 a
  month: set lower (300 and 2,000) because at Opus spread cost 6,000
  photos exceeds the credit.
- Treating 20 to 30 card spreads as a target (community-tool study):
  kept as a measured bucket, not a promise; the per-card pixel budget
  says they will not read.

**Unrelated finding, flagged once:** `scripts/run-claude-matching.ts`
calls `claude-sonnet-4-20250514`, retired on 2026-06-15; current Sonnet
is `claude-sonnet-5-5`.
