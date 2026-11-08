import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/forge";
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  usePathname: () => pathname,
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement("a", { href }, children),
}));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn() }));
vi.mock("../../../components/top-nav", () => ({ default: () => null }));
vi.mock("../components/ForgeNav", () => ({ default: () => null }));

import { requireForge } from "@/app/forge/lib/auth";
import ForgeLayout from "../layout";

const member = (row: { display_name: string | null } | null) => ({
  role: "elder",
  user: { id: "u1" },
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
  },
});

const render = async (row: { display_name: string | null } | null) => {
  (requireForge as any).mockResolvedValue(member(row));
  return renderToStaticMarkup(await ForgeLayout({ children: React.createElement("main") }));
};

beforeEach(() => { pathname = "/forge"; });

describe("ForgeLayout name prompt", () => {
  it("asks a nameless member to pick a name, and links to where they can", async () => {
    const html = await render({ display_name: null });
    expect(html).toContain("Pick a display name");
    expect(html).toContain('href="/forge/welcome"');
  });

  it("says nothing to a member with a name", async () => {
    expect(await render({ display_name: "Invented Member" })).not.toContain("display name");
  });

  it("says nothing on the page that already asks", async () => {
    pathname = "/forge/welcome";
    expect(await render({ display_name: null })).not.toContain("display name");
  });

  it("says nothing when the lookup came back empty, rather than nag a named member", async () => {
    expect(await render(null)).not.toContain("display name");
  });

  it("still gives a non-member the real 404", async () => {
    (requireForge as any).mockResolvedValue(null);
    await expect(ForgeLayout({ children: null })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
