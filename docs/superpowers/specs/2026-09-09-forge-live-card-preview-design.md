# Forge: live rendered card preview in the studio

Issue: #387. Status: approved in chat 2026-09-09 (approach: regenerate the frame kit from the
design team's Illustrator template, draw the chrome as SVG, keep washes and icons as images,
replace the old kit wholesale, remount the composite preview in the studio).

## Goal

Designers editing a card in `/forge/cards/[cardId]` see a rough rendered card beside the form
that updates instantly as they change type, brigade, alignment, stats, identifiers, text,
scripture and art. It is a draft, not the print graphic, and stays badged "preview approximate".

## Non-goals

- Pixel-accurate print output, set symbols, card numbers, promo text, watermark.
- Inline special-ability icons (star, cloud) inside the ability text.
- Any change to how cards are stored. The preview is a pure function of `DesignCard` + art URL.

## Source material and confidentiality

- `tmp/Card_Template-SHUFFLED_3.7.ai` (Illustrator 30.7, Aug 2026). Gitignored. Never committed,
  never uploaded, never copied into `public/`. Only derived rasters and numbers ship.
- The .ai's PDF-visible layer is one flattened configuration. Everything else lives in the
  Illustrator private data: 977 `AIPrivateData` streams that concatenate to a zstd-compressed
  PostScript dialect (`%AI24_ZStandard_Data`). Inside, every object carries its Layers-panel name
  (`/XMLUID`), so extraction is by name, not by guesswork.
- Washes are embedded PDFs (876x1194 CMYK at 318 ppi with soft mask). Icons are raw CMYK
  rasters (`XI` operator) with no alpha. Icon-box colors are vector rects with CMYK fills. The
  document profile is U.S. Web Coated (SWOP) v2 and is used for every CMYK to sRGB conversion.
- `tmp/card-template-allon-editor.html` is a low-resolution third-party export of the same
  objects. Not used as a source.

## Extraction pipeline

`scripts/forge-extract-template.py` (Python 3.11, Pillow with LittleCMS, `zstd` CLI, poppler's
`pdftoppm`/`pdftocairo`). Not run in CI. Documented as `make forge-frames` with the .ai path as
input. Idempotent: it regenerates `public/forge/frames/` in full.

Steps:
1. Parse the PDF wrapper, reassemble `AIPrivateData1..N` by object id using each stream's
   declared `/Length`, strip the `%AI24_ZStandard_Data` prefix, `zstd -d`.
2. Index objects by `XMLUID`. Locate the ASCII85 blocks that precede each wash/badge name and
   decode them (strip only the line-leading `%`; `%` is a valid ASCII85 digit). They are PDFs.
3. Rasterize washes at 300 dpi, crop to the frame rect (border rect 18..180 x 18..252 pt on the
   198x270 pt artboard, i.e. 675x975 px), encode WebP. Synthesize `red` and `teal` by hue-shifting
   `crimson` and `blue`; label them synthesized in the README.
4. Decode `XI` rasters (raw CMYK/Gray bytes, `W*H*4`), convert through the SWOP profile, key the
   flat white or black background to alpha for icons, encode PNG.
5. Rasterize badge PDFs (Artifact, Good/Evil Dominant nebula with lamb/reaper, multi-brigade foil)
   with transparency.
6. Emit `app/forge/lib/frameGeometry.ts`: brigade hex map (ICC-converted), slot rects and the
   ability gradient variants, all in a 750x1050 trim-box canvas. Conversion from artboard points:
   `px = (x - 9) * 750/180`, `py = (261 - y) * 1050/252`.

## Kit layout (replaces `public/forge/frames/Elements`, `Color=*`, `Icons`)

```
public/forge/frames/
  README.md
  washes/<slug>.webp      blue clay gold green purple silver white black brown crimson gray
                          orange pale-green red* teal* lost-soul-{roots,rebellion,inheritance}
                          artifact good-dom evil-dom good-fort evil-fort
  icons/<name>.png        cross skull dragon bible site fortress star cloud
                          territory weapon warrior
  badges/<name>.webp      artifact good-dom evil-dom lamb reaper multi-good multi-evil
```
`*` synthesized. OFL fallback fonts stay in `public/forge/fonts`; the printed title and stats faces
stream from the private Blob store (see "Printed fonts" below).

## Geometry (artboard points, origin bottom-left)

| Slot | Rect | Notes |
|---|---|---|
| Trim | 9..189 x 9..261 | 2.5 x 3.5 in, the preview's canvas |
| Border | 18..180 x 18..252, r 9.5 | 1.5 pt dark stroke, white outside |
| Art window | 27..171 x 102.81..234.44, r 7.7 | white fill when empty, dark stroke |
| Text box | 27..171 x 32.48..100.69, r 7.8 | vertical gradient light to black |
| Text inset | 30.6..167.4 | ability text top, scripture bottom |
| Identifier bubble | y 97.74..105.3, centered x 99, w 21.6..144 | black 75%, 0.5 stroke |
| Left icon box | 17.53..57.71 x 221.47..253.23 | over the border, 4 rounded corners; brigade fill |
| Right icon box | 139.47..181.39 x 220.54..254.87 | Covenant / Curse chalice only |
| Stat text | 22.92..51.33 x 244.62..252.76 | white, dark outline, in left box |
| Type icons | `ICON_RECTS` in frameGeometry.ts | from the rasters' placement matrices |
| Class icons | shield 17.14..38.47 x 192.9..217.9, territory plate below | over the border, stacked |
| Title band | y 235.1..248.55, right-aligned to x 171 | white, dark outline |
| Credits | y 20..31, right-aligned | "Illus. X", copyright |

Ability gradient (light until A%, black from B% of box height): 2 rows 73/86, 3 rows 64/77,
4 rows 54/68, 5 rows 47/60. Rows = estimated verse lines (~62 chars each) + the reference
line, clamped 2..5. Ability text fills the light region; the verse starts at the B% line so it
is always white-on-dark. The light region is white at 80% opacity over the wash (measured from
the template render), the dark region is the template's 100% K (#231f20).

Title: right-aligned Anton at 48 canvas px, shrinking to 36 for long names and then squeezed
with SVG `textLength` the way printed cards condense long titles. A second brigade's box
shortens the title band.

## Renderer (`app/forge/components/ForgeCardPreview.tsx`, rewritten)

Layers, bottom to top, inside a `750/1050` aspect container with `container-type: inline-size`:
1. White card ground with the trim corner radius.
2. Wash image at the border rect, rounded. Two brigades: second wash clipped to the right half
   with a soft SVG mask. Special types use their special wash (unchanged rules).
3. Uploaded art in the art window (`object-fit: cover`), or an empty white window.
4. SVG chrome (viewBox 0 0 750 1050): border stroke, art window stroke, text box with the
   gradient variant, identifier bubble, icon boxes (brigade fill, or badge image for Artifact,
   Dominant, 3+ brigades), stat text, class icons.
5. HTML text: title (Anton, right-aligned, dark outline), ability text (bold, dark), scripture
   (italic, white), reference (bold, white, right), identifiers (single bubble, joined), credits.
6. "preview approximate" badge (existing rule).

Mapping lives in `app/forge/lib/frameAssets.ts` (pure, unit-tested): `washPaths(card)`,
`iconBox(card, side)`, `typeIcon(card)`, `gradientRows(card)`, `BRIGADE_HEX`.

Type to icon: Hero cross, Evil Character skull, GE bible, EE dragon, Artifact chalice badge,
Dominant lamb/reaper badge, Fortress fortress, Site site, City fortress, Curse dragon,
Covenant bible, Lost Soul the era icon (default rebellion). Verified against real card images
before shipping; corrections go in the mapping table only.

## Studio mount

`StudioEditor` left column: finished-card image when present (unchanged), otherwise
`ForgeCardPreview` driven by the live `snapshot` and the card's art URL. `ForgeCardFace` stays
for grids, reveal, deck view and proposal diff. The deck builder already uses
`ForgeCardPreview` and inherits the new look.

## Testing and verification

- Vitest: mapping functions, geometry conversion, gradient row selection, every brigade has a
  hex and a wash, every card type has an icon, synthesized washes flagged.
- `tsc --noEmit` type gate (no `next build` beside a running dev server).
- Visual (done 2026-09-10): an SSR harness rendered a 12-card matrix (blank, Hero red with
  class icons, dual-brigade Evil Character, Lost Soul, Artifact with long text, Dominant,
  Fortress, GE with a long name, Site teal, 3-brigade multi foil with X / 6 (0) stats, Covenant
  with two class icons, Curse) at 300, 360 and 180 px and screenshots were checked by eye
  against real printed cards. A Playwright run against the studio, with every server-action
  POST blocked so nothing was written, confirmed: pick Hero → cross icon; pick Red → red wash;
  add Blue → second box and blended wash; identifiers, reference and scripture flow through.

## Print-rule corrections (2026-09-10, from printed cards)

Tim reviewed the first render against printed cards (Enoch CoW, Covenant with David K51):

- **One icon box.** A second brigade splits the top-left box into a top band (first
  brigade, with the stats) and a bottom band (second brigade, with the icon); the wash
  blends the same way, first brigade on top, second below. Three or more brigades use the
  multi-brigade foil in the box. There is no second box for brigades.
- **Lost Souls have no icon box.** The template's Lost Soul era icons are not shipped.
- **Covenants and Curses** carry the enhancement icon (bible / skull) in the left box and
  the artifact chalice in a second box on the right; the title centers between the boxes.
- **Stats** print for Heroes and Evil Characters always, and for GE / EE / Covenant / Curse
  when a value is entered (`stats: "optional"` in the applicability matrix; the form's
  stat inputs were already unconditional).
- **Type faces**, chosen by rendering candidates next to printed Roots / Roots 2 / Israel's
  Inheritance / Times to Come cards: titles in **Mukta ExtraBold** (humanist, spurless G,
  slanted t — the printed face is CG Symphony, a Syntax clone), stats in **PT Serif Bold**
  (the printed numerals are a bold serif). Anton (too condensed) and Archivo Black (too
  grotesque) were tried and rejected. Sizes are set from printed cap heights: title 40 px,
  stats 34 px on the 750-wide canvas. (Superseded by "Printed fonts" below: members now get
  the real faces, and these are the fallbacks.)
- **Verification**: twelve recent printed cards rendered side by side with the preview fed
  their own catalog data and cropped art (dual-brigade Heroes and Evil Character, GE and EE
  with stats, Lost Soul, Artifact, Dominant, Fortress, dual-brigade Curse, two Covenants).

## Icon corrections (2026-09-10, second pass against printed cards)

Tim flagged the bible and class icons as the wrong size, a white border around the chalice,
mixed sharp / round box corners, an illegible dragon and a territory icon with no plate. Each
was checked by overlaying the template's numbers on printed Roots / RR2 / II / T2C corners:

- **Icon placement comes from the template, not guesswork.** Every raster's `Xh` matrix
  places its top-left at (tx, ty) artboard pt at a·W x d·H; the extractor now emits those
  as `ICON_RECTS` (canvas px), including the lower "Stats" slot the template keeps for the
  skull and bible. Overlaid on prints, the bible, skull, dragon and fortress land exactly.
  The cross prints at ~75% of its template slot on every card checked, so it is scaled
  down about its center (`PRINT_SCALE`). The duplicate `-small` PNGs are gone (same pixels).
- **The chalice badge was the wrong raster.** The template holds three "Artifact" rasters;
  base-name matching picked the text-legend copy (204x162, white rounded corners baked in)
  over the box copy (170x158). The extractor now picks the copy placed in the top-left box
  (`corner_copy`), and badges carry the template's crop anchor (chalice bottom-aligned,
  good foil top-aligned).
- **Box shape.** Printed boxes have four rounded corners (~22 px on the canvas) and sit over
  the border, overhanging it by a hair, with the outer corner following the card corner. The
  preview now draws the box after the border stroke, unclipped, with that path.
- **Alpha is rebuilt by flood fill, not color distance.** Only the flat color reachable from
  the raster's edge is background, so the dragon (stored on the black box color) keeps its
  dark body and outline and reads on brown, black and the multi foil. The two class shields
  are one shield with opposite halves flattened to the background gray; their union is the
  silhouette, so each ships whole with its faded half opaque, as printed. The territory is
  an opaque rounded plate with the print's dark outline.
- **Class icons** draw at the template's size (shield 89x104 canvas px) directly under the
  box, over the border, stacked shield(s) then territory.
- **Stat numbers (2026-09-10, third pass):** printed stats have no outline. Measured on ten
  Roots / Roots 2 / T2C cards, the digits' tops sit 6 px below the box top and their bottoms
  at 33 px, centred (2 px left of the box centre), at ONE size whether the value is "9/6" or
  "10/11" — 41 px on the canvas, which matches the printed widths of "11/9" (62 px) and
  "10/11" (75 px). The preview had drawn them at 34 px (28 for five characters) with a
  2.6 px outline, ten pixels lower. Dark digits on light boxes (white, silver) stay, outline gone.
- **Title shadow (2026-09-10):** printed names are not outlined; they carry a hard shadow
  offset to the lower right (about 3 canvas px each way, the glyph's own weight) and a
  hairline dark edge that reads as the ink spread around white type. The preview drew a
  uniform 2.8 px outline. It now draws the name twice: a dark copy translated (3, 3) with a
  1 px stroke, then the white face with a 1.2 px edge (`TITLE_SHADOW`, `TITLE_EDGE`), both
  with the same squeeze and clip. Checked against Michael, Abram, The Goat, I Am Patience at 6x.
- **Fonts, for the record:** the printed title face is Symphony Black (Agfa/Monotype) and the
  printed stats face is Grail Light (SoftKey/WSI, "redistribution strictly prohibited"); both
  are proprietary and stay out of the repo. Arimo (OFL) is already the body face.

## Printed fonts (2026-09-10, private Blob)

Tim holds the printed faces and wants members to see them without the app redistributing
them, so they are served the same way private card art is:

- `scripts/forge-upload-fonts.ts` (`make forge-fonts`) puts `tmp/SYMPHOBL.TTF` and
  `tmp/grail.ttf` into the **private** forge Blob store under the fixed keys
  `forge-fonts/title.ttf` and `forge-fonts/stat.ttf` (`forgeFontKey` in `app/forge/lib/art.ts`).
  The files stay gitignored; nothing font-shaped is committed.
- `app/forge/api/fonts/[face]/route.ts` streams a face to a forge member (`requireForge`) as
  `font/ttf` with `Cache-Control: private, max-age=31536000, immutable`; everyone else gets the
  same 404 as the rest of `/forge`. Unknown faces 404 before any store read.
- `app/forge/forge-fonts.css` keeps the `ForgeTitle` / `ForgeStat` families but lists the route
  URL (`?v=1`, bump after re-uploading) as the first `src` and the OFL file as the second: the
  browser activates the substitute only when the route fails, so nothing else changes.
- Metrics (parsed from the TTFs): Symphony Black cap height 0.73 em, ~0.53 em per title
  character (Mukta ExtraBold: 0.63 / 0.47); Grail Light cap height 0.70 em, the same as PT
  Serif Bold, and narrower. The title constants move to `TITLE_MAX` 36 / `TITLE_MIN` 25 /
  `TITLE_EM` 0.57 to keep the printed ~26 px cap height; stat sizes are unchanged.

## Text fit (2026-09-10, printed metrics + "doesn't fit")

The design team's first pass on every set is finding abilities that don't fit the card. The
preview used to shrink long abilities and centre them, which hides exactly that. It now sets
the text box the way the cards are printed and says when the ability collides with the verse.

**Measured off eight printed cards** (Roots, Roots 2, Israel's Inheritance, Times to Come),
canvas px relative to the top of `RECTS.textBox` (y 668, h 284, inset 570 wide):

| | Print | Preview now |
|---|---|---|
| Ability | Helvetica/Arimo Bold, fixed size regardless of length; cap tops 24 px below the box top; 31.6 px pitch; centred; full inset width | same: `TEXT_METRICS.ability` = 30.9 px / 31.6 px pitch / block top 19.6 |
| Dual-type ability | each half its own paragraph (with a type icon) | paragraphs split at `/ A:`-style prefixes, 10 px gap; icons are still a follow-up |
| Verse | Helvetica/Arimo Italic, justified, 23 px pitch, stacked upward from the reference | same: `TEXT_METRICS.verse` = 22.9 px / 23 px pitch, last line box ends at 257.5 |
| Reference | bold, right-aligned, cap tops 256 px below the box top | same: 19 px, line box at 253.5 |
| Gradient | Roots / IR ran the transition across the first verse row; Roots 2 onward are fully dark by the first verse line with the transition in the ~28 px above it; moves with the verse | `gradient.dark = verseTop - 2`, `light = dark - 28` (the template's four fixed variants are no longer used) |

**Sizes come from line breaks, not cap heights.** Each printed break bounds the measure in
ems from both sides (the line fits, the next word does not). For the bold ability the
eighteen breaks on six cards leave a single window, 30.80 < size <= 30.99 px at the 570 px
inset, so 30.9 reproduces every one of them. The italic verse can't be pinned as tightly
because the print kerns it and the width table cannot: 22.9 px reproduces seven of eight
verses; the eighth differs by one word.

**How it works.** `scripts/forge-font-metrics.py` reads the advance widths of Arimo Bold and
Italic from `public/forge/fonts` into the generated `app/forge/lib/fontMetrics.ts`.
`app/forge/lib/textFit.ts` wraps text greedily the way the browser does (spaces, and after
hyphens inside words; explicit newlines respected; runs of spaces collapse) and returns the
wrapped ability paragraphs, the verse lines, the block edges, the gradient stops and `over`,
the number of ability lines that collide with the verse (`minGap` 18 px of room above the
verse's first line box; the tightest printed card leaves 22). It is
pure, so a set-wide pass can call it server-side. The renderer draws the ability with the
lines `textFit` produced (`white-space: pre`, `font-kerning: none`) so the picture and the
verdict cannot disagree; the verse flows naturally (justified) and is bottom-anchored on the
reference, so a wrap difference there only nudges the gradient. `over > 0` shows a red pill
at the bottom left, "Ability doesn't fit · N lines over", next to the existing "preview
approximate" pill, and the ability visibly runs into the verse.

**Verification:** `textFit` tests pin the printed line breaks of six abilities and six
verses; printed | preview pairs with the real verses typed in match line for line; synthetic
cases cover 1 line over, 4 lines over, dual-type paragraphs and a card with no verse (the
reference line is the floor).
- **Verification**: twelve printed cards | preview pairs plus four synthetic cases (3-brigade
  Evil Character on the foil, dual-brigade Covenant with a territory plate, Hero with both
  shields and a territory, Site).

## Title contour (2026-09-10, second look at the printed names)

The drop shadow from the title-shadow pass was right but incomplete: printed names also carry
a **black contour all the way around each letter**, which is what actually lifts them off a
busy wash. The preview's `TITLE_EDGE` was a 1.2 px hairline, effectively invisible; it is now
**3 canvas px**, painted under the fill (`paint-order: stroke`) so the letters keep their
weight, with the offset shadow unchanged behind it.

The value was chosen against printed Israel's Inheritance cards on light washes (Joshua's
Covenant, I Am Refuge, Israel Turned Away, Joab the General, Quake in Edom), rendered at the
scans' own resolution -- 365 px wide, which is 750 canvas px at the scan's 2.055 px scale --
and compared at 8x. **Render the ladder with the real Symphony Black** from the private font
route, not the OFL fallback: Mukta ExtraBold is wider and heavier and reads a contour about
half a pixel thinner than it is. Automatic measurement does not work here. A run-length read
of the dark band above a letter gives 2-3 scan px on the printed cards but saturates at 1 px
on every candidate, because the render is crisp and the thresholds only catch full black; the
10-90% edge rise is 1 px on both, so there is no blur to compensate for either. Judge the
crops by eye, as with the shadow. Across the five cards the printed contour brackets 2.5 and
3.5 and sits nearest 3; a fixed-width stroke also explains why it reads heavier on the smaller
type a long name shrinks to, which is what the printed cards show.

The contour and the shadow both sit outside the glyphs, so the clip that keeps the title off
the icon box now stands off the text by `TITLE_PAD` (4 px) -- without it the last letter of a
title that fills the width comes out shaved.

## All text on the canvas (2026-09-10, Safari page zoom)

A forge member reported the ability text running off the text box in Safari; a hard refresh
did not help, and it reproduced only when the page was zoomed. **WebKit multiplies
container-query units by the page-zoom factor a second time.** Measured with Playwright
(WebKit 2287 vs Chromium, `zoom` on the root element, the same code path as Safari's Cmd+ and
its per-site zoom setting): at zoom Z, `width: 10cqw`, `padding: 10cqw` and `font-size: 10cqw`
all come out Z times too large relative to their container (`getComputedStyle` font-size
40px -> 60px at zoom 1.5), while `px`, `%`, `em`, `vw` and SVG `<text>` inside a `viewBox`
are all correct. Chromium is right for every unit; Firefox zooms device pixels, so it cannot
hit this at all. Safari remembers zoom per site, so a reader who pressed Cmd+ once, months
ago, sees it on every visit and has no reason to connect the two.

The preview sized its text in `cqw` and drew the ability at fixed printed line breaks
(`white-space: pre`), so the lines could not re-wrap: they simply ran past the box. The fix
is to stop using container units. The frame was already drawn in a `<svg viewBox="0 0 750
1050">`, where the browser's own scaling is correct, so the ability, verse, reference,
identifier bubble, credits, "NO ART" placeholder and the two annotation pills all moved into
that canvas as SVG, and the three remaining `cqw` corner radii became percentages of their
own box. `container-type` is gone from the component.

Text that used to be laid out by CSS is now positioned arithmetically, so the printed metrics
carry over unchanged: a CSS line box puts its baseline half-leading plus ascent below its
top, which for Arimo (ascent 1854/2048, descent 434/2048) is `baselineIn()` in the renderer.
Justification is explicit too -- every verse line but the last gets the `word-spacing` that
spreads its measured width to the full 570 px, which is what print does and what
`text-align: justify` did before. The pills are the one deliberate difference: they are set
bold so their width can be measured with the same advance tables.

**Verification:** old and new rendered side by side in Chromium at zoom 1 agree to within
1 canvas px on 51 text runs (ability, verse, reference, identifier, "NO ART"); the frames are
pixel-identical. The credits sit ~1.9 canvas px (0.9 screen px on a 340 px card) lower, which
is Chromium snapping the old HTML baselines to whole device pixels while SVG places them
exactly. In WebKit the widest text run held at 96.4% of the card at zoom 1, 1.1, 1.25, 1.5
and 2, where the old build reached 125% and 163% with 5 of 6 cards overflowing. Unit tests
assert the markup carries no container units, that each wrapped ability line is its own
`<text>` exactly one printed pitch below the previous, and that the verse justifies every
line but the last.

## Multi-brigade frames (2026-09-13, from printed cards)

Tim flagged a Crimson / Evil Gold / Gray Evil Enhancement whose border blended only the first
two washes and whose box was the multi foil. Eighteen printed 3-brigade, 4-brigade and "Multi"
cards (PoC, LoC, RoJ, IR, RR, RR2) were pulled from the catalog and sampled down the box and
the right border:

- **The box bands every brigade.** Army of a Million Men and Mercenary Chariots, which have the
  reported card's brigades, print three equal bands (20 / 23 / 21 px of a 64 px box), top to
  bottom in the listed order. Self, Triumphal Entry and Covenant with Moses break at the same
  third. The two-brigade 45 / 55 split is unchanged.
- **The foil is only for "Multi".** Faith and Fountain of Living Water (good), and Pagan
  Sailors, Foolish Shepherd and Mourn and Weep (evil), are cards whose brigade is literally
  Multi, and they carry the foil. No card with listed brigades does. The forge stores Multi as
  the full list (Decision #2), so the foil now shows only when every brigade of one alignment
  is selected. It is also that card's wash, flagged approximate because the template has no
  multi wash.
- **The wash blends every brigade, top to bottom.** Self (Black / Crimson / Orange) runs all
  three, and so do A New Beginning and Potential in the Land. Where the bands meet varies by
  card (about 21% / 66% on Self, 17% / 82% on the other two), so the preview uses equal bands,
  each fading in over 40% / N of the height; two brigades still fade 40% to 60%. Some prints
  use one wash (Army of a Million Men is all crimson) or custom art. Those are designer
  choices, and the preview does not guess at them.
- Three or more brigades are no longer flagged approximate.

**Making a Multi card (2026-09-13, follow-up).** Designers had no way to say "Multi" short of
clicking every brigade chip, and promotion then wrote a nine-name list the catalog never uses.
The brigade picker now has **Good Multi** and **Evil Multi** buttons that select (or clear)
that alignment's whole set, and the details summary shows "Good Multi" instead of nine names.
Storage is unchanged: still the explicit list, no sentinel. A `GoodMulti` value would break the
three `Record<Brigade, …>` maps, sort after every single brigade and miss every brigade filter.
The Lackey export, and therefore promotion, writes exactly that set on a card of the matching
alignment as `Multi`, which the deck builder already expands back. Any other combination stays
a list. Importing `Multi` on a Good or Evil row yields the full set; a Neutral or dual row still
warns, because the catalog's Neutral Multi (8 Sites and Philosophy) doesn't say which set it
means. The shared rule is `multiBrigadeSide` in `designCard.ts`.

## Follow-ups (not in this change)

- Inline ability icons, set symbol, card number, watermark.
- Other surfaces (grid, reveal, deck view) adopting the composite.
