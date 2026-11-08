import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// top-nav.tsx builds a Supabase browser client at module scope; the test only
// reads the link data, so stub the client out.
vi.mock("../../utils/supabase/client", () => ({ createClient: () => ({}) }));

const state = vi.hoisted(() => ({ pathname: "/", isAdmin: false, isForgeMember: false }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useRouter: () => ({}) }));
vi.mock("../../hooks/useIsAdmin", () => ({
  useIsAdmin: () => ({
    isAdmin: state.isAdmin, isForgeMember: state.isForgeMember, isSuperuser: false, permissions: [], loading: false,
  }),
}));

import TopNav, { navLinks, tournamentLinks, deckLinks } from "../top-nav";
import { COLUMNS } from "../site-footer";
import { RESOURCE_SECTIONS, RESOURCE_APP_TOOLS } from "@/lib/resources";

// The deck builder routes bundle the whole card catalog. A prefetching <Link>
// to them pulls that chunk onto every page that renders the nav or footer.
const isDeckBuilder = (href: string) => href.startsWith("/decklist/card-search");

describe("deck builder links do not prefetch", () => {
  it("top nav", () => {
    const builder = [...navLinks, ...tournamentLinks, ...deckLinks].filter((l) => isDeckBuilder(l.href));
    expect(builder.map((l) => l.label)).toEqual(["Deck Builder", "Tier List Maker"]);
    for (const link of builder) expect(link.prefetch).toBe(false);
  });

  it("footer", () => {
    const builder = COLUMNS.flatMap((c) => c.links).filter((l) => isDeckBuilder(l.href));
    expect(builder.map((l) => l.label)).toEqual(["Deck Builder", "Tier list"]);
    for (const link of builder) expect(link.prefetch).toBe(false);
  });

  it("resources dropdown and /resources page", () => {
    const builder = [...RESOURCE_SECTIONS.flatMap((s) => s.links), ...RESOURCE_APP_TOOLS].filter((l) =>
      isDeckBuilder(l.href),
    );
    expect(builder.map((l) => l.label)).toEqual(["Tier List Maker", "Deck Builder"]);
    for (const link of builder) expect(link.prefetch).toBe(false);
  });
});

describe("the Forge in the top nav", () => {
  const render = (who: { isAdmin?: boolean; isForgeMember?: boolean }, props = {}, pathname = "/") => {
    Object.assign(state, { isAdmin: false, isForgeMember: false, pathname }, who);
    return renderToStaticMarkup(React.createElement(TopNav, props));
  };

  it("says nothing to someone who is not a member", () => {
    const html = render({});
    expect(html).not.toContain("/forge");
    expect(html).not.toContain("The Forge");
    expect(html).not.toContain("Admin");
  });

  // The site 404 renders this nav, and it is what a non-member gets under /forge.
  it("looks no different to a non-member under /forge", () => {
    expect(render({}, {}, "/forge/cards/some-id")).toBe(render({}, {}, "/some-other-missing-page"));
  });

  it("gives a member who is not an app admin a plain link, with its icon", () => {
    const html = render({ isForgeMember: true });
    expect(html).toMatch(/<a [^>]*href="\/forge"[^>]*><svg[\s\S]*?<\/svg>The Forge<\/a>/);
    expect(html).not.toContain("Admin");
  });

  it("leaves an app admin's dropdown as it was", () => {
    for (const isForgeMember of [true, false]) {
      const html = render({ isAdmin: true, isForgeMember });
      expect(html).toContain("Admin");
      expect(html).not.toContain('href="/forge"');
    }
  });

  it("drops the links the Forge row repeats only when told to", () => {
    const labels = ["Play", "Deck Builder", "Decks"];
    const full = render({ isForgeMember: true });
    for (const label of labels) expect(full).toContain(`</svg>${label}`);

    const inForge = render({ isForgeMember: true }, { hideGameLinks: true });
    for (const label of labels) expect(inForge).not.toContain(`</svg>${label}`);
    for (const label of ["The Forge", "Events", "Spoilers", "Articles", "Resources"]) {
      expect(inForge).toContain(`</svg>${label}`);
    }
  });
});
