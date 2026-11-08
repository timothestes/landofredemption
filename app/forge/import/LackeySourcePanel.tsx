"use client";

// Source panel: a LackeyCCG plugin zip, or a bare carddata.txt for a text-only
// import. Reads in the browser (see readLackeySource), parses carddata.txt, and
// lists the sets the file holds to tick — already ticked when there's only one.
// Emits the matched cards to the shared wizard.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  findImageEntry, lackeyRowToDesignCard, lackeyDerivedFields, auditLackeyRow, type LackeyRow,
} from "@/app/forge/lib/lackey";
import { Checkbox } from "@/components/ui/checkbox";
import FilePicker from "@/app/forge/components/FilePicker";
import { fileSets, readLackeySource, setCode } from "./lackeySource";
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
  const [picked, setPicked] = useState<string[]>([]);

  async function onPickFile(file: File) {
    setFileError(null); setRows(null); setPicked([]);
    setFileName(file.name);
    try {
      const src = await readLackeySource(file);
      zipBytes.current = src.zipBytes;
      sizesRef.current = src.sizes;
      setEntryNames(src.entryNames);
      setTextOnly(src.zipBytes === null);
      setRows(src.rows);
      // A one-set file (typically a bare carddata.txt) has nothing to choose.
      const sets = fileSets(src.rows);
      if (sets.length === 1) setPicked([sets[0].code]);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : "Could not read this file.");
    }
  }

  const sets = useMemo(() => fileSets(rows ?? []), [rows]);
  const matched = useMemo(
    () => (rows ?? []).filter((r) => picked.includes(setCode(r))),
    [rows, picked],
  );

  const selection = useMemo<SourceSelection | null>(() => {
    if (matched.length === 0) return null;
    const onlySet = picked.length === 1 ? sets.find((s) => s.code === picked[0]) : undefined;
    return {
      cards: matched.map((r) => ({
        name: r.name,
        snapshot: lackeyRowToDesignCard(r),
        derived: lackeyDerivedFields(r),
        entryName: findImageEntry(r, entryNames),
        warnings: auditLackeyRow(r),
      })),
      zipBytes: zipBytes.current,
      sizes: sizesRef.current,
      defaultSetName: onlySet?.code ? onlySet.label : "",
      key: `lackey|${fileName}|${[...picked].sort().join("|")}`,
    };
  }, [matched, picked, sets, entryNames, fileName]);
  useEffect(() => { onSelection(selection); }, [selection, onSelection]);

  const noImage = selection ? selection.cards.filter((c) => !c.entryName).length : 0;

  function toggle(code: string, on: boolean) {
    setPicked((p) => (on ? [...p, code] : p.filter((c) => c !== code)));
  }

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
            {fileName} — {rows.length} cards across {sets.length} {sets.length === 1 ? "set" : "sets"}.
            {textOnly && " No images — cards import as text only."}
          </p>
        )}
        {fileError && <p className="mt-2 text-xs text-destructive">{fileError}</p>}
      </fieldset>

      {/* 3 — which of the file's sets */}
      {rows && (
        <fieldset className="mt-4 min-w-0 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">3 · Sets in this file</legend>
          {sets.length > 1 && (
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>Tick the sets to import. You choose where they go in step 5.</span>
              <button type="button" className="min-h-11 underline hover:text-foreground disabled:opacity-50 sm:min-h-0" disabled={disabled}
                onClick={() => setPicked(sets.map((s) => s.code))}>
                Tick all
              </button>
              <button type="button" className="min-h-11 underline hover:text-foreground disabled:opacity-50 sm:min-h-0" disabled={disabled}
                onClick={() => setPicked([])}>
                Clear
              </button>
            </div>
          )}
          <ul className="grid max-h-56 overflow-y-auto sm:grid-cols-2">
            {sets.map((s) => (
              <li key={s.code}>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 pr-3 text-sm sm:min-h-9">
                  <Checkbox checked={picked.includes(s.code)} disabled={disabled}
                    onCheckedChange={(v) => toggle(s.code, v === true)} />
                  {s.code && s.code.toLowerCase() !== s.label.toLowerCase() && <span className="font-medium">{s.code}</span>}
                  <span className="min-w-0 truncate">{s.label}</span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">{s.count}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm">
            {matched.length === 1 ? "1 card selected" : `${matched.length} cards selected`}
            {matched.length > 0 && !textOnly && (
              <span className="text-muted-foreground"> · {noImage} without an image</span>
            )}
          </p>
        </fieldset>
      )}
    </>
  );
}
