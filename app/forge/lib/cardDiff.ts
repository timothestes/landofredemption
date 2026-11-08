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

// Whether two snapshots read the same on a card, for deciding a release has nothing to
// ship. An emptied field counts as no field: typing into a blank field and erasing it
// leaves "" where there was nothing, which nobody can see. Mirrors
// _forge_snapshot_content (migration 127), which is what actually decides; this only
// words the release dialog.
export function sameCardContent(a: DesignCard, b: DesignCard): boolean {
  return sameSnapshot(withoutEmpties(a), withoutEmpties(b));
}

function withoutEmpties(card: DesignCard): DesignCard {
  return Object.fromEntries(
    Object.entries(card).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)),
  );
}

function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  // An undefined key is absent: JSON drops it on the way to the server, so an editor holding
  // `reference: undefined` and a row with no reference are the same snapshot.
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
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

// Word-level diff of a long text field, so a reviewer can see the one word that changed
// instead of comparing two paragraphs by eye. Both sides rebuild exactly: `same` + `del`
// is the old text, `same` + `ins` is the new. Punctuation is its own token, so "2." to "3."
// marks the digit.
export type TextOp = { op: "same" | "del" | "ins"; text: string };

const TEXT_TOKEN = /\s+|[\p{L}\p{N}'’]+|[^\s\p{L}\p{N}]/gu;
// The table is words x words and a snapshot can run to 64 KB. Past this, the changed middle
// is shown as one replacement. Card text with the shared ends trimmed is nowhere near it.
const MAX_DIFF_CELLS = 1_000_000;

export function wordDiff(before: string, after: string): TextOp[] {
  const a = before.match(TEXT_TOKEN) ?? [];
  const b = after.match(TEXT_TOKEN) ?? [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const ops: TextOp[] = [];
  const push = (op: TextOp["op"], text: string) => {
    const last = ops[ops.length - 1];
    if (last?.op === op) last.text += text;
    else if (text) ops.push({ op, text });
  };
  push("same", a.slice(0, start).join(""));

  const n = endA - start;
  const m = endB - start;
  if (n * m > MAX_DIFF_CELLS) {
    push("del", a.slice(start, endA).join(""));
    push("ins", b.slice(start, endB).join(""));
  } else {
    // Longest common subsequence, walked forwards.
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * width + j] = a[start + i] === b[start + j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        push("same", a[start + i]);
        i++;
        j++;
      } else if (i < n && (j === m || lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
        push("del", a[start + i++]);
      } else {
        push("ins", b[start + j++]);
      }
    }
  }
  push("same", a.slice(endA).join(""));
  return joinAcrossSpaces(ops);
}

// A space left unchanged between two replaced words isn't worth showing: "old words" to
// "new text" is one change, not two with a stray match between them.
function joinAcrossSpaces(ops: TextOp[]): TextOp[] {
  const out: TextOp[] = [];
  let del = "";
  let ins = "";
  const flush = () => {
    if (del) out.push({ op: "del", text: del });
    if (ins) out.push({ op: "ins", text: ins });
    del = ins = "";
  };
  ops.forEach((o, k) => {
    if (o.op === "del") del += o.text;
    else if (o.op === "ins") ins += o.text;
    else if (!o.text.trim() && k > 0 && k < ops.length - 1) { del += o.text; ins += o.text; }
    else { flush(); out.push(o); }
  });
  flush();
  return out;
}

// One marked-up paragraph reads well when most of the text survived. Past that, the
// insertions and deletions interleave into something harder to read than two paragraphs.
export function readsAsRedline(ops: TextOp[]): boolean {
  const words = (kept: boolean) =>
    ops
      .filter((o) => (o.op === "same") === kept)
      .reduce((n, o) => n + (o.text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0), 0);
  return words(true) > words(false);
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
