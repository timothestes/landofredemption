// Server-only: resolves everything an article's markdown references so
// ArticleBody (shared with the client editor preview) never touches the card
// index or Supabase. The article page awaits this; the editor calls it through
// a poster-gated server action.
import { loadPublicDeckDetail } from "@/lib/api/cache";
import { findCard } from "@/lib/cards/lookup";
import { buildDeckEmbed, type DeckEmbedData } from "@/lib/decks/embed";
import { extractCardMentions, extractDeckIds, extractImageUrls } from "./markdown";
import { resolveImageSizes } from "./imageSize";
import { resolveCardRefs } from "./cardRefs";
import { resolveGlossaryTerms } from "@/lib/glossary/terms";
import type { ArticleRefs } from "./refTypes";

/** null = not viewable (private, deleted, unknown id). Reads through the anon client, so RLS decides. */
export async function resolveDeckEmbed(id: string): Promise<DeckEmbedData | null> {
  const detail = await loadPublicDeckDetail(id);
  return detail ? buildDeckEmbed(detail, findCard) : null;
}

export async function resolveArticleRefs(markdown: string): Promise<ArticleRefs> {
  const mentions = extractCardMentions(markdown);
  const cards = resolveCardRefs(mentions);
  // Shorthand that is not a card ("EC", "LoC"). Resolved after cards so a card
  // always wins; a test asserts the two lists cannot overlap anyway.
  const terms = resolveGlossaryTerms(mentions);
  const decks: ArticleRefs["decks"] = {};
  const images = resolveImageSizes(extractImageUrls(markdown));
  await Promise.all(
    extractDeckIds(markdown).map(async (id) => {
      try {
        decks[id] = await resolveDeckEmbed(id);
      } catch (e) {
        // Leave the id out: the URL renders as an ordinary link rather than a
        // cached "unavailable" claim the page would repeat for an hour.
        console.error("deck embed failed:", id, e);
      }
    }),
  );
  return { cards, decks, terms, images: await images };
}
