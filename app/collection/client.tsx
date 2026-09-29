"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ALL_CARDS, CARD_BY_FULL_KEY } from "../decklist/card-search/data/cardIndex";
import { categorizeRarity, type Card } from "../decklist/card-search/utils";
import { GOOD_BRIGADES, EVIL_BRIGADES } from "../decklist/card-search/constants";
import CardImage from "../decklist/card-search/components/CardImage";
import { useCardPrices } from "../decklist/card-search/hooks/useCardPrices";
import { useCollectionState, cardFullKey } from "./hooks/useCollectionState";
import { downloadCollectionTxt } from "./utils/collectionCsv";
import ImportCsvModal from "./components/ImportCsvModal";
import { useShowPrices } from "../../hooks/useShowPrices";
import { compareCardsDefault } from "@/lib/cards/defaultSort";
import { PARAGON_EXCLUDED_SETS } from "@/lib/formats";

const BATCH_SIZE = 60;
const RARITY_OPTIONS = ["Common", "Rare", "Ultra Rare", "Promo"];
const ALIGNMENT_OPTIONS = ["Good", "Evil", "Neutral"];

// Sets that aren't real collectible cards — excluded from the collection tracker.
// (Scoped here, not in the global catalog, since the deck builder references
// these for token generation.)
const EXCLUDED_OFFICIAL_SETS = new Set(["Prophecies of Christ Token"]);
const COLLECTION_CARDS = ALL_CARDS.filter((c) => !EXCLUDED_OFFICIAL_SETS.has(c.officialSet));

// Tournament format filter, mirrored from the deck builder's legality logic.
type FormatMode = "Limited" | "Unlimited" | "Scrolls" | "Banned" | "Paragon";
// "Scrolls" hidden per Tim 2026-07-25 — filter logic kept; re-add here to restore
const FORMAT_OPTIONS: FormatMode[] = ["Limited", "Unlimited", "Banned", "Paragon"];
const DEFAULT_FORMAT: FormatMode = "Limited";

function matchesFormat(card: Card, mode: FormatMode): boolean {
  if (mode === "Unlimited") return true;
  if (mode === "Limited") return card.legality === "Rotation";
  if (mode === "Banned") return card.legality === "Banned";
  if (mode === "Scrolls") return card.legality !== "Rotation" && card.legality !== "Banned";
  if (mode === "Paragon") {
    if (card.type.toLowerCase().includes("lost soul")) return false;
    return !PARAGON_EXCLUDED_SETS.has(card.officialSet);
  }
  return false;
}

// Collapsed type filter. Each bucket's `match` is tested as a substring of the
// card's raw type, so a bucket also catches compound/token variants
// (e.g. "Hero" catches "Hero/GE" and "Hero Token"). "Other" catches anything in
// none of the buckets (Covenant, City, Territory, …).
const OTHER_TYPE = "__other__";
// Sorted alphabetically by label; "Other" is appended separately in the dropdown.
const TYPE_BUCKETS: { label: string; match: string }[] = [
  { label: "Artifact", match: "Artifact" },
  { label: "Covenant", match: "Covenant" },
  { label: "Curse", match: "Curse" },
  { label: "Dominant", match: "Dominant" },
  { label: "Evil Character", match: "Evil Character" },
  { label: "Evil Enhancement", match: "EE" },
  { label: "Fortress", match: "Fortress" },
  { label: "Good Enhancement", match: "GE" },
  { label: "Hero", match: "Hero" },
  { label: "Lost Soul", match: "Lost Soul" },
  { label: "Site", match: "Site" },
];

function matchesTypeFilter(cardType: string, filter: string): boolean {
  if (!filter) return true;
  if (filter === OTHER_TYPE) {
    return !TYPE_BUCKETS.some((b) => cardType.includes(b.match));
  }
  return cardType.includes(filter);
}

export default function CollectionClient() {
  const {
    quantities,
    isLoading,
    isSaving,
    syncError,
    setQuantity,
    adjustQuantity,
    importRows,
    clearCollection,
  } = useCollectionState();

  const [search, setSearch] = useState("");
  const [formatMode, setFormatMode] = useState<FormatMode>(DEFAULT_FORMAT);
  const [typeFilter, setTypeFilter] = useState("");
  const [brigadeFilter, setBrigadeFilter] = useState("");
  const [alignmentFilter, setAlignmentFilter] = useState("");
  const [rarityFilter, setRarityFilter] = useState("");
  const [ownershipFilter, setOwnershipFilter] = useState<"all" | "owned" | "unowned">("all");
  const [sortBy, setSortBy] = useState<
    "default" | "name" | "set" | "strength" | "toughness" | "type" | "brigade" | "quantity" | "price"
  >("default");
  const [showPrices, setShowPrices] = useShowPrices();
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [modalCard, setModalCard] = useState<Card | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showSetStats, setShowSetStats] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Close the settings menu on outside click
  useEffect(() => {
    if (!showSettingsMenu) return;
    const onClick = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettingsMenu(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showSettingsMenu]);

  const { getPrice } = useCardPrices();

  const resetFilters = () => {
    setSearch("");
    setFormatMode(DEFAULT_FORMAT);
    setTypeFilter("");
    setBrigadeFilter("");
    setAlignmentFilter("");
    setRarityFilter("");
    setOwnershipFilter("all");
  };

  // "/" resets all filters to default and focuses search — matches the deck builder.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !isTyping && !modalCard && !showImport) {
        e.preventDefault();
        resetFilters();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [modalCard, showImport]);

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return COLLECTION_CARDS.filter((card) => {
      if (ownershipFilter === "owned" && !quantities.has(cardFullKey(card))) return false;
      if (ownershipFilter === "unowned" && quantities.has(cardFullKey(card))) return false;
      if (!matchesFormat(card, formatMode)) return false;
      if (!matchesTypeFilter(card.type, typeFilter)) return false;
      if (alignmentFilter && card.alignment !== alignmentFilter) return false;
      if (brigadeFilter && !card.brigade.split("/").includes(brigadeFilter)) return false;
      if (rarityFilter && categorizeRarity(card.rarity, card.officialSet) !== rarityFilter)
        return false;
      if (q) {
        // Search matches name, set, ability, and identifier — folds the old
        // (unwieldy) set dropdown into the search bar.
        const haystack =
          `${card.name} ${card.set} ${card.officialSet} ${card.specialAbility} ${card.identifier}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      switch (sortBy) {
        case "set":
          return a.officialSet.localeCompare(b.officialSet) || a.name.localeCompare(b.name);
        case "strength": {
          const aStr = parseInt(a.strength) || 0;
          const bStr = parseInt(b.strength) || 0;
          return bStr - aStr || a.name.localeCompare(b.name);
        }
        case "toughness": {
          const aTgh = parseInt(a.toughness) || 0;
          const bTgh = parseInt(b.toughness) || 0;
          return bTgh - aTgh || a.name.localeCompare(b.name);
        }
        case "type":
          return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
        case "brigade":
          return a.brigade.localeCompare(b.brigade) || a.name.localeCompare(b.name);
        case "quantity": {
          const aQty = quantities.get(cardFullKey(a)) || 0;
          const bQty = quantities.get(cardFullKey(b)) || 0;
          return bQty - aQty || a.name.localeCompare(b.name);
        }
        case "price": {
          const aPrice = getPrice(cardFullKey(a))?.price || 0;
          const bPrice = getPrice(cardFullKey(b))?.price || 0;
          return bPrice - aPrice || a.name.localeCompare(b.name);
        }
        case "name":
          return a.name.localeCompare(b.name) || a.set.localeCompare(b.set);
        case "default":
        default:
          return compareCardsDefault(a, b) || a.set.localeCompare(b.set);
      }
    });
  }, [search, formatMode, typeFilter, brigadeFilter, alignmentFilter, rarityFilter, ownershipFilter, sortBy, quantities, getPrice]);

  // Reset pagination whenever the filter result changes identity
  const filterKey = `${search}|${formatMode}|${typeFilter}|${brigadeFilter}|${alignmentFilter}|${rarityFilter}|${ownershipFilter}|${sortBy}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setVisibleCount(BATCH_SIZE);
  }

  const stats = useMemo(() => {
    let totalCopies = 0;
    for (const qty of quantities.values()) totalCopies += qty;
    return { uniqueOwned: quantities.size, totalCopies };
  }, [quantities]);

  const collectionValue = useMemo(() => {
    if (!showPrices) return null;
    let total = 0;
    let unpriced = 0;
    for (const [key, qty] of quantities) {
      const info = getPrice(key);
      if (info) total += info.price * qty;
      else unpriced += qty;
    }
    return { total, unpriced };
  }, [showPrices, quantities, getPrice]);

  const setCompletion = useMemo(() => {
    const totals = new Map<string, number>();
    const owned = new Map<string, number>();
    for (const card of COLLECTION_CARDS) {
      if (!card.officialSet) continue;
      totals.set(card.officialSet, (totals.get(card.officialSet) || 0) + 1);
      if (quantities.has(cardFullKey(card))) {
        owned.set(card.officialSet, (owned.get(card.officialSet) || 0) + 1);
      }
    }
    return Array.from(totals.entries())
      .map(([set, total]) => ({ set, total, owned: owned.get(set) || 0 }))
      .sort((a, b) => b.owned / b.total - a.owned / a.total || a.set.localeCompare(b.set));
  }, [quantities]);

  const ownedEntries = useMemo(() => {
    const entries: { card: Card; quantity: number }[] = [];
    for (const [key, quantity] of quantities) {
      const card = CARD_BY_FULL_KEY.get(key);
      if (card) {
        entries.push({ card, quantity });
      } else {
        // Card no longer in the catalog — preserve it on export anyway
        const [name, set, imgFile] = key.split("|");
        entries.push({ card: { name, set, imgFile } as Card, quantity });
      }
    }
    return entries;
  }, [quantities]);

  const visibleCards = filteredCards.slice(0, visibleCount);

  // Infinite scroll: load the next batch when the sentinel scrolls into view
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= filteredCards.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + BATCH_SIZE, filteredCards.length));
        }
      },
      { rootMargin: "600px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, filteredCards.length]);

  return (
    <div className="w-full max-w-screen-2xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-4">
        <h1 className="font-cinzel text-2xl font-bold tracking-tight sm:text-3xl">My Collection</h1>
        <span className="text-sm text-muted-foreground">
          {stats.uniqueOwned.toLocaleString()} unique ·{" "}
          {stats.totalCopies.toLocaleString()} total cards
        </span>
        {collectionValue && (
          <span
            className="text-sm font-medium text-green-600 dark:text-green-400 inline-flex items-center gap-1 cursor-help"
            title="Estimated cost to buy these cards at Your Turn Games retail prices — not a resale value."
          >
            ≈ ${collectionValue.total.toFixed(2)} to buy at YTG
            <svg className="w-3.5 h-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
          </span>
        )}
        {/* Sponsor: card prices come from YTG. Always visible since infinite
            scroll means the page footer is never reached. */}
        <a
          href="https://www.yourturngames.biz"
          target="_blank"
          rel="noopener noreferrer"
          title="Card prices from Your Turn Games"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground opacity-80 hover:opacity-100 transition-opacity"
        >
          <span className="hidden sm:inline">Prices by</span>
          <img
            src="/sponsors/ytg-light.png"
            alt="Your Turn Games"
            className="h-5 w-auto object-contain block [.dark_&]:hidden [.jayden_&]:hidden"
          />
          <img
            src="/sponsors/ytg-dark.png"
            alt="Your Turn Games"
            className="h-5 w-auto object-contain hidden [.dark_&]:block [.jayden_&]:block"
          />
        </a>
        <span className="text-xs text-muted-foreground min-w-[80px]">
          {isSaving ? "Saving…" : syncError ? (
            <span className="text-red-600 dark:text-red-400">{syncError}</span>
          ) : null}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          {/* Opens the deck builder with its "Cards I own" filter already on. */}
          <a
            href="/decklist/card-search?owned=true"
            className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            Build a deck
          </a>
          <button
            onClick={() => setShowSetStats((v) => !v)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted"
          >
            Set completion
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted"
          >
            Import
          </button>
          <button
            onClick={() => downloadCollectionTxt(ownedEntries)}
            disabled={ownedEntries.length === 0}
            className="px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Export
          </button>
          {/* Settings: gear hides the destructive Clear behind a menu */}
          <div className="relative" ref={settingsRef}>
            <button
              onClick={() => setShowSettingsMenu((v) => !v)}
              aria-label="Collection settings"
              aria-expanded={showSettingsMenu}
              className="p-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            {showSettingsMenu && (
              <div className="absolute right-0 mt-1 w-48 rounded-lg border border-border bg-popover shadow-lg py-1 z-30">
                <button
                  onClick={() => {
                    setShowSettingsMenu(false);
                    setShowClearConfirm(true);
                  }}
                  disabled={ownedEntries.length === 0}
                  className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 text-red-600 dark:text-red-400 hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                  Clear collection
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* First-run banner — the page is a catalog browser until cards are owned */}
      {!isLoading && quantities.size === 0 && (
        <div className="mb-4 rounded-lg border border-border bg-muted/40 p-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex-1 min-w-[240px]">
            <p className="text-sm font-semibold">Start tracking your collection</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Browse all {COLLECTION_CARDS.length.toLocaleString()} Redemption cards below and tap{" "}
              <span className="font-medium text-foreground">+ Add</span> as you sort your
              binder — or bring in an existing spreadsheet.
            </p>
          </div>
          <button
            onClick={() => setShowImport(true)}
            className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            Import CSV
          </button>
        </div>
      )}

      {/* Set completion panel */}
      {showSetStats && (
        <div className="mb-4 rounded-lg border border-border p-3 sm:p-4">
          <h2 className="text-sm font-semibold mb-2">Set completion (unique cards)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 max-h-72 overflow-y-auto">
            {setCompletion.map(({ set, owned, total }) => (
              <div key={set} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate" title={set}>{set}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {owned}/{total}
                </span>
                <div className="w-20 h-1.5 rounded-full bg-foreground/10 overflow-hidden shrink-0">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.round((owned / total) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, set, ability…  ( / to reset )"
          className="flex-1 min-w-[200px] rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
        <select
          value={formatMode}
          onChange={(e) => setFormatMode(e.target.value as FormatMode)}
          title="Tournament format"
          className="w-32 rounded-lg border border-border bg-background px-2 py-2 text-sm"
        >
          {FORMAT_OPTIONS.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-36 rounded-lg border border-border bg-background px-2 py-2 text-sm"
        >
          <option value="">All types</option>
          {TYPE_BUCKETS.map((b) => (
            <option key={b.match} value={b.match}>{b.label}</option>
          ))}
          <option value={OTHER_TYPE}>Other</option>
        </select>
        <select
          value={brigadeFilter}
          onChange={(e) => setBrigadeFilter(e.target.value)}
          className="w-36 rounded-lg border border-border bg-background px-2 py-2 text-sm"
        >
          <option value="">All brigades</option>
          <optgroup label="Good">
            {GOOD_BRIGADES.map((b: string) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </optgroup>
          <optgroup label="Evil">
            {EVIL_BRIGADES.map((b: string) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </optgroup>
        </select>
        <select
          value={alignmentFilter}
          onChange={(e) => setAlignmentFilter(e.target.value)}
          className="w-36 rounded-lg border border-border bg-background px-2 py-2 text-sm"
        >
          <option value="">All alignments</option>
          {ALIGNMENT_OPTIONS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select
          value={rarityFilter}
          onChange={(e) => setRarityFilter(e.target.value)}
          className="w-36 rounded-lg border border-border bg-background px-2 py-2 text-sm"
        >
          <option value="">All rarities</option>
          {RARITY_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          title="Sort by"
          className="w-36 rounded-lg border border-border bg-background px-2 py-2 text-sm"
        >
          <option value="default">Sort: Default</option>
          <option value="name">Sort: Name</option>
          <option value="set">Sort: Set</option>
          <option value="brigade">Sort: Brigade</option>
          <option value="type">Sort: Type</option>
          <option value="strength">Sort: Strength</option>
          <option value="toughness">Sort: Toughness</option>
          <option value="quantity">Sort: Quantity</option>
          <option value="price">Sort: Price</option>
        </select>
        <button
          onClick={() => setOwnershipFilter((v) => v === "owned" ? "all" : "owned")}
          onContextMenu={(e) => { e.preventDefault(); setOwnershipFilter((v) => v === "unowned" ? "all" : "unowned"); }}
          aria-pressed={ownershipFilter !== "all"}
          title="Left-click: owned only · Right-click: not yet owned"
          className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
            ownershipFilter === "owned"
              ? "bg-foreground text-background border-foreground"
              : ownershipFilter === "unowned"
              ? "bg-amber-500 text-white border-amber-500"
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {ownershipFilter === "unowned" ? "Not owned" : "Owned only"}
        </button>
        <button
          onClick={() => setShowPrices(!showPrices)}
          aria-pressed={showPrices}
          className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
            showPrices
              ? "bg-foreground text-background border-foreground"
              : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          Show prices
        </button>
      </div>

      {/* Result count */}
      <p className="text-xs text-muted-foreground mb-3">
        {isLoading
          ? "Loading your collection…"
          : filteredCards.length === COLLECTION_CARDS.length
            ? `${filteredCards.length.toLocaleString()} cards`
            : `${filteredCards.length.toLocaleString()} of ${COLLECTION_CARDS.length.toLocaleString()} cards`}
      </p>

      {/* Empty states */}
      {!isLoading && ownershipFilter === "owned" && filteredCards.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="mb-2 font-medium">No owned cards match these filters.</p>
          <p className="text-sm">
            Turn off "Owned only" to browse all cards and tap <span className="font-semibold">Add</span> to
            start tracking your collection.
          </p>
        </div>
      )}
      {!isLoading && ownershipFilter === "unowned" && filteredCards.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="mb-2 font-medium">You own everything matching these filters.</p>
        </div>
      )}

      {/* Card grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {visibleCards.map((card) => {
          const qty = quantities.get(cardFullKey(card)) || 0;
          return (
            <div
              key={card.dataLine}
              className={`rounded-lg border p-1.5 flex flex-col gap-1.5 ${
                qty > 0 ? "border-primary/60" : "border-border"
              }`}
            >
              <div className="relative cursor-pointer" onClick={() => setModalCard(card)}>
                <CardImage
                  imgFile={card.imgFile}
                  alt={card.name}
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw"
                />
                {qty > 0 && (
                  <span className="absolute bottom-1 right-1 bg-emerald-500/90 backdrop-blur-sm text-white px-1.5 py-0.5 rounded font-bold text-xs shadow-lg ring-1 ring-black/20">
                    ×{qty}
                  </span>
                )}
              </div>
              <div className="px-0.5">
                <p className="text-xs font-medium truncate" title={card.name}>
                  {card.name}
                </p>
                <div className="flex items-baseline justify-between gap-1">
                  <p className="text-[10px] text-muted-foreground truncate">
                    {card.officialSet || card.set}
                  </p>
                  {showPrices && (
                    <span className="text-[10px] tabular-nums shrink-0 text-green-600 dark:text-green-400">
                      {(() => {
                        const info = getPrice(cardFullKey(card));
                        return info ? `$${info.price.toFixed(2)}` : "—";
                      })()}
                    </span>
                  )}
                </div>
              </div>
              {qty === 0 ? (
                <button
                  onClick={() => setQuantity(card, 1)}
                  className="w-full py-1.5 text-sm text-muted-foreground rounded-md border border-transparent hover:border-border hover:bg-muted hover:text-foreground transition-colors"
                >
                  + Add
                </button>
              ) : (
                <div className="flex items-stretch gap-1">
                  <button
                    onClick={() => adjustQuantity(card, -1)}
                    className="flex-1 py-1.5 text-sm border border-border rounded-md hover:bg-muted"
                    aria-label={`Remove one ${card.name}`}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={0}
                    value={qty}
                    onChange={(e) => setQuantity(card, parseInt(e.target.value, 10) || 0)}
                    className="w-12 text-center text-sm rounded-md border border-border bg-background [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    aria-label={`${card.name} quantity`}
                  />
                  <button
                    onClick={() => adjustQuantity(card, 1)}
                    className="flex-1 py-1.5 text-sm border border-border rounded-md hover:bg-muted"
                    aria-label={`Add one ${card.name}`}
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Infinite scroll: sentinel auto-loads the next batch as it nears the viewport */}
      {visibleCount < filteredCards.length && (
        <div ref={sentinelRef} className="py-6 text-center text-xs text-muted-foreground">
          Loading more… ({(filteredCards.length - visibleCount).toLocaleString()} remaining)
        </div>
      )}

      {/* Card detail modal */}
      {modalCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setModalCard(null)}
        >
          <div
            className="w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <CardImage imgFile={modalCard.imgFile} alt={modalCard.name} sizes="384px" priority />
            <div className="mt-2 flex items-center justify-between gap-2 bg-background border border-border rounded-lg px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{modalCard.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {modalCard.officialSet || modalCard.set}
                  {showPrices && (() => {
                    const info = getPrice(cardFullKey(modalCard));
                    return info ? (
                      <span className="text-green-600 dark:text-green-400"> · ${info.price.toFixed(2)}</span>
                    ) : null;
                  })()}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => adjustQuantity(modalCard, -1)}
                  className="w-9 h-9 text-base border border-border rounded-md hover:bg-muted"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm font-semibold tabular-nums">
                  {quantities.get(cardFullKey(modalCard)) || 0}
                </span>
                <button
                  onClick={() => adjustQuantity(modalCard, 1)}
                  className="w-9 h-9 text-base border border-border rounded-md hover:bg-muted"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <ImportCsvModal
          allCards={COLLECTION_CARDS}
          onClose={() => setShowImport(false)}
          onImport={importRows}
          currentCount={ownedEntries.length}
          onBackup={() => downloadCollectionTxt(ownedEntries)}
        />
      )}

      {/* Clear confirm */}
      {showClearConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowClearConfirm(false)}
        >
          <div
            className="bg-background border border-border rounded-xl w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold mb-2">Clear collection?</h2>
            <p className="text-sm text-muted-foreground mb-4">
              This removes all {stats.uniqueOwned.toLocaleString()} cards from your
              collection and cannot be undone. We&apos;ll download a backup file first so
              you can re-import it later.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  // Force a backup download before the destructive clear
                  downloadCollectionTxt(ownedEntries);
                  await clearCollection();
                  setShowClearConfirm(false);
                }}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                Download backup &amp; clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
