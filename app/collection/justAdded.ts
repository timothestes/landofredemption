/**
 * Card keys (name|set|imgFile) from scan_events.outcomes entries that were
 * actually added: not removed, not unresolved. De-duplicated, order kept.
 */
export function justAddedKeys(outcomes: unknown[]): string[] {
  const seen = new Set<string>();
  for (const o of outcomes) {
    if (!o || typeof o !== "object") continue;
    const { finalKey, removed, unresolved } = o as Record<string, unknown>;
    if (removed === true || unresolved === true) continue;
    if (typeof finalKey !== "string" || finalKey === "") continue;
    seen.add(finalKey);
  }
  return [...seen];
}
