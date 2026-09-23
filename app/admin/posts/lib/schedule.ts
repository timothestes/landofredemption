// Conversion between an ISO timestamp (stored, UTC) and the value a native
// <input type="datetime-local"> wants/produces (no timezone — the browser
// treats it as the viewer's local time, which is exactly what a poster
// typing "Sep 25, 9:00 AM" means).

/** ISO string -> "YYYY-MM-DDTHH:mm" in local time, or "" for null/invalid. */
export function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DDTHH:mm" (local time) -> ISO string, or null for empty/invalid. */
export function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Strictly after `now` (default: the real current time). */
export function isFutureIso(iso: string | null, now: Date = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getTime() > now.getTime();
}
