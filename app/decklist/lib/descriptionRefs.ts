import { resolveCardRefs } from "@/app/articles/lib/cardRefs";
import { resolveGlossaryTerms } from "@/lib/glossary/terms";
import { extractCardMentions } from "@/app/articles/lib/markdown";
import type { ArticleRefs } from "@/app/articles/lib/refTypes";

/**
 * Resolve a deck description's `[[mentions]]` to card and glossary refs.
 *
 * Pulls in the card catalog, so on the public deck page this runs on the
 * server (page.tsx) and the refs travel to the client as props; the builder's
 * live preview calls it in the browser, where the catalog is already loaded.
 *
 * `decks` stays empty: a deck link inside a deck description remains an
 * ordinary link rather than embedding a whole second decklist.
 */
export function resolveDeckDescriptionRefs(markdown: string): ArticleRefs {
  const mentions = extractCardMentions(markdown || "");
  return { cards: resolveCardRefs(mentions), decks: {}, terms: resolveGlossaryTerms(mentions) };
}
