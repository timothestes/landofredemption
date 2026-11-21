"use client";

import { cn } from "@/lib/utils";
import { useRoundCountdown } from "@/components/ui/useRoundCountdown";
import { derivePanelState } from "@/lib/tournament/roundTimer";
import { parseTournamentName } from "@/utils/tournament/displayName";
import type { BoardTournament } from "./boardData";

export function BoardPanel({ tournament }: { tournament: BoardTournament }) {
  const state = derivePanelState(tournament.round);
  const { timeString, isExpired } = useRoundCountdown(
    tournament.round?.started_at ?? null,
    tournament.round_length,
  );
  const expired = state === "running" && isExpired;

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-4 rounded-2xl border p-6 text-center transition-colors",
        expired ? "border-2 border-destructive bg-card" : "border-border bg-card",
      )}
    >
      {/* Title only: the room knows the date and the place, and small grey text is lost on a projector. */}
      <h2
        className="line-clamp-2 font-cinzel text-2xl font-bold text-foreground sm:text-3xl md:text-4xl"
        title={tournament.name}
      >
        {parseTournamentName(tournament.name).title}
      </h2>
      <p className="text-lg text-muted-foreground sm:text-xl">
        Round {tournament.current_round} of {tournament.n_rounds}
      </p>

      {state === "running" && !expired && (
        <span className="font-mono text-[12vw] font-bold leading-none tabular-nums text-foreground md:text-[9vw]">
          {timeString}
        </span>
      )}
      {expired && (
        <span className="font-mono text-[12vw] font-extrabold leading-none tabular-nums text-destructive md:text-[9vw] animate-pulse">
          TIME
        </span>
      )}
      {state === "not-started" && (
        <span className="text-2xl text-muted-foreground sm:text-3xl">
          Round {tournament.current_round} — starting soon
        </span>
      )}
      {state === "between-rounds" && (
        <span className="text-2xl text-muted-foreground sm:text-3xl">
          Round {tournament.current_round} complete — pairings coming
        </span>
      )}
    </div>
  );
}
