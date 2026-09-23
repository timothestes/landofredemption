// Reads the file handed to the Lackey source panel: either a full LackeyCCG plugin
// zip (sets/carddata.txt + set images) or a bare carddata.txt for a text-only
// import. Zip entries are catalogued (name + uncompressed size) without being
// decompressed — only carddata.txt is inflated here; images wait for preview/upload.
// CLIENT-SAFE: fflate + the pure Lackey helpers, nothing server-only.

import { unzipSync } from "fflate";
import { distinctSets, parseCarddata, type LackeyRow } from "@/app/forge/lib/lackey";

export interface LackeySource {
  rows: LackeyRow[];
  entryNames: string[];          // every file in the zip; [] for a bare carddata.txt
  sizes: Record<string, number>; // uncompressed bytes per zip entry (batch sizing)
  zipBytes: Uint8Array | null;   // null → no images, cards import text-only
}

const CARDDATA_SUFFIX = "sets/carddata.txt";

export async function readLackeySource(file: File): Promise<LackeySource> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decode = (b: Uint8Array) => new TextDecoder("utf-8").decode(b); // strips a BOM
  // Every zip opens with the "PK" signature; anything else is carddata.txt itself.
  // Decided by content because browsers report .txt/.tsv MIME types inconsistently.
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) {
    return { rows: parseCarddata(decode(bytes)), entryNames: [], sizes: {}, zipBytes: null };
  }

  // Single pass: collect every entry name + size, decompress ONLY carddata.txt.
  const entryNames: string[] = [];
  const sizes: Record<string, number> = {};
  const unzipped = unzipSync(bytes, {
    filter: (f) => {
      if (!f.name.endsWith("/")) { entryNames.push(f.name); sizes[f.name] = f.originalSize; }
      return f.name.toLowerCase().endsWith(CARDDATA_SUFFIX);
    },
  });
  const carddataEntry = Object.keys(unzipped)[0];
  if (!carddataEntry) {
    throw new Error("No sets/carddata.txt found in this zip — is it a Lackey plugin export?");
  }
  return { rows: parseCarddata(decode(unzipped[carddataEntry])), entryNames, sizes, zipBytes: bytes };
}

/** The one set code a file holds, or null when it spans several (or none). Prefers
 *  the OfficialSet spelling ("EoT") over the lowercase Set key ("eot") since the
 *  filter matches either and the code doubles as the new set's default name. Pure. */
export function soleSetCode(rows: LackeyRow[]): string | null {
  const sets = distinctSets(rows);
  if (sets.length !== 1) return null;
  const official = new Set(rows.map((r) => r.officialSet).filter(Boolean));
  return official.size === 1 ? [...official][0] : sets[0].set;
}
