// Pure serializer for forge play decks. LEAK SPINE: forge entries become
// opaque stubs — the UUID rides cardImgFile as `forge:<uuid>`; every text
// field stays '' except cardType, a deliberate user-approved metadata
// relaxation (2026-07-04) so server-side lost-soul auto-routing works.
// Public entries get the same enrichment loadDeckForGame uses.
import { findCard } from "@/lib/cards/lookup";
import { getParagonByName } from "@/app/decklist/card-search/data/paragons";
import { forgeProxyUrl } from "@/app/play/utils/forgeResolver";
import type { ForgeDeckEntry } from "./deckTypes";
import type { GameCardData } from "@/app/play/actions";
import type { ForgePlayResolverEntry } from "./playDecks"; // TYPE-ONLY import
import type { DeckDataForGoldfish } from "@/app/shared/types/gameCard";

export function buildForgePlayDeck(
  entries: ForgeDeckEntry[],
  resolve: (cardId: string) => ForgePlayResolverEntry | undefined,
): { deckData: GameCardData[]; dropped: number } {
  const deckData: GameCardData[] = [];
  let dropped = 0;
  for (const e of entries) {
    if (e.zone !== "main" && e.zone !== "reserve") continue; // game sees main + reserve only
    const isReserve = e.zone === "reserve";
    if (e.source === "forge") {
      const r = resolve(e.cardId);
      if (!r) { dropped += e.qty; continue; } // fail-closed: no longer granted
      const isLS = r.typeDisplay.toLowerCase().includes("lost soul");
      // 'LS' is the STDB module's server-side auto-route contract (index.ts:295) —
      // forge stubs have empty names, so the name fallback never fires for them.
      for (let i = 0; i < e.qty; i++) {
        deckData.push({
          cardName: "", cardSet: "Forge", cardImgFile: `forge:${e.cardId}`,
          cardType: isLS ? "LS" : r.typeDisplay,
          brigade: "", strength: "", toughness: "", alignment: "",
          identifier: "", reference: "", specialAbility: "", isReserve,
        });
      }
    } else {
      const enriched = findCard(e.name, e.set);
      for (let i = 0; i < e.qty; i++) {
        deckData.push({
          cardName: e.name, cardSet: e.set,
          cardImgFile: enriched?.imgFile || "",
          cardType: enriched?.type || "", brigade: enriched?.brigade || "",
          strength: enriched?.strength || "", toughness: enriched?.toughness || "",
          alignment: enriched?.alignment || "", identifier: enriched?.identifier || "",
          reference: enriched?.reference || "", specialAbility: enriched?.specialAbility || "",
          isReserve,
        });
      }
    }
  }
  return { deckData, dropped };
}

// Owner-facing goldfish serialization: unlike buildForgePlayDeck (opaque stubs
// for world-readable STDB rows), this resolves forge cards server-side for the
// member's own page. Unresolved (revoked) forge entries drop fail-closed.
export function buildForgeGoldfishCards(
  entries: ForgeDeckEntry[],
  resolve: (cardId: string) => ForgePlayResolverEntry | undefined,
): DeckDataForGoldfish["cards"] {
  const cards: DeckDataForGoldfish["cards"] = [];
  for (const e of entries) {
    if (e.zone !== "main" && e.zone !== "reserve") continue;
    const is_reserve = e.zone === "reserve";
    if (e.source === "forge") {
      const r = resolve(e.cardId);
      if (!r) continue; // fail-closed: no longer granted
      cards.push({
        card_name: r.name,
        card_set: "Forge",
        card_img_file: forgeProxyUrl(r), // finished image or server-rendered card proxy URL, never ''
        card_type: r.typeDisplay,
        card_brigade: r.brigade, card_strength: r.strength, card_toughness: r.toughness,
        card_special_ability: r.rawText,
        card_identifier: r.identifier, card_reference: r.reference, card_alignment: r.alignment,
        card_class: r.cardClass,
        quantity: e.qty,
        is_reserve,
      });
    } else {
      const enriched = findCard(e.name, e.set);
      cards.push({
        card_name: e.name,
        card_set: e.set,
        card_img_file: enriched?.imgFile || "",
        card_type: enriched?.type || "",
        card_brigade: enriched?.brigade || "",
        card_strength: enriched?.strength || "",
        card_toughness: enriched?.toughness || "",
        card_special_ability: enriched?.specialAbility || "",
        card_identifier: enriched?.identifier || "",
        card_reference: enriched?.reference || "",
        card_alignment: enriched?.alignment || "",
        quantity: e.qty,
        is_reserve,
      });
    }
  }
  return cards;
}

// Player.paragon / Game.rematchParagon* are world-readable STDB strings —
// only names from the public paragon registry may pass through.
export function sanitizeParagon(paragon: string | null | undefined): string {
  if (!paragon) return "";
  return getParagonByName(paragon) ? paragon : "";
}
