"use client";

import Link from "next/link";
import type { ProgressModel } from "@/app/forge/lib/progress";
import { STATUS_LABEL } from "@/app/forge/lib/lifecycleCopy";

const STATUS_ORDER = ["draft", "playtesting", "approved"];
const STATUS_COLOR: Record<string, string> = { draft: "bg-muted-foreground/40", playtesting: "bg-amber-500", approved: "bg-primary" };

function cellTone(actual: number, target: number): string {
  // Dark mode gets stronger tints — the /10–/25 washes are near-invisible over the near-black background.
  if (target === 0) return actual > 0 ? "bg-primary/10 dark:bg-primary/25" : "";
  if (actual >= target) return "bg-primary/25 dark:bg-primary/40";
  if (actual === 0) return "bg-muted";
  return "bg-amber-100 dark:bg-amber-500/25";
}

export default function ProgressDashboard({
  setId, model, hasApprovedArt,
}: {
  setId: string; model: ProgressModel; hasApprovedArt: boolean;
}) {
  const live = model.headline.actual;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-3xl font-semibold tabular-nums">
            {model.headline.actual}{model.headline.target ? <span className="text-muted-foreground"> / {model.headline.target}</span> : null}
            {model.headline.target ? <span className="ml-2 text-base text-muted-foreground">· {model.headline.pct}%</span> : null}
          </div>
          <p className="text-xs text-muted-foreground">cards in set</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {hasApprovedArt ? (
            <a
              href={`/forge/api/sets/${setId}/artwork`}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Download artwork (ZIP)
            </a>
          ) : (
            <span
              className="cursor-not-allowed rounded-md border px-3 py-1.5 text-sm text-muted-foreground opacity-50"
              title="Mark cards final with art to enable"
              aria-disabled="true"
            >
              Download artwork (ZIP)
            </span>
          )}
        </div>
      </div>

      {/* status breakdown bar — scaled to the target so the unfilled remainder reads as
          "left to build". Falls back to a composition view when no target is set. */}
      {live > 0 && (
        <div>
          <div className="flex h-3 overflow-hidden rounded-full border bg-muted">
            {(() => {
              const denom = model.headline.target > 0 ? Math.max(model.headline.target, live) : live;
              return STATUS_ORDER.map((s) => {
                const n = model.byStatus[s] ?? 0;
                return n > 0 ? <div key={s} className={STATUS_COLOR[s]} style={{ width: `${(n / denom) * 100}%` }} /> : null;
              });
            })()}
          </div>
          <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
            {STATUS_ORDER.map((s) => <span key={s}>{STATUS_LABEL[s] ?? s}: {model.byStatus[s] ?? 0}</span>)}
          </div>
        </div>
      )}

      {/* brigade × card-type heatmap */}
      {model.types.length > 0 && (
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-background p-1 text-left">Type \ Brigade</th>
                {model.brigades.map((b) => <th key={b} className="p-1 font-normal">{b}</th>)}
                <th className="border-l p-1 font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {model.types.map((t) => {
                const rowCells = model.cells.filter((c) => c.type === t);
                const rowActual = rowCells.reduce((sum, c) => sum + c.actual, 0);
                const rowTarget = rowCells.reduce((sum, c) => sum + c.target, 0);
                return (
                  <tr key={t}>
                    <th className="sticky left-0 bg-background p-1 text-left font-normal">{t}</th>
                    {model.brigades.map((b) => {
                      const cell = model.cells.find((c) => c.type === t && c.brigade === b)!;
                      return (
                        <td key={b} className={`p-1 text-center ${cellTone(cell.actual, cell.target)}`}>
                          <Link href={`/forge/sets/${setId}/cards`} className="block tabular-nums">
                            {cell.actual}{cell.target ? `/${cell.target}` : ""}
                          </Link>
                        </td>
                      );
                    })}
                    <td className={`border-l p-1 text-center font-medium ${cellTone(rowActual, rowTarget)}`}>
                      <Link href={`/forge/sets/${setId}/cards`} className="block tabular-nums">
                        {rowActual}{rowTarget ? `/${rowTarget}` : ""}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* what's-left checklist */}
      {model.checklist.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium">What&apos;s left</p>
          <ul className="space-y-0.5 text-sm text-muted-foreground">
            {model.checklist.map((c) => (
              <li key={`${c.type}-${c.brigade}`}>
                {c.remaining} more {c.brigade === "none" ? "" : `${c.brigade} `}{c.type}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
