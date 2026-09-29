import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/top-nav";
import SiteFooter from "@/components/site-footer";
import { TrophyIcon } from "@/components/trophy-icon";
import { loadPublicResultsAction } from "../../actions";
import ResultsTabs from "./ResultsTabs";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const result = await loadPublicResultsAction(id);

  if (result.success !== true) {
    return { title: "Results Not Found" };
  }

  const players = result.standings.length;
  const details = [
    formatEndedAt(result.endedAt),
    result.deckFormat,
    players > 0 ? `${players} player${players === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    title: `${result.name} - Results`,
    description: `Final standings for ${result.name}${details ? ` — ${details}` : ""}.`,
  };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatEndedAt(endedAt: string | null): string | null {
  if (!endedAt) return null;
  return new Date(endedAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Podium tints mirror the placement badge in app/decklist/community/client.tsx.
// Background shifts only — the design system forbids 1px sectioning lines.
function podiumSurface(place: number | null): string {
  if (place === 1) return "bg-yellow-50 dark:bg-yellow-900/20";
  if (place === 2) return "bg-muted/60 dark:bg-muted/30";
  if (place === 3) return "bg-orange-50 dark:bg-orange-900/15";
  return "";
}

function podiumText(place: number | null): string {
  if (place === 1) return "text-yellow-700 dark:text-yellow-300";
  if (place === 3) return "text-orange-700 dark:text-orange-300";
  return "text-foreground";
}

export default async function TournamentResultsPage({ params }: PageProps) {
  const { id } = await params;
  const result = await loadPublicResultsAction(id);

  if (result.success !== true) {
    notFound();
  }

  const dateLabel = formatEndedAt(result.endedAt);
  // When the host published standings but not decklists, dropping the column
  // beats a full column of dashes that reads as "nobody submitted a deck".
  const showDecklists = result.decklistsPublished;

  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <main className="flex-1 max-w-3xl mx-auto px-4 pt-8 pb-16 w-full">
        <Link
          href="/tournaments/results"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-5"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All results
        </Link>

        <div className="mb-6">
          <h1 className="font-cinzel text-2xl font-bold text-foreground">{result.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {dateLabel && <span>{dateLabel}</span>}
            {result.category && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tracking-wide text-muted-foreground">
                {result.category}
              </span>
            )}
            {result.deckFormat && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tracking-wide text-muted-foreground">
                {result.deckFormat}
              </span>
            )}
          </div>
        </div>

        <ResultsTabs tournamentId={id} active="standings" showBreakdown={showDecklists} />

        {result.standings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No standings recorded.</p>
        ) : (
          <>
            {/* Phone: stacked cards. The table's five padded columns overflow
                below sm, which hid the decklist link off-screen entirely. */}
            <ul className="space-y-2 sm:hidden">
              {result.standings.map((row, i) => (
                <li key={i} className={`rounded-lg overflow-hidden bg-card ${podiumSurface(row.place)}`}>
                  <div className="flex items-center gap-2 px-4 pt-3">
                    {row.place !== null && row.place <= 3 && (
                      <TrophyIcon place={row.place} className="w-4 h-4 flex-shrink-0" />
                    )}
                    <span className={`text-sm font-semibold ${podiumText(row.place)}`}>
                      {row.place !== null ? ordinal(row.place) : "—"}
                    </span>
                    <span className="text-sm text-foreground truncate">{row.name ?? "—"}</span>
                  </div>
                  <div className="px-4 pb-3 pt-1 text-xs text-muted-foreground">
                    {row.matchPoints ?? "—"} pts · {row.differential ?? "—"} diff
                    {showDecklists && !row.publishedDeckId && " · no decklist"}
                  </div>
                  {/* Full-width tap target. The tonal step (rather than a divider)
                      keeps it legible over any podium tint, in either theme. */}
                  {showDecklists && row.publishedDeckId && (
                    <Link
                      href={`/decklist/${row.publishedDeckId}`}
                      className="flex min-h-[44px] items-center justify-between gap-2 bg-foreground/[0.06] px-4 text-sm font-medium text-foreground active:bg-foreground/[0.12] transition-colors"
                    >
                      View decklist
                      <span aria-hidden className="text-muted-foreground">›</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>

            <div className="hidden sm:block rounded-lg bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Place
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Player
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Points
                    </th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Diff
                    </th>
                    {showDecklists && (
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Decklist
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {result.standings.map((row, i) => (
                    <tr key={i} className={podiumSurface(row.place)}>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 font-semibold ${podiumText(row.place)}`}>
                          {row.place !== null && row.place <= 3 && (
                            <TrophyIcon place={row.place} className="w-4 h-4 flex-shrink-0" />
                          )}
                          {row.place !== null ? ordinal(row.place) : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-foreground">{row.name ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {row.matchPoints ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {row.differential ?? "—"}
                      </td>
                      {showDecklists && (
                        <td className="px-4 py-3">
                          {row.publishedDeckId ? (
                            <Link
                              href={`/decklist/${row.publishedDeckId}`}
                              className="text-foreground underline underline-offset-2 hover:text-primary transition-colors"
                            >
                              View
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!showDecklists && (
              <p className="mt-4 text-xs text-muted-foreground">
                The host has not published decklists for this event.
              </p>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
