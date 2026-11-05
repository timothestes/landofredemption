"use client";

import { useState } from "react";
import { HiX } from "react-icons/hi";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from "@/components/ui/dialog";
import type { FantasyDraft, FantasyTeam } from "@/lib/nationals/types";

interface FantasyDraftModalProps {
  year: number;
  fantasyDraft: FantasyDraft;
  open: boolean;
  onClose: () => void;
}

const PLACES = ["1st", "2nd", "3rd"];

/** Amber/gold accent for 1st; muted silver for 2nd; bronze-ish for 3rd; plain for rest. */
function rankScoreClass(index: number): string {
  if (index === 0) return "text-amber-600 dark:text-amber-400 font-bold";
  if (index === 1) return "text-slate-500 dark:text-slate-300 font-bold";
  if (index === 2) return "text-orange-600 dark:text-orange-400 font-bold";
  return "text-foreground font-semibold";
}

function RosterRow({ team, rank }: { team: FantasyTeam; rank: number }) {
  const [open, setOpen] = useState(rank === 0); // expand top team by default
  const topPlayer = [...team.players].sort((a, b) => b.pts - a.pts)[0];

  return (
    <div className="rounded-md border border-border overflow-hidden">
      {/* Summary row — clicking toggles the roster */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-muted/40 hover:bg-muted/70 transition text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-base leading-none">{PLACES[rank] ?? `${rank + 1}th`}</span>
          <span className="font-medium text-foreground truncate">{team.gm}</span>
        </span>
        <span className="flex items-center gap-3 shrink-0">
          {topPlayer && (
            <span className="hidden sm:block text-xs text-muted-foreground truncate max-w-[140px]">
              Top: {topPlayer.name} ({topPlayer.pts}pts)
            </span>
          )}
          <span className={rankScoreClass(rank)}>{team.pts} pts</span>
          <span className="text-muted-foreground text-xs">{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {/* Expanded roster */}
      {open && (
        <div className="px-4 py-2 space-y-1 border-t border-border">
          {[...team.players].sort((a, b) => b.pts - a.pts).map((player) => (
            <div
              key={player.name}
              className="flex items-center justify-between py-1 border-b border-border last:border-0"
            >
              <span className="text-sm text-foreground">
                {player.name}
                {player.draftPick ? (
                  <span className="ml-1.5 text-xs text-muted-foreground">#{player.draftPick}</span>
                ) : null}
              </span>
              <span className="text-sm font-semibold text-foreground">{player.pts} pts</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FantasyDraftModal({ year, fantasyDraft, open, onClose }: FantasyDraftModalProps) {
  const sorted = [...fantasyDraft.teams].sort((a, b) => b.pts - a.pts);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="md">
        <DialogHeader className="relative">
          <DialogTitle>{year} Nationals Fantasy Draft</DialogTitle>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
          >
            <HiX className="h-4 w-4" />
          </button>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {/* Standings table */}
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-12">Place</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">GM</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Score</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Top Performer</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((team, i) => {
                  const top = [...team.players].sort((a, b) => b.pts - a.pts)[0];
                  return (
                    <tr key={team.gm} className="border-b border-border last:border-0 odd:bg-muted/20">
                      <td className="px-3 py-2 text-sm">{PLACES[i] ?? `${i + 1}th`}</td>
                      <td className="px-3 py-2 font-medium text-foreground">{team.gm}</td>
                      <td className={`px-3 py-2 text-right ${rankScoreClass(i)}`}>{team.pts}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground hidden sm:table-cell">
                        {top ? `${top.name} (${top.pts}pts)` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Roster accordion */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rosters</p>
            {sorted.map((team, i) => (
              <RosterRow key={team.gm} team={team} rank={i} />
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
