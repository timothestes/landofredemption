import type { Deck, ImportResult } from "../types/deck";

export type ImportStep = "stop" | "confirm" | "import";

/**
 * What the Import button does with a parsed list. A dropped line stops the import
 * until the user has seen it and chosen to go on; until then their current deck
 * is not replaced and nothing is saved.
 */
export function nextImportStep(result: Pick<ImportResult, "deck" | "errors">, acceptDropped: boolean): ImportStep {
  if (!result.deck) return "stop";
  if (result.errors.length > 0 && !acceptDropped) return "confirm";
  return "import";
}

export function importedCardCount(deck: Deck | null): number {
  return (deck?.cards ?? []).reduce((total, deckCard) => total + deckCard.quantity, 0);
}

function lineCount(n: number): string {
  return `${n} line${n === 1 ? "" : "s"}`;
}

export function droppedHeading(dropped: number): string {
  return `${lineCount(dropped)} not imported:`;
}

export function continueHint(keptCards: number, signedIn: boolean): string {
  const others = keptCards === 1 ? "the other card" : `the other ${keptCards} cards`;
  const hint = `Correct the list and import again, or import ${others} without these lines.`;
  return signedIn ? `${hint} The deck saves straight away.` : hint;
}

/**
 * The toast after an import. A signed-out user gets no cloud save, so nothing here
 * may claim one, and a clean signed-out import stays silent as it always has.
 */
export function importNotice({ dropped, signedIn, saved }: { dropped: number; signedIn: boolean; saved: boolean }): {
  message: string;
  type: "success" | "error" | "info";
} | null {
  const without = dropped > 0 ? ` without ${lineCount(dropped)}` : "";
  if (!signedIn) return dropped > 0 ? { message: `Deck imported${without}`, type: "info" } : null;
  if (!saved) return { message: `Imported${without}, but failed to save`, type: "error" };
  return dropped > 0
    ? { message: `Deck imported and saved${without}`, type: "info" }
    : { message: "Deck imported and saved!", type: "success" };
}
