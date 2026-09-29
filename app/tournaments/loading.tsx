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
        <div className="mb-6">
          <div className="h-9 w-72 max-w-full rounded bg-muted sm:h-10" />
          <div className="mt-2 flex items-center justify-between gap-4">
            <div className="h-4 w-32 rounded bg-muted/70" />
            <div className="flex items-center gap-3">
              <div className="h-4 w-24 rounded bg-muted/70" />
              <div className="h-11 w-[5.5rem] rounded-md bg-muted" />
            </div>
          </div>
        </div>
        <div className="border-b border-border/60 py-2">
          <div className="h-3 w-32 rounded bg-muted/70" />
        </div>
        <div className="divide-y divide-border/60 border-b border-border/60">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 sm:flex-nowrap"
            >
              <div className="w-full sm:w-28 sm:shrink-0">
                <div className="h-4 w-20 rounded bg-muted" />
              </div>
              <div className="w-full space-y-2 sm:w-auto sm:flex-1">
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
