"use client";

import { useState, useEffect, type ReactNode } from "react";
import type { ViewId } from "../NavTabs";
import { useSeed } from "../seed-context";
import type { MatchEntry } from "@/lib/nationals/types";
import { buildKey } from "@/lib/nationals/format";
import { recordsForKey } from "@/lib/nationals/selectors";
import { FormatBadge } from "../components/FormatBadge";
import { PlacementBadge } from "../components/PlacementBadge";
import { SectionTitle } from "../components/SectionTitle";
import { EmptyState } from "../components/EmptyState";
import { PromoCardsModal } from "../components/PromoCardsModal";
import { FantasyDraftModal } from "../components/FantasyDraftModal";
import { promosForYear } from "@/lib/nationals/promos";

// ── Helpers ──────────────────────────────────────────────────────────────────

// Turn bare URLs in freeform notes (e.g. "landofredemption.com/register") into
// clickable links. Matches http(s) URLs and bare domain/path tokens; links read
// as plain text at rest (underline, not color) and go green on hover.
function linkifyNotes(text: string): ReactNode[] {
  const urlPattern = /(https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s]*)/gi;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const raw = match[0];
    const href = raw.startsWith("http") ? raw : `https://${raw}`;
    parts.push(
      <a
        key={key++}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground underline underline-offset-2 hover:text-primary transition-colors"
      >
        {raw}
      </a>
    );
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

const MATCH_DATA_START_YEAR = 2003;
const TC_ROUND_ORDER = ["Quarterfinal", "Semifinal", "3rd Place", "Final"];

function score(a: number | null, b: number | null): string {
  if (a != null && b != null) return `${a}–${b}`;
  return "—";
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface PlayerLinkProps {
  name: string;
  setView: TournamentDetailViewProps["setView"];
}
function PlayerLink({ name, setView }: PlayerLinkProps) {
  return (
    <button
      className="hover:text-primary hover:underline text-left transition-colors"
      onClick={() => setView("player", { playerName: name, backTo: "detail" })}
    >
      {name}
    </button>
  );
}

// Teams-format: group individual matches by team-matchup note, render as one row
function TeamsRound({
  matches,
  setView,
}: {
  matches: MatchEntry[];
  setView: TournamentDetailViewProps["setView"];
}) {
  // Group by the "Teams: X vs Y" note string
  const groups: Map<string, MatchEntry[]> = new Map();
  for (const m of matches) {
    const key = (m.notes || "").replace("Teams:", "").trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }

  return (
    <>
      {[...groups.entries()].map(([groupKey, grp]) => {
        const parts = groupKey.split(" vs ");
        const sideA = parts[0]?.trim() ?? "";
        const sideB = parts[1]?.trim() ?? "";

        // Skip rows where both sides are empty
        if (!sideA && !sideB) return null;

        // BYE — only one side
        if (!sideB) {
          const aNames = sideA
            .split("/")
            .map((n) => n.trim())
            .filter(Boolean);
          return (
            <div
              key={groupKey}
              className="grid grid-cols-[1fr_80px_1fr] items-center gap-2 py-2 px-3 border-b border-border last:border-0"
            >
              <div className="flex flex-wrap gap-1">
                {aNames.map((n) => (
                  <PlayerLink key={n} name={n} setView={setView} />
                ))}
              </div>
              <div className="text-center text-xs text-muted-foreground">
                BYE
              </div>
              <div className="text-right text-muted-foreground text-sm">—</div>
            </div>
          );
        }

        const rep = grp[0];
        const sc = score(rep.scoreA, rep.scoreB);
        const aNamesArr = sideA
          .split("/")
          .map((n) => n.trim())
          .filter((n) => n && n.toLowerCase() !== "bye");
        const bNamesArr = sideB
          .split("/")
          .map((n) => n.trim())
          .filter((n) => n && n.toLowerCase() !== "bye");

        if (!aNamesArr.length && !bNamesArr.length) return null;

        const aWon =
          rep.scoreA != null && rep.scoreB != null
            ? rep.scoreA > rep.scoreB
            : grp.filter(
                (m) => m.winner && aNamesArr.includes(m.winner)
              ).length >
              grp.filter((m) => m.winner && bNamesArr.includes(m.winner))
                .length;
        const bWon =
          rep.scoreA != null && rep.scoreB != null
            ? rep.scoreB > rep.scoreA
            : !aWon && grp.some((m) => m.winner);

        return (
          <div
            key={groupKey}
            className="grid grid-cols-[1fr_80px_1fr] items-center gap-2 py-2 px-3 border-b border-border last:border-0"
          >
            <div
              className={`flex flex-wrap gap-1 ${aWon ? "text-foreground font-semibold" : bWon ? "text-muted-foreground" : ""}`}
            >
              {aNamesArr.map((n) => (
                <PlayerLink key={n} name={n} setView={setView} />
              ))}
            </div>
            <div className="text-center text-xs text-muted-foreground">
              {sc}
            </div>
            <div
              className={`flex flex-wrap gap-1 justify-end ${bWon ? "text-foreground font-semibold" : aWon ? "text-muted-foreground" : ""}`}
            >
              {bNamesArr.map((n) => (
                <PlayerLink key={n} name={n} setView={setView} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

// Standard (non-Teams) match row
function MatchRow({
  m,
  setView,
}: {
  m: MatchEntry;
  setView: TournamentDetailViewProps["setView"];
}) {
  const aW = m.winner === m.playerA;
  const bW = m.winner === m.playerB;
  const sc = score(m.scoreA, m.scoreB);

  return (
    <div className="grid grid-cols-[1fr_64px_1fr] items-center gap-2 py-2 px-3 border-b border-border last:border-0 odd:bg-muted/40">
      <div
        className={
          aW ? "text-foreground font-semibold" : bW ? "text-muted-foreground" : ""
        }
      >
        <PlayerLink name={m.playerA} setView={setView} />
      </div>
      <div className="text-center text-xs text-muted-foreground">{sc}</div>
      <div
        className={`text-right ${bW ? "text-foreground font-semibold" : aW ? "text-muted-foreground" : ""}`}
      >
        <PlayerLink name={m.playerB} setView={setView} />
      </div>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface TournamentDetailViewProps {
  tournamentId: string | null;
  setView: (
    view: ViewId,
    opts?: { tournamentId?: string; playerName?: string; backTo?: ViewId }
  ) => void;
  back: () => void;
}

// ── Main component ────────────────────────────────────────────────────────────

export function TournamentDetailView({
  tournamentId,
  setView,
  back,
}: TournamentDetailViewProps) {
  const seed = useSeed();

  const tournament = seed.tournaments.find((t) => t.id === tournamentId);

  // Format tabs — default to first format
  const formats = tournament?.formats?.length ? tournament.formats : ["General"];
  const [selectedFormat, setSelectedFormat] = useState<string>(formats[0]);

  // Modal state
  const [promoOpen, setPromoOpen] = useState(false);
  const [fantasyOpen, setFantasyOpen] = useState(false);

  // Reset selected format when the tournament changes (prev/next navigation)
  useEffect(() => {
    setSelectedFormat(formats[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  if (!tournament) {
    return <EmptyState icon="🏛️" title="Tournament not found" />;
  }

  // Prev/next tournament sorted by year
  const sorted = [...seed.tournaments].sort((a, b) => a.year - b.year);
  const idx = sorted.findIndex((t) => t.id === tournamentId);
  const prevT = idx > 0 ? sorted[idx - 1] : null;
  const nextT = idx < sorted.length - 1 ? sorted[idx + 1] : null;

  const key = buildKey(tournament.year, selectedFormat);
  const results = (seed.results[key] ?? []).slice().sort((a, b) => a.placement - b.placement);

  const matches: MatchEntry[] = seed.matches[key] ?? [];
  const hasMatchData = tournament.year >= MATCH_DATA_START_YEAR;
  const derivedRecords = recordsForKey(matches, selectedFormat);

  const swissMatches = matches.filter((m) => !m.topCut);
  const tcMatches = matches.filter((m) => m.topCut);

  // Group matches by round
  function groupByRound(ms: MatchEntry[]): Map<string, MatchEntry[]> {
    const map = new Map<string, MatchEntry[]>();
    for (const m of ms) {
      const r = m.round || "Unknown";
      if (!map.has(r)) map.set(r, []);
      map.get(r)!.push(m);
    }
    return map;
  }

  const tcByRound = groupByRound(tcMatches);
  const swissByRound = groupByRound(swissMatches);

  // Ordered top-cut rounds: known order first, then any others
  const tcRoundsSorted = [
    ...TC_ROUND_ORDER.filter((r) => tcByRound.has(r)),
    ...[...tcByRound.keys()].filter((r) => !TC_ROUND_ORDER.includes(r)),
  ];

  const isTeams = selectedFormat === "Teams";

  const navBtnClass =
    "px-3 py-1.5 text-xs text-muted-foreground border border-border rounded-md hover:text-foreground hover:border-primary transition";

  return (
    <div className="space-y-6">
      {/* ── Back button ─────────────────────────────────────────────────── */}
      <button
        onClick={back}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
      >
        ← Back
      </button>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-5">
        {/* Year nav row */}
        <div className="flex items-center justify-between mb-3">
          <div>
            {nextT && (
              <button
                className={navBtnClass}
                onClick={() =>
                  setView("detail", { tournamentId: nextT.id, backTo: "tournaments" })
                }
              >
                ◀ {nextT.year}
              </button>
            )}
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground text-center">
            {tournament.year} Redemption Nationals
          </h2>
          <div>
            {prevT && (
              <button
                className={navBtnClass}
                onClick={() =>
                  setView("detail", { tournamentId: prevT.id, backTo: "tournaments" })
                }
              >
                {prevT.year} ▶
              </button>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground mb-3">
          {tournament.location && (
            <span>
              <span className="mr-1">📍</span>
              <span className="font-medium text-foreground">
                {tournament.location}
              </span>
            </span>
          )}
          {tournament.venue && (
            <span>
              <span className="mr-1">🏛️</span>
              <span className="font-medium text-foreground">
                {tournament.venue}
              </span>
            </span>
          )}
          {tournament.dates && (
            <span>
              <span className="mr-1">📅</span>
              <span className="font-medium text-foreground">
                {tournament.dates}
              </span>
            </span>
          )}
          {tournament.attendance && (
            <span>
              <span className="mr-1">👥</span>
              <span className="font-medium text-foreground">
                {tournament.attendance} players
              </span>
            </span>
          )}
        </div>

        {/* Notes */}
        {tournament.notes && (
          <p className="text-sm text-muted-foreground mb-3">{linkifyNotes(tournament.notes)}</p>
        )}

        {/* ── Action buttons row ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {promosForYear(tournament.year).length > 0 && (
            <button
              onClick={() => setPromoOpen(true)}
              className="px-3 py-1.5 text-xs text-muted-foreground border border-border rounded-md hover:text-foreground hover:border-primary transition"
            >
              🎴 Promo Cards
            </button>
          )}
          {tournament.fantasyDraft && (
            <button
              onClick={() => setFantasyOpen(true)}
              className="px-3 py-1.5 text-xs text-muted-foreground border border-border rounded-md hover:text-foreground hover:border-primary transition"
            >
              🏆 Fantasy Draft
            </button>
          )}
        </div>

        {/* ── Modals ───────────────────────────────────────────────────── */}
        {promoOpen && (
          <PromoCardsModal year={tournament.year} open={promoOpen} onClose={() => setPromoOpen(false)} />
        )}
        {tournament.fantasyDraft && fantasyOpen && (
          <FantasyDraftModal
            year={tournament.year}
            fantasyDraft={tournament.fantasyDraft}
            open={fantasyOpen}
            onClose={() => setFantasyOpen(false)}
          />
        )}
      </div>

      {/* ── Format filter tabs ───────────────────────────────────────────── */}
      <div className="flex items-center flex-wrap gap-1 border-b border-border pb-0">
        {formats.map((f) => (
          <button
            key={f}
            onClick={() => setSelectedFormat(f)}
            className={
              f === selectedFormat
                ? "shrink-0 px-4 py-3 text-sm font-medium text-primary border-b-2 border-primary"
                : "shrink-0 px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground border-b-2 border-transparent"
            }
          >
            {f}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 pb-1">
          <FormatBadge format={selectedFormat} />
        </div>
      </div>

      {/* ── Standings ───────────────────────────────────────────────────── */}
      <div>
        <SectionTitle
          title="Standings"
          sub={`${results.length} ${results.length === 1 ? "entry" : "entries"}`}
        />
        {results.length ? (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-20">
                    Place
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Player
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">
                    Deck
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">
                    Record
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden lg:table-cell">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-border last:border-0 odd:bg-muted/40"
                  >
                    <td className="px-4 py-2.5">
                      <PlacementBadge place={r.placement} />
                    </td>
                    <td className="px-4 py-2.5 font-medium">
                      <PlayerLink name={r.playerName} setView={setView} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                      {r.deck || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">
                      {r.record || derivedRecords[r.playerName] || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">
                      {r.notes || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="📋" title="No standings recorded" />
        )}
      </div>

      {/* ── Match data (only for tournaments with match data) ──────────── */}
      {hasMatchData && (
        <>
          {/* ── Top Cut Bracket ─────────────────────────────────────────── */}
          {tcMatches.length > 0 && (
            <div>
              <SectionTitle
                title="Top Cut Bracket"
                sub={`${tcMatches.length} match${tcMatches.length === 1 ? "" : "es"}`}
              />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {tcRoundsSorted.map((round) => {
                  const ms = tcByRound.get(round)!;
                  return (
                    <div
                      key={round}
                      className="rounded-lg border border-amber-500/40 bg-card overflow-hidden"
                    >
                      <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/30 text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">
                        {round}
                      </div>
                      {ms.map((m) => (
                        <MatchRow key={m.id} m={m} setView={setView} />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Swiss Rounds ─────────────────────────────────────────────── */}
          <div>
            <SectionTitle
              title="Swiss Rounds"
              sub={`${swissMatches.length} match${swissMatches.length === 1 ? "" : "es"}`}
            />
            {swissMatches.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[...swissByRound.entries()].map(([round, ms]) => (
                  <div
                    key={round}
                    className="rounded-lg border border-border bg-card overflow-hidden"
                  >
                    <div className="px-3 py-2 bg-muted border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {round}
                    </div>
                    {isTeams ? (
                      <TeamsRound matches={ms} setView={setView} />
                    ) : (
                      ms.map((m) => (
                        <MatchRow key={m.id} m={m} setView={setView} />
                      ))
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon="🎮" title="No match data recorded" />
            )}
          </div>
        </>
      )}
    </div>
  );
}
