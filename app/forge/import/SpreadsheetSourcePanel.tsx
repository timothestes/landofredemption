"use client";

// Source panel: a zip of card images + a .csv/.xlsx of card metadata. Both parse in
// the browser (fflate — an xlsx is itself a zip of XML). Because column layouts vary
// between designers' sheets, the mapping is auto-detected but reviewable: every card
// field can be re-pointed at a different column, and cleaning results (skipped rows,
// duplicates, values that won't import) are spelled out before anything uploads.

import { useEffect, useMemo, useRef, useState } from "react";
import { unzipSync } from "fflate";
import {
  parseCsv, parseXlsx, detectColumns, tableToCards, findLooseImageEntry, isImageEntry,
  imageFileStem, imageEntryStem,
  MAPPABLE_FIELDS, type ColumnMapping, type MappableField, type SheetTable,
} from "@/app/forge/lib/spreadsheet";
import FilePicker from "@/app/forge/components/FilePicker";
import type { SourceSelection } from "./selection";

const FIELD_LABELS: Record<MappableField, string> = {
  name: "Name", image: "Image file", type: "Type", brigade: "Brigade",
  strength: "Strength", toughness: "Toughness", class: "Class",
  identifier: "Identifiers", specialAbility: "Special ability", rarity: "Rarity",
  reference: "Reference", book: "Book", chapter: "Chapter", verse: "Verse",
  alignment: "Alignment", legality: "Legality", artist: "Artist",
};

interface ImagesZip {
  name: string;
  entryNames: string[];
  sizes: Record<string, number>;
  imageCount: number;
  oversized: number; // images skipped for exceeding the server's per-file cap
}

// Independent of MAX_ART_BYTES in app/forge/lib/art.ts (server-only module — can't import
// here); that cap moved to 50MB for Forge's own client-upload flow, but this bulk importer
// keeps its own conservative 15MB gate.
// Bigger entries would fail server validation after a wasted multi-MB upload, so they
// are excluded up front and surfaced as a count.
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export default function SpreadsheetSourcePanel({
  disabled,
  onSelection,
}: {
  disabled: boolean;
  onSelection: (s: SourceSelection | null) => void;
}) {
  const zipBytes = useRef<Uint8Array | null>(null);
  const [zip, setZip] = useState<ImagesZip | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const [zipBusy, setZipBusy] = useState(false);
  const [meta, setMeta] = useState<{ name: string; sheets: SheetTable[] } | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaBusy, setMetaBusy] = useState(false);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [override, setOverride] = useState<ColumnMapping | null>(null);
  // Bumped on every file pick so re-uploading a fixed file with the SAME name still
  // yields a new selection key — otherwise a finished run's results would never reset.
  const [pickNonce, setPickNonce] = useState(0);
  // Set when the zip↔sheet affinity check switches sheets on the user's behalf.
  const [autoNote, setAutoNote] = useState<string | null>(null);

  async function onPickImagesZip(file: File) {
    setZipError(null);
    setAutoNote(null);
    setZipBusy(true); // images zips run to hundreds of MB — reading takes visible seconds
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Names + sizes only — nothing is decompressed until preview/upload.
      const names: string[] = [];
      const sizes: Record<string, number> = {};
      let oversized = 0;
      unzipSync(bytes, {
        filter: (f) => {
          if (f.name.endsWith("/")) return false;
          if (isImageEntry(f.name) && f.originalSize > MAX_IMAGE_BYTES) { oversized++; return false; }
          names.push(f.name);
          sizes[f.name] = f.originalSize;
          return false;
        },
      });
      const imageCount = names.filter(isImageEntry).length;
      if (imageCount === 0) {
        setZipError("No images (.jpg/.png/.webp/.tif/.tiff) found in this zip.");
        zipBytes.current = null;
        setZip(null);
        return;
      }
      zipBytes.current = bytes;
      setZip({ name: file.name, entryNames: names, sizes, imageCount, oversized });
      setPickNonce((n) => n + 1);
    } catch (e) {
      zipBytes.current = null;
      setZip(null);
      setZipError(e instanceof Error ? e.message : "Could not read this zip file.");
    } finally {
      setZipBusy(false);
    }
  }

  async function onPickMeta(file: File) {
    setMetaError(null); setOverride(null); setAutoNote(null);
    setMetaBusy(true);
    try {
      let sheets: SheetTable[];
      if (file.name.toLowerCase().endsWith(".csv")) {
        sheets = [{ name: file.name.replace(/\.csv$/i, ""), rows: parseCsv(await file.text()) }];
      } else {
        sheets = parseXlsx(new Uint8Array(await file.arrayBuffer()));
      }
      const firstWithData = sheets.findIndex((s) => s.rows.length > 1);
      if (firstWithData === -1) {
        setMeta(null);
        setMetaError("No data rows found — is the first row a header and the rest cards?");
        return;
      }
      setMeta({ name: file.name, sheets });
      setSheetIdx(firstWithData);
      setPickNonce((n) => n + 1);
    } catch (e) {
      setMeta(null);
      setMetaError(e instanceof Error ? e.message : "Could not read this file.");
    } finally {
      setMetaBusy(false);
    }
  }

  const sheet = meta?.sheets[sheetIdx] ?? null;
  const header = useMemo(() => sheet?.rows[0] ?? [], [sheet]);
  const detected = useMemo(() => detectColumns(header), [header]);
  const mapping = override ?? detected.mapping;
  const table = useMemo(
    () => (sheet ? tableToCards(sheet.rows, mapping) : null),
    [sheet, mapping],
  );

  // zip ↔ sheet affinity: how many of each sheet's Image values exist in the zip.
  // A multi-set workbook + a one-set images zip is the normal case (EoT + Roots 2),
  // and the wrong sheet renders an all-"No image" preview that reads as broken.
  const sheetMatchCounts = useMemo(() => {
    if (!meta || !zip) return null;
    const stems = new Set(zip.entryNames.map(imageEntryStem).filter(Boolean) as string[]);
    return meta.sheets.map((s) => {
      const imgIdx = detectColumns(s.rows[0] ?? []).mapping.image;
      if (imgIdx === undefined) return 0;
      let count = 0;
      for (let i = 1; i < s.rows.length; i++) {
        const stem = imageFileStem(s.rows[i]?.[imgIdx] ?? "");
        if (stem && stems.has(stem)) count++;
      }
      return count;
    });
  }, [meta, zip]);
  const bestSheetIdx = useMemo(() => {
    if (!sheetMatchCounts) return -1;
    return sheetMatchCounts.reduce((best, c, i) => (c > (sheetMatchCounts[best] ?? 0) ? i : best), 0);
  }, [sheetMatchCounts]);

  // When a freshly-picked file pairing leaves the CURRENT sheet with zero image
  // matches but another sheet matches, switch to it once and say so.
  const affinityHandled = useRef<{ zip: ImagesZip | null; meta: unknown } | null>(null);
  useEffect(() => {
    if (!zip || !meta || !sheetMatchCounts) return;
    const h = affinityHandled.current;
    if (h && h.zip === zip && h.meta === meta) return;
    affinityHandled.current = { zip, meta };
    if ((sheetMatchCounts[sheetIdx] ?? 0) > 0) return;
    if (bestSheetIdx !== sheetIdx && (sheetMatchCounts[bestSheetIdx] ?? 0) > 0) {
      setSheetIdx(bestSheetIdx);
      setOverride(null);
      setAutoNote(`Switched to the “${meta.sheets[bestSheetIdx].name}” sheet — its Image column matches this zip.`);
    }
  }, [zip, meta, sheetMatchCounts, sheetIdx, bestSheetIdx]);

  const selection = useMemo<SourceSelection | null>(() => {
    if (!meta || !sheet || !table || table.cards.length === 0 || mapping.name === undefined) return null;
    return {
      cards: table.cards.map((c) => ({
        name: c.name,
        snapshot: c.snapshot,
        derived: c.derived,
        entryName: zip ? findLooseImageEntry(c.imageFile, zip.entryNames) : null,
        warnings: c.warnings,
      })),
      zipBytes: zipBytes.current,
      sizes: zip?.sizes ?? {},
      defaultSetName: sheet.name,
      key: `sheet|${pickNonce}|${zip?.name ?? ""}|${meta.name}|${sheetIdx}|${JSON.stringify(mapping)}`,
    };
  }, [meta, sheet, table, mapping, zip, sheetIdx, pickNonce]);
  useEffect(() => { onSelection(selection); }, [selection, onSelection]);

  const withImage = selection ? selection.cards.filter((c) => c.entryName).length : 0;
  const orphanImages = useMemo(() => {
    if (!zip || !selection) return 0;
    const used = new Set(selection.cards.map((c) => c.entryName));
    return zip.entryNames.filter((n) => isImageEntry(n) && !used.has(n)).length;
  }, [zip, selection]);
  const warned = (table?.cards ?? []).filter((c) => c.warnings.length > 0);
  const ignoredHeaders = detected.ignored.map((i) => header[i]).filter((h) => h?.trim());

  // Mis-mapping tripwires — a wrong-but-complete auto-detection produces a plausible
  // preview and a "successful" import, so make the suspicious cases loud instead.
  const nameLooksWrong = useMemo(() => {
    const names = (table?.cards ?? []).map((c) => c.name);
    if (names.length < 3) return false;
    const avg = names.reduce((s, n) => s + n.length, 0) / names.length;
    const sentencey = names.filter((n) => n.length > 60 || /\. /.test(n)).length;
    return avg > 40 || sentencey / names.length > 0.2;
  }, [table]);
  const doubledColumns = useMemo(() => {
    const byCol = new Map<number, string[]>();
    for (const f of MAPPABLE_FIELDS) {
      const idx = mapping[f];
      if (idx !== undefined) byCol.set(idx, [...(byCol.get(idx) ?? []), FIELD_LABELS[f]]);
    }
    return [...byCol.values()].filter((fields) => fields.length > 1);
  }, [mapping]);
  // A sheet that never mapped Alignment or Brigade imports cards that look complete but lost both (#386).
  const hasDataRows = (sheet?.rows.length ?? 0) > 1;
  const unmappedFields = useMemo(
    () => (hasDataRows ? (["alignment", "brigade"] as const).filter((f) => mapping[f] === undefined) : []),
    [hasDataRows, mapping],
  );
  const mappingSuspicious = mapping.name === undefined || nameLooksWrong
    || doubledColumns.length > 0 || detected.duplicates.length > 0 || unmappedFields.length > 0;

  function remap(field: MappableField, value: string) {
    const next: ColumnMapping = { ...mapping };
    if (value === "") delete next[field];
    else next[field] = Number(value);
    setOverride(next);
  }

  return (
    <>
      {/* 2 — files */}
      <fieldset className="mt-4 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">2 · Files</legend>
        <div className="space-y-3">
          <div>
            <FilePicker label="Choose spreadsheet…" accept=".csv,.xlsx" disabled={disabled || metaBusy} onFile={onPickMeta}
              hint="Card text as .csv or .xlsx — first row must be the column headers." />
            {metaBusy && <p className="mt-1 text-xs text-muted-foreground">Reading spreadsheet…</p>}
            {meta && !metaError && (
              <p className="mt-1 text-xs text-muted-foreground">
                {meta.name}
                {meta.sheets.length > 1 && ` — ${meta.sheets.length} sheets`}
              </p>
            )}
            {metaError && <p className="mt-1 text-xs text-destructive">{metaError}</p>}
          </div>
          <div>
            <FilePicker label="Choose images zip…" accept=".zip,application/zip" disabled={disabled || zipBusy} onFile={onPickImagesZip}
              hint="Optional — a zip of finished card images, named like the sheet's Image column." />
            {zipBusy && <p className="mt-1 text-xs text-muted-foreground">Reading zip…</p>}
            {zip && !zipError && (
              <p className="mt-1 text-xs text-muted-foreground">
                {zip.name} — {zip.imageCount} images.
                {zip.oversized > 0 && ` ${zip.oversized} ignored (over 15MB).`}
              </p>
            )}
            {zipError && <p className="mt-1 text-xs text-destructive">{zipError}</p>}
          </div>
        </div>
      </fieldset>

      {/* 3 — columns + cleaning */}
      {meta && sheet && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">3 · Columns &amp; cleaning</legend>

          {meta.sheets.length > 1 && (
            <label className="mb-3 flex items-center gap-2 text-sm">
              Sheet
              <select value={sheetIdx} disabled={disabled}
                onChange={(e) => { setSheetIdx(Number(e.target.value)); setOverride(null); setAutoNote(null); }}
                aria-label="Sheet" className="rounded-md border bg-background px-2 py-1 text-sm">
                {meta.sheets.map((s, i) => (
                  <option key={i} value={i}>{s.name} ({Math.max(0, s.rows.length - 1)} rows)</option>
                ))}
              </select>
            </label>
          )}
          {autoNote && <p className="mb-2 text-xs text-muted-foreground">{autoNote}</p>}
          {sheetMatchCounts && meta.sheets.length > 1 && bestSheetIdx !== sheetIdx
            && (sheetMatchCounts[sheetIdx] ?? 0) === 0 && (sheetMatchCounts[bestSheetIdx] ?? 0) > 0 && (
            <p className="mb-2 text-xs text-amber-600 dark:text-amber-500">
              None of the zip’s images match this sheet — they match the
              “{meta.sheets[bestSheetIdx].name}” sheet ({sheetMatchCounts[bestSheetIdx]} cards).
            </p>
          )}

          {mapping.name === undefined && (
            <p className="mb-2 text-sm text-destructive">
              No “Name” column found — pick which column holds the card name below.
            </p>
          )}
          {nameLooksWrong && (
            <p className="mb-2 text-xs text-amber-600 dark:text-amber-500">
              The card names look like sentence text — the Name column may be mapped to the
              wrong column. Check the mapping below.
            </p>
          )}
          {doubledColumns.map((fields) => (
            <p key={fields.join()} className="mb-2 text-xs text-amber-600 dark:text-amber-500">
              {fields.join(" and ")} are reading the same column.
            </p>
          ))}
          {unmappedFields.length > 0 && (
            <p className="mb-2 text-xs text-amber-600 dark:text-amber-500">
              {`No ${unmappedFields.map((f) => `“${FIELD_LABELS[f]}”`).join(" or ")} column found — every `
                + `card imports without it. Alignment is guessed from the card type where it can be; brigade `
                + `can't be. Point the mapping below at the right column if the sheet has one.`}
            </p>
          )}
          {!override && detected.duplicates.map(({ field, index }) => (
            <p key={`${field}-${index}`} className="mb-2 text-xs text-amber-600 dark:text-amber-500">
              {`Two columns look like ${FIELD_LABELS[field]} — reading `
                + `“${(header[mapping[field]] ?? "").trim()}” and ignoring “${(header[index] ?? "").trim()}”.`}
            </p>
          ))}
          {ignoredHeaders.length > 0 && (
            <p className="mb-2 text-xs text-muted-foreground">
              Not imported: {ignoredHeaders.map((h) => `“${h}”`).join(", ")} — adjust the mapping below if one of these should be.
            </p>
          )}

          <details open={mappingSuspicious}>
            <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
              Column mapping {override ? "(edited)" : "(auto-detected)"}
              {mapping.name !== undefined && (
                <> — Name ← “{(header[mapping.name] ?? "").trim()}”
                {mapping.image !== undefined && <>, Image ← “{(header[mapping.image] ?? "").trim()}”</>}</>
              )}
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {MAPPABLE_FIELDS.map((f) => (
                <label key={f} className="text-xs">
                  <span className="mb-0.5 block text-muted-foreground">
                    {FIELD_LABELS[f]}{f === "name" && " (required)"}
                  </span>
                  <select value={mapping[f] ?? ""} disabled={disabled} onChange={(e) => remap(f, e.target.value)}
                    aria-label={`Column for ${FIELD_LABELS[f]}`}
                    className="w-full rounded-md border bg-background px-1.5 py-1 text-xs">
                    <option value="">—</option>
                    {header.map((h, i) => (h.trim() ? <option key={i} value={i}>{h.trim()}</option> : null))}
                  </select>
                </label>
              ))}
            </div>
            {override && (
              <button type="button" className="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
                onClick={() => setOverride(null)} disabled={disabled}>
                Reset to auto-detected
              </button>
            )}
          </details>

          {table && mapping.name !== undefined && (
            <div className="mt-3 space-y-1 text-sm">
              <p>
                {table.cards.length === 1 ? "1 card" : `${table.cards.length} cards`}
                {zip
                  ? <span className="text-muted-foreground"> · {table.cards.length - withImage} without an image</span>
                  : <span className="text-muted-foreground"> · no images zip — cards import as text only</span>}
                {table.skipped > 0 && <span className="text-muted-foreground"> · {table.skipped} rows skipped (no name)</span>}
                {orphanImages > 0 && <span className="text-muted-foreground"> · {orphanImages} zip images match no row</span>}
              </p>
              {table.duplicates.length > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  {table.duplicates.length} duplicate {table.duplicates.length === 1 ? "name" : "names"} ignored
                  (first row wins): {[...new Set(table.duplicates)].slice(0, 5).join(", ")}
                  {table.duplicates.length > 5 && "…"}
                </p>
              )}
              {warned.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-amber-600 dark:text-amber-500">
                    {warned.length} {warned.length === 1 ? "card has" : "cards have"} values that won’t import as structured fields
                  </summary>
                  <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-muted-foreground">
                    {warned.map((c) => (
                      <li key={c.rowIndex}>Row {c.rowIndex} · {c.name}: {c.warnings.join("; ")}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-muted-foreground">
                    These cards still import — their ability text and image are kept; only the flagged
                    fields are left blank to fix in the studio.
                  </p>
                </details>
              )}
            </div>
          )}
        </fieldset>
      )}
    </>
  );
}
