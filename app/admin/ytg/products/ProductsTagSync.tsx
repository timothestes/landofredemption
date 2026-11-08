"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  applyTagChanges,
  computeTagDiff,
  getCollisionReport,
  listMappedSets,
  syncNow,
} from "./actions";
import type {
  ApplyFailure,
  CollisionEntry,
  MappedSet,
  TagChange,
  TagDiffResult,
} from "./actions";
import CollisionPanel from "./CollisionPanel";
import ScopePicker from "./ScopePicker";
import RollupControls from "./RollupControls";
import DiffTable from "./DiffTable";

// Mirrors STALENESS_LIMIT_MS in lib/shopify/tagDiff.ts. Inlined (not imported)
// because that module's init walks CARDS — a value import would pull the card
// database into the client bundle (same pattern as app/admin/import-set/page.tsx).
const STALENESS_LIMIT_MS = 60 * 60 * 1000;

// Products per applyTagChanges call — matches aliasBatch's ≤40-mutations-per-
// document budget and gives the progress counter chunk-level granularity.
const CHUNK_SIZE = 40;

export default function ProductsTagSync() {
  const [sets, setSets] = useState<MappedSet[]>([]);
  const [collisions, setCollisions] = useState<CollisionEntry[]>([]);
  const [loadError, setLoadError] = useState("");
  const [scopeSet, setScopeSet] = useState(""); // "" = all sets

  const [diff, setDiff] = useState<TagDiffResult | null>(null);
  const [computedAt, setComputedAt] = useState(0);
  const [computing, setComputing] = useState(false);

  const [selectedAddTags, setSelectedAddTags] = useState<Set<string>>(new Set());
  const [selectedRemoveTags, setSelectedRemoveTags] = useState<Set<string>>(new Set());
  const [excludedRows, setExcludedRows] = useState<Set<string>>(new Set());

  const [applying, setApplying] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [failures, setFailures] = useState<ApplyFailure[]>([]);
  const [lastApplied, setLastApplied] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");

  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listMappedSets(), getCollisionReport()])
      .then(([mappedSets, collisionReport]) => {
        if (cancelled) return;
        setSets(mappedSets);
        setCollisions(collisionReport);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runComputeDiff(setCode: string) {
    setComputing(true);
    setActionError("");
    try {
      const result = await computeTagDiff(setCode === "" ? {} : { setCode });
      setDiff(result);
      setComputedAt(Date.now());
      // Additions default to all-selected (additive writes are safe);
      // removals default to none — per-tag opt-in, locked by the spec.
      const addTags = new Set<string>();
      for (const entry of result.rollup) {
        if (entry.addCount > 0) addTags.add(entry.tag);
      }
      setSelectedAddTags(addTags);
      setSelectedRemoveTags(new Set());
      setExcludedRows(new Set());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setComputing(false);
    }
  }

  const isStale = useMemo(() => {
    if (diff === null) return false;
    if (diff.oldestSyncAt === null) return true;
    return computedAt - new Date(diff.oldestSyncAt).getTime() > STALENESS_LIMIT_MS;
  }, [diff, computedAt]);

  const effectiveChanges = useMemo<TagChange[]>(() => {
    if (diff === null) return [];
    const changes: TagChange[] = [];
    for (const row of diff.rows) {
      if (excludedRows.has(row.productId)) continue;
      const add = row.add.filter((t) => selectedAddTags.has(t));
      const remove = row.remove.filter((t) => selectedRemoveTags.has(t));
      if (add.length === 0 && remove.length === 0) continue;
      changes.push({ productId: row.productId, add, remove });
    }
    return changes;
  }, [diff, selectedAddTags, selectedRemoveTags, excludedRows]);

  async function runApply(changes: TagChange[]) {
    setApplying(true);
    setActionError("");
    setFailures([]);
    setProgress({ done: 0, total: changes.length });
    let applied = 0;
    const allFailed: ApplyFailure[] = [];
    try {
      for (let i = 0; i < changes.length; i += CHUNK_SIZE) {
        const chunk = changes.slice(i, i + CHUNK_SIZE);
        const result = await applyTagChanges(chunk);
        if (result.error !== null) {
          setActionError(result.error);
          setFailures(allFailed);
          return;
        }
        applied += result.applied;
        allFailed.push(...result.failed);
        setProgress({ done: Math.min(i + CHUNK_SIZE, changes.length), total: changes.length });
      }
      setLastApplied(applied);
      setFailures(allFailed);
      // Verification: recompute — a clean diff IS the success state.
      await runComputeDiff(scopeSet);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  async function runSyncNow() {
    setSyncing(true);
    setActionError("");
    try {
      await syncNow();
      await runComputeDiff(scopeSet);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncing(false);
    }
  }

  function toggled(current: Set<string>, tag: string): Set<string> {
    const next = new Set(current);
    if (next.has(tag)) {
      next.delete(tag);
    } else {
      next.add(tag);
    }
    return next;
  }

  const busy = computing || applying || syncing;

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-24">
      <div>
        <h2 className="text-lg font-semibold">Tag sync</h2>
        <p className="text-sm text-muted-foreground">
          Keep store tags in step with card data. Compute a diff, review it, then apply.
          Removals are opt-in per tag.
        </p>
      </div>

      {loadError !== "" && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{loadError}</div>
      )}

      <CollisionPanel collisions={collisions} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <ScopePicker sets={sets} value={scopeSet} onChange={setScopeSet} disabled={busy} />
        <Button onClick={() => runComputeDiff(scopeSet)} disabled={busy}>
          {computing ? "Computing…" : "Compute diff"}
        </Button>
      </div>

      {actionError !== "" && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{actionError}</div>
      )}

      {failures.length > 0 && (
        <div className="rounded-md bg-destructive/10 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-destructive">
              {failures.length} product{failures.length === 1 ? "" : "s"} failed to apply
            </p>
            <Button
              variant="outline"
              onClick={() =>
                runApply(failures.map((f) => ({ productId: f.productId, add: f.add, remove: f.remove })))
              }
              disabled={busy}
            >
              Retry failed
            </Button>
          </div>
          <ul className="space-y-1 text-xs text-destructive">
            {failures.map((f) => (
              <li key={f.productId}>
                Product {f.productId}: {f.errors.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {diff !== null && diff.rows.length === 0 && (
        <div className="rounded-lg bg-emerald-50 p-6 text-center dark:bg-emerald-950/40">
          <p className="text-base font-medium text-emerald-800 dark:text-emerald-200">
            Store tags match card data ✓
          </p>
          {lastApplied !== null && (
            <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
              Applied changes to {lastApplied.toLocaleString()} product{lastApplied === 1 ? "" : "s"}.
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {diff.productCount.toLocaleString()} mapped products scanned
            {scopeSet === "" ? " across all sets" : ` in ${scopeSet}`}.
          </p>
        </div>
      )}

      {diff !== null && diff.rows.length > 0 && (
        <>
          {isStale && (
            <div className="flex flex-col gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Mirror data is over an hour old (oldest sync:{" "}
                {diff.oldestSyncAt === null ? "never" : new Date(diff.oldestSyncAt).toLocaleString()}
                ). Sync before applying so tag edits made in Shopify aren&apos;t clobbered.
              </span>
              <Button variant="outline" onClick={runSyncNow} disabled={busy}>
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            </div>
          )}

          <RollupControls
            rollup={diff.rollup}
            selectedAddTags={selectedAddTags}
            selectedRemoveTags={selectedRemoveTags}
            onToggleAdd={(tag) => setSelectedAddTags(toggled(selectedAddTags, tag))}
            onToggleRemove={(tag) => setSelectedRemoveTags(toggled(selectedRemoveTags, tag))}
            onSelectAllAdds={() => {
              const all = new Set<string>();
              for (const entry of diff.rollup) {
                if (entry.addCount > 0) all.add(entry.tag);
              }
              setSelectedAddTags(all);
            }}
            onClearAdds={() => setSelectedAddTags(new Set())}
            disabled={applying}
          />

          <p className="text-xs text-muted-foreground">
            {diff.rows.length.toLocaleString()} products with changes (of{" "}
            {diff.productCount.toLocaleString()} mapped products scanned).
          </p>

          <DiffTable
            rows={diff.rows}
            selectedAddTags={selectedAddTags}
            selectedRemoveTags={selectedRemoveTags}
            excludedRows={excludedRows}
            onToggleRow={(id) => {
              const next = new Set(excludedRows);
              if (next.has(id)) {
                next.delete(id);
              } else {
                next.add(id);
              }
              setExcludedRows(next);
            }}
            disabled={applying}
          />

          <div className="sticky bottom-0 -mx-3 flex items-center justify-between gap-3 bg-background/80 p-3 backdrop-blur sm:mx-0 sm:rounded-lg">
            <span className="text-sm text-muted-foreground">
              {applying
                ? `Applying… ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} products`
                : `${effectiveChanges.length.toLocaleString()} product${effectiveChanges.length === 1 ? "" : "s"} selected`}
            </span>
            <Button
              onClick={() => runApply(effectiveChanges)}
              disabled={busy || isStale || effectiveChanges.length === 0}
              className="bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
            >
              {applying ? "Applying…" : `Apply to ${effectiveChanges.length.toLocaleString()} product${effectiveChanges.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
