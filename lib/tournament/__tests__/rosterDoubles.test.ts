import { describe, it, expect } from "vitest";
import { typedDoubles } from "../rosterDoubles";

const typed = (id: string, name: string) => ({ id, name, user_id: null, guest_key: null });
const account = (id: string, name: string) => ({ id, name, user_id: `user-${id}`, guest_key: null });
const guest = (id: string, name: string) => ({ id, name, user_id: null, guest_key: `key-${id}` });
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("typedDoubles", () => {
  it("flags the typed entry when a player with that name joined by QR", () => {
    expect(ids(typedDoubles([typed("a", "Pat Doe"), account("b", "Pat Doe"), typed("c", "Sam Roe")]))).toEqual(["a"]);
  });

  it("ignores case and spacing in the two names", () => {
    expect(ids(typedDoubles([typed("a", "  pat   DOE "), account("b", "Pat Doe")]))).toEqual(["a"]);
    expect(ids(typedDoubles([typed("a", "PatDoe"), account("b", "Pat Doe")]))).toEqual(["a"]);
  });

  it("counts a guest who joined by QR without an account", () => {
    expect(ids(typedDoubles([typed("a", "Pat Doe"), guest("b", "pat doe")]))).toEqual(["a"]);
  });

  it("never flags the entry that joined by QR", () => {
    const flagged = ids(typedDoubles([account("b", "Pat Doe"), typed("a", "Pat Doe"), guest("c", "Pat Doe")]));
    expect(flagged).toEqual(["a"]);
  });

  it("leaves two typed entries alone: the host was already asked about that name", () => {
    expect(typedDoubles([typed("a", "Pat Doe"), typed("b", "Pat Doe")])).toEqual([]);
  });

  it("leaves two QR entries alone: two accounts are two people", () => {
    expect(typedDoubles([account("a", "Pat Doe"), account("b", "Pat Doe"), guest("c", "Pat Doe")])).toEqual([]);
  });

  it("flags every typed entry that shares the name", () => {
    expect(ids(typedDoubles([typed("a", "Pat Doe"), typed("b", "pat doe"), account("c", "Pat Doe")]))).toEqual(["a", "b"]);
  });

  it("does not match different or blank names", () => {
    expect(typedDoubles([typed("a", "Pat Doe"), account("b", "Pat Dole")])).toEqual([]);
    expect(typedDoubles([typed("a", "  "), account("b", "")])).toEqual([]);
  });
});
