import TopNav from "@/components/top-nav";

// Shell of TournamentsClient's list view (header + rows) while loadUpcomingListings runs.
export default function TournamentsLoading() {
  return (
    <div className="flex flex-col min-h-screen">
      <TopNav />
      <main
        className="w-full max-w-3xl mx-auto px-4 pt-8 pb-16 animate-pulse"
        aria-busy="true"
        aria-label="Loading tournaments"
      >
        <div className="flex items-start justify-between mb-8">
          <div className="space-y-2">
            <div className="h-7 w-56 rounded bg-muted" />
            <div className="h-4 w-32 rounded bg-muted/70" />
          </div>
          <div className="h-8 w-16 rounded-md bg-muted" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg border border-border bg-card/80 px-4 py-3"
            >
              <div className="w-20 flex-shrink-0">
                <div className="h-4 w-14 rounded bg-muted" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="h-4 w-40 max-w-full rounded bg-muted" />
                <div className="h-3 w-24 rounded bg-muted/70" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
