"use client";

import ArticleBody from "@/app/articles/components/ArticleBody";
import type { ArticleRefs } from "@/app/articles/lib/refTypes";

// A deck description, rendered by the same markdown renderer articles use, so
// `[[Card Name]]` gets the hover preview and tap-to-enlarge treatment here too.
//
// Mentions arrive already resolved. The public deck page resolves them on the
// server (resolveDeckDescriptionRefs in page.tsx) because the card catalog has
// to stay out of that page's client bundle (clientBundleNoCatalog.test.ts);
// the builder's live preview resolves them in the browser (LiveDeckDescription).
export default function DeckDescription({
  markdown,
  refs,
  draft = false,
  className = "prose prose-sm dark:prose-invert max-w-none text-foreground",
}: {
  markdown: string;
  refs: ArticleRefs;
  /** Editor preview: flag mentions that resolved to nothing. */
  draft?: boolean;
  className?: string;
}) {
  return <ArticleBody markdown={markdown} refs={refs} draft={draft} className={className} />;
}
