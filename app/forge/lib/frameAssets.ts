// Pure mapping from a DesignCard to the frame kit under public/forge/frames/
// (washes, icon boxes, type icons, ability-box gradient). No DOM, no React.
// The kit and app/forge/lib/frameGeometry.ts are generated from the design team's
// Illustrator template by scripts/forge-extract-template.py — see the kit README.
//
// Print rules this follows (checked against printed cards, 2026-09-10; multi-brigade 2026-09-13):
//  * One icon box, top-left, banded top to bottom in brigade order: two brigades split it
//    into a top/bottom band, three or more into equal bands. The wash blends the same
//    brigades the same way, top to bottom. Only a card of every brigade of one alignment
//    (printed "Multi") uses the multi-brigade foil.
//  * Lost Souls have no icon box.
//  * Covenants and Curses carry the enhancement icon (bible / skull) on the left and the
//    artifact chalice in a second box on the right; the title centers between them.
//  * Stats print for Heroes and Evil Characters always, and for enhancements, Covenants
//    and Curses when a value is entered.

import type { Alignment, Brigade, CardType, DesignCard, StatValue } from "./designCard";
import { cardApplicability, multiBrigadeSide } from "./designCard";
import { BRIGADE_BOX_HEX, ICON_RECTS } from "./frameGeometry";

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

/** Wash image URLs, top to bottom: [] (no brigade yet), or one per brigade (the renderer
 *  blends each in below the one before). A special type, or a card of every brigade (the
 *  multi-brigade foil), always yields exactly one. */
export function washPaths(card: DesignCard): string[] {
  const special = specialWash(card);
  if (special) return [`${KIT}/washes/${special}.webp`];
  const brigades = card.brigades ?? [];
  const foil = multiFoil(brigades);
  if (foil) return [`${KIT}/badges/${foil}.webp`];
  return brigades.map((b) => `${KIT}/washes/${BRIGADE_SLUG[b]}.webp`);
}

export type IconRect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

export type IconBox = {
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

/** The icon box for one side. Left exists once a type is chosen (never for Lost Souls);
 *  right only for Covenants and Curses, holding the artifact chalice. */
export function iconBox(card: DesignCard, side: "left" | "right"): IconBox | null {
  const types = card.cardType ?? [];
  if (types.length === 0 || types.includes("LostSoul")) return null;
  if (side === "right") {
    if (!types.some((t) => ARTIFACT_LIKE.includes(t))) return null;
    return {
      fill: NEUTRAL_BOX, bands: [], badge: `${KIT}/badges/artifact.webp`, badgeAlign: BADGE_ALIGN.artifact,
      icon: null, iconRect: null, withStats: false, darkText: false,
    };
  }
  const brigades = card.brigades ?? [];
  const badge = badgeFor(types, card.alignment, brigades);
  const fill = brigades[0] ? BRIGADE_HEX[brigades[0]] : NEUTRAL_BOX;
  const bands = badge ? [] : brigades.slice(1).map((b) => BRIGADE_HEX[b]);
  const withStats = showsStats(card);
  const base = ICON_BY_TYPE[types[0]];
  const slot = (base && withStats && STATS_SLOT.has(base) ? `${base}Stats` : base) as keyof typeof ICON_RECTS | null;
  return {
    fill,
    bands,
    badge: badge ? `${KIT}/badges/${badge}.webp` : null,
    badgeAlign: (badge && BADGE_ALIGN[badge]) || "xMidYMid",
    icon: base ? `${KIT}/icons/${base}.png` : null,
    iconRect: slot ? ICON_RECTS[slot] : null,
    withStats,
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
  return slugs.map((s) => {
    const slot = s === "territory" ? ICON_RECTS.territory : ICON_RECTS.shield;
    const rect = { x: ICON_RECTS.shield.x, y: next ?? slot.y, w: slot.w, h: slot.h };
    next = rect.y + rect.h + 6;
    return { src: `${KIT}/icons/${s}.png`, rect };
  });
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
