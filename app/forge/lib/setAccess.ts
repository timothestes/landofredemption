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
