// Pinned decks sit at the top of My Decks. Kept out of actions.ts because a
// "use server" module can only export async functions.

export const MAX_PINNED_DECKS = 3;

export const PIN_LIMIT_MESSAGE = `You can pin up to ${MAX_PINNED_DECKS} decks. Unpin one first.`;

/** Pinned decks first; the chosen sort still orders each group. */
export function pinnedFirst<T extends { is_pinned?: boolean | null }>(
  compare: (a: T, b: T) => number,
): (a: T, b: T) => number {
  return (a, b) => Number(!!b.is_pinned) - Number(!!a.is_pinned) || compare(a, b);
}
