#!/usr/bin/env python3.11
"""Regenerate public/forge/frames/ from the design team's Illustrator card template.

The source .ai is CONFIDENTIAL and gitignored (tmp/). Only derived rasters and numbers
leave this script. See docs/superpowers/specs/2026-09-09-forge-live-card-preview-design.md.

Requires: Python 3.11+, Pillow (with LittleCMS), the `zstd` CLI and poppler (`pdftoppm`,
`pdftocairo`).

    python3.11 scripts/forge-extract-template.py --ai tmp/Card_Template-SHUFFLED_3.7.ai

How the .ai is laid out (Illustrator 30.x, "PDF compatible" save):
  * The PDF-visible page is one flattened configuration and is NOT used.
  * Object 27's /Private dict lists AIPrivateData1..N; the streams concatenate to
    `%AI24_ZStandard_Data` + zstd frames of Illustrator's PostScript dialect.
  * Every art object carries its Layers-panel name as `%_/XMLUID : (Name) ; (AI10_ArtUID)`,
    written AFTER the object's drawing ops. So "the object named X" = the ops between the
    previous XMLUID and X's XMLUID.
  * Washes and badges are placed PDFs stored as ASCII85 blocks (line-prefixed with `%`,
    and `%` is also a valid ASCII85 digit, so strip only the line-leading one). Two washes
    (Gray, Black) are full-artboard DeviceGray rasters instead.
  * Icons are raw rasters: `[a 0 0 d tx ty] W H 0 Xh ... %%BeginData: N\\rXI\\n<N-3 bytes>`,
    CMYK or Gray, no alpha in the pixel data (Illustrator keeps it in a cache the file does
    not carry). Alpha is rebuilt here: the flat background is whatever touches the raster's
    border (flood fill), so an icon's dark outlines and interior survive; the two class
    shields are the same shield with opposite halves lit, so their union is the silhouette.
    The matrix places the raster's TOP-left at (tx, ty) in artboard points, at a*W x d*H —
    that is where every icon rect in frameGeometry.ts comes from.
  * The document CMYK profile (U.S. Web Coated SWOP v2) is an ICCBased /N 4 stream in the
    PDF wrapper; every CMYK->sRGB conversion here goes through it.
"""
from __future__ import annotations

import argparse
import base64
import colorsys
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import zlib
from collections import deque
from pathlib import Path
from typing import NamedTuple

from PIL import Image, ImageChops, ImageCms, ImageDraw, ImageFilter

# ----------------------------------------------------------------------------- geometry
# Artboard is 198x270 pt (origin bottom-left). Trim box = 9..189 x 9..261 (2.5 x 3.5 in).
# Rects below were measured from the named objects' paths (see spec). Canvas = 750x1050.
TRIM = (9.0, 9.0, 189.0, 261.0)
CANVAS = (750, 1050)
RECTS_PT = {
    # name: (x0, y0, x1, y1, corner radius) in artboard points
    "border": (18.0, 18.0, 180.0, 252.0, 9.5),
    "art": (27.0, 102.81, 171.0, 234.44, 7.7),
    "textBox": (27.0, 32.48, 171.0, 100.69, 7.8),
    "textInset": (30.6, 34.05, 167.4, 95.18, 0),
    "idBubble": (27.0, 97.74, 171.0, 105.3, 3.78),  # max width; centered on x=99
    "leftBox": (17.53, 221.47, 57.71, 253.23, 0),
    "rightBox": (139.47, 220.54, 181.39, 254.87, 0),
    "statText": (22.92, 244.62, 51.33, 252.76, 0),
    "classIcons": (17.0, 200.0, 41.0, 229.0, 0),
    "title": (60.0, 235.1, 171.0, 248.55, 0),
    "credits": (60.0, 19.5, 171.0, 31.5, 0),
}
# Ability-box gradient: light until `light`% of box height, black from `dark`% (top-down),
# by number of scripture rows. Measured from "Unnamed gradient 13/5/6/8" ramp points.
GRADIENT_ROWS = {2: (73, 86), 3: (64, 77), 4: (54, 68), 5: (47, 60)}
BORDER_STROKE_PT = 1.5

# ----------------------------------------------------------------------------- names
# Illustrator object name (prefix, before the numeric suffix) -> wash slug
WASHES = {
    "Pale_Green": "pale-green", "Orange": "orange", "Gray": "gray", "Crimson": "crimson",
    "Brown": "brown", "Black": "black", "White": "white", "Silver": "silver",
    "Purple": "purple", "Green": "green", "Gold": "gold", "Clay": "clay", "Blue": "blue",
    "Lost_Soul-Inheritance": "lost-soul-inheritance", "Lost_Soul-Roots": "lost-soul-roots",
    "Lost_Soul-Rebellion": "lost-soul-rebellion", "Fortress-Evil": "evil-fort",
    "Fortress-Good": "good-fort", "Artifact": "artifact", "Evil_Dominant": "evil-dom",
    "Good_Dominant": "good-dom",
}
LOST_SOUL_DEFAULT = "lost-soul-rebellion"
# (slug, source slug, hue shift in degrees) — washes the template does not ship.
SYNTHESIZED = [("red", "crimson", 25), ("teal", "blue", -50)]
# Placed-PDF badges: name prefix -> output slug
BADGE_PDFS = {"Evil": "evil-dom", "Good": "good-dom", "Reaper": "reaper", "Lamb": "lamb"}
# Raw rasters, keyed by the base name of the XMLUID that FOLLOWS the raster data
# (copies share pixels): name -> (output slug, kind).
# kind: "icon" = flat background keyed to alpha; "shield" = the two class shields, keyed
# together; "plate" = opaque rounded plate (territory); "badge" = opaque, box-filling.
RASTERS = {
    "Cross": ("cross", "icon"), "Skull_no_Stats": ("skull", "icon"), "Dragon": ("dragon", "icon"),
    "Bible_no_Stats": ("bible", "icon"), "icon_x5F_site": ("site", "icon"),
    "Fortress_Icon": ("fortress", "icon"), "Star": ("star", "icon"), "Cloud": ("cloud", "icon"),
    "Warrior_small": ("warrior", "shield"), "Weapon_small": ("weapon", "shield"),
    "Territory_small": ("territory", "plate"),
    "Artifact": ("artifact", "badge"), "Multi_Evil": ("multi-evil", "badge"),
    "Multi_Good": ("multi-good", "badge"),
    # The Lost Soul era icons (Roots-Green, Rebellion-Black, Inheritance-White) are not
    # shipped: printed Lost Souls have no icon box.
}
# Where each icon sits in the top-left box (frameGeometry.ICON_RECTS key -> base name).
# The "Stats" variants are the same pixels placed lower, under the strength/toughness.
# Every icon prints at the template's placed size, the cross included: twelve Heroes across
# Roots, IR, Roots 2, II and T2C measure the printed stem at 75-77 canvas px, the full slot
# (an earlier check had it at 75% of the slot, which drew it 56 px tall).
PLACEMENTS = {
    "cross": "Cross", "dragon": "Dragon", "skull": "Skull_no_Stats",
    "skullStats": "Skull_w_x2F_Stats", "bible": "Bible_no_Stats",
    "bibleStats": "Bible_w_x2F_Stats", "fortress": "Fortress_Icon", "site": "icon_x5F_site",
    "shield": "Warrior_small", "territory": "Territory_small",
}
# Rasters converted with black-point compensation. Without it SWOP's rich black lands at sRGB
# ~36, and the chalice's black stripes came out grey next to printed artifacts (RR2 / T2C / II
# scans: 5th-percentile lightness 44 against the prints' 17; compensated gives 12). The brigade
# box fills are compensated too (see brigade_fill); the other icons are not, it makes them worse.
BLACK_POINT_COMPENSATED = {"Artifact"}
BRIGADE_BOX_NAMES = ["Pale_Green", "Orange", "Gray", "Crimson", "Brown", "Black", "White",
                     "Silver", "Purple", "Green", "Gold", "Clay", "Blue"]

RASTER_HEADER = re.compile(
    rb"/(Device\w+) XN\r\[ ?([-\d.]+) [-\d.]+ [-\d.]+ ([-\d.]+) ([-\d.]+) ([-\d.]+) ?\] "
    rb"\d+ \d+ 0 Xh\r\[[^\]]*\] \d+ \d+ \d+ \d+ "
    rb"(\d+) (\d+) (\d+) (\d+) \d+ \d+ \d+ \d+ \d+ \d+ \d+ \d+\r%%BeginData: (\d+)\rXI\n"
)


class Raster(NamedTuple):
    name: str | None
    cs: str
    w: int
    h: int
    bits: int
    data: bytes
    # Placement matrix: raster TOP-left at (tx, ty) artboard pt, scaled by (sx, sy).
    sx: float
    sy: float
    tx: float
    ty: float
FILL_OP = re.compile(rb"[\r\n]([0-9.]+) ([0-9.]+) ([0-9.]+) ([0-9.]+) k[\r\n]")


def base_name(n: str) -> str:
    """Strip Illustrator's `_000..._` uniqueness suffix and `_1_`/`_2_` copies."""
    return re.sub(r"_\d{10,}_?$", "", re.sub(r"_\d_$", "", n)).rstrip("_")


# ----------------------------------------------------------------------------- PDF wrapper
def read_private_data(ai: bytes) -> tuple[bytes, bytes]:
    """Return (decompressed Illustrator private data, ICC profile bytes)."""
    objs: dict[int, int] = {}
    for m in re.finditer(rb"(?:^|[\r\n])(\d+) 0 obj", ai):
        objs.setdefault(int(m.group(1)), m.end())
    refs = {int(k): int(n) for k, n in re.findall(rb"/AIPrivateData(\d+) (\d+) 0 R", ai)}
    if not refs:
        sys.exit("no AIPrivateData streams: is this a PDF-compatible .ai?")
    head = re.compile(rb"\s*<<([^>]*)>>\s*stream\r?\n?")
    parts = []
    for k in sorted(refs):
        m = head.match(ai, objs[refs[k]])
        if not m:
            sys.exit(f"cannot parse object {refs[k]}")
        length = int(re.search(rb"/Length (\d+)", m.group(1)).group(1))
        parts.append(ai[m.end():m.end() + length])
    blob = b"".join(parts)
    magic = blob.find(b"\x28\xb5\x2f\xfd")
    if not blob.startswith(b"%AI24_ZStandard_Data") or magic < 0:
        sys.exit("private data is not %AI24_ZStandard_Data; older saves need another path")
    text = subprocess.run(["zstd", "-d", "-c"], input=blob[magic:],
                          capture_output=True, check=True).stdout
    icc = None
    for m in re.finditer(rb"<<([^>]*?/N 4[^>]*?)>>\s*stream\r?\n", ai):
        if b"FlateDecode" not in m.group(1):
            continue
        length = int(re.search(rb"/Length (\d+)", m.group(1)).group(1))
        icc = zlib.decompress(ai[m.end():m.end() + length])
        break
    if not icc:
        sys.exit("no ICCBased CMYK profile found")
    return text, icc


# ----------------------------------------------------------------------------- object index
class Doc:
    def __init__(self, text: bytes, icc: bytes):
        self.t = text
        self.names = [(m.start(), m.end(), m.group(1).decode("latin1")) for m in
                      re.finditer(rb"%_/XMLUID : \(([^)]*)\) ; \(AI10_ArtUID\)", text)]
        srgb = ImageCms.createProfile("sRGB")
        prof = ImageCms.getOpenProfile(io.BytesIO(icc))
        self.cmyk2rgb = ImageCms.buildTransform(
            prof, srgb, "CMYK", "RGB", renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC)
        self.cmyk2rgb_bpc = ImageCms.buildTransform(
            prof, srgb, "CMYK", "RGB", renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
            flags=ImageCms.Flags.BLACKPOINTCOMPENSATION)

    def prev_boundary(self, pos: int) -> int:
        prev = 0
        for s, e, _ in self.names:
            if s >= pos:
                break
            prev = e
        return prev

    def a85_block_before(self, pos: int) -> bytes | None:
        """Decode the ASCII85 block that ends last before `pos` (within the same object)."""
        lo = self.prev_boundary(pos)
        e = self.t.rfind(b"~>", lo, pos)
        if e < 0:
            return None
        s = e
        while True:
            ls = self.t.rfind(b"\r", 0, s - 1) + 1
            if ls > lo and re.fullmatch(rb"%[!-uz\r\n]*", self.t[ls:s]):
                s = ls
            else:
                break
        body = re.sub(rb"(?:^|[\r\n])%", b"", self.t[s:e + 2])
        body = re.sub(rb"[\r\n]", b"", body)
        return base64.a85decode(body[:-2] if body.endswith(b"~>") else body)

    def rasters(self):
        for m in RASTER_HEADER.finditer(self.t):
            w, h, bits = int(m.group(6)), int(m.group(7)), int(m.group(8))
            n = int(m.group(10))
            data = self.t[m.end():m.end() + n - 3]
            name = next((nm for s, _, nm in self.names if s > m.end() + n), None)
            sx, sy, tx, ty = (float(m.group(i)) for i in (2, 3, 4, 5))
            yield Raster(name, m.group(1).decode(), w, h, bits, data, abs(sx), abs(sy), tx, ty)

    def hex_from_cmyk(self, c: float, m: float, y: float, k: float) -> str:
        """Box-fill hex, black-point compensated: the printed boxes measure as the compensated
        colours (Black 3/7/8 where the plain conversion gives 41/41/41; Blue, Brown, Crimson,
        Purple, Green and Gold within dE 2.4 of RR2 / II / T2C scans instead of 5-8)."""
        im = Image.new("CMYK", (1, 1), tuple(round(v * 255) for v in (c, m, y, k)))
        r, g, b = ImageCms.applyTransform(im, self.cmyk2rgb_bpc).getpixel((0, 0))
        return f"#{r:02x}{g:02x}{b:02x}"

    def brigade_fill(self, color: str) -> str:
        """CMYK fill of the icon box named `<Color>_Brigade` (left and right copies share
        the fill; evil brigades have a bare name, good ones only `_1_`/`_2_` copies).

        Fill is PostScript state: Illustrator only writes `k` when the color changes, so
        the box's fill is the last `k` before its name, wherever that was written."""
        for s, _, n in self.names:
            if base_name(n) == f"{color}_Brigade":
                ks = FILL_OP.findall(self.t[max(0, s - 200_000):s])
                if ks:
                    return self.hex_from_cmyk(*(float(x) for x in ks[-1]))
        sys.exit(f"no fill for {color}_Brigade")

    def clip_bbox(self, pos: int) -> tuple[float, float, float, float]:
        """Bounding box (artboard pt) of the path ops in the object ending at `pos`.
        For a placed image that is its clip, i.e. where the page/raster lands."""
        seg = re.sub(rb"(?:%[!-uz]*[\r\n])+", b"", self.t[self.prev_boundary(pos):pos])
        pts = [(float(a), float(b)) for a, b in
               re.findall(rb"[\r\n](-?[\d.]+) (-?[\d.]+) [mLl][\r\n]", seg)]
        if not pts:
            sys.exit(f"no clip path before object at {pos}")
        return (min(p[0] for p in pts), min(p[1] for p in pts),
                max(p[0] for p in pts), max(p[1] for p in pts))


# ----------------------------------------------------------------------------- rasterizing
def render_pdf(pdf: bytes, dpi: int, transparent: bool) -> Image.Image:
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "x.pdf"
        p.write_bytes(pdf)
        out = str(Path(d) / "out")
        if transparent:
            cmd = ["pdftocairo", "-png", "-transp", "-r", str(dpi), "-singlefile", str(p), out]
        else:
            cmd = ["pdftoppm", "-png", "-r", str(dpi), "-singlefile", str(p), out]
        subprocess.run(cmd, check=True)
        return Image.open(out + ".png").convert("RGBA")


def crop_wash(page: Image.Image, placed: tuple[float, float, float, float]) -> Image.Image:
    """Crop a wash render to the border rect (162x234 pt), given where the rendered page
    sits on the artboard (`placed` = its clip bbox in artboard pt)."""
    px0, py0, px1, py1 = placed
    sx, sy = page.size[0] / (px1 - px0), page.size[1] / (py1 - py0)
    x0, y0, x1, y1, _ = RECTS_PT["border"]
    box = (round((x0 - px0) * sx), round((py1 - y1) * sy),
           round((x1 - px0) * sx), round((py1 - y0) * sy))
    return page.crop(box)


def outside_mask(inside: Image.Image) -> Image.Image:
    """255 where a pixel of `inside` (an L mask, 0 = maybe background) is reachable from the
    image border through 0-pixels; i.e. the background, holes excluded."""
    w, h = inside.size
    px = inside.load()
    seen = bytearray(w * h)
    q: deque[tuple[int, int]] = deque()
    for x, y in [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]:
        if px[x, y] == 0 and not seen[y * w + x]:
            seen[y * w + x] = 1
            q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and px[nx, ny] == 0:
                seen[ny * w + nx] = 1
                q.append((nx, ny))
    return Image.frombytes("L", (w, h), bytes(255 if s else 0 for s in seen))


def bg_color(im: Image.Image) -> tuple[int, int, int]:
    px = im.load()
    w, h = im.size
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    return max(set(corners), key=corners.count)


def distance_mask(im: Image.Image, bg: tuple[int, int, int], gain: int) -> Image.Image:
    """Per-pixel max-channel distance from `bg`, times `gain`, as an L image."""
    r, g, b = im.split()
    d = None
    for ch, v in ((r, bg[0]), (g, bg[1]), (b, bg[2])):
        m = ch.point(lambda p, v=v: min(255, abs(p - v) * gain))
        d = m if d is None else ImageChops.lighter(d, m)
    return d


def key_icon(im: Image.Image) -> Image.Image:
    """Key the flat background to alpha. Only the region connected to the raster's border
    counts as background (soft-keyed by color distance), so an icon's dark outlines and
    interior stay opaque even when they match the background — the dragon on black."""
    im = im.convert("RGB")
    soft = distance_mask(im, bg_color(im), 4)
    outside = outside_mask(soft.point(lambda p: 255 if p > 40 else 0))
    alpha = ImageChops.lighter(soft, ImageChops.invert(outside))
    out = im.convert("RGBA")
    out.putalpha(alpha)
    return out


def key_shields(warrior: Image.Image, weapon: Image.Image) -> tuple[Image.Image, Image.Image]:
    """The class shields are one shield with the other half flattened to the background
    gray, so neither raster alone knows its own outline. Their union does."""
    warrior, weapon = warrior.convert("RGB"), weapon.convert("RGB")
    bg = bg_color(warrior)
    lit = ImageChops.lighter(distance_mask(warrior, bg, 25), distance_mask(weapon, bg, 25))
    alpha = ImageChops.invert(outside_mask(lit.point(lambda p: 255 if p > 128 else 0)))
    alpha = alpha.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    outs = []
    for im in (warrior, weapon):
        o = im.convert("RGBA")
        o.putalpha(alpha)
        outs.append(o)
    return outs[0], outs[1]


def plate(im: Image.Image) -> Image.Image:
    """Opaque rounded plate with the print's dark outline (the territory map)."""
    im = im.convert("RGBA")
    w, h = im.size
    r = round(h * 0.16)
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    ImageDraw.Draw(im).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, outline=(35, 31, 32), width=3)
    im.putalpha(mask)
    return im


def raster_to_image(doc: Doc, r: Raster) -> Image.Image:
    if r.cs == "DeviceCMYK":
        im = Image.frombytes("CMYK", (r.w, r.h), r.data[: r.w * r.h * 4])
        bpc = r.name is not None and base_name(r.name) in BLACK_POINT_COMPENSATED
        return ImageCms.applyTransform(im, doc.cmyk2rgb_bpc if bpc else doc.cmyk2rgb).convert("RGB")
    return Image.frombytes("L", (r.w, r.h), r.data[: r.w * r.h]).convert("RGB")


def corner_copy(copies: list[Raster]) -> Raster:
    """Of an icon's copies, the one placed in the top-left icon box (the text legend holds
    smaller copies with different pixels, e.g. the Artifact chalice)."""
    boxed = [r for r in copies if r.tx < 100 and r.ty > 200]
    return min(boxed, key=lambda r: r.tx) if boxed else copies[0]


def canvas_rect(r: Raster) -> dict[str, float]:
    """Canvas-px rect of a placed raster."""
    sx, sy = CANVAS[0] / (TRIM[2] - TRIM[0]), CANVAS[1] / (TRIM[3] - TRIM[1])
    w, h = r.sx * r.w * sx, r.sy * r.h * sy
    x, y = (r.tx - TRIM[0]) * sx, (TRIM[3] - r.ty) * sy
    return {"x": round(x, 1), "y": round(y, 1), "w": round(w, 1), "h": round(h, 1)}


def hue_shift_image(im: Image.Image, degrees: float) -> Image.Image:
    h, s, v = im.convert("RGB").convert("HSV").split()
    h = h.point(lambda p: (p + round(degrees / 360 * 255)) % 256)
    return Image.merge("HSV", (h, s, v)).convert("RGB")


def hue_shift_hex(hex_color: str, degrees: float) -> str:
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    r, g, b = colorsys.hsv_to_rgb((h + degrees / 360) % 1.0, s, v)
    return f"#{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}"


# ----------------------------------------------------------------------------- outputs
def pt_rect(r):
    x0, y0, x1, y1, rad = r
    sx, sy = CANVAS[0] / (TRIM[2] - TRIM[0]), CANVAS[1] / (TRIM[3] - TRIM[1])
    return {"x": round((x0 - TRIM[0]) * sx, 1), "y": round((TRIM[3] - y1) * sy, 1),
            "w": round((x1 - x0) * sx, 1), "h": round((y1 - y0) * sy, 1), "r": round(rad * sx, 1)}


def write_geometry(path: Path, brigade_hex: dict[str, str], synthesized: dict[str, str],
                   icon_rects: dict[str, dict[str, float]]):
    sx = CANVAS[0] / (TRIM[2] - TRIM[0])
    lines = [
        "// GENERATED by scripts/forge-extract-template.py from the design team's Illustrator",
        "// card template (v3.7). Do not edit by hand; rerun `make forge-frames`.",
        "// Canvas is the 2.5 x 3.5 in trim box at 300 dpi. Rects: {x, y, w, h, r} in canvas px.",
        "",
        f"export const CANVAS = {{ w: {CANVAS[0]}, h: {CANVAS[1]} }} as const;",
        f"export const BORDER_STROKE = {round(BORDER_STROKE_PT * sx, 2)};",
        "",
        "export const RECTS = {",
    ]
    for k, r in RECTS_PT.items():
        lines.append(f"  {k}: {json.dumps(pt_rect(r)).replace(chr(34), '')},")
    lines += ["} as const;", "",
              "// Where the type and class icons sit, from the template's raster placements: type",
              "// icons inside the top-left box (`…Stats` = the lower slot under strength/toughness),",
              "// the class shield and territory plate below it. Rects are the rasters' own aspect.",
              "export const ICON_RECTS = {"]
    for k, r in icon_rects.items():
        lines.append(f"  {k}: {json.dumps(r).replace(chr(34), '')},")
    lines += ["} as const;", "",
              "// Ability box gradient: light until `light`% of the box, black from `dark`%.",
              "export const GRADIENT_ROWS = {"]
    for rows, (a, b) in GRADIENT_ROWS.items():
        lines.append(f"  {rows}: {{ light: {a}, dark: {b} }},")
    lines += ["} as const;", "",
              "// Icon-box fills, CMYK from the template converted through its SWOP profile with",
              "// black-point compensation, which is what the printed boxes measure as.",
              "// red / teal are not in the template: hue-shifted from crimson / blue.",
              "export const BRIGADE_BOX_HEX = {"]
    for k, v in brigade_hex.items():
        lines.append(f'  "{k}": "{v}",')
    for k, v in synthesized.items():
        lines.append(f'  "{k}": "{v}", // synthesized')
    lines += ["} as const;", ""]
    path.write_text("\n".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ai", default="tmp/Card_Template-SHUFFLED_3.7.ai")
    ap.add_argument("--out", default="public/forge/frames")
    ap.add_argument("--geometry", default="app/forge/lib/frameGeometry.ts")
    ap.add_argument("--dpi", type=int, default=300)
    args = ap.parse_args()
    for tool in ("zstd", "pdftoppm", "pdftocairo"):
        if not shutil.which(tool):
            sys.exit(f"missing tool: {tool}")

    ai = Path(args.ai).read_bytes()
    text, icc = read_private_data(ai)
    doc = Doc(text, icc)
    out = Path(args.out)
    for sub in ("washes", "icons", "badges"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    print(f"objects: {len(doc.names)}")

    # --- washes. Most are placed PDFs; Gray and Black are full-artboard DeviceGray rasters.
    gray_washes = {}
    for r in doc.rasters():
        if r.name and r.cs == "DeviceGray" and r.w >= 800 and r.bits == 8:
            gray_washes[base_name(r.name)] = (r.w, r.h, r.data)
    done = set()
    for s, _, n in doc.names:
        b = base_name(n)
        if b not in WASHES or b in done:
            continue
        pdf = doc.a85_block_before(s)
        if pdf and pdf.startswith(b"%PDF"):
            page = render_pdf(pdf, args.dpi, transparent=False)
        elif b in gray_washes:
            w, h, data = gray_washes[b]
            page = Image.frombytes("L", (w, h), data[: w * h]).convert("RGBA")
        else:
            print(f"  ! {b}: neither a placed PDF nor a gray raster, skipping")
            continue
        im = crop_wash(page, doc.clip_bbox(s))
        im.convert("RGB").save(out / "washes" / f"{WASHES[b]}.webp", quality=88, method=6)
        done.add(b)
        print(f"  wash {WASHES[b]}: {im.size[0]}x{im.size[1]}")
    missing = set(WASHES) - done
    if missing:
        sys.exit(f"washes not found in template: {sorted(missing)}")
    shutil.copyfile(out / "washes" / f"{LOST_SOUL_DEFAULT}.webp",
                    out / "washes" / "lost-soul.webp")
    for slug, src, degrees in SYNTHESIZED:
        im = Image.open(out / "washes" / f"{src}.webp")
        hue_shift_image(im, degrees).save(out / "washes" / f"{slug}.webp", quality=88, method=6)
        print(f"  wash {slug}: synthesized from {src} ({degrees:+}deg)")

    # --- badge PDFs (transparent renders)
    seen = set()
    for s, _, n in doc.names:
        b = base_name(n)
        if b not in BADGE_PDFS or b in seen:
            continue
        pdf = doc.a85_block_before(s)
        if not pdf or not pdf.startswith(b"%PDF"):
            continue
        im = render_pdf(pdf, args.dpi, transparent=True)
        im.save(out / "badges" / f"{BADGE_PDFS[b]}.webp", quality=90, method=6)
        seen.add(b)
        print(f"  badge {BADGE_PDFS[b]}: {im.size[0]}x{im.size[1]}")

    # --- raw rasters: one copy per base name, the one placed in the top-left icon box
    wanted = set(RASTERS) | set(PLACEMENTS.values())
    copies: dict[str, list[Raster]] = {}
    for r in doc.rasters():
        if r.name is not None and r.bits == 8 and base_name(r.name) in wanted:
            copies.setdefault(base_name(r.name), []).append(r)
    missing = wanted - set(copies)
    if missing:
        sys.exit(f"rasters not found in template: {sorted(missing)}")
    chosen = {key: corner_copy(rs) for key, rs in copies.items()}
    images = {key: raster_to_image(doc, r) for key, r in chosen.items()}
    for key, (slug, kind) in RASTERS.items():
        im, r = images[key], chosen[key]
        if kind == "icon":
            key_icon(im).save(out / "icons" / f"{slug}.png", optimize=True)
        elif kind == "plate":
            plate(im).save(out / "icons" / f"{slug}.png", optimize=True)
        elif kind == "badge":
            im.save(out / "badges" / f"{slug}.webp", quality=90, method=6)
        if kind != "shield":
            print(f"  {kind} {slug}: {r.w}x{r.h} {r.cs}")
    warrior, weapon = key_shields(images["Warrior_small"], images["Weapon_small"])
    warrior.save(out / "icons" / "warrior.png", optimize=True)
    weapon.save(out / "icons" / "weapon.png", optimize=True)
    print(f"  shields warrior + weapon: {warrior.size[0]}x{warrior.size[1]}")
    icon_rects = {k: canvas_rect(chosen[name]) for k, name in PLACEMENTS.items()}

    # --- brigade colors + geometry
    hexes = {c.lower().replace("_", "-"): doc.brigade_fill(c) for c in BRIGADE_BOX_NAMES}
    synth = {slug: hue_shift_hex(hexes[src], deg) for slug, src, deg in SYNTHESIZED}
    write_geometry(Path(args.geometry), hexes, synth, icon_rects)
    print("  geometry ->", args.geometry)
    print({**hexes, **synth})


if __name__ == "__main__":
    main()
