// A stored tournament name is one frozen string, built by buildTournamentName as
// "{Mon D, YYYY} {tier} {category} Tournament — {City, ST}". That is the right
// thing to store, sort and print, and far too long for a heading, a row or a
// breadcrumb. These helpers read the parts back out for display only; the
// stored name is never changed.

export interface TournamentNameParts {
  /** "Nov 7, 2026", as written in the name. */
  date: string | null;
  /** The event itself: tier and category, without the date, "Tournament" or the location. */
  title: string;
  /** "Rochester, NY", or whichever half the event has. */
  location: string | null;
}

const GENERATED_RE = /^([A-Z][a-z]{2} \d{1,2}, \d{4}) (.+) Tournament(?: — (.+))?$/;

// " - 2 Player", " 2-Player", " - 2P": listings spell it several ways (see
// categoryKey in categoryDefaults.ts). \b keeps "Type 2 Paragon" whole. The
// dash that set it off goes on both sides, so "Type 1 - 2 Player - Unlimited"
// is not left as "Type 1 2P - Unlimited" with a dash to wrap on.
const TWO_PLAYER_RE = /\s*-?\s*2[\s-]*P(?:layers?)?\b(?:\s*-(?=\s))?/i;

/**
 * Splits a stored name into date, title and location. A name that is not in
 * the generated shape (a host's own wording, an older event) comes back whole
 * as the title, so nothing that could not be classified is dropped.
 */
export function parseTournamentName(name: string): TournamentNameParts {
  const m = name.trim().match(GENERATED_RE);
  if (!m) return { date: null, title: name, location: null };
  const subject = m[2].replace(TWO_PLAYER_RE, " 2P").trim();
  return {
    date: m[1],
    // "Unofficial" alone is not a name for anything.
    title: subject === "Unofficial" ? "Unofficial Tournament" : subject,
    location: m[3]?.trim() || null,
  };
}

/**
 * One line for tight spots: "Seasonal Sealed Deck 2P · Nov 7, 2026". The
 * location is left out. Pass `year: false` only where the year is already on
 * screen or the event is plainly happening now.
 */
export function shortTournamentName(name: string, opts?: { year?: boolean }): string {
  const { date, title } = parseTournamentName(name);
  if (!date) return title;
  return `${title} · ${opts?.year === false ? date.replace(/, \d{4}$/, "") : date}`;
}

/**
 * The date and location the categories of one event have in common. One the
 * names disagree on is null (a category added later carries its own date), and
 * so are both when no name parses. Names that do not parse are skipped.
 */
export function sharedEventParts(names: string[]): Pick<TournamentNameParts, "date" | "location"> {
  const parsed = names.map(parseTournamentName).filter((p) => p.date);
  const shared = (key: "date" | "location") =>
    parsed.length > 0 && parsed.every((p) => p[key] === parsed[0][key]) ? parsed[0][key] : null;
  return { date: shared("date"), location: shared("location") };
}
