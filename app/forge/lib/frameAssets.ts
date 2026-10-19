// Pure mapping from a DesignCard to the frame kit under public/forge/frames/
// (washes, icon boxes, type icons, ability-box gradient). No DOM, no React.
// The kit and app/forge/lib/frameGeometry.ts are generated from the design team's
// Illustrator template by scripts/forge-extract-template.py — see the kit README.
//
// Print rules this follows (checked against printed cards, 2026-09-10; multi-brigade 2026-09-13;
// dual alignment 2026-10-19):
//  * One icon box, top-left, banded top to bottom in brigade order in equal heights. The
//    wash blends the same brigades the same way, top to bottom. Only a card of every brigade
//    of one alignment (printed "Multi") uses the multi-brigade foil.
//  * Lost Souls have no icon box.
//  * Covenants and Curses carry the enhancement icon (bible / skull) on the left and the
//    artifact chalice in a second box on the right; the title centers between them.
//  * Stats print for Heroes and Evil Characters always, and for enhancements, Covenants
//    and Curses when a value is entered.
//  * A dual-alignment card (a good and an evil type, or alignment Good/Evil) prints as two
//    half-frames: the good type's icon in a box of the good brigades on the left, the evil
//    type's in a box of the evil brigades on the right, the title between them. Each box
//    prints its side of a paired stat ("6 (0)": 6 left, 0 right; a single value on both),
//    the wash blends good into evil left to right, and a character's class shields print
//    under both boxes. (Perfidy, Measured Mien, Return to Fight, Quake in Edom, Joab the
//    General, Battle Axe, Philosophy, Defenestrated!, Blood Avenger.)

import type { Alignment, Brigade, CardType, DesignCard, StatValue } from "./designCard";
import {
  cardApplicability, multiBrigadeSide, GOOD_TYPES, EVIL_TYPES, GOOD_BRIGADES, EVIL_BRIGADES,
} from "./designCard";
import { BRIGADE_BOX_HEX, CANVAS, ICON_RECTS, RECTS } from "./frameGeometry";

export type Side = "left" | "right";

const KIT = "/forge/frames";

// Brigade -> wash / box-color slug. Both golds share the template's one "gold".
export const BRIGADE_SLUG: Record<Brigade, keyof typeof BRIGADE_BOX_HEX> = {
  Blue: "blue", Clay: "clay", GoodGold: "gold", Green: "green", Purple: "purple",
  Red: "red", Silver: "silver", Teal: "teal", White: "white",
  Black: "black", Brown: "brown", Crimson: "crimson", EvilGold: "gold",
  Gray: "gray", Orange: "orange", PaleGreen: "pale-green",
};

// The template ships no Red or Teal wash; the kit hue-shifts crimson / blue for them.
export const SYNTHESIZED_WASHES: ReadonlySet<string> = new Set(["red", "teal"]);

// Icon-box color per brigade (ICC-converted from the template's CMYK fills).
export const BRIGADE_HEX: Record<Brigade, string> = Object.fromEntries(
  (Object.keys(BRIGADE_SLUG) as Brigade[]).map((b) => [b, BRIGADE_BOX_HEX[BRIGADE_SLUG[b]]]),
) as Record<Brigade, string>;

// Neutral box for brigade-less types that have no badge (Fortress/City/Curse/Covenant
// without a brigade). The template has no such fill; gray is the least wrong.
const NEUTRAL_BOX = BRIGADE_BOX_HEX.gray;

export type SpecialWash = "lost-soul" | "artifact" | "good-dom" | "evil-dom" | "good-fort" | "evil-fort";

// Brigade-less types take a type wash instead of a brigade wash (first match wins).
export function specialWash(card: DesignCard): SpecialWash | null {
  const types = card.cardType ?? [];
  const evil = card.alignment === "Evil";
  if (types.includes("LostSoul")) return "lost-soul";
  if (types.includes("Artifact")) return "artifact";
  if (types.includes("Dominant")) return evil ? "evil-dom" : "good-dom";
  if (types.includes("Fortress")) return evil ? "evil-fort" : "good-fort";
  return null;
}

// Printed "Multi" cards are every brigade of their alignment (see multiBrigadeSide); the
// template's foil replaces the bands.
function multiFoil(brigades: readonly Brigade[]): "multi-good" | "multi-evil" | null {
  const side = multiBrigadeSide(brigades);
  return side === "Good" ? "multi-good" : side === "Evil" ? "multi-evil" : null;
}

/** Whether the card prints as a dual-alignment frame — a good half on the left, an evil half
 *  on the right: any card with both a good and an evil type (GE/EE, Hero/Evil Character), or
 *  whose alignment is set to Good/Evil (a dual Dominant). The catalog files GE/EE cards as
 *  Neutral, so the types decide before the alignment does. Pure. */
export function isDualAlignment(card: DesignCard): boolean {
  if (card.alignment === "Good_Evil") return true;
  const types = card.cardType ?? [];
  return types.some((t) => GOOD_TYPES.includes(t)) && types.some((t) => EVIL_TYPES.includes(t));
}

/** One side of a paired stat: "6 (0)" prints 6 in the good (left) box and 0 in the evil
 *  (right) one; a single value prints in both (Battle Axe, 4/3 (2): 4/3 and 4/2). Pure. */
export function sideStat(v: StatValue | undefined, side: Side): StatValue | undefined {
  if (typeof v !== "string") return v;
  const m = /^(.+?)\s*\((.+)\)$/.exec(v.trim());
  if (!m) return v;
  const part = (side === "left" ? m[1] : m[2]).trim();
  return /^\d+$/.test(part) ? Number(part) : part;
}

/** One half of a dual-alignment card as a card of its own: the types that are not the other
 *  side's (all of them when none is left), that side's alignment and brigades, and its side
 *  of each stat. */
function sideCard(card: DesignCard, side: Side): DesignCard {
  const good = side === "left";
  const other: readonly CardType[] = good ? EVIL_TYPES : GOOD_TYPES;
  const own: readonly Brigade[] = good ? GOOD_BRIGADES : EVIL_BRIGADES;
  const types = card.cardType ?? [];
  const sideTypes = types.filter((t) => !other.includes(t));
  return {
    ...card,
    cardType: sideTypes.length ? sideTypes : types,
    alignment: good ? "Good" : "Evil",
    brigades: (card.brigades ?? []).filter((b) => own.includes(b)),
    strength: sideStat(card.strength, side),
    toughness: sideStat(card.toughness, side),
  };
}

/** One column of washes, top to bottom: [] (no brigade yet), or one per brigade. A special
 *  type, or a card of every brigade (the multi-brigade foil), always yields exactly one. */
function columnWashes(card: DesignCard): string[] {
  const special = specialWash(card);
  if (special) return [`${KIT}/washes/${special}.webp`];
  const brigades = card.brigades ?? [];
  const foil = multiFoil(brigades);
  if (foil) return [`${KIT}/badges/${foil}.webp`];
  return brigades.map((b) => `${KIT}/washes/${BRIGADE_SLUG[b]}.webp`);
}

/** Wash columns, left to right: one for the usual card, two for a dual-alignment card (the
 *  good half's washes, then the evil half's), which the renderers blend left to right. Each
 *  column runs top to bottom (the renderer blends each wash in below the one before) and may
 *  be empty — no brigade on that side yet — which paints neutral. */
export function washColumns(card: DesignCard): string[][] {
  if (!isDualAlignment(card)) return [columnWashes(card)];
  return [columnWashes(sideCard(card, "left")), columnWashes(sideCard(card, "right"))];
}

/** Every wash a card draws, in draw order (left column first, each top to bottom). */
export function washPaths(card: DesignCard): string[] {
  return washColumns(card).flat();
}

export type IconRect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

export type IconBox = {
  /** Where the box sits, canvas px: the template's left slot, its mirror image on the right
   *  of a dual-alignment card, or the template's chalice slot. */
  rect: IconRect;
  /** Fill of the box — the top band when there are `bands`. */
  fill: string;
  /** Fills of the bands below the top one, top to bottom: one per further brigade. */
  bands: string[];
  /** Box-filling composite (artifact chalice, dominant nebula, multi-brigade foil). */
  badge: string | null;
  /** How the badge is cropped to the box (SVG preserveAspectRatio alignment): the template
   *  anchors the chalice to the bottom and the good foil to the top. */
  badgeAlign: "xMidYMin" | "xMidYMid" | "xMidYMax";
  /** Type icon drawn over the fill/badge, if any. */
  icon: string | null;
  /** Where the icon sits, canvas px, from the template's placement. */
  iconRect: IconRect | null;
  /** Stats text ("S/T") shares the box; the icon drops into the lower slot. */
  withStats: boolean;
  /** The readout itself ("9/6", "?/?" until entered), or null when the box prints none. */
  stats: string | null;
  /** Light fills take dark stat text (the template ships #/# in white and black). */
  darkText: boolean;
};

type TypeIcon = "cross" | "dragon" | "bible" | "skull" | "fortress" | "site";
const ICON_BY_TYPE: Record<CardType, TypeIcon | null> = {
  Hero: "cross", EvilCharacter: "dragon", GE: "bible", EE: "skull",
  Artifact: null, Dominant: null, Fortress: "fortress", Site: "site", City: "site",
  Curse: "skull", Covenant: "bible", LostSoul: null,
};
// Icons the template places lower when stats print (the cross and dragon only ever print
// with stats, so their one slot already allows for them).
const STATS_SLOT: ReadonlySet<TypeIcon> = new Set(["skull", "bible"]);
const BADGE_ALIGN: Record<string, IconBox["badgeAlign"]> = { artifact: "xMidYMax", "multi-good": "xMidYMin" };
// Enhancement-or-artifact types: chalice box on the right.
const ARTIFACT_LIKE: readonly CardType[] = ["Covenant", "Curse"];

function hasStat(v: StatValue | undefined): boolean {
  return v !== null && v !== undefined && v !== "";
}

/** Whether the box carries a strength/toughness readout: always for stat-required types
 *  (Hero, Evil Character), when a value is entered for stat-optional ones. */
export function showsStats(card: DesignCard): boolean {
  const stats = cardApplicability(card.cardType ?? []).stats;
  if (stats === "na") return false;
  return stats === "required" || hasStat(card.strength) || hasStat(card.toughness);
}

function badgeFor(types: CardType[], alignment: Alignment | undefined, brigades: readonly Brigade[]): string | null {
  const evil = alignment === "Evil";
  if (types.includes("Artifact")) return "artifact";
  if (types.includes("Dominant")) return evil ? "reaper" : "lamb";
  if (types.includes("Fortress")) return evil ? "evil-dom" : "good-dom";
  return multiFoil(brigades);
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** The same rect on the other side of the card. */
const mirror = (r: IconRect): IconRect => ({ x: CANVAS.w - r.x - r.w, y: r.y, w: r.w, h: r.h });

function statText(s: StatValue | undefined, t: StatValue | undefined): string {
  const f = (v: StatValue | undefined) => (v === null || v === undefined || v === "" ? "?" : String(v));
  return `${f(s)}/${f(t)}`;
}

/** The icon box for one side. Left exists once a type is chosen (never for Lost Souls);
 *  right for Covenants and Curses, holding the artifact chalice, and for a dual-alignment
 *  card, holding its evil half (the left box then holds the good half). */
export function iconBox(card: DesignCard, side: Side): IconBox | null {
  const types = card.cardType ?? [];
  if (types.length === 0 || types.includes("LostSoul")) return null;
  const withStats = showsStats(card);
  if (isDualAlignment(card)) return brigadeBox(sideCard(card, side), side, withStats);
  if (side === "right") {
    if (!types.some((t) => ARTIFACT_LIKE.includes(t))) return null;
    return {
      rect: RECTS.rightBox, fill: NEUTRAL_BOX, bands: [], badge: `${KIT}/badges/artifact.webp`, badgeAlign: BADGE_ALIGN.artifact,
      icon: null, iconRect: null, withStats: false, stats: null, darkText: false,
    };
  }
  return brigadeBox(card, "left", withStats);
}

/** A brigade-colored type box: the template's left box, or its mirror image on the right. */
function brigadeBox(card: DesignCard, side: Side, withStats: boolean): IconBox {
  const types = card.cardType ?? [];
  const brigades = card.brigades ?? [];
  const badge = badgeFor(types, card.alignment, brigades);
  const fill = brigades[0] ? BRIGADE_HEX[brigades[0]] : NEUTRAL_BOX;
  const bands = badge ? [] : brigades.slice(1).map((b) => BRIGADE_HEX[b]);
  const base = ICON_BY_TYPE[types[0]];
  const slot = (base && withStats && STATS_SLOT.has(base) ? `${base}Stats` : base) as keyof typeof ICON_RECTS | null;
  const iconRect = slot ? ICON_RECTS[slot] : null;
  return {
    rect: side === "left" ? RECTS.leftBox : mirror(RECTS.leftBox),
    fill,
    bands,
    badge: badge ? `${KIT}/badges/${badge}.webp` : null,
    badgeAlign: (badge && BADGE_ALIGN[badge]) || "xMidYMid",
    icon: base ? `${KIT}/icons/${base}.png` : null,
    iconRect: iconRect && side === "right" ? mirror(iconRect) : iconRect,
    withStats,
    stats: withStats ? statText(card.strength, card.toughness) : null,
    darkText: !badge && luminance(fill) > 0.55,
  };
}

export type ClassIcon = { src: string; rect: IconRect };
/** Class icons under the left box: the shield(s), then the territory plate, stacked down
 *  the left edge at the template's sizes. */
export function classIcons(card: DesignCard): ClassIcon[] {
  const slugs: ("warrior" | "weapon" | "territory")[] = [];
  for (const c of card.class ?? []) slugs.push(c === "Warrior" ? "warrior" : "weapon");
  if ((card.icons ?? []).includes("Territory")) slugs.push("territory");
  let next: number | null = null;
  const icons = slugs.map((s) => {
    const slot = s === "territory" ? ICON_RECTS.territory : ICON_RECTS.shield;
    const rect = { x: ICON_RECTS.shield.x, y: next ?? slot.y, w: slot.w, h: slot.h };
    next = rect.y + rect.h + 6;
    return { slug: s, src: `${KIT}/icons/${s}.png`, rect };
  });
  const out: ClassIcon[] = icons.map(({ src, rect }) => ({ src, rect }));
  // A dual-alignment character prints its shield(s) under both boxes (Joab, the General);
  // the territory plate stays on the left.
  if (isDualAlignment(card)) {
    for (const c of icons) if (c.slug !== "territory") out.push({ src: c.src, rect: mirror(c.rect) });
  }
  return out;
}

export function isPreviewApproximate(card: DesignCard): boolean {
  // The template has no multi-brigade wash; the box foil stands in for one.
  if (multiFoil(card.brigades ?? [])) return true;
  if (card.legality === "Classic") return true;
  if ((card.brigades ?? []).some((b) => SYNTHESIZED_WASHES.has(BRIGADE_SLUG[b]))) return true;
  return false;
}

/** Where each wash blends in, as percentages of the border rect's height: nothing for the top
 *  wash, then a fade from `from` to `to` for each further one. Edges sit at i/n of the height
 *  and each fade is 40% / n wide, so two brigades fade 40% to 60%. The browser preview's CSS
 *  masks and the server renderer's SVG masks both come from here. */
export function washBands(n: number): ({ from: number; to: number } | null)[] {
  return Array.from({ length: n }, (_, i) => {
    if (i === 0) return null;
    const edge = (100 * i) / n, half = 20 / n;
    return { from: edge - half, to: edge + half };
  });
}

/** Every frame-kit image a card's render draws (washes, icon-box badges and icons, class
 *  icons), deduplicated, as public paths. The server renderer inlines exactly these. */
export function framePaths(card: DesignCard): string[] {
  const out = new Set<string>(washPaths(card));
  for (const side of ["left", "right"] as const) {
    const box = iconBox(card, side);
    if (box?.badge) out.add(box.badge);
    if (box?.icon) out.add(box.icon);
  }
  for (const c of classIcons(card)) out.add(c.src);
  return [...out];
}
