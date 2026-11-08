// Pure diff of two DesignCard snapshots → per-field change descriptors + a
// one-line plain-language summary, plus a value coercer for suggestions. No DB,
// no UI. Drives the Current vs Proposed review diff.

import { parseStatInput, type DesignCard } from "@/app/forge/lib/designCard";

export type FieldChange = {
  field: keyof DesignCard;
  label: string;
  kind: "added" | "removed" | "changed";
  before: string | null;
  after: string | null;
};

// Friendly labels for every field the diff OR a field-anchored suggestion may
// reference. Consumed by the diff renderer and the suggestion picker/labels.
export const FIELD_LABELS: Record<string, string> = {
  name: "Name", rawText: "Card text", cardType: "Type", alignment: "Alignment",
  brigades: "Brigade", strength: "Strength", toughness: "Toughness", class: "Class",
  icons: "Icons", warriorSide: "Warrior class icon", weaponSide: "Weapon class icon",
  territorySide: "Territory class icon", identifiers: "Identifiers",
  specialAbility: "Special ability", reference: "Reference", legality: "Legality",
  rarity: "Rarity", scripture: "Scripture", artistCredit: "Artist", cardFrame: "Card frame",
};

// The real editing surface (StudioEditor name + rawText, CardDetailsFields for the
// rest). Drives the Current vs Proposed diff. `rawText` is the primary body; the
// old no-editor fields (specialAbility/legality/artistCredit/cardFrame) are
// intentionally excluded so a body edit no longer reads "No field changes".
export const DIFF_FIELDS: (keyof DesignCard)[] = [
  "name", "rawText", "cardType", "alignment", "brigades", "strength", "toughness",
  "class", "icons", "warriorSide", "weaponSide", "territorySide", "identifiers", "reference",
  "scripture", "rarity",
];

// Fields a comment may anchor a suggestion to. Must mirror the SQL allowlist
// `_forge_is_card_field` (migration 067) or the RPC rejects the suggestion — so it
// excludes `rawText` (not yet in the allowlist) and keeps the legacy keys.
export const SUGGESTABLE_FIELDS: (keyof DesignCard)[] = [
  "name", "cardType", "alignment", "brigades", "strength", "toughness", "class",
  "icons", "identifiers", "specialAbility", "reference", "legality", "rarity",
  "scripture", "artistCredit", "cardFrame",
];

// Canonical (key-order-independent) deep equality, mirroring SQL jsonb '='.
// Used ONLY to word the release dialog — migration 083 decides what a release
// actually does to open proposals, server-side — so drift here can misword the
// dialog but can never change behavior.
// Deliberately NOT `diffCards(a, b).length === 0`: DIFF_FIELDS omits
// specialAbility/legality/artistCredit/cardFrame, so a diff-based
// compare would call two genuinely different snapshots equal.
// A body/verse change (or any value with a newline) is unreadable as a single inline
// strikethrough — stack the before/after as pre-wrapped blocks instead. Shared so the
// card history and the open-proposal diff render the same change the same way.
export function isBlockChange(c: FieldChange): boolean {
  return (
    c.field === "rawText" ||
    c.field === "scripture" ||
    (c.before?.includes("\n") ?? false) ||
    (c.after?.includes("\n") ?? false)
  );
}

export function sameSnapshot(a: DesignCard, b: DesignCard): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

const ARRAY_FIELDS = new Set(["cardType", "brigades", "class", "icons", "identifiers"]);
const NUMBER_FIELDS = new Set(["strength", "toughness"]);

function display(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (Array.isArray(v)) return v.length ? v.join(", ") : null;
  return String(v);
}

export function diffCards(before: DesignCard, after: DesignCard): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of DIFF_FIELDS) {
    const b = display(before[f]);
    const a = display(after[f]);
    if (b === a) continue;
    const kind = b === null ? "added" : a === null ? "removed" : "changed";
    out.push({ field: f, label: FIELD_LABELS[f as string], kind, before: b, after: a });
  }
  return out;
}

// Has the draft moved on from a version, as a reader would see it? Every key counts, so unlike
// diffCards it sees the no-editor fields an import can change. Unlike sameSnapshot, a field the
// editor touched and cleared ("" or [] where the version has no key) is not a change.
export function draftMovedOn(version: DesignCard, draft: DesignCard): boolean {
  const keys = Object.keys({ ...version, ...draft }) as (keyof DesignCard)[];
  return keys.some((k) => display(version[k]) !== display(draft[k]));
}

export function summarizeDiff(changes: FieldChange[]): string {
  if (changes.length === 0) return "No field changes.";
  const labels = changes.map((c) => c.label);
  if (labels.length <= 3) return `Changed ${labels.join(", ")}.`;
  return `Changed ${labels.slice(0, 3).join(", ")} +${labels.length - 3} more.`;
}

// Best-effort coercion of a free-text suggestion value into the field's jsonb shape.
export function coerceFieldValue(field: string, text: string): unknown {
  const t = text.trim();
  if (NUMBER_FIELDS.has(field)) return parseStatInput(t); // number, "X", or "6 (0)"
  if (ARRAY_FIELDS.has(field)) return t ? t.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return t;
}
