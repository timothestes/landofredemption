import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/top-nav";
import SiteFooter from "@/components/site-footer";
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
            {/* Phone: stacked hairline rows. The table's five padded columns overflow
                below sm, which hid the decklist link off-screen entirely. */}
            <ul className="divide-y divide-border/60 border-y border-border/60 sm:hidden">
              {result.standings.map((row, i) => (
                <li key={i} className="py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {row.place !== null ? ordinal(row.place) : "—"}
                    </span>
                    <span className="text-sm text-foreground truncate">{row.name ?? "—"}</span>
                  </div>
                  <div className="pt-1 text-xs tabular-nums text-muted-foreground">
                    {row.matchPoints ?? "—"} pts · {row.differential ?? "—"} diff
                    {showDecklists && !row.publishedDeckId && " · no decklist"}
                  </div>
                  {/* Full-width 44px tap target so the decklist link is easy to hit on a phone. */}
                  {showDecklists && row.publishedDeckId && (
                    <Link
                      href={`/decklist/${row.publishedDeckId}`}
                      className="-mb-3 flex min-h-11 items-center justify-between text-sm font-medium text-foreground transition-colors hover:text-primary active:text-primary"
                    >
                      View decklist
                      <span aria-hidden className="text-muted-foreground">›</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>

            <div className="hidden sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60">
                    <th className="text-left px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                      Place
                    </th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                      Player
                    </th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                      Points
                    </th>
                    <th className="text-left px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                      Diff
                    </th>
                    {showDecklists && (
                      <th className="text-left px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                        Decklist
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 border-b border-border/60">
                  {result.standings.map((row, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3">
                        <span className="font-semibold tabular-nums text-foreground">
                          {row.place !== null ? ordinal(row.place) : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-foreground">{row.name ?? "—"}</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {row.matchPoints ?? "—"}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
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
