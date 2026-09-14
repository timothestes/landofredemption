// Pure LackeyCCG plugin-format helpers for the Forge set importer.
// CLIENT-SAFE: no server-only imports. Column conventions mirror scripts/parse-carddata.js.

import {
  cardApplicability, cardRawText, deriveAlignmentFromTypes, MULTI_BRIGADES, multiBrigadeSide, parseStatInput,
  type Alignment, type Brigade, type CardType, type DesignCard,
} from "./designCard";

export interface LackeyRow {
  name: string; set: string; imageFile: string; officialSet: string;
  type: string; brigade: string; strength: string; toughness: string;
  class: string; identifier: string; specialAbility: string;
  rarity: string; reference: string; alignment: string; legality: string;
}

const REQUIRED_COLUMNS = ["name", "set", "imagefile"];

export function parseCarddata(text: string): LackeyRow[] {
  const lines = text.split(/\r?\n/);
  const header = (lines[0] ?? "").split("\t").map((h) => h.trim().toLowerCase());
  for (const req of REQUIRED_COLUMNS) {
    if (!header.includes(req)) throw new Error(`carddata.txt is missing the "${req}" column`);
  }
  const col = (name: string) => header.indexOf(name);
  const c = {
    name: col("name"), set: col("set"), imageFile: col("imagefile"),
    officialSet: col("officialset"), type: col("type"), brigade: col("brigade"),
    strength: col("strength"), toughness: col("toughness"), class: col("class"),
    identifier: col("identifier"), specialAbility: col("specialability"),
    rarity: col("rarity"), reference: col("reference"),
    alignment: col("alignment"), legality: col("legality"),
  };
  const rows: LackeyRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split("\t");
    const get = (j: number) => (j >= 0 && j < parts.length ? parts[j].trim() : "");
    const name = get(c.name);
    if (!name) continue; // blank / malformed line
    rows.push({
      name,
      set: get(c.set),
      imageFile: get(c.imageFile).replace(/\.jpe?g$/i, ""),
      officialSet: get(c.officialSet),
      type: get(c.type),
      brigade: get(c.brigade),
      strength: get(c.strength),
      toughness: get(c.toughness),
      class: get(c.class),
      identifier: get(c.identifier),
      specialAbility: get(c.specialAbility),
      rarity: get(c.rarity),
      reference: get(c.reference),
      alignment: get(c.alignment),
      legality: get(c.legality),
    });
  }
  return rows;
}

// Exact (case-insensitive) match on Set or OfficialSet; /…/ is a case-insensitive regex.
export function matchesFilter(row: LackeyRow, filter: string): boolean {
  const f = filter.trim();
  if (!f) return false;
  const slashes = f.match(/^\/(.*)\/$/);
  if (slashes) {
    let re: RegExp;
    try { re = new RegExp(slashes[1], "i"); } catch { return false; }
    return re.test(row.set) || re.test(row.officialSet);
  }
  const lower = f.toLowerCase();
  return row.set.toLowerCase() === lower || row.officialSet.toLowerCase() === lower;
}

export function distinctSets(rows: LackeyRow[]): { set: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.set) continue;
    counts.set(r.set, (counts.get(r.set) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([set, count]) => ({ set, count }))
    .sort((a, b) => b.count - a.count || a.set.localeCompare(b.set));
}

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"];

// Zip entries are prefixed by a variable root folder — match by path suffix.
export function findImageEntry(row: LackeyRow, entryNames: string[]): string | null {
  if (!row.imageFile) return null;
  const wanted = IMAGE_EXTS.map(
    (ext) => `sets/setimages/general/${row.imageFile}${ext}`.toLowerCase(),
  );
  for (const entry of entryNames) {
    const lower = entry.toLowerCase();
    if (wanted.some((w) => lower === w || lower.endsWith(`/${w}`))) return entry;
  }
  return null;
}

// One token may map to multiple design types: a Dual-Alignment Enhancement IS
// both a good and an evil enhancement (the kit has no separate dual frame).
const TYPE_MAP: Record<string, CardType | CardType[]> = {
  "hero": "Hero", "evil character": "EvilCharacter",
  "ge": "GE", "good enhancement": "GE",
  "ee": "EE", "evil enhancement": "EE",
  "dual-alignment enhancement": ["GE", "EE"],
  "dual alignment enhancement": ["GE", "EE"],
  "lost soul": "LostSoul", "artifact": "Artifact",
  "dominant": "Dominant", "evil dominant": "Dominant",
  "fortress": "Fortress", "site": "Site", "city": "City",
  "curse": "Curse", "covenant": "Covenant",
};

const BRIGADE_MAP: Record<string, Brigade> = {
  "blue": "Blue", "clay": "Clay", "good gold": "GoodGold", "green": "Green",
  "purple": "Purple", "red": "Red", "silver": "Silver", "teal": "Teal", "white": "White",
  "black": "Black", "brown": "Brown", "crimson": "Crimson", "evil gold": "EvilGold",
  "gray": "Gray", "orange": "Orange", "pale green": "PaleGreen",
};

// "Gold" alone doesn't say which gold — resolved from the row's alignment, else its
// card types; never guessed when both are silent.
const AMBIGUOUS_BRIGADE_MAP: Record<string, { Good: Brigade; Evil: Brigade }> = {
  gold: { Good: "GoodGold", Evil: "EvilGold" },
};

const LEGALITIES = ["Rotation", "Classic", "Scrolls", "Paragon", "Banned"];

// "Purple (Crimson)" → Purple, Crimson; "Crimson/Orange/Pale Green" → three values.
const MULTI_SEP = /\s*(?:[/,&]|\band\b)\s*/i;   // slash, comma, ampersand, or the word "and"
function splitMulti(value: string): string[] {
  const parens = [...value.matchAll(/\(([^)]+)\)/g)].flatMap((m) => m[1].split(MULTI_SEP));
  const base = value.replace(/\([^)]*\)/g, " ").split(MULTI_SEP);
  return [...base, ...parens].map((s) => s.trim()).filter((s) => s && s !== "-");
}

function clean(v: string): string {
  const t = (v ?? "").trim();
  return t === "-" ? "" : t;
}

// Accepts numbers, "X", and paired dual-side values like "6 (0)" — see parseStatInput.
function parseStat(v: string): number | string | null {
  return parseStatInput(clean(v));
}

const CLASS_TOKENS = new Set(["warrior", "weapon", "territory", "star", "cloud"]);

// Keys are normalizeAlignment output: "Good/Evil", "good & evil", "good-evil", "G/E".
const ALIGNMENT_ALIASES: Record<string, Alignment> = {
  "good": "Good", "evil": "Evil", "neutral": "Neutral",
  "good evil": "Good_Evil", "evil good": "Good_Evil", "good and evil": "Good_Evil",
  "g e": "Good_Evil", "dual": "Good_Evil", "dual alignment": "Good_Evil", "both": "Good_Evil",
};
function normalizeAlignment(v: string): string {
  return clean(v).toLowerCase().replace(/[^a-z]+/g, " ").trim();
}

function rowTypes(row: LackeyRow): CardType[] {
  return [...new Set(splitMulti(row.type).flatMap((t) => TYPE_MAP[t.toLowerCase()] ?? []))] as CardType[];
}
// The Alignment cell when it spells one we know, else what the card types imply (#380).
// An unrecognized spelling yields null — the audit reports it instead of guessing.
function rowAlignment(row: LackeyRow, types: CardType[]): Alignment | null {
  const norm = normalizeAlignment(row.alignment);
  if (norm) return ALIGNMENT_ALIASES[norm] ?? null;
  return deriveAlignmentFromTypes(types);
}
/** Brigade cell -> resolved brigades + one warning per token we couldn't place. The
 *  mapper and the audit both call this, so they can never disagree. Pure. */
function resolveBrigades(row: LackeyRow, types: CardType[], alignment: Alignment | null): {
  brigades: Brigade[]; warnings: string[];
} {
  const side = alignment ?? deriveAlignmentFromTypes(types); // explicit cell wins, then card type
  const brigades: Brigade[] = [];
  const warnings: string[] = [];
  for (const token of splitMulti(row.brigade)) {
    const key = token.toLowerCase().replace(/\s+/g, " ");
    const exact = BRIGADE_MAP[key];
    if (exact) { brigades.push(exact); continue; }
    const pair = AMBIGUOUS_BRIGADE_MAP[key];
    if (pair && (side === "Good" || side === "Evil")) { brigades.push(pair[side]); continue; }
    // "Multi" is every brigade of the card's alignment (stored as that list, no sentinel).
    // A Neutral or dual card doesn't say which set it means, so it is never guessed.
    if (key === "multi" && (side === "Good" || side === "Evil")) { brigades.push(...MULTI_BRIGADES[side]); continue; }
    warnings.push(pair
      ? `ambiguous brigade "${token}" — use Good Gold or Evil Gold`
      : key === "multi"
        ? `brigade "${token}" needs a Good or Evil alignment — list the brigades instead`
        : `unrecognized brigade "${token}"`);
  }
  return { brigades: [...new Set(brigades)], warnings };
}

/** Data-quality audit: one warning per cell value that lackeyRowToDesignCard would
 *  silently drop (unknown type/brigade/class token, non-numeric stat, unknown
 *  alignment or legality). Empty and "-" cells are fine. Pure. */
export function auditLackeyRow(row: LackeyRow): string[] {
  const warnings: string[] = [];
  for (const t of splitMulti(row.type)) {
    if (!TYPE_MAP[t.toLowerCase()]) warnings.push(`unrecognized type "${t}"`);
  }
  const types = rowTypes(row);
  const alignment = rowAlignment(row, types);
  warnings.push(...resolveBrigades(row, types, alignment).warnings);
  if (!clean(row.brigade) && cardApplicability(types).brigades === "required") {
    warnings.push("no brigade — this card type usually has one");
  }
  for (const c of splitMulti(row.class)) {
    if (!CLASS_TOKENS.has(c.toLowerCase())) warnings.push(`unrecognized class "${c}"`);
  }
  for (const [label, v] of [["strength", row.strength], ["toughness", row.toughness]] as const) {
    if (clean(v) && parseStat(v) === null) warnings.push(`non-numeric ${label} "${clean(v)}"`);
  }
  const alignmentCell = normalizeAlignment(row.alignment);
  if (alignmentCell && !ALIGNMENT_ALIASES[alignmentCell]) {
    warnings.push(`unrecognized alignment "${clean(row.alignment)}"`);
  } else if (!alignmentCell && alignment === null && types.length > 0) {
    warnings.push("no alignment — the sheet has none and the card type doesn't imply one");
  }
  const legality = clean(row.legality);
  if (legality && !LEGALITIES.includes(legality)) warnings.push(`unrecognized legality "${legality}"`);
  return warnings;
}

// Best-effort structured mapping; full fidelity lives in the finished-card image + rawText.
export function lackeyRowToDesignCard(row: LackeyRow): DesignCard {
  const card: DesignCard = { name: row.name };

  const rawText = clean(row.specialAbility);
  if (rawText) {
    card.rawText = rawText;        // what the studio textarea edits
    card.specialAbility = rawText; // legacy fallback field, kept in sync for older readers
  }

  const types = rowTypes(row);
  if (types.length) card.cardType = types;
  const alignment = rowAlignment(row, types);
  if (alignment) card.alignment = alignment;
  const { brigades } = resolveBrigades(row, types, alignment);
  if (brigades.length) card.brigades = brigades;

  const strength = parseStat(row.strength);
  if (strength !== null) card.strength = strength;
  const toughness = parseStat(row.toughness);
  if (toughness !== null) card.toughness = toughness;

  for (const part of splitMulti(row.class)) {
    const p = part.toLowerCase();
    if (p === "warrior") card.class = [...(card.class ?? []), "Warrior"];
    else if (p === "weapon") card.class = [...(card.class ?? []), "Weapon"];
    else if (p === "territory") card.icons = [...(card.icons ?? []), "Territory"];
    else if (p === "star") card.icons = [...(card.icons ?? []), "Star"];
    else if (p === "cloud") card.icons = [...(card.icons ?? []), "Cloud"];
  }

  const identifier = clean(row.identifier);
  if (identifier) {
    const ids = identifier.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length) card.identifiers = ids;
  }

  const legality = clean(row.legality);
  if (LEGALITIES.includes(legality)) card.legality = legality as DesignCard["legality"];

  const rarity = clean(row.rarity);
  if (rarity) card.rarity = rarity;
  const reference = clean(row.reference);
  if (reference) card.reference = reference;

  return card;
}

// ---------------------------------------------------------------------------
// Export: the inverse of lackeyRowToDesignCard — DesignCard → carddata.txt row.
// The column order matches the canonical Lackey export so `parseCarddata` (which
// matches columns by header name) round-trips it exactly.
// ---------------------------------------------------------------------------

export const CARDDATA_HEADER = [
  "Name", "Set", "ImageFile", "OfficialSet", "Type", "Brigade",
  "Strength", "Toughness", "Class", "Identifier", "SpecialAbility",
  "Rarity", "Reference", "Sound", "Alignment", "Legality",
] as const;

// Inverse of TYPE_MAP / BRIGADE_MAP — each value lowercases back to a valid key,
// so a serialized row re-imports to the same DesignCard.
const TYPE_TO_LACKEY: Record<CardType, string> = {
  Hero: "Hero", EvilCharacter: "Evil Character", GE: "GE", EE: "EE",
  LostSoul: "Lost Soul", Artifact: "Artifact", Dominant: "Dominant",
  Fortress: "Fortress", Site: "Site", City: "City", Curse: "Curse", Covenant: "Covenant",
};

const BRIGADE_TO_LACKEY: Record<Brigade, string> = {
  Blue: "Blue", Clay: "Clay", GoodGold: "Good Gold", Green: "Green",
  Purple: "Purple", Red: "Red", Silver: "Silver", Teal: "Teal", White: "White",
  Black: "Black", Brown: "Brown", Crimson: "Crimson", EvilGold: "Evil Gold",
  Gray: "Gray", Orange: "Orange", PaleGreen: "Pale Green",
};

const ALIGNMENT_TO_LACKEY: Record<NonNullable<DesignCard["alignment"]>, string> = {
  Good: "Good", Evil: "Evil", Neutral: "Neutral", Good_Evil: "Good/Evil",
};

// Tabs and newlines are the carddata delimiters — never let card text contain them.
function tsvSafe(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

function statCell(v: number | string | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

/** A filesystem/zip-safe image base name for a card title. Column value AND stored
 *  filename use this identical slug, so `findImageEntry` matches on re-import. Pure. */
export function imageFileSlug(title: string): string {
  return title.replace(/[\t\r\n\/\\:*?"<>|]+/g, " ").trim().replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "") || "card";
}

export interface LackeyRowContext { name: string; set: string; officialSet: string; imageFile: string }

/** DesignCard → a carddata.txt row (cells aligned to CARDDATA_HEADER). Pure. */
export function designCardToLackeyRow(card: DesignCard, ctx: LackeyRowContext): string[] {
  const type = (card.cardType ?? []).map((t) => TYPE_TO_LACKEY[t]).filter(Boolean).join("/");
  // Exactly every brigade of the card's own alignment is the catalog's "Multi" (the deck
  // builder expands it back to that set); any other combination is spelled out.
  const brigades = card.brigades ?? [];
  const side = multiBrigadeSide(brigades);
  const brigade = side && side === card.alignment && brigades.length === MULTI_BRIGADES[side].length
    ? "Multi"
    : brigades.map((b) => BRIGADE_TO_LACKEY[b]).filter(Boolean).join("/");
  // The importer folds both Class (Warrior/Weapon) and icons (Territory/Star/Cloud)
  // out of the single Class column, so recombine them here.
  const classCell = [...(card.class ?? []), ...(card.icons ?? [])].join("/");
  const identifier = (card.identifiers ?? []).join(", ");
  const alignment = card.alignment ? ALIGNMENT_TO_LACKEY[card.alignment] : "";

  const cell: Record<(typeof CARDDATA_HEADER)[number], string> = {
    Name: tsvSafe(ctx.name),
    Set: tsvSafe(ctx.set),
    ImageFile: tsvSafe(ctx.imageFile),
    OfficialSet: tsvSafe(ctx.officialSet),
    Type: type,
    Brigade: brigade,
    Strength: statCell(card.strength),
    Toughness: statCell(card.toughness),
    Class: classCell,
    Identifier: tsvSafe(identifier),
    SpecialAbility: tsvSafe(cardRawText(card)),
    Rarity: tsvSafe(card.rarity ?? ""),
    Reference: tsvSafe(card.reference ?? ""),
    Sound: "",
    Alignment: alignment,
    Legality: card.legality ?? "",
  };
  return CARDDATA_HEADER.map((h) => cell[h]);
}

/** Header line + one tab-joined line per row, newline-terminated. Pure. */
export function serializeCarddata(rows: string[][]): string {
  return [CARDDATA_HEADER.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n") + "\n";
}
