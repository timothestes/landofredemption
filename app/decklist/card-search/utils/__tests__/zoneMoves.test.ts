import { describe, it, expect } from "vitest";
import { applyZoneMoves, describeZoneMoves, invertZoneMoves, stackMoves, type ZoneMove } from "../zoneMoves";
import type { DeckCard, DeckZone } from "../../types/deck";
import type { Card } from "../../utils";

function card(name: string, set = "Pi"): Card {
  return { name, set } as Card;
}

function dc(name: string, quantity: number, zone: DeckZone, set = "Pi"): DeckCard {
  return { card: card(name, set), quantity, zone };
}

function stack(entry: DeckCard, toZone: DeckZone | null): ZoneMove {
  return { card: entry.card, fromZone: entry.zone, toZone, quantity: entry.quantity };
}

function summary(cards: DeckCard[]): string[] {
  return cards.map((c) => `${c.zone}:${c.card.name}|${c.card.set}x${c.quantity}`).sort();
}

describe("applyZoneMoves", () => {
  it("moves whole stacks between zones", () => {
    const a = dc("Burial", 1, "maybeboard");
    const b = dc("Annas the Elder", 3, "maybeboard");
    const result = applyZoneMoves([a, b, dc("Lost Soul", 2, "main")], [stack(a, "main"), stack(b, "main")]);
    expect(summary(result)).toEqual([
      "main:Annas the Elder|Pix3",
      "main:Burial|Pix1",
      "main:Lost Soul|Pix2",
    ]);
  });

  it("merges into an existing entry in the target zone", () => {
    const reserve = dc("Burial", 2, "reserve");
    const result = applyZoneMoves([dc("Burial", 1, "main"), reserve], [stack(reserve, "main")]);
    expect(summary(result)).toEqual(["main:Burial|Pix3"]);
  });

  it("keys entries by name AND set", () => {
    const moved = dc("Burial", 1, "main", "Pi");
    const result = applyZoneMoves([moved, dc("Burial", 1, "main", "RoJ")], [stack(moved, "reserve")]);
    expect(summary(result)).toEqual(["main:Burial|RoJx1", "reserve:Burial|Pix1"]);
  });

  it("removes cards when toZone is null", () => {
    const gone = dc("Burial", 4, "main");
    const result = applyZoneMoves([gone, dc("Lost Soul", 1, "main")], [stack(gone, null)]);
    expect(summary(result)).toEqual(["main:Lost Soul|Pix1"]);
  });

  it("never takes more copies than the source holds", () => {
    const result = applyZoneMoves(
      [dc("Burial", 2, "main")],
      [{ card: card("Burial"), fromZone: "main", toZone: "reserve", quantity: 5 }]
    );
    expect(summary(result)).toEqual(["reserve:Burial|Pix2"]);
  });

  it("skips a move whose source entry is gone", () => {
    const cards = [dc("Lost Soul", 1, "main")];
    const result = applyZoneMoves(cards, [
      { card: card("Burial"), fromZone: "main", toZone: "reserve", quantity: 1 },
    ]);
    expect(result).toBe(cards);
  });

  it("does not mutate the input", () => {
    const cards = [dc("Burial", 2, "main")];
    applyZoneMoves(cards, [{ card: card("Burial"), fromZone: "main", toZone: "reserve", quantity: 1 }]);
    expect(summary(cards)).toEqual(["main:Burial|Pix2"]);
  });
});

describe("stackMoves", () => {
  it("moves every copy and skips entries already in the target zone", () => {
    const moves = stackMoves([dc("Burial", 3, "main"), dc("Lost Soul", 2, "reserve")], "reserve");
    expect(moves).toEqual([{ card: card("Burial"), fromZone: "main", toZone: "reserve", quantity: 3 }]);
  });
});

describe("invertZoneMoves", () => {
  it("undoes a move", () => {
    const before = [dc("Burial", 1, "main"), dc("Annas the Elder", 2, "reserve"), dc("Burial", 1, "maybeboard")];
    const moves = [stack(before[0], "maybeboard"), stack(before[1], "maybeboard")];
    const after = applyZoneMoves(before, moves);
    expect(summary(after)).toEqual(["maybeboard:Annas the Elder|Pix2", "maybeboard:Burial|Pix2"]);
    expect(summary(applyZoneMoves(after, invertZoneMoves(moves)))).toEqual(summary(before));
  });

  it("undoes a removal", () => {
    const before = [dc("Burial", 3, "main"), dc("Lost Soul", 1, "main")];
    const moves = [stack(before[0], null)];
    const restored = applyZoneMoves(applyZoneMoves(before, moves), invertZoneMoves(moves));
    expect(summary(restored)).toEqual(summary(before));
  });
});

describe("describeZoneMoves", () => {
  it("counts copies and names the target zone", () => {
    expect(describeZoneMoves([stack(dc("Burial", 3, "main"), "reserve"), stack(dc("Lost Soul", 4, "main"), "reserve")])).toBe(
      "Moved 7 cards to Reserve"
    );
    expect(describeZoneMoves([stack(dc("Burial", 1, "main"), null)])).toBe("Removed 1 card");
  });
});
