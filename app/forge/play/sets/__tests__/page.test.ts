import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/app/forge/lib/sets", () => ({ listSets: vi.fn(async () => []) }));

import ForgePlaySetsPage from "../page";
import { DESIGNER_PAGE_LANDING } from "@/app/forge/lib/playtesterLanding";

const render = async (from?: string) =>
  renderToStaticMarkup(await ForgePlaySetsPage({ searchParams: Promise.resolve({ from }) }));

describe("sets list note", () => {
  it("shows on the landing from a designer page", async () => {
    const from = new URL(DESIGNER_PAGE_LANDING, "http://x").searchParams.get("from")!;
    expect(await render(from)).toContain("That page is for designers");
  });

  it("stays away on an ordinary visit", async () => {
    expect(await render()).not.toContain("That page is for designers");
  });
});
