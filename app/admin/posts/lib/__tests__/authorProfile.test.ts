import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("../auth", () => ({ requirePoster: vi.fn() }));

import { revalidatePath, revalidateTag } from "next/cache";
import { requirePoster } from "../auth";
import { updateAuthorProfileAction } from "../authorProfile";
import { ARTICLES_TAG } from "@/app/articles/lib/queries";

function ctx(overrides: { error?: unknown; posts?: { slug: string }[]; postsError?: unknown } = {}) {
  const updateEq = vi.fn(async () => ({ error: overrides.error ?? null }));
  const postsEq2 = vi.fn(async () => ({ data: overrides.posts ?? [], error: overrides.postsError ?? null }));
  return {
    user: { id: "u1" },
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "profiles") return { update: vi.fn(() => ({ eq: updateEq })) };
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: postsEq2 })) })) };
      }),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("updateAuthorProfileAction", () => {
  it("rejects a non-poster", async () => {
    (requirePoster as any).mockRejectedValue(new Error("Unauthorized: publish_posts permission required"));
    const r = await updateAuthorProfileAction("hi", null);
    expect(r.success).toBe(false);
  });

  it("rejects a bio over 500 characters", async () => {
    (requirePoster as any).mockResolvedValue(ctx());
    const r = await updateAuthorProfileAction("x".repeat(501), null);
    expect(r).toEqual({ success: false, error: "Bio must be 500 characters or fewer" });
  });

  it("rejects a non-https avatar URL", async () => {
    (requirePoster as any).mockResolvedValue(ctx());
    const r = await updateAuthorProfileAction(null, "http://insecure.example/x.png");
    expect(r).toEqual({ success: false, error: "Avatar must be an https URL" });
  });

  it("saves a trimmed bio and https avatar, and revalidates the author's published posts", async () => {
    const c = ctx({ posts: [{ slug: "hello-world" }] });
    (requirePoster as any).mockResolvedValue(c);
    const r = await updateAuthorProfileAction("  Hi there  ", "https://x/y.png");
    expect(r).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith("/articles");
    expect(revalidatePath).toHaveBeenCalledWith("/articles/hello-world");
    expect(revalidateTag).toHaveBeenCalledWith(ARTICLES_TAG);
  });

  it("rejects a name over 40 characters", async () => {
    (requirePoster as any).mockResolvedValue(ctx());
    const r = await updateAuthorProfileAction(null, null, "x".repeat(41));
    expect(r).toEqual({ success: false, error: "Name must be 40 characters or fewer" });
  });

  it("saves a trimmed name, and leaves it alone when blank", async () => {
    const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
    const c = ctx();
    c.supabase.from = vi.fn((table: string) =>
      table === "profiles" ? { update } : (ctx().supabase.from as any)(table)
    );
    (requirePoster as any).mockResolvedValue(c);

    await updateAuthorProfileAction(null, null, "  Redemption   Aggie ");
    expect(update).toHaveBeenLastCalledWith({ bio: null, avatar_url: null, username: "Redemption Aggie" });

    await updateAuthorProfileAction(null, null, "   ");
    expect(update).toHaveBeenLastCalledWith({ bio: null, avatar_url: null });
  });

  it("says so when the name is already taken", async () => {
    (requirePoster as any).mockResolvedValue(ctx({ error: { code: "23505" } }));
    const r = await updateAuthorProfileAction(null, null, "Taken");
    expect(r).toEqual({ success: false, error: "That name is already taken" });
  });

  it("surfaces a database error", async () => {
    (requirePoster as any).mockResolvedValue(ctx({ error: { message: "boom" } }));
    const r = await updateAuthorProfileAction("hi", null);
    expect(r).toEqual({ success: false, error: "Could not save your author profile" });
  });

  it("logs a slugs query error but still returns success for profile write", async () => {
    const c = ctx({ posts: [], postsError: { message: "slugs query failed" } });
    (requirePoster as any).mockResolvedValue(c);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await updateAuthorProfileAction("bio text", "https://x/y.png");
    expect(r).toEqual({ success: true });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "updateAuthorProfile: could not load slugs to revalidate:",
      { message: "slugs query failed" }
    );
    consoleErrorSpy.mockRestore();
  });
});
