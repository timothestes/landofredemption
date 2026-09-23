# Forge print-parity A/B

Measures how far the Forge's composited card is from what the design team's Illustrator
template produces, pixel for pixel, element by element — so "the title looks small" becomes
"the title is 36 px where the finished card is 37.5 px, 4 px right and 4 px low".

## What you need

- A Forge set whose cards carry the design team's **finished images** (the "real" set) and a
  set with the **same cards as Forge data** (the "test" set); cards pair by title.
- The licensed faces in gitignored `tmp/` (`SYMPHOBL.TTF`, `grail.ttf`) — the renderer and
  the size fits both need them. `.env.local` with the private Blob token and the service key.
- `python3.11` with Pillow, numpy and scipy (the same interpreter `make forge-frames` uses).

## Run it

```bash
OUT=/tmp/parity   # anywhere outside the repo
npx tsx --tsconfig scripts/forge-print-parity/tsconfig.json scripts/forge-print-parity/fetch.ts \
    --real <finished set id> --test <forge set id> --out $OUT
npx tsx --tsconfig scripts/forge-print-parity/tsconfig.json scripts/forge-print-parity/render.ts \
    --cards $OUT/render-input.json --fonts tmp --out $OUT/ours
python3.11 scripts/forge-print-parity/compare.py \
    --pairs $OUT/pairs.json --real $OUT/finished --ours $OUT/ours --fonts tmp --out $OUT/report
```

`fetch.ts` downloads the finished images and writes the pairing; `render.ts` draws the test
set through the very renderer play surfaces use (`renderCard.ts`, resvg, the real fonts);
`compare.py` registers every pair on the frame's four border lines, measures both, and writes:

- `summary.md` — one row per metric: real median, ours median, delta (real − ours) with its
  10th / 90th percentile across the set. A tight spread around zero means the element matches;
  a tight spread around a number is a systematic offset to fix; a wide spread means the
  measurement (or the data) is noisy — look at the triptychs before believing it.
- `titles.md` — the per-card title fit (font size from height and from width, condensing
  ratio, right edge, baseline), longest names first.
- `report.json` — every measurement of every card, both sides.
- `triptych/<id>.jpg` — ours | real | amplified difference, with the measured title boxes.
- `heat.png` — the mean absolute difference over the whole set, art window masked: the map of
  what is still off.

## How the measuring works

- **Registration.** The darkest column / row in each outer margin is the border stroke; its
  centroid (not its argmin — a wide stroke has a flat minimum) gives sub-pixel positions, and
  an affine warp puts the image on the 750×1050 canvas. Both images go through it, so a bias
  in the method cancels.
- **Font sizes are fitted, not read.** The same string is rendered with the real font (PIL)
  and the measured ink extents give the size that produced them, along x and along y
  separately; their ratio is the condensing. Sizes read off finished cards this way land within
  0.5 px of the true value on our own renders.
- **Text lines** come from the row ink profile: it peaks once per line at the x-height band,
  which every letter has ink in, so lines whose descenders touch the next line's ascenders
  still separate and a short last line is still found. x-height ÷ 0.519 is the size for an
  Arial-metric face.
- **Windows dodge what is not the element**: the icon box's rounded corners, the art painting
  (never trusted inside the window), the frame strokes, the catalog's bracketed name suffix
  (`[EoT]`), and a Lost Soul's title, which prints as just "Lost Soul".

## Reading the first run (End of Times, 2026-09-22)

Recorded in `docs/superpowers/specs/2026-09-09-forge-live-card-preview-design.md`, "Print
parity A/B". Short version: the ability text already matched line for line; the title was 36 px
(not 9 pt = 37.5), 4 px right and 4 px low, and shrank long names the finished cards set at
full size; the reference and credits were a size too small; the pill was translucent black
where the real one is opaque gray; the border stroke was 1.5 pt where the cards print 1 pt.
