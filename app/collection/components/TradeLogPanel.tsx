"use client";

import React, { useState } from "react";
import CardImage from "../../decklist/card-search/components/CardImage";
import { tradeSideValue, type TradeLogCard, type TradeLogEntry } from "../../trades/lib/tradeLog";
import type { useTradeLogState } from "../hooks/useTradeLogState";

interface TradeLogPanelProps {
  tradeLog: ReturnType<typeof useTradeLogState>;
  onLogTrade: () => void;
}

const LABEL = "text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatDate(ymd: string): string {
  // Parse as a local date; `new Date("YYYY-MM-DD")` would be UTC and can shift a day.
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function copies(cards: TradeLogCard[], direction: TradeLogCard["direction"]): number {
  return cards.filter((c) => c.direction === direction).reduce((sum, c) => sum + c.quantity, 0);
}

export default function TradeLogPanel({ tradeLog, onLogTrade }: TradeLogPanelProps) {
  const { entries, isLoading, previewMode, error, deleteEntry } = tradeLog;
  const [openId, setOpenId] = useState<string | null>(null);

  if (isLoading) return <p className="text-sm text-muted-foreground py-8">Loading your trade log…</p>;

  return (
    <div className="max-w-4xl">
      {previewMode && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <span className="font-medium">Preview mode.</span> Trades are saved in this browser only, and logging one
          won&apos;t change your collection yet.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <p className="text-sm text-muted-foreground max-w-prose">
          A private record of your trades — only you can see it. Logging a trade adds the cards you received to your
          collection and removes the ones you gave.
        </p>
        <button
          onClick={onLogTrade}
          className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
        >
          Log a trade
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {entries.length === 0 ? (
        <p className="text-center py-16 text-muted-foreground">No trades logged yet.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {entries.map((entry) => (
            <TradeLogRow
              key={entry.id}
              entry={entry}
              open={openId === entry.id}
              onToggle={() => setOpenId(openId === entry.id ? null : entry.id)}
              onDelete={() => deleteEntry(entry.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TradeLogRow({
  entry,
  open,
  onToggle,
  onDelete,
}: {
  entry: TradeLogEntry;
  open: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const gave = tradeSideValue(entry.cards, "gave");
  const received = tradeSideValue(entry.cards, "received");

  return (
    <li>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full grid grid-cols-[88px_1fr_auto] items-baseline gap-3 py-3 text-left hover:bg-muted/40 min-h-11"
      >
        <span className="text-sm tabular-nums text-muted-foreground">{formatDate(entry.tradedOn)}</span>
        <span className="min-w-0">
          <span className="block text-sm font-medium truncate">{entry.partner || "Unnamed trade"}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            Gave {copies(entry.cards, "gave")} · Received {copies(entry.cards, "received")}
          </span>
        </span>
        <span className="text-xs tabular-nums text-right text-muted-foreground">
          {money(gave.total)} → {money(received.total)}
        </span>
      </button>

      {open && (
        <div className="pb-4 pl-0 sm:pl-[100px]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <CardList title="Gave" cards={entry.cards.filter((c) => c.direction === "gave")} />
            <CardList title="Received" cards={entry.cards.filter((c) => c.direction === "received")} />
          </div>
          {entry.notes && <p className="mt-3 text-sm whitespace-pre-wrap">{entry.notes}</p>}
          <p className="mt-3 text-xs text-muted-foreground">
            Values are YTG retail prices when logged
            {gave.unpriced + received.unpriced > 0 && ` (${gave.unpriced + received.unpriced} copies unpriced)`}. Logged{" "}
            {new Date(entry.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.
          </p>
          <div className="mt-3">
            {confirmDelete ? (
              <span className="inline-flex items-center gap-3 text-sm">
                Delete this record? Your collection won&apos;t change.
                <button onClick={onDelete} className="font-medium text-red-600 dark:text-red-400 hover:underline">
                  Delete
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
              >
                Delete record
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function CardList({ title, cards }: { title: string; cards: TradeLogCard[] }) {
  return (
    <div>
      <p className={`${LABEL} mb-2`}>{title}</p>
      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing.</p>
      ) : (
        <ul className="grid grid-cols-4 gap-2">
          {cards.map((c, i) => (
            <li key={i} className="min-w-0">
              <div className="relative">
                <CardImage imgFile={c.cardImgFile} alt={c.cardName} sizes="80px" />
                {c.quantity > 1 && (
                  <span className="absolute bottom-0.5 right-0.5 bg-foreground text-background px-1 rounded text-[10px] font-bold tabular-nums">
                    ×{c.quantity}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] truncate" title={c.cardName}>
                {c.cardName}
              </p>
              <p className="text-[10px] text-muted-foreground tabular-nums">
                {c.unitPrice != null ? money(c.unitPrice) : "—"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
