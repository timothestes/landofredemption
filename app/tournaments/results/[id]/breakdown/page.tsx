import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/top-nav";
import SiteFooter from "@/components/site-footer";
import { loadTournamentBreakdownAction } from "../../../actions";
import ResultsTabs from "../ResultsTabs";
import BreakdownClient from "./client";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const result = await loadTournamentBreakdownAction(id);

  if (result.success !== true) {
    return { title: "Breakdown Not Found" };
  }

  return {
    title: `${result.name} - Card Breakdown`,
    description: `Card frequency and metagame analysis across ${result.breakdown.deckCount} published decklists from ${result.name}.`,
  };
}

export default async function TournamentBreakdownPage({ params }: PageProps) {
  const { id } = await params;
  const result = await loadTournamentBreakdownAction(id);

  if (result.success !== true) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <main className="w-full flex-1 px-4 pb-16 pt-8 mx-auto max-w-6xl">
        <Link
          href="/tournaments/results"
          className="mb-5 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All results
        </Link>

        <div className="mb-6">
          <h1 className="font-cinzel text-2xl font-bold text-foreground">{result.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
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

        <ResultsTabs tournamentId={id} active="breakdown" showBreakdown />

        {result.breakdown.deckCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            No decklists were published for this event, so there is nothing to break down.
          </p>
        ) : (
          <BreakdownClient breakdown={result.breakdown} fieldSize={result.fieldSize} />
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
