// Shared between the server resolver, the client editor and ArticleBody.
// Pure types only — no card data, no Supabase.
import type { DeckEmbedData } from "@/lib/decks/embed";
import type { GlossaryTerm } from "@/lib/glossary/terms";

export interface CardRef {
  /** Canonical card name from the index (what the author typed may differ in case). */
  name: string;
  imgFile: string;
}

export interface ArticleRefs {
  /** Keyed by mentionKey(name). Missing key = the name did not resolve. */
  cards: Record<string, CardRef>;
  /** Keyed by lowercase deck uuid. null = deck exists in the text but is not viewable (private/deleted). */
  decks: Record<string, DeckEmbedData | null>;
  /** Keyed by mentionKey(name). Community shorthand that is not a card. */
  terms: Record<string, GlossaryTerm>;
  /** Natural size by image URL, for Blob-hosted images only. Missing key = unknown, render as before. */
  images?: Record<string, { w: number; h: number }>;
}

export const EMPTY_REFS: ArticleRefs = { cards: {}, decks: {}, terms: {} };
