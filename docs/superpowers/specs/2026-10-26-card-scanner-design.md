# Card scanner: photograph cards, add them to your collection, see what they're worth — design

Date: 2026-10-26. Status: draft rev 1, pre-adversarial review.

## Intent

Players own shoeboxes of Redemption cards and no fast way to get them into
the site's collection tracker, or to learn what a card sells for, without
typing names one at a time or hand-building a CSV. This feature lets a
signed-in player point their phone at one card or a spread of cards, get
the cards recognised, confirm or fix the matches on a review list, and
then either add them to their collection in one tap or see each card's
Your Turn Games (YTG) price and the total.

The inspiration is a community tool (banana346-cyph's "redemption
scanner") that proved players want this. We are not copying it. That tool
reads card names on the phone with Tesseract OCR, keeps the collection
only on the device, prices against YTG and Three Lions Gaming, and
"teaches" corrections per phone. Ours is account-backed, prices against
YTG only through the SKU-level matching that already exists, recognises
cards server-side so it works the same on a cheap Android as on an iPhone,
and turns every correction into labelled evaluation data for everyone.

The scanner must be a smooth slot-in: it reuses the collection tracker,
the price cache, the card dataset and the existing card components. It
adds one page, one API route, one small library, one migration and one
evaluation script.

## Vocabulary

- **Photo**: one image the player captured or picked. May contain one card
  or a flat spread of several.
- **Detection**: one card the recogniser believes is in a photo: the name
  text it read, any set hint it read, a confidence bucket and, when
  available, a rough position.
- **Candidate**: a printing from `CARDS` that a detection may be. Identity
  is the app-wide card key `name|set|imgFile`, the same key
  `collection_cards` and `card_prices` use.
- **Tray**: the list of matched cards accumulated across photos in one
  scanning session, before anything is written.
- **Commit**: writing the tray to the collection (collection mode), or
  showing the priced summary (price mode).
- **Set hint**: anything on the card that narrows the printing: the set
  icon, a set abbreviation, a copyright year, a promo marking.

## Goals

1. From the phone camera to a reviewed, committed tray of cards in under
   a minute for a dozen cards.
2. Name recognition good enough that the player corrects the exception,
   not the rule: measured, not assumed (see Evaluation).
3. Printing chosen sensibly when the photo does not settle it, and always
   visibly marked as guessed so the player can fix it in one tap.
4. Bulk-friendly: many photos per session, many cards per photo, nothing
   lost on a page refresh, one commit at the end.
5. Every scan and every correction recorded as structured data so the
   recogniser's quality is observable week over week and the evaluation
   set grows for free.
6. Cost stays inside the Max plan's monthly API credit at any plausible
   usage, and no single account can burn it.

## Non-goals

- On-device recognition or offline use.
- Prices from anyone but YTG. No Three Lions, no TCGplayer, no eBay.
- Trading flows. Trade lists and the trade log already exist; the tray
  can be pointed at them later.
- Scanning a deck into the deck builder. Same engine, different flow,
  later.
- A live viewfinder with continuous recognition. The native camera is the
  viewfinder; we recognise still photos.
- Condition grading, foil detection, counterfeit detection.
- Signed-out price checks. Wanted, but see Constraints.

## Anti-goals

- A scanner that is confidently wrong. A silent wrong printing in a
  collection is worse than a visible "couldn't read this".
- A heavy page. No multi-megabyte OCR or vision bundles shipped to the
  phone.
- Photos retained without the player saying so.
- A second collection. The tray is temporary; the only durable store is
  `collection_cards`.
- Shipping without a measured accuracy number.

## Constraints

- **Recognition runs on Claude vision through the Anthropic API.** The
  app's `ANTHROPIC_API_KEY` was rotated on 2026-10-26 to a key from the
  Max-plan organisation (Tim's Individual Org), which receives a $100
  monthly API credit. Spend above that is real money, so caps matter.
- **Vercel function bodies are capped at 4.5 MB.** Phone photos are
  3 to 8 MB. The client must downscale before upload.
- **The Upstash rate limiter is uninstalled** (see the v1 API 500s
  incident). Nothing new may depend on it. Caps are enforced in Postgres
  per user, which is why scanning requires sign-in in v1. A signed-out
  price check waits for a working anonymous limiter (Vercel Firewall rate
  rules or a reinstalled store).
- **Identity is per printing.** `collection_cards` is keyed by
  `(card_name, card_set, card_img_file)` and `card_prices` by the same
  triple joined with `|`. The scanner must resolve to a printing, not a
  name.
- **Card images on Blob are 344 x 512 JPEGs.** Fine for thumbnails and a
  future fingerprint index, too small to be the recogniser's only source.
- **Mobile first.** Tournament tables, kitchen tables, one hand. Touch
  targets, no hover-only affordances, works in iOS Safari and Android
  Chrome.
- Design system: `prompt_context/design_system.md`. Green is the single
  accent; confidence chips use neutral slate and amber, never red for
  "low".

## Recognition approach

### Staged, with a gate before each stage

**Stage A (v1): Claude vision reads, the app matches.** The photo goes to
one Claude request that returns structured JSON: a list of detections,
each with the name text as printed, any set hint text, a confidence
bucket and a normalised bounding box when the model can give one, plus a
photo-quality verdict (`ok`, `blurry`, `dark`, `glare`,
`too_many_cards`). The app then matches each detection to printings with
pure, unit-tested code on top of `findCard` and `searchCardNames`. The
model never sees the 5,693-card list and never picks a `card_key`; it
only transcribes what it sees. That keeps the prompt small, makes the
matcher testable without the API, and lets us swap models without
touching matching.

**Stage B (only if Stage A's data says so): image fingerprint second
opinion.** Build an embedding or perceptual-hash index from the Blob card
images and the opted-in scan photos, and use it to break printing ties
(same name, different art) and to catch misreads. Triggered when
post-launch data shows printing errors, not name errors, dominate
corrections. Not designed here beyond this paragraph.

### Why not the alternatives first

- **On-device OCR (what the inspiration tool does).** Free per scan, but
  the title sits on art in a decorative face, OCR needs a cropped,
  level, well-lit title band, and the engine plus language data is about
  10 MB on first load. The tool itself has a "Read name with Claude"
  fallback button, which says how often OCR alone is not enough.
- **Fingerprint index alone.** Cannot tell an AB reprint from its
  original (same art), is fragile under glare and perspective, and is a
  one-to-two-week build before anything works. It is the right second
  opinion, not the first.
- **Barcodes.** Redemption cards have none.

### Model choice is an evaluation outcome, not a spec decision

The baseline is Claude Opus 5.5 at low effort. Claude Sonnet 5.5 and
Claude Haiku 5.5 run on the same photo set in E0 (below). The shipped
model is the cheapest one that clears the gate, and the model id lives in
one constant so E3 can change it. Costs, using Anthropic's rule of thumb
of (width × height) / 750 image tokens and about 400 output tokens:

| Photo | Pixels sent | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 |
|---|---|---|---|---|
| Single card | 1024 × 768 | ~$0.012 | ~$0.006 | ~$0.0003 |
| Spread | 1568 × 1176 | ~$0.022 | ~$0.011 | ~$0.0006 |

At the Opus spread price the $100 credit covers about 4,500 photos a
month. Expected real usage is a few hundred.

## The flow

### Entry points

- `/collection` gets a **Scan cards** button beside Import CSV, primary
  on phones, secondary on desktop. It opens `/collection/scan`.
- `/collection/scan` is also reachable directly and is the thing a
  player bookmarks. Signed out, it shows the same sign-in gate as
  `/collection` with copy that says what scanning does.
- The deck builder's card search is not touched in v1.

### Mode

A two-way segmented control at the top: **Add to collection** (default)
and **Price check**. Mode only changes the commit step and one line of
the review list; capture and recognition are identical. The chosen mode
persists in `localStorage`.

### Capture

- A large **Take photo** button that is a hidden
  `<input type="file" accept="image/*" capture="environment">`. No
  `getUserMedia`, no permission dialog beyond the camera's own, works in
  every mobile browser. A second, quieter **Choose from photos** input
  without `capture` for pictures already taken; it allows multiple
  selection.
- Guidance under the button, one line, shown until the first commit:
  "One card, or up to 12 laid flat with gaps between them. Fill the
  frame."
- Client downscale with a canvas before upload: long edge 1024 px for a
  photo the player marked as one card, 1568 px otherwise (the player
  does not choose; the app sends 1568 and the server crops nothing; the
  single-card size is an optimisation E0 may or may not keep). JPEG at
  quality 0.82, EXIF orientation applied. Target under 600 KB, hard stop
  at 3 MB.
- The downscaled photo is posted as `multipart/form-data` to
  `POST /api/scan` with the mode. The original never leaves the phone.

### Processing

- Each photo becomes a card in a vertical list with a thumbnail of the
  downscaled photo and a progress state: *Reading…*, *Done: N cards*,
  *Couldn't read: reason*. Several photos may be in flight; the player
  can keep taking photos while earlier ones process.
- Expected latency per photo is 2 to 8 seconds depending on model. The
  state is shown on the photo card, never as a blocking spinner.
- Failure states are specific and actionable: "Too dark", "Blurry",
  "More than about 12 cards. Split it up", "Rate limit for today reached
  (150 photos)", "Scanner unavailable, try again" (API error).

### Review list (the tray)

One row per detection, grouped under its photo, in reading order
(top-left to bottom-right, or by bounding box when present).

Each row shows:

- The matched printing's image thumbnail (existing `CardImage`), name,
  set, and a quantity stepper defaulting to 1.
- A confidence chip: **Matched** (neutral), **Printing guessed** (amber,
  with the reason in a tooltip/tap: "No set marking read; chose the
  printing YTG sells"), **Check this** (amber, low confidence or fuzzy
  name match; row is pre-selected but visually flagged), **Not found**
  (neutral, no candidate; row has a search field pre-filled with the
  read text).
- When a bounding box came back, a small crop of the photo at that box
  beside the thumbnail, so the player compares what the camera saw with
  what we matched without opening anything.
- In price mode, the YTG price at the end of the row, or "Not sold" when
  `card_prices` has no entry for the key.
- Tap the name or thumbnail to open the printing picker (below). Swipe
  or an explicit remove control deletes the row. Rows are checkboxes;
  all matched rows start checked, "Not found" rows start unchecked.

The tray persists in `sessionStorage` keyed by user id, so a refresh,
a camera app round-trip that evicts the tab, or an accidental back
gesture does not lose work. It is cleared on commit or by **Clear
tray**.

### Printing picker

A bottom sheet (phones) or dialog (desktop) listing every printing of
the matched name from `CARDS`, each with image, set name, legality and
the YTG price when it exists. The current choice is marked. A search
field at the top lets the player type a different name, using
`searchCardNames`. Choosing a different printing or name marks the row
as corrected, which is recorded on commit (see Data).

### Commit

**Add to collection**: a sticky footer with **Add N cards** (N = sum of
quantities of checked rows). On tap, one server action call increments
`collection_cards` quantities for the chosen keys (new rows inserted
with the quantity, existing rows incremented; this is an increment, not
the set-quantity semantics of `setCollectionCardQuantityAction`, so it
is a new action beside it). Success shows the count added and two
actions: **Scan more** (clears the tray, stays on the page) and **View
collection**.

**Price check**: the footer shows the total of checked rows' prices and
a count of unpriced cards. Each priced row's price is a link to the YTG
product, built the same way the Buy Deck modal builds its links from
`shopify_handle`. A **Save as collection** control is present but
secondary, so a player who priced first can still add. Nothing is
written on price check except the scan event.

### What is recorded

On commit, each detection's final outcome is written to its scan event:
the chosen key, whether the player changed the printing, changed the
name, removed the row, or left a "Not found" unresolved. That is the
labelled data E3 lives on.

## Printing disambiguation

Pure function, unit-tested, in `lib/scan/match.ts`. Input: one
detection and the card index. Output: an ordered candidate list, the
default choice, and a reason code.

1. **Name resolution.** Normalise the read text (case, curly quotes,
   trailing punctuation, bracketed set tags the model sometimes includes).
   Exact match on `CARD_BY_NAME_LOWER` wins. Otherwise `searchCardNames`
   top hits; accept the top hit if its score clears a threshold set in
   E0 and it is clearly ahead of the second; otherwise the row is
   **Check this** with the top three as candidates; no hits is **Not
   found**.
2. **Printing selection** among all `CARDS` rows with that name:
   1. If the set hint matches a printing's `set` code, `officialSet`
      name, or a known abbreviation (the `set_aliases` seed plus a
      small map for the model's common renderings), choose it: reason
      `set_hint`.
   2. Else if exactly one printing has a `card_prices` entry, choose
      it: reason `only_priced`, chip **Printing guessed**.
   3. Else choose the most recent printing by set order, preferring
      `legality === 'Rotation'`: reason `newest`, chip **Printing
      guessed**.
   4. In price mode, step 2 is tried before step 3 even when there are
      several priced printings: choose the cheapest priced printing,
      reason `cheapest_priced`, chip **Printing guessed**. A price
      check should not report a promo's price for a common card.
3. **AB reprints.** `hasAbReprint` tells us an original has an alternate-
   art booster twin. Without a set hint the original is chosen and the
   chip reason says "AB version exists". Stage B is what would read the
   frame difference.

Dual-stat and slash-encoded names are looked up through the same
normalisation the deck builder uses; the test fixture includes Lost
Souls with quoted epithets, since those names carry quotes that have
bitten the price matcher before.

## Data

### `POST /api/scan`

Request: `multipart/form-data` with `photo` (JPEG/PNG/WebP/HEIC-converted
JPEG, ≤ 3 MB) and `mode` (`collection` | `price`). Requires a session;
401 otherwise.

Response 200:

```
{
  scanId: string,
  photoQuality: 'ok' | 'blurry' | 'dark' | 'glare' | 'too_many_cards',
  detections: [{
    id: string,
    readName: string,
    readSetHint: string | null,
    confidence: 'high' | 'medium' | 'low',
    bbox: { x: number, y: number, w: number, h: number } | null,
    status: 'matched' | 'check' | 'not_found',
    chosenKey: string | null,
    reason: 'exact' | 'fuzzy' | 'set_hint' | 'only_priced' | 'newest' | 'cheapest_priced' | 'none',
    candidates: [{ key, name, set, officialSet, imgFile, legality, price: number | null, shopifyHandle: string | null }]
  }],
  usage: { model: string, latencyMs: number }
}
```

Errors: 401 no session; 413 too large; 429 daily cap, body says the cap
and when it resets; 502 recogniser failed, body says retryable.

Prices are attached server-side from `card_prices` for every candidate
key in one query, so the client does not download the whole price map.

### Server action `addScannedCardsAction(items)`

`items: { key: string, quantity: number }[]`, capped at 300 rows. Splits
keys into the triple, upserts into `collection_cards` with
`quantity = collection_cards.quantity + excluded.quantity`. Returns the
new totals for the keys so the success state can show them. Also marks
the scan events' outcomes (below) in the same call.

### Migration `121_scan_events.sql`

```
scan_events (
  id uuid pk default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  mode text not null check (mode in ('collection','price')),
  model text not null,
  latency_ms integer not null,
  input_tokens integer, output_tokens integer,
  photo_quality text not null,
  detections jsonb not null,          -- the response detections, minus candidates
  outcomes jsonb,                     -- set on commit: per detection {finalKey, changedPrinting, changedName, removed, unresolved}
  image_url text,                     -- private Blob URL when the player opted in, else null
  image_expires_at timestamptz        -- 30 days after created_at when image_url is set
)
```

RLS: users insert and select their own; `registration_admin` selects
all. Index on `(user_id, created_at desc)`.

### Per-user cap

Before calling the model, count the user's `scan_events` in the last 24
hours. At 150, return 429. The count is one indexed query; no external
store. Admins can raise a user's cap later by a column if anyone ever
hits it legitimately.

### Photo retention (opt-in)

A toggle on the scan page, off by default, remembered in the profile
(one boolean column, or `localStorage` if a profile column is
unwelcome; builder's call, stated in the plan): "Keep my scan photos for
30 days to help improve the scanner." When on, the downscaled photo is
written to a **private** Blob path `scans/<user>/<scanId>.jpg` and the
URL and expiry stored on the event. A weekly cron deletes expired blobs
and nulls the columns. The sign-in gate and the toggle copy both say
photos are sent to our recognition provider and otherwise not kept.

## The Claude call

In `lib/scan/recognize.ts`, server only.

- One `messages.create` with the image as a base64 block followed by a
  short instruction. Model id from one constant, baseline
  `claude-opus-5-5`, `output_config.effort: 'low'`, adaptive thinking
  left at its default.
- Structured output via `output_config.format` with a JSON schema for
  the response shape above (detections with read text, set hint,
  confidence, bbox, plus photo quality). No tool use, no forced tool
  choice.
- The system prompt is fixed text and short: what a Redemption card looks
  like (title band at top, set icon bottom-left or bottom-right, promo
  markings), that the model must transcribe the title exactly as
  printed and must not guess a card it cannot read, that spreads are
  read in reading order, and that bounding boxes are optional and
  normalised. Fixed text first so prompt caching applies when the prefix
  is long enough to cache; the image is last.
- `max_tokens` 4000. Timeout 30 s. One retry on a 5xx or timeout. On a
  `refusal` stop reason, treat as a 502 with a plain message.
- The response is validated against the schema before matching; invalid
  JSON is a 502 and is logged with the request id.
- Usage tokens and latency go on the scan event.

## Evaluation: continuous, with gates

The recogniser is a probabilistic component inside a deterministic app.
It gets measured at every stage, and the measurement is the same shape
every time: a folder of photos, a labels file of expected card keys per
photo, a script that prints a table.

### The photo set (and the answer to "do you need loads of pictures")

No. Forty photos is enough to start, taken on Tim's own phone in the
conditions real players will use:

| Bucket | Count | What's in it |
|---|---|---|
| Single, easy | 12 | one card, flat, daylight or room light, mix of eras and types including a Lost Soul and a Site |
| Single, hard | 8 | sleeved, glossy glare, foil/holo, angled 20°+, old-frame printing, promo, a card with an AB twin |
| Spread, small | 8 | 4 to 8 cards flat with gaps |
| Spread, medium | 6 | 9 to 12 cards |
| Spread, abuse | 3 | 20 to 30 cards (we expect these to fail; we want to see how) |
| Not a card | 3 | a hand, a table, a different game's card |

Labels are the expected card keys per photo in reading order, written
once in `scripts/scan-eval/labels.json`. The photos live in
`scripts/scan-eval/photos/`, git-ignored, with a copy in a private Blob
folder so a worktree can fetch them. Growth after launch comes from
opted-in scan photos plus their recorded corrections, which arrive
already labelled. Synthetic augmentation of the Blob card images
(perspective warp, glare overlay, blur) is a cheap extra for regression
tests of the matcher's robustness, but it does not replace real photos
for the gate.

### E0: feasibility gate, before any product code

Half a day. `scripts/scan-eval/run.ts` sends every photo to each of Opus
5.5, Sonnet 5.5 and Haiku 5.5 with the production prompt and schema,
runs the matcher, and prints per model: name top-1 accuracy on singles,
per-card recall and precision on spreads, printing accuracy where the
photo shows a set marking, bounding-box usefulness (does the crop
contain the right card), latency p50/p95, cost per photo, and failure
reasons.

Gate to proceed with Stage A as designed, on the best model:

- ≥ 90% name top-1 on single, easy
- ≥ 75% name top-1 on single, hard
- ≥ 85% per-card recall on spreads up to 12 with ≤ 1 false card per
  photo
- "Not a card" photos produce zero detections

If the gate fails on names, the flow changes before building: the UI
asks for one card per photo and crops to the title band; or Stage B is
pulled forward. If it fails only on printing, ship as designed with the
guessed-printing chip and plan Stage B. The decision and the numbers go
in this document's review log.

### E1: during the build

- `lib/scan/match.ts` has golden tests from recorded E0 model outputs:
  the model's JSON is saved per photo, so the matcher is tested against
  real transcriptions without an API call.
- Each PR that touches the prompt, schema or matcher re-runs the eval
  script on the saved outputs (free) and, when the prompt changed, on
  the live API (cents).

### E2: before launch

- Re-run E0 through the deployed `/api/scan` on a preview URL, not the
  script, so the downscale and upload path is measured too.
- Manual pass per the `verify` skill on an iPhone-sized and an Android-
  sized viewport, plus one real phone of each, covering: camera capture,
  multi-select from photos, a 10-card spread, a correction through the
  picker, a refresh mid-tray, commit, the 429 message, and the signed-
  out gate.

### E3: after launch, continuously

- An admin view at `/admin/scans` (small, table-only) over `scan_events`:
  scans per day, correction rate (any outcome field set), not-found
  rate, printing-change rate, p50/p95 latency, estimated cost per day,
  and a list of the most-corrected read names. The same numbers are
  what the weekly look at the Console's spend page should agree with.
- The correction set becomes the growing eval set: a script exports
  events with outcomes (and opted-in images) into the eval folder
  format.
- A model or prompt change ships only when it beats the current one on
  the full eval set, and the comparison is pasted into the PR.
- Review cadence: weekly for the first month, then monthly.

### Kill and pivot criteria

- Correction rate above 30% in the second week after launch: pause the
  "Scan cards" button to a "beta" label and pull Stage B forward or
  change the capture flow.
- Spend trending above $60 in a month: lower the per-user cap and move
  to the cheapest model that passed E0.

## Probability estimates

These are my estimates before E0, to be replaced by measurements. They
are about this design in this app, not about vision models in general.

| Claim | Estimate |
|---|---|
| Best model clears the single-easy gate (≥ 90% name top-1) | 85% |
| Best model clears the single-hard gate (≥ 75%) | 70% |
| Best model clears the 12-card spread gate (≥ 85% recall, ≤ 1 false) | 60% |
| 20 to 30 card spreads are usable without splitting | 25% |
| Printing correct without a visible set marking, by the rules above | 55% |
| Haiku 5.5 alone clears the single-easy gate | 55% |
| Sonnet 5.5 clears every gate Opus 5.5 clears | 65% |
| Bounding boxes are good enough to show crops | 50% |
| Monthly spend stays under the $100 credit in the first three months | 95% |
| v1 ships within four agent-days after this spec is approved, given the 40 photos | 70% |
| Players use the scanner more than CSV import within a month of launch | 75% |
| Stage B is needed within three months | 40% |
| A per-user cap of 150 photos a day is ever hit by an honest player | 10% |

## Files

- `app/collection/scan/page.tsx`: auth gate, metadata, renders the client.
- `app/collection/scan/client.tsx`: mode, capture, photo list, tray, commit.
- `app/collection/scan/components/`: `CaptureButtons`, `PhotoCard`,
  `DetectionRow`, `PrintingPicker`, `CommitBar`.
- `app/collection/scan/hooks/useScanTray.ts`: tray state with
  `sessionStorage` persistence.
- `app/collection/actions.ts`: add `addScannedCardsAction`.
- `app/api/scan/route.ts`: auth, size check, cap check, call recogniser,
  match, attach prices, write event.
- `lib/scan/recognize.ts`: the Claude call and schema validation.
- `lib/scan/match.ts`: pure name resolution and printing selection.
- `lib/scan/schema.ts`: the JSON schema and TypeScript types shared by
  route, script and tests.
- `lib/scan/__tests__/match.test.ts`: golden tests from recorded outputs.
- `scripts/scan-eval/run.ts`, `labels.json`, `photos/` (git-ignored),
  `outputs/` (recorded model JSON, committed).
- `supabase/migrations/121_scan_events.sql`.
- `app/admin/scans/page.tsx`: the E3 table.
- `app/api/cron/purge-scan-images/route.ts` plus a `vercel.json` cron
  entry, weekly.

## Testing

- `lib/scan/match.ts`: name normalisation cases (quotes, brackets, case,
  slash names, Lost Soul epithets), exact and fuzzy thresholds, every
  printing rule and reason code, AB-twin handling, price-mode ordering,
  and the full golden set from E0 outputs. Vitest, node only.
- `app/api/scan/route.ts`: a unit test for the cap check and size check
  with the recogniser stubbed; `tsc` clean.
- The eval script is itself the integration test for the recogniser and
  runs in E0, E1 (saved outputs), and E2 (deployed route).
- Manual E2 pass as above.

## Rollout

1. E0 with the 40 photos; record the numbers in the review log; pick the
   model.
2. Build behind no flag: the page is new and linked only from
   `/collection`.
3. Apply migration 121 before merging the route.
4. E2 on the preview URL; merge; one What's New line.
5. E3 weekly for a month.

## Calls I made (for review)

1. Server-side vision over on-device OCR, for the reasons in Recognition.
2. The model transcribes; the app matches. The model never chooses a
   `card_key`.
3. Sign-in required for both modes in v1, because the anonymous rate
   limiter is dead and the credit is finite.
4. Per-user cap of 150 photos a day in Postgres, not Redis.
5. Printing default order: set hint, then only priced, then newest; in
   price mode, cheapest priced before newest.
6. A guessed printing is always marked, never silent.
7. The tray lives in `sessionStorage`, not in Postgres.
8. Photos are not kept unless the player opts in; opted-in photos live in
   private Blob for 30 days.
9. `/collection/scan` as a route, not a modal on `/collection`, because
   the camera round-trip can evict a tab and a route restores cleanly.
10. Collection commit increments quantities rather than setting them.
11. The admin E3 view is a plain table, not charts.
12. Opus 5.5 is the baseline and the model is chosen by E0, not by taste.

## Left to the builder

- Exact fuzzy-match thresholds (set from E0 outputs).
- The set-hint abbreviation map beyond the `set_aliases` seed.
- Whether the retention toggle is a profile column or `localStorage`.
- Component split inside the client as long as the listed pieces exist.
- Downscale implementation details (canvas vs `createImageBitmap`),
  provided EXIF orientation is honoured on iOS.
- Copy, within the design system's tone.

## Adversarial review log

To be filled after review: each reviewer's material findings, what
changed in this document in response, and what was rejected with the
reason.
