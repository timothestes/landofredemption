// Hyphens and dashes of every kind: hyphen, non-breaking hyphen, figure dash,
// en dash, em dash, horizontal bar, minus sign, and the small and full-width
// forms. Generated names join the location with an em dash ("... Tournament —
// Wichita, KS"), which a phone keyboard has no key for.
const DASHES = /[‐-―−﹘﹣－]/g;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(DASHES, "-");
}

/** Does what the host typed match the tournament name? Case, surrounding
 * spaces and the kind of dash do not count, so a plain hyphen stands in for
 * the long dash in a generated name. */
export function typedNameMatches(typed: string, name: string): boolean {
  return normalize(typed) === normalize(name);
}
