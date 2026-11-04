# Deck check PDF from a photo — design

Date: 2026-11-03. Builds on `2026-10-29-deck-photo-import-design.md` (the
deck photo reader at `/decklist/scan`, live for every signed-in user since
2026-10-30). Read that spec first; this one changes where the reader is
reached from, what it hands off to, and how a wrong read is fixed.

## Intent

`/decklist/generate` ("Deck Check PDF" in the nav) turns a decklist into the
tournament deck-check PDF or a deck image. Its two sources today are *Paste
text* (Lackey format) and *My saved decks*. A player at a table with the
physical deck and no typed list has neither. The deck photo reader exists,
but it lives on its own page, hands off only to the deck builder, and a
player who finds it and copies the text into this page gets a silently empty
PDF, because the reader's four-column text does not parse here.

Tim's ask, 2026-11-03: on this page, let people upload a picture of their
deck. Two uses: **picture → online deck** and **picture → PDF**. Make
correcting mistakes **easier than it is today**. **Draw attention** to the
new feature visually.

So this design does three things:

1. **A third source on the generate page: From a photo.** The reader renders
   in place of the textarea. The form's own *Generate* button is the
   hand-off for the PDF and the image; *Open in deck builder* sits under the
   tray for the online deck. Signed-out players see a sign-in prompt there.
2. **Two correction changes to the reader, on both pages.** Every row shows
   the photo's own crop of that card's title band above the name it was read
   as, so a wrong read is visible without opening anything; and amber rows
   carry one-tap suggestion chips, so the common fix needs no dialog.
3. **Attention.** The photo source is first in the source row and carries the
   site's *New* pill; a one-line callout under the page title points at it;
   the nav entry gets the pill; the reader's own page gains a *Deck check
   PDF* hand-off.

## Why the reader is harder to correct than it should be

The October spec's first rule was *see what it saw*: a strip of the photo
beside the rows. It shipped off (`SHOW_GROUP_STRIPS = false`: group boxes
cut the fully visible card and sideways rows came back upright), and the
per-card title-band crop it gated on an E0 box check was never built. So
today a player checks a 50-row list against their memory of the deck, or
scrolls up to the photo thumbnail. A confident wrong read (precision is
0.98, so about one per deck) has no tell at all; only amber rows ask for a
look.

Measured for this design on the recorded reads in
`scripts/scan-eval/outputs/deck-sonnet55-high-crops-v2/` (four Discord
photos, 226 reads): 209 reads carry a `titleBox` (92%); the median box is
3.2–3.75 times wider than tall and 1.7–3.6% of the photo's height, which is
a title band. Cut and viewed: 24 of 24 crops from two photos (one 2048 px,
one 1024 px) land on the title and are legible at 420 px wide; the 1024 px
photo's crops are soft but readable. 14 of 209 boxes are taller than 8% of
the photo (the fully visible card at the end of a column, boxed whole).
The boxes are good enough to show as evidence beside the catalog thumbnail,
with the filter below.

## Scope

In:

- `/decklist/generate`: the photo source in `DeckSourcePicker`, the callout,
  the signed-out prompt, deck type inferred from the read, two-column text
  for the generators, `?source=photo`.
- The reader, extracted so both pages render the same component with their
  own hand-off: per-row title-band evidence, suggestion chips, the generate
  page's hand-off, a *Deck check PDF* action on `/decklist/scan`.
- Outcomes recorded for a PDF hand-off, as they are for a deck-builder one.
- Nav pill, copy, tests, a What's New line.

Out (see Non-goals).

## Goals

- A player with a deck on the table and a phone gets a deck-check PDF from
  `/decklist/generate` without typing a card name: photo, fix, Generate.
- The same tray opens the deck in the builder with one tap.
- A wrong read is visible at a glance in the list itself, and fixing a
  flagged read is one tap in the common case.
- A player who has not seen the feature notices it on the page, in the nav,
  and in the reader's own page.
- No new model call, route, table or migration. Same gate, same caps, same
  cost (about $0.10 and 40 s per photo), same privacy story (nothing kept).

## Non-goals

- Anonymous scanning. The gate stays: signed-in users only.
- Changing the read itself (prompt, model, crop pass, speed). The streaming
  and sideways-probe levers in `project_deck_scan_thinking_off` are separate.
- A design-system pass on the generate page (emoji tabs, gradient Flowbite
  buttons, blue focus ring). Worth its own `ui-pass`; this design touches the
  page as it is and adds nothing that fights the system.
- A desktop two-pane view (photo pinned beside the list, hover highlights
  the box). Good v1.1; the per-row strip gets most of the value for less.
- URL fetch of a Discord image. Drop and paste cover it, as before.

## Anti-goals

- A PDF that is silently wrong or short. Unresolved rows and unpicked Lost
  Souls are left out with a visible count and a confirm, exactly as the
  deck-builder hand-off does; the four-column text defect is closed so a
  pasted reader export never produces an empty PDF again.
- A crop of the wrong card beside a row. A strip that fails the geometry
  filter is not shown; the catalog thumbnail is always there as the other
  half of the comparison.
- A tray inside a modal. The reader's picker, Lost Soul sheet and toasts are
  dialogs already; nesting them is out. The reader renders inline.
- A new accent colour, a gradient, or a hero block to announce the feature.
  The site's existing *New* pill and a `bg-card` band do the work.

## Constraints

- Scanning needs a signed-in user: `POST /api/scan` checks `canScan`, and
  `SCANNER_OPEN=1` admits every signed-in user. The generate page is public
  and fully client-rendered, so the photo source learns sign-in state the
  way `DeckSourcePicker` already does (`getUserSafe` on mount) and the route
  remains the authority.
- `lib/decksheets/parse.ts` splits each line on the **first** tab and keeps
  the rest as the name; `resolveDeck` maps by exact name. The reader's
  `buildDeckText` emits `qty\tname\tset\timgFile` (the builder's import
  format), which the PDF parser turns into a name nobody has. The generate
  page needs `qty\tname`. The PDF ignores printings, so nothing is lost.
- The reader's tray lives in `sessionStorage` under one key per user
  (`deck-scan-tray:v1:<uid>`); thumbnails and crops do not survive a reload.
- Both tabs of the generate page render their own `DeckSourcePicker`.
  Switching tabs while a photo is reading must not lose the read.
- Rows are 358 px wide on a phone on the reader's page today: `[thumb 44]
  [8] [text ≥150] [8] [− 36] [qty 28] [+ 36] [⋯ 44]`. The strip has to fit
  inside the text column; nothing is added to the row's width. On the
  generate page the reader bleeds past the card panel's padding to get the
  same budget (see Photo mode).
- A turned photo's boxes are in the turned frame: the response's
  `rotation` says by how much. Any crop from the original photo has to
  honour it.
- Design system: green only for the one CTA, active state and the pill;
  amber for warnings; `bg-card` for a lifted panel, hairlines for structure;
  44 px targets; no gradients or new colours.

## The generate page

### Sources

`DeckSourcePicker` gains a third mode, `photo`, and the source row is shown
to everyone (today it is hidden when signed out). Order and look:

```
[📷 From a photo  NEW]  [Paste text]  [My saved decks 12]
```

The chips keep the picker's current style (`rounded-md border`, active =
`bg-foreground text-background`). *From a photo* is first and carries the
nav's pill (`bg-primary/15 text-primary text-[10px] font-bold uppercase
rounded px-1.5 py-0.5`). Signed out, *My saved decks* stays hidden as it is
today; *From a photo* and *Paste text* show.

`?source=photo` opens the page in photo mode (the callout, the reader's own
page and the What's New line link to it). The source mode is lifted from
`DeckSourcePicker` to the page so the PDF and Screenshot tabs share it.

### Photo mode

Signed out: a short panel in place of the textarea, `bg-card rounded-md`,
camera icon, *Sign in to read a deck from a photo*, **Sign in** (primary,
`/sign-in?redirectTo=/decklist/generate?source=photo`) and **Create an
account** (outline). No reader is mounted.

Signed in: the reader (below) in place of the textarea: capture buttons
with the deck tips, the tray, the totals line, then a secondary **Open in
deck builder** button under the tray (outline, full width on a phone). The
form's own **Generate Tournament PDF** / **Generate Deck Screenshot** button
is the primary hand-off and keeps its place at the bottom of the form.

Width: the source slot sits inside the page's `p-4` wrapper and the tab's
`p-6` card panel, which would leave a row 310 px on a 390 px phone. The
reader bleeds to the panel's edges on phones (`-mx-6 sm:mx-0` on the
reader's wrapper), so its hairline rows run edge to edge of the panel as
lists do elsewhere on the site and the row gets about 356 px, two less than
on the reader's own page. The capture buttons and the builder button keep
the panel's padding.

The reader keeps the page's `decklist` string current: on every tray change
it reports the deck as two-column text (`qty\tname`, main first, `Reserve:`
section when any, Lost Soul picks included, unresolved rows left out), so
`handleSubmit` and `handleGenerateScreenshot` need no new path. Generate is
disabled while any photo is queued or reading, and while the tray is empty.

When the tray has unresolved rows or unpicked Lost Souls, the line *3 cards
left out* (amber, as on the reader's page) sits above the Generate button,
and Generate first asks *Generate with 47 cards?* in the house dialog, with
the same wording the deck-builder hand-off uses. A deck with nothing left
out generates straight away.

Deck type: when a photo finishes reading, the Deck Type select is set from
the main-deck total through `impliedFamily` (`lib/scan/deck.ts`): the Type 2
range gives `type_2`, anything else `type_1`; never Paragon. The player can
change it afterwards; the next photo's read sets it again only if the player
has not touched the select since the last read.

Tab switching: one reader instance is mounted for the page, above the tab
branches, and each tab renders it in the source slot; the in-flight queue
is never unmounted by a tab change. If the builder finds that impractical,
the tabs are disabled while a photo is reading, with the reading line as the
reason.

Outcomes: a successful Generate writes the tray's outcomes
(`deckOutcomes(state)`) through a new server action
`recordScanOutcomesAction(outcomesByScanId)`, the same write
`createDeckFromScanAction` does without the deck, once per tray (a second
Generate from an unchanged tray does not write again). The E3 queries then
see PDF-only corrections too.

### Four-column text

`validateForm` accepts `2\tSaul\tRoots\tsaul.jpg` today and the API then
drops every card. Before either fetch, the page normalizes the decklist:
each card line keeps its first two tab-separated fields. `parse.ts` is not
touched (it is the Python-parity parser behind the public API). A unit test
covers the four-column, two-column and `Reserve:` cases.

### The callout

Under the page's lead sentence, above the tabs, one band:

```
┌──────────────────────────────────────────────────────────────┐
│ (📷)  NEW  Deck check PDF from a photo                        │
│       Photograph your deck laid out on the table. We read the │
│       cards, you fix any misreads, and the PDF is one tap     │
│       away.                                     [Read a photo]│
└──────────────────────────────────────────────────────────────┘
```

`bg-card rounded-md px-4 py-3`, no border, no shadow. The icon sits in a
`bg-primary/15 text-primary` circle; the pill is the nav's; the heading is
`text-sm font-semibold`; the body is `text-sm text-muted-foreground`; the
button is the house primary (`bg-primary`), full width under the text on a
phone, inline at the right on wider screens. **Read a photo** sets the
source to photo and scrolls the picker into view. The band hides once the
player has read a photo on this page (a `localStorage` flag), and never
shows on the reader's own page.

### Nav

`components/top-nav.tsx`: `isNew: true` on the *Deck Check PDF* entry. Two
entries already carry the pill; a third dilutes it a little, which is
accepted for a feature Tim wants found. Revisit the older two in the next
nav pass.

## The reader, shared

`app/decklist/scan/client.tsx` becomes a thin page wrapper around a new
`DeckPhotoReader` component (capture buttons, drop and paste, queue, tray,
totals line) that takes:

- `userId`;
- `onDeckText(text: string, totals)` for a host that wants the deck as it
  changes (the generate page);
- `footer` (a slot) for the host's hand-off: the reader's page passes its
  sticky `HandoffBar`; the generate page passes the secondary *Open in deck
  builder* and lets the form supply the primary;
- `columns: 2 | 4` for `buildDeckText`, default 4 (the builder's format on
  the reader's page is unchanged).

One tray per user, shared by both pages (the existing storage key): a deck
read on one page is the same deck on the other, so *Deck check PDF* on the
reader's page is a plain navigation. A saved tray is still spent (cleared)
as today.

`/decklist/scan`'s hand-off gains **Deck check PDF** →
`/decklist/generate?source=photo`. The sticky footer's two buttons stay as
they are; the new action is a text link line above them (*Need the
tournament PDF instead? Deck check PDF*), because a third equal button does
not fit 358 px.

## Correcting what was read, revised

Everything in the October spec's correction table stands. Two additions,
and both pages get them:

### Row evidence: the photo's title band above the name

Each row's text column gains a strip at the top: the crop of this card's
title band from the photo, cut on the client from the photo still in memory
(`photoCrops.ts`'s `cropPlan` + `cropToUrl` with the row's `titleBox`,
rotated upright by its group's orientation). Row layout, 390 px:

```
[thumb 44] [ ▭▭▭ title-band strip, text-column wide, 48 px tall ▭▭▭ ] [−][3][+] [⋯]
           [ Saul, the King                                          ]
           [ Roots · Rotation                                        ]
```

The strip is `rounded-sm`, `object-cover`, height 48 px on a phone, capped
at 64 px tall and 240 px wide on larger screens so it does not balloon; the
catalog thumbnail stays at 44 px on the left. Read top to bottom the row
says *the photo shows this / we called it that*, and a confident wrong read
is a glance, not a hunt. Tap the strip: the house dialog opens the whole
photo with this card's box outlined (`StripViewer` from `GroupStrip.tsx`
with an SVG overlay; the builder may zoom to the box). *Tap to see it in the
photo* as the strip's accessible label.

Which rows get a strip: every row whose first read has a `titleBox` that
passes the filter and whose photo is still in memory. No strip on a Lost
Soul summary row (every band says *Lost Soul*), an added card, or after a
reload (the photo is gone, as the section header already says). Unread and
Not found rows get one whenever a box exists; it is the most useful place.

The filter, in a pure module with tests: after rotating to upright, the box
must be at least twice as wide as tall and at most 10% of the photo's height.
A taller box (the fully visible card at the end of a column, boxed whole) is
cut to its top band at a 3.5:1 aspect instead of dropped; a narrower one is
dropped. Padding 4% of the box's width sideways and 25% of its height above
and below, which is what the measurement used.

Turned photos: when the route's turn pass re-read a photo turned (a phone
held across the layout; 15 of 53 Discord photos), the response says so with
`rotation` (0, 90, 180 or 270) and every group box and title box is in the
**turned** frame. `DeckPhoto` carries `rotation` from the response (the
reducer's `photoDone` copies it; persisted and restored like `groups`). The
client decodes each photo **once** into a canvas already turned by
`rotation`, so the boxes apply to it directly, and every strip and the
viewer's outline are cut from that canvas; the group's orientation then
turns each strip upright as before. One decode per photo, not
`cropToUrl`'s fetch-and-decode per row. The viewer shows the turned photo,
which is the frame in which the cards stand upright anyway. The
measurement above was on un-turned photos; the turn × orientation
composition is covered by geometry tests, and the phone walk before PR A
merges includes one turned photo from the eval set.

`TrayEntry` carries `titleBox` from `DeckDetection`; the reducer's
`photoDone` copies it. It persists with the tray (four numbers per read) so
the row can show the strip again if the photo is re-added, but the strip
itself is never stored. The strip is its own button above the row's name
button inside the text column, not nested in it. `GroupStrip` and
`SHOW_GROUP_STRIPS` are removed; the per-row strip replaces them.

### Suggestion chips: one tap on an amber row

A *Which card?*, *Read as* or *Not found* row shows up to three chips under
its chip line, from the same ranking the picker uses (`suggestFor(title,
near)` in `lib/suggest.ts`, plus the row's `identityCandidates` first for a
*Which card?* row), each `rounded-full border border-border text-sm
min-h-11 px-3`, labelled with the card name only, and a final **Other…**
chip that opens the picker as the name does today. One tap dispatches
`setCard` (or `setCardOne` for a multi-count Not found row, as the picker
does), the row turns matched, the strip stays. The catalog module loads
lazily when the first amber row renders, as it loads with the picker today.
An Unread row has no suggestions and keeps **Find card**.

Chips are buttons in the row's tab order; the row's own keyboard map is
unchanged. The totals line's *3 to check* walker is unchanged.

## Copy

| Key | Text |
|---|---|
| source chip | From a photo |
| pill | New |
| callout heading | Deck check PDF from a photo |
| callout body | Photograph your deck laid out on the table. We read the cards, you fix any misreads, and the PDF is one tap away. |
| callout button | Read a photo |
| signed-out title | Sign in to read a deck from a photo |
| signed-out buttons | Sign in · Create an account |
| open in builder (generate page) | Open in deck builder |
| left out | {n} cards left out |
| confirm (PDF) | Generate with {n} cards? |
| confirm (image) | Generate with {n} cards? |
| reading hold | Reading… (the Generate button's disabled label while a photo reads) |
| strip label | Tap to see it in the photo |
| chips | the card name; last chip **Other…** |
| reader page link | Need the tournament PDF instead? Deck check PDF |
| paste-mode hint (signed in and out) | Or read it from a photo |

The reader's existing copy (`DECK_COPY`, the scanner's `COPY`) is reused
unchanged for tips, errors, the retention line and the picker.

## Files

- New: `app/decklist/scan/components/DeckPhotoReader.tsx`,
  `components/RowEvidence.tsx` (strip + enlarge with the box outlined),
  `components/SuggestionChips.tsx`, `lib/titleCrop.ts` (filter and plan,
  pure), `app/decklist/generate/PhotoSource.tsx` (signed-out panel or the
  reader with the builder button), `app/decklist/generate/NewFeatureCallout.tsx`,
  `app/decklist/generate/decklistText.ts` (two-column normalization, pure),
  tests beside each.
- Changed: `app/decklist/generate/DeckSourcePicker.tsx` (third mode, order,
  pill, shown signed out, hint line), `app/decklist/generate/page.tsx`
  (lifted source, `?source=photo`, callout, deck type inference, left-out
  line and confirm, normalization, outcomes write, reader mounted above the
  tabs), `app/decklist/scan/client.tsx` (wrapper), `components/DeckRow.tsx`
  (strip, chips), `components/HandoffBar.tsx` (PDF link),
  `lib/deckTrayReducer.ts` (`titleBox` on `TrayEntry`, `rotation` on
  `DeckPhoto`), `types.ts`, `lib/deckText.ts`
  (`columns`), `copy.ts`, `app/decklist/actions.ts`
  (`recordScanOutcomesAction`), `components/top-nav.tsx` (`isNew`).
- Removed: `components/GroupStrip.tsx` and `SHOW_GROUP_STRIPS` (the
  `StripViewer` inside it moves to `RowEvidence.tsx`).
- `CLAUDE.md` Key References: the deck photo import row gains the generate
  page entry.

## Testing

Unit, vitest, node only:

- `decklistText.ts`: four-column → two-column, two-column unchanged,
  `Reserve:` and blank lines kept, `Tokens:` untouched.
- `deckText.ts`: `columns: 2` output parses through
  `lib/decksheets/parse.ts` and resolves every card; `columns: 4` is
  byte-identical to today.
- `titleCrop.ts`: the filter on each orientation; the tall-box top-band cut;
  the narrow-box drop; padding and clamping at the photo edge; the four
  photo turns × four group orientations each yield an upright strip
  (geometry only, canvas mocked).
- `deckTrayReducer`: `titleBox` and `rotation` survive `photoDone`,
  persistence and restore; a chip pick is a `setCard` / `setCardOne` with
  the outcome recorded as a name change.
- Deck type inference from the main total at the Type 1 / Type 2 boundary.
- `recordScanOutcomesAction`: validation and the once-per-tray guard.

Before PR A merges: a phone walk on the preview with three eval photos (one
sharp, one 1024 px, one turned) checking that every strip shows the title
of the card its row names. Before PR B merges: the same walk on the generate
page: read, fix one row by chip, pick Lost Souls, Generate, open the PDF,
then *Open in deck builder* from a fresh read. `tsc` and the unit suite are
the gate for everything else.

## Rollout

1. **PR A** `feat/deck-scan-row-evidence`: `DeckPhotoReader` extraction,
   `titleBox` through the reducer, the strip and its viewer, suggestion
   chips, `columns` on `buildDeckText`, `GroupStrip` removed. Ships on
   `/decklist/scan` alone and improves it on its own.
2. **PR B** `feat/generate-from-photo`: the generate page (source, callout,
   signed-out panel, lifted reader, deck type, left-out confirm,
   normalization, outcomes action), the reader page's PDF link, the nav pill.
3. One line in the next What's New, linking `/decklist/generate?source=photo`;
   a Discord note.

A then B: B's new entry point should land on the improved tray, not the
current one. Tim can flip the order if visibility matters more than the
first impression.

## Left to the builder

- Component boundaries inside `DeckPhotoReader` beyond the listed props.
- Whether the strip viewer zooms to the box or shows the whole photo with
  the outline; the whole photo with the outline is enough for v1.
- The exact chip count (three plus *Other…* is the ceiling; fewer when the
  ranking has fewer good hits, by the same distance cut the picker's
  Suggestions block uses).
- How the lifted reader is placed above the two tab branches in
  `page.tsx`; the fallback (tabs disabled while reading) is acceptable.
- The `localStorage` key for the callout.
- Where the paste-mode hint line sits relative to the Lackey link.

## Calls I made (for review)

1. The reader renders inline on the generate page and the form's Generate
   button is the hand-off, rather than a modal reader or a round trip through
   the reader's page. Fewest states, no nested dialogs, the PDF is one tap
   after the fix.
2. The deck text going into the generators is rebuilt from the tray on every
   change, two columns, and the page also normalizes pasted four-column text.
   The shared parser is left alone.
3. Signed-out players see a sign-in panel in the photo slot; no anonymous
   reads. Each read is a paid model call behind per-user caps.
4. One shared tray per user across both pages (the existing key), so *Deck
   check PDF* from the reader's page is a navigation, not a copy.
5. Every row gets the title-band strip, not only amber rows: the wrong reads
   that hide are the confident ones. Rows grow from about 62 px to about
   90 px; a 50-card list scrolls further and reads itself.
6. The strip sits inside the text column above the name, and the catalog
   thumbnail stays; the row's width and control positions do not change.
7. The group strip is removed rather than turned back on: the per-row crop
   is the same evidence at the right granularity.
8. Suggestion chips sit in the row for the three amber kinds; the picker
   remains behind *Other…* and the name tap. Unread rows keep *Find card*.
9. Deck type is inferred from the read's main total, Type 1 or Type 2,
   never Paragon, and the player's own change wins.
10. Outcomes are written on Generate through a small new action, once per
    tray, so PDF-only use still feeds the correction queries.
11. Attention is the pill, the first-position chip, one `bg-card` callout
    band that retires itself, and the nav pill. No new colour, no gradient,
    no hero block; the generate page's existing look is out of scope.
12. PR A (tray improvements) ships before PR B (generate entry).
13. Turned photos keep their strips: the client turns the photo once by the
    response's `rotation` and cuts every strip from that frame, rather than
    withholding evidence on the photos that need it most.
14. On the generate page the reader bleeds past the card panel's padding on
    phones rather than squeezing rows to 310 px or restyling the panel.
