// Shell of PublicDeckClient (breadcrumb, title, format chips, card grid) while the deck loads.
// TopNav and the footer come from app/decklist/layout.tsx.
export default function DeckLoading() {
  return (
    <div
      className="w-full max-w-7xl mx-auto px-4 py-8 animate-pulse"
      aria-busy="true"
      aria-label="Loading deck"
    >
      <div className="mb-4 h-4 w-48 rounded bg-muted/70" />
      <div className="mb-6 space-y-3">
        <div className="h-9 w-72 max-w-full rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-6 w-20 rounded-full bg-muted" />
          <div className="h-6 w-28 rounded-full bg-muted/70" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-7">
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="aspect-[5/7] rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  );
}
