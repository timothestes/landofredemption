// Pure helpers for promoting a Forge set into the public card catalog.
// CLIENT-SAFE: no server-only imports.
//
// designCardToCatalogRow maps a frozen DesignCard onto the public CardData shape
// by reusing designCardToLackeyRow (the one serializer that already encodes the
// class+icons recombination, rawText-first ability fallback, and enum→display
// mappings) and reading its cells back by header — so the catalog row can never
// drift from the Lackey export. It must NOT be replaced with designCardToCard
// (deckAdapter.ts): that adapter emits "—" display placeholders for empty stats,
// which would corrupt catalog rows.
import type { CardData } from "@/lib/cards/generated/cardData";
import type { DesignCard } from "./designCard";
import {
  CARDDATA_HEADER, designCardToLackeyRow, type LackeyRowContext,
} from "./lackey";

/**
 * The public-catalog image base name: Name_With_Underscores_(SetCode).
 * Commas are stripped (matching the historical release crop script's rename) and
 * filesystem-unsafe characters collapse to spaces before underscoring. The
 * guaranteed "_(SetCode)" suffix is what makes released imgFiles structurally
 * collision-free against upstream names. NOTE: this is deliberately NOT the
 * Lackey export's imageFileSlug (which hyphen-joins and appends no suffix); the
 * export adopts released imgFiles, not the other way around. Pure.
 */
export function catalogImgFileSlug(name: string, setCode: string): string {
  const base = name
    .replace(/,/g, "")
    .replace(/[\t\r\n\/\\:*?"<>|]+/g, " ")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${base || "card"}_(${setCode})`;
}

/** DesignCard (a frozen approved version's data) → a public CardData row. Pure. */
export function designCardToCatalogRow(card: DesignCard, ctx: LackeyRowContext): CardData {
  const cells = designCardToLackeyRow(card, ctx);
  const cell = (h: (typeof CARDDATA_HEADER)[number]) => cells[CARDDATA_HEADER.indexOf(h)];
  return {
    name: cell("Name"),
    set: cell("Set"),
    imgFile: cell("ImageFile"),
    officialSet: cell("OfficialSet"),
    type: cell("Type"),
    brigade: cell("Brigade"),
    strength: cell("Strength"),
    toughness: cell("Toughness"),
    class: cell("Class"),
    identifier: cell("Identifier"),
    specialAbility: cell("SpecialAbility"),
    rarity: cell("Rarity"),
    reference: cell("Reference"),
    alignment: cell("Alignment"),
    // The release makes cards tournament-legal: an unset legality freezes as
    // Rotation (the same default the forge deckbuilder applies).
    legality: cell("Legality") || "Rotation",
    // Preview only: forge_promote_set stores the credit from the approved
    // version itself (migration 129), the same text CardSvg prints.
    artist: (card.artistCredit ?? "").trim(),
  };
}

// ---------------------------------------------------------------------------
// Image transform decisions (§6 of the design). Stored per manifest row as
// image_transform jsonb; null means automatic (passthrough / aspect resize /
// center cover-crop).
// ---------------------------------------------------------------------------

export const CARD_IMAGE_WIDTH = 345;
export const CARD_IMAGE_HEIGHT = 495;
export const CARD_IMAGE_ASPECT = CARD_IMAGE_WIDTH / CARD_IMAGE_HEIGHT; // 0.69697
/** Aspect within this fraction of the target auto-resizes without a crop. */
export const AUTO_RESIZE_TOLERANCE = 0.01;

// The historical release script's printer bleed-crop boxes, absolute pixels on
// its era's ~815×1125 print scans, expressed as fractions of the source so they
// keep working across resolutions. P2's box lands almost exactly on card aspect.
export const PRINTER_PRESETS = {
  printer1: { x: 63 / 815, y: 60 / 1125, width: (762 - 63) / 815, height: (1065 - 60) / 1125 },
  printer2: { x: 46 / 815, y: 43 / 1125, width: (769 - 46) / 815, height: (1082 - 43) / 1125 },
} as const;

export type ReleaseImageTransform =
  | { mode: "cover" }
  | { mode: "preset"; preset: keyof typeof PRINTER_PRESETS }
  | { mode: "crop"; rect: { x: number; y: number; width: number; height: number } };

/** Parse a stored image_transform jsonb value; null/invalid → automatic. Pure. */
export function parseImageTransform(value: unknown): ReleaseImageTransform | null {
  if (typeof value !== "object" || value === null) return null;
  const t = value as Record<string, unknown>;
  if (t.mode === "cover") return { mode: "cover" };
  if (t.mode === "preset" && typeof t.preset === "string" && t.preset in PRINTER_PRESETS) {
    return { mode: "preset", preset: t.preset as keyof typeof PRINTER_PRESETS };
  }
  if (t.mode === "crop" && typeof t.rect === "object" && t.rect !== null) {
    const r = t.rect as Record<string, unknown>;
    const nums = [r.x, r.y, r.width, r.height];
    if (nums.every((n) => typeof n === "number" && Number.isFinite(n))) {
      return {
        mode: "crop",
        rect: { x: r.x as number, y: r.y as number, width: r.width as number, height: r.height as number },
      };
    }
  }
  return null;
}
