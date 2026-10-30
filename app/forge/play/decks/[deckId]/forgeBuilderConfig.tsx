"use client";

// Builds the DeckBuilderConfig that makes the main player-facing deck builder
// (CardSearchClient) behave as the Forge builder: a mixed forge+public pool,
// forge-aware image rendering (composite preview, NEVER next/image — this file
// lives under app/forge/** where next/image is banned), forge_decks persistence,
// and the public-only features hard-disabled (text import/export stays on —
// forge cards round-trip by name through the pool).
//
// Forge identity round-trip: a forge card's `forge:<id>` dataLine is dropped at
// the save boundary (DeckCardData carries no dataLine), so we stamp the dataLine
// into `imgFile` instead and key the image + persistence seams on `imgFile`.

import type { Card } from "@/app/decklist/card-search/utils";
import type {
  DeckBuilderConfig,
  DeckBuilderPersistence,
  CardImageResolution,
} from "@/app/decklist/card-search/builderConfig";
import type { DeckCardData, SaveDeckParams, saveDeckAction } from "@/app/decklist/actions";

type SaveDeckResult = Awaited<ReturnType<typeof saveDeckAction>>;
import { ALL_CARDS } from "@/app/decklist/card-search/data/cardIndex";
import { getPublicImageUrl } from "@/app/decklist/card-search/hooks/useCardImageUrl";
import type { DesignCard } from "@/app/forge/lib/designCard";
import {
  designCardToCard,
  forgeDataLine,
  isForgeDataLine,
  cardIdFromDataLine,
} from "@/app/forge/lib/deckAdapter";
import type { ForgeDeckEntry } from "@/app/forge/lib/deckTypes";
import type { GrantedForgeCard } from "@/app/forge/lib/deckPool";
import { saveForgeDeck, getForgeDeck, listForgeDecks, deleteForgeDeck } from "@/app/forge/lib/forgeDecks";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import ForgeBuilderShareModal from "@/app/forge/components/ForgeBuilderShareModal";

export function makeForgeBuilderConfig(granted: GrantedForgeCard[]): DeckBuilderConfig {
  // Forge cards → Card[], with imgFile stamped to the forge dataLine so the cardId
  // survives a save (which keeps card_img_file but drops dataLine).
  const forgeData = new Map<string, DesignCard>();
  const forgeById = new Map<string, Card>();
  const forgeArtIds = new Set<string>();
  const forgeFinishedIds = new Set<string>();
  const forgeCards: Card[] = granted.map((g) => {
    const card: Card = { ...designCardToCard(g.data, g.cardId, g.setName), imgFile: forgeDataLine(g.cardId) };
    forgeData.set(g.cardId, g.data);
    forgeById.set(g.cardId, card);
    if (g.hasApprovedArt) forgeArtIds.add(g.cardId);
    if (g.hasApprovedFinished) forgeFinishedIds.add(g.cardId);
    return card;
  });

  const publicByKey = new Map<string, Card>();
  for (const c of ALL_CARDS) publicByKey.set(`${c.name}|${c.set}`, c);

  const pool: Card[] = [...forgeCards, ...ALL_CARDS];

  // --- image seam (keyed on imgFile so loaded/saved forge cards still render) ---
  const resolveCardImage = (card: Card): CardImageResolution => {
    if (isForgeDataLine(card.imgFile)) {
      const id = cardIdFromDataLine(card.imgFile);
      const data = forgeData.get(id);
      // Uploaded finished card image wins (same priority as the reveal grid's
      // ForgeCardFace); the CSS composite is the fallback for cards without one.
      // Plain <img> — next/image is banned under app/forge/**.
      if (data && forgeFinishedIds.has(id)) {
        return {
          kind: "element",
          node: (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/forge/api/art/${id}?v=approved&kind=finished`}
              alt={data.name ?? "Forge card"}
              loading="lazy"
              decoding="async"
              className="w-full rounded-md"
              style={{ aspectRatio: "750 / 1050", objectFit: "contain" }}
            />
          ),
        };
      }
      const artUrl = data && forgeArtIds.has(id) ? `/forge/api/art/${id}?v=approved` : null;
      return {
        kind: "element",
        node: data ? (
          <ForgeCardPreview card={data} artUrl={artUrl} className="w-full rounded-md" />
        ) : (
          // Dangling ref: the card was deleted, unreleased, or its set is no
          // longer shared with this member. Render an explicit tile instead of
          // a blank so the ghost entry is visible and removable.
          <div className="flex aspect-[2.5/3.5] w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed bg-muted p-2 text-center">
            <span className="text-xs font-medium text-muted-foreground">Forge card</span>
            <span className="text-[10px] text-muted-foreground">No longer available to you</span>
          </div>
        ),
      };
    }
    return { kind: "url", url: getPublicImageUrl(card.imgFile) };
  };

  const renderThumb: DeckBuilderConfig["renderThumb"] = (card, opts) => {
    const r = resolveCardImage(card);
    if (r.kind === "element") return r.node;
    // Plain <img> — CardImage/next/image is banned under app/forge/**.
    return <img src={r.url} alt={opts.alt} className={opts.className} sizes={opts.sizes} onClick={opts.onClick} />;
  };

  // --- persistence seam (forge_decks) ---
  const save: DeckBuilderPersistence["save"] = async (params: SaveDeckParams) => {
    const entries: ForgeDeckEntry[] = params.cards.map((c: DeckCardData) => {
      const img = c.card_img_file ?? "";
      return isForgeDataLine(img)
        ? { source: "forge", cardId: cardIdFromDataLine(img), qty: c.quantity, zone: c.zone }
        : { source: "public", name: c.card_name, set: c.card_set ?? "", qty: c.quantity, zone: c.zone };
    });
    const res = await saveForgeDeck({
      id: params.deckId,
      name: params.name,
      format: params.format ?? "Type 1",
      paragon: params.paragon ?? null,
      entries,
    });
    // `=== false` narrowing: tsconfig strict:false breaks `res.ok ? … : …` union
    // narrowing. Cast the shape to the public action's return — the forge deck
    // runs no public deckcheck, so deckCheckResult is null.
    if (res.ok === false) {
      return { success: false, error: res.error } as SaveDeckResult;
    }
    return { success: true, deckId: res.id, message: "Saved", deckCheckResult: null } as SaveDeckResult;
  };

  const loadById: DeckBuilderPersistence["loadById"] = async (deckId: string) => {
    const detail = await getForgeDeck(deckId);
    if (!detail) return { success: false as const, error: "Deck not found", deck: null };

    // Map stored entries → the db-card-row shape useDeckState's dbCardToDeckCard reads.
    // Forge rows carry the dataLine in card_img_file (so they re-save and render);
    // public rows carry the real imgFile so the catalog lookup resolves full data.
    const cards = detail.entries.map((e) => {
      if (e.source === "forge") {
        const c = forgeById.get(e.cardId);
        return {
          // Unresolvable refs get a unique per-card name: identical names would
          // collide as React keys and cross-wire the quantity steppers.
          card_name: c?.name ?? `Unavailable Forge card (${e.cardId.slice(0, 8)})`,
          card_set: c?.set ?? "Forge",
          card_img_file: forgeDataLine(e.cardId),
          quantity: e.qty,
          zone: e.zone,
        };
      }
      const pc = publicByKey.get(`${e.name}|${e.set}`);
      return {
        card_name: e.name,
        card_set: e.set,
        card_img_file: pc?.imgFile ?? "",
        quantity: e.qty,
        zone: e.zone,
      };
    });

    const now = new Date().toISOString();
    return {
      success: true as const,
      isOwner: true, // RLS already guarantees the caller owns it; keeps the id so saves update in place.
      deck: {
        id: detail.id,
        name: detail.name,
        description: "",
        format: detail.format,
        paragon: detail.paragon,
        folder_id: null,
        is_public: false,
        visibility: "private",
        preview_card_1: null,
        preview_card_2: null,
        cards,
        created_at: now,
        updated_at: now,
      },
    };
  };

  // Rehydrate loaded forge rows from the granted pool so they keep full card
  // data (type/brigade/alignment) instead of degrading to `type: "Unknown"`,
  // which silently broke validation (Lost Souls / Dominants uncounted). Null
  // for public rows and dangling refs → default catalog lookup / stub.
  const resolveCard: NonNullable<DeckBuilderPersistence["resolveCard"]> = (dbCard) => {
    const img = dbCard.card_img_file ?? "";
    if (!isForgeDataLine(img)) return null;
    return forgeById.get(cardIdFromDataLine(img)) ?? null;
  };

  // Load Deck modal source: the member's forge_decks, mapped to the modal's shape.
  const listDecks: NonNullable<DeckBuilderPersistence["listDecks"]> = async () => {
    const summaries = await listForgeDecks();
    return summaries.map((s) => ({
      id: s.id,
      name: s.name,
      format: s.format,
      card_count: s.cardCount,
      updated_at: s.updatedAt,
    }));
  };

  // Delete seam: remove from forge_decks; the builder fires onDeckDeleted on success.
  const deleteDeck: NonNullable<DeckBuilderPersistence["delete"]> = async (deckId: string) => {
    const res = await deleteForgeDeck(deckId);
    return res.ok ? { success: true } : { success: false, error: res.error };
  };

  return {
    pool,
    resolveCardImage,
    renderThumb,
    persistence: { save, loadById, resolveCard, listDecks, delete: deleteDeck },
    // Member-only share (is_shared on forge_decks) in place of the public
    // share modal — enableSharing stays off so nothing writes public data.
    renderShareModal: (props) => <ForgeBuilderShareModal {...props} />,
    features: {
      localStoragePersist: false,
      syncFiltersToUrl: false,
      enableSharing: false,
      enableDeckDelete: true,
      enableImportExport: true,
      enablePhotoImport: false,
      enablePrintExports: false,
      enableShopping: false,
      enableDetailsTab: false,
      serverDeckCheck: false,
      enableLegalityChecks: false,
    },
  };
}
