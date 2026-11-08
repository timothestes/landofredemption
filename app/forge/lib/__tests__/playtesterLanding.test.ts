import { describe, it, expect, vi, beforeEach } from "vitest";

const single = vi.fn();
vi.mock("@/app/forge/lib/auth", () => ({
  requireForge: vi.fn(async () => ({
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: single }) }) }) },
  })),
}));
const getSet = vi.fn();
vi.mock("@/app/forge/lib/sets", () => ({ getSet: (id: string) => getSet(id) }));

import { DESIGNER_PAGE_LANDING, designerPageNote, playtesterCardLanding, type PlaytesterCardFacts } from "../playtesterLanding";
import { playtesterCardHref } from "../play";

const released: PlaytesterCardFacts = {
  id: "card-1", setId: "set-1", status: "playtesting", releasedVersionId: "version-1", setGranted: true,
};

describe("playtesterCardLanding", () => {
  it("opens a released card in a granted set in the playtest view", () => {
    expect(playtesterCardLanding(released)).toBe("/forge/play/set-1?card=card-1");
    expect(playtesterCardLanding({ ...released, status: "approved" })).toBe("/forge/play/set-1?card=card-1");
    expect(playtesterCardLanding({ ...released, status: "promoted" })).toBe("/forge/play/set-1?card=card-1");
  });

  // Every "no" below has to be the same "no": any difference would confirm that a card exists.
  const refusals: [string, PlaytesterCardFacts | null][] = [
    ["a card that does not exist", null],
    ["a draft in a granted set", { ...released, status: "draft" }],
    ["a private idea", { ...released, status: "private_idea", setId: null, setGranted: false }],
    ["a shelved card", { ...released, status: "archived" }],
    ["a released card in a set not granted", { ...released, setGranted: false }],
    ["a card with no set", { ...released, setId: null }],
    ["a testable status with no released version", { ...released, releasedVersionId: null }],
  ];

  it.each(refusals)("treats %s exactly like any designer page", (_name, card) => {
    expect(playtesterCardLanding(card)).toBe(DESIGNER_PAGE_LANDING);
  });

  it("gives an unreleased card and a nonexistent one the same result", () => {
    expect(playtesterCardLanding({ ...released, status: "draft" })).toBe(playtesterCardLanding(null));
  });

  it("names no card or set in the landing", () => {
    expect(DESIGNER_PAGE_LANDING).not.toContain("card-1");
    expect(DESIGNER_PAGE_LANDING).not.toContain("set-1");
  });
});

describe("designerPageNote", () => {
  it("is one fixed sentence for the landing", () => {
    const from = new URL(DESIGNER_PAGE_LANDING, "http://x").searchParams.get("from")!;
    expect(designerPageNote(from)).toBe("That page is for designers, so you landed here instead.");
  });

  it("is absent on an ordinary visit or for any other value", () => {
    expect(designerPageNote(undefined)).toBeNull();
    expect(designerPageNote("elsewhere")).toBeNull();
    expect(designerPageNote(["designers", "designers"])).toBeNull();
  });
});

describe("playtesterCardHref", () => {
  beforeEach(() => {
    single.mockReset();
    getSet.mockReset();
  });
  const row = {
    id: "card-1", set_id: "set-1", status: "playtesting", approved_version_id: null, published_version_id: "version-1",
  };

  it("sends a released card in a granted set to its playtest view", async () => {
    single.mockResolvedValue({ data: row });
    getSet.mockResolvedValue({ id: "set-1" });
    expect(await playtesterCardHref("card-1")).toBe("/forge/play/set-1?card=card-1");
  });

  it("gives a row RLS hides and a malformed id the same landing, with no further reads", async () => {
    single.mockResolvedValue({ data: null });
    expect(await playtesterCardHref("hidden-by-rls")).toBe(DESIGNER_PAGE_LANDING);
    single.mockResolvedValue({ data: null, error: { code: "22P02" } });
    expect(await playtesterCardHref("not-a-uuid")).toBe(DESIGNER_PAGE_LANDING);
    expect(getSet).not.toHaveBeenCalled();
  });

  // RLS lets an owner read their own card whatever its status or grant, so a returned row proves
  // neither. A playtester can hold cards from an earlier role.
  it("does not take an owner's visible draft as released", async () => {
    single.mockResolvedValue({ data: { ...row, status: "draft" } });
    getSet.mockResolvedValue({ id: "set-1" });
    expect(await playtesterCardHref("card-1")).toBe(DESIGNER_PAGE_LANDING);
  });

  it("does not take an owner's visible card as a grant on its set", async () => {
    single.mockResolvedValue({ data: row });
    getSet.mockResolvedValue(null);
    expect(await playtesterCardHref("card-1")).toBe(DESIGNER_PAGE_LANDING);
  });
});
