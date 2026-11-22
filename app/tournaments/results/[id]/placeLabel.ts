import type { PublicResultsStandingRow } from "../../actions";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "1st", or "Dropped" for a player who left (they get no place). */
export function placeLabel(row: Pick<PublicResultsStandingRow, "place" | "dropped">): string {
  if (row.place !== null) return ordinal(row.place);
  return row.dropped ? "Dropped" : "—";
}
