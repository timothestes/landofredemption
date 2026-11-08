"use client";

// Set import wizard with two sources: a LackeyCCG plugin zip (or a bare carddata.txt
// for a text-only import), or a .csv/.xlsx spreadsheet with an optional zip of card
// images. Source files NEVER go to the server (they can exceed 200MB — far past
// Vercel's ~4.5MB request cap): everything is unpacked and parsed in the browser, and
// only the selected cards are sent — batched multipart POSTs to /forge/api/import (see
// useImportRunner). Source panels emit a common SourceSelection; preview, destination,
// and the run pipeline are shared here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { unzipSync } from "fflate";
import { createSet, type ForgeSetSummary } from "@/app/forge/lib/sets";
import { NEW_SET_PRIVATE_DEFAULT } from "@/app/forge/lib/setAccess";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import ImportPreviewTable from "./ImportPreviewTable";
import LackeySourcePanel from "./LackeySourcePanel";
import SpreadsheetSourcePanel from "./SpreadsheetSourcePanel";
import { useImportRunner, previewOverwrite, previewRows, mimeFor, type RunCard } from "./useImportRunner";
import { overwriteConfirmCopy, type OverwritePreview, type RowPreview } from "./overwrite";
import { importButtonCopy, needsFixing, resultHeadline, rowOutcome, runRowLabel, skippedNote } from "./importCopy";
import type { SourceSelection } from "./selection";

// Previews load lazily in chunks as the table scrolls: decompression is synchronous
// main-thread work and each ~1MB PNG pins a blob URL, so a 224-card zip decompressed
// all at once would freeze the page and hold hundreds of MB. Chunks keep each pause
// short and spend memory only on what the elder actually scrolls to.
const PREVIEW_CHUNK = 60;

type Source = "lackey" | "spreadsheet";

export default function ImportWizard({
  sets,
  initialSetId,
}: {
  sets: ForgeSetSummary[];
  initialSetId?: string; // from ?set=<id> — lands on "add to this set"
}) {
  const [source, setSource] = useState<Source>("lackey");
  const [selection, setSelection] = useState<SourceSelection | null>(null);
  // Bumped to remount the source panel, which drops the files it holds.
  const [panelKey, setPanelKey] = useState(0);

  const preselected = sets.find((s) => s.id === initialSetId)?.id;
  const [mode, setMode] = useState<"new" | "existing">(preselected ? "existing" : "new");
  const [newSetName, setNewSetName] = useState("");
  const [newSetPrivate, setNewSetPrivate] = useState(NEW_SET_PRIVATE_DEFAULT);
  const [existingSetId, setExistingSetId] = useState(preselected ?? "");
  const [overwrite, setOverwrite] = useState(false);
  const [newSetDialogOpen, setNewSetDialogOpen] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  // Covers the createSet round-trip BEFORE the runner flips `running` — without it a
  // double-click on "Create set & import" creates two sets.
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState<OverwritePreview | null>(null);
  const [previews, setPreviews] = useState<Map<string, string>>(new Map());
  const [previewError, setPreviewError] = useState(false);
  const [previewCount, setPreviewCount] = useState(PREVIEW_CHUNK);
  // What the chosen set already holds, row by row. Null until there's a set to check.
  const [setCheck, setSetCheck] = useState<(RowPreview | undefined)[] | "checking" | "failed" | null>(null);
  const [destName, setDestName] = useState("");

  const runner = useImportRunner();
  const { items, doneSetId, counts, finished } = runner;
  const running = runner.running || creating || checking;
  const cards = selection?.cards ?? [];

  // A different selection (new file, filter, sheet, or mapping) starts fresh.
  // Sources are disabled while a run is in flight, so this can't fire mid-run.
  useEffect(() => {
    runner.reset();
    setRunError(null);
    setPreviewCount(PREVIEW_CHUNK);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.key]);

  // Prefill the new-set name from the source (filter value / sheet name).
  useEffect(() => {
    if (selection?.defaultSetName) setNewSetName(selection.defaultSetName);
  }, [selection?.defaultSetName]);

  // Decompress the first `previewCount` selected images into object URLs, incrementally:
  // already-decompressed entries are kept (mapping/filter edits and scroll growth only
  // pay for the delta); everything is revoked when the zip itself changes. Guarded — a
  // zip whose directory scanned fine at pick time can still hold corrupt image data,
  // and that must not crash the wizard.
  const previewCache = useRef<{ bytes: Uint8Array | null; urls: Map<string, string> }>(
    { bytes: null, urls: new Map() },
  );
  useEffect(() => {
    const zipBytes = selection?.zipBytes ?? null;
    const cache = previewCache.current;
    if (cache.bytes !== zipBytes) {
      for (const u of cache.urls.values()) URL.revokeObjectURL(u);
      cache.bytes = zipBytes;
      cache.urls = new Map();
      setPreviewError(false);
    }
    const missing = [...new Set(
      (selection?.cards ?? []).map((c) => c.entryName).filter(Boolean) as string[],
    )].slice(0, previewCount).filter((n) => !cache.urls.has(n));
    if (zipBytes && missing.length > 0) {
      try {
        const missingSet = new Set(missing);
        const files = unzipSync(zipBytes, { filter: (f) => missingSet.has(f.name) });
        for (const [name, bytes] of Object.entries(files)) {
          cache.urls.set(name, URL.createObjectURL(new Blob([bytes.slice()], { type: mimeFor(name) })));
        }
      } catch {
        setPreviewError(true);
      }
    }
    setPreviews(new Map(cache.urls));
  }, [selection, previewCount]);
  useEffect(() => () => {
    for (const u of previewCache.current.urls.values()) URL.revokeObjectURL(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPreviewable = new Set(cards.map((c) => c.entryName).filter(Boolean)).size;
  const morePreviews = previewCount < totalPreviewable;
  const loadMorePreviews = useCallback(() => setPreviewCount((c) => c + PREVIEW_CHUNK), []);
  // Nothing to watch until the first chunk lands, or there's none coming (a corrupt zip).
  const firstPendingIdx = morePreviews && previews.size > 0
    ? cards.findIndex((c) => c.entryName && !previews.has(c.entryName))
    : -1;

  // Says what a run into this set will do before anyone presses Import. Only asks once the
  // choices settle: ticking a set or re-pointing a column each make a new selection.
  const wantsSetCheck = mode === "existing" && !!existingSetId && cards.length > 0 && !items;
  useEffect(() => {
    if (!wantsSetCheck) { setSetCheck(null); return; }
    setSetCheck("checking");
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      previewRows(existingSetId, cards, ctl.signal).then(
        (rows) => { if (!ctl.signal.aborted) setSetCheck(rows); },
        () => { if (!ctl.signal.aborted) setSetCheck("failed"); },
      );
    }, 400);
    return () => { clearTimeout(timer); ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsSetCheck, existingSetId, selection?.key]);
  const outcomes = useMemo(
    () => (Array.isArray(setCheck)
      ? setCheck.map((preview, i) => rowOutcome(preview, overwrite, !!cards[i]?.entryName))
      : null),
    [setCheck, overwrite, cards],
  );
  const buttonCopy = importButtonCopy(cards.length, outcomes, overwrite);

  function switchSource(next: Source) {
    if (running || next === source) return;
    setSource(next);
    setSelection(null); // the outgoing panel unmounts; its files drop with it
  }

  async function runImport() {
    if (running || !selection || cards.length === 0) return;
    setRunError(null);
    setCreating(true);
    try {
      let setId = existingSetId;
      if (mode === "new") {
        const name = newSetName.trim();
        if (!name) { setRunError("Name the new set first."); return; }
        const r = await createSet(name, newSetPrivate);
        if (r.ok === false) { setRunError(r.error); return; }
        setId = r.id;
      }
      if (!setId) { setRunError("Pick a destination set."); return; }
      setDestName(mode === "new" ? newSetName.trim() : sets.find((s) => s.id === setId)?.name ?? "this set");

      const work: RunCard[] = cards.map((c) => ({
        name: c.name, snapshot: c.snapshot, derived: c.derived, entryName: c.entryName, warnings: c.warnings, status: "queued",
      }));
      await runner.run(setId, work, selection.zipBytes, selection.sizes, overwrite);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setCreating(false);
    }
  }

  // An overwrite run says how many existing cards it will change before it changes them. With
  // none to change there's nothing to confirm: it only reports them and adds any new cards.
  async function checkOverwrite() {
    if (running || cards.length === 0) return;
    if (!existingSetId) { setRunError("Pick a destination set."); return; }
    setRunError(null);
    setChecking(true);
    try {
      const preview = await previewOverwrite(existingSetId, cards);
      if (preview.changed > 0) { setConfirmOverwrite(preview); return; }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Couldn\u2019t check the existing cards.");
      return;
    } finally {
      setChecking(false);
    }
    await runImport();
  }

  // Back to step 2, keeping the destination. Remounting the panel drops its files.
  function importAnother() {
    setPanelKey((k) => k + 1);
    setSelection(null);
    setOverwrite(false);
    setNewSetName("");
    window.scrollTo({ top: 0 });
  }

  const overwriteCopy = confirmOverwrite && overwriteConfirmCopy(confirmOverwrite);
  const fixUps = (items ?? []).filter(needsFixing);
  const flagged = cards.filter((c) => c.warnings.length > 0).length;

  return (
    <div className="mx-auto max-w-4xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Import a set</h1>
        <Link href="/forge/sets" className="text-sm text-muted-foreground hover:underline">← Sets</Link>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Import from a Lackey plugin zip or carddata.txt, or from a .csv/.xlsx spreadsheet —
        with or without card images. Files are unpacked in your browser — only the cards
        you select are uploaded, privately, to the Forge.
      </p>

      {/* 1 — source */}
      <fieldset className="rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">1 · Source</legend>
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="radio" name="source" className="mt-0.5" disabled={running}
              checked={source === "lackey"} onChange={() => switchSource("lackey")} />
            <span>
              Lackey plugin zip or carddata.txt
              <span className="block text-xs text-muted-foreground">
                A full plugin export (sets/carddata.txt plus set images), or just
                carddata.txt for a text-only import.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="source" className="mt-0.5" disabled={running}
              checked={source === "spreadsheet"} onChange={() => switchSource("spreadsheet")} />
            <span>
              Spreadsheet (.csv or .xlsx)
              <span className="block text-xs text-muted-foreground">
                Card text in a spreadsheet, plus an optional zip of finished card images.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {source === "lackey"
        ? <LackeySourcePanel key={panelKey} disabled={running} onSelection={setSelection} />
        : <SpreadsheetSourcePanel key={panelKey} disabled={running} onSelection={setSelection} />}

      {/* 4 — preview */}
      {cards.length > 0 && !items && (
        <fieldset className="mt-4 min-w-0 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">4 · Preview</legend>
          {previewError && (
            <p className="mb-2 text-xs text-destructive">
              Couldn’t read image data from the zip — previews are unavailable, and these
              images will likely fail to import.
            </p>
          )}
          <p className="mb-2 text-xs text-muted-foreground">
            What each card will be saved with.
            {flagged > 0 && ` ${flagged} flagged: amber says what won’t import.`}
          </p>
          <ImportPreviewTable cards={cards} previews={previews} firstPendingIdx={firstPendingIdx}
            onNeedMorePreviews={loadMorePreviews} outcomes={outcomes} />
        </fieldset>
      )}

      {/* 5 — destination + run (hidden once a run starts; selection change resets) */}
      {cards.length > 0 && !items && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">5 · Destination</legend>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="dest" checked={mode === "new"} disabled={running}
                onChange={() => { setMode("new"); setOverwrite(false); }} />
              Create a new set
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="dest" checked={mode === "existing"} onChange={() => setMode("existing")}
                disabled={running || sets.length === 0} />
              Add to an existing set
            </label>
            {mode === "existing" && (
              <>
                <select value={existingSetId} onChange={(e) => setExistingSetId(e.target.value)} disabled={running}
                  aria-label="Existing set" className="ml-6 w-64 rounded-md border bg-background px-2 py-1 text-sm">
                  <option value="" disabled>Choose a set…</option>
                  {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <label className="mt-2 flex items-start gap-2 text-sm">
                  <Checkbox checked={overwrite} onCheckedChange={(v) => setOverwrite(v === true)} disabled={running}
                    className="mt-0.5" />
                  <span>
                    <span className="font-medium">Overwrite existing cards</span>
                    <span className="block text-xs text-muted-foreground">
                      Cards with the same name in this set take the values in this file, plus its
                      finished image if it has one. Blank cells and columns not in this file leave
                      a card’s values alone. This edits the draft: playtesters see nothing until
                      you release the update. Cards not in this file are untouched.
                    </span>
                  </span>
                </label>
              </>
            )}
          </div>
          {buttonCopy.note && <p className="mt-3 text-sm">{buttonCopy.note}</p>}
          {setCheck === "failed" && (
            <p className="mt-3 text-sm text-amber-600 dark:text-amber-500">
              Couldn’t check this set for existing cards.
              {overwrite ? " Importing will try again first." : " Any already in it will be skipped, not changed."}
            </p>
          )}
          {runError && <p className="mt-2 text-sm text-destructive">{runError}</p>}
          <Button type="button" className="mt-3"
            onClick={() => (mode === "new" ? setNewSetDialogOpen(true) : overwrite ? checkOverwrite() : runImport())}
            disabled={running || cards.length === 0 || setCheck === "checking" || buttonCopy.nothingToDo}>
            {checking || setCheck === "checking" ? "Checking existing cards…" : buttonCopy.label}
          </Button>
        </fieldset>
      )}

      <Dialog open={newSetDialogOpen} onOpenChange={(o) => !running && setNewSetDialogOpen(o)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>New set for this import</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Set name</span>
              <input value={newSetName} onChange={(e) => setNewSetName(e.target.value)}
                aria-label="New set name" placeholder="Set name"
                className="w-full rounded-md border bg-background px-2 py-1 text-sm" />
            </label>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox checked={newSetPrivate} onCheckedChange={(v) => setNewSetPrivate(v === true)} className="mt-0.5" />
              <span>
                <span className="font-medium">Private set</span>
                <span className="block text-xs text-muted-foreground">
                  Only you and designers you add can see it. Hidden from other elders.
                </span>
              </span>
            </label>
          </DialogBody>
          <DialogFooter className="justify-end">
            <Button variant="cancel" onClick={() => setNewSetDialogOpen(false)}>Cancel</Button>
            <Button disabled={running || !newSetName.trim()}
              onClick={() => { setNewSetDialogOpen(false); runImport(); }}>
              {cards.length === 1 ? "Create set & import 1 card" : `Create set & import ${cards.length} cards`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={confirmOverwrite !== null}
        onOpenChange={(o) => { if (!o) setConfirmOverwrite(null); }}
        onConfirm={() => { void runImport(); }}
        variant="warning"
        title={overwriteCopy?.title ?? ""}
        confirmLabel={overwriteCopy?.confirmLabel ?? ""}
      >
        <ul className="space-y-2 text-sm text-muted-foreground">
          {overwriteCopy?.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      </ConfirmationDialog>

      {/* progress + summary */}
      {items && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">{finished ? "Result" : "Importing"}</legend>
          <p className="text-sm font-medium">{resultHeadline(counts, destName, finished)}</p>
          <p className="mt-1 text-sm">
            {overwrite ? (
              <>Imported {counts.imported} · Updated {counts.updated} · Unchanged {counts.unchanged} · Failed {counts.failed}</>
            ) : (
              <>Imported {counts.imported} · Skipped {counts.skipped} · Failed {counts.failed}</>
            )}
          </p>
          {finished && counts.skipped > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              {skippedNote(counts.skipped)}
              {mode === "existing" && !overwrite && (
                <>
                  {" "}
                  <button type="button" className="text-foreground underline"
                    onClick={() => { setOverwrite(true); runner.reset(); }}>
                    Go back and overwrite
                  </button>
                </>
              )}
            </p>
          )}
          {finished && fixUps.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                {fixUps.length === 1 ? "1 card needs fixing" : `${fixUps.length} cards need fixing`}
              </p>
              <p className="text-xs text-muted-foreground">
                These fields didn’t import. Each card opens in a new tab, so this list stays here.
              </p>
              <ul className="mt-1 max-h-64 overflow-y-auto text-xs">
                {fixUps.map((it, i) => (
                  <li key={i} className="py-1">
                    {it.cardId
                      ? <a href={`/forge/cards/${it.cardId}`} target="_blank" rel="noopener noreferrer" className="font-medium underline">{it.name}</a>
                      : <span className="font-medium">{it.name}</span>}
                    <span className="text-muted-foreground">: {it.warnings.join("; ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {finished && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {counts.failed > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={runner.retryFailed}>
                  Retry failed
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={importAnother}>
                Import another file
              </Button>
              {doneSetId && (
                <Link href={`/forge/sets/${doneSetId}/cards`} className="text-sm font-medium text-primary hover:underline">
                  View set →
                </Link>
              )}
            </div>
          )}
          <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto text-xs">
            {items.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                {it.cardId
                  ? <a href={`/forge/cards/${it.cardId}`} target="_blank" rel="noopener noreferrer" className="truncate hover:underline">{it.name}</a>
                  : <span className="truncate">{it.name}</span>}
                <span className={
                  it.status === "failed" ? "text-destructive"
                    : needsFixing(it) ? "text-amber-700 dark:text-amber-400"
                    : it.status === "imported" || it.status === "updated" ? "text-primary"
                    : "text-muted-foreground"
                }>
                  {runRowLabel(it)}
                </span>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </div>
  );
}
