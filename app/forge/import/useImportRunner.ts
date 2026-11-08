"use client";

// Shared batch-upload machinery for both import sources (Lackey zip, images zip +
// spreadsheet). Cards are POSTed to /forge/api/import in size-capped batches with a
// small concurrency pool; per-card statuses stream back into React state. Images are
// decompressed from the source zip PER BATCH (not all upfront) — a 200MB+ images zip
// would otherwise double in memory before the first request leaves.

import { useMemo, useRef, useState } from "react";
import { unzipSync } from "fflate";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { summarizeOverwritePreview, type OverwritePreview, type RowPreview } from "./overwrite";

const BATCH_SIZE = 8;            // cards per request (must stay ≤ the route's cap of 12)
const BATCH_CONCURRENCY = 4;     // requests in flight
const MAX_BATCH_BYTES = 3_500_000; // keep each request under Vercel's ~4.5MB body cap

export type CardStatus = "queued" | "importing" | "imported" | "updated" | "unchanged" | "skipped" | "failed";

export interface RunCard {
  name: string;
  snapshot: DesignCard;
  derived: string[];        // snapshot keys with no cell behind them; an overwrite skips these
  entryName: string | null; // zip entry for the finished-card image, if present
  status: CardStatus;
  error?: string;
}

export function mimeFor(entryName: string): string {
  const lower = entryName.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  return "image/jpeg";
}

function baseName(entryName: string): string {
  return entryName.split("/").pop() ?? entryName;
}

interface BatchCardResult {
  name: string; ok: boolean; cardId?: string; skipped?: boolean; updated?: boolean; unchanged?: boolean;
  preview?: RowPreview; error?: string;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body?.error) return body.error;
  } catch { /* non-JSON error body */ }
  return `Import failed (${res.status})`;
}

type PreviewCard = { name: string; snapshot: DesignCard; derived: string[]; entryName: string | null };

// Asks the route what each row would do in this set, in row order. No images go up and nothing
// is written. Throws if any batch can't be read: nothing should act on a partial answer.
export async function previewRows(
  setId: string,
  cards: PreviewCard[],
  signal?: AbortSignal,
): Promise<(RowPreview | undefined)[]> {
  const rows = new Array<RowPreview | undefined>(cards.length);
  let cursor = 0;
  const runOne = async () => {
    for (;;) {
      signal?.throwIfAborted();
      const start = cursor;
      cursor += BATCH_SIZE;
      if (start >= cards.length) return;
      const batch = cards.slice(start, start + BATCH_SIZE);
      const fd = new FormData();
      fd.set("payload", JSON.stringify({
        setId, overwrite: true, preview: true,
        cards: batch.map((c) => ({ name: c.name, snapshot: c.snapshot, derived: c.derived })),
      }));
      const res = await fetch("/forge/api/import", { method: "POST", body: fd, signal });
      if (!res.ok) throw new Error(await errorMessage(res));
      const body = (await res.json()) as { results?: BatchCardResult[] };
      batch.forEach((_, j) => { rows[start + j] = body.results?.[j]?.preview; });
    }
  };
  await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, runOne));
  return rows;
}

// What an overwrite run would do, counted for its confirm step.
export async function previewOverwrite(setId: string, cards: PreviewCard[]): Promise<OverwritePreview> {
  const rows = await previewRows(setId, cards);
  return summarizeOverwritePreview(rows.map((preview, i) => ({ preview, hasImage: !!cards[i].entryName })));
}

// Greedy chunking: ≤ BATCH_SIZE cards and ≤ MAX_BATCH_BYTES of (uncompressed) image
// data per request. An image bigger than the cap still gets its own single-card batch.
export function chunkIntoBatches(
  indexes: number[],
  work: { entryName: string | null }[],
  sizes: Record<string, number>,
): number[][] {
  const batches: number[][] = [];
  let current: number[] = [];
  let currentBytes = 0;
  for (const idx of indexes) {
    const entry = work[idx].entryName;
    const size = entry ? (sizes[entry] ?? 0) : 0;
    if (current.length > 0 && (current.length >= BATCH_SIZE || currentBytes + size > MAX_BATCH_BYTES)) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(idx);
    currentBytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function useImportRunner() {
  const [items, setItems] = useState<RunCard[] | null>(null);
  const [running, setRunning] = useState(false);
  const [doneSetId, setDoneSetId] = useState<string | null>(null);
  // Retry re-uses the last run's inputs without threading them back through the wizard.
  const lastZip = useRef<Uint8Array | null>(null);
  const lastSizes = useRef<Record<string, number>>({});
  const lastOverwrite = useRef(false);

  // POST one batch; write each card's result (or the batch-level error) into `work`.
  async function importBatch(
    setId: string,
    batch: number[],
    work: RunCard[],
    zipBytes: Uint8Array | null,
    overwrite: boolean,
  ) {
    const wanted = new Set(batch.map((i) => work[i].entryName).filter(Boolean) as string[]);
    const images = zipBytes && wanted.size > 0
      ? unzipSync(zipBytes, { filter: (f) => wanted.has(f.name) })
      : {};

    const fd = new FormData();
    const cards = batch.map((idx, j) => {
      const it = work[idx];
      let fileField: string | undefined;
      if (it.entryName && images[it.entryName]) {
        fileField = `file-${j}`;
        fd.set(fileField, new File([images[it.entryName].slice()], baseName(it.entryName), { type: mimeFor(it.entryName) }));
      }
      return { name: it.name, snapshot: it.snapshot, derived: it.derived, fileField };
    });
    fd.set("payload", JSON.stringify({ setId, cards, overwrite }));

    const res = await fetch("/forge/api/import", { method: "POST", body: fd });
    if (!res.ok) {
      const message = await errorMessage(res);
      for (const idx of batch) { work[idx].status = "failed"; work[idx].error = message; }
      return;
    }
    const body = (await res.json()) as { results?: BatchCardResult[] };
    batch.forEach((idx, j) => {
      const r = body.results?.[j];
      if (!r || r.ok === false) {
        work[idx].status = "failed";
        work[idx].error = r?.error ?? "Unexpected error";
      } else {
        work[idx].status = r.skipped ? "skipped" : r.unchanged ? "unchanged" : r.updated ? "updated" : "imported";
      }
    });
  }

  // Chunk the given items into batches and run them BATCH_CONCURRENCY at a time.
  async function runBatches(setId: string, indexes: number[], work: RunCard[]) {
    const batches = chunkIntoBatches(indexes, work, lastSizes.current);
    let cursor = 0;
    const runOne = async () => {
      for (;;) {
        const b = cursor++;
        if (b >= batches.length) return;
        for (const idx of batches[b]) work[idx].status = "importing";
        setItems([...work]);
        try {
          await importBatch(setId, batches[b], work, lastZip.current, lastOverwrite.current);
        } catch (e) {
          const message = e instanceof Error ? e.message : "Unexpected error";
          for (const idx of batches[b]) {
            if (work[idx].status === "importing") { work[idx].status = "failed"; work[idx].error = message; }
          }
        }
        setItems([...work]);
      }
    };
    await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, runOne));
  }

  async function run(
    setId: string,
    work: RunCard[],
    zipBytes: Uint8Array | null,
    sizes: Record<string, number>,
    overwrite: boolean,
  ) {
    if (running) return;
    setRunning(true);
    try {
      lastZip.current = zipBytes;
      lastSizes.current = sizes;
      lastOverwrite.current = overwrite;
      setItems([...work]);
      await runBatches(setId, work.map((_, i) => i), work);
      setDoneSetId(setId);
    } finally {
      setRunning(false);
    }
  }

  async function retryFailed() {
    const prior = items;
    const setId = doneSetId;
    if (!prior || !setId || running) return;
    setRunning(true);
    try {
      const work = prior.map((it) =>
        it.status === "failed" ? { ...it, error: undefined } : it,
      );
      const failedIndexes = work
        .map((it, i) => (it.status === "failed" ? i : -1))
        .filter((i) => i >= 0);
      setItems([...work]);
      await runBatches(setId, failedIndexes, work);
    } finally {
      setRunning(false);
    }
  }

  function reset() {
    setItems(null);
    setDoneSetId(null);
  }

  const counts = useMemo(() => {
    const c = { imported: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 };
    for (const it of items ?? []) {
      if (it.status === "imported") c.imported++;
      else if (it.status === "updated") c.updated++;
      else if (it.status === "unchanged") c.unchanged++;
      else if (it.status === "skipped") c.skipped++;
      else if (it.status === "failed") c.failed++;
    }
    return c;
  }, [items]);

  const finished = !!items && !running && items.every((it) =>
    it.status === "imported" || it.status === "updated" || it.status === "unchanged" || it.status === "skipped" || it.status === "failed");

  return { items, running, doneSetId, counts, finished, run, retryFailed, reset };
}
