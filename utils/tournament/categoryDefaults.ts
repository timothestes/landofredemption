import { FormatId } from "../../lib/formats";

// Sensible defaults for a new tournament based on its category/format. These are
// only a head start — the host can change any of them in Tournament Settings
// after the tournament is created.

export interface CategoryDefaults {
  deck_format: FormatId | "Other";
  max_score: number; // Lost Souls needed to win a game
  round_length: number; // minutes
}

// Categories offered when hosting a tournament that isn't tied to an official
// listing's own format list.
export const STANDARD_CATEGORIES = [
  "Type 1 Limited",
  "Type 1 Unlimited",
  "Type 2",
  "Booster Draft",
  "Sealed Deck",
  "Teams",
  "Type A",
  "Paragon",
  "Unofficial",
] as const;

// Loose identity for a category label, so "Booster Draft - 2 Player" (a listing's
// wording) and "Booster Draft" (ours), or "Type 1 - 2 Player" and "Type 1
// Limited", count as the same thing. \b keeps "Unlimited" from losing its tail.
const categoryKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/\s*-?\s*2[\s-]*p(layers?)?$/, "")
    .replace(/\s*-?\s*\blimited$/, "")
    .trim();

/** The standard categories a host could still add on top of `offered` (a
 * listing's own formats), leaving out any that `offered` already covers. */
export function otherCategories(offered: string[]): string[] {
  const covered = new Set(offered.map(categoryKey));
  return STANDARD_CATEGORIES.filter((c) => !covered.has(categoryKey(c)));
}

// Maps a category/format string (from a listing or the standard list) to its
// defaults. Matching is fuzzy so listing strings like "Type 2 2-Player" or
// "Booster Draft (GoC x3...)" still resolve correctly.
export function categoryDefaults(category: string): CategoryDefaults {
  const c = category.toLowerCase();
  if (c.includes("paragon"))
    return { deck_format: "Paragon", max_score: 5, round_length: 40 };
  // Teams is built to Type 1 deck rules (per the hosting guide), so it wins at
  // 5 souls — not 7. Checked before Type 2 so it never falls through. Its own
  // format since DBR 2.0 gave Teams a ban list of its own; the deck rules are
  // otherwise Limited's.
  if (c.includes("teams"))
    return { deck_format: "Teams", max_score: 5, round_length: 60 };
  if (c.includes("type 2") || c.includes("type2"))
    return { deck_format: "T2", max_score: 7, round_length: 75 };
  if (c.includes("draft"))
    return { deck_format: "Other", max_score: 5, round_length: 45 };
  // "Closed Deck - 2 Player" is the official listing term for sealed-product
  // events (46 prod listing entries) — sealed product, never Limited.
  if (c.includes("sealed") || c.includes("closed"))
    return { deck_format: "Other", max_score: 5, round_length: 45 };
  if (c.includes("unlimited"))
    return { deck_format: "Unlimited", max_score: 5, round_length: 45 };
  if (c.includes("unofficial"))
    return { deck_format: "Other", max_score: 5, round_length: 45 };
  // Type 1 (Limited) and Type A (a Type 1 variant) and anything else default
  // to Limited.
  return { deck_format: "Limited", max_score: 5, round_length: 45 };
}

/** Whether a decklist is required to QR-join, by category. Derives from the
 * category's RESOLVED format (so listing strings like "Type 1" count), with
 * explicit carve-outs: Type A and Teams also resolve to Limited but default
 * off (Type A construction rules would hard-block at the door; Teams pending
 * elder details). Hosts can flip per event. */
export function requireDecklistsDefault(category: string | null): boolean {
  if (!category) return false;
  const c = category.toLowerCase();
  if (c.includes("type a") || c.includes("teams") || c.includes("unofficial")) return false;
  const fmt = categoryDefaults(category).deck_format;
  return fmt === "Limited" || fmt === "Unlimited" || fmt === "T2";
}
