# Home masthead art, one treatment per theme

**Ask (Tim, 2026-11-22):** a hero version curated for each mode; the shared navy band "doesn't quite work". Take the hero image and treat it per theme.

**Before:** light and dark showed the same navy band with the crushed splash plate on the right; phones and tablets got no art; Jayden made the band transparent and dropped the art, leaving the figure nearly invisible on its tinted plate.

## Approaches considered
Three idea agents (print techniques, lighting, theme-token gradient maps) rendered 18 treatments through a mock of the masthead. Tim picked from the best two or three per theme ("your picks"):

| Theme | Treatment | Why |
|---|---|---|
| Light | Pen drawing: ink-only pass of the plate, gradient-mapped through the light tokens onto the page colour. No dark band. | Light mode finally reads as light; the source can't turn into a grey smear because the fill is gone and only linework remains. |
| Dark | Only the face catches the light; the body sinks into the band. | One focal point, quiet, the area behind the text stays plain. |
| Jayden | Stained-glass light: the upper-right key light passes through the theme's red → pink → violet → blue spectrum. | The figure is visible again and carries the theme's colours as light, not tint. |

Rejected: halftone/woodcut prints (fragmented at display size), keeping a dark nameplate in light mode, a full-figure lit-from-behind dark version (grey haze), a gradient-band Jayden (murkier figure).

## Decisions
- **Band = `bg-background` in every theme.** Light and dark masthead disappears into the page; Jayden gets a solid near-black masthead over its tinted plate. A see-through Jayden band was tried: it needs an alpha channel, which put the file at 60-95 KB, so it was dropped.
- **Each file is opaque and pre-composited onto its theme's `--background`.** No blend modes, no runtime filters. If a theme's `--background` changes, update `BG_*` in `scripts/hero-art/build.sh` and rebuild.
- **One shared crop** (plate 1240x725+430+110 → 1200x701), so switching themes re-inks the same figure in the same place.
- **File chosen by a `--hero-art` CSS variable** in each theme block of `app/globals.css`. Only the active theme's file downloads (verified), and it can't flash the wrong theme since next-themes sets the class before paint.
- **Layout:** from `md` the figure fills the right of the band (`42%` wide at md, `min(60%,52rem)` at lg), faded in from the left. Below `md` a head-and-shoulders crop of the same file sits top-right beside a narrower wordmark (`56%`) and fades out before the subtitle.
- Hero text moves from hard-coded light colours to `text-foreground` / `text-muted-foreground`; the wordmark swaps `lor-wordmark-dark.webp` / `lor-wordmark.webp` the way the nav does.

Files: light 58 KB, dark 22 KB, Jayden 37 KB. Source PNG lives only in the WordPress export (`tmp/public_html/wp-content/uploads/2023/09/lor-login-splash.png`, gitignored); the build script documents why the lossy `public/lor-login-splash.webp` is not a usable source.
