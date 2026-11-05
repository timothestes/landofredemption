import { describe, it, expect, vi } from "vitest";

// top-nav.tsx builds a Supabase browser client at module scope; the test only
// reads the link data, so stub the client out.
vi.mock("../../utils/supabase/client", () => ({ createClient: () => ({}) }));

import { navLinks, tournamentLinks, deckLinks } from "../top-nav";
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
