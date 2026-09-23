import { revalidatePath, revalidateTag } from "next/cache";
import { ARTICLES_TAG } from "./queries";

/**
 * Bust the cached public reads and the ISR pages that show these posts.
 * Shared by the poster-facing server actions and the scheduled-publish cron
 * so both invalidate the cache identically.
 */
export function revalidateArticles(slugs: Array<string | null | undefined>) {
  revalidateTag(ARTICLES_TAG);
  revalidatePath("/articles");
  revalidatePath("/articles/feed.xml");
  for (const s of slugs) if (s) revalidatePath(`/articles/${s}`);
}
