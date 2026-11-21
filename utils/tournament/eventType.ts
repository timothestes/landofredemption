import { FormatId, normalizeTournamentFormat } from "../../lib/formats";
import { categoryDefaults, requireDecklistsDefault } from "./categoryDefaults";
import {
  buildTournamentName,
  formatLocation,
  isNameFrozen,
  nameDateToInputValue,
  toDateInputValue,
} from "./naming";

// An event's "type" is a few orthogonal things: its sanctioning tier (Regional,
// State, …), its category/format (Type 2, Paragon, …), and where it's held.
// Changing any of them cascades into the frozen name; changing the category
// also cascades into the settings derived from it. One rule governs that
// cascade: derived values the host never overrode follow the new category;
// anything the host changed stays put. Kept pure so the Settings preview and
// the persisted patch are computed by the same code and can't disagree.

export interface EventTypeCurrent {
  name: string;
  tier: string | null;
  category: string | null;
  deck_format: string | null;
  city: string | null;
  state: string | null;
  max_score: number | null;
  round_length: number | null;
  require_decklists: boolean | null;
  created_at: string;
}

export interface EventTypeNext {
  tier: string | null;
  category: string;
  city: string | null;
  state: string | null;
  /** The day the host picked for the event. Omitted keeps the date already in the name. */
  date?: Date;
  /** Read only when category is "Unofficial" — the one case with no category to derive a format from. */
  unofficialFormat?: FormatId | "Other";
}

export interface EventTypePlan {
  tier: string | null;
  category: string;
  deck_format: FormatId | "Other";
  city: string | null;
  state: string | null;
  name?: string;
  max_score?: number;
  round_length?: number;
  require_decklists?: boolean;
}

// The leading "{Mon D, YYYY}" of a generated name. Only the date is read back
// out — tier, category, city and state all come from columns now, so the rest
// of the name is rebuilt rather than parsed.
//
// Capturing the date rather than reformatting it matters: created_at is UTC
// while the stored name was generated in the host's timezone (created_at
// 2026-07-29T01:15Z on an event named "Jul 28, 2026 …"), so reformatting would
// shift the date by a day.
const NAME_DATE_RE = /^(.+?, \d{4}) /;

export function renameForEventType(
  currentName: string,
  next: { tier: string | null; category: string; city: string | null; state: string | null; date?: Date },
  createdAt: string
): string {
  const subject = [next.tier, next.category].filter(Boolean).join(" ");
  const location = formatLocation(next.city, next.state);
  const m = currentName.match(NAME_DATE_RE);
  if (m && !next.date) {
    return `${m[1]} ${subject} Tournament${location ? ` — ${location}` : ""}`;
  }
  // The host picked a day, or the name is free-form (an Unofficial event being
  // promoted to an official category) and there is nothing to salvage — build
  // the whole thing.
  return buildTournamentName(next.category, {
    date: next.date ?? new Date(createdAt),
    city: next.city,
    state: next.state,
    tier: next.tier,
  });
}

/**
 * What the Event date field in Settings starts on: the day written in the
 * name, or for a free-form name the local day it was created — the same day
 * renameForEventType falls back to.
 */
export function eventDateInputValue(name: string, createdAt: string): string {
  const m = name.match(NAME_DATE_RE);
  return (m && nameDateToInputValue(m[1])) ?? toDateInputValue(new Date(createdAt));
}

export function planEventTypeChange(
  current: EventTypeCurrent,
  next: EventTypeNext,
  opts: { maxScoreLocked: boolean }
): EventTypePlan {
  const nextDefaults = categoryDefaults(next.category);
  // A tournament created before categories existed has no old defaults to
  // compare against, so nothing counts as "still at the default" and no
  // derived field gets re-seeded.
  const oldDefaults = current.category ? categoryDefaults(current.category) : null;

  // Format is derived from the category everywhere except Unofficial. Omitting
  // the format there keeps whatever was already in force rather than resetting
  // to "Other" and silently disabling the decklist requirement.
  const deckFormat: FormatId | "Other" =
    next.category === "Unofficial"
      ? next.unofficialFormat ?? normalizeTournamentFormat(current.deck_format) ?? "Other"
      : nextDefaults.deck_format;

  // City and state aren't derived from anything — they're whatever the host
  // set — so they pass straight through and only affect the name.
  const plan: EventTypePlan = {
    tier: next.tier,
    category: next.category,
    deck_format: deckFormat,
    city: next.city,
    state: next.state,
  };

  // Only official categories have a frozen name to regenerate — an Unofficial
  // event's name is the host's own, wherever it's held.
  if (isNameFrozen(next.category)) {
    const name = renameForEventType(current.name, next, current.created_at);
    if (name !== current.name) plan.name = name;
  }

  if (
    oldDefaults &&
    !opts.maxScoreLocked &&
    current.max_score === oldDefaults.max_score &&
    nextDefaults.max_score !== current.max_score
  ) {
    plan.max_score = nextDefaults.max_score;
  }

  if (
    oldDefaults &&
    current.round_length === oldDefaults.round_length &&
    nextDefaults.round_length !== current.round_length
  ) {
    plan.round_length = nextDefaults.round_length;
  }

  const wasRequired = current.require_decklists === true;
  let requireDecklists = wasRequired;
  if (oldDefaults && wasRequired === requireDecklistsDefault(current.category)) {
    requireDecklists = requireDecklistsDefault(next.category);
  }
  // Hard invariant, overriding the re-seed rule: an event with no specific
  // format cannot require decklists — every player would be bounced with
  // `decklist_required` (app/join/actions.ts), making the event unjoinable.
  // The rule alone doesn't prevent this: a host who turns the toggle on for
  // Type A (default off) and then switches to Booster Draft keeps it on.
  if (deckFormat === "Other") requireDecklists = false;
  if (requireDecklists !== wasRequired) plan.require_decklists = requireDecklists;

  return plan;
}
