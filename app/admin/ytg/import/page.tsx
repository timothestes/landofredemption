"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent } from "@/components/ui/dialog";

// Mirrors lib/shopify/importSet.ts. Inlined (not imported) because that
// module pulls server-only deps (Supabase admin client, Shopify token) into
// the client bundle.
interface CardPlan {
  cardKey: string;
  cardName: string;
  title: string;
  handle: string;
  sku: string;
  tags: string[];
  imageUrl: string | null;
  plannedAction: "create" | "update" | "skip-existing";
  warnings: string[];
}

interface ImportResultRow {
  cardKey: string;
  action: "created" | "updated" | "skipped" | "error";
  productId: string | null;
  error: string | null;
  mock: boolean;
}

interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  reconciled: boolean;
  mock: boolean;
}

type RowState = { include: boolean; price: string; titleOverride: string };

const PRICE_INPUT_RE = /^\d*\.?\d{0,2}$/;

// The input allows in-progress values like ".5" or "5." that the server's
// stricter regex rejects — normalize those to "0.50" / "5.00" before POST.
function normalizePriceEntry(value: string): string {
  if (!value || (!value.startsWith(".") && !value.endsWith("."))) return value;
  const n = Number(value);
  return Number.isNaN(n) ? value : n.toFixed(2);
}

function actionBadgeClass(action: CardPlan["plannedAction"] | ImportResultRow["action"]) {
  switch (action) {
    case "update":
    case "updated":
      return "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300";
    case "skip-existing":
    case "skipped":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300";
    case "error":
      return "bg-destructive/10 text-destructive";
    default:
      return "bg-muted text-foreground";
  }
}

function planStatusLabel(action: CardPlan["plannedAction"]): string {
  switch (action) {
    case "create":
      return "New";
    case "update":
      return "Update existing";
    case "skip-existing":
      return "Already in store";
  }
}

function resultStatusLabel(action: ImportResultRow["action"]): string {
  switch (action) {
    case "created":
      return "Created";
    case "updated":
      return "Updated";
    case "skipped":
      return "Skipped";
    case "error":
      return "Error";
  }
}

// Humanizes plan-time warning codes for display under the title.
// ('no-price' never appears at plan time — filtered out in planCard.)
function humanizeWarning(code: string): string {
  if (code === "no-image") return "No card image — imports without an image";
  if (code === "no-set-alias") return "No set alias — set code used in title";
  if (code.startsWith("brigade-unmapped:")) return `Unmapped brigade: ${code.slice("brigade-unmapped:".length)}`;
  if (code.startsWith("type-unmapped:")) return `Unmapped type: ${code.slice("type-unmapped:".length)}`;
  return code;
}

// Best-effort summary of what the import is about to do. Uses plannedAction
// (computed before the run) rather than re-deriving server-side rescue
// logic (e.g. a titleOverride rescuing a skip-existing row) — close enough
// for a confirmation prompt, not a substitute for the results table.
function confirmImportIntro(createCount: number, updateCount: number, includedCount: number): string {
  if (createCount > 0 && updateCount > 0) {
    return `You're about to create ${createCount} and update ${updateCount} products in the Your Turn Games Shopify store.`;
  }
  if (updateCount > 0 && createCount === 0) {
    return `You're about to update ${updateCount} product${updateCount === 1 ? "" : "s"} in the Your Turn Games Shopify store.`;
  }
  return `You're about to create ${includedCount} product${includedCount === 1 ? "" : "s"} in the Your Turn Games Shopify store.`;
}

export default function AdminImportSetPage() {

  const [sets, setSets] = useState<{ code: string; name: string; count: number }[]>([]);
  const [setCode, setSetCode] = useState("");
  const [setSearch, setSetSearch] = useState("");
  const [setPickerOpen, setSetPickerOpen] = useState(false);
  const [activeSetIndex, setActiveSetIndex] = useState(-1);
  const setPickerRef = useRef<HTMLDivElement>(null);
  const [plans, setPlans] = useState<CardPlan[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [active, setActive] = useState(false);
  const [defaultPrice, setDefaultPrice] = useState("");
  const [running, setRunning] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [results, setResults] = useState<ImportResultRow[] | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [dryRunMsg, setDryRunMsg] = useState("");
  const [error, setError] = useState("");
  const [loadingSets, setLoadingSets] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(false);
  // Guards against a stale `GET ?set=A` response landing after the admin has
  // already switched to set B — without this, A's plans could get applied
  // while setCode reads B, and a subsequent POST would write the wrong set.
  const fetchSeq = useRef(0);

  useEffect(() => {
    const loadSets = async () => {
      setLoadingSets(true);
      try {
        const res = await fetch("/api/admin/import-set");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load sets");
        setSets(data.sets);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load sets");
      } finally {
        setLoadingSets(false);
      }
    };
    loadSets();
  }, []);

  const handleSetChange = async (code: string) => {
    const seq = ++fetchSeq.current;
    setSetCode(code);
    setResults(null);
    setSummary(null);
    setDryRunMsg("");
    setError("");
    setPlans([]);
    setRows({});
    if (!code) return;

    setLoadingPlans(true);
    try {
      const res = await fetch(`/api/admin/import-set?set=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (seq !== fetchSeq.current) return; // a newer set was picked while this request was in flight
      if (!res.ok) throw new Error(data.error || "Failed to load plans");
      const newPlans = data.plans as CardPlan[];
      setPlans(newPlans);
      const nextRows: Record<string, RowState> = {};
      for (const p of newPlans) {
        nextRows[p.cardKey] = { include: p.plannedAction === "create", price: "", titleOverride: "" };
      }
      setRows(nextRows);
    } catch (err) {
      if (seq !== fetchSeq.current) return;
      setError(err instanceof Error ? err.message : "Failed to load plans");
    } finally {
      if (seq === fetchSeq.current) setLoadingPlans(false);
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (setPickerRef.current && !setPickerRef.current.contains(e.target as Node)) {
        setSetPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredSets = useMemo(() => {
    const q = setSearch.trim().toLowerCase();
    if (!q) return sets;
    return sets.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
  }, [sets, setSearch]);

  const handleSelectSet = (s: { code: string; name: string; count: number }) => {
    setSetSearch(`${s.name} (${s.code})`);
    setSetPickerOpen(false);
    setActiveSetIndex(-1);
    handleSetChange(s.code);
  };

  const handleSetPickerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!setPickerOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveSetIndex((prev) => Math.min(prev + 1, filteredSets.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveSetIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      if (activeSetIndex >= 0 && activeSetIndex < filteredSets.length) {
        e.preventDefault();
        handleSelectSet(filteredSets[activeSetIndex]);
      }
    } else if (e.key === "Escape") {
      setSetPickerOpen(false);
    }
  };

  const updateRow = (cardKey: string, patch: Partial<RowState>) => {
    setRows((prev) => ({ ...prev, [cardKey]: { ...prev[cardKey], ...patch } }));
  };

  const handlePriceChange = (cardKey: string, value: string) => {
    if (!PRICE_INPUT_RE.test(value)) return;
    updateRow(cardKey, { price: value });
  };

  const handleDefaultPriceChange = (value: string) => {
    if (!PRICE_INPUT_RE.test(value)) return;
    setDefaultPrice(value);
  };

  const applyToBlankRows = () => {
    if (!defaultPrice.trim()) return;
    setRows((prev) => {
      const next = { ...prev };
      for (const p of plans) {
        const row = next[p.cardKey];
        if (row?.include && !row.price.trim()) {
          next[p.cardKey] = { ...row, price: defaultPrice };
        }
      }
      return next;
    });
  };

  const setAllPrices = () => {
    if (!defaultPrice.trim()) return;
    setRows((prev) => {
      const next = { ...prev };
      for (const p of plans) {
        const row = next[p.cardKey];
        if (row?.include) {
          next[p.cardKey] = { ...row, price: defaultPrice };
        }
      }
      return next;
    });
  };

  const setIncludeForAll = (include: boolean) => {
    setRows((prev) => {
      const next = { ...prev };
      for (const p of plans) {
        const row = next[p.cardKey];
        if (!row) continue;
        // Include-all leaves skip-existing rows out (same rule as the initial defaults);
        // they can still be opted in per-row.
        if (include && p.plannedAction === "skip-existing") continue;
        next[p.cardKey] = { ...row, include };
      }
      return next;
    });
  };

  const includedCount = plans.filter((p) => rows[p.cardKey]?.include).length;
  const blankPriceCount = plans.filter((p) => rows[p.cardKey]?.include && !rows[p.cardKey].price.trim()).length;
  const finalBlankCount = plans.filter(
    (p) => rows[p.cardKey]?.include && !rows[p.cardKey].price.trim() && !defaultPrice.trim(),
  ).length;
  const createCount = plans.filter((p) => rows[p.cardKey]?.include && p.plannedAction === "create").length;
  const updateCount = plans.filter((p) => rows[p.cardKey]?.include && p.plannedAction === "update").length;

  useEffect(() => {
    if (!confirmOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !running) setConfirmOpen(false);
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [confirmOpen, running]);

  const buildCardsPayload = () =>
    plans.map((p) => {
      const rawPrice = rows[p.cardKey].price.trim() || defaultPrice.trim() || null;
      return {
        cardKey: p.cardKey,
        price: rawPrice !== null ? normalizePriceEntry(rawPrice) : null,
        include: rows[p.cardKey].include,
        titleOverride: rows[p.cardKey].titleOverride.trim() || undefined,
      };
    });

  const handleDryRun = async () => {
    setRunning(true);
    setError("");
    setDryRunMsg("");
    setResults(null);
    setSummary(null);
    try {
      const res = await fetch("/api/admin/import-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setCode,
          status: active ? "ACTIVE" : "DRAFT",
          dryRun: true,
          cards: buildCardsPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Dry run failed");
      setPlans(data.plans);
      setDryRunMsg(`Dry run OK — ${includedCount} cards planned, no writes`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dry run failed");
    } finally {
      setRunning(false);
    }
  };

  const runImport = async () => {
    const statusLabel = active ? "ACTIVE" : "DRAFT";
    setConfirmOpen(false);
    setRunning(true);
    setError("");
    setDryRunMsg("");
    setResults(null);
    setSummary(null);
    try {
      const res = await fetch("/api/admin/import-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setCode,
          status: statusLabel,
          cards: buildCardsPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResults(data.results);
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <div>
        <div>
          <h2 className="text-xl font-semibold mb-2">Import Set to Shopify</h2>
          <p className="text-muted-foreground mb-6">
            Preview card products for a set, adjust prices, then publish to the store.
          </p>

          {error && (
            <div className="mb-4 px-4 py-2 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
          )}

          <div className="mb-6 max-w-md">
            <Label htmlFor="set-picker">Set</Label>
            <div ref={setPickerRef} className="relative mt-1">
              <Input
                id="set-picker"
                value={setSearch}
                onChange={(e) => {
                  setSetSearch(e.target.value);
                  setActiveSetIndex(-1);
                  setSetPickerOpen(true);
                }}
                onFocus={() => setSetPickerOpen(true)}
                onKeyDown={handleSetPickerKeyDown}
                placeholder="Search sets — e.g. Roots 2"
                disabled={loadingSets || loadingPlans || running}
                autoComplete="off"
              />
              {setPickerOpen && filteredSets.length > 0 && (
                <div className="absolute mt-1 w-full bg-card border rounded-lg shadow-lg max-h-72 overflow-y-auto z-10">
                  {filteredSets.map((s, i) => (
                    <button
                      key={s.code}
                      type="button"
                      onClick={() => handleSelectSet(s)}
                      className={`w-full text-left px-3 py-2 ${i === activeSetIndex ? "bg-muted" : ""}`}
                    >
                      <div className="text-sm">
                        {s.name} ({s.code})
                      </div>
                      <div className="text-xs text-muted-foreground">{s.count} cards</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {loadingPlans && <p className="text-muted-foreground mb-6">Loading cards…</p>}

          {plans.length > 0 && (
            <>
              <div className="bg-card border rounded-lg p-4 mb-6 flex flex-wrap items-end gap-4">
                <div>
                  <Label htmlFor="default-price">Default price</Label>
                  <Input
                    id="default-price"
                    inputMode="decimal"
                    value={defaultPrice}
                    onChange={(e) => handleDefaultPriceChange(e.target.value)}
                    placeholder="0.00"
                    className="mt-1 w-28"
                  />
                </div>
                <Button variant="outline" onClick={applyToBlankRows} disabled={!defaultPrice.trim()}>
                  Apply to blank rows
                </Button>
                <Button variant="outline" onClick={setAllPrices} disabled={!defaultPrice.trim()}>
                  Set ALL prices to {defaultPrice.trim() || "X"}
                </Button>
                <Button variant="outline" onClick={() => setIncludeForAll(true)}>
                  Include all
                </Button>
                <Button variant="outline" onClick={() => setIncludeForAll(false)}>
                  Include none
                </Button>
                <div className="text-sm text-muted-foreground ml-auto">
                  {includedCount} included · {blankPriceCount} with blank price
                </div>
              </div>

              <div className="mb-6">
                <div className="text-sm font-medium mb-2">Import as:</div>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="publish-status"
                      checked={!active}
                      onChange={() => setActive(false)}
                      className="w-4 h-4"
                    />
                    Draft — hidden until published in Shopify
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="publish-status"
                      checked={active}
                      onChange={() => setActive(true)}
                      className="w-4 h-4"
                    />
                    Active — live in the store immediately
                  </label>
                </div>
              </div>

              <div className="bg-card border rounded-lg overflow-hidden mb-6">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Import</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Image</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Card</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Shopify listing</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Tags</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Status</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {plans.map((plan) => {
                        const row = rows[plan.cardKey];
                        if (!row) return null;
                        return (
                          <tr key={plan.cardKey} className="hover:bg-muted/50">
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={row.include}
                                onChange={(e) => updateRow(plan.cardKey, { include: e.target.checked })}
                                aria-label={`Import ${plan.cardName}`}
                                className="w-4 h-4"
                              />
                            </td>
                            <td className="px-4 py-3">
                              {plan.imageUrl ? (
                                <img
                                  src={plan.imageUrl}
                                  alt={plan.cardName}
                                  className="h-14 w-10 object-contain"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="h-14 w-10 bg-muted flex items-center justify-center text-center text-[10px] leading-tight text-amber-600 dark:text-amber-400">
                                  no image
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm">{plan.cardName}</td>
                            <td className="px-4 py-3">
                              <div className="text-sm mb-1">{plan.title}</div>
                              <Input
                                value={row.titleOverride}
                                onChange={(e) => updateRow(plan.cardKey, { titleOverride: e.target.value })}
                                placeholder="Override title (optional)"
                                aria-label={`Title override for ${plan.cardName}`}
                                className="h-8 text-xs"
                              />
                              {plan.warnings.length > 0 && (
                                <div className="mt-1 space-y-0.5">
                                  {plan.warnings.map((w) => (
                                    <div key={w} className="text-xs text-amber-600 dark:text-amber-400">
                                      {humanizeWarning(w)}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{plan.tags.join(", ")}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${actionBadgeClass(plan.plannedAction)}`}
                              >
                                {planStatusLabel(plan.plannedAction)}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <Input
                                inputMode="decimal"
                                value={row.price}
                                onChange={(e) => handlePriceChange(plan.cardKey, e.target.value)}
                                placeholder="0.00"
                                aria-label={`Price for ${plan.cardName}`}
                                className="h-8 w-20 text-xs"
                              />
                              {!row.price.trim() && (
                                <div className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">blank</div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 mb-8">
                <Button variant="outline" onClick={handleDryRun} disabled={running}>
                  Dry run
                </Button>
                <Button onClick={() => setConfirmOpen(true)} disabled={running || includedCount === 0}>
                  Import {includedCount} card{includedCount === 1 ? "" : "s"}
                </Button>
                {running && <span className="text-sm text-muted-foreground">Working, please wait…</span>}
                {dryRunMsg && <span className="text-sm text-muted-foreground">{dryRunMsg}</span>}
              </div>
            </>
          )}

          {results && summary && (
            <div className="bg-card border rounded-lg overflow-hidden mb-8">
              {summary.mock && (
                <div className="px-4 py-2 bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300 text-sm">
                  MOCK MODE — no real Shopify writes
                </div>
              )}
              <div className="px-4 py-3 border-b text-sm">
                created {summary.created} · updated {summary.updated} · skipped {summary.skipped} · errors{" "}
                {summary.errors}
                {summary.reconciled && (
                  <span className="ml-2 text-muted-foreground">Price pipeline reconciled</span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-4 py-2 text-left text-sm font-semibold">Card key</th>
                      <th className="px-4 py-2 text-left text-sm font-semibold">Action</th>
                      <th className="px-4 py-2 text-left text-sm font-semibold">Product ID</th>
                      <th className="px-4 py-2 text-left text-sm font-semibold">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {results.map((r) => (
                      <tr key={r.cardKey} className="hover:bg-muted/50">
                        <td className="px-4 py-2 text-sm">{r.cardKey}</td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${actionBadgeClass(r.action)}`}
                          >
                            {resultStatusLabel(r.action)}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-sm text-muted-foreground">{r.productId ?? "—"}</td>
                        <td className="px-4 py-2 text-sm text-destructive">{r.error ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmOpen && (
        <Dialog
          open={true}
          onOpenChange={(o) => {
            if (!o && !running) setConfirmOpen(false);
          }}
        >
          <DialogContent className="p-6 max-w-md">
            <h2 className="text-xl font-semibold mb-3">Confirm import</h2>
            <div className="space-y-2 mb-6">
              <p className="text-sm">{confirmImportIntro(createCount, updateCount, includedCount)}</p>
              {active ? (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  As ACTIVE — these go live in the store immediately.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  As Drafts — hidden from shoppers until published in Shopify.
                </p>
              )}
              {finalBlankCount > 0 && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  {finalBlankCount} of them {finalBlankCount === 1 ? "has" : "have"} no price and will import at $0.00.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={running}>
                Cancel
              </Button>
              <Button onClick={runImport} disabled={running}>
                Import {includedCount} card{includedCount === 1 ? "" : "s"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
