import type { ForgeRole } from "@/app/forge/lib/auth";

// Forge cards are secret by default, and an open set is shown to every elder. Applies to new
// sets only: the column default stays false, and existing sets keep what they have.
export const NEW_SET_PRIVATE_DEFAULT = true;

// Pure helpers for the admin Set Access matrix. A grant is identified by the
// (playtester, set) pair; we key it as a single string for O(1) membership checks.

export function grantKey(userId: string, setId: string): string {
  return `${userId}|${setId}`;
}

export function buildGrantKeySet(pairs: { userId: string; setId: string }[]): Set<string> {
  return new Set(pairs.map((p) => grantKey(p.userId, p.setId)));
}

// Can this member write to this set? Mirrors is_forge_set_elder (migration 071), the one check
// behind every set-scoped write, which stays the real gate. A set that isn't private is open to
// every elder: the designer roster only decides who gets into a private one.
export function canWriteSet({ role, isPrivate, onRoster }: { role: ForgeRole; isPrivate: boolean; onRoster: boolean }): boolean {
  return role === "superadmin" || onRoster || (role === "elder" && !isPrivate);
}

// What a picker that puts cards into a set should offer. A released set takes no new cards from
// anyone, superadmins included (forge_share_card_to_set, forge_create_card_in_set; migration 091).
export function setsTakingCards<S extends { id: string; isPrivate: boolean; status: string }>(
  sets: S[],
  role: ForgeRole,
  rosterSetIds: ReadonlySet<string>,
): S[] {
  return sets.filter(
    (s) => s.status !== "released" && canWriteSet({ role, isPrivate: s.isPrivate, onRoster: rosterSetIds.has(s.id) }),
  );
}
