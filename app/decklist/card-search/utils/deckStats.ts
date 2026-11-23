/**
 * Shared helpers for every deck statistic the app displays.
 *
 * The maybeboard is a scratchpad of cards under consideration — it is not part
 * of the deck, so it must never reach a stat, price, or composition figure.
 * Routing all aggregation through these helpers keeps that guarantee in one
 * place instead of relying on each call site to remember the zone filter.
 */

interface ZonedCard {
  zone: string;
}

interface CountableCard extends ZonedCard {
  quantity: number;
}

/** The cards that count toward deck stats: main + reserve, never maybeboard. */
export function statCards<T extends ZonedCard>(cards: T[]): T[] {
  return cards.filter((c) => c.zone !== "maybeboard");
}

/** Total number of copies in the deck (main + reserve). */
export function sumQuantity<T extends CountableCard>(cards: T[]): number {
  return statCards(cards).reduce((sum, c) => sum + c.quantity, 0);
}

/**
 * Tally card copies by a caller-supplied key — card type, alignment, brigade.
 * `keyOf` may return several keys (a multi-brigade card counts under each) or
 * null to skip the card entirely.
 */
export function countBy<T extends CountableCard>(
  cards: T[],
  keyOf: (card: T) => string | string[] | null | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const card of statCards(cards)) {
    const key = keyOf(card);
    if (key == null) continue;
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      counts[k] = (counts[k] || 0) + card.quantity;
    }
  }
  return counts;
}

const OPENING_HAND_SIZE = 8;

export interface HeroOpeningHandOdds {
  /** Copies in the main deck whose type includes Hero (dual-type cards count). */
  heroes: number;
  /** Main-deck copies that can sit in an opening hand: everything but Lost Souls. */
  handCards: number;
  /** Chance, 0 to 1, that the opening hand holds at least one Hero. */
  chance: number;
}

/**
 * Exact chance of at least one Hero in the opening hand.
 *
 * A Lost Soul drawn into the opening hand is put in play and replaced, so the
 * hand is always 8 cards drawn from the main deck's non-Lost-Soul cards. That
 * covers Hopper too: it goes to an opponent's territory and is replaced like
 * any other Lost Soul, even though it does not count toward the deck's Lost
 * Soul requirement. Lost Soul abilities that draw or search are not modelled.
 */
export function heroOpeningHandOdds<T extends CountableCard>(
  cards: T[],
  typeOf: (card: T) => string | null | undefined,
): HeroOpeningHandOdds {
  let heroes = 0;
  let handCards = 0;
  for (const card of cards) {
    if (card.zone !== "main") continue;
    const type = (typeOf(card) || "").toLowerCase();
    if (type.includes("lost soul")) continue;
    handCards += card.quantity;
    if (type.split("/").some((part) => part.trim() === "hero")) heroes += card.quantity;
  }

  // P(no Hero) = C(handCards - heroes, n) / C(handCards, n), as a running product.
  let noHero = 1;
  for (let i = 0; i < Math.min(OPENING_HAND_SIZE, handCards); i++) {
    noHero *= Math.max(handCards - heroes - i, 0) / (handCards - i);
  }
  return { heroes, handCards, chance: handCards === 0 ? 0 : 1 - noHero };
}
