"use client";

import React, { useMemo, useState } from "react";
import CardImage from "../../decklist/card-search/components/CardImage";
import type { Card } from "../../decklist/card-search/utils";
import { cardFullKey } from "../hooks/useCollectionState";
import type { NewTrade } from "../hooks/useTradeLogState";
import type { TradeItem } from "../../trades/lib/tradeList";
import {
  collectionDeltas,
  suggestTradeListUpdates,
  tradeSideValue,
  MAX_PARTNER_LENGTH,
  MAX_TRADE_LOG_NOTES_LENGTH,
  type TradeDirection,
  type TradeLogCard,
} from "../../trades/lib/tradeLog";

interface LogTradeModalProps {
  allCards: Card[];
  /** Owned quantities by name|set|imgFile. */
  quantities: Map<string, number>;
  tradeItems: TradeItem[];
  getPrice: (key: string) => { price: number } | null | undefined;
  onSave: (trade: NewTrade) => Promise<{ success: boolean; error?: string }>;
  /** Applies the trade-list updates the user ticked. */
  onApplyTradeListUpdates: (items: TradeItem[]) => void;
  onClose: () => void;
}

const LABEL = "text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";
const INPUT = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

function todayLocal(): string {
  // en-CA formats as YYYY-MM-DD in the viewer's own time zone.
  return new Date().toLocaleDateString("en-CA");
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function LogTradeModal({
  allCards,
  quantities,
  tradeItems,
  getPrice,
  onSave,
  onApplyTradeListUpdates,
  onClose,
}: LogTradeModalProps) {
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [tradedOn, setTradedOn] = useState(todayLocal);
  const [partner, setPartner] = useState("");
  const [notes, setNotes] = useState("");
  const [cards, setCards] = useState<TradeLogCard[]>([]);
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestions = useMemo(() => suggestTradeListUpdates(cards, tradeItems), [cards, tradeItems]);
  const deltas = useMemo(() => collectionDeltas(cards), [cards]);

  const addCard = (direction: TradeDirection, card: Card) => {
    setCards((prev) => {
      const i = prev.findIndex((c) => c.direction === direction && cardFullKey({ name: c.cardName, set: c.cardSet, imgFile: c.cardImgFile }) === cardFullKey(card));
      if (i >= 0) {
        return prev.map((c, j) => (j === i ? { ...c, quantity: Math.min(99, c.quantity + 1) } : c));
      }
      return [
        ...prev,
        {
          direction,
          cardName: card.name,
          cardSet: card.set,
          cardImgFile: card.imgFile,
          quantity: 1,
          // Snapshot today's price so the record keeps its value later.
          unitPrice: getPrice(cardFullKey(card))?.price ?? null,
        },
      ];
    });
  };

  const updateCard = (index: number, quantity: number) => {
    setCards((prev) =>
      quantity <= 0 ? prev.filter((_, j) => j !== index) : prev.map((c, j) => (j === index ? { ...c, quantity: Math.min(99, quantity) } : c))
    );
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    // A cleared date field means today, in the user's own time zone.
    const result = await onSave({ tradedOn: tradedOn || todayLocal(), partner, notes, cards });
    setSaving(false);
    if (!result.success) {
      setError(result.error || "Failed to log trade");
      return;
    }
    onApplyTradeListUpdates(
      suggestions.filter((_, i) => !unchecked.has(i)).map((s) => ({ ...s.item, quantity: s.newQuantity }))
    );
    onClose();
  };

  const gaveValue = tradeSideValue(cards, "gave");
  const receivedValue = tradeSideValue(cards, "received");

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 sm:p-4" onClick={onClose}>
      <div
        className="bg-background border border-border sm:rounded-xl w-full max-w-4xl flex flex-col max-h-full sm:max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Log a trade"
      >
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-border/60">
          <h2 className="text-lg font-semibold">{step === "edit" ? "Log a trade" : "Review trade"}</h2>
          <button onClick={onClose} className="p-2 -mr-2 text-muted-foreground hover:text-foreground" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-4">
          {step === "edit" ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3">
                <label className="block">
                  <span className={LABEL}>Date</span>
                  <input type="date" value={tradedOn} onChange={(e) => setTradedOn(e.target.value)} className={`${INPUT} mt-1`} />
                </label>
                <label className="block">
                  <span className={LABEL}>Traded with</span>
                  <input
                    type="text"
                    value={partner}
                    maxLength={MAX_PARTNER_LENGTH}
                    onChange={(e) => setPartner(e.target.value)}
                    placeholder="Name"
                    className={`${INPUT} mt-1`}
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-5">
                {(["gave", "received"] as const).map((direction) => (
                  <TradeSide
                    key={direction}
                    direction={direction}
                    cards={cards}
                    allCards={allCards}
                    quantities={quantities}
                    value={direction === "gave" ? gaveValue : receivedValue}
                    onAdd={(card) => addCard(direction, card)}
                    onUpdate={updateCard}
                  />
                ))}
              </div>

              <label className="block mt-5">
                <span className={LABEL}>Notes</span>
                <textarea
                  value={notes}
                  maxLength={MAX_TRADE_LOG_NOTES_LENGTH}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Condition, shipping, tracking number, anything worth remembering…"
                  className={`${INPUT} mt-1`}
                />
              </label>
            </>
          ) : (
            <ReviewStep
              cards={cards}
              deltas={deltas}
              quantities={quantities}
              suggestions={suggestions}
              unchecked={unchecked}
              onToggle={(i) =>
                setUnchecked((prev) => {
                  const next = new Set(prev);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                })
              }
            />
          )}
          {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 border-t border-border/60">
          <p className="text-xs text-muted-foreground tabular-nums">
            Gave {money(gaveValue.total)} · Received {money(receivedValue.total)}
            <span className="hidden sm:inline"> at YTG prices</span>
          </p>
          <div className="flex gap-2">
            {step === "edit" ? (
              <>
                <button onClick={onClose} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted">
                  Cancel
                </button>
                <button
                  onClick={() => setStep("review")}
                  disabled={cards.length === 0}
                  className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Review
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setStep("edit")} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted">
                  Back
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Log trade"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TradeSide({
  direction,
  cards,
  allCards,
  quantities,
  value,
  onAdd,
  onUpdate,
}: {
  direction: TradeDirection;
  cards: TradeLogCard[];
  allCards: Card[];
  quantities: Map<string, number>;
  value: { total: number; unpriced: number };
  onAdd: (card: Card) => void;
  onUpdate: (index: number, quantity: number) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const matches = allCards.filter((c) => c.name.toLowerCase().includes(q));
    // When giving, cards you own come first.
    if (direction === "gave") {
      matches.sort((a, b) => Number(quantities.has(cardFullKey(b))) - Number(quantities.has(cardFullKey(a))));
    }
    return matches.slice(0, 8);
  }, [query, allCards, direction, quantities]);

  const rows = cards.map((c, index) => ({ c, index })).filter(({ c }) => c.direction === direction);

  return (
    <section>
      <h3 className={`${LABEL} border-b border-border/60 pb-1.5 flex justify-between`}>
        <span>{direction === "gave" ? "You gave" : "You received"}</span>
        <span className="tabular-nums normal-case tracking-normal">
          {money(value.total)}
          {value.unpriced > 0 && ` + ${value.unpriced} unpriced`}
        </span>
      </h3>
      <div className="relative mt-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Add a card…"
          aria-label={direction === "gave" ? "Add a card you gave" : "Add a card you received"}
          className={INPUT}
        />
        {results.length > 0 && (
          <ul className="absolute z-10 left-0 right-0 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg py-1">
            {results.map((card) => {
              const owned = quantities.get(cardFullKey(card)) || 0;
              return (
                <li key={card.dataLine}>
                  <button
                    onClick={() => {
                      onAdd(card);
                      setQuery("");
                    }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted"
                  >
                    <div className="w-8 shrink-0">
                      <CardImage imgFile={card.imgFile} alt="" sizes="32px" />
                    </div>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm truncate">{card.name}</span>
                      <span className="block text-xs text-muted-foreground truncate">{card.officialSet || card.set}</span>
                    </span>
                    {owned > 0 && <span className="text-xs text-muted-foreground tabular-nums shrink-0">own {owned}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3">No cards yet.</p>
      ) : (
        <ul className="divide-y divide-border/60 mt-1">
          {rows.map(({ c, index }) => (
            <li key={index} className="flex items-center gap-2 py-2">
              <div className="w-9 shrink-0">
                <CardImage imgFile={c.cardImgFile} alt={c.cardName} sizes="36px" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{c.cardName}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {c.unitPrice != null ? `${money(c.unitPrice)} ea` : "No price"}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => onUpdate(index, c.quantity - 1)} className="w-9 h-9 text-base border border-border rounded-md hover:bg-muted" aria-label={`One fewer ${c.cardName}`}>
                  −
                </button>
                <span className="w-6 text-center text-sm font-semibold tabular-nums">{c.quantity}</span>
                <button onClick={() => onUpdate(index, c.quantity + 1)} className="w-9 h-9 text-base border border-border rounded-md hover:bg-muted" aria-label={`One more ${c.cardName}`}>
                  +
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReviewStep({
  cards,
  deltas,
  quantities,
  suggestions,
  unchecked,
  onToggle,
}: {
  cards: TradeLogCard[];
  deltas: Map<string, number>;
  quantities: Map<string, number>;
  suggestions: ReturnType<typeof suggestTradeListUpdates>;
  unchecked: Set<number>;
  onToggle: (index: number) => void;
}) {
  const nameOf = (key: string) => cards.find((c) => `${c.cardName}|${c.cardSet}|${c.cardImgFile}` === key);
  return (
    <div className="space-y-6">
      <section>
        <h3 className={`${LABEL} border-b border-border/60 pb-1.5`}>Your collection</h3>
        {deltas.size === 0 ? (
          <p className="text-sm text-muted-foreground py-2">No change (cards given and received cancel out).</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {Array.from(deltas).map(([key, delta]) => {
              const c = nameOf(key);
              const owned = quantities.get(key) || 0;
              return (
                <li key={key} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {c?.cardName} <span className="text-muted-foreground">· {c?.cardSet}</span>
                  </span>
                  <span className="tabular-nums shrink-0">
                    <span className={delta > 0 ? "text-primary" : "text-red-600 dark:text-red-400"}>
                      {delta > 0 ? `+${delta}` : delta}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}({owned} → {Math.max(0, owned + delta)})
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {suggestions.length > 0 && (
        <section>
          <h3 className={`${LABEL} border-b border-border/60 pb-1.5`}>Update your trade list too?</h3>
          <ul className="divide-y divide-border/60">
            {suggestions.map((s, i) => (
              <li key={i}>
                <label className="flex items-center gap-3 py-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={!unchecked.has(i)} onChange={() => onToggle(i)} className="rounded border-border" />
                  <span className="flex-1 min-w-0 truncate">
                    {s.item.cardName}{" "}
                    <span className="text-muted-foreground">
                      · {s.item.kind === "want" ? "Want" : "Have"} {s.item.quantity} →{" "}
                      {s.newQuantity === 0 ? "remove" : s.newQuantity}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">{s.reason}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
