# Deck photo import — design

Date: 2026-10-29. Status: draft for Tim's approval.

Builds on the card scanner (`docs/superpowers/specs/2026-10-26-card-scanner-design.md`,
shipped in #538–#546). Everything the scanner spec settled about the Claude call,
the matcher, caps, events, privacy and the capture path holds here unless this
document says otherwise. Read that spec's *Constraints*, *Recognition*, *Data*
and *Retention and privacy* sections first.

## Intent

Players photograph a deck laid out on a table: cards fanned into overlapping
columns, usually one column per brigade or type, often with the reserve in a
separate row, sometimes sideways. These photos get posted to Discord and
Facebook after tournaments. Today the only way to get such a deck into Land of
Redemption is to type it in.

The feature: give the site that photo (your own, or one saved from a post),
get a decklist back, fix the few cards it could not read, pick the Lost Souls,
and open the result in the deck builder.

Why now: the scanner built the machinery (one Claude vision call, a matcher
from read text to a printing, caps, event logging, a privacy page). A spike on
2026-10-29 showed that a clean deck photo gives a complete and correct 50-card
list from one call for about four cents. The remaining work is a different
prompt, a decklist-shaped collapse, a Lost Soul picker, and a page that hands
the result to the deck builder.

## Correcting what was read

Tim's requirement, stated up front: fixing a wrong read must be very easy.
The page is built around the player checking the list against the photo and
fixing it in place, not around trusting the model. Misreads come in six kinds
and each has a one- or two-tap fix:

| Wrong | Fix | Taps |
|---|---|---|
| Wrong card (misread title, fuzzy hit, Not found, Unread) | Tap the name; the picker opens in search mode with the read title in the field and up to five suggestions ranked by similarity above the results; tap one | 2 |
| Wrong count (a duplicate missed or doubled) | − and + beside every quantity; the number opens a stepper | 1 |
| A card missed entirely | *Add a card…* at the end of every group, the same search | 2 |
| Wrong zone (reserve read as main, or the reverse) | The group's Main deck / Reserve toggle; a row's ⋯ menu moves one card | 1 |
| A card that is not in the deck (invented, or a stray on the table) | ⋯ → Remove, or swipe; a 5 s *Undo* toast | 1 |
| Wrong printing | ⋯ → Change printing, the scanner's picker | 2 |

Rules the design follows everywhere:

- **See what it saw.** Each group section opens with a strip: the group's own
  crop from the photo, rotated upright, beside the rows in the same top-to-
  bottom order, so the column and the list read together. Where per-card
  title-band boxes prove reliable in E0, a row's thumbnail is the crop of that
  card's title band from the photo rather than the catalog image (the catalog
  thumb one tap away); until then the catalog thumb and the strip. Tap the
  strip to see it large. Crops are cut on the client from the photo still in
  memory, so no photo is stored anywhere; after a reload they are gone and
  the section says *Photo 1*, as the scanner does.
- **Amber rows stand out.** Check this, Not found and Unread rows carry a
  2 px amber left edge as well as the chip, so they are visible while
  scrolling, and the totals line's *3 to check* is a button: each tap scrolls
  to the next amber row and focuses it, so the player clears them in order
  without hunting.
- **Undercounts are visible.** The model estimates each group's size as well
  as reading its cards; when the two differ the group header says *Read 8 of
  about 9*, so a missed card is a prompt to use *Add a card…*, not a surprise
  in the builder.
- **The field is ready.** Any search opens with the read title selected and
  the keyboard up, so typing replaces it and a suggestion tap needs no typing.
- **Keyboard on a laptop.** Rows are focusable; Enter opens the picker, + and
  − change the quantity, Delete removes, arrow keys move. Posted photos get
  fixed on a laptop as often as on a phone.
- **The builder is the full editor.** Anything not worth fixing here is fixed
  after *Open in deck builder*; corrections here are for speed, and the
  hand-off never blocks on them except for one confirm when cards are left
  out.
- **Corrections are data.** Every name change, printing change, quantity
  change, zone move, removal and addition is written as that read's outcome;
  the E3 query *most-corrected read titles* feeds prompt and matcher fixes.

## What the spike showed

Four player-supplied deck photos, the spike script (`tmp/spike-deck-photo.ts`
on Tim's machine, to be copied into the eval harness in PR 1), one call per
photo, then the scanner's `matchDetection` on each title-only read.

| Photo | Cards found | Not in catalog | Notes |
|---|---|---|---|
| 2048 px, sharp, six fanned columns, 50 cards | 50 of 50 on all five runs (Sonnet 5.5 low ×3, medium, Opus 5.5 medium); identical lists | 0 | Still 50 found after downscaling to 1024 px, one misread |
| 1024 px, Star Wars mat, 55 cards, a sideways row | 53–55 | 2–5 | The sideways row is where the misses are |
| 1024 px, dark, a sideways top row of 11 | 61 on every arm | 12–18, all in the sideways row | Opus reports them as `unknown`; Sonnet at low effort invents plausible names ("Fresh Bread", "The Mattithiah") |
| 1024 px, dark, a sideways top row | Sonnet low: 19, 23, 37 on three runs. Sonnet medium: 59. Opus medium: 61 | 11 | Sonnet at low effort gives up part way with a clean `end_turn` |

Other measurements:

- Cost and latency per photo: Sonnet 5.5 ≈ $0.04 and 16–20 s; Opus 5.5 medium ≈
  $0.09 and 23–33 s, not more accurate than Sonnet medium.
- Cropping the sideways row, rotating it and upscaling 3× recovered 9 of its 10
  cards across the two arms, even though the crop came out upside down.
- Every "check" row across all twelve runs was either a Lost Soul (only "Lost
  Soul" is visible when fanned; 7–8 per deck) or a same-title tie. The ties
  are different cards with one title: Forest Fire (FooF) and Forest Fire
  (Roots) share title, type, brigade and verse but not their ability, so
  the identity index rightly keeps them apart (checked while planning: the
  spike's "brigade spelling" reading was wrong, and the scanner's own test
  "a reprint with a different ability stays its own card" pins it); Amariah,
  the High Priest (Roots, Clay, Rotation) and Amariah the High Priest
  (Priests, Teal, not Rotation) differ in brigade.
- Duplicates were counted right (2× Abner, 2× Forest Fire, 7× Lost Soul).

## Amendments after E0 (2026-10-29)

PR 1 (#549) and PR 2 (#550) were built from this document; E0 ran through
#550's preview with labels for the four spike photos. What it found changes
four things below, and this section wins where the older text disagrees.

**The spike counted entries, not correct cards.** Its "61 found" on the dark
photos included Not found and Unread rows and same-title ties; identity-level
recall was never measured. Labeled, the dark photos are 51 cards each with
1–2 unreadable.

**Effort medium truncates the list.** On the dark photos at effort medium the
model returned only the fully visible card at the end of each column plus
the Lost Souls (15 and 13 of 61 reads) in 15 of 20 runs across five
instruction wordings, including the spike's; its own group `cardCount` was
right, so it knew the cards were there. Effort high listed every card in 8
of 8 runs. **Deck mode runs at effort high** with an 80 s per-call timeout.
Low is unusable (invents names).

**Gate results at effort high, through the preview** (deck recall counts
identities; "wrong" is a Matched row whose identity is not in the photo):

| Photo | Precision | Recall | Wrong | Reserve default | Latency | Cost |
|---|---|---|---|---|---|---|
| Sharp 2048 px, 43 cards + 7 Lost Souls | 1.00 | 1.00 | 0 | ok | 61 s | $0.115 |
| Star Wars mat, 1024 px | 1.00 | 0.92 | 0 | wrong | 41 s | $0.082 |
| Dark 1024 px, sideways reserve (1) | 0.83 | 0.56 | 6 | ok | 42 s | $0.081 |
| Dark 1024 px, sideways reserve (2) | 0.77 | 0.53 | 8 | ok | 56 s | $0.102 |

Sideways rows are reported `rotated_ccw` on both dark photos after the
instruction spelled out what each orientation looks like. Dark-photo recall
is capped by covered title bands at 1024 px: 10–12 reads per photo come back
with a null title. That is PR 3's job.

**Group strips are off** (`SHOW_GROUP_STRIPS = false`): group boxes passed
on 26 of 29 groups but cut off cards on 3 of 7 on the sharp photo, which
fails the box check above. Title boxes were on the right card 93% of the
time, so per-card title crops as row thumbnails are a cleared follow-up.

**PR 3 is a crop pass over the groups that need it, not only rotated ones.**
*Superseded by* Amendments after PR 3 *below: what shipped crops sideways
groups only, sized to the high tier's patch budget.*
Measured on the dark photos with the first-pass groups: re-reading each
group from a crop padded by 4% of the image, rotated upright, upscaled to a
1600 px long edge, keeping a read only when its `titleBox` centre falls
inside the group's box (upright groups; rotated groups keep every read),
takes recall from 0.56 / 0.53 to 0.79 / 0.80 at precision 0.80, for +$0.13
and +8 s per photo with the eight crops in parallel. Effort medium reads a
crop as well as high (0.78 vs 0.79), so crops run at medium. Two dead ends,
recorded so nobody repeats them: a 12% pad pulls whole neighbouring columns
into each crop and triples the reads (precision 0.33); and a groups-only
first pass cannot see orientation at any effort (every row `upright`, 378
output tokens at medium and at high alike), so the whole-photo read stays.
Eight parallel crop calls produced connection errors on two of four
photos: the pass runs four at a time with one retry. The crop trigger per
group: any null-title read, fewer reads than `cardCount`, or an orientation
other than upright. The sharp photo triggers nothing and keeps its $0.115;
a dark photo costs about $0.22 and 50–70 s in all. `maxDuration` rises to
150 s (Vercel's default is now 300 s) and the client's request timeout to
170 s; the "first pass under 50 s" gate is gone.

The remaining dark-photo errors (about nine wrong names and two Lost Soul
miscounts per photo) are misreads of 1024 px title bands, which the
correction design exists for; the eval set needs posted photos from Discord
to size that rate for real.

## Amendments after PR 3 (2026-10-30)

PR 3 (#552) and its follow-up (#553) shipped a narrower crop pass than the
paragraph above. This section wins where the older text disagrees.

**Only sideways or upside-down groups are cropped.** Re-reading upright
groups at effort medium was net negative against the effort-high first
pass in two replays: it lost as many hits as the sideways crops gained, and
forcing all eight groups of each dark photo through the pass left recall
flat (0.558 / 0.549) at lower precision. The 0.79 / 0.80 above did not
reproduce; that experiment's gain came from its one large sideways crop.
`needsCrop` is `orientation !== 'upright'`, never for group 0. Null-title
reads and short groups in an upright group stay as Unread rows.

**Crops fill the high tier's patch budget** (`fillToTier(..., 'high')`,
4,784 patches) instead of a fixed 1600 px long edge; `CROP_EDGE` is gone.
Pad 4%, effort medium, the crop prefix, the 1.5% title-box filter for
upright groups, four in flight, at most 12 groups and one retry are as
written.

**The pass runs against a hard deadline**, `requestStart + 140 s`, 10 s
under `maxDuration` 150. A worker starts no crop with under 12 s left
(those groups are `skipped`); each call's timeout is `min(30 s, time
left)`, and it retries only when a full second attempt still fits. A crop
that returns nothing for its group, errors, times out or is skipped keeps
the first-pass reads (`failed` / `skipped` in the response's `crops`); a
crop never deletes a group's cards. A repeated group id is cropped once.

**The route infers sideways rows the first pass called upright** (#553).
`inferSidewaysRows` measures each upright group against the median width of
the photo's upright columns (one card's short side). A group wider than it
is tall, and no taller than 1.2× that width, is set to `rotated_ccw`; a row
of upright cards side by side is about 1.4×. The box cannot show which way
the cards face, so the rule takes `rotated_ccw`, the one in every eval
photo. No upright column, no change. It runs before the crop pass, so the
response's groups and the Reserve default see the correction.

**The scorer matches by identity stem, not printing.** Under the old
printing-exact scorer part of the dark-photo gap was the scorer: the PR 2
baseline re-scores from 0.56 / 0.53 to 0.635 / 0.686 recall.

**Results** (P / R, identity scorer, through the preview unless noted):

| Photo | PR 2 baseline | #552 (E0 v2) | #553 (replay) |
|---|---|---|---|
| Sharp | 1.00 / 1.00 | 1.00 / 1.00 | unchanged, no crops |
| Star Wars mat | 1.00 / 0.92 | 1.00 / 0.90 | 1.00 / 0.94 |
| Dark 1 | 0.94 / 0.64 | 0.94 / 0.58 | 0.95 / 0.73 |
| Dark 2 | 1.00 / 0.69 | 1.00 / 0.80 | unchanged |

A crop costs about $0.01–0.02; a photo with a sideways row adds one or two
crops and a few seconds, and a photo without one costs what the first pass
costs ($0.08–0.12, 41–61 s). Known misses: on the Star Wars mat the crop's
padding catches one extra untitled card, so the Reserve default is off by
one row; dark 1's upright columns stay at first-pass recall. Both point at
the same next levers: per-card title crops (cleared above) and posted
photos from Discord to size the misread rate on real tables.

## Amendments after the Discord photo eval (2026-10-30)

Tim supplied 55 deck photos posted on Discord; two were 32 px blurs and
were dropped. All 53 ran through production at `9c14862f` (source eval,
$5.58 in all, no errors or timeouts, 37 s mean). Eight were labeled by hand
from zoomed tiles and catalog lookups, without seeing scanner output, so
the labeled set is now 12. This section wins where the older text
disagrees.

**Resolution decides most of it.** Identified rows (matched, which, read
as, Lost Soul) over the model's own card count, unlabeled:

| Long edge | Layout | Photos | Identified | Unread share | Cost | Time |
|---|---|---|---|---|---|---|
| 1500 px and up | upright | 8 | 0.85 | 0.10 | $0.105 | 55 s |
| 1500 px and up | turned | 6 | 0.71 | 0.26 | $0.228 | 55 s |
| 1000–1499 px | upright | 27 | 0.50 | 0.30 | $0.071 | 36 s |
| under 1000 px | upright | 3 | 0.34 | 0.23 | $0.057 | 19 s |
| under 1000 px | turned | 9 | 0.03 | 0.92 | $0.143 | 18 s |

Most of these are Discord's shrunken copies; a phone upload reaches the
route at up to 2576 px. On the six labeled photos at 1500 px and up,
production scored P 0.97 / R 0.95 on the four upright ones (1.00 / 1.00,
0.96 / 0.91, 0.98 / 0.98, 1.00 / 0.98) and 0.93 / 0.79 and 0.92 / 0.89 on
the two turned ones.

**Four failure modes.**

1. *Turned photos.* 15 of 53 were taken with the phone held across the
   layout, so every card lies sideways. Every group is then cropped, the
   padded crops overlap, and cards come back twice: `IMG_4649` returned 111
   rows for 71 cards. At phone size a turned photo cost $0.23 and 55 s.
2. *The first pass gives up.* On 10 photos it listed groups and their
   `cardCount` but under half their cards, often none: `IMG_3044` returned 0
   of 71 in 4 s for $0.01. Nine are 1280 px or smaller; the one at phone
   size is blurry.
3. *Nested groups.* Six pairs of group boxes overlapped by more than half
   the smaller one, three by 80% or more; cropping both reads the inner
   group's cards twice.
4. *Small photos.* Under 1000 px a turned photo identified 3% of its cards
   and still paid $0.14 for crops.

**Turned photos are read again upright** (`lib/scan/turnPass.ts`). When at
least 75% of the photo's cards, and at least 20 of them, lie in groups of
one sideways direction, the photo is turned upright and read again at
effort high before the crop pass; the turned read replaces the first. A
sideways Reserve row (10–17% of the cards) never qualifies; on the eval set
the rule fired on exactly the 15 turned photos, and no other photo scored
above 0.46. The re-read starts only with at least 60 s left before the
140 s deadline and is timed to end by it; a failure, or a read with
neither groups nor cards, keeps the first read, and its tokens and cost are
billed either way. A read that lists groups but no cards is kept, because
the crop pass reads short groups. The response carries `rotation`
(clockwise degrees, 0 when the first read stands), and its groups and
title boxes are in the turned frame; the group strips (still off) would
have to turn the photo to match.

Against production's crop-every-group path on the six turned photos at
phone size (turn pass replayed on production's recorded first read, so its
cost and time leave that read out):

| Photo | Production | Turn pass, after the first read |
|---|---|---|
| `20240804_163529` (labeled) | P 0.93 / R 0.79, 66 rows for 61, $0.27, 68 s | P 0.95 / R 0.76, 61 for 61, $0.09, 46 s |
| `IMG_2745` (labeled) | P 0.92 / R 0.89, 78 rows for 62, $0.27, 79 s | P 0.96 / R 0.87, 61 for 61, $0.11, 59 s |
| `IMG_3165` | 56 rows for 52, $0.23, 62 s | 51 for 51, $0.09, 46 s |
| `IMG_4649` | 111 rows for 71, $0.37, 78 s | 69 for 69, $0.11, 52 s |
| `20231121_094623` (labeled, blurry) | P 1.00 / R 0.06, 5 rows for 60, $0.03 | P 0.85 / R 0.22, 60 rows, $0.19 |
| `SPOILER_IMG_…` (labeled, blurry: 35 of 68 unreadable by hand) | P 0.80 / R 0.19, 70 rows for 55, $0.20 | P 1.00 / R 0.19, 66 rows, $0.24 |

Precision rises and recall dips by about the first pass's run-to-run
spread, and the rows a player has to delete mostly go away. The sideways
first read still runs, so end to end the turn pass costs time: through a
local dev server `IMG_3165` took 109 s and $0.19, against production's
62 s and $0.23. A turned photo now waits about 45 s longer for a clean
list. On `20231121_094623` the first read gave the wrong direction
(`rotated_ccw`; the cards need 270°), so the photo was turned upside down
and the re-read gave up; the short-group crops below recovered a quarter
of it. (Fixed by a second turn: *Amendment: a turned read that is still
turned is turned again*.)

A cheap probe could skip the sideways read: one call at the low tier and
effort low, $0.003 and about 2 s, asking which way the cards face. On all
53 photos it never called an upright photo turned (0 of 38) and caught 11
of the 15 turned ones, but disagreed with the full read's direction on 7 of
those 11; where the direction could be checked the full read was right,
except on `20231121_094623`. (Counts corrected 2026-10-30: an earlier
version of this section said 19 turned photos.) A
probe that knows sideways but not direction does not yet save the read;
that is the next experiment.

**An upright group the first pass listed short is cropped.** `needsCrop`
is also true for an upright group of 3 or more cards with fewer first-pass
reads than half its `cardCount`. The finding above (upright crops net
negative) was measured on groups the first pass had read in full; this
trigger does not reach those. Replayed on the eight photos with short
groups at 1280 px or smaller (unlabeled), it took them from 174 to 537 rows
and from 80 to 162 identified for $0.95; 219 of the 363 new rows are
Unread, which is what those cards are at that size. It is
also how a turned read that gave up (the two blurry photos above) gets its
cards.

**A group nested in a cropped group is absorbed.** A group with at least
80% of its box inside a bigger group that will be cropped is not cropped
itself; when the bigger crop comes back, the nested group's reads are
dropped and the route leaves it out of `groups` (`crops.merged` lists it).
A failed or skipped container leaves it as read.

**A row the frame cuts off is not inferred sideways.** `inferSidewaysRows`
skips a group whose box reaches within 1% of the top or bottom edge: a cut
row of upright cards looks one card-width tall. Once turned, `IMG_2745`'s
Reserve row ran along the top edge; inferred sideways, its padded crop
pulled in the column tops below (17 reads for 10 cards).

**Small photos say so.** The response carries `imageSize`, the size of the
image read. Under a 1500 px long edge the done line reads *Small photo: the
full-size original reads better* in place of the quality note.

**Known misses.** The Reserve default was right on 2 of the 6 sharp labeled
photos at phone size (0 of the 2 blurry ones): a Reserve along the top of
the photo (the default takes the last group), a Reserve fanned in two
groups, a 2-card pair in the middle of the list, and a row of tokens laid
after the Reserve. Giving
`defaultReserveGroup` the group boxes is the next lever. Heavenly Host
tokens and art cards come back as Not found and Unread rows to delete.

## Amendment: the Reserve default reads the layout (2026-10-30)

`defaultReserveGroups` (was `defaultReserveGroup`) takes each group's box
and how many of its reads name a card, and can default several groups to
Reserve. On one photo where every group has a box:

1. The **main band** is the set of columns side by side (within 5% of the
   width, overlapping under half the narrower) whose tops chain within 6% of
   the height, so a tilted photo's drifting tops stay one band; the set with
   the most cards wins.
2. Groups off the band are joined into **rows** (overlapping in height by
   over half the shorter, within 5% side to side). The largest row that fits
   is Reserve (fits: the rest is at least 50 and the row is within the
   reserve size the rest implies), a later row winning a tie.
3. Else the last single group off the band that fits.
4. Else the old rule (the only sideways group, else the last group) over the
   band and the off-band groups that read a card.

An off-band row that names no card (tokens, art cards, a Lost Soul row) is
never Reserve. Across photos, or with a group missing its box, the old rule
applies as before.

Which group the Reserve is, judged from the photos (the scorer only checks
the size): the old rule was right on 6 of the 12 labeled photos, the new one
on 10. The misses are a 2-card Reserve set in the middle of a grid
(`IMG_9796`) and the photo the turn pass left upside down
(`20231121_094623`). On the 38 upright Discord photos (4 of them labeled)
the two rules differ on 11: the new one is right on 9 by eye (a row of 10
below the columns, a Lost Soul row passed over, token rows passed over; one
of the 9 is the labeled `20240622_125334`), and 2 are unclear. The scorer's size check now reads 6 of 8 on the Discord recordings
(was 2) and 3 of 4 on the turn-pass recordings (was 0).

## Amendment: a turned read that is still turned is turned again (2026-10-30)

The first read often has the direction wrong. Run on all 15 turned
Discord photos, the turn pass's re-read came back with its groups
`upside_down` on 6, among them every photo the first read called
`rotated_ccw`; each of those re-reads gave up in 3–4 s with no cards, and
the crop pass then cropped every group turned 180°, the overlapping-crops
problem the turn pass exists to avoid.

`runTurnPass` now checks the re-read the same way it checked the first
read: when `wholePhotoTurn` of the re-read's groups is not 0, the
original photo is turned by the sum and read once more (`MAX_TURNS` 2),
under the same 60 s rule. A failed or empty second read keeps the first
re-read; `rotation` is the final turn. On a correctly turned photo the
re-read's groups are upright and no second call is made.

Replayed through the route's passes on the 6 photos (the other 9 are
unchanged by construction): all 6 end at 270°. On the labeled
`20231121_094623` (blurry, 2048 px) precision 1.00 and recall 0.37, no
crops, 65 rows for 60 cards, $0.10 and 48 s, against 0.85 / 0.22 with
crops at $0.19 before; the other 5 are under 1000 px and stay mostly
Unread either way. Its Reserve default is still wrong: the Reserve row's
cards show only their edges, so every read is Unread and the row names no
card, which the Reserve rule passes over (as it must for token rows).

## Vocabulary

- **Deck photo**: a photo of a laid-out deck. Cards overlap so that only the
  title band and, on characters, the strength/toughness box are visible. One
  card at the end of each column is usually fully visible.
- **Group**: one visually separate run of overlapping cards: a column, a fan,
  a row. The model reports groups; the page assigns a zone (main or reserve)
  per group.
- **Read**: what the model transcribed for one physical card. A read with a
  null title is an **unread card**: the model saw a card and could not read
  it.
- **Identity**, **printing**, **stem**: as in the scanner spec. A deck needs
  the identity; a legal printing is chosen for it.
- **Lost Soul placeholder**: a counted but unidentified Lost Soul.

## Scope

**v1.0:**

- `/decklist/scan`: take a photo, choose photos, drop, paste.
- `POST /api/scan` with `mode=deck`: the deck instruction and schema, Sonnet
  5.5 at effort high, reads grouped, a turned photo read again upright, a
  second pass over sideways and short groups.
- Collapse to a decklist: one row per card name, quantities summed, a
  Rotation-legal printing chosen; Check this, Not found and Unread rows; Lost
  Soul placeholders.
- Correction in place: group strips from the photo, suggestion-first search,
  − and + on every row, *Add a card…* per group, ⋯ menu (move, remove, change
  printing), undo on remove, *to check* walker, keyboard on desktop. Per-card
  title-band crops as row thumbnails if E0 proves the boxes.
- Groups with a Main deck / Reserve toggle and a sensible default.
- The Lost Soul sheet: pick the deck's Lost Souls in one place.
- Open in deck builder (creates the deck and opens it) and Copy as text.
- Outcomes recorded on the scan events; one sentence on `/privacy`.
- A labeled set of deck photos and a scorer in the eval harness.

**v1.1:**

- Lost Soul sheet ordered by how often each appears in public decks.
- Printing preference for a printing the player owns.
- Paste an image URL (fetch server-side from an allowlist of CDNs).
- "Add missing cards to my Wants" after hand-off, when a collection exists.
- Desktop table layout.

## Goals

1. A sharp, upright deck photo gives a decklist whose identities are at least
   95% right and complete, with every miss visible as a row. Never silent.
2. A 50–60 card deck goes from photo to deck builder in under two minutes of
   the player's time, Lost Souls included.
3. Every misread is fixable in at most two taps from its row, with the photo
   evidence beside it (*Correcting what was read*).
4. Nothing invented. An unreadable card is an Unread row, not a guess.
5. At most $0.06 per photo for a Type 1 deck, inside the scanner's caps and
   spend ceiling.
6. Every scan leaves evaluation data (reads, outcomes), as the scanner does.

## Non-goals

- Exact printing identification. The deck builder needs a printing, but any
  legal one serves; the scanner's printing filters run but their result is a
  default, not a question.
- Reading ability text, references on fanned cards, or set icons.
- Identifying a fanned Lost Soul from the sliver of art. Players pick.
- Photos of sleeved stacks, binder pages or single cards (the scanner's job).
- Video, live camera preview, OCR.

## Anti-goals

- Inventing cards. Sonnet at low effort did; the design rules it out by effort
  and by instruction.
- Creating decks nobody asked for: no auto-save until the player taps Open in
  deck builder.
- Spending the shared monthly credit on a flood of Type 2 photos: the scanner's
  per-user and global caps apply unchanged.
- A second UI vocabulary. Chips, picker, capture buttons and copy tone come
  from the scanner.

## Constraints

- Everything in the scanner spec's *Constraints*: the dedicated
  `SCANNER_ANTHROPIC_API_KEY` in the Max org (overrun is an outage, not a
  bill), the 4.5 MB Vercel body cap, caps enforced in Postgres so scanning
  needs sign-in, mobile first, green the single accent.
- **Most deck photos are not the player's own.** Discord and Facebook
  re-encode to about 1024 px on the long edge, and the lighting is whatever
  the venue had. Design for 1024 px and poor light; a 4000 px phone original
  is the easy case.
- **Fanned cards show the title band and stats box only.** The reference,
  ability, corner code and credit are hidden on every card but the last in a
  column. Lost Souls show only "Lost Soul".
- **Sideways rows are common.** Two of the four spike photos had the reserve
  laid sideways along one edge. The first pass cannot read them; a crop can.
- **Effort high is required for the whole-photo read.** Sonnet 5.5 at low
  effort returned 19, 23 and 37 cards on three runs of the same ~60-card
  photo; at medium it lists only the fully visible cards on dark photos
  (*Amendments after E0*). Crops read fine at medium.
- **Output grows with the deck, and the scanner's timeout is too short for
  it.** About 60 reads cost 3.1–4.5k output tokens and 16–20 s; the
  recognizer's client timeout is 25 s, sized for a 2–9 s collection scan. A
  140-card Type 2 deck needs about 10k tokens and 40 s. `max_tokens` 16k
  covers roughly 230 reads; the recognizer's retry at 32k would run past the
  function budget and is not used in deck mode.
- **The deck builder stores a printing per card.** `saveDeckAction` takes
  rows of `card_name`, `card_set`, `card_img_file`, `quantity`, `zone`;
  a `Candidate` carries `name`, `set`, `imgFile`, so the mapping is direct.
- **Deck rules** as the validator enforces them (`lib/formats.ts`, which
  `checkDeck` uses; `prompt_context/redemption_deck_rules.md` lists wider
  tournament ranges and the code wins): Type 1 (Limited, Unlimited, Teams)
  is 50–70 main cards with a reserve of up to 10; Type 2 is 100–140 with a
  reserve of up to 20; Lost Souls required per main-deck size (7 for 50–56);
  Dominants and Lost Souls cannot be in the reserve. The deck builder's
  validator already reports all of this, so the page does not re-validate; it
  only defaults sensibly and reads its sizes from `lib/formats.ts`.
- **Lost Soul pool:** 258 printings, 257 distinct names; 153 are
  Rotation-legal. Names carry the nickname and reference
  (`Lost Soul "Accusers" [Ezra 4:6]`), which is what players know them by.

## Recognition

### The call

`recognize()` gains a `mode: 'collection' | 'deck'` that selects the
instruction, the schema, the arm and the timing. Deck arm: `claude-sonnet-5-5`,
effort `high` (*Amendments after E0*: medium truncates the list on dark
photos), tier `high`, thinking omitted (the model's default). Same key
and failure classification. Deck mode uses a per-call timeout of 80 s (the
scanner keeps 25 s) and `max_tokens` 16,000 with **no retry at 32k**: a
`max_tokens` stop in deck mode is the failure code `too_many_cards`, and the
page's copy asks for the deck in two photos, which the tray merges. Opus is
not used: the spike found no accuracy gain for twice the cost and latency.

### Instruction

Start from the spike's instruction (copied into
`scripts/scan-eval/deck-instruction.txt` in PR 1) and keep its substance:

- A deck laid out on a table; cards in overlapping columns or fans; only the
  top band of most cards is visible; one card at the end of each column is
  usually fully visible.
- One entry per physical card, duplicates included; count by following each
  repeated title-band edge; never merge duplicates.
- Per card: `title` copied as printed (null when it cannot be read, never a
  guess); `strength` and `toughness` when the box is visible; `type` from the
  frame and icon; `brigade` as colour words; `reference` only when the verse
  line is visible (the fully visible card); `group` and `position`;
  `titleBox`, a normalized box around this card's visible title band (null
  when unsure); `confidence` high only for a sharp, unambiguous title.
- Groups: every visually separate run of cards, with `orientation`
  (`upright`, `rotated_cw`, `rotated_ccw`, `upside_down`), a normalized
  bounding box `[x0, y0, x1, y1]` and an estimated `cardCount`. A row along
  the top or bottom edge is its own group.
- Lost Souls: title "Lost Soul", reference when visible.
- Do not identify from memory, do not name the card, do not invent a card you
  cannot see.
- `photoQuality`: `ok`, `blurry`, `dark`, `glare`, `no_cards`
  (`too_many_cards` is not an outcome here; a deck is many cards).

### Schema

`lib/scan/deckSchema.ts`, the deck counterpart of `schema.ts`:

```
{ photoQuality,
  groups: [{ id, orientation, bbox: [n, n, n, n], cardCount }],
  cards:  [{ title | null, strength | null, toughness | null, type, brigade | null,
             reference | null, group, position, titleBox: [n, n, n, n] | null,
             confidence }] }
```

`parseDeckOutput` validates shape, clamps every box to 0–1, caps strings as
`capDetection` does, and drops a card whose `group` names no group (it is
reassigned to a synthetic group 0, not dropped: the card still exists).

### From reads to rows (`lib/scan/deck.ts`, pure)

Each read with a title becomes a `ScanDetection` (title, stats, type, brigade,
reference; the rest null; `grid` from group and position) and goes through
`matchDetection` with the real price map (the route loads it anyway; prices
only affect which printing is the default). Then:

| Matcher result | Row |
|---|---|
| `matched` | Matched; printing by the preference rule |
| `check`, `reference_missing` (a Lost Soul with no reference) | Lost Soul placeholder, counted per group |
| `check`, `reference_ambiguous` or a Lost Soul with a read reference that matched | Matched Lost Soul (the fully visible one) |
| `check`, `identity_ambiguous` (several cards share the title and the read brigade, type and stats did not separate them) | Check this · *Which card?*; the tied identities are the picker's suggestions, each with its brigade colour and set. Never silent. |
| `check`, `printing_ambiguous` | Matched; printing by the preference rule (decks do not care) |
| `not_found` | Not found · the read title · **Find card** |
| read with null title | Unread · **Find card** |
| `nameReason: fuzzy` and `confidence: low` | Check this · *Read as "…"* (a fuzzy hit on a sharp read stays Matched) |

Same-title ties are real: 608 non-Lost-Soul stems carry more than one
type, brigade or alignment (Aaron in Green, Teal and Green/Teal; Abiathar in
Purple and Teal). On a fanned card the frame colour, the type icon and the
stats box are visible, so the matcher's brigade, type and stats scores
separate most of them. What they cannot separate is a reprint whose ability
changed (Forest Fire FooF and Roots: same title, type, brigade, verse), and
the ability is hidden on a fanned card, so that tie is real and is always
Check this. The row's provisional choice is the Rotation-legal identity
when exactly one of the tied identities has a Rotation printing, else the
first by the matcher's score; the picker lists every tied identity with its
set and the first words of its ability, so the player can tell them apart.
The identity index is not changed. E0 measures the amber-row rate; the
target is at most 3 amber rows per sharp 50-card photo, Lost Souls
excluded.

**Printing preference**, among an identity's printings: Rotation-legal first;
among those the matcher's chosen printing when it is legal, else the first in
the deck builder's set order (whatever `compareCardsByType` or the builder's
printing list uses; the builder reuses it). **v1.1:** a printing the player
owns wins when their collection has one.

Rows merge on the chosen key across groups and photos, quantities summed, as
the scanner tray does; a merged row remembers which groups contributed so a
zone change on a group moves its share. Lost Soul placeholders merge into one
counter per group.

### Groups and zones

Every group is a section with a **Main deck / Reserve** control. Default: all
main. A group, or a row of groups, defaults to Reserve when all of these
hold: the main total is at least 50 without it; it has at most the reserve
size of the format the main total implies (`lib/formats.ts`: 10 for Type 1,
20 for Type 2); and it is the largest row set apart from the main band of
columns, else a single group set apart, else the only non-upright group or
the last group in reading order (*Amendment: the Reserve default reads the
layout*). A Lost Soul or Dominant read inside a Reserve group is
shown in that section with a note and counted in main; the deck rules forbid
them in reserve, and the builder's validator would flag it otherwise.

### Turn pass and second pass over sideways and short groups (PR 3)

Redesigned after E0, after PR 3 and after the Discord eval (*Amendments
after PR 3*, *Amendments after the Discord photo eval*). First, a photo
whose cards nearly all lie one way sideways is turned upright and read
again (`runTurnPass`), and turned once more if that read says it is still
turned; everything below works on the turned image. Before
the crop pass, `inferSidewaysRows` resets to `rotated_ccw` any wide upright
group no taller than 1.2× the median upright-column width, unless its box
touches the top or bottom edge. A group needs a crop when its orientation is
not `upright`, or when it is an upright group of 3 or more cards the read
listed under half of (never group 0). A group with 80% of its box inside a
group that will be cropped is absorbed instead. For each group that needs a
crop, in id order and at most 12: crop the bbox padded by 4% of the image
on each side and clamped to the image (a wider pad pulls neighbouring
columns in and duplicates their cards), rotate to upright by the
orientation, scale to fill the high tier's patch budget (`lanczos3`), JPEG
quality 85 with mozjpeg, and call `recognize` at effort medium with the
deck instruction prefixed by: "This is one group cropped from a larger deck
photo and turned upright; read every card in it. Report it as a single
group with id 1." For an upright group, keep a crop read only when its
`titleBox` centre, mapped back to the photo, lies inside the group's box
plus 1.5%; a rotated group keeps every read (its boxes are dropped). Kept
reads replace the group's first-pass reads (position renumbered; group id
kept). Crops run four at a time after the first pass, end by
`requestStart + 140 s`, and retry once on a connection error or 5xx when a
full second attempt still fits; a crop that fails, comes back empty or is
skipped keeps the group's first-pass reads and logs it. The scan event's
tokens, cost and latency sum every call; `attempts` counts calls. The
response carries `rotation`, `imageSize` and `crops: { cropped, failed,
skipped, merged }`. The sharp photo triggers no crops.

An upright group's unread cards appear as Unread rows and the page's tip
says to lay every card upright with the title showing.

### Cost and latency

Measured through the preview at effort high: $0.08–0.12 and 41–61 s per
50–60 card photo (the spike's $0.04 and 16–20 s were effort low and medium,
which do not list every card). The crop pass adds about $0.01–0.02 and a
few seconds per sideways group. A 140-card Type 2 photo is estimated at $0.20 and
90 s. With PR 3, `maxDuration` is 150 s (first pass up to 80 s, crops up to
30 s four at a time, all crops done by 140 s) and the client's request timeout in `useScanQueue`
rises from 100 s to 170 s. Type 2 in v1.0 is best effort: a photo of up to
about 200 cards works within the budget; a bigger or slower one fails with
`too_many_cards` and the player photographs the deck in two halves. Deck
mode costs five to ten times a collection scan; at the global cap of 1,500
scans per 30 days the worst case is $150–330 against the $80 ceiling, so the
ceiling is the control and the E3 queries watch the deck share of spend
weekly; a deck-mode cap of its own (300 per 30 days) is the first lever if
the share grows.

## The flow

### Routes and entry points

| Route | Who | What |
|---|---|---|
| `/decklist/scan` | signed in and `canScan` | The page. Signed out: the scanner's page-level gate with this page's copy and `redirectTo=/decklist/scan`. Not allowed: the scanner's *not open* copy. A route, not a modal, for the same camera-eviction reason as the scanner. |
| Deck builder | anyone | The New deck control gains **From a photo**; the Import modal gets one line, *Have a photo of the deck laid out? Read it from a photo*, linking here. |
| `/decklist/my-decks` | signed in | **New from photo** beside New deck. |
| `/collection/scan` | signed in | One muted line under the capture buttons: *Scanning a whole deck? Use Deck from photo.* And the reverse line here, pointing at the collection scanner for single cards. |
| `/privacy` | anyone | One added sentence under Card scanner: deck photos are handled the same way. |

### Capture

The scanner's `CaptureButtons` and `prepareImage` (2576 px long edge, JPEG
0.85, 3 MB hard stop, `<img>` decode for EXIF), plus two things deck photos
need because they usually arrive on a desktop from Discord: a page-wide drop
target (the deck builder's `useExternalDropTarget` pattern) and a document
`paste` listener that takes `clipboardData.files`. Several photos are
allowed (a main deck and a reserve photographed separately); rows merge across
them. Posted as `multipart/form-data` with `mode=deck`.

Tips under the buttons (collapsed after first use): lay every card upright
with the title band showing; one column per brigade is ideal; put the reserve
in its own row; good light, no flash glare.

### Processing

The scanner's `PhotoGroup`: thumbnail, *Reading…* with elapsed seconds after
5 s, then *Read 52 cards in 4 groups*, or a failure string from the scanner's
Copy with **Retry** and **Remove**; `too_many_cards` gets this page's own
string and no Retry. During the second pass: *Reading 1 sideways group…*.

### The tray

Sections per group in reading order. Section header: *Group 3 · Read 9 of
about 9* (the second number is the model's estimate; it is omitted when the
two agree), a *sideways* note when it was rotated, and the **Main deck |
Reserve** segmented control. Under the header, the group strip: the group's
bbox cut from the photo on the client (`<canvas>`, rotated upright, long edge
capped at 1200 px, kept in memory only), shown at 72 px tall and scrollable
sideways when the group is a row, tap to open large in the house dialog.

Rows at 390 px (content width 358): `[thumb 44] [8] [text ≥ 150] [8] [− 36]
[qty 28] [+ 36] [4] [⋯ 44]`. Line one: name. Line two, 12 px: set and
legality (*Roots · Rotation*), or the chip's reason. The thumbnail is the
card's title-band crop when `titleBox` is present and E0 proved the boxes,
else the catalog image; tapping it opens the catalog image large. Tapping the
name opens the picker in search mode (below). − and + change the quantity
with no confirm; the number opens a stepper for bigger jumps. The ⋯ menu
holds **Change printing**, **Move to reserve** / **Move to main deck**, and
**Remove**; swipe left is a shortcut for Remove; Remove shows a 5 s *Undo*
toast. Every section ends with an *Add a card…* row that opens the same
search; the new row joins that group and zone. Amber rows carry a 2 px amber
left edge.

Chips:

- **Matched**: no chip.
- **Check this** (amber): *Which card?* with the candidates, or *Read as
  "Saul"*. The row holds the provisional choice.
- **Not found** (amber): the read title as text and **Find card**, which opens
  the picker in search mode with the title prefilled. Not counted until
  resolved.
- **Unread** (amber): *Couldn't read this card* and **Find card**. Not counted
  until resolved. Several unread cards in one group collapse into one row
  with a count and a stepper, so "3 unread" becomes three picks or a removal.
- **Lost Souls**: one summary row per group, *Lost Soul ×7 · Pick which*,
  opening the Lost Soul sheet; after picking, *7 picked* and the picks listed
  as ordinary rows under it.

Totals line above the footer, `aria-live="polite"`: *Main 50 · Reserve 10 · 7
Lost Souls to pick · 2 unread*.

The tray persists in `sessionStorage` keyed by user id (`deck-scan-tray:v1:`),
as the scanner's does: reads, chosen keys, quantities, zones, picks,
corrections. Not thumbnails, strips or crops: after a reload the catalog
thumb stands in and the section header says *Photo 1*.

### The Lost Soul sheet

The house dialog as a bottom sheet (the scanner's picker chrome and focus
trap). Header *Pick your Lost Souls · 3 of 7*. A search field matching
nickname, reference and set; a list of the 153 Rotation-legal Lost Souls as
`[thumb 44] nickname · reference · set` rows with a checkbox and a quantity
stepper (a deck can run two of one Lost Soul). A *Show all printings* toggle
adds the non-Rotation ones. Prefilled with any Lost Soul whose reference the
model read (the fully visible card at the end of its column). Picking more
than the target is allowed; the header turns amber past it. **Done** writes
the picks as rows; **Skip** leaves the placeholders out, and the deck builder's
validator will then say the deck is short on Lost Souls, which is the right
place for that message. Ordered by nickname in v1.0; **v1.1** orders by
frequency in public decks.

### The picker

The scanner's `PrintingPicker` with search mode as the default on this page.
It opens with the read title in the field, selected, keyboard up, and a
**Suggestions** block above the results: up to five identities ranked by
similarity to the read title, from the matcher's near-miss stems (the fuzzy
candidates it rejected, in `MatchResult.note` today; PR 1 returns them as a
`near[]` list of stems with distances) merged with the top `searchCardNames`
hits, de-duplicated by stem, each row `[thumb] name · set`. One tap on a
suggestion replaces the card and closes the sheet. Typing filters as the
scanner's search does. *Which printing?* mode (from ⋯ → Change printing) is
the scanner's unchanged. Resolution through `findCard` as the scanner does.
Prices are shown as the scanner shows them; this page defaults `useShowPrices`
off.

### Hand-off

A sticky footer with two actions:

- **Copy as text**: the deck builder's tab format, one line per row
  (`qty\tname\tset\timgFile`), a `Reserve:` section when any group is
  reserve, Lost Soul picks included, placeholders and unresolved rows left
  out. Toast *Copied*.
- **Open in deck builder** (primary): `createDeckFromScanAction(rows,
  outcomesByScanId, meta)` saves the deck through the same path as
  `saveDeckAction` with name *Deck from photo · Oct 29*, format *Type 1*
  unless the main total is inside the Type 2 range in `lib/formats.ts`
  (100–140), then *Type 2*; a total outside both ranges stays Type 1 and the
  builder's validator says what is wrong; no folder; writes the outcomes
  in the same call; returns the deck id; the page navigates to
  `/decklist/card-search?deckId=<id>`. Disabled while in flight and after
  success. There is no commit table: if a response is lost the player may find
  a duplicate in My Decks and delete it, which costs nothing; decks are not
  money.

Unresolved rows (Check this with no pick, Not found, Unread) are left out of
the deck with a footer line *3 cards left out* and a confirm step: *Open with
47 cards?* The player can also remove them.

### What is recorded

Per photo, a `scan_events` row with `mode = 'deck'` and the capped reads. On
hand-off, each read's outcome as the scanner records it: final key, name or
printing changed, removed, left unresolved, plus the zone and whether it was a
Lost Soul pick. Rows the player added and Lost Soul picks have no read id;
the action's validator accepts synthetic ids (`add:<n>`, `ls:<n>`) for them,
which the scanner's validator does not. Abandonment: a `done` deck-mode row
with no outcomes within 24 hours.

## Data

### `POST /api/scan` with `mode=deck`

A form field `mode`, `collection` (default) or `deck`. Deck mode switches the
instruction, schema and arm; raises the detection cap to 300 (`COMMIT_LIMITS.
detectionsPerScan` is 150 and stays for collection mode); runs the crop pass;
and returns `groups[]` plus `group`, `position` and `reference` on each
detection alongside the scanner's fields. Gate, body limits, reserve, finish
and error codes are unchanged, plus the new `too_many_cards` failure. The
superuser `arm` override and `source=eval` work as today. The AB frame
comparison (`settleAbPairs`, #546) is **skipped in deck mode**: exact
printing is a non-goal, fanned cards hide the frame, and the call would add
a second Claude request with up to 40 catalog images to most deck photos.

### Migration `124_scan_events_mode.sql`

`alter table scan_events add column mode text not null default 'collection'
check (mode in ('collection', 'deck'))`, written by `finishScan` (no change to
`scan_reserve`). An index is not needed; the E3 queries filter small tables.
Caps unchanged.

### Retention and privacy

Identical to the scanner: no photos kept, reads kept, unmatched reads purged
on the scanner's schedule. `/privacy` gains one sentence.

## Evaluation

- **Labels**: the four spike photos labeled as an identity multiset per photo
  (Lost Souls as a count, reserve membership noted), in
  `scripts/scan-eval/labels-deck.json`. The agent writes them from the photos
  at full zoom (the sharp photo was already read card by card in the spike);
  Tim spot-checks ten cards per photo, and any card neither can read is
  labeled `unreadable` and excluded from recall. Photos in
  `scripts/scan-eval/photos-deck/` (git-ignored, shared copy beside the
  scanner's). Tim asks Discord for ten more posted deck photos before PR 2
  merges.
- **Recordings**: the spike's outputs use the spike schema and cannot drive
  the new parser or scorer. PR 1's unit tests use small hand-written fixtures
  in the new schema. The real recordings are made through the harness
  (`run.ts --mode deck`) against PR 2's preview with the superuser session,
  about $0.50 of credit for the four photos across two arms, on Tim's
  go-ahead, and committed in PR 2 under `scripts/scan-eval/outputs/deck-*/`
  with a `.gitignore` negation (line 126 ignores `outputs/*/` today).
- **Scorer** (`scripts/scan-eval/deckScore.ts`): per photo, identity
  precision and recall over non-Lost-Soul reads; invented count (a Matched row
  whose identity is not in the photo); Lost Soul count error; reserve-group
  default right or wrong; group `cardCount` estimate error; cost and latency.
  `run.ts` gains `--mode deck`.
- **Box check** (E0, by eye on a contact sheet the scorer renders): the share
  of group boxes that contain their whole group, and of `titleBox` crops that
  show the right card's band. Group strips ship when group boxes pass on all
  four photos. Per-card crops ship in v1.0 only when at least 90% of title
  boxes are right; otherwise they move to v1.1 and rows use the catalog thumb.
- **Targets**: sharp upright photos: recall ≥ 95%, invented 0. Posted-grade
  photos (1024 px, poor light, sideways reserve): recall ≥ 80% after PR 3,
  invented ≤ 2%.
- **E3 queries** (`queries.sql`, `mode = 'deck'`): decks created from photos
  per week, rows corrected or removed per deck, unread rate, cost per deck,
  deck share of monthly spend.
- **Kill**: fewer than 10 decks created from photos in the first 60 days
  removes the entry points and the page in one PR; the route mode, `lib/scan/
  deck.ts` and migration 124 stay.

## Copy

| Key | Text |
|---|---|
| pageTitle | Deck from photo |
| lead | Photograph a deck laid out on a table, or drop in a photo from Discord, and get a decklist you can open in the deck builder. |
| tips | Lay every card upright with the title showing. One column per brigade works best. Put the reserve in its own row. |
| reading | Reading… |
| readDone | Read {n} cards in {g} groups |
| readingCrop | Reading {n} sideways group{s}… |
| smallPhoto | Small photo: the full-size original reads better |
| tooManyCards | Too many cards for one photo. Photograph the deck in two halves and add both. |
| groupHeader | Group {i} · Read {n} |
| groupHeaderEstimate | Group {i} · Read {n} of about {m} |
| addCard | Add a card… |
| suggestions | Suggestions |
| toCheck | {n} to check |
| menuPrinting / menuToReserve / menuToMain / menuRemove | Change printing / Move to reserve / Move to main deck / Remove |
| removed | Removed {name} · Undo |
| stripHint | Tap to enlarge |
| zoneMain / zoneReserve | Main deck / Reserve |
| lostSoulRow | Lost Soul ×{n} · Pick which |
| lostSoulPicked | {n} picked |
| sheetTitle | Pick your Lost Souls · {picked} of {target} |
| unread | Couldn't read this card |
| notFound | Not found: "{title}" |
| readAs | Read as "{title}" |
| whichCard | Which card? |
| totals | Main {m} · Reserve {r} · {ls} Lost Souls to pick · {u} unread |
| leftOut | {n} cards left out |
| openConfirm | Open with {n} cards? |
| open | Open in deck builder |
| copy | Copy as text |
| copied | Copied |
| deckName | Deck from photo · {Mon D} |
| crossLinkHere | Scanning single cards for your collection? Use the card scanner. |
| crossLinkScanner | Scanning a whole deck? Use Deck from photo. |
| privacy | Deck photos are handled the same way: sent to Anthropic to read the cards, not kept. |

Errors, the signed-out gate and the not-open state reuse the scanner's Copy.
Tone per the design system: plain, short, no exclamation marks.

## Files

- `app/decklist/scan/page.tsx`, `client.tsx`, `copy.ts`, `types.ts`,
  `components/GroupSection.tsx`, `GroupStrip.tsx`, `DeckRow.tsx`,
  `RowMenu.tsx`, `AddCardRow.tsx`, `LostSoulSheet.tsx`, `HandoffBar.tsx`,
  `hooks/useDeckTray.ts`, `hooks/useCheckWalker.ts`,
  `lib/deckTrayReducer.ts`, `lib/photoCrops.ts` (client canvas crops of
  groups and title bands from the in-memory photo), `lib/suggest.ts`
  (suggestion ranking: near-miss stems merged with search hits),
  `lib/deckText.ts`.
- Shared with the collection scanner: `CaptureButtons`, `PhotoGroup`,
  `PrintingPicker`, `useFocusTrap`, `prepareImage`, `pickerSearch`,
  `useScanQueue`. Builder's call whether they move to `components/scan/` in
  PR 2 or are imported across routes; moving is preferred and is a pure move.
- `lib/scan/deckSchema.ts` (instruction, schema, `parseDeckOutput`),
  `lib/scan/deck.ts` (reads → rows, printing preference, zone defaults, pure),
  `lib/scan/crop.ts` (bbox padding and clamping, rotate, upscale; sharp),
  `lib/scan/recognize.ts` (`mode`, per-mode timeout, no 32k retry in deck
  mode, `too_many_cards`), `lib/scan/match.ts` (`near[]` on `MatchResult`), `app/api/scan/route.ts`
  (`mode`, crop pass, `groups`, `settleAbPairs` skipped).
- `app/decklist/actions.ts`: `createDeckFromScanAction`.
- Entry points: `app/decklist/card-search/client.tsx` (New deck menu, Import
  modal line), `app/decklist/my-decks/`, `app/collection/scan/client.tsx`
  (cross-link), `app/privacy/page.tsx`.
- `supabase/migrations/124_scan_events_mode.sql`.
- `scripts/scan-eval/run.ts` (`--mode`), `deckScore.ts`, `labels-deck.json`,
  `deck-instruction.txt`, `photos-deck/` (git-ignored), `outputs/deck-*/`
  (responses recorded through the harness after PR 1, committed with a
  `.gitignore` negation).
- `prompt_context/` and CLAUDE.md's Key References gain one row.

## Testing

Unit, with vitest (node only, no DOM):

- `deckSchema`: parse, clamp, cap, synthetic group for an orphan card.
- `deck.ts`: every row of the matcher-result table above, with hand-written
  fixtures in the new schema; printing preference; merge across groups with
  per-group shares; zone defaulting (each condition on and off; Lost Soul in a
  reserve group).
- `deck.ts` on the real index: Forest Fire FooF and Roots read by title
  alone is Check this with both identities; Amariah read with brigade Clay is
  Matched to the Roots card.
- `recognize.ts`: deck-mode timeout, `too_many_cards` on a `max_tokens`
  stop with no retry.
- `crop.ts`: padding, clamping at the edges, rotation mapping for each
  orientation; the geometry only, sharp mocked.
- `deckText.ts`: the tab format round-trips through `parseDeckText`.
- `deckTrayReducer`: pick, skip, zone change for a group and for one row,
  quantity − and +, remove and undo, add a card to a group, resolve,
  persistence shape, and that every correction lands in the outcomes.
- `suggest.ts`: ranking and de-duplication by stem; the near-miss list wins
  over search hits at equal distance.
- `photoCrops.ts`: box-to-pixel mapping for each orientation and the cap on
  the long edge (geometry only; canvas mocked).
- `useCheckWalker`: next amber row in document order, wrap-around, focus.
- Route: `mode=deck` with a mocked recognizer, including a failed crop call
  keeping first-pass reads, and the detection cap.
- `createDeckFromScanAction`: validation of rows and zones, outcome writes.

No e2e (no CI runs them). Before PR 2 merges: a phone walk on a preview with
the four spike photos, per the scanner's verification recipe.

## Rollout

1. **PR 1** `feat/deck-scan-lib`: `deckSchema`, `deck.ts`, `recognize` mode
   and timing, route mode (no crop pass, AB skipped), `near[]`, migration 124, eval harness mode,
   scorer, hand-written fixtures. Mergeable on its own: no key, labels or
   credit needed. Apply 124 to production before PR 2's preview.
2. **PR 2** `feat/deck-scan-page`: the page, group strips, suggestion-first
   search, row menu, add-a-card, check walker, Lost Soul sheet, hand-off,
   entry points, privacy line, cross-links. E0 on the spike photos through
   the preview with the labels and recordings described under Evaluation,
   including the box check that decides per-card crops; the recordings are
   committed in this PR. Merge behind the existing `canScan` gate (open to all
   signed-in users since 2026-10-29).
3. **PR 3** `feat/deck-scan-crops` (#552, merged 2026-10-30; sideways-row
   inference #553): `crop.ts` and the crop pass over sideways groups,
   `maxDuration` 150, the client timeout, the deck-mode cap
   lever. Start from the experiment scripts `tmp/zoom-pass.ts` and
   `tmp/groups-pass.ts` in the PR 2 worktree (git-ignored; copy them into
   `scripts/scan-eval/` first). Re-run E0 on all four photos; the
   posted-grade target applies from here.
4. One line in the next What's New; a Discord note asking for deck photos,
   which doubles as the eval set growing.
5. Day-30 look at the E3 queries; day-60 kill check.

## Left to the builder

- Exact instruction wording beyond the substance listed; start from the
  spike's text.
- Bbox padding and the 1600 px crop edge are starting values; tune on the two
  sideways photos.
- The set order used for the printing fallback: reuse whatever the builder
  already uses to order printings of one name.
- Component split inside the client as long as the listed pieces exist.
- Whether shared scan components move or are imported across routes.
- Hand-rolled validators for the action's rows (the repo has no zod).
- Lost Soul sheet thumbnail size; 153 rows need no virtualization.
- Where the New deck "From a photo" control sits in the builder's existing
  menu, within the design system.
- Strip height and the enlarge view's zoom behaviour; the 1200 px client crop
  cap is a starting value.
- How the near-miss list is surfaced from `lookupStem` (a `near` field on
  `MatchResult` is the obvious shape).

## Calls I made (for review)

1. Same route and table as the scanner with a `mode` field, not a second
   route and table: one gate, one set of caps, one event log, one privacy
   story.
2. Sonnet 5.5 at effort high for the whole-photo read (medium lists only the
   visible cards on dark photos; low invents) and medium for crops; not Opus
   (no gain).
3. Groups are the unit of zone assignment, with one conservative Reserve
   default and a per-group toggle, rather than asking the player to assign
   every card.
4. Printing ambiguity is never a question on this page: decks need an
   identity and a legal printing. Only cross-stem ambiguity, fuzzy low-
   confidence reads, Not found and Unread ask for attention.
5. Lost Souls are picked in one sheet with a count target, not seven separate
   picker trips; Skip is allowed and the builder's validator carries the
   message.
6. Open in deck builder creates a real deck immediately and navigates; no
   commit table, no idempotency token, because a duplicate deck is harmless
   and deletable.
7. Drop and paste are v1.0 because the photos come from Discord on a desktop
   at least as often as from the player's camera.
8. The crop pass is v1.0 but its own PR, so the page can ship a week earlier
   with the honest Unread rows.
9. No URL fetch in v1.0 (abuse surface and CDN auth); paste covers the
   desktop case.
10. The page shows no prices by default; this is a deck, not a shopping list.
11. Correction evidence comes from client-side crops of the photo still in
    memory, not from stored photos: the privacy story stays "nothing kept",
    at the cost of losing strips on a reload.
12. Per-card title-band crops are gated on E0 rather than promised: a crop of
    the wrong card would mislead more than a catalog thumb.
13. Remove is in the ⋯ menu with swipe as a shortcut, so the row has room for
    − and +: count fixes are more common than removals on a deck photo.
14. A genuine same-title tie is always Check this, never a silent pick, with
    the Rotation-legal identity as the provisional choice when only one
    tied identity is Rotation-legal.
15. Deck mode gets its own 60 s timeout and no 32k retry; a deck that does
    not fit one call is two photos, not a two-minute request that bills
    twice and times out.
16. The AB frame comparison is skipped in deck mode; printing exactness is
    not what a deck needs and the call would double most photos' cost.
17. Deck sizes come from `lib/formats.ts`, which the validator enforces, not
    from the rules document's wider tournament ranges.
