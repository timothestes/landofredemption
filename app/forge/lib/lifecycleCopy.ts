// Single source of truth for forge lifecycle copy + which statuses admit which
// action. Pure and isomorphic — imported by client components and server actions.
// Eligibility mirrors the guards in migration 052's RPCs; keep them in sync.

import { diffCards, sameCardContent, type FieldChange } from "@/app/forge/lib/cardDiff";
import type { DesignCard } from "@/app/forge/lib/designCard";

export const STATUS_LABEL: Record<string, string> = {
  private_idea: "Idea",
  draft: "Draft",
  playtesting: "In playtest",
  approved: "Final",
  promoted: "Public",
  archived: "Shelved",
};

export const STATUS_PATH = ["draft", "playtesting", "approved"] as const;

// Tinted pill classes per status — a quiet ramp along the lifecycle:
// neutral draft → amber in-playtest → green final; violet for pre-set ideas,
// dashed outline for shelved.
export const STATUS_BADGE_CLASS: Record<string, string> = {
  private_idea: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  draft: "border-border bg-muted/60 text-muted-foreground",
  playtesting: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  promoted: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  archived: "border-dashed text-muted-foreground",
};

export type LifecycleAction =
  | "release"
  | "markFinal"
  | "reopen"
  | "shelve"
  | "restore"
  | "returnToIdeas"
  | "delete";

export const ACTION_LABEL: Record<LifecycleAction, string> = {
  release: "Release to playtesters",
  markFinal: "Mark final",
  reopen: "Reopen testing",
  shelve: "Shelve",
  restore: "Restore",
  returnToIdeas: "Return to ideas",
  delete: "Delete",
};

// Past-tense verbs for bulk-result summaries ("Released 12 · 3 skipped · 0 failed").
export const BULK_DONE_VERB: Record<LifecycleAction, string> = {
  release: "Released",
  markFinal: "Marked final",
  reopen: "Reopened",
  shelve: "Shelved",
  restore: "Restored",
  returnToIdeas: "Returned",
  delete: "Deleted",
};

// A draft gets its first release; a playtesting card gets a new frozen version.
export function releaseLabel(status: string): string {
  return status === "draft" ? ACTION_LABEL.release : "Release update";
}

// The bulk bar's label for the cards a release would touch. Same words as the studio
// button, so a released card never reads "Release to playtesters" in one place and
// "Release update" in the other; both follow the status the grid's badge shows.
export function bulkReleaseLabel(statuses: string[]): string {
  const distinct = new Set(statuses);
  if (distinct.size === 0) return ACTION_LABEL.release;
  return distinct.size === 1 ? releaseLabel(statuses[0]) : "Release";
}

// What releasing will do to the card's open proposals, said before you commit
// to it. Mirrors migration 083: forge_publish_card records at most ONE matching
// proposal as accepted (the oldest) and closes the rest as out of date.
export function releaseProposalNotice(openCount: number, hasMatch: boolean): string[] {
  if (openCount <= 0) return [];
  const notices: string[] = [];
  if (hasMatch) {
    notices.push(
      "1 open proposal matches this draft and will be recorded as accepted by this release — its summary is kept in the card’s history.",
    );
  }
  const closed = hasMatch ? openCount - 1 : openCount;
  if (closed === 1) {
    notices.push("1 open proposal will be closed as out of date. Review it first if you still want it.");
  } else if (closed > 1) {
    notices.push(`${closed} open proposals will be closed as out of date. Review them first if you still want them.`);
  }
  return notices;
}

// What stops a card being released. Mirrors the guard in forge_publish_card (migration
// 127), which is the real gate. Name and type only: art-less playtest releases are normal.
export function releaseBlockers(snapshot: DesignCard): ("name" | "type")[] {
  const blockers: ("name" | "type")[] = [];
  if (!snapshot.name?.trim()) blockers.push("name");
  if (!snapshot.cardType?.length) blockers.push("type");
  return blockers;
}

export function releaseBlockedNote(blockers: ("name" | "type")[]): string | null {
  if (blockers.length === 0) return null;
  return `Add ${blockers.map((b) => `a ${b}`).join(" and ")} to release.`;
}

// The newest version playtesters have seen, for the release dialog. `live` = it is the
// card's published version right now; `artChanged` is worked out on the server.
export type ReleaseBase = { versionNumber: number; data: DesignCard; live: boolean; artChanged: boolean };

// True when a release would do nothing. forge_publish_card (migration 127) decides, and
// only mints nothing when the card has a live version: a first release always mints, and
// so does releasing a card whose last release was retired, since that has an effect.
export function isReleaseUnchanged(draft: DesignCard, base: ReleaseBase | null): boolean {
  return !!base && base.live && !base.artChanged && sameCardContent(draft, base.data);
}

export function releaseUnchangedNote(versionNumber: number | null): string {
  return `Nothing has changed since ${versionNumber === null ? "the last release" : `v${versionNumber}`}, so there is nothing to release.`;
}

// What the Release dialog shows will ship. A denied change stays in the draft, because a
// proposal isn't a branch, so this is where it gets seen before it reaches playtesters.
export function releasePreview(
  draft: DesignCard,
  base: ReleaseBase | null,
): { caption: string; changes: FieldChange[]; artNote: string | null } {
  // A first release gets no field list: every field reads as an addition.
  if (!base) return { caption: "First release: playtesters haven’t seen this card yet.", changes: [], artNote: null };
  const changes = diffCards(base.data, draft);
  const v = `v${base.versionNumber}`;
  const caption =
    changes.length === 0
      ? `No field changes since ${v}.`
      : base.live
        ? `Playtesters will see these changes from ${v}:`
        : `Changes since ${v}, the last release:`;
  return { caption, changes, artNote: base.artChanged ? `The artwork has changed since ${v}.` : null };
}

// A flush failure leaves the server on the previous draft, so acting would ship old text.
export const RELEASE_FLUSH_FAILED =
  "Couldn’t save your latest edits, so nothing was released. Check your connection and try again.";
export const DENY_FLUSH_FAILED =
  "Couldn’t save your latest edits, so the proposal wasn’t denied. Check your connection and try again.";
export const ACCEPT_FLUSH_FAILED =
  "Couldn’t save your latest edits, so the proposal wasn’t accepted. Check your connection and try again.";
// The Accept dialog when the proposal closed underneath it: a release, or another elder's
// decision, landed while it was open.
export const ACCEPT_CLOSED_NOTE = "This proposal was closed while this was open, so there’s nothing left to accept.";

// The choice in the Deny dialog. A proposal freezes the one shared draft, so denying can't
// simply undo it: going back to vN throws away everything since vN, not just the proposal.
// Defaults to going back only when that loses nothing but the denied change. Once the
// draft has moved on, the default keeps it, and the option says what it would cost.
export function denyDraftPlan({
  draft,
  proposed,
  latest,
}: {
  draft: DesignCard;
  proposed: DesignCard;
  latest: { versionNumber: number; data: DesignCard } | null;
}): {
  offer: boolean;
  defaultRestore: boolean;
  restoreLabel: string;
  restoreHint: string;
  keepLabel: string;
  keepHint: string;
  note: string | null;
} {
  const movedOn = !sameCardContent(draft, proposed);
  const plan = {
    offer: false,
    defaultRestore: false,
    restoreLabel: `Put the draft back to v${latest?.versionNumber}`,
    restoreHint: movedOn
      ? "The draft has changed since this was proposed, so this also throws away those newer edits. Artwork stays as it is."
      : "The denied wording stays in this proposal’s history. Artwork stays as it is.",
    keepLabel: "Leave the draft as it is",
    keepHint: "The denied change stays in the draft, and the next release will include it.",
    note: null as string | null,
  };
  if (!latest) return { ...plan, note: "The draft keeps this change, because the card has no earlier version to go back to." };
  if (sameCardContent(draft, latest.data)) return plan;
  return { ...plan, offer: true, defaultRestore: !movedOn };
}

const ACTION_ELIGIBLE: Record<LifecycleAction, readonly string[]> = {
  release: ["draft", "playtesting"],
  markFinal: ["playtesting"],
  reopen: ["approved"],
  shelve: ["draft", "playtesting", "approved"],
  restore: ["archived"],
  returnToIdeas: ["draft", "playtesting", "approved", "archived"],
  delete: ["private_idea", "draft", "playtesting", "approved", "archived"],
};

export function isEligible(action: LifecycleAction, status: string): boolean {
  return ACTION_ELIGIBLE[action].includes(status);
}

export type ConfirmCopy = { title: string; description: string; confirmLabel: string };

// forge_send_card_to_private makes the person clicking the owner, on purpose (#443):
// a card returned from a set lands in THEIR ideas, whoever made it. The card is then
// private to them, because forge_cards_select only admits set elders while set_id is set.
export function returnToIdeasCopy(count: number): ConfirmCopy {
  const one = count === 1;
  return {
    title: one ? "Return to ideas?" : `Return ${count} cards to ideas?`,
    description: one
      ? "Moves this card to your own ideas and makes you its owner. Nobody else on the set can see it there. Released versions are retired and playtesters can no longer see it."
      : "Moves these cards to your own ideas and makes you their owner. Nobody else on the set can see them there. Released versions are retired and playtesters can no longer see them.",
    confirmLabel: "Return to ideas",
  };
}

// Delete is permanent and reached from grids of near-identical tiles, so the dialog
// says which card. A bulk delete names the first few and counts the rest.
export function deleteCopy(names: (string | null | undefined)[]): ConfirmCopy {
  const trimmed = names.map((n) => n?.trim() || null);
  if (trimmed.length === 1) {
    return {
      title: trimmed[0] ? `Delete “${trimmed[0]}”?` : "Delete this untitled card?",
      description: "This permanently removes the card and all of its versions. This cannot be undone.",
      confirmLabel: "Delete card",
    };
  }
  const shown = trimmed.slice(0, 3).map((n) => n ?? "Untitled");
  const more = trimmed.length - shown.length;
  return {
    title: `Delete ${trimmed.length} cards?`,
    description: `This permanently removes ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}, with all of their versions. This cannot be undone.`,
    confirmLabel: `Delete ${trimmed.length} cards`,
  };
}

// Where Restore will put a shelved card, from what forge_archive_card recorded (migration
// 127). The grid has no version numbers for this, so only the single-card dialog names one.
export type RestoreTarget = { status: string; versionNumber: number | null };

export function restoreCopy({ status, versionNumber }: RestoreTarget): ConfirmCopy {
  const title = "Restore this card?";
  if (status === "draft") {
    return { title, description: "It goes back to Draft. Playtesters won’t see it until it’s released.", confirmLabel: "Restore" };
  }
  const where = STATUS_LABEL[status] ?? status;
  return {
    title,
    description: versionNumber === null
      ? `It goes back to ${where}, and playtesters can see it again.`
      : `It goes back to ${where} on v${versionNumber}. Playtesters can see v${versionNumber} again, but not any edits made since.`,
    confirmLabel: "Restore",
  };
}

// The actions on the set grid's bulk bar, plus the toolbar's "Release all".
export type BulkAction = Exclude<LifecycleAction, "reopen">;
export type BulkConfirmAction = BulkAction | "releaseAll";

const cardCount = (n: number) => `${n} ${n === 1 ? "card" : "cards"}`;

// Every bulk action confirms, in the same voice as the single-card dialogs: what will
// happen, and what playtesters will see. `names` holds the cards it would really touch.
export function bulkConfirmCopy(action: BulkConfirmAction, { names }: { names: (string | null | undefined)[] }): ConfirmCopy {
  const n = names.length;
  const one = n === 1;
  switch (action) {
    case "release":
      return {
        title: `Release ${cardCount(n)}?`,
        description: "Freezes each card’s current draft as a new version visible to playtesters. A card with no changes since its last release is skipped.",
        confirmLabel: "Release",
      };
    case "releaseAll":
      return {
        title: "Release all drafts?",
        description: `Releases ${n} draft ${one ? "card" : "cards"} matching the current filters. Playtesters will be able to see and build playtest decks with ${one ? "it" : "them"}.`,
        confirmLabel: "Release all",
      };
    case "markFinal":
      return {
        title: `Mark ${cardCount(n)} final?`,
        description: `Marks ${one ? "the card’s released version" : "each card’s released version"} as final. No new version is made. Playtesters can still see ${one ? "it" : "them"}, and Reopen testing undoes this.`,
        confirmLabel: "Mark final",
      };
    case "shelve":
      return {
        title: `Shelve ${cardCount(n)}?`,
        description: one
          ? "Playtesters can no longer see this card. Restore puts it back as it was."
          : "Playtesters can no longer see these cards. Restore puts each one back as it was.",
        confirmLabel: "Shelve",
      };
    case "restore":
      return {
        title: `Restore ${cardCount(n)}?`,
        description: "A card that was released when it was shelved goes back to In playtest or Final on the same version, and playtesters can see it again. Any other card goes back to Draft.",
        confirmLabel: "Restore",
      };
    case "returnToIdeas":
      return returnToIdeasCopy(n);
    case "delete":
      return deleteCopy(names);
  }
}

// Bulk release uses forge_publish_card, so it closes open proposals as a single release
// does (migration 083). The grid only has per-card counts, not which proposal matches
// which draft, so this says what happens to them rather than how many of each.
export function bulkProposalNotice(openCount: number): string[] {
  if (openCount <= 0) return [];
  return [
    openCount === 1
      ? "1 open proposal on these cards will be closed. If it matches its card’s draft it’s recorded as accepted by the release; otherwise it’s closed as out of date. Review it first if you still want it."
      : `${openCount} open proposals on these cards will be closed. One that matches its card’s draft is recorded as accepted by the release; the rest are closed as out of date. Review them first if you still want them.`,
  ];
}

export function bulkBlockedNotice(blocked: number): string[] {
  if (blocked <= 0) return [];
  return [`${cardCount(blocked)} ${blocked === 1 ? "has" : "have"} no name or type and will be skipped.`];
}

export type BulkSkipReason = "noNameOrType" | "unchanged";

// The line under the grid after a bulk action. Skips with a known reason say so.
export function bulkSummary(
  action: LifecycleAction,
  r: { done: number; skipped: number; failed: number; reasons?: Partial<Record<BulkSkipReason, number>> },
): string {
  const noNameOrType = r.reasons?.noNameOrType ?? 0;
  const unchanged = r.reasons?.unchanged ?? 0;
  const parts = [
    ...(noNameOrType > 0 ? [`${noNameOrType} no name or type`] : []),
    ...(unchanged > 0 ? [`${unchanged} unchanged since last release`] : []),
  ];
  const other = r.skipped - noNameOrType - unchanged;
  if (parts.length > 0 && other > 0) parts.push(`${other} not eligible`);
  const why = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `${BULK_DONE_VERB[action]} ${r.done} · ${r.skipped} skipped${why} · ${r.failed} failed`;
}
