/**
 * How a `.single()` read of the tournament row came back.
 *
 * Only a zero-row answer (PostgREST's PGRST116, which is also what a host-only
 * RLS denial looks like) means the tournament is not there. Anything else — a
 * dropped connection, a timeout, a server error — is a failed read: the
 * tournament may be fine, and whatever is already on screen should stay.
 */
export type TournamentReadOutcome = "loaded" | "not_found" | "failed";

export function tournamentReadOutcome(
  data: unknown,
  error: { code?: string; message?: string } | null
): TournamentReadOutcome {
  if (error) return error.code === "PGRST116" ? "not_found" : "failed";
  return data ? "loaded" : "not_found";
}
