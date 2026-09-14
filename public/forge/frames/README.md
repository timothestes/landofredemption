# Forge card-frame kit

Derived from the design team's Illustrator card template (Card_Template 3.7, Aug 2026) by
`scripts/forge-extract-template.py` (`make forge-frames`). The template itself is confidential:
it lives in the gitignored `tmp/` folder and is never committed or uploaded. Only these derived
files ship. Layout canvas = **750x1050** (the 2.5 x 3.5 in trim box at 300 dpi). Slot geometry
and brigade colors are generated into `app/forge/lib/frameGeometry.ts`; the card-to-asset
mapping is `app/forge/lib/frameAssets.ts`; the renderer is
`app/forge/components/ForgeCardPreview.tsx`, which draws the chrome (border, windows, text box
gradient, icon boxes) as SVG from that geometry.

## `washes/` — full-frame textures (WebP, 675x975 = the border rect)
`blue clay gold green purple silver white black brown crimson gray orange pale-green`, plus the
type washes `artifact good-dom evil-dom good-fort evil-fort` and
`lost-soul-{roots,rebellion,inheritance}` (`lost-soul.webp` is a copy of the rebellion one).
Lost Souls print without an icon box.
Both golds share `gold`. `red` and `teal` are **not in the template**: they are hue-shifted from
`crimson` / `blue`, and the preview flags cards using them as approximate.

## `icons/` — type and class icons (PNG with rebuilt alpha)
`cross skull dragon bible site fortress star cloud territory weapon warrior`. The template
stores icons without alpha, so it is rebuilt at extraction: only the flat color touching the
raster's edge is background (flood fill), which keeps dark outlines and interiors — the dragon
sits on black in the template. `warrior` / `weapon` are one shield with opposite halves lit;
their union is the silhouette, so each ships whole with its faded half opaque, as printed.
`territory` is an opaque rounded plate with the print's dark outline. Where each icon sits
(and the lower slot used when stats print) is `ICON_RECTS` in `frameGeometry.ts`, from the
template's placement matrices; the cross is scaled to 75% of its slot, the size it prints.

## `badges/` — box-filling composites (WebP)
`artifact` (chalice), `lamb` / `reaper` (Good / Evil Dominant), `good-dom` / `evil-dom` (the
nebulae, also under Fortress boxes), `multi-good` / `multi-evil` (the printed "Multi" foil: a
card of every brigade of one alignment, in the box and as its wash; cards with listed brigades
print banded boxes instead).

Fonts (libre substitutes for the template's Symphony Black / Arial) live in `../fonts/`.
