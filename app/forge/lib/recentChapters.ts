export const RECENT_KEY = "forge.verseFinder.recent";

const MAX_RECENT = 3;

export type RecentChapter = { id: string; label: string }; // { id: "GEN.6", label: "Genesis 6" }

/** Newest first, deduped by id, capped at MAX_RECENT. Never mutates `list`. */
export function pushRecent(list: RecentChapter[], item: RecentChapter): RecentChapter[] {
  return [item, ...list.filter((entry) => entry.id !== item.id)].slice(0, MAX_RECENT);
}

function isRecentChapter(value: unknown): value is RecentChapter {
  if (typeof value !== "object" || value === null) return false;
  const { id, label } = value as Record<string, unknown>;
  return typeof id === "string" && typeof label === "string";
}

/** Returns [] when there is no window, storage throws, the value is absent, or it is corrupt. */
export function readRecent(): RecentChapter[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(RECENT_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isRecentChapter) ? parsed : [];
  } catch {
    return [];
  }
}

/** Silently does nothing when storage is unavailable or full. */
export function writeRecent(list: RecentChapter[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked or quota exceeded: recent chips are a convenience, not state.
  }
}
