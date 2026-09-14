"use server";
// Forge playtest game server actions. Every export gates with requireForge()
// FIRST. LEAK SPINE: deckData leaving here carries forge cards only as
// forge:<uuid> stubs (see playSerialize.ts); the resolver returns granted
// card text to members only and never a blob key.
import { requireForge } from "@/app/forge/lib/auth";
import { getForgeDeck } from "@/app/forge/lib/forgeDecks";
import { listGrantedForgeCards } from "@/app/forge/lib/deckPool";
import type { GrantedForgeCard } from "@/app/forge/lib/deckPool";
import { buildForgePlayDeck, buildForgeGoldfishCards, sanitizeParagon } from "@/app/forge/lib/playSerialize";
import { cardRawText } from "@/app/forge/lib/designCard";
import { TYPE_DISPLAY, designCardSearchFields } from "@/app/forge/lib/deckAdapter";
import { stdbHttpBase } from "@/app/forge/lib/stdbHttp";
import type { GameCardData } from "@/app/play/actions";
import type { DeckDataForGoldfish } from "@/app/shared/types/gameCard";

export type ForgePlayDeckResult =
  | { ok: true; deck: { id: string; name: string; format: string | null; paragon: string }; deckData: GameCardData[]; dropped: number }
  | { ok: false; error: string };

export async function loadForgeDeckForGame(deckId: string): Promise<ForgePlayDeckResult> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Deck not found." };
  const deck = await getForgeDeck(deckId);
  if (!deck) return { ok: false, error: "Deck not found." };
  const byId = await grantedResolverMap();
  const { deckData, dropped } = buildForgePlayDeck(deck.entries, (id) => byId.get(id));
  if (deckData.length === 0) {
    return { ok: false, error: "This deck has no playable cards — its Forge cards may no longer be shared with you." };
  }
  return {
    ok: true,
    deck: { id: deck.id, name: deck.name, format: deck.format, paragon: sanitizeParagon(deck.paragon) },
    deckData,
    dropped,
  };
}

// alignment/brigade/strength/toughness/identifier/reference ride the resolver so
// the owner's client can re-hydrate them for the in-game deck search — the
// world-readable STDB row deliberately blanks them (leak spine, playSerialize.ts).
// cardClass rides it too: forge cards aren't in the public card index, so the
// client's Warrior/Weapon equip test has no other way to learn a forge card's
// class (see app/goldfish/utils/equipClass.ts).
export type ForgePlayResolverEntry = {
  cardId: string; name: string; rawText: string;
  hasFinished: boolean; versionId: string; typeDisplay: string;
  alignment: string; brigade: string; strength: string; toughness: string;
  identifier: string; reference: string; cardClass: string;
};

function toResolverEntry(g: GrantedForgeCard): ForgePlayResolverEntry {
  const joined = (g.data.cardType ?? []).map((t) => TYPE_DISPLAY[t] ?? t).join("/");
  const typeDisplay = joined || ((g.data.name ?? "").toLowerCase().includes("lost soul") ? "Lost Soul" : joined);
  return {
    cardId: g.cardId,
    name: g.data.name || "Playtest card",
    rawText: cardRawText(g.data),
    hasFinished: g.hasApprovedFinished,
    versionId: g.versionId,
    typeDisplay,
    cardClass: (g.data.class ?? []).join("/"),
    ...designCardSearchFields(g.data),
  };
}

// Shared by every loader that needs granted forge cards keyed by id — one
// listGrantedForgeCards() call, one resolver-entry shape.
async function grantedResolverMap(): Promise<Map<string, ForgePlayResolverEntry>> {
  const granted = await listGrantedForgeCards();
  return new Map(granted.map((g) => [g.cardId, toResolverEntry(g)]));
}

export async function getForgePlayResolver(): Promise<ForgePlayResolverEntry[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const byId = await grantedResolverMap();
  return [...byId.values()];
}

// Owner goldfish loader. Returns null (caller 404s) unless the caller is a
// forge member AND the deck resolves under their RLS (owner-scoped read).
export async function loadForgeDeckGoldfish(deckId: string): Promise<DeckDataForGoldfish | null> {
  const ctx = await requireForge();
  if (!ctx) return null;
  const deck = await getForgeDeck(deckId);
  if (!deck) return null;
  const byId = await grantedResolverMap();
  const cards = buildForgeGoldfishCards(deck.entries, (id) => byId.get(id));
  if (cards.length === 0) return null;
  return {
    id: deck.id,
    name: deck.name,
    format: deck.format || "Type 1",
    paragon: deck.paragon ?? null,
    isOwner: true,
    isForge: true,
    cards,
  };
}

export async function authorizeForgeSeat(
  input: { code: string; identityHex: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const code = (input.code || "").trim().toUpperCase();
  const identityHex = (input.identityHex || "").trim().toLowerCase();
  if (!/^[a-z0-9]{4}$/i.test(code) || !/^(0x)?[0-9a-f]{16,128}$/.test(identityHex)) {
    return { ok: false, error: "Invalid request" };
  }
  const token = process.env.SPACETIMEDB_SERVER_TOKEN;
  const host = process.env.NEXT_PUBLIC_SPACETIMEDB_HOST;
  const db = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME || "redemption-multiplayer";
  if (!token || !host) {
    console.error("[forge] authorizeForgeSeat: missing SPACETIMEDB_SERVER_TOKEN / host env");
    return { ok: false, error: "Playtest games are not configured yet" };
  }
  const res = await fetch(`${stdbHttpBase(host)}/v1/database/${db}/call/forge_authorize_seat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([code, identityHex]),
    cache: "no-store",
  }).catch((e) => {
    console.error("[forge] authorizeForgeSeat fetch failed", e);
    return null;
  });
  if (!res || !res.ok) {
    const detail = res ? `${res.status} ${await res.text().catch(() => "")}` : "network";
    console.error("[forge] authorizeForgeSeat rejected", detail.slice(0, 300));
    return { ok: false, error: "Could not authorize your seat — try again" };
  }
  // Audit attribution: STDB identities are otherwise anonymous.
  console.log("[forge-audit] seat authorized", { userId: ctx.user.id, code, identityHex });
  return { ok: true };
}
