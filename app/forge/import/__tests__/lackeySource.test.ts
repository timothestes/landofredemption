import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { readLackeySource, soleSetCode } from "@/app/forge/import/lackeySource";
import { parseCarddata } from "@/app/forge/lib/lackey";

const HEADER =
  "Name\tSet\tImageFile\tOfficialSet\tType\tBrigade\tStrength\tToughness\tClass\tIdentifier\tSpecialAbility\tRarity\tReference\tSound\tAlignment\tLegality";
function row(name: string, set = "eot", officialSet = "EoT"): string {
  return [name, set, name.replace(/\s+/g, "-"), officialSet, "Dominant", "", "", "", "", "",
    "You may take a good Genesis or Revelation card.", "", "Revelation 22:13", "", "Good", "Rotation"].join("\t");
}
const TSV = [HEADER, row("Alpha and Omega"), row("Armageddon")].join("\n");
const IMAGE = "RedemptionPlugin/sets/setimages/general/Alpha-and-Omega.jpg";

describe("readLackeySource", () => {
  it("reads a bare carddata.txt as text-only rows", async () => {
    const src = await readLackeySource(new File([TSV], "carddata.txt", { type: "text/plain" }));
    expect(src.rows.map((r) => r.name)).toEqual(["Alpha and Omega", "Armageddon"]);
    expect(src.zipBytes).toBeNull();
    expect(src.entryNames).toEqual([]);
    expect(src.sizes).toEqual({});
  });

  it("decides zip vs text by content, not by name or MIME type", async () => {
    // Browsers report .txt/.tsv MIME types inconsistently ("" or octet-stream).
    const src = await readLackeySource(new File([TSV], "eot.tsv", { type: "application/octet-stream" }));
    expect(src.rows).toHaveLength(2);
    expect(src.zipBytes).toBeNull();
  });

  it("strips a UTF-8 BOM from a text file", async () => {
    const src = await readLackeySource(new File(["﻿" + TSV], "carddata.txt"));
    expect(src.rows).toHaveLength(2);
  });

  it("reads a plugin zip: rows from sets/carddata.txt plus every entry name and size", async () => {
    const zip = zipSync({
      "RedemptionPlugin/sets/carddata.txt": strToU8(TSV),
      [IMAGE]: new Uint8Array([1, 2, 3, 4, 5]),
    });
    const src = await readLackeySource(new File([zip], "plugin.zip", { type: "application/zip" }));
    expect(src.rows).toHaveLength(2);
    expect(src.zipBytes).toBeInstanceOf(Uint8Array);
    expect(src.entryNames).toEqual(expect.arrayContaining(["RedemptionPlugin/sets/carddata.txt", IMAGE]));
    expect(src.sizes[IMAGE]).toBe(5);
  });

  it("rejects a zip with no sets/carddata.txt", async () => {
    const zip = zipSync({ "readme.txt": strToU8("hi") });
    await expect(readLackeySource(new File([zip], "other.zip"))).rejects.toThrow(/sets\/carddata\.txt/);
  });

  it("rejects a text file without the carddata header", async () => {
    await expect(readLackeySource(new File(["hello\tworld\nfoo\tbar\n"], "notes.txt"))).rejects.toThrow(/missing/i);
  });
});

describe("soleSetCode", () => {
  it("returns the OfficialSet code when every row belongs to one set", () => {
    expect(soleSetCode(parseCarddata(TSV))).toBe("EoT");
  });
  it("falls back to the Set column when OfficialSet is blank", () => {
    expect(soleSetCode(parseCarddata([HEADER, row("A", "eot", ""), row("B", "eot", "")].join("\n")))).toBe("eot");
  });
  it("returns null for a multi-set file or no rows", () => {
    expect(soleSetCode(parseCarddata([HEADER, row("A", "eot", "EoT"), row("B", "rr2", "RR2")].join("\n")))).toBeNull();
    expect(soleSetCode([])).toBeNull();
  });
});
