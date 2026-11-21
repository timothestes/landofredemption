import { describe, expect, it } from "vitest";
import type { DeckSnapshotCard } from "../deckSubmission";
import { parseDecklistText } from "@/lib/decksheets/parse";
import { pdfDeckType, snapshotDecklistText, submissionPdfBody } from "../submissionPdf";

const card = (name: string, quantity: number, zone: "main" | "reserve" = "main"): DeckSnapshotCard => ({ name, set: "X", imgFile: null, quantity, zone });
const cards = [card("Son of God", 1), card("Angel of the Lord", 2), card("Buckler", 1, "reserve"), card("Gone", 0)];

describe("the deck check PDF of a submitted list", () => {
  it("picks the sheet from the event's format", () => {
    expect(pdfDeckType("Limited")).toBe("type_1");
    expect(pdfDeckType("Unlimited")).toBe("type_1");
    expect(pdfDeckType("Teams")).toBe("type_1");
    expect(pdfDeckType("T2")).toBe("type_2");
    expect(pdfDeckType("Paragon")).toBe("paragon");
    expect(pdfDeckType("Other")).toBe("type_1");
    expect(pdfDeckType(null)).toBe("type_1");
  });

  it("writes main then Reserve as quantity, tab, name", () => {
    expect(snapshotDecklistText(cards)).toBe("2\tAngel of the Lord\n1\tSon of God\nReserve:\n1\tBuckler");
    expect(snapshotDecklistText([card("Son of God", 1)])).toBe("1\tSon of God");
  });

  it("is text the PDF service's own parser reads back as the same list", () => {
    const parsed = parseDecklistText(snapshotDecklistText(cards));
    expect(JSON.stringify(parsed)).toContain("Angel of the Lord");
    expect(JSON.stringify(parsed)).toContain("Buckler");
    expect(JSON.stringify(parsed)).not.toContain("Gone");
  });

  it("sends the player, the event and the verdict on record", () => {
    const body = submissionPdfBody({ cards, format: "T2", playerName: "  Test Player ", eventName: "E".repeat(130), isLegal: false });
    expect(body).toMatchObject({ decklist_type: "type_2", name: "Test Player", show_alignment: true, is_legal: false });
    expect(body.event).toHaveLength(100);
    // No verdict on record: the sheet prints no seal rather than a wrong one.
    expect("is_legal" in submissionPdfBody({ cards, format: "Limited", playerName: "P", eventName: "E", isLegal: null })).toBe(false);
  });
});
