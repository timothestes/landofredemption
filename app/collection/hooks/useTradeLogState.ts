"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteTradeLogAction, loadTradeLogAction, logTradeAction } from "../../trades/actions";
import type { TradeLogCard, TradeLogEntry } from "../../trades/lib/tradeLog";
import { readPreviewLog, writePreviewLog } from "../../trades/lib/previewStore";

export interface NewTrade {
  tradedOn: string;
  partner: string;
  notes: string;
  cards: TradeLogCard[];
}

/**
 * The user's private trade log. `previewMode` is true until the trade tables
 * exist; entries then live in this browser and the collection is NOT changed.
 */
export function useTradeLogState() {
  const [entries, setEntries] = useState<TradeLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [previewMode, setPreviewMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTradeLogAction().then((result) => {
      if (cancelled) return;
      if (!result.success) setError(result.error || "Failed to load trade log");
      else {
        setPreviewMode(!!result.previewMode);
        setEntries(result.previewMode ? readPreviewLog() : result.entries);
      }
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Saves a trade. Outside preview mode this also updates the collection server-side. */
  const logTrade = useCallback(
    async (trade: NewTrade): Promise<{ success: boolean; error?: string }> => {
      if (previewMode) {
        const entry: TradeLogEntry = {
          ...trade,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        };
        const next = [entry, ...entries].sort((a, b) => b.tradedOn.localeCompare(a.tradedOn));
        setEntries(next);
        writePreviewLog(next);
        return { success: true };
      }
      const result = await logTradeAction(trade);
      if (result.entry) {
        const entry = result.entry;
        setEntries((prev) => [entry, ...prev].sort((a, b) => b.tradedOn.localeCompare(a.tradedOn)));
      }
      return { success: result.success, error: result.error };
    },
    [previewMode, entries]
  );

  const deleteEntry = useCallback(
    async (id: string) => {
      const next = entries.filter((e) => e.id !== id);
      if (previewMode) {
        setEntries(next);
        writePreviewLog(next);
        return;
      }
      const result = await deleteTradeLogAction(id);
      if (result.success) setEntries(next);
      else setError(result.error || "Failed to delete trade");
    },
    [previewMode, entries]
  );

  return { entries, isLoading, previewMode, error, logTrade, deleteEntry };
}
