"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TournamentBreakdown } from "@/lib/tournament/breakdown";

type SortKey = "place" | "spice" | "size";

/**
 * How the lists relate to each other.
 *
 * "Unique" counts cards no other deck in the field played; the share of a
 * deck's card pool that is unique is its spice. Neighbours are ranked by
 * Jaccard overlap on distinct cards, which surfaces archetypes without anyone
 * having to name them.
 */
export default function DeckDna({ breakdown }: { breakdown: TournamentBreakdown }) {
  const [sort, setSort] = useState<SortKey>("place");

  const decks = useMemo(() => {
    const rows = [...breakdown.decks];
    rows.sort((a, b) => {
      switch (sort) {
        case "spice":
          return b.spice - a.spice;
        case "size":
          return b.mainSize - a.mainSize;
        default:
          return (a.place ?? Infinity) - (b.place ?? Infinity);
      }
    });
    return rows;
  }, [breakdown.decks, sort]);

  const maxSpice = Math.max(...breakdown.decks.map((d) => d.spice), 0.0001);

  // With one event in the pool the name is the same on every row, and the
  // header above already says so — it only earns its space when it varies.
  const showEvents = breakdown.events.length > 1;

  return (
    <section className="space-y-4">
      <header className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">Deck DNA</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Every published list, with the cards nobody else played and the three
          lists it most resembles. High overlap between two decks usually means
          the same archetype, whatever their builders called it.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Sort
          </span>
          <div className="inline-flex gap-1 rounded-lg bg-muted/50 p-0.5">
            {[
              { value: "place" as const, label: "Finish" },
              { value: "spice" as const, label: "Most unique" },
              { value: "size" as const, label: "Deck size" },
            ].map((option) => {
              const isActive = option.value === sort;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSort(option.value)}
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
      </header>

      <ul className="space-y-2">
        {decks.map((deck) => (
          <li key={deck.participantId} className="rounded-xl bg-card px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="text-sm font-semibold text-muted-foreground tabular-nums">
                  {deck.place === null ? "—" : `#${deck.place}`}
                </span>
                <Link
                  href={`/decklist/${deck.deckId}`}
                  className="truncate text-sm font-medium text-foreground underline-offset-2 hover:text-primary hover:underline"
                >
                  {deck.playerName ?? "Unnamed"}
                </Link>
                {/* Two players bringing one list is a real finding, not a
                    duplicate row — call it out where it happens. */}
                {deck.neighbors[0]?.similarity === 1 && (
                  <span className="truncate rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                    Same list as {deck.neighbors[0].playerName ?? "another player"}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground tabular-nums">
                {/* Across events a placement is meaningless without its field,
                    so the event rides alongside it. */}
                {showEvents && deck.event && (
                  <span className="truncate font-medium not-italic text-muted-foreground/80">
                    {deck.event.name}
                  </span>
                )}
                <span>
                  {deck.mainSize} main · {deck.reserveSize} reserve · {deck.lostSouls} souls
                </span>
              </div>
            </div>

            <div className="mt-2.5 grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-center">
              <div className="flex items-center gap-2">
                <span className="h-2 w-full max-w-[7rem] overflow-hidden rounded-full bg-foreground/[0.06]">
                  <span
                    className="block h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.max((deck.spice / maxSpice) * 100, 2)}%` }}
                  />
                </span>
                <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                  {deck.uniqueCards} unique ({Math.round(deck.spice * 100)}%)
                </span>
              </div>

              <div className="min-w-0 text-xs text-muted-foreground">
                {deck.neighbors.length === 0 ? (
                  <span>No comparable lists.</span>
                ) : (
                  <span className="truncate block">
                    <span className="font-semibold uppercase tracking-[0.1em] text-[0.65rem]">
                      Closest
                    </span>{" "}
                    {deck.neighbors
                      .map((n) => `${n.playerName ?? "Unnamed"} ${Math.round(n.similarity * 100)}%`)
                      .join(" · ")}
                    {/* A near-identical list from a different event is the most
                        interesting thing this panel can find — say so. */}
                    {deck.neighbors[0] &&
                      deck.neighbors[0].similarity >= 0.6 &&
                      deck.neighbors[0].eventName &&
                      deck.neighbors[0].eventName !== deck.event?.name && (
                        <span className="ml-1 text-muted-foreground/70">
                          (from {deck.neighbors[0].eventName})
                        </span>
                      )}
                  </span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
