// "Overwrite existing cards": what an import row changes on a card that already exists, and
// what the confirm step says about it. Pure and client-safe; the route and the wizard share it.

import { cardRawText, type DesignCard } from "@/app/forge/lib/designCard";
import { sameValue, type SnapshotPatch } from "@/app/forge/lib/cardSave";

type Fields = Record<string, unknown>;

// Parsers only set a key when a cell has a value they could read, so an absent key is a blank
// cell or a column the file doesn't have, and either way the card keeps its value. The
// exceptions are handled here: `name` is what matched the row to this card, and `derived` lists
// keys the parser filled in with no cell behind them. Nothing is ever removed, so a file can't
// clear a field.
export function overwritePatch(current: DesignCard, row: DesignCard, derived: string[] = []): SnapshotPatch {
  const set = { ...row } as Fields;
  delete set.name;
  for (const k of derived) delete set[k];
  // The parser copies the one text cell into rawText and the legacy specialAbility. The studio
  // only edits rawText, so specialAbility drifts; comparing it would call a matching row changed.
  if (row.rawText !== undefined && cardRawText(current) === row.rawText) {
    delete set.rawText;
    delete set.specialAbility;
  }
  for (const k of Object.keys(set)) {
    if (set[k] === undefined || sameValue((current as Fields)[k], set[k])) delete set[k];
  }
  return { set: set as Partial<DesignCard>, remove: [] };
}

export type RowPreview = "new" | "changed" | "unchanged";

export type OverwritePreview = {
  changed: number;    // existing cards this run will write to
  unchanged: number;  // existing cards it will leave alone
  created: number;    // rows with no card yet
  images: number;     // existing cards getting a finished image from the file
};

// A row with an image always counts as a change: stored images are re-encoded under a random
// key, so there's nothing to compare the file's image to, and the run will replace it.
export function summarizeOverwritePreview(rows: { preview?: RowPreview; hasImage: boolean }[]): OverwritePreview {
  const out: OverwritePreview = { changed: 0, unchanged: 0, created: 0, images: 0 };
  for (const { preview, hasImage } of rows) {
    if (preview === "new") out.created++;
    else if (preview === "changed" || (preview === "unchanged" && hasImage)) out.changed++;
    else if (preview === "unchanged") out.unchanged++;
    if (preview && preview !== "new" && hasImage) out.images++;
  }
  return out;
}

export function overwriteConfirmCopy({ changed, unchanged, created, images }: OverwritePreview): {
  title: string;
  confirmLabel: string;
  notes: string[];
} {
  const notes: string[] = [];
  if (unchanged > 0) {
    notes.push(`${unchanged} already ${unchanged === 1 ? "matches" : "match"} this file and won’t be touched.`);
  }
  if (images > 0) {
    notes.push(
      `${images} ${images === 1 ? "gets" : "get"} the finished image from this file. Images aren’t compared, so the same picture still counts as a change.`,
    );
  }
  if (created > 0) {
    notes.push(`${created} new ${created === 1 ? "card" : "cards"} will be added to the set.`);
  }
  notes.push("Blank cells and columns not in this file leave a card’s values alone.");
  notes.push("Playtesters see nothing until you release the update. There’s no undo.");
  return {
    title: `${changed} existing ${changed === 1 ? "card" : "cards"} will change`,
    confirmLabel: `Overwrite ${changed} ${changed === 1 ? "card" : "cards"}`,
    notes,
  };
}
