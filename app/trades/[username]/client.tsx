"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CardImage from "../../decklist/card-search/components/CardImage";
import TradeListToolbar from "../components/TradeListToolbar";
import {
  DEFAULT_TRADE_FILTERS,
  filterTradeItems,
  findTradeMatches,
  keyOfItem,
  splitTradeItems,
  totalCopies,
  tradeListText,
  type DisplayTradeItem,
  type TradeFilters,
  type TradeItem,
} from "../lib/tradeList";
import { readPreviewItems } from "../lib/previewStore";

interface TradeListViewProps {
  username: string;
  items: DisplayTradeItem[];
  isOwner: boolean;
  isShared: boolean;
  previewMode: boolean;
  updatedAt: string | null;
  /** Null for the owner; otherwise what the visitor brings (see loadVisitorMatchDataAction). */
  visitor: {
    signedIn: boolean;
    owned: Record<string, number>;
    wants: TradeItem[];
    wantsPreview?: boolean;
  } | null;
}

const LABEL = "text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

export default function TradeListView({
  username,
  items: initialItems,
  isOwner,
  isShared,
  previewMode,
  updatedAt,
  visitor,
}: TradeListViewProps) {
  const [items, setItems] = useState(initialItems);
  const [enlarged, setEnlarged] = useState<DisplayTradeItem | null>(null);
  const [filters, setFilters] = useState<TradeFilters>(DEFAULT_TRADE_FILTERS);
  const [matchesOnly, setMatchesOnly] = useState(false);
  const [copied, setCopied] = useState(false);
  const [visitorWants, setVisitorWants] = useState<TradeItem[]>(visitor?.wants ?? []);

  // PREVIEW-ONLY: a visitor's Wants live in their browser until the tables exist.
  useEffect(() => {
    if (visitor?.wantsPreview) setVisitorWants(readPreviewItems() ?? []);
  }, [visitor?.wantsPreview]);

  const matches = useMemo(
    () => findTradeMatches(items, new Map(Object.entries(visitor?.owned ?? {})), visitorWants),
    [items, visitor?.owned, visitorWants]
  );
  const matchCount = matches.youOwn.size + matches.youWant.size;

  // PREVIEW-ONLY: the owner sees their own browser-saved list instead of samples.
  useEffect(() => {
    if (!previewMode || !isOwner) return;
    const saved = readPreviewItems();
    if (saved?.length) setItems(saved.map((i) => ({ ...i, setName: i.setName ?? i.cardSet, rarity: i.rarity ?? "" })));
  }, [previewMode, isOwner]);

  const all = splitTradeItems(items);
  const visible = filterTradeItems(items, filters).filter(
    (i) => !matchesOnly || matches.youOwn.has(keyOfItem(i)) || matches.youWant.has(keyOfItem(i))
  );
  const isFiltered = filterTradeItems(items, filters).length !== items.length;
  const { priorityWants, wants, haves } = splitTradeItems(visible, filters.sort);

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(tradeListText(username, items, window.location.href));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked.
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">
      {previewMode && (
        <div className="mb-6 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <span className="font-medium">Preview.</span>{" "}
          {isOwner
            ? "Showing the list saved in this browser (or sample cards if it's empty)."
            : "Showing sample cards — trade lists aren't live yet."}
        </div>
      )}
      {isOwner && !isShared && !previewMode && (
        <div className="mb-6 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          Only you can see this page.{" "}
          <Link href="/collection" className="font-medium text-primary hover:underline">
            Turn on sharing
          </Link>{" "}
          in My Collection → Trade list to share the link.
        </div>
      )}

      <p className={LABEL}>Trade list</p>
      <h1 className="font-cinzel text-3xl font-bold tracking-tight sm:text-4xl mt-1">{username}</h1>
      <p className="mt-2 text-sm text-muted-foreground tabular-nums">
        {totalCopies(all.priorityWants) + totalCopies(all.wants)} wanted · {totalCopies(all.haves)} for trade
        {updatedAt && (
          <>
            {" "}
            · Updated{" "}
            {new Date(updatedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </>
        )}
      </p>
      {items.length > 0 && (
        <button
          onClick={copyText}
          title="Copy a plain-text list to paste into Facebook, Discord, etc."
          className="mt-3 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted"
        >
          {copied ? "Copied" : "Copy as text"}
        </button>
      )}

      {/* Where the visitor's cards line up with this list */}
      {visitor?.signedIn && items.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-border/60 py-3 text-sm">
          {matchCount === 0 ? (
            <span className="text-muted-foreground">
              No overlap with your collection or Wants yet.
            </span>
          ) : (
            <>
              <span className="tabular-nums">
                You own <span className="font-semibold">{matches.youOwn.size}</span> of their Wants
              </span>
              <span className="tabular-nums">
                They have <span className="font-semibold">{matches.youWant.size}</span> of your Wants
              </span>
              <button
                onClick={() => setMatchesOnly((v) => !v)}
                aria-pressed={matchesOnly}
                className={`ml-auto min-h-11 px-4 rounded-full border text-sm transition-colors ${
                  matchesOnly
                    ? "bg-foreground text-background border-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                Matches only
              </button>
            </>
          )}
        </div>
      )}
      {visitor && !visitor.signedIn && items.length > 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          <Link
            href={`/sign-in?redirectTo=${encodeURIComponent(`/trades/${username}`)}`}
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </Link>{" "}
          to see which of these cards you own or want.
        </p>
      )}

      {items.length > 0 && (
        <div className="mt-6">
          <TradeListToolbar items={items} filters={filters} onChange={setFilters} />
          {(isFiltered || matchesOnly) && (
            <p className="mt-2 text-xs text-muted-foreground tabular-nums">
              Showing {visible.length} of {items.length} cards
            </p>
          )}
        </div>
      )}

      {priorityWants.length > 0 && (
        <TradeGrid title="Priority wants" highlight items={priorityWants} matches={matches} onEnlarge={setEnlarged} emptyText="" />
      )}
      <TradeGrid
        title="Wants"
        items={wants}
        matches={matches}
        onEnlarge={setEnlarged}
        emptyText={
          isFiltered || matchesOnly
            ? "No Wants match."
            : all.priorityWants.length
              ? "Nothing else wanted right now."
              : `${username} hasn't listed any Wants.`
        }
      />
      <TradeGrid
        title="Haves"
        items={haves}
        matches={matches}
        onEnlarge={setEnlarged}
        emptyText={isFiltered || matchesOnly ? "No Haves match." : `${username} hasn't listed any Haves.`}
      />

      <p className="mt-12 border-t border-border/60 pt-4 text-sm text-muted-foreground">
        Track your own cards and share a trade list from{" "}
        <Link href="/collection" className="font-medium text-primary hover:underline">
          My Collection
        </Link>
        .
      </p>

      {enlarged && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setEnlarged(null)}
        >
          <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <CardImage imgFile={enlarged.cardImgFile} alt={enlarged.cardName} sizes="384px" priority />
            <div className="mt-2 bg-background border border-border rounded-lg px-3 py-2">
              <p className="text-sm font-medium">
                {enlarged.cardName}
                <span className="text-muted-foreground font-normal tabular-nums"> ×{enlarged.quantity}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {enlarged.priority && <span className="font-medium text-primary">★ Priority · </span>}
                {enlarged.anyVersion ? "Any printing" : enlarged.setName}
                {enlarged.rarity && ` · ${enlarged.rarity}`}
              </p>
              {enlarged.note && <p className="text-sm mt-1">{enlarged.note}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TradeGrid({
  title,
  highlight = false,
  items,
  matches,
  onEnlarge,
  emptyText,
}: {
  title: string;
  highlight?: boolean;
  items: DisplayTradeItem[];
  matches: ReturnType<typeof findTradeMatches>;
  onEnlarge: (item: DisplayTradeItem) => void;
  emptyText: string;
}) {
  return (
    <section className="mt-8">
      <h2
        className={`text-xl font-semibold border-b pb-2 mb-4 ${
          highlight ? "border-primary/60" : "border-border/60"
        }`}
      >
        {highlight && <span className="text-primary">★ </span>}
        {title} <span className="text-muted-foreground font-normal tabular-nums">· {totalCopies(items)}</span>
      </h2>
      {highlight && (
        <p className="-mt-2 mb-4 text-sm text-muted-foreground">Top of the list — most wanted right now.</p>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-3 gap-y-5">
          {items.map((item) => (
            <li key={keyOfItem(item)} className="min-w-0">
              <button
                onClick={() => onEnlarge(item)}
                className="relative block w-full rounded-sm overflow-hidden"
                aria-label={`Enlarge ${item.cardName}`}
              >
                <CardImage
                  imgFile={item.cardImgFile}
                  alt={item.cardName}
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
                />
                {item.quantity > 1 && (
                  <span className="absolute bottom-1 right-1 bg-foreground text-background px-1.5 py-0.5 rounded text-xs font-bold tabular-nums">
                    ×{item.quantity}
                  </span>
                )}
                {(matches.youOwn.has(keyOfItem(item)) || matches.youWant.has(keyOfItem(item))) && (
                  <span className="absolute top-1 left-1 bg-primary text-primary-foreground px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide">
                    {item.kind === "want" ? "You own" : "You want"}
                  </span>
                )}
              </button>
              <p className="mt-1.5 text-sm font-medium truncate" title={item.cardName}>
                {item.cardName}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {item.anyVersion ? (
                  <span className="font-medium text-foreground">Any printing</span>
                ) : (
                  item.setName
                )}
              </p>
              {item.note && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.note}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
