import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const auth = vi.hoisted(() => ({ role: "playtester" }));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), useRouter: () => ({}) }));
vi.mock("../lib/auth", () => ({ requireForge: vi.fn(async () => ({ role: auth.role, user: { id: "u1" } })) }));
vi.mock("../lib/sets", () => ({ listSets: vi.fn(async () => []) }));
vi.mock("../lib/cards", () => ({ createCard: vi.fn() }));

import ForgeHomePage from "../page";
import { listSets } from "../lib/sets";

const set = {
  id: "s1", name: "Invented Harvest", slug: "h", status: "active", total: 12, targetTotal: 200,
  statusCounts: { playtesting: 12 }, isPrivate: true,
};
const home = async () => renderToStaticMarkup(await ForgeHomePage());
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

describe("Forge home for a playtester", () => {
  beforeEach(() => {
    auth.role = "playtester";
    vi.mocked(listSets).mockReset();
    vi.mocked(listSets).mockResolvedValue([set]);
  });

  it("leads with the sets shared with them, before decks and games", async () => {
    const html = await home();
    expect(hrefs(html)).toEqual(["/forge/play/s1", "/forge/play/decks/new", "/forge/play"]);
    expect(html).toContain("Sets shared with you");
    expect(html).toContain("Invented Harvest");
    expect(html).toContain("12 cards");
  });

  it("offers only what a playtester can open", async () => {
    const html = await home();
    for (const route of ["/forge/import", "/forge/sets", "/forge/ideas", "/forge/admin"]) {
      expect(html).not.toContain(route);
    }
  });

  it("says so when nothing has been shared, and still offers decks and games", async () => {
    vi.mocked(listSets).mockResolvedValue([]);
    const html = await home();
    expect(html).toContain("No sets have been shared with you yet.");
    expect(html).not.toContain("Open a set");
    expect(hrefs(html)).toEqual(["/forge/play/decks/new", "/forge/play"]);
  });
});

describe("Forge home for a designer", () => {
  it("is untouched and costs no extra read", async () => {
    auth.role = "elder";
    vi.mocked(listSets).mockReset();
    const html = await home();
    expect(listSets).not.toHaveBeenCalled();
    expect(html).not.toContain("Sets shared with you");
    expect(hrefs(html)).toContain("/forge/import");
  });
});
