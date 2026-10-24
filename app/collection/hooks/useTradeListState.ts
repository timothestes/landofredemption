"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Card } from "../../decklist/card-search/utils";
import {
  loadMyTradeListAction,
  saveTradeItemAction,
  setTradeListSharedAction,
} from "../../trades/actions";
import {
  keyOfItem,
  normalizeTradeItem,
  tradeItemKey,
  type TradeItem,
  type TradeKind,
} from "../../trades/lib/tradeList";
import { readPreviewItems, writePreviewItems } from "../../trades/lib/previewStore";

const PERSIST_DEBOUNCE_MS = 600;

/**
 * Client state for the user's trade list (Wants + Haves): a Map of
 * kind|fullKey -> item with optimistic updates and per-item debounced
 * persistence, mirroring useCollectionState.
 *
 * `previewMode` is true until the trade tables exist; edits then live in
 * this browser only (see trades/lib/previewStore.ts).
 */
export function useTradeListState() {
  const [items, setItems] = useState<Map<string, TradeItem>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [previewMode, setPreviewMode] = useState(false);
  const [isShared, setIsShared] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [pendingSaves, setPendingSaves] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const latestRef = useRef<Map<string, TradeItem>>(new Map());

  useEffect(() => {
    let cancelled = false;
    loadMyTradeListAction().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setSyncError(result.error || "Failed to load trade list");
      } else {
        const source = result.previewMode ? readPreviewItems() ?? [] : result.items;
        setItems(new Map(source.map((i) => [keyOfItem(i), i])));
        setPreviewMode(!!result.previewMode);
        setIsShared(result.isShared);
        setUsername(result.username);
      }
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);

  // Preview mode: mirror every change into this browser's storage.
  useEffect(() => {
    if (previewMode && !isLoading) writePreviewItems(Array.from(items.values()));
  }, [previewMode, isLoading, items]);

  const persist = useCallback(async (key: string) => {
    const item = latestRef.current.get(key);
    if (!item) return;
    latestRef.current.delete(key);
    setPendingSaves((n) => n + 1);
    const result = await saveTradeItemAction(item);
    setPendingSaves((n) => n - 1);
    if (!result.success) setSyncError(result.error || "Failed to save change");
  }, []);

  /** Writes an item (quantity 0 removes it). */
  const putItem = useCallback(
    (raw: TradeItem) => {
      const item = normalizeTradeItem(raw);
      const key = keyOfItem(item);
      setItems((prev) => {
        const next = new Map(prev);
        if (item.quantity === 0) next.delete(key);
        else next.set(key, item);
        return next;
      });
      if (previewMode) return;
      latestRef.current.set(key, item);
      const existing = timersRef.current.get(key);
      if (existing) clearTimeout(existing);
      timersRef.current.set(
        key,
        setTimeout(() => {
          timersRef.current.delete(key);
          persist(key);
        }, PERSIST_DEBOUNCE_MS)
      );
    },
    [previewMode, persist]
  );

  const getItem = useCallback(
    (kind: TradeKind, card: Pick<Card, "name" | "set" | "imgFile">) =>
      items.get(tradeItemKey(kind, card)),
    [items]
  );

  /** Adds the card to Wants/Haves, or removes it if already there. */
  const toggleCard = useCallback(
    (kind: TradeKind, card: Card) => {
      const existing = items.get(tradeItemKey(kind, card));
      putItem(
        existing
          ? { ...existing, quantity: 0 }
          : {
              kind,
              cardName: card.name,
              cardSet: card.set,
              cardImgFile: card.imgFile,
              anyVersion: false,
              quantity: 1,
              note: "",
            }
      );
    },
    [items, putItem]
  );

  /** Returns `needsUsername` so the caller can prompt for one. */
  const setShared = useCallback(
    async (next: boolean) => {
      if (previewMode) {
        if (next && !username) return { needsUsername: true };
        setIsShared(next);
        return {};
      }
      const result = await setTradeListSharedAction(next);
      if (result.success) setIsShared(next);
      else if (!("needsUsername" in result)) setSyncError(result.error || "Failed to update sharing");
      return { needsUsername: "needsUsername" in result && !!result.needsUsername };
    },
    [previewMode, username]
  );

  return {
    items,
    isLoading,
    previewMode,
    isShared,
    username,
    setUsername,
    isSaving: pendingSaves > 0,
    syncError,
    putItem,
    getItem,
    toggleCard,
    setShared,
  };
}
