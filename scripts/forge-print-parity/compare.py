#!/usr/bin/env python3.11
"""Pixel-level A/B of Forge card renders against the design team's finished card images.

Both images are put in the SAME 750x1050 canvas space by their four black border lines (the
frame's outer stroke, canvas 37.5 / 712.5 / 37.5 / 1012.5), so every element can be measured in
canvas px and compared directly: the title's fitted font size and right edge, the stat digits,
each ability line's top / pitch / width, the verse rows, the reference, credits, identifier
bubble, card number, frame lines and stroke widths, and the type / class icons. Font sizes are
FITTED: the same string is rendered with the real font (PIL + the licensed TTFs) and the
measured ink extents give the size that produced them, independently along x (width) and y
(height), so horizontal condensing shows up as a ratio. Text lines are found from the row ink
profile (rows carrying > 12% of the peak count = cap top to baseline), so lines whose descenders
touch the next line's ascenders still separate; a line's height is therefore its cap height.

    python3.11 scripts/forge-print-parity/compare.py \
        --pairs pairs.json --real finished/ --ours ours/ --fonts /abs/tmp --out report/

pairs.json: { "<id>": { "title", "types", "stat" ("8/9" or null), "reference", "id_text" } }
The report dir gets report.json (every measurement), summary.md (curated real-vs-ours deltas
with medians and spread), titles.md (per-card title fits), triptych/<id>.jpg (ours | real |
amplified diff) and heat.png (mean abs diff over every card, art window masked).
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage, signal

CANVAS = (750, 1050)
BORDER = (37.5, 712.5, 37.5, 1012.5)  # xl, xr, yt, yb of the border rect (stroke centre)
ART = (75.0, 110.7, 675.0, 659.2)
FONT_FILES = {"title": "SYMPHOBL.TTF", "stat": "grail.ttf"}
FIT_SIZE = 40  # reference size for PIL fits
ARIAL_CAP = 1467 / 2048  # Arial / Arimo cap height per em


# ----------------------------------------------------------------------------- registration
def _line_centre(prof: np.ndarray, i: int, reach: int = 8) -> float:
    """Centroid of the dark run around index `i` (the darkest sample): a stroke several px
    wide has a flat minimum, so an argmin lands on its leading edge, not its middle."""
    lo, hi = max(0, i - reach), min(len(prof), i + reach + 1)
    seg = prof[lo:hi]
    thr = (seg.min() + seg.max()) / 2
    w = np.clip(thr - seg, 0, None)
    return lo + float((w * np.arange(len(seg))).sum() / w.sum()) if w.sum() else float(i)


def find_border(gray: np.ndarray, margin: int = 48) -> tuple[float, float, float, float]:
    """Sub-pixel x/y of the four border lines: the darkest column / row in each outer margin."""
    H, W = gray.shape
    col, row = gray.mean(axis=0), gray.mean(axis=1)
    xl = _line_centre(col, int(np.argmin(col[:margin])))
    xr = _line_centre(col, W - margin + int(np.argmin(col[-margin:])))
    yt = _line_centre(row, int(np.argmin(row[:margin])))
    yb = _line_centre(row, H - margin + int(np.argmin(row[-margin:])))
    return xl, xr, yt, yb


def register(im: Image.Image) -> tuple[np.ndarray, dict]:
    """Warp `im` so its border lines land on the canvas's. Returns (HxWx3 float array, info)."""
    gray = np.asarray(im.convert("L"), dtype=float)
    xl, xr, yt, yb = find_border(gray)
    sx = (xr - xl) / (BORDER[1] - BORDER[0])
    sy = (yb - yt) / (BORDER[3] - BORDER[2])
    # PIL AFFINE maps output -> input: x_in = a*x + b*y + c
    warped = im.convert("RGB").transform(
        CANVAS, Image.AFFINE, (sx, 0, xl - BORDER[0] * sx, 0, sy, yt - BORDER[2] * sy), resample=Image.BICUBIC,
    )
    return np.asarray(warped, dtype=float), {"scale_x": round(sx, 4), "scale_y": round(sy, 4), "src": list(im.size),
                                            "border_px": [round(v, 1) for v in (xl, xr, yt, yb)]}


# ----------------------------------------------------------------------------- helpers
def lum(a: np.ndarray) -> np.ndarray:
    return 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]


def bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    """(x0, y0, x1, y1), x1/y1 exclusive."""
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def shift(bb, x0, y0):
    return None if bb is None else (bb[0] + x0, bb[1] + y0, bb[2] + x0, bb[3] + y0)


def runs(flags: np.ndarray, gap: int = 0, min_len: int = 1) -> list[tuple[int, int]]:
    """Runs of True, merging gaps <= `gap`, dropping runs shorter than `min_len`."""
    out: list[list[int]] = []
    for i, v in enumerate(flags):
        if not v:
            continue
        if out and i - out[-1][1] <= gap:
            out[-1][1] = i + 1
        else:
            out.append([i, i + 1])
    return [(a, b) for a, b in out if b - a >= min_len]


def drop_specks(mask: np.ndarray, min_px: int = 6) -> np.ndarray:
    lab, n = ndimage.label(mask)
    if n == 0:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    keep = np.zeros(n + 1, bool)
    keep[1:] = sizes >= min_px
    return keep[lab]


def face_mask(crop: np.ndarray, white: int = 200, dark: int = 90, reach: int = 4) -> np.ndarray:
    """Light type carrying a dark contour or shadow (title, credits): white pixels within
    `reach` px of a dark one. Works on light and dark washes alike."""
    w = crop.min(axis=2) > white
    d = ndimage.binary_dilation(lum(crop) < dark, iterations=reach)
    return drop_specks(w & d)


ARIAL_XH = 1062 / 2048  # Arial / Arimo x-height per em


def text_lines(mask: np.ndarray, x_off: int, y_off: int, min_h: int = 4) -> list[dict]:
    """Lines of type from a mask. The row ink profile peaks once per line (its x-height band:
    every letter has ink there; cap / ascender rows and descender rows carry far less, so
    touching lines stay apart, and a short last line is still its own peak). Each peak is
    widened while the count stays above half the peak. Each line: top (x-height line),
    baseline, x_h, size (px, for an Arial-metric face), left, right (full ink extent of the
    rows from 6 px above the band to the baseline, so caps count)."""
    counts = mask.sum(axis=1).astype(float)
    if counts.max() == 0:
        return []
    peaks, _ = signal.find_peaks(np.pad(counts, 1), distance=9, prominence=0.12 * counts.max(),
                                 height=0.1 * counts.max())
    out = []
    last_b = -1
    for pk in peaks - 1:
        a = b = pk
        while a > 0 and counts[a - 1] > 0.5 * counts[pk]:
            a -= 1
        while b + 1 < len(counts) and counts[b + 1] > 0.5 * counts[pk]:
            b += 1
        b += 1
        if b - a < min_h or a < last_b:
            continue
        last_b = b
        cols = np.nonzero(mask[max(0, a - 6):b].any(axis=0))[0]
        out.append({"top": a + y_off, "baseline": b + y_off, "x_h": b - a, "size": round((b - a) / ARIAL_XH, 1),
                    "left": int(cols.min()) + x_off, "right": int(cols.max()) + 1 + x_off})
    return out


def drop_edge_components(m: np.ndarray) -> np.ndarray:
    """Remove connected components touching the mask's border (frame strokes, box corners)."""
    lab, n = ndimage.label(m)
    edge = set(lab[0]) | set(lab[-1]) | set(lab[:, 0]) | set(lab[:, -1])
    out = m.copy()
    for i in edge:
        if i:
            out[lab == i] = False
    return out


def line_at(gray: np.ndarray, axis: str, lo: int, hi: int, span: tuple[int, int]) -> dict | None:
    """Centre and dark width (px below the half-way level) of the darkest row (axis 'y') or
    column ('x') in [lo, hi) averaged over `span`."""
    prof = gray[lo:hi, span[0]:span[1]].mean(axis=1) if axis == "y" else gray[span[0]:span[1], lo:hi].mean(axis=0)
    if len(prof) == 0:
        return None
    i = int(np.argmin(prof))
    if prof[i] > 140:  # nothing dark here
        return None
    thr = (prof.min() + prof.max()) / 2
    return {"pos": round(lo + _line_centre(prof, i), 1), "width": round(float((prof < thr).sum()), 1)}


# ----------------------------------------------------------------------------- font fits
class Fonts:
    def __init__(self, font_dir: Path, public_fonts: Path):
        self.title = ImageFont.truetype(str(font_dir / FONT_FILES["title"]), FIT_SIZE)
        self.stat = ImageFont.truetype(str(font_dir / FONT_FILES["stat"]), FIT_SIZE)
        self.bold = ImageFont.truetype(str(public_fonts / "Arimo-Bold.ttf"), FIT_SIZE)

    @staticmethod
    def ink(font: ImageFont.FreeTypeFont, text: str) -> dict:
        """Ink extents of `text` at FIT_SIZE, rendered and thresholded like the measurements."""
        l, t, r, b = font.getbbox(text)
        im = Image.new("L", (r + 4, b + 4), 0)
        ImageDraw.Draw(im).text((2, 2), text, font=font, fill=255)
        bb = bbox(np.asarray(im) > 128)
        asc = font.getmetrics()[0]
        if not bb:
            return {"w": 0, "h": 0, "desc": 0}
        return {"w": bb[2] - bb[0], "h": bb[3] - bb[1], "desc": max(0, bb[3] - 2 - asc)}


def fit_size(font: ImageFont.FreeTypeFont, text: str, measured: tuple[int, int, int, int] | None) -> dict | None:
    """Font size that reproduces the measured ink bbox, along x and along y, plus the
    condensing ratio (x/y; 1 = as designed, <1 = horizontally squeezed)."""
    if not measured or not text:
        return None
    ref = Fonts.ink(font, text)
    if not ref["w"] or not ref["h"]:
        return None
    w, h = measured[2] - measured[0], measured[3] - measured[1]
    sw, sh = FIT_SIZE * w / ref["w"], FIT_SIZE * h / ref["h"]
    return {"size_x": round(sw, 1), "size_y": round(sh, 1), "condense": round(sw / sh, 3),
            "baseline": round(measured[3] - ref["desc"] * sh / FIT_SIZE, 1), "w": w, "h": h}


# ----------------------------------------------------------------------------- measurements
def printed_name(name: str, types: list[str]) -> str:
    """The name as the card prints it: the catalog's bracketed disambiguator is dropped, and a
    Lost Soul is titled just "Lost Soul" (its quoted identifier prints in the bubble)."""
    if "LostSoul" in types:
        return "Lost Soul"
    return re.sub(r"\s*\[[^\]]*\]\s*$", "", name).strip()


def measure_title(img: np.ndarray, fonts: Fonts, name: str, types: list[str]) -> dict:
    right_box = bool(set(types) & {"Covenant", "Curse"})
    x0, y0, x1, y1 = 208, 48, (531 if right_box else 702), 103
    crop = img[y0:y1, x0:x1]
    m = drop_edge_components(face_mask(crop))
    bb = shift(bbox(m), x0, y0)
    if not bb:
        return {"found": False}
    # the dark contour + shadow around the face: its outer right edge, and how much ink it
    # adds relative to the face (a thicker contour / longer shadow = a higher ratio)
    ring = (lum(crop) < 90) & ndimage.binary_dilation(m, iterations=10) & ~m
    rb = shift(bbox(ring), x0, y0)
    return {"found": True, "left": bb[0], "right": bb[2], "top": bb[1], "bottom": bb[3],
            "ring_right": rb[2] if rb else None, "ring_bottom": rb[3] if rb else None,
            "ring_ratio": round(float(ring.sum() / max(1, m.sum())), 3),
            **(fit_size(fonts.title, printed_name(name, types), bb) or {})}


def box_fill(img: np.ndarray) -> np.ndarray:
    return np.median(img[42:66, 46:54].reshape(-1, 3), axis=0)


def measure_stats(img: np.ndarray, fonts: Fonts, stat: str | None) -> dict:
    if not stat:
        return {"found": False}
    x0, y0, x1, y1 = 46, 30, 194, 70
    crop = img[y0:y1, x0:x1]
    fill = box_fill(img)
    m = drop_specks(np.abs(crop - fill).max(axis=2) > 70)
    m[m.sum(axis=1) > 100] = False  # the box's top outline spans the whole width
    m = drop_edge_components(m)  # its rounded corners
    bb = shift(bbox(m), x0, y0)
    if not bb:
        return {"found": False}
    return {"found": True, "left": bb[0], "right": bb[2], "top": bb[1], "bottom": bb[3],
            "center_x": round((bb[0] + bb[2]) / 2, 1), "fill": [int(v) for v in fill], **(fit_size(fonts.stat, stat, bb) or {})}


def dark_zone_start(img: np.ndarray) -> int:
    """First row of the text box where the wash is fully dark (the verse zone)."""
    prof = lum(img[684:952, 95:655]).mean(axis=1)
    dark = np.nonzero(prof < 90)[0]
    return int(684 + dark[0]) if len(dark) else 952


def measure_ability(img: np.ndarray) -> dict:
    x0, x1, y0 = 85, 665, 684
    y1 = dark_zone_start(img) - 4
    if y1 <= y0 + 10:
        return {"found": False, "lines": [], "n": 0}
    lines = text_lines(drop_specks(lum(img[y0:y1, x0:x1]) < 100, 4), x0, y0)
    tops = [l["top"] for l in lines]
    return {"found": bool(lines), "lines": lines, "n": len(lines),
            "first_baseline": lines[0]["baseline"] if lines else None,
            "pitch": round(float(statistics.median(np.diff(tops))), 1) if len(tops) > 1 else None,
            "x_h": round(float(statistics.median(ln["x_h"] for ln in lines)), 1) if lines else None,
            "size": round(float(statistics.median(ln["size"] for ln in lines)), 1) if lines else None,
            "dark_start": y1 + 4}


def verse_masks(img: np.ndarray, y0: int, y1: int, x0: int, x1: int):
    """(red mask, light mask) of type in the dark zone: the verse is red-letter on some cards
    and cream on the rest; the reference is always light."""
    crop = img[y0:y1, x0:x1]
    r, g, b = crop[..., 0], crop[..., 1], crop[..., 2]
    red = drop_specks((r > 120) & (g < 110) & (b < 110) & (r - g > 60), 4)
    light = drop_specks(lum(crop) > 170, 4)
    return red, light


def measure_gradient(img: np.ndarray, ability: dict, verse: dict) -> dict:
    """Row luminance of the text box's middle between the ability and the verse: the rows where
    it first drops below 90% and below 10% of the light-to-dark range (start and end of the
    transition), and the verse's first cap-top row for reference."""
    lo = (ability["lines"][-1]["baseline"] + 8) if ability.get("lines") else 700
    hi = (verse["lines"][0]["top"] - 2) if verse.get("lines") else 944
    if hi - lo < 12:
        return {"found": False}
    prof = lum(img[lo:hi, 300:450]).mean(axis=1)
    top, bot = prof.max(), prof.min()
    if top - bot < 60:
        return {"found": False}
    start = lo + int(np.argmax(prof < top - 0.1 * (top - bot)))
    end = lo + int(np.argmax(prof < bot + 0.1 * (top - bot)))
    return {"found": True, "start": start, "end": end, "light": round(float(top), 1), "dark": round(float(bot), 1),
            "verse_top": verse["lines"][0]["top"] if verse.get("lines") else None}


def measure_verse(img: np.ndarray) -> dict:
    x0, x1 = 85, 665
    y0, y1 = dark_zone_start(img), 952
    if y1 - y0 < 10:
        return {"found": False, "lines": [], "n": 0}
    red, light = verse_masks(img, y0, y1, x0, x1)
    color = "red" if red.sum() > 200 else "light"
    lines = text_lines(red if color == "red" else light, x0, y0)
    if color == "light" and lines:
        lines = lines[:-1]  # the bottom-most light line is the reference
    tops = [ln["top"] for ln in lines]
    crop = img[y0:y1, x0:x1]
    return {"found": bool(lines), "lines": lines, "n": len(lines), "color": color,
            "pitch": round(float(statistics.median(np.diff(tops))), 1) if len(tops) > 1 else None,
            "x_h": round(float(statistics.median(ln["x_h"] for ln in lines)), 1) if lines else None,
            "size": round(float(statistics.median(ln["size"] for ln in lines)), 1) if lines else None,
            "left": min(ln["left"] for ln in lines) if lines else None,
            "last_baseline": lines[-1]["baseline"] if lines else None,
            "rgb": [int(v) for v in np.percentile(crop[red if color == "red" else light], 90, axis=0)] if lines else None}


def measure_reference(img: np.ndarray, fonts: Fonts, text: str | None) -> dict:
    x0, x1 = 330, 668
    y0, y1 = max(dark_zone_start(img), 895), 950
    if y1 - y0 < 8:
        return {"found": False}
    m = drop_specks(lum(img[y0:y1, x0:x1]) > 170, 4)
    lines = text_lines(m, x0, y0)
    if not lines:
        return {"found": False}
    ln = lines[-1]  # the bottom-most light line is the reference
    sub = np.zeros_like(m)
    lo, hi = max(0, ln["top"] - y0 - 8), ln["baseline"] - y0 + 6
    sub[lo:hi] = m[lo:hi]
    bb = shift(bbox(sub), x0, y0)
    if not bb:
        return {"found": False}
    return {"found": True, "left": bb[0], "right": bb[2], "top": bb[1], "bottom": bb[3], "x_h": ln["x_h"],
            "size": ln["size"], "baseline": ln["baseline"], **({"fit": fit_size(fonts.bold, text, bb)} if text else {})}


def measure_credits(img: np.ndarray, fonts: Fonts, year: int) -> dict:
    x0, y0, x1, y1 = 250, 956, 690, 1006
    m = face_mask(img[y0:y1, x0:x1], white=190, dark=110, reach=3)
    lines = text_lines(m, x0, y0)
    out: dict = {"found": bool(lines), "lines": lines, "n": len(lines)}
    if lines:
        last = lines[-1]
        band = m[last["top"] - y0 - 6:last["baseline"] - y0 + 5]
        bb = shift(bbox(band), x0, last["top"] - 6)
        out["copyright"] = {"right": last["right"], "x_h": last["x_h"], "size": last["size"], "baseline": last["baseline"],
                            "fit": fit_size(fonts.bold, f"© {year} Cactus Game Design, Inc.", bb)}
        out["illus"] = {"right": lines[0]["right"], "x_h": lines[0]["x_h"], "size": lines[0]["size"], "baseline": lines[0]["baseline"]}
    return out


def measure_id_bubble(img: np.ndarray, fonts: Fonts, text: str | None) -> dict:
    x0, x1 = 75, 675
    # The pill straddles the art window's bottom edge. Its bottom outline sits on the light
    # text-box top (rows 674-684, below the box's own top stroke at ~668), so the pill's
    # columns are the widest run of columns with a dark pixel there.
    g = lum(img[:, x0:x1])
    dark = g[672:684] < 130  # the pill (fill + bottom outline) against the ~240 text-box top
    cols = runs(dark.sum(axis=0) >= 6, gap=2, min_len=30)
    if not cols:
        return {"found": False}
    px0, px1 = max(cols, key=lambda r: r[1] - r[0])
    prof = g[636:690, px0 + 10:px1 - 10].mean(axis=1)
    below = np.nonzero(prof[674 - 636:] < 100)[0] + 674
    if len(below) == 0:
        return {"found": False}
    bottom = int(below.max()) + 1
    # the top outline is only measurable when the art above the pill is light
    top = None
    if prof[:8].mean() > 150:
        above = np.nonzero(prof[: 656 - 636] < 80)[0] + 636
        top = int(above.min()) if len(above) else None
    fill = img[672:bottom - 2, x0 + px0 + 10:x0 + px1 - 10].reshape(-1, 3)
    fill = fill[lum(fill) < 160]  # not the white text
    out = {"found": True, "left": px0 + x0, "right": px1 + x0, "bottom": bottom, "top": top, "w": px1 - px0,
           "fill_rgb": [int(v) for v in np.median(fill, axis=0)] if len(fill) else None,
           "fill_lum": round(float(np.median(lum(fill))), 1) if len(fill) else None}
    crop = img[650:bottom - 2, x0 + px0:x0 + px1]
    white = drop_specks(crop.min(axis=2) > 200, 4)
    tb = shift(bbox(white), x0 + px0, 650)
    if tb:
        out.update({"text_left": tb[0], "text_right": tb[2], "text_top": tb[1], "text_bottom": tb[3],
                    "text_h": tb[3] - tb[1], "text_w": tb[2] - tb[0]})
        if text:
            out["text_fit"] = fit_size(fonts.bold, text, tb)
    return out


def measure_number(img: np.ndarray) -> dict:
    x0, y0, x1, y1 = 54, 958, 210, 1000
    m = drop_edge_components(drop_specks(lum(img[y0:y1, x0:x1]) < 90, 8))
    bb = shift(bbox(m), x0, y0)
    if not bb:
        return {"found": False}
    # the number prints left of x ~120, the set symbol right of it
    num, sym = shift(bbox(m[:, :120 - x0]), x0, y0), shift(bbox(m[:, 120 - x0:]), 120, y0)
    out = {"found": True, "left": bb[0], "top": bb[1], "right": bb[2], "bottom": bb[3]}
    if num:
        out["number"] = {"left": num[0], "top": num[1], "right": num[2], "bottom": num[3], "h": num[3] - num[1]}
    if sym:
        out["symbol"] = {"left": sym[0], "top": sym[1], "right": sym[2], "bottom": sym[3], "w": sym[2] - sym[0], "h": sym[3] - sym[1]}
    return out


def measure_frame(img: np.ndarray) -> dict:
    g = lum(img)
    out = {
        "border_left": line_at(g, "x", 26, 50, (200, 600)),
        "border_top": line_at(g, "y", 26, 50, (300, 600)),
        "art_top": line_at(g, "y", 104, 115, (250, 500)),
        "art_bottom": line_at(g, "y", 654, 664, (90, 150)),
        "art_left": line_at(g, "x", 70, 80, (200, 600)),
        "art_right": line_at(g, "x", 670, 680, (200, 600)),
        "text_top": line_at(g, "y", 663, 673, (90, 150)),
        "text_bottom": line_at(g, "y", 946, 957, (200, 600)),
        "text_left": line_at(g, "x", 70, 80, (700, 900)),
        "text_right": line_at(g, "x", 670, 680, (700, 900)),
        "leftbox_right": line_at(g, "x", 196, 210, (60, 120)),
        "leftbox_bottom": line_at(g, "y", 158, 172, (60, 180)),
    }
    return {k: v for k, v in out.items()}


def measure_type_icon(img: np.ndarray) -> dict:
    x0, y0, x1, y1 = 44, 68, 196, 161
    crop = img[y0:y1, x0:x1]
    m = drop_edge_components(drop_specks(np.abs(crop - box_fill(img)).max(axis=2) > 60, 10))
    bb = shift(bbox(m), x0, y0)
    if not bb:
        return {"found": False}
    return {"found": True, "left": bb[0], "top": bb[1], "right": bb[2], "bottom": bb[3], "w": bb[2] - bb[0], "h": bb[3] - bb[1],
            "center_x": round((bb[0] + bb[2]) / 2, 1)}


def measure_class_icons(img: np.ndarray) -> dict:
    # Only the strip between the border and the art window (x 44-70) is measurable on a real
    # card: the icons overlap the painting. Top / bottom / left of the first icon, from its
    # dark outline.
    x0, y0, x1, y1 = 44, 168, 70, 300
    m = drop_specks(lum(img[y0:y1, x0:x1]) < 70, 6)
    rows = np.nonzero(m.any(axis=1))[0]
    if len(rows) == 0:
        return {"found": False}
    cols = np.nonzero(m.any(axis=0))[0]
    return {"found": True, "top": int(rows.min()) + y0, "bottom": int(rows.max()) + 1 + y0, "left": int(cols.min()) + x0}


def measure(img: np.ndarray, fonts: Fonts, card: dict, year: int) -> dict:
    ability, verse = measure_ability(img), measure_verse(img)
    return {
        "title": measure_title(img, fonts, card["title"], card.get("types") or []),
        "stats": measure_stats(img, fonts, card.get("stat")),
        "ability": ability,
        "verse": verse,
        "gradient": measure_gradient(img, ability, verse),
        "reference": measure_reference(img, fonts, card.get("reference")),
        "credits": measure_credits(img, fonts, year),
        "id_bubble": measure_id_bubble(img, fonts, card.get("id_text")),
        "number": measure_number(img),
        "frame": measure_frame(img),
        "type_icon": measure_type_icon(img),
        "class_icons": measure_class_icons(img),
    }


# ----------------------------------------------------------------------------- diff images
def diff_mask() -> np.ndarray:
    m = np.ones((CANVAS[1], CANVAS[0]), bool)
    m[int(ART[1]) + 5:int(ART[3]) - 4, int(ART[0]) + 5:int(ART[2]) - 4] = False
    return m


def triptych(ours: np.ndarray, real: np.ndarray, path: Path, boxes: list[tuple[str, tuple]]):
    d = np.abs(lum(ours) - lum(real))
    d[~diff_mask()] = 0
    dimg = np.clip(255 - d * 3, 0, 255).astype(np.uint8)
    W, H = CANVAS
    sheet = Image.new("RGB", (W * 3 + 20, H), "white")
    sheet.paste(Image.fromarray(ours.astype(np.uint8)), (0, 0))
    sheet.paste(Image.fromarray(real.astype(np.uint8)), (W + 10, 0))
    sheet.paste(Image.fromarray(dimg).convert("RGB"), (2 * W + 20, 0))
    dr = ImageDraw.Draw(sheet)
    for color, (x0, y0, x1, y1) in boxes:
        for off in (0, W + 10):
            dr.rectangle([x0 + off, y0, x1 + off, y1], outline=color, width=1)
    sheet.save(path, quality=80)


# ----------------------------------------------------------------------------- aggregate
def dig(d: dict, path: str):
    cur = d
    for p in path.split("."):
        if not isinstance(cur, dict) or p not in cur:
            return None
        cur = cur[p]
    if isinstance(cur, dict) and "pos" in cur:
        cur = cur["pos"]
    if isinstance(cur, bool) or cur is None:
        return None
    return float(cur) if isinstance(cur, (int, float, np.number)) else None


# (label, path) rows of the curated summary; a path is dotted into the measurement dict.
SUMMARY = [
    ("Title: font size from cap/descender height (px)", "title.size_y"),
    ("Title: font size from width (px)", "title.size_x"),
    ("Title: condense ratio (width/height)", "title.condense"),
    ("Title: right edge of ink (x)", "title.right"),
    ("Title: baseline (y)", "title.baseline"),
    ("Title: ink top (y)", "title.top"),
    ("Title: contour/shadow outer right edge (x)", "title.ring_right"),
    ("Title: contour/shadow outer bottom (y)", "title.ring_bottom"),
    ("Title: contour+shadow ink / face ink", "title.ring_ratio"),
    ("Stats: font size from height (px)", "stats.size_y"),
    ("Stats: font size from width (px)", "stats.size_x"),
    ("Stats: digit top (y)", "stats.top"),
    ("Stats: digit bottom (y)", "stats.bottom"),
    ("Stats: centre (x)", "stats.center_x"),
    ("Ability: line count", "ability.n"),
    ("Ability: first baseline (y)", "ability.first_baseline"),
    ("Ability: line pitch (px)", "ability.pitch"),
    ("Ability: x-height (px)", "ability.x_h"),
    ("Ability: font size from x-height (px)", "ability.size"),
    ("Ability: dark zone starts (y)", "ability.dark_start"),
    ("Gradient: transition starts (y)", "gradient.start"),
    ("Gradient: fully dark from (y)", "gradient.end"),
    ("Gradient: light level", "gradient.light"),
    ("Gradient: dark level", "gradient.dark"),
    ("Verse: line count", "verse.n"),
    ("Verse: line pitch (px)", "verse.pitch"),
    ("Verse: x-height (px)", "verse.x_h"),
    ("Verse: font size from x-height (px)", "verse.size"),
    ("Verse: left edge (x)", "verse.left"),
    ("Verse: last baseline (y)", "verse.last_baseline"),
    ("Reference: x-height (px)", "reference.x_h"),
    ("Reference: font size from x-height (px)", "reference.size"),
    ("Reference: font size from width (px)", "reference.fit.size_x"),
    ("Reference: right edge (x)", "reference.right"),
    ("Reference: baseline (y)", "reference.baseline"),
    ("Credits: line count", "credits.n"),
    ("Credits: Illus. font size from x-height (px)", "credits.illus.size"),
    ("Credits: Illus. baseline (y)", "credits.illus.baseline"),
    ("Credits: Illus. right edge (x)", "credits.illus.right"),
    ("Credits: copyright font size from x-height (px)", "credits.copyright.size"),
    ("Credits: copyright font size from width (px)", "credits.copyright.fit.size_x"),
    ("Credits: copyright baseline (y)", "credits.copyright.baseline"),
    ("Credits: copyright right edge (x)", "credits.copyright.right"),
    ("ID bubble: pill width (px)", "id_bubble.w"),
    ("ID bubble: pill left (x)", "id_bubble.left"),
    ("ID bubble: pill top (y)", "id_bubble.top"),
    ("ID bubble: pill bottom (y)", "id_bubble.bottom"),
    ("ID bubble: pill fill luminance", "id_bubble.fill_lum"),
    ("ID bubble: text top (y)", "id_bubble.text_top"),
    ("ID bubble: text height (px)", "id_bubble.text_h"),
    ("ID bubble: text width (px)", "id_bubble.text_w"),
    ("ID bubble: text font size from width (px)", "id_bubble.text_fit.size_x"),
    ("ID bubble: text bottom (y)", "id_bubble.text_bottom"),
    ("Card number: digits left (x)", "number.number.left"),
    ("Card number: digits top (y)", "number.number.top"),
    ("Card number: digits bottom (y)", "number.number.bottom"),
    ("Card number: digits height (px)", "number.number.h"),
    ("Set symbol: left (x)", "number.symbol.left"),
    ("Set symbol: top (y)", "number.symbol.top"),
    ("Set symbol: width (px)", "number.symbol.w"),
    ("Set symbol: height (px)", "number.symbol.h"),
    ("Frame: border left (x)", "frame.border_left.pos"),
    ("Frame: border stroke width (px)", "frame.border_left.width"),
    ("Frame: art top (y)", "frame.art_top.pos"),
    ("Frame: art top stroke width (px)", "frame.art_top.width"),
    ("Frame: art bottom (y)", "frame.art_bottom.pos"),
    ("Frame: art left (x)", "frame.art_left.pos"),
    ("Frame: art right (x)", "frame.art_right.pos"),
    ("Frame: text box top (y)", "frame.text_top.pos"),
    ("Frame: text box top stroke width (px)", "frame.text_top.width"),
    ("Frame: text box bottom (y)", "frame.text_bottom.pos"),
    ("Frame: text box left (x)", "frame.text_left.pos"),
    ("Frame: text box right (x)", "frame.text_right.pos"),
    ("Frame: icon box right (x)", "frame.leftbox_right.pos"),
    ("Frame: icon box right stroke width (px)", "frame.leftbox_right.width"),
    ("Frame: icon box bottom (y)", "frame.leftbox_bottom.pos"),
    ("Type icon: width (px)", "type_icon.w"),
    ("Type icon: height (px)", "type_icon.h"),
    ("Type icon: top (y)", "type_icon.top"),
    ("Type icon: bottom (y)", "type_icon.bottom"),
    ("Type icon: centre (x)", "type_icon.center_x"),
    ("Class icons: stack top (y)", "class_icons.top"),
    ("Class icons: stack bottom (y)", "class_icons.bottom"),
    ("Class icons: left edge (x)", "class_icons.left"),
]


def summarize(results: dict) -> list[dict]:
    rows = []
    for label, path in SUMMARY:
        vals = [(dig(r["real"], path), dig(r["ours"], path)) for r in results.values()]
        both = [(a, b) for a, b in vals if a is not None and b is not None]
        reals = [a for a, _ in vals if a is not None]
        ourss = [b for _, b in vals if b is not None]
        row = {"metric": label, "n_real": len(reals), "n_ours": len(ourss),
               "real_median": round(statistics.median(reals), 1) if reals else None,
               "ours_median": round(statistics.median(ourss), 1) if ourss else None}
        if both:
            deltas = [a - b for a, b in both]
            row.update({"n": len(both), "delta_median": round(statistics.median(deltas), 1),
                        "delta_p10": round(float(np.percentile(deltas, 10)), 1),
                        "delta_p90": round(float(np.percentile(deltas, 90)), 1)})
        rows.append(row)
    return rows


class NpEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, np.integer):
            return int(o)
        if isinstance(o, np.floating):
            return float(o)
        return super().default(o)


def fmt(v):
    return "" if v is None else v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", required=True)
    ap.add_argument("--real", required=True)
    ap.add_argument("--ours", required=True)
    ap.add_argument("--fonts", required=True, help="dir holding SYMPHOBL.TTF and grail.ttf")
    ap.add_argument("--public-fonts", default=str(Path(__file__).resolve().parents[2] / "public" / "forge" / "fonts"))
    ap.add_argument("--out", required=True)
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default="", help="comma-separated ids")
    ap.add_argument("--no-images", action="store_true")
    args = ap.parse_args()

    pairs = json.loads(Path(args.pairs).read_text())
    fonts = Fonts(Path(args.fonts), Path(args.public_fonts))
    out = Path(args.out)
    (out / "triptych").mkdir(parents=True, exist_ok=True)
    heat = np.zeros((CANVAS[1], CANVAS[0]))
    results = {}
    ids = [i for i in args.only.split(",") if i] or list(pairs)
    if args.limit:
        ids = ids[: args.limit]
    for i, cid in enumerate(ids):
        card = pairs[cid]
        real, rinfo = register(Image.open(Path(args.real) / f"{cid}.jpg"))
        ours, oinfo = register(Image.open(Path(args.ours) / f"{cid}.jpg"))
        results[cid] = {
            "title": card["title"], "types": card.get("types"), "registration": {"real": rinfo, "ours": oinfo},
            "real": measure(real, fonts, card, args.year), "ours": measure(ours, fonts, card, args.year),
        }
        d = np.abs(lum(ours) - lum(real))
        d[~diff_mask()] = 0
        heat += d
        if not args.no_images:
            boxes = []
            for who, color in (("real", "#e11"), ("ours", "#11e")):
                t = results[cid][who]["title"]
                if t.get("found"):
                    boxes.append((color, (t["left"], t["top"], t["right"], t["bottom"])))
            triptych(ours, real, out / "triptych" / f"{cid}.jpg", boxes)
        if (i + 1) % 25 == 0:
            print(f"{i + 1}/{len(ids)}")
    heat /= max(1, len(ids))
    Image.fromarray(np.clip(255 - heat * 4, 0, 255).astype(np.uint8)).save(out / "heat.png")
    (out / "report.json").write_text(json.dumps(results, indent=1, cls=NpEncoder))
    rows = summarize(results)
    (out / "summary.json").write_text(json.dumps(rows, indent=1, cls=NpEncoder))
    lines = ["| metric | n | real median | ours median | delta (real - ours) median | p10 | p90 |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['metric']} | {fmt(r.get('n'))} ({r['n_real']}/{r['n_ours']}) | {fmt(r['real_median'])} | {fmt(r['ours_median'])} | "
                     f"{fmt(r.get('delta_median'))} | {fmt(r.get('delta_p10'))} | {fmt(r.get('delta_p90'))} |")
    (out / "summary.md").write_text("\n".join(lines) + "\n")
    tl = ["| card | chars | real size y | real size x | real condense | real right | real baseline | ours size y | ours size x | ours condense | ours right | ours baseline |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for cid, r in sorted(results.items(), key=lambda kv: -len(kv[1]["title"])):
        a, b = r["real"]["title"], r["ours"]["title"]
        g = lambda d, k: fmt(d.get(k))
        tl.append(f"| {r['title']} | {len(r['title'])} | {g(a,'size_y')} | {g(a,'size_x')} | {g(a,'condense')} | {g(a,'right')} | {g(a,'baseline')} | "
                  f"{g(b,'size_y')} | {g(b,'size_x')} | {g(b,'condense')} | {g(b,'right')} | {g(b,'baseline')} |")
    (out / "titles.md").write_text("\n".join(tl) + "\n")
    print(f"wrote {out}/report.json, summary.md, titles.md, heat.png, triptych/ ({len(ids)} cards)")


if __name__ == "__main__":
    main()
