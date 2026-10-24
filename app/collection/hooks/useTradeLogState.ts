"use client";

import { useCallback, useEffect, useState } from "react";
import { deleteTradeLogAction, loadTradeLogAction, logTradeAction } from "../../trades/actions";
import type { TradeLogCard, TradeLogEntry } from "../../trades/lib/tradeLog";

export interface NewTrade {
  tradedOn: string;
  partner: string;
  notes: string;
  cards: TradeLogCard[];
}

/** The user's private trade log. Logging a trade also updates the collection server-side. */
export function useTradeLogState() {
  const [entries, setEntries] = useState<TradeLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTradeLogAction().then((result) => {
      if (cancelled) return;
      if (!result.success) setError(result.error || "Failed to load trade log");
      else setEntries(result.entries);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const logTrade = useCallback(
    async (trade: NewTrade): Promise<{ success: boolean; error?: string }> => {
      const result = await logTradeAction(trade);
      if (result.entry) {
        const entry = result.entry;
        setEntries((prev) => [entry, ...prev].sort((a, b) => b.tradedOn.localeCompare(a.tradedOn)));
      }
      return { success: result.success, error: result.error };
    },
    []
  );

  const deleteEntry = useCallback(
    async (id: string) => {
      const result = await deleteTradeLogAction(id);
      if (result.success) setEntries((prev) => prev.filter((e) => e.id !== id));
      else setError(result.error || "Failed to delete trade");
    },
    []
  );

  return { entries, isLoading, error, logTrade, deleteEntry };
}
