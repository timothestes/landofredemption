// Client-safe: no card catalog. The deck check PDF of a submitted list, made by the same service as /decklist/generate.
import { getFormatDef } from "@/lib/formats";
import type { DeckSnapshotCard } from "./deckSubmission";

export type PdfDeckType = "type_1" | "type_2" | "paragon";

/** The PDF sheet an event's format is checked on. An event with no format, or one of its own, gets the Type 1 sheet. */
export function pdfDeckType(format: string | null | undefined): PdfDeckType {
  if (!format || format === "Other") return "type_1";
  const family = getFormatDef(format).family;
  return family === "T2" ? "type_2" : family === "Paragon" ? "paragon" : "type_1";
}

/** The list as the PDF service reads it: `quantity<TAB>name`, main deck first, then `Reserve:` when there is one. */
export function snapshotDecklistText(cards: DeckSnapshotCard[]): string {
  const lines = (zone: DeckSnapshotCard["zone"]) =>
    cards
      .filter((c) => c.zone === zone && c.quantity > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => `${c.quantity}\t${c.name}`);
  const reserve = lines("reserve");
  return [...lines("main"), ...(reserve.length ? ["Reserve:", ...reserve] : [])].join("\n");
}

export interface SubmissionPdfRequest {
  cards: DeckSnapshotCard[];
  /** The event's format, as stored on the tournament. */
  format: string | null | undefined;
  playerName: string;
  eventName: string;
  /** The verdict on record; the sheet prints it as its legal seal. */
  isLegal: boolean | null;
}

/** What is sent to `/api/v1/generate-decklist`; the service caps the two names at 50 and 100 characters. */
export function submissionPdfBody(r: SubmissionPdfRequest) {
  return {
    decklist: snapshotDecklistText(r.cards),
    decklist_type: pdfDeckType(r.format),
    name: r.playerName.trim().slice(0, 50),
    event: r.eventName.trim().slice(0, 100),
    show_alignment: pdfDeckType(r.format) === "type_2",
    m_count: false,
    aod_count: false,
    ...(r.isLegal != null ? { is_legal: r.isLegal } : {}),
  };
}

/** Makes the PDF and returns where to download it; throws with the service's own message when it refuses the list. */
export async function requestSubmissionPdf(r: SubmissionPdfRequest): Promise<string> {
  const response = await fetch("/api/v1/generate-decklist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(submissionPdfBody(r)),
  });
  const data = await response.json().catch(() => null);
  const url = data?.data?.downloadUrl;
  if (!response.ok || data?.status === "error" || typeof url !== "string") {
    throw new Error(typeof data?.message === "string" ? data.message : "Couldn't make the PDF. Try again.");
  }
  return url;
}
