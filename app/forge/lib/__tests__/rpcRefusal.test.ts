import { describe, it, expect } from "vitest";
import { refusalOr } from "../rpcRefusal";

describe("refusalOr", () => {
  it("shows a refusal raised by the RPC, as a sentence", () => {
    expect(refusalOr({ code: "P0001", message: "a promoted card is read-only" }, "Could not save")).toBe("A promoted card is read-only.");
    expect(refusalOr({ code: "P0001", message: "not authorized to edit this card" }, "Could not save")).toBe("Not authorized to edit this card.");
  });

  it("doesn't double a full stop the RPC already wrote", () => {
    expect(refusalOr({ code: "P0001", message: "already gone." }, "Could not save")).toBe("Already gone.");
  });

  it("keeps anything else general, so a connection or constraint error doesn't reach a member", () => {
    expect(refusalOr({ code: "PGRST301", message: "JWT expired" }, "Could not save")).toBe("Could not save");
    expect(refusalOr({ code: "23505", message: "duplicate key value" }, "Could not save")).toBe("Could not save");
    expect(refusalOr({ message: "TypeError: fetch failed" }, "Could not save")).toBe("Could not save");
    expect(refusalOr({ code: "P0001", message: "" }, "Could not save")).toBe("Could not save");
  });
});
