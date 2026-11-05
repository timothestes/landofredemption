"use client";

import { useState, useMemo } from "react";
import { Search } from "lucide-react";
import type { ViewId } from "../NavTabs";
import { useSeed } from "../seed-context";
import { SectionTitle } from "../components/SectionTitle";
import { EmptyState } from "../components/EmptyState";
import { globalSearch } from "@/lib/nationals/search";

interface SearchViewProps {
  setView: (
    view: ViewId,
    opts?: { tournamentId?: string; playerName?: string; backTo?: ViewId }
  ) => void;
}

export function SearchView({ setView }: SearchViewProps) {
  const seed = useSeed();
  const [query, setQuery] = useState("");

  const results = useMemo(
    () => globalSearch(seed, query),
    [seed, query]
  );

  const hasQuery = query.trim().length > 0;
  const hasResults = results.players.length > 0 || results.tournaments.length > 0;

  return (
    <div>
      <SectionTitle title="Search" sub="Players and tournaments" />

      <div className="mb-6">
        <input
          type="search"
          placeholder="Search players, locations, years…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full max-w-md px-3 py-2 text-sm rounded-md border border-border bg-card text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary transition"
          autoFocus
        />
      </div>

      {!hasQuery && (
        <EmptyState icon={Search} title="Type to search players and tournaments" />
      )}

      {hasQuery && !hasResults && (
        <EmptyState icon={Search} title={`No results for "${query.trim()}"`} />
      )}

      {hasResults && (
        <div className="space-y-6">
          {results.players.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Players ({results.players.length})
              </h3>
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {results.players.map((p) => (
                      <tr
                        key={p.id || p.name}
                        className="border-b border-border last:border-0 odd:bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors"
                        onClick={() =>
                          setView("player", {
                            playerName: p.name,
                            backTo: "search",
                          })
                        }
                      >
                        <td className="px-4 py-2.5 font-medium text-foreground hover:text-primary hover:underline transition-colors">
                          {p.name}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">
                          {p.handle ? `@${p.handle}` : p.region || ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {results.tournaments.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Tournaments ({results.tournaments.length})
              </h3>
              <div className="rounded-lg border border-border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    {results.tournaments.map((t) => (
                      <tr
                        key={t.id}
                        className="border-b border-border last:border-0 odd:bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors"
                        onClick={() =>
                          setView("detail", {
                            tournamentId: t.id,
                            backTo: "search",
                          })
                        }
                      >
                        <td className="px-4 py-2.5 font-medium text-foreground hover:text-primary hover:underline transition-colors">
                          {t.year} Nationals
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">
                          {t.location || ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
