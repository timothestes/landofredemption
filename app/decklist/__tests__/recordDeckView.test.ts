import { describe, it, expect, vi, beforeEach } from "vitest";

// Must match the specifier actions.ts imports, or the mock silently doesn't
// apply and this test hits the network.
vi.mock("../../../utils/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "../../../utils/supabase/server";
import { recordDeckViewAction } from "../actions";

/**
 * RLS-client stub for the two calls recordDeckViewAction makes: the owner
 * lookup (.from("decks").select("user_id").eq().single()) and the RPC.
 */
function fakeClient(opts: { userId: string | null; deckOwnerId: string | null }) {
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const single = vi.fn(async () =>
    opts.deckOwnerId === null
      ? { data: null, error: { code: "PGRST116" } }
      : { data: { user_id: opts.deckOwnerId }, error: null }
  );
  const client = {
    auth: {
      getUser: async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
    rpc,
  };
  return { client: client as any, rpc, single };
}

describe("recordDeckViewAction", () => {
  // Braces matter: a function returned from beforeEach is run as a cleanup,
  // and mockReset() returns the mock itself.
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("counts an anonymous visitor without looking the deck up", async () => {
    const { client, rpc, single } = fakeClient({ userId: null, deckOwnerId: "u1" });
    vi.mocked(createClient).mockResolvedValue(client);

    await recordDeckViewAction("d1");

    expect(rpc).toHaveBeenCalledWith("increment_deck_view_count", { p_deck_id: "d1" });
    expect(single).not.toHaveBeenCalled();
  });

  it("counts a signed-in visitor who is not the owner", async () => {
    const { client, rpc } = fakeClient({ userId: "u2", deckOwnerId: "u1" });
    vi.mocked(createClient).mockResolvedValue(client);

    await recordDeckViewAction("d1");

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not count the owner viewing their own deck", async () => {
    const { client, rpc } = fakeClient({ userId: "u1", deckOwnerId: "u1" });
    vi.mocked(createClient).mockResolvedValue(client);

    await recordDeckViewAction("d1");

    expect(rpc).not.toHaveBeenCalled();
  });

  it("never throws into the page when the client blows up", async () => {
    vi.mocked(createClient).mockImplementation(async () => {
      throw new Error("network");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(recordDeckViewAction("d1")).resolves.toBeUndefined();

    errorSpy.mockRestore();
  });
});
