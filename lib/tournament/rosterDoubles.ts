// Client-safe. A player the host typed in who later joins by QR is on the roster twice: the join looks for an
// existing entry by account (or by the guest's browser), never by name.

export interface RosterEntry {
  id: string;
  name: string;
  user_id?: string | null;
  guest_key?: string | null;
}

/** The same name, ignoring case and spacing. */
const nameKey = (name: string | null | undefined) => (name ?? "").toLowerCase().replace(/\s+/g, "");

const joinedByQr = (p: RosterEntry) => p.user_id != null || p.guest_key != null;

/**
 * The entries the host typed that share a name with a player who joined by QR, in roster order. A hint for the
 * host and nothing more: two people can share a name, so nothing is removed or merged on this alone.
 */
export function typedDoubles<T extends RosterEntry>(participants: T[]): T[] {
  const joinedNames = new Set(participants.filter(joinedByQr).map((p) => nameKey(p.name)));
  joinedNames.delete("");
  return participants.filter((p) => !joinedByQr(p) && joinedNames.has(nameKey(p.name)));
}
