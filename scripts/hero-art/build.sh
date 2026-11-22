#!/bin/zsh
# Builds the home-page masthead art, one file per theme:
#   public/brand/hero-art-light.webp   dark pen drawing on the light page colour
#   public/brand/hero-art-dark.webp    night: only the face catches the light
#   public/brand/hero-art-jayden.webp  stained glass: the theme's red→pink→violet→blue spectrum as light
# All three share one crop, so switching themes re-inks the same picture in the same place.
# Each file is opaque and already sits on its theme's --background (the masthead band is
# bg-background), so the page needs no blend modes. If a theme's --background changes in
# app/globals.css, update BG_* below and re-run.
#
# Source: the archived WordPress splash PNG (2030x1574, grey values only 17-41/255), at
#   tmp/public_html/wp-content/uploads/2023/09/lor-login-splash.png  (from the WP export; not in git)
# public/lor-login-splash.webp is the same picture but lossy; the level stretch below
# amplifies its artifacts ~10x, so use the PNG.
#
# Usage: zsh scripts/hero-art/build.sh <path/to/lor-login-splash.png>
set -e
SRC=${1:?usage: build.sh <lor-login-splash.png>}
REPO=${0:A:h:h:h}
OUT=$REPO/public/brand
W=$(mktemp -d)
Q=(-quality 74 -define webp:method=6)

BG_LIGHT="#f9f9fb"   # :root   --background 220 27% 98%
BG_DARK="#111827"    # .dark   --background 221 39% 11%
BG_JAYDEN="#0a080c"  # .jayden --background 270 20% 4%

# ---- Shared crop (plate px 1240x725+430+110 -> 1200x701): head, fist and outstretched hand.
CROP=(-crop 1240x725+430+110 +repage -filter Lanczos -resize 1200x701!)

# Tonal master: restore levels, then selective blur melts the posterized sky terraces but spares the ink.
magick $SRC -colorspace gray -depth 16 -auto-level -selective-blur 0x5+9% -selective-blur 0x3+7% $CROP $W/c.miff

# Ink master: divide by a wide blur so flat fills go to paper and only linework + local shading survive.
magick $SRC -colorspace gray -depth 16 -blur 0x0.7 -auto-level -blur 0x0.8 \
  \( +clone -blur 0x30 \) -compose Divide_Dst -composite -auto-level -level 5%,95% $CROP $W/ink.miff

# Figure matte: flood-fill the open sky from one seed, grow back, feather. fig = 1 on the figure.
magick $W/c.miff -depth 8 -morphology Erode Disk:2 -colorspace sRGB -type TrueColor \
  -fuzz 22% -fill "#ff0000" -floodfill +700+40 "gray(80%)" \
  -fill black -fuzz 0 +opaque "#ff0000" -fill white -opaque "#ff0000" -colorspace gray \
  -morphology Dilate Disk:2 -blur 0x1.2 -negate $W/fig.png

# Light maps. ldir: key light from the upper right. spot: a tight light on the face.
magick -size 1200x701 xc: -fx "pp=(j*0.9-(i-600)*0.42)/701; tt=max(0,min(1,(pp+0.1)/1.1)); 1-tt*tt*(3-2*tt)" $W/ldir.miff
magick -size 1200x701 xc: -fx "dd=min(1,hypot((i-600)/560,(j-210)/430)); 1-dd*dd*(3-2*dd)" $W/spot.miff
# Jayden's spectrum at 135deg: red top-left -> pink -> violet -> blue bottom-right.
magick -size 1200x701 xc: -sparse-color Barycentric "0,0 #ff2a2a  700,0 #ff2a9a  1200,350 #8a2be2  1200,701 #2a4dff" $W/spectrum.miff

# Gradient maps. night: black -> slate -> cool silver. ink: light-theme tokens
# (foreground -> muted-foreground -> border -> background).
magick -size 1x110 gradient:"#000000-#2a3346" -size 1x100 gradient:"#2a3346-#7d8aa3" -size 1x46 gradient:"#7d8aa3-#c9d2e0" -append $W/clut-night.png
magick -size 1x128 gradient:"#121826-#606876" -size 1x90 gradient:"#606876-#dcdfe5" -size 1x38 gradient:"#dcdfe5-$BG_LIGHT" -append $W/clut-ink.png

# Light: dark ink on the page's own paper colour. The ink pass keeps fine grain in the cape's
# solid blacks, which WebP pays heavily for; a 0.5px blur + lower quality halves the file.
magick $W/ink.miff -blur 0x0.5 -colorspace sRGB -type TrueColor $W/clut-ink.png -clut \
  -quality 62 -define webp:method=6 $OUT/hero-art-light.webp

# Dark: only the face is lit; sky black; the body sinks into the band. Screened onto the page colour.
magick $W/c.miff \( $W/spot.miff +level 4%,100% \) -compose multiply -composite $W/fig.png -compose multiply -composite \
  -level 2%,80% -colorspace sRGB -type TrueColor $W/clut-night.png -clut \
  \( -size 1200x701 xc:$BG_DARK \) -compose screen -composite $Q $OUT/hero-art-dark.webp

# Jayden: the upper-right key light passes through the spectrum; white only at the top of the range.
magick $W/c.miff \( $W/ldir.miff +level 10%,100% \) -compose multiply -composite $W/fig.png -compose multiply -composite \
  -level 3%,78% -colorspace sRGB -type TrueColor $W/j.miff
magick $W/j.miff $W/spectrum.miff -compose multiply -composite \
  \( $W/j.miff -evaluate pow 2.5 -evaluate multiply 0.55 \) -compose screen -composite \
  \( -size 1200x701 xc:$BG_JAYDEN \) -compose screen -composite $Q $OUT/hero-art-jayden.webp

rm -rf $W
ls -la $OUT/hero-art-*.webp
