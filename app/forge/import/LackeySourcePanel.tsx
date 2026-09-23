"use client";

// Source panel: a LackeyCCG plugin zip, or a bare carddata.txt for a text-only
// import. Reads in the browser (see readLackeySource), parses carddata.txt, and
// lets the elder pick a set by code or /regex/ — prefilled when the file holds a
// single set. Emits the matched cards to the shared wizard.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  matchesFilter, distinctSets, findImageEntry,
  lackeyRowToDesignCard, auditLackeyRow, type LackeyRow,
} from "@/app/forge/lib/lackey";
import FilePicker from "@/app/forge/components/FilePicker";
import { readLackeySource, soleSetCode } from "./lackeySource";
import type { SourceSelection } from "./selection";

export default function LackeySourcePanel({
  disabled,
  onSelection,
}: {
  disabled: boolean;
  onSelection: (s: SourceSelection | null) => void;
}) {
  const zipBytes = useRef<Uint8Array | null>(null);
  const sizesRef = useRef<Record<string, number>>({});
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [rows, setRows] = useState<LackeyRow[] | null>(null);
  const [entryNames, setEntryNames] = useState<string[]>([]);
  const [textOnly, setTextOnly] = useState(false);
  const [filter, setFilter] = useState("");

  async function onPickFile(file: File) {
    setFileError(null); setRows(null); setFilter("");
    setFileName(file.name);
    try {
      const src = await readLackeySource(file);
      zipBytes.current = src.zipBytes;
      sizesRef.current = src.sizes;
      setEntryNames(src.entryNames);
      setTextOnly(src.zipBytes === null);
      setRows(src.rows);
      // A one-set file (typically a bare carddata.txt) needs no typing to match.
      setFilter(soleSetCode(src.rows) ?? "");
    } catch (e) {
      setFileError(e instanceof Error ? e.message : "Could not read this file.");
    }
  }

  const matched = useMemo(
    () => (rows ?? []).filter((r) => matchesFilter(r, filter)),
    [rows, filter],
  );
  const fileSets = useMemo(() => distinctSets(rows ?? []), [rows]);
  const invalidRegex = useMemo(() => {
    const m = filter.trim().match(/^\/(.*)\/$/);
    if (!m) return false;
    try { new RegExp(m[1], "i"); return false; } catch { return true; }
  }, [filter]);

  const selection = useMemo<SourceSelection | null>(() => {
    if (matched.length === 0) return null;
    return {
      cards: matched.map((r) => ({
        name: r.name,
        snapshot: lackeyRowToDesignCard(r),
        entryName: findImageEntry(r, entryNames),
        warnings: auditLackeyRow(r),
      })),
      zipBytes: zipBytes.current,
      sizes: sizesRef.current,
      defaultSetName: filter && !filter.startsWith("/") ? filter.trim() : "",
      key: `lackey|${fileName}|${filter}`,
    };
  }, [matched, entryNames, fileName, filter]);
  useEffect(() => { onSelection(selection); }, [selection, onSelection]);

  const noImage = selection ? selection.cards.filter((c) => !c.entryName).length : 0;

  return (
    <>
      {/* 2 — file */}
      <fieldset className="mt-4 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">2 · Lackey file</legend>
        <FilePicker label="Choose zip or carddata.txt…"
          accept=".zip,application/zip,.txt,.tsv,text/plain,text/tab-separated-values"
          disabled={disabled} onFile={onPickFile}
          hint="A plugin zip with set images, or just carddata.txt for a text-only import." />
        {fileName && !fileError && rows && (
          <p className="mt-2 text-xs text-muted-foreground">
            {fileName} — {rows.length} cards across {fileSets.length} {fileSets.length === 1 ? "set" : "sets"}.
            {textOnly && " No images — cards import as text only."}
          </p>
        )}
        {fileError && <p className="mt-2 text-xs text-destructive">{fileError}</p>}
      </fieldset>

      {/* 3 — filter */}
      {rows && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">3 · Which set?</legend>
          <input value={filter} onChange={(e) => !disabled && setFilter(e.target.value)} disabled={disabled}
            aria-label="Set filter" placeholder="Set code, e.g. EoT — or /regex/"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50" />
          {invalidRegex && <p className="mt-1 text-xs text-destructive">Invalid regular expression.</p>}
          <p className="mt-2 text-sm">
            {matched.length === 1 ? "1 card matches" : `${matched.length} cards match`}
            {matched.length > 0 && !textOnly && (
              <span className="text-muted-foreground"> · {noImage} without an image</span>
            )}
          </p>
        </fieldset>
      )}
    </>
  );
}
