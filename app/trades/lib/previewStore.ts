// PREVIEW-ONLY — delete this file once migration 119 (trade tables) is live.
//
// Until the tables exist, the editor and trade log save to this browser and the
// public page shows the owner's browser copy, or sample cards for anyone else. It lets the
// look be reviewed on a Vercel preview without touching the database.

import type { DisplayTradeItem } from "./tradeList";
import type { TradeLogEntry } from "./tradeLog";

const STORAGE_KEY = "lor-trade-list-preview";

export function readPreviewItems(): DisplayTradeItem[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writePreviewItems(items: DisplayTradeItem[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage blocked (private window etc.) — preview just won't persist.
  }
}

const LOG_STORAGE_KEY = "lor-trade-log-preview";

export function readPreviewLog(): TradeLogEntry[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOG_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writePreviewLog(entries: TradeLogEntry[]): void {
  try {
    window.localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage blocked — preview just won't persist.
  }
}
