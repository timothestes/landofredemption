import { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { loadPublicDeckAction } from "../actions";
import { createClient } from "../../../utils/supabase/server";
import PublicDeckClient from "./client";
import { enrichDeckCards } from "./enrichDeckCards";
import { resolveDeckDescriptionRefs } from "../lib/descriptionRefs";
import { CARD_BY_FULL_KEY } from "../card-search/data/cardIndex";
import { getCardImageUrlOrNull } from "../../shared/utils/cardImageUrl";
import { flattenCardMentions } from "@/app/articles/lib/markdown";

interface PageProps {
  params: Promise<{ deckId: string }>;
}

// generateMetadata and the page body both need the deck. Without this memo the
// whole query cascade ran twice for every request. cache() is request-scoped,
// so the two callers share one load.
const loadDeck = cache((deckId: string) => loadPublicDeckAction(deckId));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { deckId } = await params;
  const result = await loadDeck(deckId);

  if (!result.success || !result.deck) {
    return { title: "Deck Not Found" };
  }

  const deck = result.deck;
  const cards = deck.cards || [];
  const mainCards = cards.filter((c: any) => c.zone === 'main');
  const cardCount = mainCards.reduce((sum: number, c: any) => sum + c.quantity, 0);
  const reserveCount = cards.filter((c: any) => c.zone === 'reserve').reduce((sum: number, c: any) => sum + c.quantity, 0);
  const format = deck.format || "Type 1";
  const description = [
    `${format} deck with ${cardCount} cards`,
    reserveCount > 0 ? `+ ${reserveCount} reserve` : "",
    // Meta tags are plain text: `[[Son of God]]` would reach every link unfurl.
    flattenCardMentions(deck.description || ""),
  ].filter(Boolean).join(" · ");

  // Pick an OG image: use stored preview card, fall back to first card
  const previewImg = deck.preview_card_1 || mainCards[0]?.card_img_file;
  const ogImage = getCardImageUrlOrNull(previewImg) ?? undefined;

  // Unlisted decks are viewable by link but must not be indexed by search
  // engines. Public decks remain indexable.
  const isUnlisted = deck.visibility === "unlisted";

  return {
    title: `${deck.name} - Redemption Decklist`,
    description,
    ...(isUnlisted && { robots: { index: false, follow: false } }),
    openGraph: {
      title: deck.name,
      description,
      type: "article",
      siteName: "Land of Redemption",
      ...(ogImage && {
        images: [{ url: ogImage, width: 375, height: 525, alt: deck.name }],
      }),
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: deck.name,
      description,
      ...(ogImage && { images: [ogImage] }),
    },
  };
}

export default async function PublicDeckPage({ params }: PageProps) {
  const { deckId } = await params;
  const [result, { data: { user } }] = await Promise.all([
    loadDeck(deckId),
    createClient().then((sb) => sb.auth.getUser()),
  ]);

  if (!result.success || !result.deck) {
    if (result.error === "This deck is private") {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <svg className="mx-auto h-16 w-16 text-muted-foreground mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <h1 className="font-cinzel text-2xl font-bold tracking-tight mb-2">This deck is private</h1>
            <p className="text-muted-foreground">The owner has made this deck private.</p>
          </div>
        </div>
      );
    }
    notFound();
  }

  return (
    <PublicDeckClient
      // Join rows to the catalog here so the card grid is in the HTML (see enrichDeckCards).
      deck={{ ...result.deck, cards: enrichDeckCards(result.deck.cards, CARD_BY_FULL_KEY) }}
      // Mentions resolve here too, for the same reason.
      descriptionRefs={resolveDeckDescriptionRefs(result.deck.description || "")}
      isOwner={result.isOwner ?? false}
      isLoggedIn={!!user}
    />
  );
}
