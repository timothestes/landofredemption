// PREVIEW-ONLY — delete this file once migration 119 (trade tables) is live.
//
// Until the tables exist, the editor saves to this browser and the public page
// shows the owner's browser copy, or sample cards for anyone else. It lets the
// look be reviewed on a Vercel preview without touching the database.

import type { TradeItem } from "./tradeList";

const STORAGE_KEY = "lor-trade-list-preview";

export function readPreviewItems(): TradeItem[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writePreviewItems(items: TradeItem[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage blocked (private window etc.) — preview just won't persist.
  }
}
