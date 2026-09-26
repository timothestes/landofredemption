// Shell of the tournament page (breadcrumb, sticky header, rows) while its client bundle and
// data arrive. Mirrors the h-16 header placeholder the page itself shows before its first fetch.
export default function TournamentLoading() {
  return (
    <div className="flex min-h-screen px-3 sm:px-5 w-full">
      <div
        className="w-full max-w-4xl mx-auto space-y-5 animate-pulse"
        aria-busy="true"
        aria-label="Loading tournament"
      >
        <div className="h-4 w-40 rounded bg-muted/70" />
        <div className="h-16 rounded-md bg-muted/30" />
        <div className="h-9 w-64 max-w-full rounded-md bg-muted/40" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 rounded-md border border-border bg-card/60" />
          ))}
        </div>
      </div>
    </div>
  );
}
