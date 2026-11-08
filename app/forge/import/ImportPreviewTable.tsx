"use client";

// The import preview: one row per card, showing what it will be saved with, in a box short
// enough that the Destination step and its Import button stay a scroll away at any sheet size.
// Memoized so typing a new set's name doesn't re-render every row.

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { OUTCOME_LABEL, type RowOutcome } from "./importCopy";
import { previewColumns } from "./previewColumns";
import type { SelectedCard } from "./selection";

const headCell = "sticky top-0 border-b bg-card px-2 py-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

function ImportPreviewTable({
  cards,
  previews,
  firstPendingIdx,
  onNeedMorePreviews,
  outcomes,
}: {
  cards: SelectedCard[];
  previews: Map<string, string>; // zip entry name → object URL, for what's been decompressed so far
  firstPendingIdx: number;       // first row still waiting on its image; -1 when none are
  onNeedMorePreviews: () => void;
  outcomes: (RowOutcome | null)[] | null; // what the run will do to each row, once a set is checked
}) {
  const columns = useMemo(() => previewColumns(cards.map((c) => c.snapshot)), [cards]);
  const hasImages = useMemo(() => cards.some((c) => c.entryName), [cards]);
  // "New" only says something once other rows are getting something else.
  const showOutcomes = outcomes?.some((o) => o !== "add" && o !== null);

  // Grow the decompressed window when the first still-loading row nears view. Measured rather than
  // observed: dragging the scrollbar can jump right past that row, which an observer wouldn't report.
  const scroller = useRef<HTMLDivElement>(null);
  const boundary = useRef<HTMLTableRowElement>(null);
  const loadIfNear = useCallback(() => {
    const box = scroller.current;
    if (box && boundary.current && boundary.current.offsetTop < box.scrollTop + box.clientHeight + 600) onNeedMorePreviews();
  }, [onNeedMorePreviews]);
  useEffect(loadIfNear, [firstPendingIdx, loadIfNear]); // the next boundary may already be near

  return (
    <div ref={scroller} onScroll={loadIfNear} className="max-h-[50vh] overflow-auto rounded-md border bg-card sm:max-h-[32rem]">
      <table className="w-full border-separate border-spacing-0 text-left text-xs">
        <thead>
          <tr>
            <th scope="col" className={`${headCell} left-0 z-30 border-r`}>Name</th>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={`${headCell} z-20 whitespace-nowrap`}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cards.map((c, i) => {
            const url = c.entryName ? previews.get(c.entryName) : null;
            const outcome = outcomes?.[i] ?? null;
            const skipped = outcome === "skip" || outcome === "same";
            return (
              <tr key={`${i}|${c.name}`} ref={i === firstPendingIdx ? boundary : undefined}>
                <th scope="row" className="sticky left-0 z-10 w-44 min-w-44 border-b border-r border-border/60 bg-card p-2 text-left align-top font-normal sm:w-60 sm:min-w-60">
                  <div className="flex gap-2">
                    {hasImages && (
                      <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-sm border bg-muted/30">
                        {url ? (
                          // A new tab, because leaving this page would lose the files picked above.
                          <a href={url} target="_blank" rel="noopener noreferrer" title="Open this image full size">
                            <img src={url} alt={c.name} loading="lazy" decoding="async"
                              className="absolute inset-0 h-full w-full object-contain" />
                          </a>
                        ) : !c.entryName && (
                          <span className="flex h-full items-center justify-center p-0.5 text-center text-[10px] leading-tight text-muted-foreground">
                            No image
                          </span>
                        )}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className={`font-medium [overflow-wrap:anywhere] ${skipped ? "text-muted-foreground" : ""}`}>{c.name}</p>
                      {showOutcomes && outcome && (
                        <p className="mt-0.5 text-muted-foreground">{OUTCOME_LABEL[outcome]}</p>
                      )}
                      {c.warnings.map((w, j) => (
                        <p key={j} className="mt-0.5 text-amber-700 [overflow-wrap:anywhere] dark:text-amber-400">{w}</p>
                      ))}
                    </div>
                  </div>
                </th>
                {columns.map((col) => {
                  const value = col.value(c.snapshot);
                  return (
                    <td key={col.key} title={col.long && value ? value : undefined}
                      className={`border-b border-border/60 px-2 py-2 align-top ${skipped ? "text-muted-foreground" : ""} ${col.long ? "min-w-80" : "whitespace-nowrap tabular-nums"}`}>
                      {col.long ? <span className="line-clamp-2">{value}</span> : value}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default memo(ImportPreviewTable);
