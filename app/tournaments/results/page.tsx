import Link from "next/link";
import TopNav from "@/components/top-nav";
import SiteFooter from "@/components/site-footer";
import { loadPublicResultsIndexAction } from "../actions";
import ResultsSectionTabs from "@/components/metagame/ResultsSectionTabs";

export const metadata = {
  title: "Tournament Results",
  description: "Browse published standings and decklists from past Redemption CCG tournaments.",
};

// Nothing on this page reads cookies or headers — TopNav/SiteFooter are
// client components and the index query uses the service-role client — so Next
// prerenders it at build time and never regenerates. That froze the list to
// whatever was published at the last deploy; newly published events only showed
// on their own /results/[id] page (a dynamic segment) and never in the index.
export const dynamic = "force-dynamic";

function formatEndedAt(endedAt: string | null): string | null {
  if (!endedAt) return null;
  return new Date(endedAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function TournamentResultsIndexPage() {
  const result = await loadPublicResultsIndexAction();
  const events = result.success ? result.events : [];

  if (events.length === 0) {
    return (
      <div className="flex flex-col min-h-screen">
        <TopNav />
        <main className="flex-1 flex items-center justify-center px-4 py-16 w-full">
          <div className="max-w-sm text-center">
            <svg
              className="mx-auto w-12 h-12 text-muted-foreground/50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0116.27 9.728m0 0a6.726 6.726 0 01-2.748 1.35m0 0a7.026 7.026 0 01-3.044 0"
              />
            </svg>
            <h1 className="mt-4 text-lg font-medium text-foreground">
              No published results yet
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              When a host publishes the standings from a completed tournament, the results
              and decklists show up here.
            </p>
            <Link
              href="/tournaments"
              className="mt-6 inline-flex px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium transition-colors"
            >
              Browse upcoming tournaments
            </Link>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <main className="flex-1 max-w-3xl mx-auto px-4 pt-8 pb-16 w-full">
        <h1 className="font-cinzel text-3xl font-bold tracking-tight text-foreground">
          Tournament Results
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Published standings from completed tournaments.
        </p>

        <div className="mt-6">
          <ResultsSectionTabs active="events" />
        </div>

        <div className="divide-y divide-border/60 border-y border-border/60">
          {events.map((e) => {
            const dateLabel = formatEndedAt(e.endedAt);
            return (
              // divide-y draws on the direct child; keep that at container width
              // and let only the hover fill bleed (same shape as the agenda rows).
              <div key={e.id}>
                <Link
                  href={`/tournaments/results/${e.id}`}
                  className="-mx-2 block px-2 py-3 transition-colors hover:bg-muted/40"
                >
                  <span className="text-sm font-medium text-foreground">{e.name}</span>
                  {/* Name alone is not unique — the date, category and format are
                      what tell two same-day events apart. */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">{dateLabel ?? "Date not recorded"}</span>
                    <span aria-hidden>·</span>
                    <span>
                      {e.playerCount} player{e.playerCount !== 1 ? "s" : ""}
                    </span>
                    {e.category && (
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 font-semibold tracking-wide">
                        {e.category}
                      </span>
                    )}
                    {e.deckFormat && (
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 font-semibold tracking-wide">
                        {e.deckFormat}
                      </span>
                    )}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
