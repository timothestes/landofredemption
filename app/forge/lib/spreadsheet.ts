// Pure CSV/XLSX helpers for the Forge images-zip + spreadsheet importer.
// CLIENT-SAFE: no server-only imports. An .xlsx file is a zip of OOXML XML parts,
// so parsing rides on fflate (already used for the images zip) — no new dependency.
// The OOXML subset handled here is what Excel, Google Sheets, and LibreOffice
// actually emit for plain tables: sharedStrings (with rich-text runs), inline
// strings, formula string results, numbers, and sparse rows/cells.

import { unzipSync } from "fflate";
import { auditLackeyRow, lackeyRowToDesignCard, type LackeyRow } from "./lackey";
import type { DesignCard } from "./designCard";

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC-4180-style CSV → rows of cells. Handles quoted fields (commas, newlines,
 *  doubled quotes), CRLF, and a UTF-8 BOM. Blank trailing lines are dropped;
 *  blank lines elsewhere stay (so row numbers keep matching the user's file). Pure. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = ""; rows.push(row); row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === "") rows.pop(); // trailing blank line(s)
    else break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

export interface SheetTable { name: string; rows: string[][] }

const NOT_XLSX = "This file doesn't look like an .xlsx workbook.";

function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? unescapeXml(m[1] ?? m[2]) : null;
}

// All <t> text inside a fragment, rich-text runs joined; phonetic <rPh> runs dropped.
function textOf(fragment: string): string {
  const clean = fragment.replace(/<rPh[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += unescapeXml(m[1]);
  return out;
}

// "B3" → 0-based column index 1.
function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    if (ch < "A" || ch > "Z") break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function parseSheetXml(xml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  let cursor = 0; // fallback position for rows without an r attribute
  // Self-closing <row/> (styled-but-empty rows from Excel) must consume its own
  // match, or the following row's cells would land one row early.
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = attr(rowMatch[1], "r");
    const rowIdx = rAttr ? Number(rAttr) - 1 : cursor;
    cursor = rowIdx + 1;
    const cells: string[] = [];
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cellMatch[1], "r");
      const col = ref ? colIndex(ref) : cells.length;
      const t = attr(cellMatch[1], "t");
      const inner = cellMatch[2] ?? "";
      const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = "";
      if (t === "s") value = strings[Number(v)] ?? "";
      else if (t === "inlineStr") value = textOf(inner);
      else if (t === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (t === "e") value = ""; // cell error (#N/A etc.) → treat as empty
      else value = v === undefined ? "" : unescapeXml(v); // number or t="str"
      if (col >= 0) cells[col] = value;
    }
    rows[rowIdx] = cells;
  }
  // Normalize holes: missing rows → [], missing cells → "".
  return Array.from(rows, (r) => (r ? Array.from(r, (c) => c ?? "") : []));
}

/** Parse an .xlsx workbook into its sheets (workbook order, with names).
 *  Throws with a user-facing message when the bytes aren't an xlsx. Pure. */
export function parseXlsx(bytes: Uint8Array): SheetTable[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (f) =>
        f.name === "xl/workbook.xml" ||
        f.name === "xl/_rels/workbook.xml.rels" ||
        f.name === "xl/sharedStrings.xml" ||
        /^xl\/worksheets\/[^/]+\.xml$/.test(f.name),
    });
  } catch {
    throw new Error(NOT_XLSX);
  }
  const decode = (b: Uint8Array) => new TextDecoder("utf-8").decode(b);
  if (!entries["xl/workbook.xml"] || !entries["xl/_rels/workbook.xml.rels"]) {
    throw new Error(NOT_XLSX);
  }

  const strings = entries["xl/sharedStrings.xml"]
    ? [...decode(entries["xl/sharedStrings.xml"]).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)]
        .map((m) => textOf(m[1]))
    : [];

  const relTargets = new Map<string, string>();
  for (const rel of decode(entries["xl/_rels/workbook.xml.rels"]).matchAll(/<Relationship\s[^>]*\/?>/g)) {
    const id = attr(rel[0], "Id");
    const target = attr(rel[0], "Target");
    if (id && target) relTargets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }

  const sheets: SheetTable[] = [];
  for (const sheet of decode(entries["xl/workbook.xml"]).matchAll(/<sheet\s[^>]*\/?>/g)) {
    const name = attr(sheet[0], "name") ?? `Sheet ${sheets.length + 1}`;
    const rid = attr(sheet[0], "r:id");
    const part = rid ? relTargets.get(rid) : undefined;
    const xml = part ? entries[part] : undefined;
    if (!xml) continue;
    sheets.push({ name, rows: parseSheetXml(decode(xml), strings) });
  }
  if (sheets.length === 0) throw new Error(NOT_XLSX);
  return sheets;
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

export const MAPPABLE_FIELDS = [
  "name", "image", "type", "brigade", "strength", "toughness", "class",
  "identifier", "specialAbility", "rarity", "reference", "book", "chapter",
  "verse", "scripture", "alignment", "legality", "artist",
] as const;
export type MappableField = (typeof MAPPABLE_FIELDS)[number];
export type ColumnMapping = Partial<Record<MappableField, number>>;

const HEADER_ALIASES: Record<string, MappableField> = {
  name: "name", cardname: "name", title: "name",
  image: "image", imagefile: "image", imagename: "image",
  type: "type", cardtype: "type",
  brigade: "brigade", brigades: "brigade",
  strength: "strength", toughness: "toughness",
  class: "class",
  identifier: "identifier", identifiers: "identifier",
  specialability: "specialAbility", ability: "specialAbility", abilitytext: "specialAbility",
  rarity: "rarity",
  reference: "reference", scripturereference: "reference",
  book: "book", chapter: "chapter", verse: "verse",
  scripture: "scripture", scripturetext: "scripture", versetext: "scripture",
  alignment: "alignment", legality: "legality",
  artist: "artist", artistcredit: "artist",
  brigadecolor: "brigade", brigadecolour: "brigade",
  color: "brigade", colors: "brigade", colour: "brigade", colours: "brigade",
  align: "alignment", side: "alignment", goodevil: "alignment", alignmentgoodevil: "alignment",
};

// Columns we recognize but deliberately don't import — not surprises worth flagging.
const KNOWN_UNUSED = new Set(["#", "number", "set", "officialset", "sound"]);

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9#]/g, "");
}

// Last resort before a header is called unrecognized: the two fields sheets spell most
// creatively (#386).
function fuzzyField(norm: string): MappableField | undefined {
  if (norm.includes("brigade")) return "brigade";
  if (norm.includes("align")) return "alignment";
  return undefined;
}

/** Auto-detect which spreadsheet column feeds which card field. Both real-world
 *  conventions are handled: Lackey-style headers with trailing colons and a combined
 *  Reference, or split Book/Chapter/Verse plus Artist. `ignored` lists the indexes
 *  of non-empty headers we didn't recognize; `duplicates` lists a field's SECOND
 *  matching column (the first one wins the mapping), for the wizard to surface. Pure. */
export function detectColumns(header: string[]): {
  mapping: ColumnMapping; ignored: number[]; duplicates: { field: MappableField; index: number }[];
} {
  const mapping: ColumnMapping = {};
  const ignored: number[] = [];
  const duplicates: { field: MappableField; index: number }[] = [];
  header.forEach((h, i) => {
    if (!h.trim()) return;
    const norm = normalizeHeader(h);
    if (KNOWN_UNUSED.has(norm)) return;
    const field = HEADER_ALIASES[norm] ?? fuzzyField(norm);
    if (field === undefined) { ignored.push(i); return; }
    if (mapping[field] === undefined) mapping[field] = i;
    else duplicates.push({ field, index: i }); // second column of a field: dropped, but said out loud
  });
  return { mapping, ignored, duplicates };
}

/** The wizard's line about columns nothing reads. These are just names no field goes by, and
 *  many have no field at all (designer notes), so it says what a sheet can fill rather than
 *  suggesting a target exists. Pure. */
export function notImportedNote(headers: string[]): string {
  return `Not imported: ${headers.map((h) => `“${h}”`).join(", ")}. `
    + `No card field goes by ${headers.length === 1 ? "that name" : "those names"}. `
    + `Column mapping below lists every field a sheet can fill.`;
}

// ---------------------------------------------------------------------------
// Rows → cards
// ---------------------------------------------------------------------------

export interface SpreadsheetCard {
  name: string;
  imageFile: string;   // cleaned Image column value ("" when absent)
  snapshot: DesignCard;
  warnings: string[];  // per-card data-quality warnings (values that were dropped)
  rowIndex: number;    // 1-based row in the user's file (header = row 1)
}

// "-" (and en/em dash) placeholder cells → empty; everything else just trimmed.
function cleanCell(v: string): string {
  const t = (v ?? "").trim();
  return /^[-–—]+$/.test(t) ? "" : t;
}

// xlsx numeric cells arrive as "19.0" — strip a zero fraction so references and
// stats read like the user's sheet. Non-numeric values pass through untouched.
function numClean(v: string): string {
  const m = /^(-?\d+)\.0+$/.exec(v);
  return m ? m[1] : v;
}

/** Map spreadsheet rows (first row = header) through the column mapping into
 *  importable cards. Cleaning: blank rows vanish, rows without a Name are counted
 *  as skipped, repeated names keep the first occurrence (later ones reported in
 *  `duplicates`), placeholder dashes empty out, and every value the structured
 *  mapping would silently drop becomes a per-card warning. Pure. */
export function tableToCards(rows: string[][], mapping: ColumnMapping): {
  cards: SpreadsheetCard[]; skipped: number; duplicates: string[];
} {
  const cards: SpreadsheetCard[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  const duplicates: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (row.every((c) => !cleanCell(c))) continue; // blank spacer row
    const get = (f: MappableField) => {
      const idx = mapping[f];
      return idx === undefined ? "" : cleanCell(row[idx] ?? "");
    };
    const name = get("name");
    if (!name) { skipped++; continue; }
    if (seen.has(name.toLowerCase())) { duplicates.push(name); continue; }
    seen.add(name.toLowerCase());

    let reference = get("reference");
    if (!reference) {
      const book = get("book");
      const chapter = numClean(get("chapter"));
      const verse = numClean(get("verse"));
      if (book) reference = book + (chapter ? ` ${chapter}${verse ? `:${verse}` : ""}` : "");
    }

    const lackeyRow: LackeyRow = {
      name, set: "", imageFile: "", officialSet: "",
      type: get("type"), brigade: get("brigade"),
      strength: numClean(get("strength")), toughness: numClean(get("toughness")),
      class: get("class"), identifier: get("identifier"),
      specialAbility: get("specialAbility"), rarity: get("rarity"),
      reference, alignment: get("alignment"), legality: get("legality"),
    };
    const snapshot = lackeyRowToDesignCard(lackeyRow);
    const artist = get("artist");
    if (artist) snapshot.artistCredit = artist;
    const scripture = get("scripture");
    if (scripture) snapshot.scripture = scripture;

    cards.push({
      name, imageFile: get("image"), snapshot,
      warnings: auditLackeyRow(lackeyRow), rowIndex: i + 1,
    });
  }
  return { cards, skipped, duplicates };
}

// ---------------------------------------------------------------------------
// Images zip matching
// ---------------------------------------------------------------------------

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|tiff?)$/i;

/** True for zip entries that are usable card images — not directories, macOS junk
 *  (__MACOSX/ trees, "._" AppleDouble files), or non-image files. Pure. */
export function isImageEntry(entryName: string): boolean {
  if (entryName.endsWith("/") || entryName.includes("__MACOSX/")) return false;
  const base = (entryName.split("/").pop() ?? "").toLowerCase();
  return !base.startsWith("._") && IMAGE_EXT_RE.test(base);
}

/** Canonical form of an Image column value for matching: lowercased, trimmed,
 *  extension stripped ("" when blank). Pure. */
export function imageFileStem(value: string): string {
  return value.trim().toLowerCase().replace(IMAGE_EXT_RE, "");
}

/** Canonical form of a zip entry for matching: lowercased base name without the
 *  extension — or null for directories, macOS junk, and non-images. Pure. */
export function imageEntryStem(entryName: string): string | null {
  if (!isImageEntry(entryName)) return null;
  return (entryName.split("/").pop() ?? "").toLowerCase().replace(IMAGE_EXT_RE, "");
}

/** Match a spreadsheet Image value to a zip entry by BASE NAME at any depth —
 *  images zips are flat folder exports, not Lackey trees. Case-insensitive and
 *  tolerates the column already carrying an extension. Pure. */
export function findLooseImageEntry(imageFile: string, entryNames: string[]): string | null {
  const stem = imageFileStem(imageFile);
  if (!stem) return null;
  for (const entry of entryNames) {
    if (imageEntryStem(entry) === stem) return entry;
  }
  return null;
}
