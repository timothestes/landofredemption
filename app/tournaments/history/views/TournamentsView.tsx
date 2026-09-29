"use client";

import type { ViewId } from "../NavTabs";
import { useSeed } from "../seed-context";
import { FormatBadge } from "../components/FormatBadge";
import { SectionTitle } from "../components/SectionTitle";
import { EmptyState } from "../components/EmptyState";

interface TournamentsViewProps {
  setView: (
    view: ViewId,
    opts?: { tournamentId?: string; playerName?: string; backTo?: ViewId }
  ) => void;
}

export function TournamentsView({ setView }: TournamentsViewProps) {
  const seed = useSeed();
  const sorted = [...seed.tournaments].sort((a, b) => b.year - a.year);

  if (!sorted.length) {
    return <EmptyState icon="🏛️" title="No tournaments yet" />;
  }

  return (
    <div>
      <SectionTitle
        title="Nationals History"
        sub={`${sorted.length} tournament${sorted.length === 1 ? "" : "s"}`}
      />
      <div className="grid gap-4 justify-start [grid-template-columns:repeat(auto-fill,minmax(240px,320px))]">
        {sorted.map((t) => {
          const att = t.attendance ? `${t.attendance} players` : null;
          const meta = [t.venue || null, att, t.dates]
            .filter(Boolean)
            .join(" · ");

          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              className="group cursor-pointer rounded-lg border border-border bg-card p-5 transition hover:border-primary hover:shadow-lg hover:-translate-y-0.5 relative overflow-hidden focus-visible:border-primary focus-visible:outline-none"
              onClick={() =>
                setView("detail", { tournamentId: t.id, backTo: "tournaments" })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setView("detail", { tournamentId: t.id, backTo: "tournaments" });
                }
              }}
            >
              {/* top accent bar */}
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />

              <div className="text-3xl font-bold tabular-nums text-foreground leading-none mb-1">
                {t.year}
              </div>
              <div className="text-sm font-medium text-foreground mb-1">
                {t.location || "Location TBD"}
              </div>
              {meta && (
                <div className="text-xs text-muted-foreground mb-3">{meta}</div>
              )}
              {t.formats.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {t.formats.map((f) => (
                    <FormatBadge key={f} format={f} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
