// What the studio and the grid say about a card's images. Pure, for testing in node.

// A flag only means something on art you can see: with no art there's nothing to flag, and a
// finished image is drawn instead of the art, for playtesters too.
export function placeholderShowing(card: { hasArt: boolean; hasFinished: boolean }, isPlaceholder: boolean): boolean {
  return isPlaceholder && card.hasArt && !card.hasFinished;
}

export const PLACEHOLDER_NOTE = "This art is marked as a placeholder.";

// The two halves are both by design: the 066 art branch hides it from anyone browsing a release,
// and the in-game render draws it (docs/superpowers/specs/2026-09-13-forge-rendered-play-cards-design.md,
// Decision 4). Cropping and switching both go through forge_set_working_art, which clears the flag.
export const PLACEHOLDER_HELP = "Playtesters browsing the set see NO ART in its place, though games still draw it. Cropping or switching the image clears this.";

export const FINISHED_NOTE = "Showing the finished image. Field edits won’t change it.";

export const FINISHED_HELP_ON = "This image is what the card shows everywhere. Field edits won’t change it: replace it to match, or remove it to go back to the card drawn from its fields.";

// Only the card's pointer goes, but nothing in the Forge can point it back at the old file, so to
// the person pressing the button the image is gone. Released versions hold their own copy of the key.
export function removeFinishedCopy(status: string): { title: string; description: string; confirmLabel: string } {
  const released = status === "playtesting" || status === "approved";
  return {
    title: "Remove the finished image?",
    description:
      "The card goes back to being drawn from its fields and artwork. To use this image later you’d have to upload it again, so download it first if you need a copy." +
      (released ? " Playtesters keep seeing the released version until your next release." : ""),
    confirmLabel: "Remove",
  };
}
