"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requirePoster } from "./auth";
import { ARTICLES_TAG } from "@/app/articles/lib/queries";
import type { ActionResult } from "../actions";

const MAX_BIO = 500;
const MAX_USERNAME = 40;

export async function updateAuthorProfileAction(
  bio: string | null,
  avatarUrl: string | null,
  username: string | null = null
): Promise<ActionResult> {
  try {
    const ctx = await requirePoster();

    // The name shown on every article byline. Blank leaves it unchanged.
    const cleanUsername = username?.trim().replace(/\s+/g, " ") || null;
    if (cleanUsername && cleanUsername.length > MAX_USERNAME) {
      return { success: false, error: `Name must be ${MAX_USERNAME} characters or fewer` };
    }

    const cleanBio = bio && bio.trim() ? bio.trim() : null;
    if (cleanBio && cleanBio.length > MAX_BIO) {
      return { success: false, error: `Bio must be ${MAX_BIO} characters or fewer` };
    }
    const cleanAvatar = avatarUrl && avatarUrl.trim() ? avatarUrl.trim() : null;
    if (cleanAvatar && !/^https:\/\//.test(cleanAvatar)) {
      return { success: false, error: "Avatar must be an https URL" };
    }

    const { error } = await ctx.supabase
      .from("profiles")
      .update({ bio: cleanBio, avatar_url: cleanAvatar, ...(cleanUsername ? { username: cleanUsername } : {}) })
      .eq("id", ctx.user.id);
    if (error?.code === "23505") {
      return { success: false, error: "That name is already taken" };
    }
    if (error) {
      console.error("updateAuthorProfile:", error);
      return { success: false, error: "Could not save your author profile" };
    }

    // A bio/avatar change is invisible on already-rendered article pages
    // until these run (or the hourly ISR window passes) — revalidate every
    // published slug this author owns, not just the ones edited today.
    const { data: mine, error: slugsError } = await ctx.supabase
      .from("posts")
      .select("slug")
      .eq("author_id", ctx.user.id)
      .eq("status", "published");
    if (slugsError) console.error("updateAuthorProfile: could not load slugs to revalidate:", slugsError);
    revalidateTag(ARTICLES_TAG);
    revalidatePath("/articles");
    for (const row of (mine ?? []) as { slug: string }[]) revalidatePath(`/articles/${row.slug}`);

    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.startsWith("Unauthorized")) return { success: false, error: "Unauthorized" };
    console.error("updateAuthorProfileAction failed:", e);
    return { success: false, error: "An unexpected error occurred" };
  }
}
