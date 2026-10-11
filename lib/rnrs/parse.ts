import { LEVELS } from "./config";
import type { Level, PlayerFormatResult } from "./types";

/** Known name typos/variants → canonical name (carried from the prototype). */
const NAME_ALIASES: Record<string, string> = {
  "jayden alstand": "Jayden Alstad (MN)",
};

function resolveAlias(name: string): string {
  const key = name.replace(/\s*\([^)]*\)/, "").trim().toLowerCase();
  return NAME_ALIASES[key] ?? name;
}

/** Parse a single CSV line, honoring double-quoted fields (which contain
 *  the comma-separated win lists, e.g. "10,10,10"). */
function parseLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
    } else if (ch === "," && !inQ) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function parseVals(cell: string): number[] {
  if (!cell || cell === "-") return [];
  return cell
    .split(",")
    .map((v) => parseFloat(v.trim()))
    .filter((v) => !isNaN(v));
}

/**
 * Parse one sheet's CSV text into normalized player rows. The sheet has a
 * header row starting with "Player", then per-level win-list columns, then a
 * "Total" column. Rows that resolve to the same canonical name are merged.
 */
export function parseSheetCsv(text: string): PlayerFormatResult[] {
  const lines = text.trim().split("\n");
  const allRows = lines.map(parseLine);

  const headerIdx = allRows.findIndex(
    (r) => (r[0] ?? "").trim().toLowerCase() === "player",
  );
  if (headerIdx < 0) return [];

  const headers = allRows[headerIdx].map((h) => h.toLowerCase().trim());
  const totalIdx = headers.findIndex((h) => h.includes("total"));
  if (totalIdx < 0) return [];

  // The columns between Player (0) and Total are the level columns, in sheet
  // order. We only keep ones that map to a known level key.
  const levelCols: { idx: number; level: Level }[] = [];
  for (let i = 1; i < totalIdx; i++) {
    const h = headers[i] as Level;
    if (LEVELS.includes(h)) levelCols.push({ idx: i, level: h });
  }

  const merged = new Map<string, PlayerFormatResult>();
  for (let i = headerIdx + 1; i < allRows.length; i++) {
    const row = allRows[i];
    const rawName = (row[0] ?? "").trim();
    const total = parseFloat(row[totalIdx]);
    if (!rawName || rawName === "-" || isNaN(total)) continue;

    const name = resolveAlias(rawName);
    let entry = merged.get(name);
    if (!entry) {
      entry = {
        name,
        wins: {
          local: [],
          district: [],
          seasonal: [],
          state: [],
          regional: [],
          national: [],
        },
        sheetTotal: 0,
      };
      merged.set(name, entry);
    }
    for (const { idx, level } of levelCols) {
      entry.wins[level].push(...parseVals(row[idx] ?? ""));
    }
    entry.sheetTotal += total;
  }

  return [...merged.values()];
}
