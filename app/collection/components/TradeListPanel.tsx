"use client";

import React, { useState } from "react";
import CardImage from "../../decklist/card-search/components/CardImage";
import { CARD_BY_FULL_KEY } from "../../decklist/card-search/data/cardIndex";
import UsernameModal from "../../decklist/my-decks/UsernameModal";
import {
  haveShortfall,
  keyOfItem,
  splitTradeItems,
  totalCopies,
  MAX_TRADE_NOTE_LENGTH,
  type TradeItem,
} from "../../trades/lib/tradeList";
import type { useTradeListState } from "../hooks/useTradeListState";

interface TradeListPanelProps {
  tradeList: ReturnType<typeof useTradeListState>;
  /** Owned quantities by name|set|imgFile, for the Haves sanity check. */
  quantities: Map<string, number>;
  onBrowseCards: () => void;
}

const LABEL = "text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

export default function TradeListPanel({ tradeList, quantities, onBrowseCards }: TradeListPanelProps) {
  const { items, isLoading, previewMode, isShared, username, setUsername, putItem, setShared } = tradeList;
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const { wants, haves } = splitTradeItems(Array.from(items.values()));
  const shareUrl =
    username && typeof window !== "undefined" ? `${window.location.origin}/trades/${username}` : null;

  const toggleShared = async () => {
    const result = await setShared(!isShared);
    if (result.needsUsername) setShowUsernameModal(true);
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked; the link is visible to copy by hand.
    }
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-8">Loading your trade list…</p>;
  }

  return (
    <div className="max-w-4xl">
      {previewMode && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <span className="font-medium">Preview mode.</span> The trade list database isn&apos;t live
          yet, so changes are saved in this browser only.
        </div>
      )}

      {/* Sharing */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 pb-4 mb-2">
        <button
          onClick={toggleShared}
          role="switch"
          aria-checked={isShared}
          className="inline-flex items-center gap-2 min-h-11 text-sm"
        >
          <span
            className={`relative inline-block h-5 w-9 rounded-full transition-colors ${
              isShared ? "bg-primary" : "bg-foreground/20"
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform ${
                isShared ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
            />
          </span>
          <span className="font-medium">{isShared ? "Shared by link" : "Private"}</span>
        </button>
        {isShared && shareUrl ? (
          <>
            <span className="text-sm text-muted-foreground truncate max-w-full">{shareUrl}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={copyLink}
                className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              <a
                href={`/trades/${username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted"
              >
                View page
              </a>
            </div>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            Turn on sharing to get a link anyone can view.
          </span>
        )}
      </div>

      {items.size === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">Your trade list is empty.</p>
          <p className="text-sm mb-4">
            In Cards, tap any card&apos;s image, then choose <span className="font-medium text-foreground">Want</span> or{" "}
            <span className="font-medium text-foreground">Have</span>.
          </p>
          <button
            onClick={onBrowseCards}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            Browse cards
          </button>
        </div>
      ) : (
        <>
          <TradeSection
            title="Wants"
            items={wants}
            quantities={quantities}
            onChange={putItem}
            emptyText="No Wants yet."
          />
          <TradeSection
            title="Haves"
            items={haves}
            quantities={quantities}
            onChange={putItem}
            emptyText="No Haves yet."
          />
        </>
      )}

      {showUsernameModal && (
        <UsernameModal
          onClose={() => setShowUsernameModal(false)}
          onSuccess={async (name) => {
            setShowUsernameModal(false);
            setUsername(name);
            await setShared(true);
          }}
        />
      )}
    </div>
  );
}

function TradeSection({
  title,
  items,
  quantities,
  onChange,
  emptyText,
}: {
  title: string;
  items: TradeItem[];
  quantities: Map<string, number>;
  onChange: (item: TradeItem) => void;
  emptyText: string;
}) {
  return (
    <section className="mt-6">
      <h2 className={`${LABEL} border-b border-border/60 pb-1.5`}>
        {title} · <span className="tabular-nums">{totalCopies(items)}</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {items.map((item) => (
            <TradeRow
              key={keyOfItem(item)}
              item={item}
              owned={quantities.get(`${item.cardName}|${item.cardSet}|${item.cardImgFile}`) || 0}
              onChange={onChange}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TradeRow({
  item,
  owned,
  onChange,
}: {
  item: TradeItem;
  owned: number;
  onChange: (item: TradeItem) => void;
}) {
  const card = CARD_BY_FULL_KEY.get(`${item.cardName}|${item.cardSet}|${item.cardImgFile}`);
  const shortfall = haveShortfall(item, owned);
  const [note, setNote] = useState(item.note);

  return (
    <li className="flex gap-3 py-3">
      <div className="w-14 shrink-0">
        <CardImage imgFile={item.cardImgFile} alt={item.cardName} sizes="56px" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-sm font-medium truncate">{item.cardName}</p>
          <p className="text-xs text-muted-foreground truncate">
            {item.anyVersion ? "Any printing" : card?.officialSet || item.cardSet}
          </p>
        </div>
        <input
          type="text"
          value={note}
          maxLength={MAX_TRADE_NOTE_LENGTH}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== item.note && onChange({ ...item, note })}
          placeholder="Add a note (optional)"
          aria-label={`Note for ${item.cardName}`}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {item.kind === "want" && (
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={item.anyVersion}
                onChange={(e) => onChange({ ...item, anyVersion: e.target.checked })}
                className="rounded border-border"
              />
              Any printing is fine
            </label>
          )}
          {shortfall > 0 && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              Your collection has {owned} of this printing
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end justify-between gap-2 shrink-0">
        <div className="flex items-stretch gap-1">
          <button
            onClick={() => onChange({ ...item, quantity: item.quantity - 1 })}
            className="w-8 h-8 text-sm border border-border rounded-md hover:bg-muted"
            aria-label={`One fewer ${item.cardName}`}
          >
            −
          </button>
          <span className="w-7 self-center text-center text-sm font-semibold tabular-nums">
            {item.quantity}
          </span>
          <button
            onClick={() => onChange({ ...item, quantity: item.quantity + 1 })}
            className="w-8 h-8 text-sm border border-border rounded-md hover:bg-muted"
            aria-label={`One more ${item.cardName}`}
          >
            +
          </button>
        </div>
        <button
          onClick={() => onChange({ ...item, quantity: 0 })}
          className="text-xs text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
        >
          Remove
        </button>
      </div>
    </li>
  );
}
