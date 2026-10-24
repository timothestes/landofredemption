"use client";

import React from "react";
import {
  DEFAULT_TRADE_FILTERS,
  tradeFilterOptions,
  type DisplayTradeItem,
  type TradeFilters,
  type TradeSort,
} from "../lib/tradeList";

interface TradeListToolbarProps {
  /** The whole list (unfiltered), so dropdowns offer every set/rarity on it. */
  items: DisplayTradeItem[];
  filters: TradeFilters;
  onChange: (filters: TradeFilters) => void;
}

const SELECT = "rounded-lg border border-border bg-background px-2 py-2 text-sm min-h-11 sm:min-h-0";

/** Search / set / rarity / sort controls shared by the editor and the public page. */
export default function TradeListToolbar({ items, filters, onChange }: TradeListToolbarProps) {
  const { sets, rarities } = tradeFilterOptions(items);
  const isFiltered = !!(filters.query || filters.set || filters.rarity);
  const set = (patch: Partial<TradeFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        value={filters.query}
        onChange={(e) => set({ query: e.target.value })}
        placeholder="Search card, set or note…"
        aria-label="Search the trade list"
        className="flex-1 min-w-[180px] rounded-lg border border-border bg-background px-3 py-2 text-sm min-h-11 sm:min-h-0"
      />
      <select
        value={filters.set}
        onChange={(e) => set({ set: e.target.value })}
        aria-label="Filter by set"
        className={`${SELECT} w-40`}
      >
        <option value="">All sets</option>
        {sets.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <select
        value={filters.rarity}
        onChange={(e) => set({ rarity: e.target.value })}
        aria-label="Filter by rarity"
        className={`${SELECT} w-36`}
      >
        <option value="">All rarities</option>
        {rarities.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
      <select
        value={filters.sort}
        onChange={(e) => set({ sort: e.target.value as TradeSort })}
        aria-label="Sort by"
        className={`${SELECT} w-36`}
      >
        <option value="name">Sort: Name</option>
        <option value="set">Sort: Set</option>
        <option value="rarity">Sort: Rarity</option>
      </select>
      {isFiltered && (
        <button
          onClick={() => onChange({ ...DEFAULT_TRADE_FILTERS, sort: filters.sort })}
          className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground min-h-11 sm:min-h-0"
        >
          Clear
        </button>
      )}
    </div>
  );
}
