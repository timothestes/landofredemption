"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * App-wide "show prices" preference, shared between the deck builder and the
 * collection page. Backed by a single localStorage key and synced live across
 * components in the same tab (custom event) and across tabs (storage event).
 */
const KEY = "show-prices";
const EVENT = "show-prices-change";

// One-time migration: seed the unified key from the older per-feature keys so
// existing users keep their preference.
if (typeof window !== "undefined" && localStorage.getItem(KEY) === null) {
  const legacy =
    localStorage.getItem("deck-show-prices") === "true" ||
    localStorage.getItem("collection-show-prices") === "1";
  if (legacy) localStorage.setItem(KEY, "true");
}

// null until the player chooses, so a page can pick its own default.
function getSnapshot(): string | null {
  return localStorage.getItem(KEY);
}

// Server render and first client render agree → no hydration mismatch.
function getServerSnapshot(): string | null {
  return null;
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/** defaultValue applies until the player has set the preference anywhere. */
export function useShowPrices(defaultValue = false): [boolean, (value: boolean) => void] {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const showPrices = stored === null ? defaultValue : stored === "true";
  const setShowPrices = useCallback((value: boolean) => {
    localStorage.setItem(KEY, String(value));
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [showPrices, setShowPrices];
}
