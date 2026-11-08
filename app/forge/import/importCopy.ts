// What the import wizard says about a run before it: the button, the note beside it, each
// preview row's outcome. Pure.

import type { RowPreview } from "./overwrite";

const cardCount = (n: number) => (n === 1 ? "1 card" : `${n} cards`);

export type RowOutcome = "add" | "skip" | "update" | "same";

// What the route will do with this row. A row with an image counts as a change for the reason
// given at summarizeOverwritePreview. Null: the route couldn't read the row, so the run will
// fail it and give the reason then.
export function rowOutcome(preview: RowPreview | undefined, overwrite: boolean, hasImage: boolean): RowOutcome | null {
  if (!preview) return null;
  if (preview === "new") return "add";
  if (!overwrite) return "skip";
  return preview === "changed" || hasImage ? "update" : "same";
}

export const OUTCOME_LABEL: Record<RowOutcome, string> = {
  add: "New",
  skip: "Will skip: already in this set",
  update: "Will update",
  same: "Already matches",
};

export function importButtonCopy(
  total: number,
  outcomes: (RowOutcome | null)[] | null,
  overwrite: boolean,
): { label: string; note: string | null; nothingToDo: boolean } {
  const plain = { label: `Import ${cardCount(total)}`, note: null, nothingToDo: false };
  if (!outcomes) return plain;

  const count = (o: RowOutcome) => outcomes.filter((x) => x === o).length;
  const add = outcomes.filter((x) => x === "add" || x === null).length; // null still goes in the run
  const newLabel = `Import ${add} new ${add === 1 ? "card" : "cards"}`;

  if (!overwrite) {
    const skip = count("skip");
    if (skip === 0) return plain;
    const one = skip === 1;
    if (add === 0) {
      return {
        label: "Nothing new to import",
        note: `${one ? "This card is" : `All ${skip} are`} already in this set. Tick Overwrite existing cards to update ${one ? "it" : "them"}.`,
        nothingToDo: true,
      };
    }
    return {
      label: newLabel,
      note: `${skip} ${one ? "is" : "are"} already in this set and will be skipped. Tick Overwrite existing cards to update ${one ? "it" : "them"} instead.`,
      nothingToDo: false,
    };
  }

  const update = count("update");
  const same = count("same");
  if (update === 0 && add === 0) {
    return {
      label: "Nothing to change",
      note: same === 1 ? "This card already matches this file." : `All ${same} already match this file.`,
      nothingToDo: true,
    };
  }
  return {
    label: update === 0 ? newLabel : `Overwrite ${cardCount(update)}${add > 0 ? ` and add ${add}` : ""}`,
    note: same > 0 ? `${same} already ${same === 1 ? "matches" : "match"} this file and won’t be touched.` : null,
    nothingToDo: false,
  };
}
