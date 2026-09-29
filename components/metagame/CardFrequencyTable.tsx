"use client";

import { useMemo, useState } from "react";
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
import type { BreakdownDeck } from "@/lib/tournament/breakdown";
import type { DerivedCard } from "@/lib/tournament/derive";
import TopCutControl from "./TopCutControl";

type SortKey = "decks" | "copies" | "delta" | "reserve" | "name";
type ZoneFilter = "all" | "main" | "reserve";

/**
 * Below this many decks, a top-cut delta is noise — a card in 3 of 62 lists can
 * swing 12 points on one player's finish. Such rows still show their delta, but
 * greyed and marked, and they are excluded from delta sorting.
 */
const DELTA_MIN_DECKS = 4;

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function signedPoints(value: number): string {
  const points = Math.round(value * 100);
  return points > 0 ? `+${points}` : String(points);
}

export default function CardFrequencyTable({
  cards,
  deckCount,
  decks,
  cutSize,
  topCut,
  onTopCutChange,
  rankedDeckCount,
  cutOptions,
  perEventCut = false,
}: {
  cards: DerivedCard[];
  deckCount: number;
  decks: BreakdownDeck[];
  cutSize: number;
  topCut: number;
  onTopCutChange: (value: number) => void;
  rankedDeckCount: number;
  cutOptions?: { value: number; label: string }[];
  perEventCut?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [zone, setZone] = useState<ZoneFilter>("all");
  const [type, setType] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("decks");
  const [expanded, setExpanded] = useState<string | null>(null);

  const types = useMemo(() => {
    const tally = new Map<string, number>();
    for (const card of cards) {
      if (!card.type) continue;
      tally.set(card.type, (tally.get(card.type) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label);
  }, [cards]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = cards.filter((card) => {
      if (zone === "main" && card.mainCopies === 0) return false;
      if (zone === "reserve" && card.reserveCopies === 0) return false;
      if (type !== "all" && card.type !== type) return false;
      if (!needle) return true;
      if (card.name.toLowerCase().includes(needle)) return true;
      // Let a search for a specific printing find its merged row.
      return card.printings.some((p) => p.toLowerCase().includes(needle));
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "copies":
          return b.copies - a.copies || a.name.localeCompare(b.name);
        case "reserve":
          return b.reserveCopies - a.reserveCopies || a.name.localeCompare(b.name);
        case "name":
          return a.name.localeCompare(b.name);
        case "delta": {
          // Small samples sort last rather than dominating the top on noise.
          const aOk = a.decks >= DELTA_MIN_DECKS;
          const bOk = b.decks >= DELTA_MIN_DECKS;
          if (aOk !== bOk) return aOk ? -1 : 1;
          return b.delta - a.delta || b.decks - a.decks;
        }
        default:
          return b.decks - a.decks || a.name.localeCompare(b.name);
      }
    });
    return sorted;
  }, [cards, query, zone, type, sort]);

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold text-foreground">Card frequency</h2>
          <p className="text-xs text-muted-foreground tabular-nums">
            {rows.length.toLocaleString()} of {cards.length.toLocaleString()} cards
          </p>
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search cards or printings…"
          aria-label="Search cards"
          className="w-full rounded-lg bg-muted/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:bg-muted focus:outline-none"
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterGroup
            label="Zone"
            value={zone}
            onChange={(v) => setZone(v as ZoneFilter)}
            options={[
              { value: "all", label: "All" },
              { value: "main", label: "Main" },
              { value: "reserve", label: "Reserve" },
            ]}
          />
          <label className="flex items-center gap-2">
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Type
            </span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="rounded-lg bg-muted/50 px-2 py-1 text-xs text-foreground focus:outline-none"
            >
              <option value="all">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <FilterGroup
            label="Sort"
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            options={[
              { value: "decks", label: "Decks" },
              { value: "copies", label: "Copies" },
              { value: "delta", label: "Cut delta" },
              { value: "reserve", label: "Reserve" },
              { value: "name", label: "A–Z" },
            ]}
          />
        </div>

        {sort === "delta" && (
          <TopCutControl
            topCut={topCut}
            onChange={onTopCutChange}
            cutSize={cutSize}
            rankedDeckCount={rankedDeckCount}
            options={cutOptions}
            perEvent={perEventCut}
          />
        )}
      </header>

      {rows.length === 0 ? (
        <p className="rounded-lg bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          No cards match those filters.
        </p>
      ) : (
        <ol className="overflow-hidden rounded-xl bg-card">
          {/* Column headers. Not a <thead> because the rows are expandable
              buttons rather than a table, but readers still need to know what
              the numbers on the right mean. */}
          <li
            aria-hidden
            className="flex items-center gap-3 bg-muted/50 px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:px-4"
          >
            <span className="w-6 shrink-0" />
            <span className="w-8 shrink-0" />
            <span className="min-w-0 flex-1">Card</span>
            <span className="w-14 shrink-0 text-right">Decks</span>
            <span className="hidden w-20 shrink-0 text-right sm:block">Copies</span>
            {sort === "delta" && <span className="w-14 shrink-0 text-right">Cut</span>}
          </li>
          {rows.map((card, index) => (
            <CardRow
              key={card.key}
              card={card}
              rank={index + 1}
              deckCount={deckCount}
              decks={decks}
              allCards={cards}
              isExpanded={expanded === card.key}
              onToggle={() => setExpanded(expanded === card.key ? null : card.key)}
              showDelta={sort === "delta"}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function FilterGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <div className="inline-flex gap-1 rounded-lg bg-muted/50 p-0.5">
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={isActive}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                isActive
                  ? "bg-card font-semibold text-foreground shadow-sm"
                  : "font-medium text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CardRow({
  card,
  rank,
  deckCount,
  decks,
  allCards,
  isExpanded,
  onToggle,
  showDelta,
}: {
  card: DerivedCard;
  rank: number;
  deckCount: number;
  decks: BreakdownDeck[];
  allCards: DerivedCard[];
  isExpanded: boolean;
  onToggle: () => void;
  showDelta: boolean;
}) {
  const imageUrl = getCardImageUrl(card.imgFile);
  const deltaReliable = card.decks >= DELTA_MIN_DECKS;

  return (
    <li className="bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.04] sm:px-4"
      >
        {/* The play-rate bar is the row's own background rather than a separate
            column — it keeps the table scannable at a glance without spending
            horizontal space that mobile does not have. It fades out towards its
            end so the tint reads as a measurement rather than as a hard-edged
            rectangle sitting on the row. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/[0.14] to-primary/0"
          style={{ width: `${Math.max(card.fieldRate * 100, 0.5)}%` }}
        />

        <span className="relative w-6 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
          {rank}
        </span>

        <span className="relative h-11 w-8 shrink-0 overflow-hidden rounded bg-muted/60">
          {imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover object-top"
            />
          )}
        </span>

        <span className="relative min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{card.name}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {card.type || "—"}
            {card.brigade ? ` · ${card.brigade}` : ""}
            {card.printings.length > 1 ? ` · ${card.printings.length} printings` : ""}
          </span>
        </span>

        <span className="relative w-14 shrink-0 text-right">
          <span className="block text-sm font-semibold text-foreground tabular-nums">
            {percent(card.fieldRate)}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
            {card.decks}/{deckCount}
          </span>
        </span>

        <span className="relative hidden w-20 shrink-0 text-right sm:block">
          <span className="block text-sm text-foreground tabular-nums">{card.copies}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
            {card.mainCopies}m / {card.reserveCopies}r
          </span>
        </span>

        {showDelta && (
          <span className="relative w-14 shrink-0 text-right">
            <span
              className={`block text-sm font-semibold tabular-nums ${
                !deltaReliable
                  ? "text-muted-foreground/60"
                  : card.delta > 0.02
                    ? "text-emerald-600 dark:text-emerald-400"
                    : card.delta < -0.02
                      ? "text-muted-foreground"
                      : "text-muted-foreground"
              }`}
            >
              {signedPoints(card.delta)}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
              {deltaReliable ? `${card.topCutDecks} in cut` : "low n"}
            </span>
          </span>
        )}
      </button>

      {isExpanded && (
        <CardDetail card={card} decks={decks} allCards={allCards} deckCount={deckCount} />
      )}
    </li>
  );
}

function CardDetail({
  card,
  decks,
  allCards,
  deckCount,
}: {
  card: DerivedCard;
  decks: BreakdownDeck[];
  allCards: DerivedCard[];
  deckCount: number;
}) {
  // Cards most often sleeved alongside this one. Ranked by lift — how much more
  // often the pair appears together than the partner's own play rate predicts —
  // so universal staples don't top every single list.
  const partners = useMemo(() => {
    const own = new Set(card.deckIndexes);
    if (own.size === 0) return [];
    return allCards
      .filter((other) => other.key !== card.key && other.decks >= 2)
      .map((other) => {
        let shared = 0;
        for (const deckIndex of other.deckIndexes) if (own.has(deckIndex)) shared += 1;
        const together = shared / own.size;
        return { other, shared, together, lift: together - other.fieldRate };
      })
      .filter((entry) => entry.shared >= 2)
      .sort((a, b) => b.lift - a.lift || b.shared - a.shared)
      .slice(0, 6);
  }, [card, allCards]);

  const playedBy = useMemo(() => {
    return card.deckIndexes
      .map((index) => decks[index])
      .filter(Boolean)
      .sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity))
      .slice(0, 5);
  }, [card.deckIndexes, decks]);

  // Only worth printing when the pool spans more than one event; otherwise it
  // is the same string on every line.
  const showEvents = useMemo(
    () => new Set(decks.map((deck) => deck.event?.id).filter(Boolean)).size > 1,
    [decks],
  );

  return (
    <div className="bg-foreground/[0.03] px-3 py-4 sm:px-4">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <h3 className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Played alongside
          </h3>
          {partners.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Too few decks share this card to say.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {partners.map((entry) => (
                <li key={entry.other.key} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {entry.other.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {percent(entry.together)}
                    <span className="ml-1 text-muted-foreground/70">
                      ({signedPoints(entry.lift)})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[0.7rem] leading-relaxed text-muted-foreground/80">
            Share of this card&rsquo;s decks also running that card, and how far
            that sits above its rate across the whole field.
          </p>
        </div>

        <div className="space-y-5">
          <div>
            <h3 className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Best finishes
            </h3>
            <ul className="mt-2 space-y-1.5">
              {playedBy.map((deck) => (
                // Keyed by participant, not deck: two players can submit the
                // same published list, and across events two entries can share
                // a deck id outright.
                <li key={deck.participantId} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {deck.playerName ?? "Unnamed"}
                    {/* A finish is only readable next to the field it was
                        earned in — #1 of six is not #1 of seventy-two. */}
                    {showEvents && deck.event && (
                      <span className="ml-1 text-muted-foreground/70">{deck.event.name}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {deck.place === null ? "—" : `#${deck.place}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {card.printings.length > 1 && (
            <div>
              <h3 className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Printings merged ({card.printings.length})
              </h3>
              <ul className="mt-2 space-y-1">
                {card.printings.map((printing) => (
                  <li key={printing} className="truncate text-xs text-muted-foreground">
                    {printing}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
