import { Metadata } from "next";
import TopNav from "@/components/top-nav";
import SiteFooter from "@/components/site-footer";
import { loadMetagameAction } from "../actions";
import {
  METAGAME_FORMAT_LABELS,
  parseMetagameDays,
  parseMetagameFormat,
  windowLabel,
} from "@/lib/tournament/metagameFilters";
import ResultsSectionTabs from "@/components/metagame/ResultsSectionTabs";
import MetagameFilters from "@/components/metagame/MetagameFilters";
import EventPool from "@/components/metagame/EventPool";
import MetagameClient from "./client";

export const metadata: Metadata = {
  title: "Metagame",
  description:
    "Card frequency and metagame analysis pooled across published Redemption CCG tournament decklists, by format and time window.",
};

// The filters are read from the query string, and the underlying data changes
// whenever a host publishes a decklist — nothing here is safe to prerender.
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ format?: string; days?: string }>;
}

export default async function MetagamePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const format = parseMetagameFormat(params.format);
  const days = parseMetagameDays(params.days);

  const result = await loadMetagameAction(format, days);

  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16 pt-8">
        <h1 className="font-cinzel text-3xl font-bold tracking-tight text-foreground">Metagame</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Every published decklist in one pool, so you can see what a format is
          actually made of rather than what one event looked like.
        </p>

        <div className="mt-6">
          <ResultsSectionTabs active="metagame" />
        </div>

        <div className="mb-8">
          <MetagameFilters format={format} days={days} />
        </div>

        {result.success !== true ? (
          <p className="rounded-xl bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            The metagame data could not be loaded. Please try again.
          </p>
        ) : result.breakdown.deckCount === 0 ? (
          <EmptyPool
            format={format}
            days={days}
            otherFormatEvents={result.otherFormatEvents}
          />
        ) : (
          <div className="space-y-8">
            <EventPool breakdown={result.breakdown} />
            <MetagameClient breakdown={result.breakdown} fieldSize={result.fieldSize} />
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

/**
 * An empty pool is the common case for a young format, so it says which of the
 * two filters is responsible rather than leaving the reader to guess whether
 * the page is broken.
 */
function EmptyPool({
  format,
  days,
  otherFormatEvents,
}: {
  format: string;
  days: number;
  otherFormatEvents: number;
}) {
  const label = METAGAME_FORMAT_LABELS[format as keyof typeof METAGAME_FORMAT_LABELS] ?? format;
  const window = days === 0 ? "any published event" : `the last ${windowLabel(days).toLowerCase()}`;

  return (
    <div className="rounded-xl bg-card px-6 py-10 text-center">
      <h2 className="text-base font-medium text-foreground">
        No {label} decklists {days === 0 ? "published yet" : "in this window"}
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {otherFormatEvents > 0 ? (
          <>
            {otherFormatEvents} event{otherFormatEvents === 1 ? "" : "s"} published lists
            in {window}, but none of them were {label}. Try another format or a
            wider window.
          </>
        ) : (
          <>
            No event has published its decklists in {window}. Hosts can publish
            them from the tournament page once results are final.
          </>
        )}
      </p>
    </div>
  );
}
