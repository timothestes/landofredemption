import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { BuyDeckCard } from "./BuyDeckModal";
import { computeMissingCards } from "../utils/collectionCheck";
import { addWantsAction } from "../../../trades/actions";
import type { TradeItem } from "../../../trades/lib/tradeList";

interface CollectionCheckModalProps {
  /** Full deck (any zones); only main+reserve are counted. */
  cards: BuyDeckCard[];
  /** Owned copies keyed by card name (any printing). */
  ownedByName: Record<string, number>;
  /** True once the collection has loaded successfully. */
  collectionAvailable: boolean;
  /** Non-null if the collection failed to load. */
  collectionSyncError: string | null;
  onClose: () => void;
  /** Hand the missing cards to the buy flow. Parent closes this modal first. */
  onBuyMissing: (missing: BuyDeckCard[]) => void;
}

const ZONE_LABELS: Record<string, string> = { main: "Main Deck", reserve: "Reserve" };

export default function CollectionCheckModal({
  cards,
  ownedByName,
  collectionAvailable,
  collectionSyncError,
  onClose,
  onBuyMissing,
}: CollectionCheckModalProps) {
  const { missing, ownedCount, totalCount } = useMemo(
    () => computeMissingCards(cards, ownedByName),
    [cards, ownedByName]
  );
  const missingCount = missing.reduce((sum, c) => sum + c.quantity, 0);

  // "Add missing to my Wants": any printing, since this check matches by name.
  const [wantsStatus, setWantsStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [wantsMessage, setWantsMessage] = useState("");
  const addMissingToWants = async () => {
    const totals = new Map<string, TradeItem>();
    for (const c of missing) {
      const [cardName, cardSet, cardImgFile] = c.card_key.split("|");
      const existing = totals.get(cardName);
      if (existing) existing.quantity += c.quantity;
      else
        totals.set(cardName, {
          kind: "want",
          cardName,
          cardSet: cardSet ?? "",
          cardImgFile: cardImgFile ?? "",
          anyVersion: true,
          priority: false,
          quantity: c.quantity,
          note: "",
        });
    }
    const incoming = Array.from(totals.values());
    setWantsStatus("saving");
    const result = await addWantsAction(incoming).catch(() => ({ success: false as const, error: undefined, added: 0 }));
    if (!result.success) {
      setWantsStatus("error");
      setWantsMessage(result.error || "Couldn't add to your Wants");
      return;
    }
    const added = result.added ?? 0;
    setWantsStatus("done");
    setWantsMessage(
      added === 0 ? "Already on your Wants." : `Added ${added} card${added === 1 ? "" : "s"} to your Wants.`
    );
  };

  // Group missing entries by zone, preserving main-before-reserve order.
  const groups = useMemo(() => {
    const byZone: Record<string, BuyDeckCard[]> = {};
    for (const c of missing) (byZone[c.zone] ??= []).push(c);
    return (["main", "reserve"] as const)
      .filter((z) => byZone[z]?.length)
      .map((z) => ({ zone: z, label: ZONE_LABELS[z], cards: byZone[z] }));
  }, [missing]);

  // Lock body scroll while open
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = original; };
  }, []);

  // Swipe-to-dismiss (mobile bottom sheet) — mirrors BuyDeckModal
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef<number | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
  }, []);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const dy = e.touches[0].clientY - dragStartY.current;
    if (dy > 0) setDragY(dy);
  }, []);
  const handleTouchEnd = useCallback(() => {
    if (dragY > 100) onClose();
    else setDragY(0);
    dragStartY.current = null;
  }, [dragY, onClose]);

  const loadFailed = !collectionAvailable && collectionSyncError !== null;
  const stillLoading = !collectionAvailable && !loadFailed;
  const ownsEverything = collectionAvailable && missing.length === 0;

  return (
    <>
      {/* Backdrop — above BuyDeckModal's z-[60] so this sits on top if both ever render */}
      <div className="fixed inset-0 z-[62] bg-black/50" onClick={onClose} />

      <div
        className="fixed inset-x-0 bottom-0 z-[63] max-h-[85vh] flex flex-col bg-card rounded-t-xl shadow-2xl border border-border md:inset-x-auto md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:mx-auto md:max-w-md md:rounded-xl md:max-h-[80vh] md:inset-x-4 lg:inset-x-0"
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: dragStartY.current !== null ? "none" : "transform 0.2s ease-out" } : undefined}
      >
        {/* Mobile drag handle */}
        <div
          className="flex justify-center pt-2 pb-0 md:hidden cursor-grab active:cursor-grabbing"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1 rounded-full bg-muted-foreground/40" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Check my collection</h3>
          <button onClick={onClose} className="p-1 rounded-md text-muted-foreground hover:text-foreground">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Summary */}
        {collectionAvailable && (
          <div className="px-4 pt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">
                You own{" "}
                <span className="font-semibold text-foreground">{ownedCount}</span>
                {" / "}
                <span className="font-semibold text-foreground">{totalCount}</span>
              </span>
              {missingCount > 0 && (
                <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                  Missing {missingCount}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="px-4 py-3 overflow-y-auto flex-1 min-h-0">
          {stillLoading && (
            <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Checking your collection…
            </div>
          )}

          {loadFailed && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Couldn&apos;t load your collection. Track your cards on the{" "}
              <a href="/collection" className="underline">My Collection</a> page and try again.
            </div>
          )}

          {ownsEverything && (
            <div className="py-8 text-center">
              <div className="text-2xl mb-1">✓</div>
              <p className="text-sm font-medium text-foreground">You own every card in this deck.</p>
              <p className="text-xs text-muted-foreground mt-1">Nothing missing from your collection.</p>
            </div>
          )}

          {collectionAvailable && missing.length > 0 && (
            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group.zone}>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide pb-1">
                    {group.label} ({group.cards.reduce((s, c) => s + c.quantity, 0)})
                  </div>
                  <div className="-mx-1 px-1">
                    {group.cards.map((card, i) => (
                      <div key={`${card.card_key}-${i}`} className="flex items-center justify-between py-1 min-h-[28px]">
                        <span className="text-xs text-foreground truncate">{card.card_name}</span>
                        {card.quantity > 1 && (
                          <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">×{card.quantity}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border flex-shrink-0">
          {collectionAvailable && missing.length > 0 ? (
            <>
              <button
                onClick={() => onBuyMissing(missing)}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                </svg>
                Buy missing on YTG
              </button>
              {wantsStatus === "done" ? (
                <p
                  className={`mt-2 text-sm text-center ${
                    "text-foreground"
                  }`}
                >
                  {wantsMessage}{" "}
                  {wantsStatus === "done" && (
                    <a href="/collection?view=trades" className="font-medium text-primary hover:underline">
                      View trade list
                    </a>
                  )}
                </p>
              ) : (
                <>
                {wantsStatus === "error" && (
                  <p className="mt-2 text-sm text-center text-red-600 dark:text-red-400">{wantsMessage}</p>
                )}
                <button
                  onClick={addMissingToWants}
                  disabled={wantsStatus === "saving"}
                  className="mt-2 w-full py-2.5 rounded-lg border border-border hover:bg-muted text-foreground text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  {wantsStatus === "saving" ? "Adding…" : wantsStatus === "error" ? "Try again" : "Add missing to my Wants"}
                </button>
                </>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground text-center">
                Matching by card name only — any printing you own counts as covered.
              </p>
            </>
          ) : (
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-sm font-semibold transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </>
  );
}
