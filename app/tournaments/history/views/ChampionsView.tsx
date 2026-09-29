"use client";

import { useState, useMemo } from "react";
import type { ViewId } from "../NavTabs";
import { useSeed } from "../seed-context";
import { buildChampionData, getAllFormats } from "@/lib/nationals/selectors";
import { FormatBadge } from "../components/FormatBadge";
import { SectionTitle } from "../components/SectionTitle";
import { EmptyState } from "../components/EmptyState";

type SortKey = "wins" | "name" | "recent" | "oldest";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "wins", label: "Most Wins" },
  { key: "name", label: "Name A-Z" },
  { key: "recent", label: "Most Recent" },
  { key: "oldest", label: "Oldest Win" },
];

interface ChampionsViewProps {
  setView: (
    view: ViewId,
    opts?: { tournamentId?: string; playerName?: string; backTo?: ViewId }
  ) => void;
}

export function ChampionsView({ setView }: ChampionsViewProps) {
  const seed = useSeed();
  const [format, setFormat] = useState<string>("All");
  const [sort, setSort] = useState<SortKey>("wins");

  const allFormats = useMemo(() => getAllFormats(seed), [seed]);
  const champions = useMemo(() => buildChampionData(seed), [seed]);

  const filtered = useMemo(() => {
    if (format === "All") return champions;
    // Scope each champion's card to just the selected format's wins/years/badge.
    return champions
      .filter((c) => c.formats.includes(format))
      .map((c) => ({
        ...c,
        wins: c.byFormat[format].length,
        years: c.byFormat[format],
        formats: [format],
      }));
  }, [champions, format]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sort) {
      case "wins":
        return arr.sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
      case "name":
        return arr.sort((a, b) => a.name.localeCompare(b.name));
      case "recent":
        return arr.sort(
          (a, b) =>
            Math.max(...b.years) - Math.max(...a.years) ||
            b.wins - a.wins
        );
      case "oldest":
        return arr.sort(
          (a, b) =>
            Math.min(...a.years) - Math.min(...b.years) ||
            a.name.localeCompare(b.name)
        );
      default:
        return arr;
    }
  }, [filtered, sort]);

  if (!champions.length) {
    return <EmptyState icon="🏆" title="No champions yet" />;
  }

  return (
    <div>
      <SectionTitle
        title="Hall of Champions"
        sub={`${sorted.length} champion${sorted.length === 1 ? "" : "s"}`}
      />

      {/* Format filter tabs */}
      <div className="flex flex-wrap gap-x-1 gap-y-1 border-b border-border mb-3">
        {["All", ...allFormats].map((f) => (
          <button
            key={f}
            onClick={() => setFormat(f)}
            className={[
              "px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              format === f
                ? "text-primary border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground",
            ].join(" ")}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Sort tabs */}
      <div className="flex flex-wrap gap-x-1 gap-y-1 mb-4">
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setSort(opt.key)}
            className={[
              "px-3 py-1 text-xs font-medium rounded-full border transition-colors",
              sort === opt.key
                ? "text-primary border-primary bg-primary/10"
                : "text-muted-foreground border-border hover:text-foreground",
            ].join(" ")}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <EmptyState icon="🏆" title={`No champions in ${format}`} />
      ) : (
        <div className="grid gap-4 justify-start [grid-template-columns:repeat(auto-fill,minmax(210px,300px))]">
          {sorted.map((c) => (
            <div
              key={c.name}
              role="button"
              tabIndex={0}
              className="group cursor-pointer rounded-lg border border-border bg-card p-5 transition hover:border-primary hover:shadow-lg hover:-translate-y-0.5 relative overflow-hidden focus-visible:border-primary focus-visible:outline-none"
              onClick={() =>
                setView("player", { playerName: c.name, backTo: "champions" })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setView("player", { playerName: c.name, backTo: "champions" });
                }
              }}
            >
              {/* top accent bar */}
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />

              {/* Win count — amber/gold accent */}
              <div className="text-3xl font-bold tabular-nums leading-none mb-1 text-amber-600 dark:text-amber-400 [.jayden_&]:text-amber-300">
                {c.wins}×
              </div>

              {/* Name */}
              <div className="text-sm font-semibold text-foreground mb-1 leading-tight">
                {c.name}
              </div>

              {/* Years */}
              <div className="text-xs text-muted-foreground mb-3">
                {c.years.join(", ")}
              </div>

              {/* Format badges */}
              {c.formats.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {c.formats.map((f) => (
                    <FormatBadge key={f} format={f} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
