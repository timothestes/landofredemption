"use client";

// Set import wizard with two sources: a LackeyCCG plugin zip (or a bare carddata.txt
// for a text-only import), or a .csv/.xlsx spreadsheet with an optional zip of card
// images. Source files NEVER go to the server (they can exceed 200MB — far past
// Vercel's ~4.5MB request cap): everything is unpacked and parsed in the browser, and
// only the selected cards are sent — batched multipart POSTs to /forge/api/import (see
// useImportRunner). Source panels emit a common SourceSelection; preview, destination,
// and the run pipeline are shared here.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { unzipSync } from "fflate";
import { createSet, type ForgeSetSummary } from "@/app/forge/lib/sets";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import LackeySourcePanel from "./LackeySourcePanel";
import SpreadsheetSourcePanel from "./SpreadsheetSourcePanel";
import { useImportRunner, mimeFor, type RunCard } from "./useImportRunner";
import type { SourceSelection } from "./selection";

// Cap on decompressed object-URL previews — a 200-card zip of ~1MB PNGs would
// Previews load lazily in chunks as the grid scrolls: decompression is synchronous
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

  const preselected = sets.find((s) => s.id === initialSetId)?.id;
  const [mode, setMode] = useState<"new" | "existing">(preselected ? "existing" : "new");
  const [newSetName, setNewSetName] = useState("");
  const [newSetPrivate, setNewSetPrivate] = useState(false);
  const [existingSetId, setExistingSetId] = useState(preselected ?? sets[0]?.id ?? "");
  const [overwrite, setOverwrite] = useState(false);
  const [newSetDialogOpen, setNewSetDialogOpen] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  // Covers the createSet round-trip BEFORE the runner flips `running` — without it a
  // double-click on "Create set & import" creates two sets.
  const [creating, setCreating] = useState(false);
  const [previews, setPreviews] = useState<Map<string, string>>(new Map());
  const [previewError, setPreviewError] = useState(false);
  const [previewCount, setPreviewCount] = useState(PREVIEW_CHUNK);

  const runner = useImportRunner();
  const { items, doneSetId, counts, finished } = runner;
  const running = runner.running || creating;
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

  // Grow the previewed window when the loaded/unloaded BOUNDARY nears the viewport.
  // The observed element is the first still-loading tile — a fixed sentinel at the
  // grid's bottom would sit thousands of px below a mid-grid scroll position and
  // never fire. The callback ref re-targets the observer as the boundary moves;
  // observe() reports current intersection immediately, so a boundary that's
  // already in view cascades until it passes the viewport.
  const totalPreviewable = new Set(cards.map((c) => c.entryName).filter(Boolean)).size;
  const morePreviews = previewCount < totalPreviewable;
  const previewObserver = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    previewObserver.current = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setPreviewCount((c) => c + PREVIEW_CHUNK);
    }, { rootMargin: "600px" });
    return () => previewObserver.current?.disconnect();
  }, []);
  const boundaryRef = (el: HTMLDivElement | null) => {
    const io = previewObserver.current;
    if (io && el) { io.disconnect(); io.observe(el); }
  };
  const firstPendingIdx = morePreviews
    ? cards.findIndex((c) => c.entryName && !previews.has(c.entryName))
    : -1;

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

      const work: RunCard[] = cards.map((c) => ({
        name: c.name, snapshot: c.snapshot, entryName: c.entryName, status: "queued",
      }));
      await runner.run(setId, work, selection.zipBytes, selection.sizes, overwrite);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setCreating(false);
    }
  }

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
        ? <LackeySourcePanel disabled={running} onSelection={setSelection} />
        : <SpreadsheetSourcePanel disabled={running} onSelection={setSelection} />}

      {/* 4 — preview */}
      {cards.length > 0 && !items && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">4 · Preview</legend>
          {previewError && (
            <p className="mb-2 text-xs text-destructive">
              Couldn’t read image data from the zip — previews are unavailable, and these
              images will likely fail to import.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {cards.map((c, i) => {
              const url = c.entryName ? previews.get(c.entryName) : null;
              return (
                <div key={`${c.name}|${c.entryName}`} ref={i === firstPendingIdx ? boundaryRef : undefined}>
                  <div className="relative w-full overflow-hidden rounded-md border bg-muted/30" style={{ aspectRatio: "2.5 / 3.5" }}>
                    {url ? (
                      <img src={url} alt={c.name} loading="lazy" decoding="async"
                        className="absolute inset-0 h-full w-full object-contain" />
                    ) : (
                      <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
                        {c.entryName ? "Loading preview…" : "No image"}
                      </div>
                    )}
                    {c.warnings.length > 0 && (
                      <span
                        title={c.warnings.join("\n")}
                        className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full border border-amber-500/40 bg-amber-500/15 text-[10px] font-semibold text-amber-700 backdrop-blur-sm dark:text-amber-400"
                      >
                        !
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{c.name}</p>
                </div>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* 5 — destination + run (hidden once a run starts; selection change resets) */}
      {cards.length > 0 && !items && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">5 · Destination</legend>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="dest" checked={mode === "new"}
                onChange={() => { setMode("new"); setOverwrite(false); }} />
              Create a new set
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="dest" checked={mode === "existing"} onChange={() => setMode("existing")}
                disabled={sets.length === 0} />
              Add to an existing set
            </label>
            {mode === "existing" && (
              <>
                <select value={existingSetId} onChange={(e) => setExistingSetId(e.target.value)}
                  aria-label="Existing set" className="ml-6 w-64 rounded-md border bg-background px-2 py-1 text-sm">
                  {sets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <label className="mt-2 flex items-start gap-2 text-sm">
                  <Checkbox checked={overwrite} onCheckedChange={(v) => setOverwrite(v === true)}
                    className="mt-0.5" />
                  <span>
                    <span className="font-medium">Overwrite existing cards</span>
                    <span className="block text-xs text-muted-foreground">
                      Cards whose names already exist in the set get their text and finished
                      image replaced (a new testing version — release the update when ready).
                      Cards not in this import are untouched.
                    </span>
                  </span>
                </label>
              </>
            )}
          </div>
          {runError && <p className="mt-2 text-sm text-destructive">{runError}</p>}
          <Button type="button" className="mt-3"
            onClick={() => (mode === "new" ? setNewSetDialogOpen(true) : runImport())}
            disabled={running || cards.length === 0}>
            {cards.length === 1 ? "Import 1 card" : `Import ${cards.length} cards`}
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

      {/* 6 — progress + summary */}
      {items && (
        <fieldset className="mt-4 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">6 · Import</legend>
          <p className="text-sm">
            {overwrite ? (
              <>Imported {counts.imported} · Updated {counts.updated} · Skipped {counts.skipped} · Failed {counts.failed}</>
            ) : (
              <>Imported {counts.imported} · Skipped {counts.skipped} · Failed {counts.failed}</>
            )}
          </p>
          {finished && counts.failed > 0 && (
            <Button type="button" variant="outline" size="sm" className="mt-2 h-7 px-3 text-xs" onClick={runner.retryFailed}>
              Retry failed
            </Button>
          )}
          {finished && doneSetId && (
            <Link href={`/forge/sets/${doneSetId}/cards`}
              className="mt-2 block text-sm font-medium text-primary hover:underline">
              View set →
            </Link>
          )}
          <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto text-xs">
            {items.map((it, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="truncate">{it.name}</span>
                <span className={
                  it.status === "failed" ? "text-destructive"
                    : it.status === "imported" || it.status === "updated" ? "text-primary"
                    : "text-muted-foreground"
                }>
                  {it.status === "failed" ? `failed: ${it.error ?? "unknown"}` : it.status}
                </span>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </div>
  );
}
