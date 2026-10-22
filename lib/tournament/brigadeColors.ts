/**
 * Brigade swatches.
 *
 * Redemption brigades are named colours, so the palette is semantic rather than
 * categorical — a Crimson bar has to read crimson.
 *
 * This palette deliberately fails the categorical colour-blindness gates, and
 * cannot be fixed by re-stepping. Running the eight good brigades through the
 * validator reports Silver↔Teal at ΔE 4.2 (deutan) and 9.4 with normal vision,
 * flagging Silver below the chroma floor because "reads grey" is precisely what
 * Silver means. Any palette containing Silver, Gray and White has the same
 * problem by construction.
 *
 * So colour is demoted from the encoding to a mnemonic. Every brigade mark is a
 * horizontal bar carrying its own adjacent text label and printed value; length
 * and text hold the data, and the swatch only helps a reader who already knows
 * the brigades find their row faster. That constraint is binding on callers:
 * no brigade pie, no stacked bar read against a detached legend, and no chart
 * where telling two brigades apart depends on seeing their hues.
 *
 * Values are stepped per theme rather than flipped. Four brigades name colours
 * that cannot be rendered literally at readable contrast — White, Black, Gray
 * and Silver — and take the nearest legible neutral instead.
 */

export interface BrigadeSwatch {
  light: string;
  dark: string;
  alignment: 'good' | 'evil' | 'neutral';
}

export const BRIGADE_SWATCHES: Record<string, BrigadeSwatch> = {
  Blue: { light: '#2a6fd6', dark: '#4f92e8', alignment: 'good' },
  Clay: { light: '#a8632c', dark: '#c58a56', alignment: 'good' },
  // Gold is printed for both sides; the breakdown labels it by the card's alignment
  // (see cardBrigades). Plain Gold is the neutral remainder, in practice sites.
  'Good Gold': { light: '#b8860b', dark: '#dfae37', alignment: 'good' },
  'Evil Gold': { light: '#8a6a1a', dark: '#b89a45', alignment: 'evil' },
  Gold: { light: '#b8860b', dark: '#dfae37', alignment: 'neutral' },
  Green: { light: '#1a8f4c', dark: '#34b46a', alignment: 'good' },
  Purple: { light: '#7038c8', dark: '#a17ae8', alignment: 'good' },
  Red: { light: '#c62828', dark: '#ef5350', alignment: 'good' },
  // Silver reads as a cool light grey; a literal silver disappears on white.
  Silver: { light: '#6b7f9e', dark: '#a8bad4', alignment: 'good' },
  Teal: { light: '#0d8b80', dark: '#26b3a6', alignment: 'good' },
  // White likewise — a pale slate keeps it legible on both surfaces.
  White: { light: '#8496ad', dark: '#ccd7e6', alignment: 'good' },
  Black: { light: '#3f3f46', dark: '#9296a1', alignment: 'evil' },
  Brown: { light: '#7d4f26', dark: '#a97c4e', alignment: 'evil' },
  Crimson: { light: '#9f1239', dark: '#e05073', alignment: 'evil' },
  Gray: { light: '#64748b', dark: '#9aa6b8', alignment: 'evil' },
  Orange: { light: '#d1590a', dark: '#f38a3c', alignment: 'evil' },
  'Pale Green': { light: '#5f8f63', dark: '#96c39b', alignment: 'evil' },
  Multi: { light: '#6d5b9e', dark: '#a294cc', alignment: 'neutral' },
};

const FALLBACK: BrigadeSwatch = {
  light: '#94a3b8',
  dark: '#7c8798',
  alignment: 'neutral',
};

export function brigadeSwatch(label: string): BrigadeSwatch {
  return BRIGADE_SWATCHES[label] ?? FALLBACK;
}

/** Display order: good brigades, then neutral, then evil — as decks are read. */
const ORDER = [
  'Blue', 'Clay', 'Green', 'Purple', 'Red', 'Silver', 'Teal', 'White', 'Good Gold',
  'Gold', 'Multi',
  'Black', 'Brown', 'Crimson', 'Evil Gold', 'Gray', 'Orange', 'Pale Green',
];

export function brigadeRank(label: string): number {
  const index = ORDER.indexOf(label);
  return index === -1 ? ORDER.length : index;
}
