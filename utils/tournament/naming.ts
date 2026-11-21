/** The location suffix on a generated name: "Wichita, KS", or just whichever
 * half is set. Empty string when the event has no location at all. */
export function formatLocation(
  city?: string | null,
  state?: string | null
): string {
  const parts = [city?.trim(), state?.trim()].filter(Boolean);
  return parts.join(", ");
}

/** One formula everywhere: frozen generated names make events sort/group
 * predictably in the public dataset. */
export function buildTournamentName(
  category: string,
  opts?: {
    date?: Date;
    city?: string | null;
    state?: string | null;
    tier?: string | null;
  }
): string {
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(opts?.date ?? new Date());
  // Tier sits between the date and the category ("Aug 2, 2026 Regional Type 2
  // Tournament") and is simply absent when the event has none.
  const subject = [opts?.tier, category].filter(Boolean).join(" ");
  const base = `${date} ${subject} Tournament`;
  const location = formatLocation(opts?.city, opts?.state);
  return location ? `${base} — ${location}` : base;
}

// The event date is not a column: it lives in the generated name. These three
// move it between the name and an <input type="date">, which holds "2026-11-28".

/** A local day as a date field value. */
export function toDateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The local day a date field value names, at noon so no timezone or
 * daylight-saving shift can move it. Null when the value is not a real day. */
export function fromDateInputValue(value: string | null | undefined): Date | null {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  // new Date rolls "Feb 30" over into March rather than rejecting it.
  return toDateInputValue(date) === value ? date : null;
}

const NAME_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The "Nov 7, 2026" a generated name starts with, as a date field value. */
export function nameDateToInputValue(nameDate: string | null | undefined): string | null {
  const m = nameDate?.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  const month = m ? NAME_MONTHS.indexOf(m[1]) : -1;
  if (!m || month < 0) return null;
  return toDateInputValue(new Date(Number(m[3]), month, Number(m[2]), 12));
}

export function isNameFrozen(category: string | null): boolean {
  return !!category && category !== "Unofficial";
}
