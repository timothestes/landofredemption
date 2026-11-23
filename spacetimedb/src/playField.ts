// Pure play-field zone helpers. No SpacetimeDB runtime imports so this can be
// unit tested in isolation (see __tests__/playField.test.ts) and shared by the
// reducer write paths in index.ts.

// The three zones where a card is "in play" on the field. Everything else
// (deck, hand, discard, reserve, banish, soul-deck, land-of-redemption) is
// off-field — the card has left play.
export const ON_FIELD_ZONES = ['territory', 'land-of-bondage', 'battle'] as const;

export function isOnFieldZone(zone: string): boolean {
  return (ON_FIELD_ZONES as readonly string[]).includes(zone);
}

// True only when a card moves from an on-field zone to an off-field zone, i.e.
// it genuinely leaves the play field. Relocations between on-field zones — most
// importantly the battle-zone round trip (territory -> battle -> territory) —
// are NOT leaving play, so lasting in-play characteristics must survive them.
export function isLeavingPlayField(fromZone: string, toZone: string): boolean {
  return isOnFieldZone(fromZone) && !isOnFieldZone(toZone);
}

// The cards whose equip link must be cleared when `leavingIds` leave play. A
// card off the field can't carry or wear an accessory, so both directions go:
// each leaving card's own link, and the link of every card attached to a
// leaving card (that accessory stays where it is, just unlinked). Without this
// a weapon left in Territory keeps pointing at a hero in the deck — the client
// only draws a weapon beside its host, so it vanishes, then reappears when the
// hero is searched back out.
export function equipLinksToClear<T extends { id: bigint; equippedToInstanceId: bigint }>(
  cards: readonly T[],
  leavingIds: ReadonlySet<bigint>,
): T[] {
  return cards.filter(
    (c) =>
      c.equippedToInstanceId !== 0n &&
      (leavingIds.has(c.id) || leavingIds.has(c.equippedToInstanceId)),
  );
}
