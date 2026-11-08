import type { DesignCard } from "@/app/forge/lib/designCard";

export interface SelectedCard {
  name: string;
  snapshot: DesignCard;
  derived: string[];        // snapshot keys with no cell behind them; an overwrite skips these
  entryName: string | null; // image entry in the source zip, if matched
  warnings: string[];       // data-quality notes surfaced in the preview
}

// What a source panel hands the shared wizard: the cards to import plus the zip
// bytes/sizes needed to preview and upload their images.
export interface SourceSelection {
  cards: SelectedCard[];
  zipBytes: Uint8Array | null;   // null → no images, cards import text-only
  sizes: Record<string, number>; // uncompressed bytes per zip entry (batch sizing)
  defaultSetName: string;        // prefill for the "new set" dialog ("" = leave as-is)
  key: string;                   // identity — a change resets any run in the wizard
}
