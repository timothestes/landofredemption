"use client";

import { useState, useMemo } from "react";
import { User } from "lucide-react";
import type { ViewId } from "../NavTabs";
import { useSeed } from "../seed-context";
import { SectionTitle } from "../components/SectionTitle";
import { EmptyState } from "../components/EmptyState";

interface PlayersViewProps {
  setView: (
    view: ViewId,
    opts?: { tournamentId?: string; playerName?: string; backTo?: ViewId }
  ) => void;
}

export function PlayersView({ setView }: PlayersViewProps) {
  const seed = useSeed();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return [...seed.players]
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.handle || "").toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [seed.players, query]);

  return (
    <div>
      <SectionTitle
        title="Players"
        sub={
          query
            ? `${filtered.length} of ${seed.players.length} players`
            : `${seed.players.length} player${seed.players.length === 1 ? "" : "s"}`
        }
      />

      {/* Search input — no focus:ring-* per project preference */}
      <div className="mb-4">
        <input
          type="search"
          placeholder="Search by name or handle…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full max-w-sm px-3 py-2 text-sm rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary transition"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={User} title="No players found" />
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Player
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">
                  Handle
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">
                  Region
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.id || p.name}
                  className="border-b border-border last:border-0 odd:bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors"
                  onClick={() =>
                    setView("player", { playerName: p.name, backTo: "players" })
                  }
                >
                  <td className="px-4 py-2.5 font-medium text-foreground hover:text-primary hover:underline transition-colors">
                    {p.name}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                    {p.handle ? `@${p.handle}` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">
                    {p.region || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
