import { checkDeck, type DeckCheckCard, type DeckCheckIssue } from "@/utils/deckcheck";
import type { FormatId } from "@/lib/formats";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findCard } from "@/lib/cards/lookup";

export interface DeckSnapshotCard {
  name: string;
  set: string;
  imgFile: string | null;
  quantity: number;
  zone: "main" | "reserve";
}

export interface DeckSnapshot {
  deckName: string;
  deckFormat: string;
  cards: DeckSnapshotCard[];
}

/** The most rows and copies an edited list may hold: far above any legal deck, low enough to bound the check. */
export const SNAPSHOT_MAX_ROWS = 400;
export const SNAPSHOT_MAX_QTY = 99;

/**
 * An edited card list as it arrives from a browser, made safe to store: every row is a card with a whole
 * quantity in a real zone, rows of the same printing in the same zone are merged, and each card found in the
 * catalog takes the catalog's own name, set and image. Null when the input is not a card list at all.
 * A name the catalog does not have is kept as typed; the deck check reports it.
 */
export function cleanSnapshotCards(input: unknown): DeckSnapshotCard[] | null {
  if (!Array.isArray(input) || input.length > SNAPSHOT_MAX_ROWS) return null;
  const merged = new Map<string, DeckSnapshotCard>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.name !== "string" || typeof r.set !== "string") return null;
    if (r.imgFile !== null && r.imgFile !== undefined && typeof r.imgFile !== "string") return null;
    if (r.zone !== "main" && r.zone !== "reserve") return null;
    if (typeof r.quantity !== "number" || !Number.isFinite(r.quantity)) return null;
    const quantity = Math.min(SNAPSHOT_MAX_QTY, Math.round(r.quantity));
    if (quantity < 1) continue;
    const name = r.name.trim().slice(0, 200);
    if (!name) return null;
    const typedImg = typeof r.imgFile === "string" ? r.imgFile.slice(0, 200) : null;
    const found = findCard(name, r.set, typedImg ?? undefined);
    const card: DeckSnapshotCard = found
      ? { name: found.name, set: found.set, imgFile: found.imgFile || null, quantity, zone: r.zone }
      : { name, set: r.set.slice(0, 40), imgFile: typedImg, quantity, zone: r.zone };
    const key = `${card.zone}|${card.name}|${card.set}|${card.imgFile ?? ""}`;
    const held = merged.get(key);
    if (held) held.quantity = Math.min(SNAPSHOT_MAX_QTY, held.quantity + quantity);
    else merged.set(key, card);
  }
  return [...merged.values()];
}

/** The deck check's verdict on a card list, in the shape a submission stores. */
export async function checkSnapshotCards(
  cards: DeckSnapshotCard[],
  tournamentFormat: FormatId
): Promise<{ isLegal: boolean; issues: DeckCheckIssue[]; hasUnresolvedCards: boolean }> {
  const toCheckCard = (c: DeckSnapshotCard): DeckCheckCard => ({
    name: c.name,
    set: c.set,
    quantity: c.quantity,
    imgFile: c.imgFile ?? undefined,
  });
  const result = await checkDeck(
    cards.filter((c) => c.zone === "main").map(toCheckCard),
    cards.filter((c) => c.zone === "reserve").map(toCheckCard),
    tournamentFormat
  );
  return {
    isLegal: result.valid,
    issues: result.issues,
    hasUnresolvedCards: result.issues.some((i) => i.rule === "card-not-found"),
  };
}

export type SubmissionBuild =
  | {
      success: true;
      snapshot: DeckSnapshot;
      isLegal: boolean;
      issues: DeckCheckIssue[];
      hasUnresolvedCards: boolean;
    }
  | { success: false; error: "deck_not_found" | "deck_not_accessible" };

/**
 * Single point where a deck is read, validated with checkDeck, and
 * serialized into an immutable snapshot. Access rule enforced here:
 * requester must own the deck OR the deck's visibility !== 'private'.
 * Callers decide policy (join/resubmit require isLegal && !hasUnresolvedCards;
 * host attach records the verdict but does not block).
 */
export async function buildDeckSubmission(
  admin: SupabaseClient,
  deckId: string,
  requestingUserId: string,
  tournamentFormat: FormatId
): Promise<SubmissionBuild> {
  const { data: deck, error } = await admin
    .from("decks")
    .select("id, user_id, name, format, visibility")
    .eq("id", deckId)
    .single();
  if (error || !deck) return { success: false, error: "deck_not_found" };
  const isOwner = deck.user_id === requestingUserId;
  if (isOwner === false && deck.visibility === "private")
    return { success: false, error: "deck_not_accessible" };

  const { data: rows, error: cardsError } = await admin
    .from("deck_cards")
    .select("card_name, card_set, card_img_file, quantity, zone")
    .eq("deck_id", deckId)
    .in("zone", ["main", "reserve"]); // maybeboard NEVER ships
  if (cardsError) return { success: false, error: "deck_not_found" };

  // ONE read: these rows are both what we validate and what we snapshot.
  const toCheckCard = (r: any): DeckCheckCard => ({
    name: r.card_name,
    set: r.card_set,
    quantity: r.quantity,
    imgFile: r.card_img_file ?? undefined,
  });
  const main = (rows ?? []).filter((r) => r.zone === "main").map(toCheckCard);
  const reserve = (rows ?? []).filter((r) => r.zone === "reserve").map(toCheckCard);

  const result = await checkDeck(main, reserve, tournamentFormat);

  return {
    success: true,
    snapshot: {
      deckName: deck.name ?? "Untitled Deck",
      // Provenance: the deck's DECLARED format. The validation format is
      // implied by the tournament + is_legal; don't overwrite the record.
      deckFormat: deck.format ?? "",
      cards: (rows ?? []).map((r) => ({
        name: r.card_name,
        set: r.card_set,
        imgFile: r.card_img_file ?? null,
        quantity: r.quantity,
        zone: r.zone,
      })),
    },
    isLegal: result.valid,
    issues: result.issues,
    hasUnresolvedCards: result.issues.some((i) => i.rule === "card-not-found"),
  };
}
