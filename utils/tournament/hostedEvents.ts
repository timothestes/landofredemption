// Pages the host's "Your Tournaments" list. Tournaments that share a listing
// are one real-world event with several categories, so they page as a single
// event and are never split across pages.

export const EVENTS_PER_PAGE = 20;

type HostedTournament = { id: string; listing_id: string | null };

export type HostedBlock<T> =
  // One event hosted from a listing, all of its categories.
  | { kind: "event"; listingId: string; tournaments: T[] }
  // A run of back-to-back standalone tournaments, drawn as one list.
  | { kind: "singles"; tournaments: T[] };

// `tournaments` must arrive newest first. An event takes the position of its
// newest category, so adding a category to an old event brings it back up.
export function pageHostedEvents<T extends HostedTournament>(
  tournaments: T[],
  requestedPage: number,
  perPage = EVENTS_PER_PAGE
): { page: number; pageCount: number; blocks: HostedBlock<T>[] } {
  const events: (T | T[])[] = [];
  const byListing = new Map<string, T[]>();
  for (const t of tournaments) {
    if (!t.listing_id) {
      events.push(t);
      continue;
    }
    let group = byListing.get(t.listing_id);
    if (!group) {
      group = [];
      byListing.set(t.listing_id, group);
      events.push(group);
    }
    group.push(t);
  }

  const pageCount = Math.max(1, Math.ceil(events.length / perPage));
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pageCount);

  const blocks: HostedBlock<T>[] = [];
  for (const event of events.slice((page - 1) * perPage, page * perPage)) {
    if (Array.isArray(event)) {
      blocks.push({ kind: "event", listingId: event[0].listing_id!, tournaments: event });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last?.kind === "singles") last.tournaments.push(event);
    else blocks.push({ kind: "singles", tournaments: [event] });
  }
  return { page, pageCount, blocks };
}
