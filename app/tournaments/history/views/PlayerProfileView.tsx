"use client";

import { useMemo, useState, useEffect } from "react";
import type { ViewId } from "../NavTabs";
import { useSeed } from "../seed-context";
import { playerProfile } from "@/lib/nationals/selectors";
import { FormatBadge } from "../components/FormatBadge";
import { PlacementBadge } from "../components/PlacementBadge";
import { SectionTitle } from "../components/SectionTitle";
import { EmptyState } from "../components/EmptyState";

const MATCH_DATA_START_YEAR = 2003;

// Long tables (Head-to-Head, Career History, Fantasy Draft History) preview
// this many rows by default with a "Show all" toggle, so the profile page
// doesn't grow unbounded as more years/opponents accumulate.
const PREVIEW_ROWS = 5;

function ShowMoreRow({
  expanded,
  totalCount,
  onToggle,
}: {
  expanded: boolean;
  totalCount: number;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full px-4 py-2 text-xs font-medium text-primary hover:bg-muted/50 border-t border-border text-center transition"
    >
      {expanded ? "Show less" : `Show all ${totalCount}`}
    </button>
  );
}

interface PlayerProfileViewProps {
  playerName: string | null;
  setView: (
    view: ViewId,
    opts?: { tournamentId?: string; playerName?: string; backTo?: ViewId }
  ) => void;
  back: () => void;
}

export function PlayerProfileView({
  playerName,
  setView,
  back,
}: PlayerProfileViewProps) {
  const seed = useSeed();

  const profile = useMemo(
    () => (playerName ? playerProfile(seed, playerName) : null),
    [seed, playerName]
  );

  const [showAllH2H, setShowAllH2H] = useState(false);
  const [showAllCareer, setShowAllCareer] = useState(false);
  const [showAllFantasy, setShowAllFantasy] = useState(false);
  useEffect(() => {
    setShowAllH2H(false);
    setShowAllCareer(false);
    setShowAllFantasy(false);
  }, [playerName]);

  if (!profile) {
    return <EmptyState icon="👤" title="Player not found" />;
  }

  const {
    name,
    handle,
    region,
    initials,
    appearances,
    bestPlacement,
    championships,
    placements,
    matchStatsByFmt,
    matchStatsByOpp,
    allMatches,
    tp2Wins,
    tp2Losses,
    tp2Draws,
    tp2WinPct,
    avgFieldPct,
    topCutWins,
    topCutLosses,
    topCutWinPct,
    multiWLByFmt,
    multiWins,
    multiLosses,
    multiDraws,
    multiWinPct,
    hasMulti,
    fantasyDraftHistory,
  } = profile;

  const tcTotal = topCutWins + topCutLosses;
  const hasMatchData = allMatches.length > 0;
  const hasFmtStats = Object.keys(matchStatsByFmt).length > 0;
  const hasOppStats = Object.keys(matchStatsByOpp).length > 0;

  // Sorted top-cut matches newest-first
  const topCutMatches = allMatches
    .filter((m) => m.topCut)
    .sort((a, b) => b.year - a.year);

  // Sorted opponents by total decisive games desc
  const sortedOpponents = Object.entries(matchStatsByOpp).sort(
    ([, a], [, b]) => b.wins + b.losses - (a.wins + a.losses)
  );
  const visibleOpponents = showAllH2H
    ? sortedOpponents
    : sortedOpponents.slice(0, PREVIEW_ROWS);
  const visiblePlacements = showAllCareer
    ? placements
    : placements.slice(0, PREVIEW_ROWS);
  const visibleFantasyDraftHistory = showAllFantasy
    ? fantasyDraftHistory
    : fantasyDraftHistory.slice(0, PREVIEW_ROWS);

  // Check if opponent is a known player (for linking)
  const playerNames = new Set(seed.players.map((p) => p.name));

  const statValueClass = "text-2xl font-bold leading-none tabular-nums";
  const statLabelClass = "text-xs text-muted-foreground mt-1 uppercase tracking-wide";

  return (
    <div className="space-y-6">
      {/* ── Back button ──────────────────────────────────────────────────── */}
      <button
        onClick={back}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
      >
        ← Back
      </button>

      {/* ── Profile header card ───────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-5 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />

        {/* Avatar + identity */}
        <div className="flex items-center gap-4 mb-5">
          <div className="flex-shrink-0 w-14 h-14 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center text-xl font-bold text-primary">
            {initials}
          </div>
          <div>
            <div className="text-xl font-bold tracking-tight text-foreground leading-tight">
              {name}
            </div>
            {(handle || region) && (
              <div className="text-sm text-muted-foreground mt-0.5">
                {handle && <span>@{handle}</span>}
                {handle && region && <span className="mx-1">·</span>}
                {region && <span>{region}</span>}
              </div>
            )}
          </div>
        </div>

        {/* ── Two-column layout: career overview + multiplayer ─────────── */}
        <div className="flex flex-wrap gap-8 items-start">

          {/* Left: Career overview + 2P/Teams record */}
          <div className="flex-1 min-w-[240px]">
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Career Overview
            </div>
            <div className="flex flex-wrap gap-5 mb-4">
              <div>
                <div className={statValueClass}>{appearances}</div>
                <div className={statLabelClass}>Appearances</div>
              </div>
              <div>
                <div className={statValueClass}>
                  {bestPlacement != null ? (
                    <PlacementBadge place={bestPlacement} />
                  ) : (
                    "—"
                  )}
                </div>
                <div className={statLabelClass}>Best Finish</div>
              </div>
              {championships > 0 && (
                <div>
                  <div className={`${statValueClass} text-amber-600 dark:text-amber-400 [.jayden_&]:text-amber-300`}>
                    {championships}
                  </div>
                  <div className={statLabelClass}>Titles</div>
                </div>
              )}
              {(() => {
                const podiums = placements.filter(
                  (h) => h.placement && h.placement <= 3
                ).length;
                return podiums > 0 ? (
                  <div>
                    <div className={statValueClass}>{podiums}</div>
                    <div className={statLabelClass}>Podiums</div>
                  </div>
                ) : null;
              })()}
            </div>

            {/* 2P & Teams record summary (only if match data exists) */}
            {hasMatchData && (
              <>
                <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3 mt-4">
                  2P &amp; Teams Record
                </div>
                <div className="flex flex-wrap gap-5">
                  <div>
                    <div className={`${statValueClass} text-green-600 dark:text-green-400`}>
                      {tp2Wins}
                    </div>
                    <div className={statLabelClass}>Wins</div>
                  </div>
                  <div>
                    <div className={`${statValueClass} text-red-600 dark:text-red-400`}>
                      {tp2Losses}
                    </div>
                    <div className={statLabelClass}>Losses</div>
                  </div>
                  {tp2Draws > 0 && (
                    <div>
                      <div className={`${statValueClass} text-muted-foreground`}>
                        {tp2Draws}
                      </div>
                      <div className={statLabelClass}>Draws</div>
                    </div>
                  )}
                  <div>
                    <div className={statValueClass}>{tp2WinPct}</div>
                    <div className={statLabelClass}>Win %</div>
                  </div>
                  {avgFieldPct != null && (
                    <div>
                      <div className={statValueClass}>{avgFieldPct.toFixed(1)}%</div>
                      <div className={statLabelClass}>Field %</div>
                    </div>
                  )}
                  {tcTotal > 0 && (
                    <div>
                      <div className={statValueClass}>
                        {topCutWins}–{topCutLosses}
                      </div>
                      <div className={statLabelClass}>Top Cut</div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Right: Multiplayer record (only if data exists) */}
          {hasMulti && (
            <div className="flex-1 min-w-[200px] border-l border-border pl-6">
              <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                Multiplayer Record
              </div>
              <div className="text-xs text-muted-foreground mb-3">
                Round robin · draws excluded from win %
              </div>
              <div className="flex flex-wrap gap-5 mb-3">
                <div>
                  <div className={`${statValueClass} text-green-600 dark:text-green-400`}>
                    {multiWins}
                  </div>
                  <div className={statLabelClass}>Wins</div>
                </div>
                <div>
                  <div className={`${statValueClass} text-red-600 dark:text-red-400`}>
                    {multiLosses}
                  </div>
                  <div className={statLabelClass}>Losses</div>
                </div>
                {multiDraws > 0 && (
                  <div>
                    <div className={`${statValueClass} text-muted-foreground`}>
                      {multiDraws}
                    </div>
                    <div className={statLabelClass}>Draws</div>
                  </div>
                )}
                <div>
                  <div className={statValueClass}>{multiWinPct}</div>
                  <div className={statLabelClass}>Win %</div>
                </div>
              </div>
              {/* Format badges for multiplayer */}
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(multiWLByFmt)
                  .sort()
                  .map((f) => (
                    <FormatBadge key={f} format={f} />
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Match data disclaimer ─────────────────────────────────────────── */}
      {hasMatchData && (
        <p className="text-xs text-muted-foreground border border-border/50 bg-muted/30 rounded-md px-3 py-2">
          Match statistics include data from {MATCH_DATA_START_YEAR}–present.
          {hasMulti &&
            " Multiplayer W/L covers 2005–2021 (T1/T2) and 2005–2017 (Booster Draft Multi)."}
          {" "}Placement history reflects all available years.
        </p>
      )}

      {/* ── 2P & Teams — Record by Format ────────────────────────────────── */}
      {hasFmtStats && (
        <div>
          <SectionTitle
            title="2P & Teams — Record by Format"
            sub="Decisive games only (draws excluded from win %)"
          />
          <div className="rounded-lg border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Format
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    W
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    L
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    D
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Win %
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(matchStatsByFmt)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([fmt, s]) => {
                    const decisive = s.wins + s.losses;
                    const pct =
                      decisive > 0
                        ? ((s.wins / decisive) * 100).toFixed(1) + "%"
                        : "—";
                    return (
                      <tr
                        key={fmt}
                        className="border-b border-border last:border-0 odd:bg-muted/40"
                      >
                        <td className="px-4 py-2.5">
                          <FormatBadge format={fmt} />
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-green-600 dark:text-green-400">
                          {s.wins}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-red-600 dark:text-red-400">
                          {s.losses}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {s.draws}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold">
                          {pct}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Multiplayer — Record by Format ───────────────────────────────── */}
      {hasMulti && (
        <div>
          <SectionTitle
            title="Multiplayer — Record by Format"
            sub="Round robin · draws excluded from win %"
          />
          <div className="rounded-lg border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Format
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    W
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    L
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    D
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Win %
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(multiWLByFmt)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([fmt, v]) => {
                    const decisive = (v.W || 0) + (v.L || 0);
                    const pct =
                      decisive > 0
                        ? (((v.W || 0) / decisive) * 100).toFixed(1) + "%"
                        : "—";
                    return (
                      <tr
                        key={fmt}
                        className="border-b border-border last:border-0 odd:bg-muted/40"
                      >
                        <td className="px-4 py-2.5">
                          <FormatBadge format={fmt} />
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-green-600 dark:text-green-400">
                          {v.W || 0}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-red-600 dark:text-red-400">
                          {v.L || 0}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {v.D || 0}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold">
                          {pct}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Top Cut Record ────────────────────────────────────────────────── */}
      {topCutMatches.length > 0 && (
        <div>
          <SectionTitle
            title="Top Cut Record"
            sub={`${topCutWins}W–${topCutLosses}L · ${topCutWinPct}`}
          />
          <p className="text-xs text-muted-foreground mb-3">
            Single-elimination bracket play. No scores recorded — win/loss only.
          </p>
          <div className="rounded-lg border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Year
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Format
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Round
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Opponent
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody>
                {topCutMatches.map((m) => {
                  const opp = m.playerA === name ? m.playerB : m.playerA;
                  const won = m.winner === name;
                  return (
                    <tr
                      key={m.id}
                      className="border-b border-border last:border-0 odd:bg-muted/40"
                    >
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {m.year}
                      </td>
                      <td className="px-4 py-2.5">
                        <FormatBadge format={m.format} />
                      </td>
                      <td className="px-4 py-2.5 font-semibold">{m.round}</td>
                      <td className="px-4 py-2.5">
                        {playerNames.has(opp) ? (
                          <button
                            className="hover:text-primary hover:underline text-left transition-colors"
                            onClick={() =>
                              setView("player", {
                                playerName: opp,
                                backTo: "player",
                              })
                            }
                          >
                            {opp}
                          </button>
                        ) : (
                          opp
                        )}
                      </td>
                      <td
                        className={`px-4 py-2.5 font-semibold ${won ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
                      >
                        {won ? "Win" : "Loss"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Head-to-Head (per opponent) ───────────────────────────────────── */}
      {hasOppStats && (
        <div>
          <SectionTitle
            title="Head-to-Head"
            sub={`${sortedOpponents.length} opponent${sortedOpponents.length === 1 ? "" : "s"}`}
          />
          <div className="rounded-lg border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Opponent
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    W
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    L
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    D
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Win %
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleOpponents.map(([opp, s]) => {
                  const decisive = s.wins + s.losses;
                  const pct =
                    decisive > 0
                      ? ((s.wins / decisive) * 100).toFixed(1) + "%"
                      : "—";
                  return (
                    <tr
                      key={opp}
                      className="border-b border-border last:border-0 odd:bg-muted/40"
                    >
                      <td className="px-4 py-2.5 font-medium">
                        {playerNames.has(opp) ? (
                          <button
                            className="hover:text-primary hover:underline text-left transition-colors"
                            onClick={() =>
                              setView("player", {
                                playerName: opp,
                                backTo: "player",
                              })
                            }
                          >
                            {opp}
                          </button>
                        ) : (
                          opp
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-green-600 dark:text-green-400">
                        {s.wins}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-red-600 dark:text-red-400">
                        {s.losses}
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">
                        {s.draws}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">
                        {pct}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {sortedOpponents.length > PREVIEW_ROWS && (
              <ShowMoreRow
                expanded={showAllH2H}
                totalCount={sortedOpponents.length}
                onToggle={() => setShowAllH2H((v) => !v)}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Career History ────────────────────────────────────────────────── */}
      {placements.length > 0 && (
        <div>
          <SectionTitle title="Career History" />
          <div className="rounded-lg border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Year
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Format
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Place
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Field
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Field %
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
                {visiblePlacements.map((h) => (
                  <tr
                    key={h.id}
                    className="border-b border-border last:border-0 odd:bg-muted/40"
                  >
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {h.year}
                    </td>
                    <td className="px-4 py-2.5">
                      <FormatBadge format={h.format} />
                    </td>
                    <td className="px-4 py-2.5">
                      {h.placement ? (
                        <PlacementBadge place={h.placement} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {h.fieldSize != null ? `${h.fieldSize} players` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {h.fieldPct != null ? `${h.fieldPct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">
                      {h.deck || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">
                      {h.matchRecord || h.record || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground hidden lg:table-cell">
                      {h.notes || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {placements.length > PREVIEW_ROWS && (
              <ShowMoreRow
                expanded={showAllCareer}
                totalCount={placements.length}
                onToggle={() => setShowAllCareer((v) => !v)}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Fantasy Draft History ─────────────────────────────────────────── */}
      {fantasyDraftHistory.length > 0 && (
        <div>
          <SectionTitle
            title="Fantasy Draft History"
            sub={`${fantasyDraftHistory.length} appearance${fantasyDraftHistory.length === 1 ? "" : "s"}`}
          />
          <div className="rounded-lg border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Year
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    GM
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Pick
                  </th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Pts
                  </th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">
                    Breakdown
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleFantasyDraftHistory.map((fd, i) => (
                  <tr
                    key={`${fd.year}-${fd.gmName}-${i}`}
                    className="border-b border-border last:border-0 odd:bg-muted/40"
                  >
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {fd.year}
                    </td>
                    <td className="px-4 py-2.5 font-medium">{fd.gmName}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      #{fd.draftPick}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">
                      {fd.pts}
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {fd.breakdown.map((b) => (
                          <span
                            key={b.format}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                          >
                            <FormatBadge format={b.format} />
                            <span className="font-semibold text-foreground">
                              {b.pts}
                            </span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {fantasyDraftHistory.length > PREVIEW_ROWS && (
              <ShowMoreRow
                expanded={showAllFantasy}
                totalCount={fantasyDraftHistory.length}
                onToggle={() => setShowAllFantasy((v) => !v)}
              />
            )}
          </div>
        </div>
      )}

      {/* Empty state for players with no data at all */}
      {placements.length === 0 && !hasMatchData && !hasMulti && (
        <EmptyState icon="📋" title="No recorded history for this player" />
      )}
    </div>
  );
}
