/**
 * Brigade label parsing, split out of breakdown.ts so client components can use it:
 * breakdown.ts imports the 5,692-card index, this module imports nothing.
 */

const CANONICAL_BRIGADE: Record<string, string> = {
  blue: 'Blue', clay: 'Clay', gold: 'Gold', goodgold: 'Gold', evilgold: 'Gold',
  green: 'Green', multi: 'Multi', purple: 'Purple', red: 'Red', silver: 'Silver',
  teal: 'Teal', white: 'White', black: 'Black', brown: 'Brown', crimson: 'Crimson',
  gray: 'Gray', orange: 'Orange', palegreen: 'Pale Green',
};

/** Brigade names printed as two words, collapsed before tokenising. */
const COMPOUND_BRIGADES: [RegExp, string][] = [
  [/\bpale\s+green\b/gi, 'palegreen'],
  [/\bgood\s+gold\b/gi, 'goodgold'],
  [/\bevil\s+gold\b/gi, 'evilgold'],
];

/**
 * Split a printed brigade string into canonical colours.
 *
 * A multi-brigade card belongs to every colour it names — a Green/Gold hero is
 * played by Green decks and Gold decks alike, so it counts toward both.
 *
 * The printed strings are messier than "Green/Gold" suggests: separators
 * include "/", "+", "and", commas and bare spaces ("Black/Crimson+Gold",
 * "Green/Teal Gold/Pale Green", "Crimson and White/Purple"), and three brigade
 * names are themselves two words. So compounds collapse first, then everything
 * else splits on any separator.
 *
 * Tokens that do not name a brigade are dropped rather than passed through.
 * Without that, alignment words leak in from strings like "Good Gold" and show
 * up as a brigade called "Good". The brigade set is closed and known, so an
 * unrecognised token is data noise, not a brigade this code hasn't heard of.
 */
export function splitBrigades(raw: string | undefined): string[] {
  const value = (raw ?? '').trim();
  if (!value) return [];

  // "(Gold/Red)" alone → use the parenthesised content; otherwise drop it,
  // since it qualifies rather than adds ("Gold (Green)" is a Gold card).
  const paren = /\(([^)]*)\)/.exec(value);
  let stripped = value.replace(/\([^)]*\)/g, '').trim();
  if (!stripped && paren) stripped = paren[1].trim();

  for (const [pattern, replacement] of COMPOUND_BRIGADES) {
    stripped = stripped.replace(pattern, replacement);
  }

  const seen = new Set<string>();
  for (const token of stripped.split(/[\/+,\s]+|\band\b/i)) {
    const normalized = token.trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!normalized) continue;
    const canonical = CANONICAL_BRIGADE[normalized];
    if (canonical) seen.add(canonical);
  }
  return [...seen];
}

/**
 * A card's brigades with Gold told apart by side.
 *
 * Gold is the one brigade printed for both good and evil cards (219 good, 201
 * evil, 8 neutral sites among plain "Gold"), and a Gold hero and a Gold evil
 * character are not the same half of a deck. The card's alignment is the
 * reliable signal: the printed "Good Gold" appears on only a handful of cards.
 * Neutral Gold, in practice sites, keeps the plain label.
 */
export function cardBrigades(raw: string | undefined, alignment: string | undefined): string[] {
  const side = (alignment ?? '').trim().toLowerCase();
  return splitBrigades(raw).map((brigade) => {
    if (brigade !== 'Gold') return brigade;
    return side === 'good' ? 'Good Gold' : side === 'evil' ? 'Evil Gold' : 'Gold';
  });
}
