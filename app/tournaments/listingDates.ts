// Calendar-day arithmetic for tournament listings. Listing dates are plain
// YYYY-MM-DD strings; they are compared in the viewer's local calendar, the
// same way the rows format them. Both sides are pinned to noon so a DST shift
// of an hour can't move a day, and `now` is injectable for tests.

const DAY_MS = 24 * 60 * 60 * 1000;

export function getDaysUntil(dateStr: string, now: Date = new Date()): number {
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const target = new Date(dateStr + "T12:00:00");
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
}

/**
 * True once the listing's last day (end_date, else start_date) is behind us.
 * loadUpcomingListings keeps such rows for a three-day grace window so hosts
 * can still reach "Host This Event"; the UI labels them "Recently played" so
 * they don't read as upcoming.
 */
export function hasBeenPlayed(
  listing: { start_date: string; end_date: string | null },
  now: Date = new Date(),
): boolean {
  return getDaysUntil(listing.end_date ?? listing.start_date, now) < 0;
}
