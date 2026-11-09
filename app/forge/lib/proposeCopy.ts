// Single source of truth for the propose form's copy. Pure, node-testable — the
// form itself is state-gated behind `proposing`, so this is the only layer where
// the wording can be asserted without a DOM. Mirrors lifecycleCopy's split.

// Shown under the "Open proposals" heading at ALL times, not just once the form is
// open: the button is the thing people misread, so the correction cannot live
// behind it. Names the two facts newcomers get wrong — edits are already shared,
// and proposing is not where you author them.
export const PROPOSE_INTRO =
  "Your edits to this card save automatically and are already visible to other elders. " +
  "Proposing doesn’t make a change — it submits the draft as it stands for sign-off.";

// What ACCEPTING does. Deliberately does not predict a version number: v_next is
// computed inside the accept transaction (migration 075), so any number shown here
// is invalidated by a concurrent accept or release.
export function proposeConsequence(cardStatus: string): string {
  return cardStatus === "playtesting"
    ? "Accepting releases a new version to playtesters and replaces the working draft."
    : "Accepting records a version in the card’s history. The card stays in Draft — nothing reaches playtesters.";
}

// Why Accept refused on an In playtest card, where accepting releases the proposal. The check is
// forge_accept_proposal's (migration 128), and a Draft card's accept never gets this.
export const ACCEPT_NEEDS_NAME_AND_TYPE =
  "A card needs a name and a type before it can be released, and this proposal is missing one. Deny it, or propose again with both filled in.";

// Caption above the field list. No "as last saved" qualifier: submitting flushes
// the editor first, so the submission deliberately includes edits newer than this
// preview. Promising either freshness or staleness would be a lie.
export function proposeDiffCaption(versionNumber: number): string {
  return `The current draft differs from v${versionNumber} in these ways:`;
}

// Empty field diff. A statement of fact, never "edit the card first" — artwork
// lives in working_art_key/working_finished_key, outside the snapshot diffCards
// sees, yet forge_accept_proposal checkpoints it.
export function proposeEmptyNote(versionNumber: number): string {
  return `No field changes since v${versionNumber}. Artwork changes aren’t listed here.`;
}

export const PROPOSE_NEW_CARD = "New card — this is its first submission.";

// Asserts no capability: canReview comes from the global role, while the accept
// RPC gates on per-set elder. Phrased so it is true either way.
export const PROPOSE_SELF_ACCEPT =
  "If you’re the only elder on this set, accepting your own submission is how you checkpoint — that’s intended.";

export const PROPOSE_ALREADY_UNDER_REVIEW = "This draft is already under review.";

// Shown when the pre-submit flush fails. Without it the proposal would freeze the
// PREVIOUS snapshot — the exact bug the flush exists to prevent.
export const PROPOSE_FLUSH_FAILED =
  "Couldn’t save your latest edits, so nothing was submitted. Check your connection and try again.";
