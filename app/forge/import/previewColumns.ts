// The columns of the import preview: what each card will be saved with, read from its parsed
// snapshot rather than the file's cells, so a value the parser couldn't read shows as blank. Only
// the columns this file carries are shown. Pure.

import { brigadeLabels, cardRawText, type Brigade, type DesignCard, type StatValue } from "@/app/forge/lib/designCard";
import { brigadeLabel, typeLabel } from "@/app/forge/lib/filterIcons";

export interface PreviewColumn {
  key: string;
  label: string;
  value: (card: DesignCard) => string;
  long?: boolean; // running text: gets room, and clamps
}

const stat = (v: StatValue | undefined) => (v === null || v === undefined ? "" : String(v));

const COLUMNS: PreviewColumn[] = [
  { key: "type", label: "Type", value: (c) => (c.cardType ?? []).map(typeLabel).join(" / ") },
  { key: "alignment", label: "Alignment", value: (c) => (c.alignment === "Good_Evil" ? "Good/Evil" : c.alignment ?? "") },
  // brigadeLabels may return "Good Multi", which brigadeLabel passes through.
  { key: "brigade", label: "Brigade", value: (c) => brigadeLabels(c.brigades ?? []).map((b) => brigadeLabel(b as Brigade)).join(", ") },
  { key: "strength", label: "Str", value: (c) => stat(c.strength) },
  { key: "toughness", label: "Tgh", value: (c) => stat(c.toughness) },
  { key: "class", label: "Class", value: (c) => [...(c.class ?? []), ...(c.icons ?? [])].join(", ") },
  { key: "identifiers", label: "Identifiers", value: (c) => (c.identifiers ?? []).join(", ") },
  { key: "ability", label: "Ability", value: (c) => cardRawText(c), long: true },
  { key: "reference", label: "Reference", value: (c) => c.reference ?? "" },
  { key: "scripture", label: "Scripture", value: (c) => c.scripture ?? "", long: true },
  { key: "rarity", label: "Rarity", value: (c) => c.rarity ?? "" },
  { key: "legality", label: "Legality", value: (c) => c.legality ?? "" },
  { key: "artist", label: "Artist", value: (c) => c.artistCredit ?? "" },
];

export function previewColumns(cards: DesignCard[]): PreviewColumn[] {
  return COLUMNS.filter((col) => cards.some((c) => col.value(c) !== ""));
}
