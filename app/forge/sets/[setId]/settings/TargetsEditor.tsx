"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveSetTargets } from "@/app/forge/lib/sets";
import type { TargetCounts } from "@/app/forge/lib/progress";
import { CARD_TYPES } from "@/app/forge/lib/designCard";
import { typeLabel, brigadeLabel } from "@/app/forge/lib/filterIcons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";

// The per-brigade columns the editor exposes; "none" is the brigade-less bucket
// used by types that have no brigade and by per-type-only edits.
const BRIGADES = [
  "none", "Blue", "Clay", "GoodGold", "Green", "Purple", "Red", "Silver",
  "Teal", "White", "Black", "Brown", "Crimson", "EvilGold", "Gray", "Orange", "PaleGreen",
];

const inputClass = "rounded-md border border-input bg-background px-2 py-1 text-sm";

// Sum of every brigade cell for one type.
const rowSum = (row: Record<string, number> | undefined) =>
  row ? Object.values(row).reduce((a, b) => a + (b || 0), 0) : 0;

export default function TargetsEditor({ setId, initial }: { setId: string; initial: TargetCounts }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState<number>(initial.total ?? 0);
  // per-type total (the default, scannable view). Seeded from the sum of each
  // type's initial brigade cells.
  const [perType, setPerType] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    for (const t of CARD_TYPES) seed[t] = rowSum(initial.cells?.[t]);
    return seed;
  });
  // Per-brigade detail, only edited when "Advanced" is on.
  const [cells, setCells] = useState<Record<string, Record<string, number>>>(initial.cells ?? {});
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setCell = (type: string, brigade: string, value: number) =>
    setCells((c) => ({ ...c, [type]: { ...(c[type] ?? {}), [brigade]: value } }));

  // Per-type running grand total: in advanced mode the brigade cells are the
  // source of truth for a type; otherwise the per-type input is.
  const typeTotal = (t: string) => (advanced ? rowSum(cells[t]) : perType[t] ?? 0);
  const grandTotal = useMemo(
    () => CARD_TYPES.reduce((sum, t) => sum + typeTotal(t), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perType, cells, advanced],
  );

  async function save() {
    setBusy(true);
    setError(null);
    // Build the cells payload. A type that has real per-brigade detail keeps it
    // (pruned to positive values, preserving the heatmap shape); a type edited
    // only at the per-type level is written under its "none" bucket.
    const out: Record<string, Record<string, number>> = {};
    for (const t of CARD_TYPES) {
      const detail = cells[t] ?? {};
      const detailSum = rowSum(detail);
      if (detailSum > 0) {
        const pruned: Record<string, number> = {};
        for (const [b, v] of Object.entries(detail)) if (v > 0) pruned[b] = v;
        out[t] = pruned;
      } else if ((perType[t] ?? 0) > 0) {
        out[t] = { none: perType[t] };
      }
    }
    const r = await saveSetTargets(setId, { total: total || undefined, cells: out });
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(r.error ?? "Could not save targets");
    }
  }

  const populated = (initial.total ?? 0) > 0 || Object.keys(initial.cells ?? {}).length > 0;
  const triggerLabel = populated
    ? `Edit targets (${grandTotal} / ${total || "—"})`
    : "Set targets";

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Targets</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Per-type total: {grandTotal}
              {total ? ` / ${total}` : ""}
            </p>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <span className="font-medium">Total target</span>
              <input
                type="number"
                min={0}
                value={total}
                onChange={(e) => setTotal(Number(e.target.value))}
                aria-label="Total target"
                className={`${inputClass} w-24`}
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={advanced}
                onChange={(e) => setAdvanced(e.target.checked)}
              />
              Advanced: per-brigade breakdown
            </label>

            <ul className="divide-y divide-border">
              {CARD_TYPES.map((t) => (
                <li key={t} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{typeLabel(t)}</span>
                    {advanced ? (
                      <span className="text-xs text-muted-foreground">{typeTotal(t)}</span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        value={perType[t] ?? 0}
                        onChange={(e) =>
                          setPerType((p) => ({ ...p, [t]: Number(e.target.value) }))
                        }
                        aria-label={`${typeLabel(t)} total`}
                        className={`${inputClass} w-20`}
                      />
                    )}
                  </div>
                  {advanced && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {BRIGADES.map((b) => (
                        <label key={b} className="flex items-center gap-1 text-xs text-muted-foreground">
                          {brigadeLabel(b)}
                          <input
                            type="number"
                            min={0}
                            value={cells[t]?.[b] ?? 0}
                            onChange={(e) => setCell(t, b, Number(e.target.value))}
                            aria-label={`${typeLabel(t)} ${brigadeLabel(b)}`}
                            className="w-14 rounded-md border border-input bg-background px-1 py-0.5 text-xs"
                          />
                        </label>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </DialogBody>

          <DialogFooter className="justify-end">
            <Button variant="cancel" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="success" disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save targets"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
