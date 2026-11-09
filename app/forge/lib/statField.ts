// The Strength and Toughness fields' rules. Pure, so they can be tested in node.

import type { StatValue } from "./designCard";
import { sideStat } from "./frameAssets";

// Text that more typing can still make a stat. The field says nothing about it until you leave:
// "6/" on its way to "6/0" isn't a mistake yet.
const UNFINISHED_STAT_RE = /^(?:-|(?:x|\d+|-)\s*(?:\/|\(\s*(?:(?:x|\d+|-)\s*)?))$/i;

export function isUnfinishedStat(text: string): boolean {
  return UNFINISHED_STAT_RE.test(text.trim());
}

/** A stat as the field shows it once it's stored. */
export function statShown(value: StatValue | undefined): string {
  return value == null ? "" : String(value);
}

const STAT_FORMS = "Use a number, X or 6/0.";

/** For text the field couldn't save, which stays on screen only until you leave the field. */
export function statRefusedNote(saved: StatValue | undefined): string {
  return statShown(saved) === "" ? `Not saved. ${STAT_FORMS}` : `Not saved, still ${saved}. ${STAT_FORMS}`;
}

/** For a paired value on a card that doesn't obviously want one. It can't be refused, because print
 *  has them (Abram/Abraham 5/10, Persian Horsemen 2/2). But "7 / 7" is also how a card's stats read,
 *  so typing them both into Strength has to say what it did. */
export function statSidesNote(saved: StatValue | undefined): string | null {
  const left = sideStat(saved ?? undefined, "left");
  if (left === (saved ?? undefined)) return null;
  return `Saved as two sides, ${left} and ${sideStat(saved ?? undefined, "right")}. For one value, type just one.`;
}
