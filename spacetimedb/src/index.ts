import spacetimedb from './schema';
export default spacetimedb;
import { DisconnectTimeout, setDisconnectTimeoutReducer, ChooseFirstTimeout, setChooseFirstTimeoutReducer, RevealTimeout, setRevealTimeoutReducer, CleanupSchedule, setCleanupStaleGamesReducer, SpectatorHandRequestExpiry, setSpectatorHandRequestExpiryReducer, PregameIdleTimeout, setPregameIdleTimeoutReducer, StopHoldTimeout, setStopHoldTimeoutReducer } from './schema';
import { t, SenderError } from 'spacetimedb/server';
import { ScheduleAt, Timestamp } from 'spacetimedb';
import { makeSeed, seededShuffle, seededDiceRoll, xorshift64, generateGameCode } from './utils';
import { isLeavingPlayField } from './playField';
import { makeFreeSpotAllocator, bandRowSlots, BAND_ROW_Y } from './battlePlacement';
import { resolveDestinationOwnerId, resolveHomeOwnerId, type OwnerRouting } from './cardOwnership';
import {
  getAbilitiesForCard,
  getEffectiveAbilities,
  findTokenCard,
  IMITATE_SOUL_IMAGES,
  IMITATE_ORIGINAL_IMG,
  isNewTestamentLostSoul,
  isCharacterCard,
  isHeroCard,
  hasReferenceBook,
  simplifyLostSoulName,
  redeemedSoulValue,
  type CardAbility,
} from './cardAbilities';
import {
  advancePregameFlow,
  markDone,
  type PregameProgress,
  type PregameStep,
  type Seat,
} from './pregameFlow';
import { TURN_PHASES, STOP_PHASES, gateBoundaryIndex, parseStops, toggleStop, firstStopInRange } from './stopFlow';

// Auto-reveal duration for cards that land in a hand via a move whose log
// payload reveals the card identity (cross-player moves, face-up moves, etc.).
// Briefly flashes the card face-up in the recipient's hand so the receiver
// sees what they got without scanning the chat log.
const AUTO_REVEAL_HAND_MICROS = 10_000_000n; // 10 seconds

// Maximum cards a player may hold in hand. Mirrors the client-side cap used
// in goldfish/multiplayer UIs (HAND_LIMIT). Auto-draws stop short of this.
const HAND_LIMIT = 16;

// Zones an ability's source card may fire from by default (the "in play"
// zones plus Land of Redemption, where redeemed souls can still trigger
// abilities). Shared across every ability-source gate below; per-ability
// explicit sourceZones overrides are untouched by this list.
const ABILITY_SOURCE_ZONES = ['territory', 'land-of-bondage', 'land-of-redemption', 'battle'];

// Star cards lead their special ability with "(Star)" or "STAR:". Mirrors
// lib/cards/starCards.ts — keep the two in sync. Read a CardInstance row's own
// specialAbility, never a card-index lookup.
//
// NOTE: Forge cards blank specialAbility on the public row (the leak spine in
// app/forge/lib/playSerialize.ts), so forge star cards are invisible here and
// the star step auto-skips for them. Known limitation, see the design doc.
const STAR_ABILITY_RE = /^\s*(\(star\)|star:)/i;
function isStarAbilityText(text: string): boolean {
  return STAR_ABILITY_RE.test(text ?? '');
}

// Backstop only — the REG Pre-Game Phase is untimed by design. Long enough
// that a thinking player is never cut off, short enough that a departed one
// cannot hang the game.
const PREGAME_IDLE_MICROS = 180_000_000n; // 3 minutes

// Phase Stops: how long a hold lasts before the server auto-releases it.
// Liveness backstop (spec §12 — tunable after live play).
const STOP_HOLD_TIMEOUT_MICROS = 60_000_000n; // 60s

// ---------------------------------------------------------------------------
// Forge playtest games (Phase 2.3)
// ---------------------------------------------------------------------------
// Publisher/owner identity — the unstealable recovery principal for
// set_forge_server_identity. Identity hexes are public info (only tokens are
// secrets), so baking it into the open-source module is safe.
const FORGE_OWNER_IDENTITY_HEX = 'c200ef2bfc5cef33a94336bbe1a899210d380990823cc5d2a47256b3556f4d12';

// Identity of SPACETIMEDB_SERVER_TOKEN (one token shared by .env.local and
// Vercel production/preview). Used when ForgeConfig is empty — e.g. right after
// a --clear republish — so a wipe can't silently break seat auth (the
// 2026-07-14 PT outage). If the server token is ever rotated, update this
// constant in the same change; a ForgeConfig row set via
// set_forge_server_identity overrides it either way.
const FORGE_SERVER_IDENTITY_HEX_DEFAULT = 'c200c2ac41b9b91c641f0e40c14298b88f16978e456ff232926822af4eeaec63';

const FORGE_AUTH_TTL_MICROS = 600_000_000n; // 10 minutes

function isForgeGame(ctx: any, gameId: bigint): boolean {
  // NOTE: the server SDK's index .find() returns `null` (not `undefined`) on a
  // miss, so `!== undefined` was ALWAYS true — treating every public game as a
  // Forge game and breaking join_game/set_game_public for normal play. Use a
  // null-safe existence check, matching the truthiness checks used elsewhere.
  return ctx.db.ForgeGame.gameId.find(gameId) != null;
}

function forgeServerIdentityHex(ctx: any): string {
  const cfg = ctx.db.ForgeConfig.id.find(0n);
  return cfg ? cfg.serverIdentityHex : FORGE_SERVER_IDENTITY_HEX_DEFAULT;
}

// Single-use: consumes a fresh seat authorization for (ctx.sender, code).
// Throws when absent or stale. Opportunistically sweeps expired rows.
function consumeForgeSeatAuth(ctx: any, code: string) {
  const senderHex = ctx.sender.toHexString();
  const now = ctx.timestamp.microsSinceUnixEpoch;
  let match: any = null;
  for (const row of [...ctx.db.ForgeSeatAuth.seat_auth_code.filter(code)]) {
    if (now - row.authorizedAtMicros > FORGE_AUTH_TTL_MICROS) {
      ctx.db.ForgeSeatAuth.id.delete(row.id);
      continue;
    }
    if (row.identityHex === senderHex) match = row;
  }
  if (!match) throw new SenderError('Not authorized for this playtest game');
  ctx.db.ForgeSeatAuth.id.delete(match.id);
}

// Shared deckData sanity check for the forge entry paths (mirrors
// pregame_change_deck's validation).
function assertValidDeckData(deckData: string) {
  try {
    const parsed = JSON.parse(deckData);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('not array or empty');
  } catch {
    throw new SenderError('Invalid deck data');
  }
}

// ---------------------------------------------------------------------------
// Helper: logAction
// ---------------------------------------------------------------------------
function logAction(
  ctx: any,
  gameId: bigint,
  playerId: bigint,
  actionType: string,
  payload: string,
  turnNumber: bigint,
  phase: string
) {
  ctx.db.GameAction.insert({
    id: 0n,
    gameId,
    playerId,
    actionType,
    payload,
    turnNumber,
    phase,
    timestamp: ctx.timestamp,
  });
}

// ---------------------------------------------------------------------------
// Helper: normalizeFormat
// Maps any deck-format string (e.g. "Type 1", "t2", "Paragon Type 1",
// "Multi-player") to the canonical "T1" | "T2" | "Paragon" used by game rules.
// Mirrors client-side `formatDeckType` in app/play/components/DeckPickerCard.tsx.
// ---------------------------------------------------------------------------
function normalizeFormat(format: string): 'T1' | 'T2' | 'Paragon' {
  const fmt = (format || '').toLowerCase();
  if (fmt.includes('paragon')) return 'Paragon';
  if (fmt.includes('type 2') || fmt.includes('multi') || fmt === 't2') return 'T2';
  return 'T1';
}

// ---------------------------------------------------------------------------
// Helper: findPlayerBySender
// ---------------------------------------------------------------------------
function findPlayerBySender(ctx: any, gameId: bigint) {
  for (const player of ctx.db.Player.player_game_id.filter(gameId)) {
    if (player.identity.toHexString() === ctx.sender.toHexString()) {
      return player;
    }
  }
  throw new SenderError('Player not found in this game');
}

// ---------------------------------------------------------------------------
// Helper: canSenderActOnCard
// Normal cards: only the owner can act. Shared cards (ownerId = 0n) in a
// Paragon game can be acted on by either seat when the card is in a shared
// zone (land-of-bondage or soul-deck). Prevents cross-seat interference with
// player-owned cards while allowing both players to interact with the Soul
// Deck and shared LoB.
//
// TODO: The current move-type reducers (move_card, move_cards_batch) already
// permit any-player moves, so this helper is not yet called. It is retained
// to satisfy the spec's broader requirement (design.md L111) that every
// reducer authorizing on ownership gain a shared-card branch. Known future
// consumers — wire up when shared-card interaction is needed for each:
//   - attach_card            (enhancer/weapon attach to a shared soul)
//   - detach_card            (weapon detach)
//   - reorder_hand           (own-hand only; may not need shared branch)
//   - reorder_lob            (BOTH players reorder shared LoB)
//   - add_card_note          (annotate shared LoB souls, e.g. "Negated")
//   - exchange_cards         (deck exchange affecting shared state)
// ---------------------------------------------------------------------------
function canSenderActOnCard(game: any, card: any, player: any): boolean {
  if (card.ownerId === player.id) return true;
  if (card.ownerId !== 0n) return false;
  const fmt = normalizeFormat(game.format);
  if (fmt !== 'Paragon') return false;
  return card.zone === 'land-of-bondage' || card.zone === 'soul-deck';
}

// ---------------------------------------------------------------------------
// Helper: compactHandIndices
// After a card leaves the hand, re-index remaining hand cards to close gaps
// so zoneIndex values are always sequential: 0, 1, 2, ...
//
// `gameCardsHint` lets callers reuse a single CardInstance materialization
// across multiple operations in the same reducer (saves a full filter scan).
// `excludeId` skips the just-moved card whose row in the hint still shows
// `zone === 'hand'` because the hint was captured before the move.
// ---------------------------------------------------------------------------
function compactHandIndices(
  ctx: any,
  gameId: bigint,
  playerId: bigint,
  gameCardsHint?: any[],
  excludeId?: bigint,
) {
  const allCards = gameCardsHint ?? [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];
  const handCards = allCards.filter(
    (c: any) => c.ownerId === playerId && c.zone === 'hand' && (excludeId === undefined || c.id !== excludeId)
  );
  // Sort by current zoneIndex to preserve order
  handCards.sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
  // Re-index sequentially
  for (let i = 0; i < handCards.length; i++) {
    if (handCards[i].zoneIndex !== BigInt(i)) {
      ctx.db.CardInstance.id.update({ ...handCards[i], zoneIndex: BigInt(i) });
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: compactLobIndices
// After a card leaves the LOB, re-index remaining LOB cards to close gaps
// so zoneIndex values are always sequential: 0, 1, 2, ...
// ---------------------------------------------------------------------------
function compactLobIndices(
  ctx: any,
  gameId: bigint,
  playerId: bigint,
  gameCardsHint?: any[],
  excludeId?: bigint,
) {
  // Paragon shared LoB (ownerId=0n) intentionally keeps sparse zoneIndices so
  // that when a soul is rescued, its slot stays empty until refill places a
  // new soul there — preventing the other souls from visually shifting.
  if (playerId === 0n) return;
  const allCards = gameCardsHint ?? [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];
  const lobCards = allCards.filter(
    (c: any) => c.ownerId === playerId && c.zone === 'land-of-bondage' && (excludeId === undefined || c.id !== excludeId)
  );
  lobCards.sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
  for (let i = 0; i < lobCards.length; i++) {
    if (lobCards[i].zoneIndex !== BigInt(i)) {
      ctx.db.CardInstance.id.update({ ...lobCards[i], zoneIndex: BigInt(i) });
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: clearCountersIfLeavingPlay
// Counters reflect in-play state (damage, charges, generic markers). When a
// card leaves Territory, Land of Bondage, or Battle for any other zone, drop
// all CardCounter rows for it so they don't follow the card into
// deck/hand/discard or persist when it later returns to play.
// ---------------------------------------------------------------------------
function clearCountersIfLeavingPlay(ctx: any, cardId: bigint, fromZone: string, toZone: string) {
  if (fromZone === toZone) return;
  if (fromZone !== 'territory' && fromZone !== 'land-of-bondage' && fromZone !== 'battle') return;
  for (const counter of [...ctx.db.CardCounter.card_counter_card_instance_id.filter(cardId)]) {
    ctx.db.CardCounter.id.delete(counter.id);
  }
}

// ---------------------------------------------------------------------------
// Helper: leavePlayFieldOverrides
// Player-attached annotations (notes, Three Woes Choose Good/Evil outline) and
// the meek conversion are in-play state and shouldn't ride along when the card
// leaves Territory, Land of Bondage, or Battle. Returns the override map to
// spread into a CardInstance update; preserves the existing values for moves
// that aren't leave-play. Also centralizes clearing the battle-origin fields
// (originZone/originPosX/originPosY) whenever the destination isn't 'battle'
// — this is the ONLY place those fields get cleared, so every move reducer's
// completing write path picks it up via the shared spread.
// ---------------------------------------------------------------------------
function leavePlayFieldOverrides(card: any, fromZone: string, toZone: string): { notes: string; outlineColor: string; isRotated: boolean; isMeek: boolean; imitatingName: string; cardImgFile: string; originZone?: string; originPosX?: string; originPosY?: string } {
  const leaving =
    fromZone !== toZone && (fromZone === 'territory' || fromZone === 'land-of-bondage' || fromZone === 'battle');
  // When an Imitate Lost Soul leaves play (rescued, shuffled, banished, etc.),
  // drop the imitation and restore its canonical art. Pre-existing cardImgFile
  // is returned unchanged for non-imitating cards so this is a no-op write.
  const wasImitating = leaving && !!card.imitatingName;
  const canonicalImg = wasImitating
    ? (IMITATE_ORIGINAL_IMG[card.cardName] ?? card.cardImgFile)
    : card.cardImgFile;
  const battleClears = toZone !== 'battle'
    ? { originZone: '', originPosX: '', originPosY: '' }
    : {};
  return {
    // notes are manual player annotations on the card while it's in play: like
    // isMeek they must survive on-field relocations — above all the battle round
    // trip (territory -> battle -> territory) — and clear only when the card
    // genuinely leaves the play field. Gate on isLeavingPlayField rather than
    // `leaving` (which fires on any move off an on-field zone, incl. battle <->
    // territory).
    notes: isLeavingPlayField(fromZone, toZone) ? '' : card.notes,
    outlineColor: leaving ? '' : card.outlineColor,
    // The Two/Three Liner sideways marker records "rescued once" while the
    // soul sits in the Land of Bondage — any move off it (rescue, shuffle,
    // discard) resets the marker.
    isRotated: leaving ? false : card.isRotated,
    // isMeek is a lasting hero characteristic (the card's meek-side stats), not
    // battle-scoped state: a meek hero must stay meek across on-field
    // relocations — above all the battle round trip (territory -> battle ->
    // territory). Unlike notes/outline it clears only when the card genuinely
    // leaves the play field (an off-field destination), so gate it on
    // isLeavingPlayField rather than `leaving` (which fires on any move off an
    // on-field zone, including battle <-> territory).
    isMeek: isLeavingPlayField(fromZone, toZone) ? false : card.isMeek,
    imitatingName: wasImitating ? '' : card.imitatingName,
    cardImgFile: canonicalImg,
    ...battleClears,
  };
}

// ---------------------------------------------------------------------------
// Helper: stampBattleEntry
// Battle entry: stamp origin (pre-move zone/pos) + last-play seat (card
// owner, not sender — courtesy drags must not steal initiative). Mutates
// `updates` in place so callers spread it into their CardInstance update.
// Never re-stamps a card already in 'battle' (intra-band repositions keep
// their original origin). Spec §7.
// ---------------------------------------------------------------------------
function stampBattleEntry(ctx: any, gameId: bigint, card: any, updates: any) {
  if (card.zone === 'battle') return; // intra-band repositions never re-stamp
  updates.originZone = card.zone;
  updates.originPosX = card.posX;
  updates.originPosY = card.posY;
  const owner = ctx.db.Player.id.find(card.ownerId);
  const game = ctx.db.Game.id.find(gameId);
  if (owner && game) {
    ctx.db.Game.id.update({ ...game, lastBattlePlayBySeat: owner.seat.toString() });
  }
}

// ---------------------------------------------------------------------------
// Helper: drawCardsForPlayer
// ---------------------------------------------------------------------------
interface DrawnCardInfo {
  name: string;
  img: string;
}

interface DrawResult {
  drawn: number;
  cards: DrawnCardInfo[];
}

function drawCardsForPlayer(ctx: any, game: any, player: any, count: number): DrawResult {
  // One upfront scan: collect this player's cards, build sorted deck + zone counts
  const playerCards = [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)].filter(
    (c: any) => c.ownerId === player.id
  );

  // Build sorted deck cards (ascending by zoneIndex — first element is top of deck)
  const deckCards = playerCards
    .filter((c: any) => c.zone === 'deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));

  // Track current hand and LOB counts for zoneIndex assignment
  let handCount = playerCards.filter((c: any) => c.zone === 'hand').length;
  let lobCount = playerCards.filter((c: any) => c.zone === 'land-of-bondage').length;

  let drawn = 0;
  let deckPos = 0; // Pointer into sorted deckCards
  const drawnCards: DrawnCardInfo[] = [];

  for (let i = 0; i < count; i++) {
    if (deckPos >= deckCards.length) break; // No more cards in deck

    const topCard = deckCards[deckPos];

    // Check if auto-route lost souls
    const isLostSoul =
      player.autoRouteLostSouls &&
      (topCard.cardType === 'LS' || topCard.cardName.toLowerCase().includes('lost soul'));

    // Hand-size cap: stop drawing when the next card would land in hand and
    // hand is already full. Lost Souls auto-route to LOB, so they don't take
    // a hand slot and keep flowing.
    if (!isLostSoul && handCount >= HAND_LIMIT) break;

    deckPos++;

    if (isLostSoul) {
      // Move to land-of-bondage. Auto-routed Lost Souls don't count toward
      // `drawn` — by the rules, a card that never enters hand wasn't drawn.
      ctx.db.CardInstance.id.update({
        ...topCard,
        zone: 'land-of-bondage',
        isFlipped: false,
        zoneIndex: BigInt(lobCount),
      });
      lobCount++;
      logAction(ctx, game.id, player.id, 'MOVE_CARD', JSON.stringify({ cardInstanceId: topCard.id.toString(), from: 'deck', to: 'land-of-bondage', cardName: topCard.cardName, cardImgFile: topCard.cardImgFile, redirected: 'drew' }), game.turnNumber, game.currentPhase);
      // Draw a replacement — extend the loop
      count++;
    } else {
      // Move to hand
      ctx.db.CardInstance.id.update({
        ...topCard,
        zone: 'hand',
        isFlipped: false,
        zoneIndex: BigInt(handCount),
      });
      handCount++;
      drawn++;
      drawnCards.push({ name: topCard.cardName, img: topCard.cardImgFile });
    }
  }

  return { drawn, cards: drawnCards };
}

// ---------------------------------------------------------------------------
// Helper: insertCardsShuffleDraw (shared between create_game and join_game)
// ---------------------------------------------------------------------------
function insertCardsShuffleDraw(
  ctx: any,
  game: any,
  player: any,
  deckData: string
) {
  const cards: any[] = JSON.parse(deckData);

  // Insert card_instance rows
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    ctx.db.CardInstance.insert({
      id: 0n,
      gameId: game.id,
      ownerId: player.id,
      originalOwnerId: player.id,
      zone: card.isReserve ? 'reserve' : 'deck',
      zoneIndex: BigInt(i),
      posX: '',
      posY: '',
      isMeek: false,
      isFlipped: true,
      cardName: card.cardName || '',
      cardSet: card.cardSet || '',
      cardImgFile: card.cardImgFile || '',
      cardType: card.cardType || '',
      brigade: card.brigade || '',
      strength: card.strength || '',
      toughness: card.toughness || '',
      alignment: card.alignment || '',
      identifier: card.identifier || '',
      specialAbility: card.specialAbility || '',
      reference: card.reference || '',
      notes: '',
      equippedToInstanceId: 0n,
      isSoulDeckOrigin: false,
      isToken: false,
      revealExpiresAt: undefined,
      revealStartedAt: undefined,
      originZone: '',
      originPosX: '',
      originPosY: '',
      outlineColor: '',
      isRotated: false,
      imitatingName: '',
    });
  }

  // Shuffle deck using seeded PRNG
  const shuffleSeed = makeSeed(
    ctx.timestamp.microsSinceUnixEpoch,
    game.id,
    player.id,
    game.rngCounter
  );

  // Collect deck cards
  const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)].filter(
    (c: any) => c.ownerId === player.id && c.zone === 'deck'
  );

  // Create shuffled indices
  const indices = deckCards.map((_: any, idx: number) => idx);
  seededShuffle(indices, shuffleSeed);

  // Update zoneIndex for each card
  for (let i = 0; i < deckCards.length; i++) {
    ctx.db.CardInstance.id.update({
      ...deckCards[i],
      zoneIndex: BigInt(indices[i]),
    });
  }

  // Increment rng counter
  const updatedGame = ctx.db.Game.id.find(game.id);
  ctx.db.Game.id.update({ ...updatedGame, rngCounter: updatedGame.rngCounter + 1n });

  // Draw opening hand (8 cards)
  const latestGame = ctx.db.Game.id.find(game.id);
  drawCardsForPlayer(ctx, latestGame, player, 8);
}

// ---------------------------------------------------------------------------
// Helper: initializeSoulDeck (Paragon only)
// Seeds 21 shared soul cards into 'soul-deck', then reveals 3 to
// 'land-of-bondage' face-up. Uses the game's seeded PRNG for shuffle.
// ---------------------------------------------------------------------------
// Unique tag XOR'd into the soul-deck shuffle seed so it cannot collide
// with any player-keyed seed regardless of future Player id allocation.
const SOUL_DECK_SEED_TAG = 0xDEADBEEFCAFEBABEn;

// NOTE: This mirrors PARAGON_SOULS in app/shared/paragon/soulDeck.ts —
// keep the two in sync. The server module compiles independently of the
// Next.js app and cannot import from app/shared. If the identifier
// convention or image path shape changes, update both files.
const PARAGON_SOUL_DEFS: Array<{ identifier: string; cardName: string; cardImgFile: string }> =
  Array.from({ length: 21 }, (_, i) => {
    const padded = String(i + 1).padStart(2, '0');
    return {
      identifier: `paragon-soul-${padded}`,
      cardName: `Lost Soul ${padded}`,
      cardImgFile: `/paragon-souls/Lost Soul ${padded}.png`,
    };
  });

function initializeSoulDeck(ctx: any, game: any) {
  // Idempotence: if any shared soul cards already exist for this game, skip.
  // Lets multiple pregame hook points call this safely (rolling → choosing,
  // choose-first fallback, game-start fallback) without doubling the pile.
  const existing = [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)].filter(
    (c: any) => c.ownerId === 0n && (c.zone === 'soul-deck' || c.zone === 'land-of-bondage')
  );
  if (existing.length > 0) return;

  // Insert 21 shared soul cards (ownerId = 0n sentinel)
  for (let i = 0; i < PARAGON_SOUL_DEFS.length; i++) {
    const def = PARAGON_SOUL_DEFS[i];
    ctx.db.CardInstance.insert({
      id: 0n,
      gameId: game.id,
      ownerId: 0n,
      originalOwnerId: 0n,
      zone: 'soul-deck',
      zoneIndex: BigInt(i),
      posX: '',
      posY: '',
      isMeek: false,
      isFlipped: true,
      cardName: def.cardName,
      cardSet: 'ParagonSoul',
      cardImgFile: def.cardImgFile,
      cardType: 'Lost Soul',
      brigade: '',
      strength: '',
      toughness: '',
      alignment: 'Evil',
      identifier: def.identifier,
      specialAbility: '',
      reference: '',
      notes: '',
      equippedToInstanceId: 0n,
      isSoulDeckOrigin: true,
      isToken: false,
      revealExpiresAt: undefined,
      revealStartedAt: undefined,
      originZone: '',
      originPosX: '',
      originPosY: '',
      outlineColor: '',
      isRotated: false,
      imitatingName: '',
    });
  }

  // Shuffle soul deck using seeded PRNG (same pattern as insertCardsShuffleDraw)
  const shuffleSeed = makeSeed(
    ctx.timestamp.microsSinceUnixEpoch,
    game.id,
    0n,
    game.rngCounter
  ) ^ SOUL_DECK_SEED_TAG;
  const soulCards = [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)].filter(
    (c: any) => c.ownerId === 0n && c.zone === 'soul-deck'
  );
  const indices = soulCards.map((_: any, idx: number) => idx);
  seededShuffle(indices, shuffleSeed);
  for (let i = 0; i < soulCards.length; i++) {
    ctx.db.CardInstance.id.update({ ...soulCards[i], zoneIndex: BigInt(indices[i]) });
  }

  // Bump rngCounter after PRNG use
  const latestGame = ctx.db.Game.id.find(game.id);
  ctx.db.Game.id.update({ ...latestGame, rngCounter: latestGame.rngCounter + 1n });

  // Reveal top 3 shuffled cards into land-of-bondage (face-up)
  const shuffledSoulCards = [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)]
    .filter((c: any) => c.ownerId === 0n && c.zone === 'soul-deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));

  for (let i = 0; i < 3 && i < shuffledSoulCards.length; i++) {
    ctx.db.CardInstance.id.update({
      ...shuffledSoulCards[i],
      zone: 'land-of-bondage',
      zoneIndex: BigInt(i),
      isFlipped: false,
    });
  }

  // Re-index remaining soul-deck cards to 0..N-1
  const remainingSoulDeck = [...ctx.db.CardInstance.card_instance_game_id.filter(game.id)]
    .filter((c: any) => c.ownerId === 0n && c.zone === 'soul-deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
  for (let i = 0; i < remainingSoulDeck.length; i++) {
    if (remainingSoulDeck[i].zoneIndex !== BigInt(i)) {
      ctx.db.CardInstance.id.update({ ...remainingSoulDeck[i], zoneIndex: BigInt(i) });
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: refillSoulDeck (server-side, Paragon only)
// Mirrors the goldfish client helper — tops up the shared LoB to 3
// soul-origin souls from the soul-deck. Ignores captured characters and
// LS tokens already in LoB (they don't count toward the rule of 3).
// ---------------------------------------------------------------------------
function refillSoulDeck(ctx: any, gameId: bigint) {
  const gameCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];

  const sharedLob = gameCards.filter(
    (c: any) => c.ownerId === 0n && c.zone === 'land-of-bondage' && c.isSoulDeckOrigin === true
  );
  const needed = 3 - sharedLob.length;
  if (needed <= 0) return;

  const soulDeck = gameCards
    .filter((c: any) => c.ownerId === 0n && c.zone === 'soul-deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
  if (soulDeck.length === 0) return;

  // Slot-preserving refill: find which of the three canonical slots (0, 1, 2)
  // are currently empty and fill those specific slots so remaining souls keep
  // their visual positions.
  const occupied = new Set<bigint>(sharedLob.map((c: any) => c.zoneIndex));
  const emptySlots: bigint[] = [];
  for (let i = 0n; i < 3n; i++) {
    if (!occupied.has(i)) emptySlots.push(i);
  }

  const take = Math.min(needed, soulDeck.length, emptySlots.length);
  for (let i = 0; i < take; i++) {
    ctx.db.CardInstance.id.update({
      ...soulDeck[i],
      zone: 'land-of-bondage',
      zoneIndex: emptySlots[i],
      isFlipped: false,
    });
  }

  // Re-index remaining soul-deck cards to close gaps
  const remaining = soulDeck.slice(take);
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].zoneIndex !== BigInt(i)) {
      ctx.db.CardInstance.id.update({ ...remaining[i], zoneIndex: BigInt(i) });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers: createGameCore / joinGameCore
// (shared bodies for public create_game/join_game and forge
// create_forge_game/join_forge_game — see "Forge playtest reducers" below)
// ---------------------------------------------------------------------------
function createGameCore(
  ctx: any,
  args: { code: string; deckId: string; displayName: string; paragon: string;
          format: string; supabaseUserId: string; deckData: string;
          isPublic: boolean; lobbyMessage: string },
  isForge: boolean,
) {
  const { code, deckId, displayName, paragon, format, supabaseUserId, deckData, isPublic, lobbyMessage } = args;
  // Validate code is not already in use by an active game
  for (const g of ctx.db.Game.game_code.filter(code)) {
    if (g.status !== 'finished') {
      throw new SenderError('Game code already in use');
    }
  }

  // Insert game row
  const game = ctx.db.Game.insert({
    id: 0n,
    code,
    status: 'waiting',
    currentTurn: 0n,
    currentPhase: 'draw',
    turnNumber: 0n,
    format,
    rngCounter: 1n,
    lastDiceRoll: '',
    createdAt: ctx.timestamp,
    createdBy: ctx.sender,
    isPublic: isForge ? false : args.isPublic,
    lobbyMessage,
    createdByName: displayName,
    pregamePhase: '',
    pregameReady0: false,
    pregameReady1: false,
    rollWinner: '',
    rollResult0: 0n,
    rollResult1: 0n,
    rematchRequestedBy: '',
    rematchDeckId0: '',
    rematchDeckData0: '',
    rematchDeckId1: '',
    rematchDeckData1: '',
    rematchParagon0: '',
    rematchParagon1: '',
    rematchResponse: '',
    rematchCode: '',
    disconnectTimeoutFired: false,
    choosingDeadlineMicros: 0n,
    playingStartedAtMicros: 0n,
    pauseRequestedBy: '',
    pauseRequestType: '',
    pauseStartedAtMicros: 0n,
    totalPausedMicros: 0n,
    battleState: '',
    battleAttackerSeat: '',
    lastBattlePlayBySeat: '',
  });
  if (isForge) ctx.db.ForgeGame.insert({ gameId: game.id });

  // Insert player row with pending deck data (cards loaded later during pregame)
  const player = ctx.db.Player.insert({
    id: 0n,
    gameId: game.id,
    identity: ctx.sender,
    seat: 0n,
    deckId,
    displayName,
    paragon,
    supabaseUserId,
    isConnected: true,
    autoRouteLostSouls: true,
    handRevealed: false,
    handRevealSnapshot: '',
    reserveRevealed: false,
    pendingDeckData: deckData,
    revealedCards: '',
    shareHandWithSpectators: false,
    topDeckRevealed: false,
  });

  logAction(ctx, game.id, player.id, 'GAME_CREATED', JSON.stringify({ code }), 0n, 'draw');
}

function joinGameCore(
  ctx: any,
  args: { code: string; deckId: string; displayName: string; paragon: string;
          format: string; supabaseUserId: string; deckData: string },
  isForge: boolean,
) {
  const { code, deckId, displayName, paragon, format, supabaseUserId, deckData } = args;
  // Find game by code
  let game: any = null;
  for (const g of ctx.db.Game.game_code.filter(code)) {
    if (g.status === 'waiting') {
      game = g;
      break;
    }
  }
  if (!game) {
    throw new SenderError('No waiting game found with that code');
  }

  // Forge games are joinable only via join_forge_game (allowlist path),
  // and forge joins must not land on public games. Same error as a
  // nonexistent game — no oracle.
  if (isForgeGame(ctx, game.id) !== isForge) {
    throw new SenderError('No waiting game found with that code');
  }

  // Reject join if the creator has disconnected — the game is effectively dead
  const creator = [...ctx.db.Player.player_game_id.filter(game.id)]
    .find((p: any) => p.seat === 0n);
  if (creator && !creator.isConnected) {
    ctx.db.Game.id.update({ ...game, status: 'finished' });
    throw new SenderError('No waiting game found with that code');
  }

  // Prevent a player from joining their own game
  if (creator && creator.supabaseUserId === supabaseUserId) {
    throw new SenderError('You cannot join your own game');
  }

  // Reject format mismatch (T1 can't join a Paragon game, etc.)
  const joinerFormat = normalizeFormat(format);
  const gameFormat = normalizeFormat(game.format);
  if (joinerFormat !== gameFormat) {
    throw new SenderError(
      `Deck format (${joinerFormat}) does not match game format (${gameFormat})`
    );
  }

  // Insert player (seat=1) with pending deck data (cards loaded later during pregame)
  const player = ctx.db.Player.insert({
    id: 0n,
    gameId: game.id,
    identity: ctx.sender,
    seat: 1n,
    deckId,
    displayName,
    paragon,
    supabaseUserId,
    isConnected: true,
    autoRouteLostSouls: true,
    handRevealed: false,
    handRevealSnapshot: '',
    reserveRevealed: false,
    pendingDeckData: deckData,
    revealedCards: '',
    shareHandWithSpectators: false,
    topDeckRevealed: false,
  });

  // Log join
  logAction(ctx, game.id, player.id, 'PLAYER_JOINED', '', 0n, 'pregame');

  // Load decks for both players
  const allPlayers: any[] = [...ctx.db.Player.player_game_id.filter(game.id)];
  for (const p of allPlayers) {
    if (!p.pendingDeckData || p.pendingDeckData === '') {
      throw new SenderError('Player ' + p.displayName + ' has no deck data');
    }
  }

  // Insert cards, shuffle, and draw opening hand for both players
  for (const p of allPlayers) {
    const currentGame = ctx.db.Game.id.find(game.id);
    if (!currentGame) throw new SenderError('Game not found');
    insertCardsShuffleDraw(ctx, currentGame, p, p.pendingDeckData);
    const latestPlayer = ctx.db.Player.id.find(p.id);
    if (latestPlayer) {
      ctx.db.Player.id.update({ ...latestPlayer, pendingDeckData: '' });
    }
  }

  // Paragon: populate the shared soul deck + 3 LoB souls at the same
  // moment player hands are dealt (idempotent).
  const gameForSoulInit = ctx.db.Game.id.find(game.id);
  if (gameForSoulInit && normalizeFormat(gameForSoulInit.format) === 'Paragon') {
    initializeSoulDeck(ctx, gameForSoulInit);
  }

  // Roll dice to determine who chooses first player
  const gameAfterCards = ctx.db.Game.id.find(game.id);
  if (!gameAfterCards) throw new SenderError('Game not found');
  const seed = makeSeed(
    ctx.timestamp.microsSinceUnixEpoch,
    game.id,
    0n,
    gameAfterCards.rngCounter
  );
  const rng = xorshift64(seed);

  let r0: number, r1: number;
  do {
    r0 = Number(rng.next() % 20n) + 1;
    r1 = Number(rng.next() % 20n) + 1;
  } while (r0 === r1);

  const winner = r0 > r1 ? '0' : '1';

  const gameBeforeUpdate = ctx.db.Game.id.find(game.id);
  if (!gameBeforeUpdate) throw new SenderError('Game not found');
  const CHOOSE_DEADLINE_MICROS = 30_000_000n; // 30 seconds from now
  ctx.db.Game.id.update({
    ...gameBeforeUpdate,
    status: 'pregame',
    pregamePhase: 'rolling',
    rollResult0: BigInt(r0),
    rollResult1: BigInt(r1),
    rollWinner: winner,
    rngCounter: gameBeforeUpdate.rngCounter + 1n,
    choosingDeadlineMicros: ctx.timestamp.microsSinceUnixEpoch + CHOOSE_DEADLINE_MICROS,
  });

  const winnerSeat = winner === '0' ? 0n : 1n;
  let winnerPlayerId = player.id;
  for (const p of [...ctx.db.Player.player_game_id.filter(game.id)]) {
    if (p.seat === winnerSeat) { winnerPlayerId = p.id; break; }
  }
  logAction(ctx, game.id, winnerPlayerId, 'PREGAME_ROLL',
    JSON.stringify({ result0: r0, result1: r1, winner }),
    0n, 'pregame');
}

// ---------------------------------------------------------------------------
// Reducer: create_game
// ---------------------------------------------------------------------------
export const create_game = spacetimedb.reducer(
  { code: t.string(), deckId: t.string(), displayName: t.string(), paragon: t.string(),
    format: t.string(), supabaseUserId: t.string(), deckData: t.string(),
    isPublic: t.bool(), lobbyMessage: t.string() },
  (ctx, args) => { createGameCore(ctx, args, false); }
);

// ---------------------------------------------------------------------------
// Reducer: join_game
// ---------------------------------------------------------------------------
export const join_game = spacetimedb.reducer(
  { code: t.string(), deckId: t.string(), displayName: t.string(), paragon: t.string(),
    format: t.string(), supabaseUserId: t.string(), deckData: t.string() },
  (ctx, args) => { joinGameCore(ctx, args, false); }
);

// ---------------------------------------------------------------------------
// Forge playtest reducers
// ---------------------------------------------------------------------------
export const set_forge_server_identity = spacetimedb.reducer(
  { identityHex: t.string() },
  (ctx, { identityHex }) => {
    const senderHex = ctx.sender.toHexString();
    const cfg = ctx.db.ForgeConfig.id.find(0n);
    // With the baked-in default there is no first-set-wins window: an empty
    // table means the default identity is in charge, so only it (or the owner)
    // may set the row.
    const current = cfg ? cfg.serverIdentityHex : FORGE_SERVER_IDENTITY_HEX_DEFAULT;
    if (senderHex !== current && senderHex !== FORGE_OWNER_IDENTITY_HEX) {
      throw new SenderError('Not authorized');
    }
    if (cfg) {
      ctx.db.ForgeConfig.id.update({ ...cfg, serverIdentityHex: identityHex });
    } else {
      ctx.db.ForgeConfig.insert({ id: 0n, serverIdentityHex: identityHex });
    }
  }
);

export const forge_authorize_seat = spacetimedb.reducer(
  { code: t.string(), identityHex: t.string() },
  (ctx, { code, identityHex }) => {
    const server = forgeServerIdentityHex(ctx);
    if (!server || ctx.sender.toHexString() !== server) {
      throw new SenderError('Not authorized');
    }
    const now = ctx.timestamp.microsSinceUnixEpoch;
    // Upsert: replace any existing row for this identity, sweep stale rows.
    for (const row of [...ctx.db.ForgeSeatAuth.seat_auth_code.filter(code)]) {
      if (row.identityHex === identityHex || now - row.authorizedAtMicros > FORGE_AUTH_TTL_MICROS) {
        ctx.db.ForgeSeatAuth.id.delete(row.id);
      }
    }
    ctx.db.ForgeSeatAuth.insert({ id: 0n, code, identityHex, authorizedAtMicros: now });
  }
);

export const create_forge_game = spacetimedb.reducer(
  { code: t.string(), deckId: t.string(), displayName: t.string(), paragon: t.string(),
    format: t.string(), supabaseUserId: t.string(), deckData: t.string() },
  (ctx, args) => {
    consumeForgeSeatAuth(ctx, args.code);
    assertValidDeckData(args.deckData);
    createGameCore(ctx, { ...args, isPublic: false, lobbyMessage: '' }, true);
  }
);

export const join_forge_game = spacetimedb.reducer(
  { code: t.string(), deckId: t.string(), displayName: t.string(), paragon: t.string(),
    format: t.string(), supabaseUserId: t.string(), deckData: t.string() },
  (ctx, args) => {
    consumeForgeSeatAuth(ctx, args.code);
    assertValidDeckData(args.deckData);
    joinGameCore(ctx, args, true);
  }
);

// ===========================================================================
// Pregame ceremony reducers
// ===========================================================================

// ---------------------------------------------------------------------------
// Reducer: pregame_acknowledge_roll
// ---------------------------------------------------------------------------
export const pregame_acknowledge_roll = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'pregame') throw new SenderError('Game is not in pregame');
    if (game.pregamePhase !== 'rolling') throw new SenderError('Not in rolling phase');

    const player = findPlayerBySender(ctx, gameId);

    const updates: any = { ...game };
    if (player.seat === 0n) {
      updates.pregameReady0 = true;
    } else {
      updates.pregameReady1 = true;
    }
    ctx.db.Game.id.update(updates);

    const latestGame = ctx.db.Game.id.find(gameId);
    if (!latestGame) return;
    if (!latestGame.pregameReady0 || !latestGame.pregameReady1) return;

    ctx.db.Game.id.update({
      ...latestGame,
      pregamePhase: 'choosing',
    });

    // Paragon: populate the shared soul deck + 3 LoB souls now (instead of
    // at game-start) so they're already visible when the "choosing" / "reveal"
    // overlay dismisses.
    if (normalizeFormat(latestGame.format) === 'Paragon') {
      initializeSoulDeck(ctx, latestGame);
    }

    // Schedule server-side timeout — auto-choose if winner doesn't pick in 30s
    const CHOOSE_TIMEOUT_MICROS = 30_000_000n; // 30 seconds
    const futureTime = ctx.timestamp.microsSinceUnixEpoch + CHOOSE_TIMEOUT_MICROS;
    ctx.db.ChooseFirstTimeout.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(futureTime),
      gameId,
    });
  }
);

// ---------------------------------------------------------------------------
// Reducer: pregame_choose_first
// ---------------------------------------------------------------------------
export const pregame_choose_first = spacetimedb.reducer(
  {
    gameId: t.u64(),
    chosenSeat: t.u64(),
  },
  (ctx, { gameId, chosenSeat }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'pregame') throw new SenderError('Game is not in pregame');
    if (game.pregamePhase !== 'choosing') throw new SenderError('Not in choosing phase');
    if (chosenSeat !== 0n && chosenSeat !== 1n) throw new SenderError('Invalid seat');

    const player = findPlayerBySender(ctx, gameId);
    if (player.seat.toString() !== game.rollWinner) {
      throw new SenderError('Only the roll winner can choose');
    }

    // Cancel the server-side choose timeout
    for (const timeout of ctx.db.ChooseFirstTimeout.choose_first_timeout_game_id.filter(gameId)) {
      ctx.db.ChooseFirstTimeout.scheduledId.delete(timeout.scheduledId);
    }

    // Transition to revealing phase — show who goes first before starting
    const latestGame = ctx.db.Game.id.find(gameId);
    if (!latestGame) throw new SenderError('Game not found');
    // Paragon fallback: ensure soul deck is populated for games that missed
    // the acknowledge-roll init hook (idempotent).
    if (normalizeFormat(latestGame.format) === 'Paragon') {
      initializeSoulDeck(ctx, latestGame);
    }
    ctx.db.Game.id.update({
      ...latestGame,
      pregamePhase: 'revealing',
      currentTurn: chosenSeat,
      pregameReady0: false,
      pregameReady1: false,
    });

    // Arm the server-side backstop so a stalled client ack can't hang the game.
    scheduleRevealTimeout(ctx, gameId);
  }
);

// ---------------------------------------------------------------------------
// Reveal-phase backstop helpers
//
// The 'revealing' phase normally ends when both clients call
// pregame_acknowledge_first (~1.5s auto-ack). Unlike the 'choosing' phase, it
// has no natural server-side deadline, so a client whose auto-ack never fires
// would hang the game on "Starting game…" indefinitely. scheduleRevealTimeout
// arms an 8s server-side backstop whenever we enter 'revealing';
// handle_reveal_timeout force-starts the game if the acks never arrive.
// ---------------------------------------------------------------------------
const REVEAL_TIMEOUT_MICROS = 8_000_000n; // 8 seconds

function scheduleRevealTimeout(ctx: any, gameId: bigint): void {
  // Clear any prior backstop for this game first (idempotent across re-entries).
  for (const timeout of ctx.db.RevealTimeout.reveal_timeout_game_id.filter(gameId)) {
    ctx.db.RevealTimeout.scheduledId.delete(timeout.scheduledId);
  }
  ctx.db.RevealTimeout.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + REVEAL_TIMEOUT_MICROS),
    gameId,
  });
}

// ---------------------------------------------------------------------------
// REG Pre-Game Phase helpers (steps 2 and 3: star reveals, then Lost Soul
// activation). The game is already status='playing' here — Game.pregamePhase
// ('stars' | 'souls') is what distinguishes the pre-game from turn 1.
// ---------------------------------------------------------------------------

// Arm the pre-game idle backstop. Deletes any prior row for this game first —
// insert-only re-arming would accumulate rows and let a stale one fire 180s
// after a player's FIRST click, skipping a seat that acted seconds ago (the
// row carries only gameId, so stale and live rows are indistinguishable at
// fire time). Mirrors scheduleRevealTimeout.
function schedulePregameIdleTimeout(ctx: any, gameId: bigint): void {
  for (const timeout of ctx.db.PregameIdleTimeout.pregame_idle_timeout_game_id.filter(gameId)) {
    ctx.db.PregameIdleTimeout.scheduledId.delete(timeout.scheduledId);
  }
  ctx.db.PregameIdleTimeout.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + PREGAME_IDLE_MICROS),
    gameId,
  });
}

function seatControlsActivatableSoul(ctx: any, gameId: bigint, seat: Seat): boolean {
  const player = [...ctx.db.Player.player_game_id.filter(gameId)]
    .find((p: any) => p.seat === BigInt(seat));
  if (!player) return false;
  for (const card of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
    if (
      card.ownerId === player.id &&
      card.zone === 'land-of-bondage' &&
      isLostSoulRow(card) &&
      (card.specialAbility ?? '') !== ''
    ) {
      return true;
    }
  }
  return false;
}

function readPregameProgress(state: any): PregameProgress {
  return {
    starsDone0: state.starsDone0,
    starsDone1: state.starsDone1,
    soulsDone0: state.soulsDone0,
    soulsDone1: state.soulsDone1,
  };
}

// The single place the pre-game cursor moves. Always re-reads the Game row —
// callers may hold a stale snapshot (cf. checkAndApplyWin). Writes
// Game.pregamePhase in lock-step with the progress flags, in this transaction.
function advancePregame(ctx: any, gameId: bigint): void {
  const game = ctx.db.Game.id.find(gameId);
  if (!game) return;
  const state = ctx.db.PregameState.gameId.find(gameId);
  if (!state) return;

  const step: PregameStep = game.pregamePhase === 'souls' ? 'souls' : 'stars';
  const firstSeat: Seat = game.currentTurn === 0n ? 0 : 1;

  const result = advancePregameFlow(step, firstSeat, readPregameProgress(state), {
    controlsActivatableSoul: (seat) => seatControlsActivatableSoul(ctx, gameId, seat),
  }, normalizeFormat(game.format) !== 'Paragon');

  if (result.kind === 'complete') {
    ctx.db.PregameState.gameId.update({
      ...state,
      ...result.progress,
    });
    finishPregame(ctx, gameId);
    return;
  }

  ctx.db.PregameState.gameId.update({
    ...state,
    ...result.progress,
    activeSeat: BigInt(result.activeSeat),
  });
  if (game.pregamePhase !== result.step) {
    const latest = ctx.db.Game.id.find(gameId);
    if (latest) ctx.db.Game.id.update({ ...latest, pregamePhase: result.step });
  }
  schedulePregameIdleTimeout(ctx, gameId);
}

// Ends the REG Pre-Game Phase and begins turn 1. Takes a gameId and re-reads,
// because advancePregame may have just written pregamePhase — a caller
// snapshot would revert it.
function finishPregame(ctx: any, gameId: bigint): void {
  const game = ctx.db.Game.id.find(gameId);
  if (!game) return;

  for (const row of ctx.db.PregameStar.pregame_star_game_id.filter(gameId)) {
    ctx.db.PregameStar.id.delete(row.id);
  }
  ctx.db.PregameState.gameId.delete(gameId);
  for (const timeout of ctx.db.PregameIdleTimeout.pregame_idle_timeout_game_id.filter(gameId)) {
    ctx.db.PregameIdleTimeout.scheduledId.delete(timeout.scheduledId);
  }

  const chosenSeat = game.currentTurn;
  let chosenName = 'Player ' + (Number(chosenSeat) + 1);
  let firstPlayerId = 0n;
  for (const p of [...ctx.db.Player.player_game_id.filter(gameId)]) {
    if (p.seat === chosenSeat) { chosenName = p.displayName; firstPlayerId = p.id; }
  }

  ctx.db.Game.id.update({
    ...game,
    pregamePhase: '',
    playingStartedAtMicros: ctx.timestamp.microsSinceUnixEpoch,
  });

  logAction(ctx, gameId, firstPlayerId, 'GAME_STARTED',
    JSON.stringify({ chosenSeat: chosenSeat.toString(), chosenName }),
    1n, 'draw');
}

// Games are never deleted — the concede paths only set status:'finished' — so
// finishPregame never runs for an abandoned pre-game. All three pre-game
// tables are public, so orphan rows would sit in every client's table cache.
function clearPregameRows(ctx: any, gameId: bigint): void {
  for (const row of ctx.db.PregameStar.pregame_star_game_id.filter(gameId)) {
    ctx.db.PregameStar.id.delete(row.id);
  }
  ctx.db.PregameState.gameId.delete(gameId);
  for (const timeout of ctx.db.PregameIdleTimeout.pregame_idle_timeout_game_id.filter(gameId)) {
    ctx.db.PregameIdleTimeout.scheduledId.delete(timeout.scheduledId);
  }
}

// ---------------------------------------------------------------------------
// Phase Stops helpers (opponent-turn priority stops).
// docs/superpowers/specs/2026-08-15-phase-stops-design.md §5–§6.
// The stopping seat is always the non-active seat; no column stores it.
// ---------------------------------------------------------------------------

// Arm the 60s hold backstop. Delete-then-insert so at most one row exists per
// game (the schedulePregameIdleTimeout idiom — stale rows are otherwise
// indistinguishable at fire time beyond the phase guard).
function armStopHoldTimeout(ctx: any, gameId: bigint, phase: string): void {
  for (const row of ctx.db.StopHoldTimeout.stop_hold_timeout_game_id.filter(gameId)) {
    ctx.db.StopHoldTimeout.scheduledId.delete(row.scheduledId);
  }
  ctx.db.StopHoldTimeout.insert({
    scheduledId: 0n,
    scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + STOP_HOLD_TIMEOUT_MICROS),
    gameId,
    phase,
  });
}

// Lifecycle cleanup: rematch accept + cleanup_stale_games (both branches).
// Without this a hold stranded by a mid-hold game end wedges the rematch —
// the timeout handler early-returns on finished games (spec §6.6).
function clearStopHoldRows(ctx: any, gameId: bigint): void {
  ctx.db.TurnStop.gameId.delete(gameId);
  for (const row of ctx.db.StopHoldTimeout.stop_hold_timeout_game_id.filter(gameId)) {
    ctx.db.StopHoldTimeout.scheduledId.delete(row.scheduledId);
  }
}

// Hold guard for the five blocked reducers (spec §5.4). Card plays never call
// this — the honor system stands.
function assertTurnNotHeld(ctx: any, gameId: bigint): void {
  const stopRow = ctx.db.TurnStop.gameId.find(gameId);
  if (!stopRow || stopRow.holdPhase === '') return;
  const game = ctx.db.Game.id.find(gameId);
  let stopperName = 'your opponent';
  if (game) {
    const stopperSeat = game.currentTurn === 0n ? 1n : 0n;
    for (const p of ctx.db.Player.player_game_id.filter(gameId)) {
      if (p.seat === stopperSeat) stopperName = p.displayName;
    }
  }
  throw new SenderError('The turn is held — ' + stopperName + ' has priority');
}

// First armed gate for a forward movement by the active player's turn from
// boundary index `fromIdx` (exclusive) to `toIdx` (inclusive; 5 = the 'end'
// boundary before the turn flip), or null. Reads the NON-ACTIVE seat's stop
// set — stops apply to the opponent's turn only.
function scanForStop(ctx: any, game: any, fromIdx: number, toIdx: number): string | null {
  const stopRow = ctx.db.TurnStop.gameId.find(game.id);
  if (!stopRow || stopRow.holdPhase !== '') return null;
  const stopsCsv = game.currentTurn === 0n ? stopRow.seat1Stops : stopRow.seat0Stops;
  return firstStopInRange(fromIdx, toIdx, stopsCsv);
}

// Engage a hold AT the gate `phase` ('upkeep'..'discard' = before that phase,
// 'end' = before the turn flip). One-shot (rev 4): tripping consumes the stop
// — it is removed from the stopping seat's set as the hold engages, so it
// must be re-toggled to fire again. Callers have already halted the game at
// the boundary — currentPhase stays on the phase before the gate (or is left
// untouched if the gate is the very next boundary); the turn does NOT cross
// the gate. Release (releaseHold, below) only ever lifts the hold — the
// active player redoes their halted move themselves.
function engageHold(ctx: any, gameId: bigint, phase: string): void {
  const stopRow = ctx.db.TurnStop.gameId.find(gameId);
  if (!stopRow) return;
  const game = ctx.db.Game.id.find(gameId);
  if (!game) return;
  const stopperIsSeat0 = game.currentTurn !== 0n;
  ctx.db.TurnStop.gameId.update({
    ...stopRow,
    holdPhase: phase,
    holdResume: '',
    seat0Stops: stopperIsSeat0 ? toggleStop(stopRow.seat0Stops, phase, false) : stopRow.seat0Stops,
    seat1Stops: stopperIsSeat0 ? stopRow.seat1Stops : toggleStop(stopRow.seat1Stops, phase, false),
  });
  armStopHoldTimeout(ctx, gameId, phase);
  const stopperSeat = game.currentTurn === 0n ? 1n : 0n;
  let stopper: any = null;
  for (const p of ctx.db.Player.player_game_id.filter(gameId)) {
    if (p.seat === stopperSeat) stopper = p;
  }
  logAction(ctx, gameId, stopper ? stopper.id : 0n, 'STOP_HOLD',
    JSON.stringify({ phase, stopperName: stopper ? stopper.displayName : 'Opponent' }),
    game.turnNumber, phase);
}

// Release the hold (rev 4). Two triggers: release_turn_stop (the active
// player answering the priority prompt — Grant or Deny) and
// handle_stop_hold_timeout. Every release ONLY lifts the hold — the turn
// stays exactly where it halted, and the active player redoes their move
// themselves (the stop was consumed at trip, so it won't re-fire). Grant vs
// Deny vs timeout differ only in the STOP_RELEASE log line.
function releaseHold(
  ctx: any,
  gameId: bigint,
  reason: 'grant' | 'deny' | 'timeout',
  actorPlayerId: bigint,
): void {
  const stopRow = ctx.db.TurnStop.gameId.find(gameId);
  if (!stopRow || stopRow.holdPhase === '') return;
  const game = ctx.db.Game.id.find(gameId);
  if (!game) return;

  const releasedGate = stopRow.holdPhase;
  ctx.db.TurnStop.gameId.update({ ...stopRow, holdPhase: '', holdResume: '' });
  for (const row of ctx.db.StopHoldTimeout.stop_hold_timeout_game_id.filter(gameId)) {
    ctx.db.StopHoldTimeout.scheduledId.delete(row.scheduledId);
  }
  logAction(ctx, gameId, actorPlayerId, 'STOP_RELEASE',
    JSON.stringify({ phase: releasedGate, reason }),
    game.turnNumber, game.currentPhase);
}

// Shared "start the game" transition, used by both the both-players-acked path
// (pregame_acknowledge_first) and the server-side backstop
// (handle_reveal_timeout). Assumes `game` is in the 'revealing' phase with
// currentTurn already set to the chosen first-seat. Mirrors the original
// inline both-ready logic so the two paths can't diverge.
function startGameFromReveal(ctx: any, game: any, fallbackWinnerPlayerId: bigint): void {
  const gameId = game.id;
  const chosenSeat = game.currentTurn;
  const winnerSeat = game.rollWinner === '0' ? 0n : 1n;
  let winnerPlayerId = fallbackWinnerPlayerId;
  for (const p of [...ctx.db.Player.player_game_id.filter(gameId)]) {
    if (p.seat === winnerSeat) winnerPlayerId = p.id;
  }

  // Paragon: soul deck is normally initialized earlier in the pregame (see
  // pregame_acknowledge_roll and pregame_skip_to_reveal). Call again here as a
  // final fallback; initializeSoulDeck is idempotent.
  if (normalizeFormat(game.format) === 'Paragon') {
    initializeSoulDeck(ctx, game);
  }

  // status flips to 'playing' as it always has (so every status-gated reducer
  // and the 5-minute disconnect grace keep working), but pregamePhase now
  // enters the REG Pre-Game Phase instead of clearing. playingStartedAtMicros
  // stays 0 — the round clock starts in finishPregame, with turn 1.
  ctx.db.Game.id.update({
    ...game,
    pregameReady0: true,
    pregameReady1: true,
    status: 'playing',
    pregamePhase: 'stars',
    currentPhase: 'draw',
    turnNumber: 1n,
    playingStartedAtMicros: 0n,
  });

  ctx.db.PregameState.insert({
    gameId,
    activeSeat: chosenSeat,
    starsDone0: false,
    starsDone1: false,
    soulsDone0: false,
    soulsDone1: false,
  });

  // Paragon completes the phase inside the advancePregame below without ever
  // opening a window, so announcing it would leave a "began the pre-game phase"
  // line in chat for something no one saw. The rows above are still written and
  // then torn down by finishPregame in this same transaction — one code path,
  // and no client observes the intermediate state.
  if (normalizeFormat(game.format) !== 'Paragon') {
    logAction(ctx, gameId, winnerPlayerId, 'PREGAME_STAR_PHASE',
      JSON.stringify({ firstSeat: chosenSeat.toString() }), 1n, 'draw');
  }

  // Cascades through the souls auto-skip, and completes outright in Paragon or
  // once both seats have answered.
  advancePregame(ctx, gameId);
}

// ---------------------------------------------------------------------------
// Reducer: pregame_acknowledge_first
// ---------------------------------------------------------------------------
export const pregame_acknowledge_first = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'pregame') throw new SenderError('Game is not in pregame');
    if (game.pregamePhase !== 'revealing') throw new SenderError('Not in revealing phase');

    const player = findPlayerBySender(ctx, gameId);

    // If already playing (other player beat us to it), just return
    const freshGame = ctx.db.Game.id.find(gameId);
    if (freshGame && freshGame.status === 'playing') return;

    // Mark this player as having acknowledged
    const isSeat0 = player.seat === 0n;
    const updatedGame = {
      ...game,
      pregameReady0: isSeat0 ? true : game.pregameReady0,
      pregameReady1: isSeat0 ? game.pregameReady1 : true,
    };

    const bothReady = updatedGame.pregameReady0 && updatedGame.pregameReady1;

    if (bothReady) {
      // Both players acknowledged — cancel the server-side backstop and start.
      for (const timeout of ctx.db.RevealTimeout.reveal_timeout_game_id.filter(gameId)) {
        ctx.db.RevealTimeout.scheduledId.delete(timeout.scheduledId);
      }
      startGameFromReveal(ctx, updatedGame, player.id);
    } else {
      // Only one player acknowledged so far — wait for the other
      ctx.db.Game.id.update(updatedGame);
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: pregame_skip_to_reveal
// Roll winner can acknowledge the roll AND choose who goes first in one step,
// skipping the choosing phase entirely. Both players' roll acknowledgments
// are force-set so the phase transition is immediate.
// ---------------------------------------------------------------------------
export const pregame_skip_to_reveal = spacetimedb.reducer(
  {
    gameId: t.u64(),
    chosenSeat: t.u64(),
  },
  (ctx, { gameId, chosenSeat }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'pregame') throw new SenderError('Game is not in pregame');
    if (game.pregamePhase !== 'rolling') throw new SenderError('Not in rolling phase');
    if (chosenSeat !== 0n && chosenSeat !== 1n) throw new SenderError('Invalid seat');

    const player = findPlayerBySender(ctx, gameId);
    if (player.seat.toString() !== game.rollWinner) {
      throw new SenderError('Only the roll winner can choose');
    }

    // Skip rolling acknowledgment + choosing phase → go straight to revealing
    const latestGame = ctx.db.Game.id.find(gameId);
    if (!latestGame) throw new SenderError('Game not found');
    ctx.db.Game.id.update({
      ...latestGame,
      pregamePhase: 'revealing',
      currentTurn: chosenSeat,
      pregameReady0: false,
      pregameReady1: false,
    });

    // Arm the server-side backstop so a stalled client ack can't hang the game.
    scheduleRevealTimeout(ctx, gameId);

    // Paragon: populate the shared soul deck + 3 LoB souls now so they're
    // already visible when the reveal overlay dismisses.
    if (normalizeFormat(latestGame.format) === 'Paragon') {
      initializeSoulDeck(ctx, latestGame);
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: pregame_change_deck
// ---------------------------------------------------------------------------
export const pregame_change_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    deckId: t.string(),
    deckData: t.string(),
    paragon: t.string(),
  },
  (ctx, { gameId, deckId, deckData, paragon }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    // Allow swap while waiting for opponent (status='waiting') OR during the
    // pregame deck-select phase. Both states are pre-shuffle, so swapping
    // pendingDeckData is safe.
    if (game.status !== 'pregame' && game.status !== 'waiting') {
      throw new SenderError('Game is not in pregame');
    }
    if (game.status === 'pregame' && game.pregamePhase !== 'deck_select') {
      throw new SenderError('Not in deck select phase');
    }

    const player = findPlayerBySender(ctx, gameId);

    const isReady = player.seat === 0n ? game.pregameReady0 : game.pregameReady1;
    if (isReady) throw new SenderError('Cannot change deck while ready');

    try {
      const parsed = JSON.parse(deckData);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('not array or empty');
    } catch {
      throw new SenderError('Invalid deck data');
    }

    ctx.db.Player.id.update({ ...player, deckId, paragon, pendingDeckData: deckData });

    logAction(ctx, gameId, player.id, 'PREGAME_DECK_CHANGE',
      JSON.stringify({ seat: player.seat.toString(), newDeckId: deckId }),
      0n, 'pregame');
  }
);

// ===========================================================================
// Rematch reducers
// ===========================================================================

// ---------------------------------------------------------------------------
// Reducer: request_rematch
// ---------------------------------------------------------------------------
export const request_rematch = spacetimedb.reducer(
  {
    gameId: t.u64(),
    deckId: t.string(),
    deckData: t.string(),
    paragon: t.string(),
    format: t.string(),
  },
  (ctx, { gameId, deckId, deckData, paragon, format }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'finished') throw new SenderError('Game is not finished');
    if (game.rematchRequestedBy !== '') throw new SenderError('Rematch already requested');

    const player = findPlayerBySender(ctx, gameId);

    // Reject rematch with a deck in a different format than the original game
    const requesterFormat = normalizeFormat(format);
    const gameFormat = normalizeFormat(game.format);
    if (requesterFormat !== gameFormat) {
      throw new SenderError(
        `Rematch deck format (${requesterFormat}) must match original game format (${gameFormat})`
      );
    }

    // Validate deck data
    try {
      const parsed = JSON.parse(deckData);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error();
    } catch {
      throw new SenderError('Invalid deck data');
    }

    const updates: any = { ...game, rematchRequestedBy: player.seat.toString() };
    if (player.seat === 0n) {
      updates.rematchDeckId0 = deckId;
      updates.rematchDeckData0 = deckData;
      updates.rematchParagon0 = paragon;
    } else {
      updates.rematchDeckId1 = deckId;
      updates.rematchDeckData1 = deckData;
      updates.rematchParagon1 = paragon;
    }
    ctx.db.Game.id.update(updates);

    logAction(ctx, gameId, player.id, 'REMATCH_REQUESTED',
      JSON.stringify({ seat: player.seat.toString() }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: respond_rematch
// ---------------------------------------------------------------------------
export const respond_rematch = spacetimedb.reducer(
  {
    gameId: t.u64(),
    accepted: t.bool(),
    deckId: t.string(),
    deckData: t.string(),
    paragon: t.string(),
    format: t.string(),
  },
  (ctx, { gameId, accepted, deckId, deckData, paragon, format }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'finished') throw new SenderError('Game is not finished');
    if (game.rematchRequestedBy === '') throw new SenderError('No rematch requested');
    if (game.rematchResponse !== '') throw new SenderError('Already responded');

    const player = findPlayerBySender(ctx, gameId);
    if (player.seat.toString() === game.rematchRequestedBy) {
      throw new SenderError('Cannot respond to your own rematch request');
    }

    if (accepted) {
      // Reject rematch acceptance with a format-mismatched deck
      const responderFormat = normalizeFormat(format);
      const gameFormat = normalizeFormat(game.format);
      if (responderFormat !== gameFormat) {
        throw new SenderError(
          `Rematch deck format (${responderFormat}) must match original game format (${gameFormat})`
        );
      }

      // Validate deck data
      try {
        const parsed = JSON.parse(deckData);
        if (!Array.isArray(parsed) || parsed.length === 0) throw new Error();
      } catch {
        throw new SenderError('Invalid deck data');
      }

      // Store responder's deck data
      const updates: any = { ...game, rematchResponse: 'accepted' };
      if (player.seat === 0n) {
        updates.rematchDeckId0 = deckId;
        updates.rematchDeckData0 = deckData;
        updates.rematchParagon0 = paragon;
      } else {
        updates.rematchDeckId1 = deckId;
        updates.rematchDeckData1 = deckData;
        updates.rematchParagon1 = paragon;
      }
      ctx.db.Game.id.update(updates);

      // ---- Reset the game in-place ----

      // 1. Delete all existing cards and counters
      for (const card of [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)]) {
        // Delete counters for this card
        for (const counter of [...ctx.db.CardCounter.card_counter_card_instance_id.filter(card.id)]) {
          ctx.db.CardCounter.id.delete(counter.id);
        }
        ctx.db.CardInstance.id.delete(card.id);
      }

      // 2. Update players with new deck data
      const allPlayers: any[] = [...ctx.db.Player.player_game_id.filter(gameId)];
      for (const p of allPlayers) {
        const latestGame = ctx.db.Game.id.find(gameId);
        if (!latestGame) throw new SenderError('Game not found');
        const newDeckId = p.seat === 0n ? latestGame.rematchDeckId0 : latestGame.rematchDeckId1;
        const newDeckData = p.seat === 0n ? latestGame.rematchDeckData0 : latestGame.rematchDeckData1;
        const newParagon = p.seat === 0n ? latestGame.rematchParagon0 : latestGame.rematchParagon1;
        // Rematch reuses the same Player rows (in-place reset), so per-game
        // reveal state must be cleared here or it leaks into the new game —
        // e.g. The Foretelling Angel's top-deck toggle would flip the fresh
        // deck's top card face up, and a revealed hand would expose the new
        // opening hand.
        ctx.db.Player.id.update({
          ...p,
          deckId: newDeckId,
          paragon: newParagon,
          pendingDeckData: '',
          handRevealed: false,
          handRevealSnapshot: '',
          reserveRevealed: false,
          revealedCards: '',
          topDeckRevealed: false,
        });

        // 3. Insert new cards, shuffle, draw opening hand
        const currentGame = ctx.db.Game.id.find(gameId);
        if (!currentGame) throw new SenderError('Game not found');
        insertCardsShuffleDraw(ctx, currentGame, p, newDeckData);
      }

      // 4. Roll dice for first player
      const gameAfterCards = ctx.db.Game.id.find(gameId);
      if (!gameAfterCards) throw new SenderError('Game not found');
      const seed = makeSeed(
        ctx.timestamp.microsSinceUnixEpoch,
        gameId,
        0n,
        gameAfterCards.rngCounter
      );
      const rng = xorshift64(seed);

      let r0: number, r1: number;
      do {
        r0 = Number(rng.next() % 20n) + 1;
        r1 = Number(rng.next() % 20n) + 1;
      } while (r0 === r1);

      const winner = r0 > r1 ? '0' : '1';

      // 5. Reset game to pregame/rolling
      const CHOOSE_DEADLINE_MICROS = 30_000_000n;
      const gameBeforeReset = ctx.db.Game.id.find(gameId);
      if (!gameBeforeReset) throw new SenderError('Game not found');
      ctx.db.Game.id.update({
        ...gameBeforeReset,
        status: 'pregame',
        pregamePhase: 'rolling',
        currentTurn: 0n,
        currentPhase: 'draw',
        turnNumber: 0n,
        lastDiceRoll: '',
        pregameReady0: false,
        pregameReady1: false,
        rollResult0: BigInt(r0),
        rollResult1: BigInt(r1),
        rollWinner: winner,
        rngCounter: gameBeforeReset.rngCounter + 1n,
        rematchRequestedBy: '',
        rematchDeckId0: '',
        rematchDeckData0: '',
        rematchDeckId1: '',
        rematchDeckData1: '',
        rematchParagon0: '',
        rematchParagon1: '',
        rematchResponse: '',
        rematchCode: '',
        battleState: '',
        battleAttackerSeat: '',
        lastBattlePlayBySeat: '',
        choosingDeadlineMicros: ctx.timestamp.microsSinceUnixEpoch + CHOOSE_DEADLINE_MICROS,
        playingStartedAtMicros: 0n,
      });

      // Phase Stops: rematch reuses the same gameId (in-place reset), so the
      // stop/hold rows must be cleared here or a hold stranded by a mid-hold
      // concede/win wedges the next game (spec §6.6, E11). This is what
      // enforces "all stops off each game."
      clearStopHoldRows(ctx, gameId);

      logAction(ctx, gameId, player.id, 'REMATCH_STARTED',
        JSON.stringify({ result0: r0, result1: r1, winner }),
        0n, 'pregame');
    } else {
      // Decline — clear all rematch fields so either player can re-initiate
      ctx.db.Game.id.update({
        ...game,
        rematchRequestedBy: '',
        rematchDeckId0: '',
        rematchDeckData0: '',
        rematchDeckId1: '',
        rematchDeckData1: '',
        rematchParagon0: '',
        rematchParagon1: '',
        rematchResponse: '',
        rematchCode: '',
      });
      logAction(ctx, gameId, player.id, 'REMATCH_DECLINED',
        JSON.stringify({ seat: player.seat.toString() }),
        game.turnNumber, game.currentPhase);
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: cancel_rematch — requester retracts their own pending rematch
// request. Only the seat in rematchRequestedBy may cancel, and only while the
// request is still unanswered. Clears the same fields as the decline branch.
// ---------------------------------------------------------------------------
export const cancel_rematch = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'finished') throw new SenderError('Game is not finished');
    if (game.rematchRequestedBy === '') throw new SenderError('No rematch requested');
    if (game.rematchResponse !== '') throw new SenderError('Rematch already resolved');

    const player = findPlayerBySender(ctx, gameId);
    if (player.seat.toString() !== game.rematchRequestedBy) {
      throw new SenderError('Only the requester can cancel the rematch');
    }

    ctx.db.Game.id.update({
      ...game,
      rematchRequestedBy: '',
      rematchDeckId0: '',
      rematchDeckData0: '',
      rematchDeckId1: '',
      rematchDeckData1: '',
      rematchParagon0: '',
      rematchParagon1: '',
      rematchResponse: '',
      rematchCode: '',
    });
    logAction(ctx, gameId, player.id, 'REMATCH_CANCELLED',
      JSON.stringify({ seat: player.seat.toString() }),
      game.turnNumber, game.currentPhase);
  }
);

// ===========================================================================
// Pause reducers (mutually-agreed, honor-system pause)
// ===========================================================================

// ---------------------------------------------------------------------------
// Reducer: request_pause — caller asks opponent to pause the game timer.
// ---------------------------------------------------------------------------
export const request_pause = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');
    if (game.pauseRequestedBy !== '') throw new SenderError('A pause request is already pending');
    if (game.pauseStartedAtMicros !== 0n) throw new SenderError('Game is already paused');

    const player = findPlayerBySender(ctx, gameId);
    ctx.db.Game.id.update({
      ...game,
      pauseRequestedBy: player.seat.toString(),
      pauseRequestType: 'pause',
    });
    logAction(ctx, gameId, player.id, 'PAUSE_REQUESTED',
      JSON.stringify({ seat: player.seat.toString() }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: respond_to_pause — opponent accepts or declines the pause request.
// On accept, anchors pauseStartedAtMicros so elapsed-time freezes for both.
// ---------------------------------------------------------------------------
export const respond_to_pause = spacetimedb.reducer(
  { gameId: t.u64(), accepted: t.bool() },
  (ctx, { gameId, accepted }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.pauseRequestType !== 'pause') throw new SenderError('No pause request pending');
    if (game.pauseRequestedBy === '') throw new SenderError('No pause request pending');

    const player = findPlayerBySender(ctx, gameId);
    if (player.seat.toString() === game.pauseRequestedBy) {
      throw new SenderError('Cannot respond to your own pause request');
    }

    if (accepted) {
      ctx.db.Game.id.update({
        ...game,
        pauseRequestedBy: '',
        pauseRequestType: '',
        pauseStartedAtMicros: ctx.timestamp.microsSinceUnixEpoch,
      });
      logAction(ctx, gameId, player.id, 'PAUSE_ACCEPTED',
        JSON.stringify({ seat: player.seat.toString() }),
        game.turnNumber, game.currentPhase);
    } else {
      ctx.db.Game.id.update({
        ...game,
        pauseRequestedBy: '',
        pauseRequestType: '',
      });
      logAction(ctx, gameId, player.id, 'PAUSE_DECLINED',
        JSON.stringify({ seat: player.seat.toString() }),
        game.turnNumber, game.currentPhase);
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: request_resume — caller asks opponent to resume the paused game.
// ---------------------------------------------------------------------------
export const request_resume = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');
    if (game.pauseStartedAtMicros === 0n) throw new SenderError('Game is not paused');
    if (game.pauseRequestedBy !== '') throw new SenderError('A request is already pending');

    const player = findPlayerBySender(ctx, gameId);
    ctx.db.Game.id.update({
      ...game,
      pauseRequestedBy: player.seat.toString(),
      pauseRequestType: 'resume',
    });
    logAction(ctx, gameId, player.id, 'RESUME_REQUESTED',
      JSON.stringify({ seat: player.seat.toString() }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: respond_to_resume — opponent accepts or declines the resume request.
// On accept, accumulates the paused duration into totalPausedMicros so the
// timer hook can subtract it from elapsed time.
// ---------------------------------------------------------------------------
export const respond_to_resume = spacetimedb.reducer(
  { gameId: t.u64(), accepted: t.bool() },
  (ctx, { gameId, accepted }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.pauseRequestType !== 'resume') throw new SenderError('No resume request pending');
    if (game.pauseRequestedBy === '') throw new SenderError('No resume request pending');

    const player = findPlayerBySender(ctx, gameId);
    if (player.seat.toString() === game.pauseRequestedBy) {
      throw new SenderError('Cannot respond to your own resume request');
    }

    if (accepted) {
      const pausedDuration = ctx.timestamp.microsSinceUnixEpoch - game.pauseStartedAtMicros;
      ctx.db.Game.id.update({
        ...game,
        pauseRequestedBy: '',
        pauseRequestType: '',
        pauseStartedAtMicros: 0n,
        totalPausedMicros: game.totalPausedMicros + pausedDuration,
      });
      logAction(ctx, gameId, player.id, 'RESUME_ACCEPTED',
        JSON.stringify({ seat: player.seat.toString() }),
        game.turnNumber, game.currentPhase);
    } else {
      ctx.db.Game.id.update({
        ...game,
        pauseRequestedBy: '',
        pauseRequestType: '',
      });
      logAction(ctx, gameId, player.id, 'RESUME_DECLINED',
        JSON.stringify({ seat: player.seat.toString() }),
        game.turnNumber, game.currentPhase);
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: cancel_pause_request — requester cancels their own pending
// pause/resume request. Used when the opponent is taking too long to respond.
// ---------------------------------------------------------------------------
export const cancel_pause_request = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.pauseRequestedBy === '') throw new SenderError('No request pending');

    const player = findPlayerBySender(ctx, gameId);
    if (player.seat.toString() !== game.pauseRequestedBy) {
      throw new SenderError('Only the requester can cancel');
    }

    ctx.db.Game.id.update({
      ...game,
      pauseRequestedBy: '',
      pauseRequestType: '',
    });
    logAction(ctx, gameId, player.id, 'PAUSE_REQUEST_CANCELLED',
      JSON.stringify({ seat: player.seat.toString() }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: join_as_spectator
// ---------------------------------------------------------------------------
export const join_as_spectator = spacetimedb.reducer(
  {
    code: t.string(),
    displayName: t.string(),
  },
  (ctx, { code, displayName }) => {
    // Find game by code
    let game: any = null;
    for (const g of ctx.db.Game.game_code.filter(code)) {
      game = g;
      break;
    }
    if (!game) throw new SenderError('No game found with that code');

    // Ban check
    for (const ban of ctx.db.SpectatorBan.spectator_ban_game_id.filter(game.id)) {
      if (ban.identity.toHexString() === ctx.sender.toHexString()) {
        throw new SenderError('You have been removed from this game');
      }
    }

    // Idempotent reconnect: if a row already exists for (gameId, sender),
    // refresh displayName so renames propagate and return without inserting
    // a second row.
    for (const existing of ctx.db.Spectator.spectator_game_id.filter(game.id)) {
      if (existing.identity.toHexString() === ctx.sender.toHexString()) {
        if (existing.displayName !== displayName) {
          ctx.db.Spectator.id.update({ ...existing, displayName });
        }
        return;
      }
    }

    if (isForgeGame(ctx, game.id)) {
      // Forge playtest games: spectating is members-only. The spectate page
      // mints a seat authorization for the viewer's identity via the
      // requireForge server action before calling this reducer; absent or
      // stale auth reads the same as a nonexistent game (no oracle).
      try {
        consumeForgeSeatAuth(ctx, code);
      } catch {
        throw new SenderError('No game found with that code');
      }
    } else if (!game.isPublic) {
      // Private games block new spectators (existing ones already returned above)
      throw new SenderError('This game is private');
    }

    ctx.db.Spectator.insert({
      id: 0n,
      gameId: game.id,
      identity: ctx.sender,
      displayName,
    });

    ctx.db.ChatMessage.insert({
      id: 0n,
      gameId: game.id,
      senderId: 0n,
      text: `${displayName} started spectating`,
      sentAt: ctx.timestamp,
    });
  }
);

// ---------------------------------------------------------------------------
// Reducer: leave_game
// ---------------------------------------------------------------------------
export const leave_game = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    // Try to find as player first
    for (const player of ctx.db.Player.player_game_id.filter(gameId)) {
      if (player.identity.toHexString() === ctx.sender.toHexString()) {
        ctx.db.Player.id.update({ ...player, isConnected: false });

        // If the game is still in the lobby (waiting), finish it immediately
        // so it disappears from the lobby list right away.
        const game = ctx.db.Game.id.find(gameId);
        if (game && game.status === 'waiting') {
          ctx.db.Game.id.update({ ...game, status: 'finished' });
        }
        return;
      }
    }

    // Try to find as spectator
    for (const spectator of ctx.db.Spectator.spectator_game_id.filter(gameId)) {
      if (spectator.identity.toHexString() === ctx.sender.toHexString()) {
        const displayName = spectator.displayName;
        ctx.db.Spectator.id.delete(spectator.id);
        ctx.db.ChatMessage.insert({
          id: 0n,
          gameId,
          senderId: 0n,
          text: `${displayName} stopped spectating`,
          sentAt: ctx.timestamp,
        });
        return;
      }
    }

    throw new SenderError('Not a participant in this game');
  }
);

// ---------------------------------------------------------------------------
// Reducer: leave_as_spectator
// Spectator-only leave path. Used by the spectator tab on unmount so that
// self-spectate works: leave_game above hits the Player branch first when
// the same identity has both rows, so spectators need a dedicated reducer.
// Silent no-op if no Spectator row exists (e.g. ban-rejected join, double
// fire on unmount).
// ---------------------------------------------------------------------------
export const leave_as_spectator = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    for (const spectator of ctx.db.Spectator.spectator_game_id.filter(gameId)) {
      if (spectator.identity.toHexString() === ctx.sender.toHexString()) {
        const displayName = spectator.displayName;
        ctx.db.Spectator.id.delete(spectator.id);
        ctx.db.ChatMessage.insert({
          id: 0n,
          gameId,
          senderId: 0n,
          text: `${displayName} stopped spectating`,
          sentAt: ctx.timestamp,
        });
        return;
      }
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: register_presence
// Called by the client whenever the game page is mounted AND the WebSocket
// is connected — initially and after every reconnect. Revives isConnected,
// cancels any pending DisconnectTimeout, and clears disconnectTimeoutFired.
// Silent no-op if the sender isn't in the game or the game is finished; this
// is the explicit signal that replaces the old blanket revive in
// clientConnected (which used to keep orphaned lobbies alive whenever the
// creator hit any other page on the site).
// ---------------------------------------------------------------------------
export const register_presence = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game || game.status === 'finished') return;

    for (const player of ctx.db.Player.player_game_id.filter(gameId)) {
      if (player.identity.toHexString() !== ctx.sender.toHexString()) continue;

      if (!player.isConnected) {
        ctx.db.Player.id.update({ ...player, isConnected: true });
      }

      for (const timeout of ctx.db.DisconnectTimeout.disconnect_timeout_player_id.filter(player.id)) {
        ctx.db.DisconnectTimeout.scheduledId.delete(timeout.scheduledId);
      }

      if (game.disconnectTimeoutFired) {
        ctx.db.Game.id.update({ ...game, disconnectTimeoutFired: false });
      }
      return;
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: resign_game
// ---------------------------------------------------------------------------
export const resign_game = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    ctx.db.Game.id.update({ ...game, status: 'finished' });
    clearPregameRows(ctx, gameId);

    logAction(
      ctx,
      gameId,
      player.id,
      'RESIGN',
      JSON.stringify({ resignedBy: player.displayName }),
      game.turnNumber,
      game.currentPhase
    );
  }
);

// ---------------------------------------------------------------------------
// Reducer: update_lobby_message
// ---------------------------------------------------------------------------
export const update_lobby_message = spacetimedb.reducer(
  {
    gameId: t.u64(),
    message: t.string(),
  },
  (ctx, { gameId, message }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'waiting') throw new SenderError('Game is not in waiting state');
    if (game.createdBy.toHexString() !== ctx.sender.toHexString()) {
      throw new SenderError('Only the game creator can update the lobby message');
    }
    ctx.db.Game.id.update({ ...game, lobbyMessage: message.slice(0, 100) });
  }
);

// ---------------------------------------------------------------------------
// Reducer: set_game_public
// ---------------------------------------------------------------------------
export const set_game_public = spacetimedb.reducer(
  {
    gameId: t.u64(),
    isPublic: t.bool(),
  },
  (ctx, { gameId, isPublic }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (isForgeGame(ctx, gameId)) throw new SenderError('Playtest games are always private');
    if (game.status !== 'waiting') throw new SenderError('Game is not in waiting state');
    if (game.createdBy.toHexString() !== ctx.sender.toHexString()) {
      throw new SenderError('Only the game creator can change game visibility');
    }
    ctx.db.Game.id.update({ ...game, isPublic });
  }
);

// ---------------------------------------------------------------------------
// Scheduled reducer: handle_disconnect_timeout
// ---------------------------------------------------------------------------
export const handle_disconnect_timeout = spacetimedb.reducer(
  { arg: DisconnectTimeout.rowType },
  (ctx, { arg }) => {
    const player = ctx.db.Player.id.find(arg.playerId);
    if (!player) return;

    // Only act if player is still disconnected
    if (!player.isConnected) {
      const game = ctx.db.Game.id.find(arg.gameId);
      if (game && game.status !== 'finished') {
        if (game.status === 'playing') {
          // Active game: set flag so remaining player can claim victory
          ctx.db.Game.id.update({ ...game, disconnectTimeoutFired: true });
          logAction(
            ctx,
            arg.gameId,
            arg.playerId,
            'DISCONNECT_TIMEOUT_WARNING',
            JSON.stringify({ reason: 'disconnect_timeout' }),
            game.turnNumber,
            game.currentPhase
          );
        } else {
          // Waiting/pregame: end game immediately
          ctx.db.Game.id.update({ ...game, status: 'finished' });
          clearPregameRows(ctx, arg.gameId);
          logAction(
            ctx,
            arg.gameId,
            arg.playerId,
            'TIMEOUT',
            JSON.stringify({ reason: 'disconnect_timeout' }),
            game.turnNumber,
            game.currentPhase
          );
        }
      }
    }
  }
);

// Wire the scheduled reducer to the schema's forward reference
setDisconnectTimeoutReducer(handle_disconnect_timeout);

// ---------------------------------------------------------------------------
// Reducer: claim_timeout_victory
// Called by the remaining connected player after disconnectTimeoutFired is set
// ---------------------------------------------------------------------------
export const claim_timeout_victory = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');
    if (!game.disconnectTimeoutFired) throw new SenderError('Disconnect timeout has not fired');

    const player = findPlayerBySender(ctx, gameId);
    if (!player.isConnected) throw new SenderError('Only the connected player can claim victory');

    ctx.db.Game.id.update({ ...game, status: 'finished', disconnectTimeoutFired: false });
    // Reachable mid-pre-game: the 5-minute disconnect grace applies at
    // status:'playing', which is exactly what the star/soul steps run under.
    clearPregameRows(ctx, gameId);
    logAction(ctx, gameId, player.id, 'TIMEOUT', JSON.stringify({ reason: 'claimed_by_opponent' }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Scheduled reducer: handle_choose_first_timeout
// If the roll winner hasn't chosen in time, auto-select them to go first.
// ---------------------------------------------------------------------------
export const handle_choose_first_timeout = spacetimedb.reducer(
  { arg: ChooseFirstTimeout.rowType },
  (ctx, { arg }) => {
    const game = ctx.db.Game.id.find(arg.gameId);
    if (!game) return;

    // Only act if game is still in choosing phase
    if (game.status !== 'pregame' || game.pregamePhase !== 'choosing') return;

    // Auto-choose: roll winner goes first
    const winnerSeat = BigInt(game.rollWinner);
    ctx.db.Game.id.update({
      ...game,
      pregamePhase: 'revealing',
      currentTurn: winnerSeat,
      pregameReady0: false,
      pregameReady1: false,
    });

    // Arm the server-side backstop so a stalled client ack can't hang the game.
    scheduleRevealTimeout(ctx, arg.gameId);
  }
);

setChooseFirstTimeoutReducer(handle_choose_first_timeout);

// ---------------------------------------------------------------------------
// Scheduled reducer: handle_reveal_timeout
// Backstop for the 'revealing' phase. Both clients normally auto-ack
// (pregame_acknowledge_first) ~1.5s after the reveal to start the game; if an
// ack never arrives, this force-starts the game so "Starting game…" can't
// linger indefinitely. The choice of who goes first (game.currentTurn) was
// already decided and stored when we entered 'revealing', so force-starting
// only skips the cosmetic reveal delay — it changes no game state.
// ---------------------------------------------------------------------------
export const handle_reveal_timeout = spacetimedb.reducer(
  { arg: RevealTimeout.rowType },
  (ctx, { arg }) => {
    const game = ctx.db.Game.id.find(arg.gameId);
    if (!game) return;

    // Only act if the game is still stuck in the revealing phase.
    if (game.status !== 'pregame' || game.pregamePhase !== 'revealing') return;

    startGameFromReveal(ctx, game, 0n);
  }
);

setRevealTimeoutReducer(handle_reveal_timeout);

// ---------------------------------------------------------------------------
// Scheduled reducer: handle_pregame_idle_timeout
// The Pre-Game Phase is untimed by design; this only stops an idle or departed
// player from hanging the game. Force-completes the active seat's sub-step.
// ---------------------------------------------------------------------------
export const handle_pregame_idle_timeout = spacetimedb.reducer(
  { arg: PregameIdleTimeout.rowType },
  (ctx, { arg }) => {
    const game = ctx.db.Game.id.find(arg.gameId);
    if (!game) return;
    if (game.status !== 'playing') return;
    if (game.pregamePhase !== 'stars' && game.pregamePhase !== 'souls') return;

    const state = ctx.db.PregameState.gameId.find(arg.gameId);
    if (!state) return;

    const step: PregameStep = game.pregamePhase === 'souls' ? 'souls' : 'stars';
    const seat: Seat = state.activeSeat === 0n ? 0 : 1;

    ctx.db.PregameState.gameId.update({
      ...state,
      ...markDone(readPregameProgress(state), step, seat),
    });

    logAction(ctx, arg.gameId, 0n, 'PREGAME_IDLE_SKIP',
      JSON.stringify({ seat: seat.toString(), step }), game.turnNumber, game.currentPhase);

    advancePregame(ctx, arg.gameId);
  }
);

setPregameIdleTimeoutReducer(handle_pregame_idle_timeout);

// Shared validation for the REG Pre-Game Phase sub-steps. Returns the acting
// player, whose seat must be the one whose window is open.
function assertPregameActor(ctx: any, gameId: bigint, expectedPhase: PregameStep) {
  const game = ctx.db.Game.id.find(gameId);
  if (!game) throw new SenderError('Game not found');
  if (game.status !== 'playing') throw new SenderError('Game is not in playing state');
  if (game.pregamePhase !== expectedPhase) {
    throw new SenderError('Not in the ' + expectedPhase + ' phase');
  }
  const state = ctx.db.PregameState.gameId.find(gameId);
  if (!state) throw new SenderError('Pre-game state not found');
  const player = findPlayerBySender(ctx, gameId);
  if (player.seat !== state.activeSeat) throw new SenderError('Not your pre-game window');
  return { game, state, player };
}

// ---------------------------------------------------------------------------
// Reducer: pregame_submit_stars
// REG: "players may reveal any number of star cards from their hand to use the
// star ability." The whole set is revealed at once, then resolved one at a
// time in the order chosen. An empty list is the explicit "no stars" answer.
// ---------------------------------------------------------------------------
const MAX_PREGAME_STARS = 16; // hand limit — no legal submission exceeds it

export const pregame_submit_stars = spacetimedb.reducer(
  { gameId: t.u64(), cardInstanceIds: t.string() },
  (ctx, { gameId, cardInstanceIds }) => {
    const { state, player } = assertPregameActor(ctx, gameId, 'stars');

    const already = [...ctx.db.PregameStar.pregame_star_game_id.filter(gameId)]
      .filter((r: any) => r.seat === player.seat);
    if (already.length > 0) throw new SenderError('Stars already submitted');

    let ids: string[];
    try {
      const parsed = JSON.parse(cardInstanceIds);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      ids = parsed.map((v: any) => String(v));
    } catch {
      throw new SenderError('Invalid star selection');
    }
    if (ids.length > MAX_PREGAME_STARS) throw new SenderError('Too many stars selected');
    if (new Set(ids).size !== ids.length) throw new SenderError('Duplicate star selected');

    // Same 30s flash reveal_card_in_hand applies, so the star lights up in the
    // normal treatment. revealExpiresAt is a Timestamp, not raw micros.
    const THIRTY_SECONDS_MICROS = 30_000_000n;
    const revealExpiresAt = new Timestamp(
      ctx.timestamp.microsSinceUnixEpoch + THIRTY_SECONDS_MICROS
    );

    // {name, img} per star so the chat log renders each as a hoverable card
    // link — ChatPanel's HoverableCard degrades to plain text without an image.
    const revealed: Array<{ name: string; img: string }> = [];
    for (let i = 0; i < ids.length; i++) {
      let instanceId: bigint;
      try {
        instanceId = BigInt(ids[i]);
      } catch {
        throw new SenderError('Invalid star selection');
      }
      const card = ctx.db.CardInstance.id.find(instanceId);
      if (!card) throw new SenderError('Card not found');
      if (card.gameId !== gameId) throw new SenderError('Card not in this game');
      if (card.ownerId !== player.id) throw new SenderError('Not your card');
      if (card.zone !== 'hand') throw new SenderError('Star cards must be revealed from hand');
      if (!isStarAbilityText(card.specialAbility)) throw new SenderError('Not a star card');

      ctx.db.PregameStar.insert({
        id: 0n,
        gameId,
        seat: player.seat,
        cardInstanceId: instanceId,
        slot: BigInt(i),
        resolved: false,
      });

      // The opponent's authoritative view is the PregameStar rows above — this
      // 30s flag is allowed to expire mid-phase.
      ctx.db.CardInstance.id.update({
        ...card,
        revealExpiresAt,
        revealStartedAt: ctx.timestamp,
      });
      revealed.push({ name: card.cardName, img: card.cardImgFile });
    }

    if (ids.length === 0) {
      ctx.db.PregameState.gameId.update({
        ...state,
        ...markDone(readPregameProgress(state), 'stars', state.activeSeat === 0n ? 0 : 1),
      });
      logAction(ctx, gameId, player.id, 'PREGAME_STARS_NONE',
        JSON.stringify({ seat: player.seat.toString() }), 1n, 'draw');
      advancePregame(ctx, gameId);
      return;
    }

    logAction(ctx, gameId, player.id, 'PREGAME_STARS_REVEALED',
      JSON.stringify({ seat: player.seat.toString(), cards: revealed }), 1n, 'draw');
    schedulePregameIdleTimeout(ctx, gameId);
  }
);

// ---------------------------------------------------------------------------
// Reducer: pregame_resolve_star
// Stars resolve in the order the player chose. Order is enforced here, not
// merely presented in the UI.
// ---------------------------------------------------------------------------
export const pregame_resolve_star = spacetimedb.reducer(
  { gameId: t.u64(), starId: t.u64() },
  (ctx, { gameId, starId }) => {
    const { state, player } = assertPregameActor(ctx, gameId, 'stars');

    const mine = [...ctx.db.PregameStar.pregame_star_game_id.filter(gameId)]
      .filter((r: any) => r.seat === player.seat && !r.resolved)
      .sort((a: any, b: any) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
    if (mine.length === 0) throw new SenderError('No stars left to resolve');

    const target = mine[0];
    if (target.id !== starId) throw new SenderError('Stars must resolve in the chosen order');

    ctx.db.PregameStar.id.update({ ...target, resolved: true });

    const card = ctx.db.CardInstance.id.find(target.cardInstanceId);
    logAction(ctx, gameId, player.id, 'PREGAME_STAR_RESOLVED',
      JSON.stringify({
        seat: player.seat.toString(),
        cardName: card ? card.cardName : '',
        cardImgFile: card ? card.cardImgFile : '',
      }),
      1n, 'draw');

    if (mine.length === 1) {
      ctx.db.PregameState.gameId.update({
        ...state,
        ...markDone(readPregameProgress(state), 'stars', state.activeSeat === 0n ? 0 : 1),
      });
      advancePregame(ctx, gameId);
      return;
    }
    schedulePregameIdleTimeout(ctx, gameId);
  }
);

// ---------------------------------------------------------------------------
// Reducer: pregame_finish_souls
// REG step 3 — a single acknowledgement per player. Activation itself happens
// through the normal right-click menu ('land-of-bondage' is already an ability
// source zone); this only closes the window.
// ---------------------------------------------------------------------------
export const pregame_finish_souls = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const { state, player } = assertPregameActor(ctx, gameId, 'souls');

    ctx.db.PregameState.gameId.update({
      ...state,
      ...markDone(readPregameProgress(state), 'souls', state.activeSeat === 0n ? 0 : 1),
    });

    logAction(ctx, gameId, player.id, 'PREGAME_SOULS_DONE',
      JSON.stringify({ seat: player.seat.toString() }), 1n, 'draw');

    advancePregame(ctx, gameId);
  }
);

// ---------------------------------------------------------------------------
// Scheduled reducer: cleanup_stale_games
// ---------------------------------------------------------------------------
const FIVE_MIN_MICROS = 300_000_000n;
const ONE_HOUR_MICROS = 3_600_000_000n;
const THIRTY_MIN_MICROS = 1_800_000_000n;
const TWENTY_FOUR_HOURS_MICROS = 86_400_000_000n;

export const cleanup_stale_games = spacetimedb.reducer(
  { arg: CleanupSchedule.rowType },
  (ctx, { arg }) => {
    const now = ctx.timestamp.microsSinceUnixEpoch;

    // Always reschedule first — if cleanup logic throws, the chain must not break
    ctx.db.CleanupSchedule.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(now + ONE_HOUR_MICROS),
    });

    // Single scan — branch on status. Previously we scanned Game four times;
    // merging keeps one sequential pass and the same semantics (a waiting
    // game >24h old becomes 'finished' here and is eligible for deletion in
    // the same pass because we re-check status per row).
    for (const game of [...ctx.db.Game.iter()]) {
      const age = now - game.createdAt.microsSinceUnixEpoch;

      // 1. Abandon waiting games older than 1 hour
      if (game.status === 'waiting' && age > ONE_HOUR_MICROS) {
        ctx.db.Game.id.update({ ...game, status: 'finished' });
        continue;
      }

      // 2. Abandon pregame games older than 30 minutes
      if (game.status === 'pregame' && age > THIRTY_MIN_MICROS) {
        ctx.db.Game.id.update({ ...game, status: 'finished' });
        continue;
      }

      // 3. Abandon playing games where both players disconnected, no recent activity
      if (game.status === 'playing') {
        const players = [...ctx.db.Player.player_game_id.filter(game.id)];
        const allDisconnected = players.length > 0 && players.every((p: any) => !p.isConnected);
        if (!allDisconnected) continue;

        let latestActionTime = 0n;
        for (const action of ctx.db.GameAction.game_action_game_id.filter(game.id)) {
          const actionTime = action.timestamp.microsSinceUnixEpoch;
          if (actionTime > latestActionTime) latestActionTime = actionTime;
        }
        if (latestActionTime === 0n) latestActionTime = game.createdAt.microsSinceUnixEpoch;

        if ((now - latestActionTime) > THIRTY_MIN_MICROS) {
          ctx.db.Game.id.update({ ...game, status: 'finished' });
          // A game abandoned during the star/soul steps is still 'playing'.
          clearPregameRows(ctx, game.id);
          clearStopHoldRows(ctx, game.id);
        }
        continue;
      }

      // 4. Delete data for finished games older than 24 hours
      if (game.status !== 'finished') continue;
      if (age <= TWENTY_FOUR_HOURS_MICROS) continue;

      const gameId = game.id;

      for (const card of [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)]) {
        for (const counter of [...ctx.db.CardCounter.card_counter_card_instance_id.filter(card.id)]) {
          ctx.db.CardCounter.id.delete(counter.id);
        }
        ctx.db.CardInstance.id.delete(card.id);
      }
      for (const action of [...ctx.db.GameAction.game_action_game_id.filter(gameId)]) {
        ctx.db.GameAction.id.delete(action.id);
      }
      for (const msg of [...ctx.db.ChatMessage.chat_message_game_id.filter(gameId)]) {
        ctx.db.ChatMessage.id.delete(msg.id);
      }
      for (const spec of [...ctx.db.Spectator.spectator_game_id.filter(gameId)]) {
        ctx.db.Spectator.id.delete(spec.id);
      }
      for (const req of [...ctx.db.ZoneSearchRequest.zone_search_request_game_id.filter(gameId)]) {
        ctx.db.ZoneSearchRequest.id.delete(req.id);
      }
      for (const player of [...ctx.db.Player.player_game_id.filter(gameId)]) {
        ctx.db.Player.id.delete(player.id);
      }
      clearPregameRows(ctx, gameId);
      clearStopHoldRows(ctx, gameId);
      ctx.db.Game.id.delete(gameId);
    }
  }
);

setCleanupStaleGamesReducer(cleanup_stale_games);

// ---------------------------------------------------------------------------
// Phase Stops reducers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reducer: set_turn_stop
// Toggle the caller's one-shot gate for a boundary of the OPPONENT's turn.
// Lazy row insert; toggles are never logged (they'd leak intent — spec §6.1).
// status 'playing' includes the star/soul pregame (pregamePhase !== ''),
// which deliberately lets players prep turn-1 gates; holds cannot engage
// mid-pregame because every phase mover throws during pregame. Toggling
// during an active hold only affects future boundaries — the hold itself is
// answered via the priority prompt (release_turn_stop), not by un-toggling
// (rev 4: the tripped stop was already consumed when the hold engaged).
// ---------------------------------------------------------------------------
export const set_turn_stop = spacetimedb.reducer(
  { gameId: t.u64(), phase: t.string(), enabled: t.bool() },
  (ctx, { gameId, phase, enabled }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');
    if (!(STOP_PHASES as readonly string[]).includes(phase)) {
      throw new SenderError('Invalid phase: ' + phase);
    }

    let stopRow = ctx.db.TurnStop.gameId.find(gameId);
    if (!stopRow) {
      stopRow = ctx.db.TurnStop.insert({
        gameId, seat0Stops: '', seat1Stops: '', holdPhase: '', holdResume: '', firedPhases: '',
      });
    }

    const isSeat0 = player.seat === 0n;
    ctx.db.TurnStop.gameId.update({
      ...stopRow,
      seat0Stops: isSeat0 ? toggleStop(stopRow.seat0Stops, phase, enabled) : stopRow.seat0Stops,
      seat1Stops: isSeat0 ? stopRow.seat1Stops : toggleStop(stopRow.seat1Stops, phase, enabled),
    });
  }
);

// ---------------------------------------------------------------------------
// Reducer: release_turn_stop
// The ACTIVE player answers the priority prompt (rev 4). Grant and Deny both
// only lift the hold — the turn stays where it halted and the active player
// redoes their move themselves; the two differ only in the logged courtesy
// (granted vs declined the window). The stopper has no release affordance —
// their stop was consumed when it tripped, and the 60s backstop covers an
// unresponsive active player.
// ---------------------------------------------------------------------------
export const release_turn_stop = spacetimedb.reducer(
  { gameId: t.u64(), denied: t.bool() },
  (ctx, { gameId, denied }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    const stopRow = ctx.db.TurnStop.gameId.find(gameId);
    if (!stopRow || stopRow.holdPhase === '') {
      throw new SenderError('No stop is holding the turn');
    }
    if (player.seat !== game.currentTurn) {
      throw new SenderError('Only the active player can answer the priority request');
    }
    releaseHold(ctx, gameId, denied ? 'deny' : 'grant', player.id);
  }
);

// ---------------------------------------------------------------------------
// Scheduled reducer: handle_stop_hold_timeout
// Defensive early-returns, never throws (the handle_pregame_idle_timeout
// pattern). `arg.phase` mismatch = stale row → no-op. The scheduled row
// self-deletes after the reducer runs. The releaseHold call stays wrapped in
// try/catch: this scheduled backstop must remain throw-free even if
// something unexpected goes wrong releasing the hold.
// ---------------------------------------------------------------------------
export const handle_stop_hold_timeout = spacetimedb.reducer(
  { arg: StopHoldTimeout.rowType },
  (ctx, { arg }) => {
    const game = ctx.db.Game.id.find(arg.gameId);
    if (!game) return;
    if (game.status !== 'playing') return;
    const stopRow = ctx.db.TurnStop.gameId.find(arg.gameId);
    if (!stopRow || stopRow.holdPhase === '') return;
    if (stopRow.holdPhase !== arg.phase) return;
    try {
      releaseHold(ctx, arg.gameId, 'timeout', 0n);
    } catch {
      // Never let the scheduled backstop throw (spec §6.6).
    }
  }
);

setStopHoldTimeoutReducer(handle_stop_hold_timeout);

// ===========================================================================
// Turn / Phase reducers
// ===========================================================================

// ---------------------------------------------------------------------------
// Helper: applyPhaseTransition
// The single phase-write path — every transition goes through resumeMovement
// (below), which calls this both for the legitimate phases a turn crosses
// BEFORE a gate and for the movement's destination. Runs the leave-battle
// auto-return and enter-battle band-open side effects, writes currentPhase,
// logs SET_PHASE — exactly what a direct phase click does, so a gate
// crossing is indistinguishable from the player clicking through it.
//
// `opts.openBattleBand` (default true) governs ONLY whether landing on
// 'battle' also opens the band. resumeMovement's b-1 CROSSING calls (a turn
// legally passing through battle on its way to a gate further out — e.g. End
// Turn from preparation with a discard gate) pass `{ openBattleBand: false }`:
// currentPhase becomes 'battle' but battleState is left untouched ('') — no
// player attacked, so no band should open. A battle DESTINATION keeps the
// default: targeting battle is what opens the band.
// ---------------------------------------------------------------------------
function applyPhaseTransition(
  ctx: any,
  gameId: bigint,
  actingPlayerId: bigint,
  targetPhase: string,
  opts?: { openBattleBand?: boolean },
): void {
  const openBattleBand = opts?.openBattleBand ?? true;
  let game = ctx.db.Game.id.find(gameId);
  if (!game) return;
  const oldPhase = game.currentPhase;

  // Leaving battle auto-closes any open band; runBattleAutoReturn writes the
  // Game row, so re-read before the currentPhase write below (stale-spread
  // hazard — same comment as the original set_phase body).
  if (oldPhase === 'battle' && targetPhase !== 'battle' && game.battleState !== '') {
    runBattleAutoReturn(ctx, gameId, actingPlayerId);
    game = ctx.db.Game.id.find(gameId) ?? game;
  }

  if (openBattleBand && targetPhase === 'battle' && oldPhase !== 'battle' && game.battleState === '') {
    // Entering the battle phase opens the band — same step enter_battle
    // performs when the band starts closed.
    ctx.db.Game.id.update({
      ...game,
      currentPhase: targetPhase,
      battleState: 'active',
      battleAttackerSeat: game.currentTurn.toString(),
      lastBattlePlayBySeat: '',
    });
  } else {
    ctx.db.Game.id.update({ ...game, currentPhase: targetPhase });
  }

  logAction(ctx, gameId, actingPlayerId, 'SET_PHASE', JSON.stringify({ phase: targetPhase }), game.turnNumber, targetPhase);
}

// ---------------------------------------------------------------------------
// Helper: resumeMovement
// The single forward-movement engine (rev 4), shared by set_phase, end_turn,
// and the battle→discard advance (end_battle / surrender_soul). Moves the
// turn toward `target` — a phase name, or 'end' for the turn flip — honoring
// the first armed gate on the way: cross the phases before the gate
// (band-open suppressed — crossing battle en route is not an attack), then
// halt and hold. No gate → complete the movement: enter the target phase (a
// battle TARGET opens the band, exactly like clicking it) or perform the
// turn flip. A release never advances — once the prompt is answered, the
// active player redoes the halted move and the consumed gate lets it
// through. Backward set_phase moves scan an empty boundary range and fall
// through to the plain transition. Callers have already validated
// turn/hold/pregame.
// ---------------------------------------------------------------------------
function resumeMovement(ctx: any, gameId: bigint, actingPlayer: any, target: string): void {
  const game = ctx.db.Game.id.find(gameId);
  if (!game) return;
  const curIdx = (TURN_PHASES as readonly string[]).indexOf(game.currentPhase);
  const toIdx = target === 'end' ? TURN_PHASES.length : (TURN_PHASES as readonly string[]).indexOf(target);
  const gate = scanForStop(ctx, game, curIdx, toIdx);
  if (gate !== null) {
    const b = gateBoundaryIndex(gate);
    if (b - 1 > curIdx) {
      applyPhaseTransition(ctx, gameId, actingPlayer.id, TURN_PHASES[b - 1], { openBattleBand: false });
    }
    engageHold(ctx, gameId, gate);
    return;
  }
  if (target === 'end') {
    performTurnFlip(ctx, gameId, actingPlayer);
  } else {
    applyPhaseTransition(ctx, gameId, actingPlayer.id, target);
  }
}

// ---------------------------------------------------------------------------
// Helper: performTurnFlip
// The actual end-of-turn flip, extracted from end_turn so releaseHold's
// Deny/timeout path can complete a turn halted at the 'end' gate. Assumes any
// open band was already auto-returned (end_turn does that up front, and a
// hold blocks band-opens for its whole window, so release-time state is
// clean).
// ---------------------------------------------------------------------------
function performTurnFlip(ctx: any, gameId: bigint, actingPlayer: any): void {
  const game = ctx.db.Game.id.find(gameId);
  if (!game) return;
  const nextSeat = game.currentTurn === 0n ? 1n : 0n;
  // Only increment the turn number when both players have gone (seat 1 finishes → back to seat 0)
  const newTurnNumber = nextSeat === 0n ? game.turnNumber + 1n : game.turnNumber;

  ctx.db.Game.id.update({
    ...game,
    currentTurn: nextSeat,
    currentPhase: 'draw',
    turnNumber: newTurnNumber,
  });

  // Find the new active player
  let newActivePlayer: any = null;
  for (const p of ctx.db.Player.player_game_id.filter(gameId)) {
    if (p.seat === nextSeat) {
      newActivePlayer = p;
      break;
    }
  }

  if (newActivePlayer) {
    const latestGame = ctx.db.Game.id.find(gameId);
    drawCardsForPlayer(ctx, latestGame, newActivePlayer, 3);
  }

  // Paragon: refill the shared LoB back to 3 at the start of the new turn.
  if (normalizeFormat(game.format) === 'Paragon') {
    refillSoulDeck(ctx, gameId);
  }

  logAction(ctx, gameId, actingPlayer.id, 'END_TURN', JSON.stringify({ newTurn: newTurnNumber.toString() }), newTurnNumber, 'draw');
}

// ---------------------------------------------------------------------------
// Reducer: set_phase
// ---------------------------------------------------------------------------
export const set_phase = spacetimedb.reducer(
  {
    gameId: t.u64(),
    phase: t.string(),
  },
  (ctx, { gameId, phase }) => {
    const player = findPlayerBySender(ctx, gameId);
    let game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    // The REG Pre-Game Phase runs with status:'playing', so turn machinery has
    // to be gated on pregamePhase instead. '' = pre-game over, turn 1 is live.
    if (game.pregamePhase !== '') {
      throw new SenderError('The Pre-Game Phase is still in progress');
    }

    if (player.seat !== game.currentTurn) {
      throw new SenderError('Not your turn');
    }

    const validPhases = ['draw', 'upkeep', 'preparation', 'battle', 'discard'];
    if (!validPhases.includes(phase)) {
      throw new SenderError('Invalid phase: ' + phase);
    }

    // Phase Stops rev 4: refuse any movement while a hold is active (the
    // active player must answer the priority prompt first), then run the
    // shared movement engine — it honors the first armed gate on the way to
    // `phase` (halt + hold + prompt, storing `phase` as the resume target)
    // and completes the jump otherwise.
    assertTurnNotHeld(ctx, gameId);
    resumeMovement(ctx, gameId, player, phase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: end_turn
// ---------------------------------------------------------------------------
export const end_turn = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const player = findPlayerBySender(ctx, gameId);
    let game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    // The REG Pre-Game Phase runs with status:'playing', so turn machinery has
    // to be gated on pregamePhase instead. '' = pre-game over, turn 1 is live.
    if (game.pregamePhase !== '') {
      throw new SenderError('The Pre-Game Phase is still in progress');
    }

    if (player.seat !== game.currentTurn) {
      throw new SenderError('Not your turn');
    }
    assertTurnNotHeld(ctx, gameId);

    // Battles cannot span turns (spec §7): auto-return before this reducer's
    // own Game write below. runBattleAutoReturn mutates the Game row (clears
    // battleState/battleAttackerSeat/lastBattlePlayBySeat), so re-read
    // afterward — spreading the stale pre-return `game` snapshot into the
    // write below would resurrect battleState.
    if (game.battleState !== '') {
      runBattleAutoReturn(ctx, gameId, player.id);
      game = ctx.db.Game.id.find(gameId) ?? game;
    }

    // Phase Stops rev 4: End Turn is a movement to the 'end' boundary — past
    // every remaining phase gate AND the end-of-turn gate. An armed gate on
    // the way halts the turn and prompts (resume target 'end', so a Deny
    // continues toward the flip); no gate → the flip itself. The auto-return
    // above already closed any open band.
    resumeMovement(ctx, gameId, player, 'end');
  }
);

// ---------------------------------------------------------------------------
// Helper: runBattleAutoReturn
// End-of-battle card routing (spec §7). Snapshot-first: materializes every
// CardInstance row for the game ONCE before any mutation (mutating while
// iterating a live query is unsafe per spacetimedb/CLAUDE.md), then routes
// every row currently in zone 'battle' — never a remembered id list, since
// e.g. reload_deck may have deleted some of them mid-battle — by REG-derived
// precedence:
//   1. Attached accessories (equippedToInstanceId !== 0n) are skipped in the
//      main pass and follow their host's routed destination in pass 2,
//      attachment preserved.
//   2. Lost Souls -> the deck owner's Land of Bondage (mirrors the existing
//      lost-soul redirect in move_card/move_cards_batch).
//   3. Characters (isCharacterCard — handles duals + tokens) -> Territory:
//      the stamped origin position when they entered from Territory,
//      otherwise a free Territory spot. Hand/reserve/discard-origin
//      survivors never go back to a hidden zone per REG.
//   4. Enhancements (exact 'GE'/'EE' segment on cardType, split on '/' and
//      trimmed — there is no literal "Enhancement" type) -> owner's Discard,
//      unless the "keep in play" heuristic matches: `specialAbility`
//      contains "place" wording that ISN'T "in place of" / "take the place
//      of" -> a free Territory spot, and the card's name is recorded for the
//      BATTLE_END log.
//   5. Everything else — Dominants, Artifacts, Curses, Fortresses, unknown
//      types, and Forge cards (whose specialAbility is blanked on the public
//      row, so the rule-4 keep heuristic can never match them) -> the card's
//      stamped origin zone/position when set and isn't 'battle' itself,
//      otherwise a free Territory spot. NEVER discard — that's the one
//      destructive branch and rule 5 stays out of it.
// Tokens whose COMPUTED destination (whichever rule actually fired) is a
// removal zone (deck/hand/discard/reserve/banish) are deleted via
// deleteTokenWithCounters instead of moved.
// Every completing write clears in-play state (counters, notes, outline,
// meek) and the origin fields via the shared
// `leavePlayFieldOverrides('battle', toZone)` spread — the same idiom every
// other move reducer's write path uses.
// ---------------------------------------------------------------------------
function runBattleAutoReturn(ctx: any, gameId: bigint, actingPlayerId: bigint) {
  const game = ctx.db.Game.id.find(gameId);
  if (!game || game.battleState === '') return;

  const all = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];
  const inBattle = all.filter((c: any) => c.zone === 'battle');
  const keptNames: string[] = [];

  // Local per-(owner,zone) zoneIndex counters. Lazily seeded from the
  // pre-mutation snapshot (`all`) the first time a given owner+zone is
  // touched, then incremented locally for every further card routed to that
  // same owner+zone in this call — generalizes move_cards_batch's
  // `nextFreeFormIndex` seeding (~2755-2778, "max existing index + 1, then
  // increment per placement") across every destination zone/owner instead of
  // a single batch target. Max-based seeding is equivalent to the codebase's
  // count-based LOB/hand idioms here because compaction keeps those zones'
  // indices gap-free, so one scheme safely covers all destinations.
  const nextIdx = new Map<string, bigint>();
  const nextIndexFor = (ownerId: bigint, zone: string): bigint => {
    const key = `${ownerId.toString()}:${zone}`;
    if (!nextIdx.has(key)) {
      let maxIdx = -1n;
      for (const c of all) {
        if (c.ownerId === ownerId && c.zone === zone && c.zoneIndex > maxIdx) maxIdx = c.zoneIndex;
      }
      nextIdx.set(key, maxIdx + 1n);
    }
    const idx = nextIdx.get(key)!;
    nextIdx.set(key, idx + 1n);
    return idx;
  };

  // Precedence predicates (used by both the occupancy seed below and
  // computeDestination). Lost-soul check per the idiom at index.ts ~4479
  // (surrender_lost_soul) — includes TOKEN_LS, unlike the narrower two-part
  // check used inline by the move reducers' discard/reserve/banish redirect.
  const isLostSoulCard = (c: any): boolean =>
    c.cardType === 'LS' || c.cardType === 'TOKEN_LS' || c.cardName.toLowerCase().includes('lost soul');
  const isPlaceKeep = (sa: string): boolean =>
    /\bplace\b/i.test(sa) && !/\bin (the )?place of\b/i.test(sa) && !/take the place of/i.test(sa);
  const enhSegment = (ct: string): boolean =>
    ct.split('/').map((s: string) => s.trim()).some((s: string) => s === 'GE' || s === 'EE');

  // Occupancy-aware free-spot auto-fan per owner. The blind top-left fan this
  // replaced dropped every non-origin return onto (0.03, 0.05) regardless of
  // what already sat in the Territory, stacking drafted attackers / kept
  // enhancements on top of existing cards ("willy-nilly" placement). Seed a
  // per-owner occupied set with (a) the owner's Territory cards that never
  // entered the battle and (b) the exact origin spots the origin-Territory
  // returns will reclaim (deterministic — just their origin fields), then hand
  // out grid cells that clear both, and clear each other. Grid geometry is
  // unchanged from the old fan (still mirrors move_cards_batch ~2982-2992);
  // only the occupancy skip is new.
  const inBattleIds = new Set(inBattle.map((c: any) => c.id.toString()));
  const occupied = new Map<string, Array<{ x: number; y: number }>>();
  const addOccupied = (ownerId: bigint, posX: string, posY: string): void => {
    const x = parseFloat(posX);
    const y = parseFloat(posY);
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    const key = ownerId.toString();
    const arr = occupied.get(key);
    if (arr) arr.push({ x, y });
    else occupied.set(key, [{ x, y }]);
  };
  // (a) Territory cards that stay put through the battle.
  for (const c of all) {
    if (c.zone === 'territory' && !inBattleIds.has(c.id.toString())) {
      addOccupied(c.ownerId, c.posX, c.posY);
    }
  }
  // (b) Battle cards that will reclaim their exact Territory origin spot: a
  // character with a Territory origin (rule 3) or a rule-5 card with a
  // Territory origin. Enhancements never reclaim an origin, and accessories
  // follow their host (pass 2), so neither seeds occupancy here.
  for (const c of inBattle) {
    if (c.equippedToInstanceId !== 0n) continue;
    if (isLostSoulCard(c)) continue;
    const reclaimsOrigin =
      c.originZone === 'territory' &&
      (isCharacterCard({ cardType: c.cardType }) || !enhSegment(c.cardType));
    if (reclaimsOrigin) addOccupied(c.ownerId, c.originPosX, c.originPosY);
  }

  // One occupancy-aware allocator per owner, lazily seeded from that owner's
  // occupied set (grid geometry + collision live in the pure, unit-tested
  // battlePlacement helper).
  const allocators = new Map<string, () => { x: number; y: number }>();
  const nextFreeSpot = (ownerId: bigint): { posX: string; posY: string } => {
    const key = ownerId.toString();
    let alloc = allocators.get(key);
    if (!alloc) {
      alloc = makeFreeSpotAllocator(occupied.get(key) ?? []);
      allocators.set(key, alloc);
    }
    const spot = alloc();
    return { posX: String(spot.x), posY: String(spot.y) };
  };

  // Precedence rules 2-5 (rule 1, attached accessories, is handled by the
  // caller routing them in pass 2 below via their host's result instead).
  const computeDestination = (c: any): { toZone: string; posX: string; posY: string; toOwnerId: bigint } => {
    if (isLostSoulCard(c)) {
      // Lost Souls always go to the deck owner's LoB — same rule as the
      // move_card/move_cards_batch redirect, even if currently owned by an
      // opponent (e.g. mid-capture) while sitting in the battle band.
      const lobOwnerId = c.originalOwnerId !== 0n ? c.originalOwnerId : c.ownerId;
      return { toZone: 'land-of-bondage', posX: '', posY: '', toOwnerId: lobOwnerId };
    }
    if (isCharacterCard({ cardType: c.cardType })) {
      if (c.originZone === 'territory') {
        return { toZone: 'territory', posX: c.originPosX, posY: c.originPosY, toOwnerId: c.ownerId };
      }
      const spot = nextFreeSpot(c.ownerId);
      return { toZone: 'territory', posX: spot.posX, posY: spot.posY, toOwnerId: c.ownerId };
    }
    if (enhSegment(c.cardType)) {
      if (isPlaceKeep(c.specialAbility)) {
        keptNames.push(c.cardName);
        const spot = nextFreeSpot(c.ownerId);
        return { toZone: 'territory', posX: spot.posX, posY: spot.posY, toOwnerId: c.ownerId };
      }
      return { toZone: 'discard', posX: '', posY: '', toOwnerId: c.ownerId };
    }
    // Rule 5: Dominants/Artifacts/Curses/Fortresses/unknown/Forge-blanked —
    // origin if set and not 'battle' itself (defensive; stampBattleEntry
    // never stamps a card already in battle, so this shouldn't occur), else
    // a free Territory spot. Never discard.
    if (c.originZone !== '' && c.originZone !== 'battle') {
      return { toZone: c.originZone, posX: c.originPosX, posY: c.originPosY, toOwnerId: c.ownerId };
    }
    const spot = nextFreeSpot(c.ownerId);
    return { toZone: 'territory', posX: spot.posX, posY: spot.posY, toOwnerId: c.ownerId };
  };

  // Routes a single unattached card per the precedence above (token-delete
  // check runs against the COMPUTED destination, since a card can be both a
  // token and, say, an enhancement — what matters is where the rule that
  // fired actually sent it). Returns the routed {zone,pos,owner} for hosts to
  // report to their accessories in pass 2, or null when the card was deleted.
  const routeCard = (c: any): { zone: string; posX: string; posY: string; ownerId: bigint } | null => {
    const { toZone, posX, posY, toOwnerId } = computeDestination(c);
    if (c.isToken && ['deck', 'hand', 'discard', 'reserve', 'banish'].includes(toZone)) {
      deleteTokenWithCounters(ctx, c);
      return null;
    }
    const zoneIndex = nextIndexFor(toOwnerId, toZone);
    const isFlipped = toZone === 'land-of-bondage'
      ? false
      : (toZone === 'deck' || toZone === 'soul-deck') ? true : c.isFlipped;
    clearCountersIfLeavingPlay(ctx, c.id, 'battle', toZone);
    ctx.db.CardInstance.id.update({
      ...c,
      zone: toZone,
      zoneIndex,
      posX,
      posY,
      isFlipped,
      ownerId: toOwnerId,
      equippedToInstanceId: 0n,
      ...leavePlayFieldOverrides(c, 'battle', toZone),
    });
    return { zone: toZone, posX, posY, ownerId: toOwnerId };
  };

  const hosts = new Map<string, { zone: string; posX: string; posY: string; ownerId: bigint }>();

  for (const c of inBattle) {
    if (c.equippedToInstanceId !== 0n) continue; // pass 2 below
    const routed = routeCard(c);
    if (routed) hosts.set(c.id.toString(), routed);
  }

  // Pass 2: attached accessories follow their host's routed destination,
  // attachment preserved. Position inherits the host's only in Territory
  // (mirrors attach_card's `inheritPos`, ~4673) since that's the only
  // destination a host — always a character, rule 3 — can land in while
  // still carrying an attached accessory.
  for (const c of inBattle) {
    if (c.equippedToInstanceId === 0n) continue;
    const host = hosts.get(c.equippedToInstanceId.toString());
    if (!host) {
      // Defensive: a host is always a character, which rule 3 always routes
      // to Territory, so this should be unreachable. Never leave a card
      // stranded in the closed 'battle' zone though — route the orphaned
      // accessory itself (routeCard already clears equippedToInstanceId).
      routeCard(c);
      continue;
    }
    const destZone = host.zone;
    const zoneIndex = nextIndexFor(host.ownerId, destZone);
    clearCountersIfLeavingPlay(ctx, c.id, 'battle', destZone);
    ctx.db.CardInstance.id.update({
      ...c,
      zone: destZone,
      zoneIndex,
      posX: destZone === 'territory' ? host.posX : '',
      posY: destZone === 'territory' ? host.posY : '',
      ownerId: host.ownerId,
      ...leavePlayFieldOverrides(c, 'battle', destZone),
    });
  }

  logAction(
    ctx, gameId, actingPlayerId, 'BATTLE_END',
    JSON.stringify({ kept: keptNames }),
    game.turnNumber, game.currentPhase,
  );

  const g2 = ctx.db.Game.id.find(gameId);
  if (g2) {
    ctx.db.Game.id.update({ ...g2, battleState: '', battleAttackerSeat: '', lastBattlePlayBySeat: '' });
  }
}

// ---------------------------------------------------------------------------
// Reducer: end_battle
// Unconditional escape hatch (spec §7/§8): either player may close the
// battle band from either 'active' or 'awaiting-soul' (e.g. the defender
// reload_decks away every surrenderable soul, or the soul-picker
// disconnects mid-choice).
//
// Turn-player press also advances the phase (spec §7/§8): with phase-driven
// band visibility, leaving currentPhase alone would keep the band open
// (phase still 'battle') for a second battle. Only the turn player's press
// advances — the non-turn-player press stays an auto-return-only escape
// hatch so the turn player keeps their battle phase.
// ---------------------------------------------------------------------------
export const end_battle = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');
    if (game.battleState === '') throw new SenderError('No battle in progress');
    const player = findPlayerBySender(ctx, gameId); // either player; also blocks spectators
    assertTurnNotHeld(ctx, gameId);
    const isTurnPlayer = player.seat === game.currentTurn;
    const wasBattlePhase = game.currentPhase === 'battle';
    runBattleAutoReturn(ctx, gameId, player.id);

    if (isTurnPlayer && wasBattlePhase) {
      // Re-read: runBattleAutoReturn already wrote the Game row (clearing
      // battleState/battleAttackerSeat/lastBattlePlayBySeat) — spreading the
      // stale pre-return `game` snapshot here would resurrect battleState.
      // Same hazard end_turn/set_phase call out above.
      const latest = ctx.db.Game.id.find(gameId);
      if (latest) {
        // Phase Stops rev 4: the battle→discard advance is a movement to
        // discard — an armed discard gate halts it at the boundary
        // (currentPhase stays 'battle', band already closed via the
        // auto-return above) and prompts; a Deny/timeout enters discard.
        resumeMovement(ctx, gameId, player, 'discard');
      }
    }
  }
);

// ---------------------------------------------------------------------------
// Helper: writeBattleEntryMove
// Single-card write for a card entering the 'battle' zone (enter_battle).
// Deliberately NOT a call into move_card's monolithic branch: move_card's
// zone/pos/zoneIndex/ownership machinery is generic across every destination
// zone and entangled with lost-soul redirects, token cleanup, and Paragon
// rescue ownership transfers that never apply here (entering battle never
// changes ownership, and 'battle' is never a token-removal or lost-soul
// destination). Mirrors move_card's free-form zoneIndex assignment,
// leavePlayFieldOverrides spread, stampBattleEntry call, and its
// attached-accessory-follows-into-battle cascade — the minimal single-card
// write path the brief asks to reuse, without the surrounding routing
// subtleties.
// ---------------------------------------------------------------------------
function writeBattleEntryMove(ctx: any, gameId: bigint, card: any, posX: string, posY: string): string {
  const fromZone = card.zone;
  const alreadyInBattle = fromZone === 'battle';

  // Free-form zoneIndex: highest existing index for this owner's battle
  // cards + 1, same idiom move_card uses for territory (~2707-2717).
  let maxIdx = -1n;
  for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
    if (c.ownerId === card.ownerId && c.zone === 'battle' && c.zoneIndex > maxIdx) maxIdx = c.zoneIndex;
  }
  const finalZoneIndex = maxIdx + 1n;

  // Leaving deck/reserve/soul-deck reveals the card, matching move_card's
  // generic isFlipped rule; 'battle' is never a face-down destination itself.
  const isFlipped = (fromZone === 'deck' || fromZone === 'reserve' || fromZone === 'soul-deck') ? false : card.isFlipped;

  const battleEntryUpdates: any = {};
  stampBattleEntry(ctx, gameId, card, battleEntryUpdates); // no-op if already in battle
  clearCountersIfLeavingPlay(ctx, card.id, fromZone, 'battle');

  ctx.db.CardInstance.id.update({
    ...card,
    zone: 'battle',
    zoneIndex: finalZoneIndex,
    posX,
    posY,
    isFlipped,
    equippedToInstanceId: alreadyInBattle ? card.equippedToInstanceId : 0n,
    revealExpiresAt: undefined,
    revealStartedAt: undefined,
    ...leavePlayFieldOverrides(card, fromZone, 'battle'),
    ...battleEntryUpdates,
  });

  // Attached-accessory cascade (mirrors move_card's identical Battle-bound
  // cascade): any accessory pointing at this host follows it into 'battle'
  // with the attachment intact (spec §7 rule 1), instead of being unlinked
  // and stranded in the host's old zone. Skipped for the defensive
  // already-in-battle case (a reposition, not a real entry) so an
  // attach_card'd weapon already in the band isn't re-stamped. Snapshot
  // first — mutating while iterating a live query is unsafe per
  // spacetimedb/CLAUDE.md.
  if (!alreadyInBattle) {
    const accessories = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (a: any) => a.equippedToInstanceId === card.id,
    );
    for (const accessory of accessories) {
      const accessoryBattleUpdates: any = {};
      stampBattleEntry(ctx, gameId, accessory, accessoryBattleUpdates);
      let accMaxIdx = -1n;
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === accessory.ownerId && c.zone === 'battle' && c.zoneIndex > accMaxIdx) {
          accMaxIdx = c.zoneIndex;
        }
      }
      clearCountersIfLeavingPlay(ctx, accessory.id, accessory.zone, 'battle');
      ctx.db.CardInstance.id.update({
        ...accessory,
        zone: 'battle',
        zoneIndex: accMaxIdx + 1n,
        posX,
        posY,
        revealExpiresAt: undefined,
        revealStartedAt: undefined,
        ...leavePlayFieldOverrides(accessory, accessory.zone, 'battle'),
        ...accessoryBattleUpdates,
      });
    }
  }

  return fromZone;
}

// ---------------------------------------------------------------------------
// Reducer: enter_battle
// Atomic open+move (spec §4/§7): opens the battle band if it isn't already
// open (attacker = whoever's turn it is, NOT who dragged — a courtesy drag
// of your card during the opponent's turn doesn't make you the attacker),
// then performs the single-card move into 'battle' with stamping. Two
// players dragging into an empty band near-simultaneously both succeed:
// whichever call lands first opens the band, the second just moves its own
// card into the now-active band (spec §9 race note).
// ---------------------------------------------------------------------------
export const enter_battle = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    posX: t.string(),
    posY: t.string(),
  },
  (ctx, { gameId, cardInstanceId, posX, posY }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');
    // Courtesy drags of an opponent's card go through the ordinary move flow —
    // enter_battle only ever sends the caller's own cards into the band.
    if (card.ownerId !== player.id) throw new SenderError('You can only send your own cards into battle');

    if (game.battleState === 'awaiting-soul') {
      throw new SenderError('Battle is resolving a soul surrender');
    }
    // Phase Stops band-open gate (spec §5.5/R5): opening the band IS
    // entering the battle phase's gate. Turn-player open + opponent has an
    // armed battle stop + currentPhase index is STRICTLY LESS than battle's
    // (curIdx === battleIdx no longer qualifies — a stop set while already
    // in battle waits for next turn, spec §5.6; no retro-fire) → engage the
    // hold and return WITHOUT opening the band or moving the card. Reducers
    // are transactional (spacetimedb/CLAUDE.md) — an engage-then-throw would
    // roll back the hold along with everything else, so instead of throwing
    // we let the reducer return successfully having moved nothing; the
    // STOP_HOLD log entry (inside engageHold) is the record, and the
    // client's optimistic drag just snaps back like any other refused move.
    // Non-turn-player calls (blocking, joining) never trigger this — a
    // stopping player may still drag into an ALREADY-OPEN band even mid-hold
    // (that branch is untouched below).
    if (game.battleState === '' && player.seat === game.currentTurn && game.pregamePhase === '') {
      // Critical fix: any active hold — the one this drag would otherwise
      // engage below, OR a hold at an unrelated boundary — must block the
      // turn player from opening the band at all. Without this, a SECOND
      // drag (the gate already tripped, holdPhase !== '') falls through the
      // `stopRow.holdPhase === ''` check below and opens the band/moves the
      // card, committing the attack inside the very window the gate created.
      // Throwing here is safe: nothing has been written yet in this reducer.
      assertTurnNotHeld(ctx, gameId);

      const stopRow = ctx.db.TurnStop.gameId.find(gameId);
      if (stopRow && stopRow.holdPhase === '') {
        const stopsCsv = game.currentTurn === 0n ? stopRow.seat1Stops : stopRow.seat0Stops;
        const curIdx = (TURN_PHASES as readonly string[]).indexOf(game.currentPhase);
        const battleIdx = (TURN_PHASES as readonly string[]).indexOf('battle');
        if (curIdx < battleIdx && parseStops(stopsCsv).includes('battle')) {
          // Once the prompt is answered the gate is spent, so re-dragging
          // (or clicking Battle) goes through.
          engageHold(ctx, gameId, 'battle');
          return;
        }
      }
    }

    if (game.battleState === '') {
      ctx.db.Game.id.update({
        ...game,
        battleState: 'active',
        battleAttackerSeat: game.currentTurn.toString(),
        lastBattlePlayBySeat: '',
      });
    }
    // battleState === 'active': band already open — just move+stamp below.

    const fromZone = writeBattleEntryMove(ctx, gameId, card, posX, posY);

    logAction(
      ctx, gameId, player.id, 'ENTER_BATTLE',
      JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: card.cardName, cardImgFile: card.cardImgFile, from: fromZone }),
      game.turnNumber, game.currentPhase,
    );
  },
);

// ---------------------------------------------------------------------------
// Helper: isLostSoulRow
// Same three-part check used elsewhere (surrender_lost_soul, rescue_lost_soul,
// runBattleAutoReturn's local isLostSoulCard) — shared here between
// resolve_battle and surrender_soul, which both need to identify Lost Souls
// sitting in a battle's stakes LoB.
// ---------------------------------------------------------------------------
function isLostSoulRow(c: any): boolean {
  return c.cardType === 'LS' || c.cardType === 'TOKEN_LS' || c.cardName.toLowerCase().includes('lost soul');
}

// Rescue-win detection. A player wins by rescuing their Nth Redeemed Soul into
// land-of-redemption (5 for T1/Paragon, 7 for T2). Rescued captured characters
// count 1 alongside Lost Souls (redeemedSoulValue — the same rule every client
// badge/score uses). Called after any movement of a soul into LoR (the
// moveLostSoulToLor primitive + the move_card / move_cards_batch drag paths).
// Idempotent: fires only while the game is still playing, and re-reads the
// Game row because callers may hold a stale snapshot.
function checkAndApplyWin(ctx: any, gameId: bigint) {
  const game = ctx.db.Game.id.find(gameId);
  if (!game || game.status !== 'playing') return;
  const goal = normalizeFormat(game.format) === 'T2' ? 7 : 5;
  const rows = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];
  for (const player of ctx.db.Player.player_game_id.filter(gameId)) {
    let count = 0;
    for (const c of rows) {
      if (c.ownerId === player.id && c.zone === 'land-of-redemption') count += redeemedSoulValue(c);
    }
    if (count >= goal) {
      ctx.db.Game.id.update({ ...game, status: 'finished' });
      logAction(
        ctx, gameId, player.id, 'WIN',
        JSON.stringify({ winnerName: player.displayName, soulCount: count, format: normalizeFormat(game.format) }),
        game.turnNumber, game.currentPhase,
      );
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Helper: battleStakesLobLostSouls
// The Lost Souls "at stake" for the battle currently in progress: the
// defender's (non-attacker-seat player's) Land of Bondage for T1/T2, or the
// shared Paragon Land of Bondage (ownerId 0n) for Paragon. Used by both
// resolve_battle (to decide active -> awaiting-soul vs. auto-return) and
// surrender_soul (to validate the chosen card is actually at stake).
// ---------------------------------------------------------------------------
function battleStakesLobLostSouls(ctx: any, gameId: bigint, format: 'T1' | 'T2' | 'Paragon', attackerSeat: string): any[] {
  const all = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];
  if (format === 'Paragon') {
    return all.filter((c: any) => c.ownerId === 0n && c.zone === 'land-of-bondage' && isLostSoulRow(c));
  }
  const defender = [...ctx.db.Player.player_game_id.filter(gameId)].find(
    (p: any) => p.seat.toString() !== attackerSeat,
  );
  if (!defender) return [];
  return all.filter((c: any) => c.ownerId === defender.id && c.zone === 'land-of-bondage' && isLostSoulRow(c));
}

// ---------------------------------------------------------------------------
// Reducer: resolve_battle
// Either combatant may resolve (Claim Victory / Battle Lost hit this same
// logic — with exactly two seats, "caller is the attacker" and "caller is
// the other seat" together cover every player, so no extra permission guard
// is needed beyond findPlayerBySender already excluding spectators). Paragon
// refills the shared LoB first so a transient-empty LoB (the last soul was
// just rescued) can't misclassify a live rescue as a challenge with nothing
// at stake. >=1 Lost Soul in the stakes LoB -> awaiting-soul; otherwise the
// battle auto-returns immediately (spec §7: "Unopposed rescues resolve HERE,
// not via end_battle").
// ---------------------------------------------------------------------------
export const resolve_battle = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    const player = findPlayerBySender(ctx, gameId);
    assertTurnNotHeld(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');
    if (game.battleState !== 'active') throw new SenderError('No battle in progress');

    const format = normalizeFormat(game.format);
    if (format === 'Paragon') {
      refillSoulDeck(ctx, gameId);
    }

    const stakesLostSouls = battleStakesLobLostSouls(ctx, gameId, format, game.battleAttackerSeat);

    logAction(
      ctx, gameId, player.id, 'RESOLVE_BATTLE',
      JSON.stringify({
        callerSeat: player.seat.toString(),
        attackerSeat: game.battleAttackerSeat,
        lostSoulsAtStake: stakesLostSouls.length,
      }),
      game.turnNumber, game.currentPhase,
    );

    if (stakesLostSouls.length > 0) {
      ctx.db.Game.id.update({ ...game, battleState: 'awaiting-soul' });
    } else {
      runBattleAutoReturn(ctx, gameId, player.id);
    }
  },
);

// ---------------------------------------------------------------------------
// Reducer: surrender_soul
// Chooser permission by format (spec §7): T1 the defender picks which of
// their own souls to give up; T2/Paragon the attacker picks which soul to
// take. Transfers via the existing moveLostSoulToLor primitive, always
// targeting the attacker's Land of Redemption regardless of caller. Every
// format awards exactly one soul per battle, so the band always auto-returns
// and closes in this same reducer (never rely on a second client call — a
// disconnect between calls would strand the state).
// ---------------------------------------------------------------------------
export const surrender_soul = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);
    assertTurnNotHeld(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');
    if (game.battleState !== 'awaiting-soul') throw new SenderError('No soul surrender is pending');

    const format = normalizeFormat(game.format);
    const callerIsAttacker = player.seat.toString() === game.battleAttackerSeat;
    if (format === 'T1' && callerIsAttacker) {
      throw new SenderError('Only the defender chooses which soul to surrender');
    }
    if (format !== 'T1' && !callerIsAttacker) {
      throw new SenderError('Only the attacker chooses which soul to surrender');
    }

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');
    if (!isLostSoulRow(card)) throw new SenderError('Card is not a Lost Soul');

    const stakesLostSouls = battleStakesLobLostSouls(ctx, gameId, format, game.battleAttackerSeat);
    if (!stakesLostSouls.some((c: any) => c.id === card.id)) {
      throw new SenderError('Card is not an eligible soul for this battle');
    }

    const attacker = [...ctx.db.Player.player_game_id.filter(gameId)].find(
      (p: any) => p.seat.toString() === game.battleAttackerSeat,
    );
    if (!attacker) throw new SenderError('Attacker not found');

    const fromOwnerId = card.ownerId;
    moveLostSoulToLor(ctx, gameId, card, attacker.id, game);

    logAction(
      ctx, gameId, player.id, 'SURRENDER_SOUL',
      JSON.stringify({
        cardInstanceId: cardInstanceId.toString(),
        cardName: card.cardName,
        cardImgFile: card.cardImgFile,
        fromOwnerId: fromOwnerId.toString(),
        targetOwnerId: attacker.id.toString(),
      }),
      game.turnNumber, game.currentPhase,
    );

    // Every format awards exactly one soul: the band closes in this same
    // reducer.
    runBattleAutoReturn(ctx, gameId, player.id);

    // The surrender is the battle's natural conclusion — both players
    // already consented via the resolve/surrender flow, so the phase
    // advances unconditionally on the caller (unlike end_battle's
    // turn-player-only escape-hatch gate). Re-read: runBattleAutoReturn
    // already wrote the Game row (clearing battleState/battleAttackerSeat/
    // lastBattlePlayBySeat) — spreading the stale pre-return `game` snapshot
    // here would resurrect battleState. Same idiom as end_battle above.
    const latestGame = ctx.db.Game.id.find(gameId);
    if (latestGame && latestGame.currentPhase === 'battle') {
      if (latestGame.status === 'playing') {
        // Phase Stops rev 4: same movement-to-discard as end_battle — an
        // armed discard gate halts at the boundary (band already closed
        // above) and prompts; a Deny/timeout enters discard.
        resumeMovement(ctx, gameId, player, 'discard');
      } else {
        // A winning 5th-soul rescue (moveLostSoulToLor -> checkAndApplyWin,
        // above) already flipped status to 'finished' — never engage a hold
        // on a game that just ended; write discard directly for consistent
        // phase bookkeeping.
        ctx.db.Game.id.update({ ...latestGame, currentPhase: 'discard' });
        logAction(ctx, gameId, player.id, 'SET_PHASE', JSON.stringify({ phase: 'discard' }), latestGame.turnNumber, 'discard');
      }
    }
  },
);

// ===========================================================================
// Card action reducers
// ===========================================================================

// ---------------------------------------------------------------------------
// Reducer: draw_card
// ---------------------------------------------------------------------------
export const draw_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    drawCardsForPlayer(ctx, game, player, 1);

    logAction(ctx, gameId, player.id, 'DRAW', '', game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: draw_multiple
// ---------------------------------------------------------------------------
export const draw_multiple = spacetimedb.reducer(
  {
    gameId: t.u64(),
    count: t.u64(),
  },
  (ctx, { gameId, count }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const result = drawCardsForPlayer(ctx, game, player, Number(count));

    // If every card was an auto-routed Lost Soul, the per-card MOVE_CARD logs
    // already tell the story — skip the redundant "drew 0 cards" entry.
    if (result.drawn > 0) {
      logAction(ctx, gameId, player.id, 'DRAW_MULTIPLE', JSON.stringify({ count: result.drawn.toString(), cards: result.cards }), game.turnNumber, game.currentPhase);
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: matthew_draw_brigades
// Matthew the Publican custom ability — draws cards equal to the number of
// distinct brigades in the opponent's revealed hand. Brigade count is
// computed client-side from opponent.handRevealSnapshot and passed in.
// Server validates source ownership/zone, opponent.handRevealed, and caps
// the count to prevent abuse. Redemption has at most 12 brigades.
// ---------------------------------------------------------------------------
export const matthew_draw_brigades = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    brigadeCount: t.u64(),
  },
  (ctx, { gameId, cardInstanceId, brigadeCount }) => {
    const player = findPlayerBySender(ctx, gameId);
    const source = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!source) throw new SenderError('Card not found');
    if (source.gameId !== gameId) throw new SenderError('Card not in this game');
    // Ownership intentionally not enforced — either player may activate a
    // card's right-click ability; effects route to the activator (player).
    if (!ABILITY_SOURCE_ZONES.includes(source.zone)) {
      throw new SenderError('Source card must be in play');
    }

    const opponent = [...ctx.db.Player.player_game_id.filter(gameId)].find(
      (p: any) => p.id !== player.id,
    );
    if (!opponent) throw new SenderError('Opponent not found');
    if (!opponent.handRevealed) {
      throw new SenderError("Opponent's hand is not revealed");
    }

    const count = Math.max(0, Math.min(Number(brigadeCount), 12));
    if (count === 0) return;

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const result = drawCardsForPlayer(ctx, game, player, count);

    logAction(
      ctx,
      gameId,
      player.id,
      'MATTHEW_DRAW_BRIGADES',
      JSON.stringify({
        sourceCardName: source.cardName,
        sourceCardImgFile: source.cardImgFile,
        brigadeCount: count.toString(),
        cards: result.cards,
      }),
      game.turnNumber,
      game.currentPhase,
    );
  },
);

// ---------------------------------------------------------------------------
// Reducer: move_card
// ---------------------------------------------------------------------------
export const move_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    toZone: t.string(),
    zoneIndex: t.string(),
    posX: t.string(),
    posY: t.string(),
    targetOwnerId: t.string(),
  },
  (ctx, { gameId, cardInstanceId, toZone, zoneIndex, posX, posY, targetOwnerId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    // Allow moves by either player (cards move between zones during battles/captures)
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const fromZone = card.zone;
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    // Battle is a closed band: an entry only completes while combat is
    // actually active. Redirect to Territory (mirroring the lost-soul
    // redirect below) instead of creating an invisible card when a
    // stale/replayed move targets 'battle' after the band already closed.
    // Spec §7.
    if (toZone === 'battle' && game.battleState !== 'active') {
      toZone = 'territory';
    }

    // Materialize the game's CardInstance rows once. Reused for the various
    // zoneIndex / accessory / hand-count lookups below instead of issuing a
    // fresh `[...filter(gameId)]` per branch. The compact helpers also accept
    // this snapshot via `gameCardsHint`. Snapshot is taken pre-mutation, so
    // any helper that runs after the main update must pass `excludeId` so the
    // moved card's stale (pre-move) zone is ignored.
    const gameCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];

    // Tokens dropped into non-play zones are deleted, not moved.
    // Parallels the goldfish cleanup rule at gameReducer.ts:92. Runs BEFORE the
    // lost-soul redirect so tokens always delete (never redirect to LOB) even if
    // they happen to be lost-soul-typed.
    const TOKEN_REMOVE_ZONES = ['reserve', 'banish', 'discard', 'hand', 'deck'];
    if (card.isToken && TOKEN_REMOVE_ZONES.includes(toZone)) {
      for (const counter of [...ctx.db.CardCounter.card_counter_card_instance_id.filter(cardInstanceId)]) {
        ctx.db.CardCounter.id.delete(counter.id);
      }
      ctx.db.CardInstance.id.delete(cardInstanceId);
      if (fromZone === 'hand') compactHandIndices(ctx, gameId, card.ownerId, gameCards, cardInstanceId);
      if (fromZone === 'land-of-bondage') compactLobIndices(ctx, gameId, card.ownerId, gameCards, cardInstanceId);
      logAction(
        ctx, gameId, player.id, 'MOVE_CARD',
        JSON.stringify({
          cardInstanceId: cardInstanceId.toString(),
          from: fromZone,
          to: toZone,
          cardName: card.cardName,
          cardImgFile: card.cardImgFile,
          tokenCleanup: true,
        }),
        game.turnNumber, game.currentPhase,
      );
      return;
    }

    // Destination ownership — see cardOwnership.ts for the full rule set. In
    // short: graveyard piles always belong to the card's true owner, other home
    // zones route home (with an explicit drop on the other seat honored), and
    // shared table zones keep the current owner.
    const ownerRouting: OwnerRouting = {
      ownerId: card.ownerId,
      originalOwnerId: card.originalOwnerId,
      fromZone,
      toZone,
      actorId: player.id,
      targetOwnerId: targetOwnerId ? BigInt(targetOwnerId) : null,
    };

    // Lost souls sent to discard or reserve go to land-of-bondage instead
    const isLostSoul = card.cardType === 'LS' || card.cardName.toLowerCase().includes('lost soul');
    if (isLostSoul && (toZone === 'discard' || toZone === 'reserve' || toZone === 'banish')) {
      // Lost Souls inherently belong to their deck — they always go to the
      // deck owner's LoB, even when an opponent's effect drives them out of
      // a hidden zone (e.g. reserving the opponent's top deck card and
      // revealing a lost soul). The "taking opponent's card" home-routing
      // rule does not apply: a Lost Soul is never actually taken.
      const lobOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;
      const lobIndex = BigInt(
        gameCards.filter(
          (c: any) => c.ownerId === lobOwnerId && c.zone === 'land-of-bondage'
        ).length
      );
      clearCountersIfLeavingPlay(ctx, card.id, fromZone, 'land-of-bondage');
      ctx.db.CardInstance.id.update({
        ...card,
        zone: 'land-of-bondage',
        zoneIndex: lobIndex,
        posX: '',
        posY: '',
        isFlipped: false,
        ownerId: lobOwnerId,
        ...leavePlayFieldOverrides(card, fromZone, 'land-of-bondage'),
      });
      const actionWord = toZone === 'discard' ? 'discarded' : toZone === 'reserve' ? 'reserved' : 'banished';
      const redirectLogName = card.cardName;
      const redirectLogImg = card.cardImgFile;
      logAction(ctx, gameId, player.id, 'MOVE_CARD', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), from: fromZone, to: 'land-of-bondage', cardName: redirectLogName, cardImgFile: redirectLogImg, redirected: actionWord }), game.turnNumber, game.currentPhase);
      // Compact hand indices if card left hand
      if (fromZone === 'hand') {
        compactHandIndices(ctx, gameId, card.ownerId, gameCards, cardInstanceId);
      }
      // Compact LOB indices if card left LOB
      if (fromZone === 'land-of-bondage') {
        compactLobIndices(ctx, gameId, card.ownerId, gameCards, cardInstanceId);
      }
      return;
    }

    // Moving to deck/soul-deck = face-down; leaving deck, reserve, or soul-deck = face-up; otherwise preserve
    const isFlipped = (toZone === 'deck' || toZone === 'soul-deck') ? true : (fromZone === 'deck' || fromZone === 'reserve' || fromZone === 'soul-deck') ? false : card.isFlipped;
    // Optionally transfer ownership (e.g. rescue lost soul, capture hero).
    let newOwnerId: bigint = resolveDestinationOwnerId(ownerRouting);
    // Paragon: dropping a soul-origin card back into the shared LoB resets ownership to the shared sentinel.
    if (
      targetOwnerId === '0' &&
      card.isSoulDeckOrigin === true &&
      toZone === 'land-of-bondage'
    ) {
      newOwnerId = 0n;
    }

    // Paragon: rescuing a shared soul transfers ownership. Default to the
    // acting seat (self-rescue), but honor an explicit targetOwnerId when the
    // caller dragged the soul into a specific player's zone (e.g. opponent's
    // LoR or opponent's Territory).
    let resolvedOwnerId = newOwnerId;
    if (
      card.ownerId === 0n &&
      card.isSoulDeckOrigin === true &&
      card.zone === 'land-of-bondage' &&
      toZone !== 'land-of-bondage' &&
      toZone !== 'soul-deck' &&
      !targetOwnerId
    ) {
      resolvedOwnerId = player.id;
    }

    // For free-form zones (territory), auto-assign highest zoneIndex so new cards render on top
    let finalZoneIndex = zoneIndex ? BigInt(zoneIndex) : 0n;
    if (!zoneIndex && toZone !== 'deck' && toZone !== 'hand') {
      let maxIdx = -1n;
      for (const c of gameCards) {
        if (c.ownerId === (newOwnerId) && c.zone === toZone && c.zoneIndex > maxIdx) {
          maxIdx = c.zoneIndex;
        }
      }
      finalZoneIndex = maxIdx + 1n;
    }

    // Paragon shared LoB: zoneIndexes are slot-preserving (gaps stay open so
    // remaining souls don't shift when one is rescued). Override the simple
    // maxIdx+1 assignment above to find the first empty slot in [0..2] first,
    // only falling back to maxIdx+1 when the canonical slots are all occupied.
    if (!zoneIndex && toZone === 'land-of-bondage' && newOwnerId === 0n) {
      const sharedLob = gameCards.filter(
        (c: any) => c.ownerId === 0n && c.zone === 'land-of-bondage' && c.id !== cardInstanceId
      );
      const occupied = new Set<bigint>(sharedLob.map((c: any) => c.zoneIndex));
      let chosen: bigint | null = null;
      for (let i = 0n; i < 3n; i++) {
        if (!occupied.has(i)) { chosen = i; break; }
      }
      if (chosen === null) {
        let maxIdx = -1n;
        for (const c of sharedLob) {
          if (c.zoneIndex > maxIdx) maxIdx = c.zoneIndex;
        }
        chosen = maxIdx + 1n;
      }
      finalZoneIndex = chosen;
    }
    if (!zoneIndex && toZone === 'hand') {
      finalZoneIndex = BigInt(
        gameCards.filter(
          (c: any) => c.ownerId === newOwnerId && c.zone === 'hand'
        ).length
      );
    }

    // Paragon: inserting into the soul deck at a specific index shifts the
    // existing shared soul-deck cards at that index and above up by 1 — same
    // semantics as move_card_to_top_of_deck. Without this, a "topdeck" would
    // duplicate index 0 and a later "draw top" would pull an arbitrary card.
    if (toZone === 'soul-deck' && zoneIndex) {
      const insertIdx = BigInt(zoneIndex);
      const soulDeckCards = gameCards.filter(
        (c: any) => c.ownerId === 0n && c.zone === 'soul-deck' && c.id !== cardInstanceId
      );
      for (const sc of soulDeckCards) {
        if (sc.zoneIndex >= insertIdx) {
          ctx.db.CardInstance.id.update({ ...sc, zoneIndex: sc.zoneIndex + 1n });
        }
      }
    }

    // Auto-unlink cascade: when the mover leaves its current zone, clear its
    // own equippedTo and cascade to any accessories pointing at it.
    //
    // Redemption rule: a warrior going from Territory to LOB drags its weapons
    // to Discard. All other host-leaves-zone cases (soul rescued from LOB,
    // same-zone reposition, etc.) just unlink accessories in place.
    const leavingZone = toZone !== fromZone || resolvedOwnerId !== card.ownerId;
    const clearEquippedOnMover = leavingZone && card.equippedToInstanceId !== 0n;

    // Cards landing in a hand via an identity-revealing move (cross-player
    // takes, face-up tutors, etc.) flash face-up briefly. Mirrors the same
    // hideIdentity rule used for the log below so the visual reveal matches
    // the log entry.
    const isCrossPlayerMove = player.id !== card.ownerId || player.id !== newOwnerId;
    const hideIdentity = !isCrossPlayerMove && (isFlipped ||
      (fromZone === 'hand' && (toZone === 'deck' || toZone === 'reserve') && player.id === card.ownerId));
    const autoReveal = toZone === 'hand' && fromZone !== 'hand' && !hideIdentity;
    const newRevealExpiresAt = autoReveal
      ? new Timestamp(ctx.timestamp.microsSinceUnixEpoch + AUTO_REVEAL_HAND_MICROS)
      : undefined;
    const newRevealStartedAt = autoReveal ? ctx.timestamp : undefined;

    const battleEntryUpdates: any = {};
    if (toZone === 'battle') {
      stampBattleEntry(ctx, gameId, card, battleEntryUpdates);
    }
    clearCountersIfLeavingPlay(ctx, card.id, fromZone, toZone);
    ctx.db.CardInstance.id.update({
      ...card,
      zone: toZone,
      zoneIndex: finalZoneIndex,
      posX,
      posY,
      isFlipped,
      ownerId: resolvedOwnerId,
      equippedToInstanceId: clearEquippedOnMover ? 0n : card.equippedToInstanceId,
      revealExpiresAt: newRevealExpiresAt,
      revealStartedAt: newRevealStartedAt,
      ...leavePlayFieldOverrides(card, fromZone, toZone),
      ...battleEntryUpdates,
    });

    if (leavingZone) {
      const sendAccessoriesToDiscard =
        fromZone === 'territory' && toZone === 'land-of-bondage';
      // Host entering Battle — the attached accessory follows it into the
      // band with the attachment intact (spec §7 rule 1), instead of being
      // unlinked and stranded behind in its old zone. Mirrors writeBattleEntryMove's
      // identical cascade for the enter_battle path.
      const sendAccessoriesToBattle = toZone === 'battle';
      // Host retreating from Battle back to Territory — the attached
      // accessory follows it out with the attachment intact, mirroring the
      // entry cascade above. Without this the weapon fell into the generic
      // unlink-in-place else-branch below, stranding it (unattached) in the
      // closed band, where it would get discarded at the next End Battle.
      const sendAccessoriesOutOfBattle = fromZone === 'battle' && toZone === 'territory';
      const attachedAccessories = gameCards.filter(
        (c: any) => c.equippedToInstanceId === cardInstanceId
      );
      for (const accessory of attachedAccessories) {
        if (sendAccessoriesToDiscard) {
          // Warrior dragged to LOB — weapons go to Discard.
          let maxDiscardIdx = -1n;
          for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
            if (c.ownerId === accessory.ownerId && c.zone === 'discard' && c.zoneIndex > maxDiscardIdx) {
              maxDiscardIdx = c.zoneIndex;
            }
          }
          clearCountersIfLeavingPlay(ctx, accessory.id, accessory.zone, 'discard');
          ctx.db.CardInstance.id.update({
            ...accessory,
            zone: 'discard',
            zoneIndex: maxDiscardIdx + 1n,
            posX: '',
            posY: '',
            equippedToInstanceId: 0n,
            revealExpiresAt: undefined,
      revealStartedAt: undefined,
            ...leavePlayFieldOverrides(accessory, accessory.zone, 'discard'),
          });
        } else if (sendAccessoriesToBattle) {
          const accessoryBattleUpdates: any = {};
          stampBattleEntry(ctx, gameId, accessory, accessoryBattleUpdates);
          let accMaxIdx = -1n;
          for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
            if (c.ownerId === accessory.ownerId && c.zone === 'battle' && c.zoneIndex > accMaxIdx) {
              accMaxIdx = c.zoneIndex;
            }
          }
          clearCountersIfLeavingPlay(ctx, accessory.id, accessory.zone, 'battle');
          ctx.db.CardInstance.id.update({
            ...accessory,
            zone: 'battle',
            zoneIndex: accMaxIdx + 1n,
            posX,
            posY,
            revealExpiresAt: undefined,
            revealStartedAt: undefined,
            ...leavePlayFieldOverrides(accessory, accessory.zone, 'battle'),
            ...accessoryBattleUpdates,
          });
        } else if (sendAccessoriesOutOfBattle) {
          let terrMaxIdx = -1n;
          for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
            if (c.ownerId === accessory.ownerId && c.zone === 'territory' && c.zoneIndex > terrMaxIdx) {
              terrMaxIdx = c.zoneIndex;
            }
          }
          clearCountersIfLeavingPlay(ctx, accessory.id, accessory.zone, 'territory');
          ctx.db.CardInstance.id.update({
            ...accessory,
            zone: 'territory',
            zoneIndex: terrMaxIdx + 1n,
            posX,
            posY,
            revealExpiresAt: undefined,
            revealStartedAt: undefined,
            ...leavePlayFieldOverrides(accessory, accessory.zone, 'territory'),
          });
        } else {
          ctx.db.CardInstance.id.update({ ...accessory, equippedToInstanceId: 0n });
        }
      }
    }

    // Log when the card changes zones OR changes ownership (e.g. territory → opponent's territory)
    const ownerChanged = newOwnerId !== card.ownerId;
    if (fromZone !== toZone || ownerChanged) {
      // hideIdentity (computed above) decides whether the log reveals the
      // card name. Same flag drives the auto-reveal in hand.
      const logName = hideIdentity ? 'a face-down card' : card.cardName;
      const logImg = hideIdentity ? '' : card.cardImgFile;
      logAction(ctx, gameId, player.id, 'MOVE_CARD', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), from: fromZone, to: toZone, cardName: logName, cardImgFile: logImg, targetOwnerId: resolvedOwnerId.toString() }), game.turnNumber, game.currentPhase);
      // Compact hand indices if card left hand
      if (fromZone === 'hand') {
        compactHandIndices(ctx, gameId, card.ownerId, gameCards, cardInstanceId);
      }
      // Compact LOB indices if card left LOB
      if (fromZone === 'land-of-bondage') {
        compactLobIndices(ctx, gameId, card.ownerId, gameCards, cardInstanceId);
      }
    }

    // Paragon: refill the shared LoB only when a soul-origin card is rescued
    // into a land-of-redemption. Drag-back, soul-deck round-trips, and other
    // destinations leave the LoB short and do not refill.
    const triggeredRefill =
      normalizeFormat(game.format) === 'Paragon' &&
      card.isSoulDeckOrigin === true &&
      card.zone === 'land-of-bondage' &&
      toZone === 'land-of-redemption';
    if (triggeredRefill) {
      refillSoulDeck(ctx, game.id);
    }

    // Rescue win: a soul dragged into land-of-redemption may complete the goal.
    if (toZone === 'land-of-redemption') {
      checkAndApplyWin(ctx, gameId);
    }
  }
);

// ---------------------------------------------------------------------------
// Helper: deleteTokenWithCounters
// A token can never live in a deck. Any action that would send a token to the
// deck (topdeck / underdeck / shuffle-into-deck, single or group) deletes it
// from the game instead — mirroring the move_card drag-to-deck cleanup
// (TOKEN_REMOVE_ZONES) and the goldfish rule at gameReducer.ts:791/808.
// Removes the token's counters first, then the CardInstance itself. Callers
// handle source-pile compaction (hand / land-of-bondage) as needed.
// ---------------------------------------------------------------------------
function deleteTokenWithCounters(ctx: any, card: any): void {
  for (const counter of [...ctx.db.CardCounter.card_counter_card_instance_id.filter(card.id)]) {
    ctx.db.CardCounter.id.delete(counter.id);
  }
  ctx.db.CardInstance.id.delete(card.id);
}

// ---------------------------------------------------------------------------
// Reducer: move_cards_batch
// ---------------------------------------------------------------------------
export const move_cards_batch = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceIds: t.string(),
    toZone: t.string(),
    positions: t.string(),
    targetOwnerId: t.string(),
    fromSource: t.string(),
  },
  (ctx, { gameId, cardInstanceIds, toZone, positions, targetOwnerId, fromSource }) => {
    const player = findPlayerBySender(ctx, gameId);

    const ids: string[] = JSON.parse(cardInstanceIds);
    const posMap: Record<string, { posX: string; posY: string }> = positions ? JSON.parse(positions) : {};
    const newOwnerId = targetOwnerId ? BigInt(targetOwnerId) : null;
    const batchIdSet = new Set(ids.map((s) => BigInt(s)));
    const cards: { name: string; img: string }[] = [];
    const movedCards: { name: string; img: string; from: string }[] = [];
    const redirectedLostSouls: { name: string; img: string }[] = [];
    // If cards being moved belong to someone other than the actor (e.g. the
    // requester is acting on the opponent's deck through an approved request),
    // record that owner so the log can say "from X's deck" instead of just
    // "from top of deck".
    let sourceOwnerId: bigint | null = null;
    const handCompactOwners = new Set<bigint>(); // Track owners whose hand needs compaction
    const lobCompactOwners = new Set<bigint>(); // Track owners whose LOB needs compaction
    // Paragon: track whether any card in this batch was a soul-origin card
    // rescued from the shared LoB into a land-of-redemption. Only those rescues
    // trigger a soul-deck refill.
    let anyRescueToLor = false;

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    // Battle is a closed band — see move_card's identical redirect. One
    // toZone is shared by the whole batch, so this redirects every card in
    // the request at once. Spec §7.
    if (toZone === 'battle' && game.battleState !== 'active') {
      toZone = 'territory';
    }

    // When drawing from the acting player's own deck into hand, we need to
    // replicate the top-of-deck auto-route behavior: a drawn Lost Soul (with
    // autoRouteLostSouls on) is redirected to Land of Bondage and a replacement
    // is pulled from the same end of the deck. `needsReplacementSupport` gates
    // the extra bookkeeping below.
    const needsReplacementSupport =
      toZone === 'hand' &&
      (fromSource === 'top-of-deck' || fromSource === 'bottom-of-deck' || fromSource === 'random-from-deck');
    let replacementDeckPool: any[] = [];
    const usedReplacementIds = new Set<bigint>(ids.map((s) => BigInt(s)));
    if (needsReplacementSupport) {
      replacementDeckPool = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)]
        .filter((c: any) => c.ownerId === player.id && c.zone === 'deck')
        .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
    }
    const pickReplacementId = (): string | null => {
      if (!needsReplacementSupport) return null;
      // Bottom-of-deck walks from the highest zoneIndex down; top-of-deck and
      // random (best-effort) walk from the lowest. All three skip cards already
      // consumed by the batch or by earlier replacements.
      if (fromSource === 'bottom-of-deck') {
        for (let i = replacementDeckPool.length - 1; i >= 0; i--) {
          const candidate = replacementDeckPool[i];
          if (!usedReplacementIds.has(candidate.id)) {
            usedReplacementIds.add(candidate.id);
            return candidate.id.toString();
          }
        }
      } else {
        for (let i = 0; i < replacementDeckPool.length; i++) {
          const candidate = replacementDeckPool[i];
          if (!usedReplacementIds.has(candidate.id)) {
            usedReplacementIds.add(candidate.id);
            return candidate.id.toString();
          }
        }
      }
      return null;
    };

    // Accessory cascade pre-pass: redirect accessories-whose-host-is-in-the-batch
    // to Discard only for the warrior→LOB case (host in Territory, batch going
    // to LOB). All other cross-zone scenarios let the accessory travel with
    // the batch (or unlink in place, handled below).
    //
    // We also capture each mover's original zone here so the post-pass cascade
    // can distinguish "actually left zone" from "same-zone reposition".
    const finalZoneById = new Map<string, string>();
    const originalZoneById = new Map<string, string>();
    const originalOwnerById = new Map<string, bigint>();
    for (const idStr of ids) {
      const c = ctx.db.CardInstance.id.find(BigInt(idStr));
      if (!c) continue;
      originalZoneById.set(idStr, c.zone);
      originalOwnerById.set(idStr, c.ownerId);
      const redirected =
        c.zone === 'territory' &&
        toZone === 'land-of-bondage' &&
        c.equippedToInstanceId !== 0n &&
        batchIdSet.has(c.equippedToInstanceId);
      finalZoneById.set(idStr, redirected ? 'discard' : toZone);
    }

    // For free-form zones (territory), pre-compute the current max zoneIndex
    // so new cards render on top of existing ones. Each card in the batch
    // gets an incrementing index starting from maxIdx + 1.
    const isFreeFormTarget = toZone !== 'deck' && toZone !== 'hand';
    // Auto-fan counter: when cards are dropped into territory without explicit
    // positions (e.g. batch moves from search/browse modals), stagger them so
    // they don't pile on top of each other at the zone origin.
    let autoFanIndex = 0;
    let nextFreeFormIndex = 0n;
    if (isFreeFormTarget) {
      let maxIdx = -1n;
      // Determine the owner we'll compute max against (use first card's resolved owner)
      let resolvedOwner = newOwnerId;
      if (resolvedOwner === null) {
        const firstCard = ctx.db.CardInstance.id.find(BigInt(ids[0]));
        resolvedOwner = firstCard ? firstCard.ownerId : 0n;
      }
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === resolvedOwner && c.zone === toZone && c.zoneIndex > maxIdx) {
          maxIdx = c.zoneIndex;
        }
      }
      nextFreeFormIndex = maxIdx + 1n;
    }

    for (const idStr of ids) {
      const cardId = BigInt(idStr);
      const card = ctx.db.CardInstance.id.find(cardId);
      if (!card) throw new SenderError('Card not found: ' + idStr);
      // Allow moves by either player in the game (cards move between zones during battles)
      if (card.gameId !== gameId) throw new SenderError('Card not in this game: ' + idStr);

      // Moving to deck/soul-deck = face-down; leaving deck, reserve, or soul-deck = face-up; otherwise preserve
      const isFlipped = (toZone === 'deck' || toZone === 'soul-deck') ? true : (card.zone === 'deck' || card.zone === 'reserve' || card.zone === 'soul-deck') ? false : card.isFlipped;

      // Hide card identity only when the owner moves their own hand card to a
      // hidden zone. Cross-player moves (sender ≠ source owner or sender ≠
      // destination owner) reveal the card — both players witness the move
      // on-screen, so the log should match.
      const cardNewOwnerId = newOwnerId ?? card.ownerId;
      const isCrossPlayerMove = player.id !== card.ownerId || player.id !== cardNewOwnerId;
      const hideIdentity = !isCrossPlayerMove && (isFlipped ||
        (card.zone === 'hand' && (toZone === 'deck' || toZone === 'reserve') && player.id === card.ownerId));
      const logName = hideIdentity ? 'a face-down card' : card.cardName;
      const logImg = hideIdentity ? '' : card.cardImgFile;
      cards.push({ name: logName, img: logImg });
      if (sourceOwnerId === null && card.ownerId !== player.id) {
        sourceOwnerId = card.ownerId;
      }
      const cardOwnerChanged = newOwnerId !== null && newOwnerId !== card.ownerId;
      if (card.zone !== toZone || cardOwnerChanged) {
        movedCards.push({ name: logName, img: logImg, from: card.zone });
        if (card.zone === 'hand') {
          handCompactOwners.add(card.ownerId);
        }
        if (card.zone === 'land-of-bondage') {
          lobCompactOwners.add(card.ownerId);
        }
      }

      // Destination ownership — shared with move_card, see cardOwnership.ts.
      const ownerRouting: OwnerRouting = {
        ownerId: card.ownerId,
        originalOwnerId: card.originalOwnerId,
        fromZone: card.zone,
        toZone,
        actorId: player.id,
        targetOwnerId: newOwnerId,
      };
      const homeOwnerId = resolveHomeOwnerId(ownerRouting);

      // Lost souls sent to discard or reserve go to land-of-bondage instead.
      // Tokens are exempt — a token Lost Soul dragged to a removal zone is
      // deleted below, never redirected (mirrors move_card's token-first rule).
      const isLostSoul = card.cardType === 'LS' || card.cardName.toLowerCase().includes('lost soul');
      if (isLostSoul && !card.isToken && (toZone === 'discard' || toZone === 'reserve' || toZone === 'banish')) {
        // Lost Souls always go to the deck owner's LoB — see move_card.
        const lobOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;
        const lobIndex = BigInt(
          [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
            (c: any) => c.ownerId === lobOwnerId && c.zone === 'land-of-bondage'
          ).length
        );
        clearCountersIfLeavingPlay(ctx, card.id, card.zone, 'land-of-bondage');
        ctx.db.CardInstance.id.update({
          ...card,
          zone: 'land-of-bondage',
          zoneIndex: lobIndex,
          posX: '',
          posY: '',
          isFlipped: false,
          ownerId: lobOwnerId,
          ...leavePlayFieldOverrides(card, card.zone, 'land-of-bondage'),
        });
        redirectedLostSouls.push({ name: logName, img: logImg });
        continue;
      }

      // Drawing a Lost Soul from your own deck routes it to Land of Bondage
      // and pulls a replacement from the same end of the deck — same rule as
      // top-of-deck auto-route in drawCardsForPlayer.
      if (
        isLostSoul &&
        needsReplacementSupport &&
        card.zone === 'deck' &&
        card.ownerId === player.id &&
        player.autoRouteLostSouls
      ) {
        const lobIndex = BigInt(
          [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
            (c: any) => c.ownerId === homeOwnerId && c.zone === 'land-of-bondage'
          ).length
        );
        clearCountersIfLeavingPlay(ctx, card.id, card.zone, 'land-of-bondage');
        ctx.db.CardInstance.id.update({
          ...card,
          zone: 'land-of-bondage',
          zoneIndex: lobIndex,
          posX: '',
          posY: '',
          isFlipped: false,
          ownerId: homeOwnerId,
          ...leavePlayFieldOverrides(card, card.zone, 'land-of-bondage'),
        });
        redirectedLostSouls.push({ name: logName, img: logImg });
        // Queue a replacement from the same end of the deck. Append to `ids`
        // so the main loop processes it with the rest of the batch; seed the
        // pre-pass maps since the replacement wasn't in the original ids.
        const replacementId = pickReplacementId();
        if (replacementId) {
          const replacementBig = BigInt(replacementId);
          const replacementCard = ctx.db.CardInstance.id.find(replacementBig);
          if (replacementCard) {
            batchIdSet.add(replacementBig);
            originalZoneById.set(replacementId, replacementCard.zone);
            originalOwnerById.set(replacementId, replacementCard.ownerId);
            finalZoneById.set(replacementId, toZone);
            ids.push(replacementId);
          }
        }
        continue;
      }

      const rawPos = posMap[idStr] || { posX: '', posY: '' };
      // Ensure posX/posY are strings — client may send numbers via JSON positions map
      const pos = { posX: String(rawPos.posX ?? ''), posY: String(rawPos.posY ?? '') };
      // Same routing rule as the single move_card reducer.
      const cardOwnerId: bigint = resolveDestinationOwnerId(ownerRouting);
      const cardFinalZone = finalZoneById.get(idStr) ?? toZone;
      // Paragon: rescuing a shared soul transfers ownership. Default to the
      // acting seat, but honor an explicit targetOwnerId when the caller
      // dragged the soul into a specific player's zone.
      let resolvedCardOwnerId = cardOwnerId;
      if (
        card.ownerId === 0n &&
        card.isSoulDeckOrigin === true &&
        card.zone === 'land-of-bondage' &&
        cardFinalZone !== 'land-of-bondage' &&
        cardFinalZone !== 'soul-deck' &&
        !targetOwnerId
      ) {
        resolvedCardOwnerId = player.id;
      }
      // Paragon: track rescues-to-LoR so we only refill the shared soul deck
      // when a rescue actually occurred. Drag-backs, soul-deck round-trips,
      // and other destinations must not trigger a refill.
      if (
        card.isSoulDeckOrigin === true &&
        card.zone === 'land-of-bondage' &&
        cardFinalZone === 'land-of-redemption'
      ) {
        anyRescueToLor = true;
      }
      // Paragon: dropping a soul-origin card back into the shared LoB resets ownership to the shared sentinel.
      if (
        targetOwnerId === '0' &&
        card.isSoulDeckOrigin === true &&
        cardFinalZone === 'land-of-bondage'
      ) {
        resolvedCardOwnerId = 0n;
      }
      // Clear the attach pointer only when the mover is actually leaving its
      // current zone. Same-zone reposition preserves the link (both Territory
      // warriors and LOB souls can shuffle within their zone without losing
      // attached accessories).
      const leavingZone =
        cardFinalZone !== card.zone || resolvedCardOwnerId !== card.ownerId;
      // An accessory travelling with its host in the same batch keeps its link —
      // otherwise a warrior-with-weapon group move across ownership boundaries
      // would strip the weapon off mid-flight.
      const hostInBatch =
        card.equippedToInstanceId !== 0n && batchIdSet.has(card.equippedToInstanceId);

      // Auto-fan: if dropping into territory without an explicit position,
      // stagger the card in a small grid so multi-card modal moves don't stack
      // at the zone origin. Positions are normalized 0–1 within the zone.
      if (cardFinalZone === 'territory' && pos.posX === '' && pos.posY === '') {
        const cardsPerRow = 10;
        const col = autoFanIndex % cardsPerRow;
        const row = Math.floor(autoFanIndex / cardsPerRow);
        pos.posX = String(0.03 + col * 0.04 + row * 0.02);
        pos.posY = String(0.05 + row * 0.28);
        autoFanIndex += 1;
      }

      // For hand zone, assign sequential zoneIndex (count of existing hand cards for this owner)
      const handZoneIndex = cardFinalZone === 'hand' ? BigInt(
        [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
          (c: any) => c.ownerId === cardOwnerId && c.zone === 'hand'
        ).length
      ) : card.zoneIndex;

      // Determine the zoneIndex for this card:
      // - hand: use computed sequential index
      // - free-form zones (territory): assign incrementing index so cards render on top
      // - redirected to discard (equip cascade): compute discard max + 1
      // - Paragon shared LoB: slot-preserving — fill the first empty slot in [0..2]
      // - other zones: preserve existing zoneIndex
      let finalZoneIndex = card.zoneIndex;
      if (cardFinalZone === 'hand') {
        finalZoneIndex = handZoneIndex;
      } else if (cardFinalZone !== toZone) {
        // Redirected (weapon → discard). Compute max zoneIndex for the
        // redirected owner's discard and put the weapon after it.
        let maxDiscardIdx = -1n;
        for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
          if (c.ownerId === cardOwnerId && c.zone === 'discard' && c.zoneIndex > maxDiscardIdx) {
            maxDiscardIdx = c.zoneIndex;
          }
        }
        finalZoneIndex = maxDiscardIdx + 1n;
      } else if (isFreeFormTarget) {
        // Assign ascending zoneIndex for free-form zones — both cross-zone moves
        // and same-zone repositioning — so moved cards render on top for all clients.
        finalZoneIndex = nextFreeFormIndex;
        nextFreeFormIndex += 1n;
      } else if (cardFinalZone === 'land-of-bondage' && resolvedCardOwnerId === 0n) {
        // Shared LoB slot assignment: find the first empty slot in [0..2].
        const sharedLob = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
          (c: any) => c.ownerId === 0n && c.zone === 'land-of-bondage' && c.id !== cardId
        );
        const occupied = new Set<bigint>(sharedLob.map((c: any) => c.zoneIndex));
        let chosen: bigint | null = null;
        for (let i = 0n; i < 3n; i++) {
          if (!occupied.has(i)) { chosen = i; break; }
        }
        if (chosen === null) {
          let maxIdx = -1n;
          for (const c of sharedLob) {
            if (c.zoneIndex > maxIdx) maxIdx = c.zoneIndex;
          }
          chosen = maxIdx + 1n;
        }
        finalZoneIndex = chosen;
      }

      // Clear pos when redirected (the client-supplied coords were for `toZone`, not discard)
      const finalPosX = cardFinalZone === toZone ? pos.posX : '';
      const finalPosY = cardFinalZone === toZone ? pos.posY : '';

      // Mirror move_card's auto-reveal: cards landing in a hand via an
      // identity-revealing move flash face-up briefly. Uses cardFinalZone (not
      // toZone) so a redirect to LOB never triggers the reveal.
      // Blind draws from the deck (right-click "Draw N from top/bottom/random")
      // must stay face-down in hand. Searches and tutors that go through this
      // path don't set fromSource, so they still auto-reveal as expected.
      const isBlindDeckDraw = fromSource === 'top-of-deck'
        || fromSource === 'bottom-of-deck' || fromSource === 'random-from-deck';
      const autoReveal = cardFinalZone === 'hand' && card.zone !== 'hand'
        && !isBlindDeckDraw && !hideIdentity;
      const newRevealExpiresAt = autoReveal
        ? new Timestamp(ctx.timestamp.microsSinceUnixEpoch + AUTO_REVEAL_HAND_MICROS)
        : undefined;
      const newRevealStartedAt = autoReveal ? ctx.timestamp : undefined;

      // Tokens dropped into a non-play zone (deck/hand/discard/reserve/banish) —
      // including via a group drag — are deleted, not moved. Mirrors the single
      // move_card rule (TOKEN_REMOVE_ZONES). The earlier movedCards / hand+LOB
      // compaction bookkeeping already accounted for this card when its zone
      // changed, so just remove it and skip ahead.
      const TOKEN_REMOVE_ZONES = ['reserve', 'banish', 'discard', 'hand', 'deck'];
      if (card.isToken && TOKEN_REMOVE_ZONES.includes(cardFinalZone)) {
        deleteTokenWithCounters(ctx, card);
        continue;
      }

      const battleEntryUpdates: any = {};
      if (cardFinalZone === 'battle') {
        stampBattleEntry(ctx, gameId, card, battleEntryUpdates);
      }
      clearCountersIfLeavingPlay(ctx, card.id, card.zone, cardFinalZone);
      ctx.db.CardInstance.id.update({
        ...card,
        zone: cardFinalZone,
        zoneIndex: finalZoneIndex,
        posX: finalPosX,
        posY: finalPosY,
        isFlipped,
        ownerId: resolvedCardOwnerId,
        equippedToInstanceId: leavingZone && !hostInBatch ? 0n : card.equippedToInstanceId,
        revealExpiresAt: newRevealExpiresAt,
        revealStartedAt: newRevealStartedAt,
        ...leavePlayFieldOverrides(card, card.zone, cardFinalZone),
        ...battleEntryUpdates,
      });
      // Rescue win: a soul batch-dragged into land-of-redemption may complete
      // the goal. Idempotent, so a per-card call in the loop is safe.
      if (cardFinalZone === 'land-of-redemption') {
        checkAndApplyWin(ctx, gameId);
      }
    }

    // Accessory cascade post-pass: for each mover that actually changed zone,
    // cascade to non-batch accessories pointing at it. Warriors going
    // Territory → LOB drag their weapons to Discard; all other host-leaves-zone
    // cases (soul rescued from LOB, etc.) just unlink in place.
    for (const idStr of ids) {
      const moverId = BigInt(idStr);
      const moverFinalZone = finalZoneById.get(idStr) ?? toZone;
      const originalZone = originalZoneById.get(idStr);
      if (originalZone === undefined) continue;
      // Refetch the mover to learn its post-update owner — cascade must fire
      // when ownership changed between territories (same zone name) so stranded
      // accessories don't keep pointing at a host in another player's zone.
      const postMover = ctx.db.CardInstance.id.find(moverId);
      const originalOwner = originalOwnerById.get(idStr);
      const ownerChanged =
        postMover != null &&
        originalOwner !== undefined &&
        postMover.ownerId !== originalOwner;
      if (moverFinalZone === originalZone && !ownerChanged) continue;
      const sendToDiscard =
        originalZone === 'territory' && moverFinalZone === 'land-of-bondage';
      const nonBatchAccessories = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.equippedToInstanceId === moverId && !batchIdSet.has(c.id)
      );
      for (const accessory of nonBatchAccessories) {
        if (sendToDiscard) {
          let maxDiscardIdx = -1n;
          for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
            if (c.ownerId === accessory.ownerId && c.zone === 'discard' && c.zoneIndex > maxDiscardIdx) {
              maxDiscardIdx = c.zoneIndex;
            }
          }
          clearCountersIfLeavingPlay(ctx, accessory.id, accessory.zone, 'discard');
          ctx.db.CardInstance.id.update({
            ...accessory,
            zone: 'discard',
            zoneIndex: maxDiscardIdx + 1n,
            posX: '',
            posY: '',
            equippedToInstanceId: 0n,
            revealExpiresAt: undefined,
      revealStartedAt: undefined,
            ...leavePlayFieldOverrides(accessory, accessory.zone, 'discard'),
          });
        } else {
          ctx.db.CardInstance.id.update({ ...accessory, equippedToInstanceId: 0n });
        }
      }
    }

    // Only log if cards actually changed zones (not just repositioned within the same zone)
    if (movedCards.length > 0 || redirectedLostSouls.length > 0) {
      logAction(ctx, gameId, player.id, 'MOVE_CARDS_BATCH', JSON.stringify({ count: movedCards.length, toZone, cards: movedCards, redirectedLostSouls, targetOwnerId: targetOwnerId || '', fromSource: fromSource || '', sourceOwnerId: sourceOwnerId !== null ? sourceOwnerId.toString() : '' }), game.turnNumber, game.currentPhase);
    }

    // Compact hand indices for any owners whose hand had cards removed
    for (const ownerId of handCompactOwners) {
      compactHandIndices(ctx, gameId, ownerId);
    }
    // Compact LOB indices for any owners whose LOB had cards removed
    for (const ownerId of lobCompactOwners) {
      compactLobIndices(ctx, gameId, ownerId);
    }

    // Paragon: only refill when this batch actually rescued a soul-origin
    // card into a land-of-redemption. Other destinations leave the LoB short.
    if (normalizeFormat(game.format) === 'Paragon' && anyRescueToLor) {
      refillSoulDeck(ctx, game.id);
    }
  }
);

// ---------------------------------------------------------------------------
// Helper: setCardOutlineImpl
// Called by execute_card_ability when ability.type === 'set_card_outline'.
// Re-picking the same color clears it (mutually-exclusive cycle); picking the
// other color switches.
// ---------------------------------------------------------------------------
function setCardOutlineImpl(
  ctx: any,
  source: any,
  ability: Extract<CardAbility, { type: 'set_card_outline' }>,
  player: any,
  gameId: bigint,
) {
  const next = source.outlineColor === ability.color ? '' : ability.color;
  ctx.db.CardInstance.id.update({ ...source, outlineColor: next });

  const game = ctx.db.Game.id.find(gameId);
  if (game) {
    logAction(
      ctx,
      gameId,
      player.id,
      'SET_CARD_OUTLINE',
      JSON.stringify({
        cardName: source.cardName,
        cardInstanceId: source.id.toString(),
        color: next,
      }),
      game.turnNumber,
      game.currentPhase,
    );
  }
}

// ---------------------------------------------------------------------------
// Helper: setRotationImpl
// Called by execute_card_ability when ability.type === 'set_rotation'. Turns a
// "counts as two Lost Souls" card (Two/Three Liner) sideways in the Land of
// Bondage to mark the first of its two required rescues, or back upright.
// Zone gating (land-of-bondage only) is enforced by the entry's sourceZones
// in execute_card_ability.
// ---------------------------------------------------------------------------
function setRotationImpl(
  ctx: any,
  source: any,
  ability: Extract<CardAbility, { type: 'set_rotation' }>,
  player: any,
  gameId: bigint,
) {
  if (source.isRotated === ability.rotated) return; // already in that state
  ctx.db.CardInstance.id.update({ ...source, isRotated: ability.rotated });

  const game = ctx.db.Game.id.find(gameId);
  if (game) {
    logAction(
      ctx,
      gameId,
      player.id,
      'SET_ROTATION',
      JSON.stringify({
        cardName: source.cardName,
        cardInstanceId: source.id.toString(),
        rotated: ability.rotated,
      }),
      game.turnNumber,
      game.currentPhase,
    );
  }
}

// ---------------------------------------------------------------------------
// Helper: spawnTokenImpl
// Called by execute_card_ability when ability.type === 'spawn_token'.
// Validates, computes target zone + zoneIndex, then inserts token CardInstance
// rows. SpacetimeDB rolls back the whole reducer if any insert throws.
// ---------------------------------------------------------------------------
// Compute a run of staggered positions cascading down-right from a base point,
// skipping any slot that overlaps an already-occupied position. Each placed
// slot becomes occupied so returned slots never collide with each other. This
// gives visual feedback when tokens are spawned in a row — a second spawn lands
// on free slots instead of stacking exactly on the first batch.
function staggerSlots(
  occupied: Array<{ x: number; y: number }>,
  baseX: number,
  baseY: number,
  staggerX: number,
  staggerY: number,
  count: number,
): Array<{ x: number; y: number }> {
  const threshold = Math.hypot(staggerX, staggerY) * 0.5;
  const taken = [...occupied];
  const slots: Array<{ x: number; y: number }> = [];
  let step = 1;
  for (let i = 0; i < count; i++) {
    let x = baseX + step * staggerX;
    let y = baseY + step * staggerY;
    while (taken.some(p => Math.hypot(p.x - x, p.y - y) < threshold)) {
      step += 1;
      x = baseX + step * staggerX;
      y = baseY + step * staggerY;
    }
    slots.push({ x, y });
    taken.push({ x, y });
    step += 1;
  }
  return slots;
}

function spawnTokenImpl(
  ctx: any,
  source: any, // CardInstance row
  ability: Extract<CardAbility, { type: 'spawn_token' }>,
  player: any, // Player row
  gameId: bigint,
) {
  // Easter egg: gated users get cycling colored tokens instead of the normal
  // one. The cycle position is derived from how many of the cycling tokens this
  // player already has in territory (count-based), so no extra state is stored.
  // Removing a token before the next spawn can repeat a color — acceptable here.
  let effectiveTokenName = ability.tokenName;
  const cyclingNames = ability.cyclingTokenNames ?? [];
  const me = (player.displayName ?? '').toLowerCase();
  if (cyclingNames.length > 0 && (ability.cyclingAllowedUsers ?? []).includes(me)) {
    const cyclingDisplayNames = new Set<string>();
    for (const n of cyclingNames) {
      const d = findTokenCard(n);
      if (d) cyclingDisplayNames.add(d.name);
    }
    let inPlay = 0;
    for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
      if (
        c.ownerId === player.id &&
        c.zone === 'territory' &&
        c.isToken &&
        cyclingDisplayNames.has(c.cardName)
      ) {
        inPlay++;
      }
    }
    effectiveTokenName = cyclingNames[inPlay % cyclingNames.length];
  }

  // Phase 1 — validate token exists in card data.
  const tokenData = findTokenCard(effectiveTokenName);
  if (!tokenData) throw new SenderError(`Unknown token '${effectiveTokenName}'`);

  const count = ability.count ?? 1;
  if (count < 1) throw new SenderError('Invalid count');

  // Phase 2 — compute target zone. Always Territory by default — it's the
  // visible main play area. Registry can override via ability.defaultZone.
  const targetZone = ability.defaultZone ?? 'territory';

  // Whose zone the token lands in. Defaults to the activator (player) — either
  // player may fire the ability and the token lands on their side.
  // `spawnForOpponent` (Harvest-style souls that "create a token in an
  // opponent's Land of Bondage") places it in the activator's opponent's copy
  // of the zone instead. Falls back to the caster if no opponent row exists.
  let tokenOwnerId = player.id;
  if (ability.spawnForOpponent) {
    const opponent = [...ctx.db.Player.player_game_id.filter(gameId)].find(
      (p: any) => p.id !== player.id,
    );
    if (opponent) tokenOwnerId = opponent.id;
  }

  // Compute starting zoneIndex based on existing cards for (targetZone, tokenOwnerId).
  // In the same pass, collect occupied territory positions so spawned tokens
  // can cascade past them instead of stacking invisibly on a previous batch.
  let maxIdx = -1n;
  const occupied: Array<{ x: number; y: number }> = [];
  for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
    if (c.ownerId === tokenOwnerId && c.zone === targetZone) {
      if (c.zoneIndex > maxIdx) maxIdx = c.zoneIndex;
      const x = c.posX ? Number(c.posX) : NaN;
      const y = c.posY ? Number(c.posY) : NaN;
      if (Number.isFinite(x) && Number.isFinite(y)) occupied.push({ x, y });
    }
  }

  // Stagger each token relative to the source IF the source is already in
  // territory (so tokens appear next to their source card). Otherwise use a
  // sensible default position. Multiplayer uses NORMALIZED 0–1 coordinates
  // (NOT pixel coords like goldfish) — the client scales them to the zone's
  // pixel size at render time. Card width is roughly 10% of territory width,
  // so ~0.05 between centers leaves each card visibly distinct.
  const STAGGER_X = 0.05;
  const STAGGER_Y = 0.03;
  const sourceInTerritory = source.zone === 'territory';
  const sourcePosX = source.posX ? Number(source.posX) : NaN;
  const sourcePosY = source.posY ? Number(source.posY) : NaN;
  const baseX = sourceInTerritory && Number.isFinite(sourcePosX) ? sourcePosX : 0.3;
  const baseY = sourceInTerritory && Number.isFinite(sourcePosY) ? sourcePosY : 0.4;
  const slots =
    targetZone === 'territory'
      ? staggerSlots(occupied, baseX, baseY, STAGGER_X, STAGGER_Y, count)
      : [];

  // Phase 3 — all-or-nothing inserts. SpacetimeDB rolls back the whole
  // reducer if any insert throws.
  for (let i = 0; i < count; i++) {
    maxIdx += 1n;
    const posX = targetZone === 'territory' ? String(slots[i].x) : '';
    const posY = targetZone === 'territory' ? String(slots[i].y) : '';
    ctx.db.CardInstance.insert({
      id: 0n,
      gameId,
      ownerId: tokenOwnerId,
      originalOwnerId: tokenOwnerId,
      zone: targetZone,
      zoneIndex: maxIdx,
      posX,
      posY,
      isMeek: false,
      isFlipped: false,
      isToken: true,
      isSoulDeckOrigin: false,
      equippedToInstanceId: 0n,
      notes: '',
      cardName: tokenData.name,
      cardSet: tokenData.set,
      cardImgFile: tokenData.imgFile,
      cardType: tokenData.cardType,
      brigade: tokenData.brigade,
      strength: tokenData.strength,
      toughness: tokenData.toughness,
      alignment: tokenData.alignment,
      identifier: tokenData.identifier,
      specialAbility: tokenData.specialAbility,
      reference: tokenData.reference,
      revealExpiresAt: undefined,
      revealStartedAt: undefined,
      originZone: '',
      originPosX: '',
      originPosY: '',
      outlineColor: '',
      isRotated: false,
      imitatingName: '',
    });
  }

  const game = ctx.db.Game.id.find(gameId);
  if (game) {
    logAction(
      ctx, gameId, player.id, 'SPAWN_TOKEN',
      JSON.stringify({
        sourceInstanceId: source.id.toString(),
        sourceCardName: source.cardName,
        sourceCardImgFile: source.cardImgFile,
        tokenName: tokenData.name,
        tokenImgFile: tokenData.imgFile,
        count,
        targetZone,
      }),
      game.turnNumber, game.currentPhase,
    );
  }
}

// ---------------------------------------------------------------------------
// Helper: shuffleAndDrawForPlayerImpl
// Moves up to `shuffleCount` random cards from player's hand into their deck,
// reshuffles the whole deck with a seeded PRNG, then draws `drawCount`.
// Short-hand (< shuffleCount) shuffles all of hand. Short deck draws as many
// as possible. Emits a single SHUFFLE_AND_DRAW log entry for the action.
// ---------------------------------------------------------------------------
function shuffleAndDrawForPlayerImpl(
  ctx: any,
  gameId: bigint,
  targetPlayer: any, // Player row — whose hand/deck to shuffle + draw
  shuffleCount: number,
  drawCount: number,
  // Philip's Daughters (all_players_keep_one_shuffle_draw): when set, the
  // selection stops being a random pick of `shuffleCount` and becomes "every
  // hand card except this one", with the draw matching however many that turns
  // out to be. shuffleCount/drawCount are ignored in that mode.
  keepInstanceId?: bigint,
): { shuffled: number; drawn: number } {
  const keepMode = keepInstanceId !== undefined;
  if (!keepMode && (shuffleCount < 0 || drawCount < 0)) {
    throw new SenderError('Invalid shuffle/draw counts');
  }

  const game = ctx.db.Game.id.find(gameId);
  if (!game) throw new SenderError('Game not found');

  // Collect target's hand
  const handCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
    (c: any) => c.ownerId === targetPlayer.id && c.zone === 'hand'
  );

  let pickedCards: any[];
  if (keepMode) {
    // The keeper must actually be in this player's hand — otherwise a stale or
    // spoofed id would silently shuffle the whole hand away. An empty hand is
    // the one legitimate case with no keeper: it's simply a no-op.
    if (handCards.length > 0 && !handCards.some((c: any) => c.id === keepInstanceId)) {
      throw new SenderError('Kept card is not in your hand');
    }
    // "Shuffle the rest" is deterministic, so no selection RNG is needed here;
    // the deck reshuffle below still uses its own seeded pass.
    pickedCards = handCards.filter((c: any) => c.id !== keepInstanceId);
  } else {
    // Hand shortage: shuffle whatever we have (could be 0).
    // Seeded PRNG for shuffle selection
    const rngCounter1 = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: rngCounter1 });
    const pickSeed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, targetPlayer.id, rngCounter1);
    const pickRng = xorshift64(pickSeed);

    // Fisher-Yates partial shuffle to pick random hand indices
    const picks = Math.min(shuffleCount, handCards.length);
    const indices = handCards.map((_: any, i: number) => i);
    for (let i = indices.length - 1; i > indices.length - 1 - picks && i > 0; i--) {
      const j = Number(pickRng.next() % BigInt(i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    pickedCards = indices.slice(indices.length - picks).map((i: number) => handCards[i]);
  }
  const actualShuffle = pickedCards.length;
  // Keep mode draws back exactly what it shuffled away.
  const actualDraw = keepMode ? actualShuffle : drawCount;

  // Move picked hand cards to deck (temporary zoneIndex — will be overwritten
  // by the reshuffle pass below).
  for (const card of pickedCards) {
    ctx.db.CardInstance.id.update({
      ...card,
      zone: 'deck',
      zoneIndex: 0n,
      posX: '',
      posY: '',
      isFlipped: true,
    });
  }

  // Reshuffle the entire deck
  const latestGame = ctx.db.Game.id.find(gameId);
  if (!latestGame) throw new SenderError('Game disappeared mid-reducer');
  const rngCounter2 = latestGame.rngCounter + 1n;
  ctx.db.Game.id.update({ ...latestGame, rngCounter: rngCounter2 });

  const allDeckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
    (c: any) => c.ownerId === targetPlayer.id && c.zone === 'deck'
  );
  const shuffleIndices = allDeckCards.map((_: any, idx: number) => idx);
  const shuffleSeed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, targetPlayer.id, rngCounter2);
  seededShuffle(shuffleIndices, shuffleSeed);
  for (let i = 0; i < allDeckCards.length; i++) {
    ctx.db.CardInstance.id.update({ ...allDeckCards[i], zoneIndex: BigInt(shuffleIndices[i]) });
  }

  compactHandIndices(ctx, gameId, targetPlayer.id);

  // Draw — short-deck draws as many as possible (drawCardsForPlayer handles it).
  const drawGame = ctx.db.Game.id.find(gameId);
  if (!drawGame) throw new SenderError('Game disappeared mid-reducer');
  const drawResult = drawCardsForPlayer(ctx, drawGame, targetPlayer, actualDraw);

  const finalGame = ctx.db.Game.id.find(gameId);
  if (finalGame) {
    logAction(
      ctx, gameId, targetPlayer.id, keepMode ? 'KEEP_ONE_SHUFFLE_DRAW' : 'SHUFFLE_AND_DRAW',
      JSON.stringify({
        shuffled: actualShuffle,
        requestedShuffle: keepMode ? actualShuffle : shuffleCount,
        drawn: drawResult.drawn,
        requestedDraw: actualDraw,
      }),
      finalGame.turnNumber, finalGame.currentPhase,
    );
  }

  return { shuffled: actualShuffle, drawn: drawResult.drawn };
}

// ---------------------------------------------------------------------------
// Helper: underdeckTopOfDeckImpl
// Moves the top `count` cards of the acting player's deck to the bottom of
// that same deck. "Top" is ascending zoneIndex; new positions are appended
// past the current max zoneIndex so relative order is preserved without
// shifting every other row. Cards stay face-down (they were already face-down
// at the top of the deck).
// ---------------------------------------------------------------------------
function underdeckTopOfDeckImpl(
  ctx: any,
  source: any,
  ability: Extract<CardAbility, { type: 'underdeck_top_of_deck' }>,
  player: any,
  gameId: bigint,
) {
  if (ability.count < 1) throw new SenderError('Invalid count');

  const game = ctx.db.Game.id.find(gameId);
  if (!game) throw new SenderError('Game not found');

  const playerCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
    (c: any) => c.ownerId === player.id
  );
  const deckCards = playerCards
    .filter((c: any) => c.zone === 'deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));

  if (deckCards.length === 0) return;

  const n = Math.min(ability.count, deckCards.length);
  const maxIdx = deckCards[deckCards.length - 1].zoneIndex as bigint;

  for (let i = 0; i < n; i++) {
    const top = deckCards[i];
    ctx.db.CardInstance.id.update({
      ...top,
      zoneIndex: maxIdx + BigInt(i + 1),
      posX: '',
      posY: '',
      isFlipped: true,
    });
  }

  logAction(
    ctx, gameId, player.id, 'UNDERDECK_TOP_OF_DECK',
    JSON.stringify({
      count: n,
      requested: ability.count,
      sourceCardName: source.cardName,
      sourceCardImgFile: source.cardImgFile,
    }),
    game.turnNumber, game.currentPhase,
  );
}

// ---------------------------------------------------------------------------
// Helper: drawAndTopdeckSelfImpl
// Topdecks the source Lost Soul onto its owner's Soul Deck (zoneIndex 0,
// shifting existing soul-deck cards up by 1) and draws 1 from the top of the
// owner's main deck into their hand.
// ---------------------------------------------------------------------------
function drawAndTopdeckSelfImpl(
  ctx: any,
  source: any,
  player: any,
  gameId: bigint,
) {
  const game = ctx.db.Game.id.find(gameId);
  if (!game) throw new SenderError('Game not found');

  const fromZone = source.zone;
  const gameCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];

  // Shift this player's existing soul-deck cards up by 1 so the source can
  // land at index 0 (top). Excludes the source itself defensively.
  const soulCards = gameCards.filter(
    (c: any) => c.ownerId === player.id && c.zone === 'soul-deck' && c.id !== source.id
  );
  for (const sc of soulCards) {
    ctx.db.CardInstance.id.update({ ...sc, zoneIndex: sc.zoneIndex + 1n });
  }

  // Move source to top of soul-deck, clearing in-play state.
  ctx.db.CardInstance.id.update({
    ...source,
    ...leavePlayFieldOverrides(source, fromZone, 'soul-deck'),
    zone: 'soul-deck',
    zoneIndex: 0n,
    posX: '',
    posY: '',
    isFlipped: true,
  });
  clearCountersIfLeavingPlay(ctx, source.id, fromZone, 'soul-deck');
  if (fromZone === 'land-of-bondage') {
    compactLobIndices(ctx, gameId, source.ownerId, gameCards, source.id);
  }

  // Draw 1 from top of own main deck into hand, respecting HAND_LIMIT.
  const handCards = gameCards.filter((c: any) => c.ownerId === player.id && c.zone === 'hand');
  let drawnCard: { name: string; img: string } | null = null;
  if (handCards.length < HAND_LIMIT) {
    const deckCards = gameCards
      .filter((c: any) => c.ownerId === player.id && c.zone === 'deck')
      .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
    if (deckCards.length > 0) {
      const top = deckCards[0];
      ctx.db.CardInstance.id.update({
        ...top,
        zone: 'hand',
        zoneIndex: BigInt(handCards.length),
        posX: '',
        posY: '',
        isFlipped: false,
      });
      drawnCard = { name: top.cardName, img: top.cardImgFile };
    }
  }

  logAction(
    ctx, gameId, player.id, 'DRAW_AND_TOPDECK_SELF',
    JSON.stringify({
      sourceCardName: source.cardName,
      sourceCardImgFile: source.cardImgFile,
      drewCard: drawnCard,
    }),
    game.turnNumber, game.currentPhase,
  );
}

// ---------------------------------------------------------------------------
// Helper: reserveTopOfDeckImpl
// Moves the top `count` cards of the acting player's deck into their reserve.
// "Top" is defined by ascending zoneIndex (same convention as drawCardsForPlayer).
// Cards enter reserve face-down — the player didn't look at them.
// ---------------------------------------------------------------------------
function reserveTopOfDeckImpl(
  ctx: any,
  source: any,
  ability: Extract<CardAbility, { type: 'reserve_top_of_deck' }>,
  player: any,
  gameId: bigint,
) {
  if (ability.count < 1) throw new SenderError('Invalid count');

  const game = ctx.db.Game.id.find(gameId);
  if (!game) throw new SenderError('Game not found');

  const playerCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
    (c: any) => c.ownerId === player.id
  );
  const deckCards = playerCards
    .filter((c: any) => c.zone === 'deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));

  if (deckCards.length === 0) return;

  const reserveCards = playerCards.filter((c: any) => c.zone === 'reserve');
  const n = Math.min(ability.count, deckCards.length);

  // Split: Lost Souls auto-route to LoB when the option is on; the rest go to
  // reserve. Each reserved card gets a 10s reveal so the player (and opponent)
  // can briefly see what came off the deck — matches the per-card hand reveal.
  const taken = deckCards.slice(0, n);
  const toReserve: any[] = [];
  const toLob: any[] = [];
  for (const card of taken) {
    const isLostSoul =
      player.autoRouteLostSouls &&
      (card.cardType === 'LS' || card.cardName.toLowerCase().includes('lost soul'));
    if (isLostSoul) toLob.push(card);
    else toReserve.push(card);
  }

  // Shift existing reserve cards' zoneIndex up by the number of new arrivals so
  // they occupy slots [0..toReserve.length-1] — matches "top of deck" semantics
  // in move_card_to_top_of_deck.
  const shiftBy = BigInt(toReserve.length);
  if (shiftBy > 0n) {
    for (const rc of reserveCards) {
      ctx.db.CardInstance.id.update({ ...rc, zoneIndex: rc.zoneIndex + shiftBy });
    }
  }

  const TEN_SECONDS_MICROS = 10_000_000n;
  const expiresAt = new Timestamp(ctx.timestamp.microsSinceUnixEpoch + TEN_SECONDS_MICROS);
  const reservedCards: { name: string; img: string }[] = [];
  for (let i = 0; i < toReserve.length; i++) {
    const top = toReserve[i];
    ctx.db.CardInstance.id.update({
      ...top,
      zone: 'reserve',
      zoneIndex: BigInt(i),
      posX: '',
      posY: '',
      isFlipped: true,
      revealExpiresAt: expiresAt,
      revealStartedAt: ctx.timestamp,
    });
    reservedCards.push({ name: top.cardName, img: top.cardImgFile });
  }

  // Route Lost Souls to the end of the player's LoB face-up.
  let nextLobIdx = 0n;
  for (const c of playerCards) {
    if (c.zone === 'land-of-bondage' && c.zoneIndex >= nextLobIdx) {
      nextLobIdx = c.zoneIndex + 1n;
    }
  }
  const routedToLob: { name: string; img: string }[] = [];
  for (const ls of toLob) {
    ctx.db.CardInstance.id.update({
      ...ls,
      zone: 'land-of-bondage',
      zoneIndex: nextLobIdx,
      posX: '',
      posY: '',
      isFlipped: false,
      revealExpiresAt: undefined,
      revealStartedAt: undefined,
    });
    nextLobIdx += 1n;
    routedToLob.push({ name: ls.cardName, img: ls.cardImgFile });
  }

  logAction(
    ctx, gameId, player.id, 'RESERVE_TOP_OF_DECK',
    JSON.stringify({
      count: reservedCards.length,
      requested: ability.count,
      sourceCardName: source.cardName,
      sourceCardImgFile: source.cardImgFile,
      cards: reservedCards,
      routedToLob,
    }),
    game.turnNumber, game.currentPhase,
  );
}

// ---------------------------------------------------------------------------
// Helper: drawBottomOfDeckImpl
// Moves the bottom `count` cards of the acting player's deck into their hand.
// "Bottom" is defined by descending zoneIndex (inverse of drawCardsForPlayer).
// Does not apply auto-route Lost Souls — the card text is a literal draw from
// bottom.
// ---------------------------------------------------------------------------
function drawBottomOfDeckImpl(
  ctx: any,
  source: any,
  ability: Extract<CardAbility, { type: 'draw_bottom_of_deck' }>,
  player: any,
  gameId: bigint,
) {
  if (ability.count < 1) throw new SenderError('Invalid count');

  const game = ctx.db.Game.id.find(gameId);
  if (!game) throw new SenderError('Game not found');

  const playerCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
    (c: any) => c.ownerId === player.id
  );
  const deckCards = playerCards
    .filter((c: any) => c.zone === 'deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));

  if (deckCards.length === 0) return;

  let handCount = playerCards.filter((c: any) => c.zone === 'hand').length;
  let lobCount = playerCards.filter((c: any) => c.zone === 'land-of-bondage').length;

  // Walk up from the bottom of the deck (highest zoneIndex first). With
  // autoRouteLostSouls on, a drawn Lost Soul routes to Land of Bondage without
  // consuming a draw, so we keep walking up to pull a replacement from the next
  // bottom card — same rule as the top-of-deck draw in drawCardsForPlayer.
  const movedCards: { name: string; img: string }[] = [];
  let drawn = 0;
  let target = ability.count;
  let deckPos = deckCards.length - 1;

  for (let i = 0; i < target; i++) {
    if (deckPos < 0) break; // deck exhausted

    const card = deckCards[deckPos];
    const isLostSoul =
      player.autoRouteLostSouls &&
      (card.cardType === 'LS' || card.cardName.toLowerCase().includes('lost soul'));

    // Lost Souls auto-route to LOB and don't take a hand slot, so they keep
    // flowing even when the hand is full. A non-LS card that would land in a
    // full hand stops the draw.
    if (!isLostSoul && handCount >= HAND_LIMIT) break;

    deckPos--;

    if (isLostSoul) {
      ctx.db.CardInstance.id.update({
        ...card,
        zone: 'land-of-bondage',
        isFlipped: false,
        zoneIndex: BigInt(lobCount),
        posX: '',
        posY: '',
      });
      lobCount++;
      logAction(ctx, gameId, player.id, 'MOVE_CARD', JSON.stringify({ cardInstanceId: card.id.toString(), from: 'deck', to: 'land-of-bondage', cardName: card.cardName, cardImgFile: card.cardImgFile, redirected: 'drew' }), game.turnNumber, game.currentPhase);
      // Draw a replacement from the bottom — extend the loop.
      target++;
    } else {
      ctx.db.CardInstance.id.update({
        ...card,
        zone: 'hand',
        zoneIndex: BigInt(handCount),
        posX: '',
        posY: '',
        isFlipped: false,
      });
      handCount++;
      drawn++;
      movedCards.push({ name: card.cardName, img: card.cardImgFile });
    }
  }

  if (movedCards.length === 0) return;

  logAction(
    ctx, gameId, player.id, 'DRAW_BOTTOM_OF_DECK',
    JSON.stringify({
      count: drawn,
      requested: ability.count,
      sourceCardName: source.cardName,
      sourceCardImgFile: source.cardImgFile,
      cards: movedCards,
    }),
    game.turnNumber, game.currentPhase,
  );
}

// ---------------------------------------------------------------------------
// Helper: discardBottomOfDeckImpl
// Gates of Hell: discards the bottom card of the acting player's deck —
// except Lost Souls, which the printed text plays instead (routed to the
// owner's land-of-bondage). "Bottom" is the highest zoneIndex, matching
// drawBottomOfDeckImpl. Empty deck is a harmless no-op.
// ---------------------------------------------------------------------------
function discardBottomOfDeckImpl(
  ctx: any,
  source: any,
  player: any,
  gameId: bigint,
) {
  const game = ctx.db.Game.id.find(gameId);
  if (!game) throw new SenderError('Game not found');

  const playerCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
    (c: any) => c.ownerId === player.id
  );
  const deckCards = playerCards
    .filter((c: any) => c.zone === 'deck')
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
  if (deckCards.length === 0) return;

  const card = deckCards[deckCards.length - 1];
  const isLostSoul = card.cardType === 'LS'
    || card.cardType === 'Lost Soul'
    || card.cardName.toLowerCase().includes('lost soul');
  const destZone = isLostSoul ? 'land-of-bondage' : 'discard';

  let nextIdx = 0n;
  for (const c of playerCards) {
    if (c.zone === destZone && c.zoneIndex >= nextIdx) {
      nextIdx = c.zoneIndex + 1n;
    }
  }

  ctx.db.CardInstance.id.update({
    ...card,
    zone: destZone,
    zoneIndex: nextIdx,
    posX: '',
    posY: '',
    isFlipped: false,
  });

  logAction(
    ctx, gameId, player.id, 'DISCARD_BOTTOM_OF_DECK',
    JSON.stringify({
      sourceCardName: source.cardName,
      sourceCardImgFile: source.cardImgFile,
      card: { name: card.cardName, img: card.cardImgFile },
      toLandOfBondage: isLostSoul,
    }),
    game.turnNumber, game.currentPhase,
  );
}

// ---------------------------------------------------------------------------
// Helper: playAllLostSoulsImpl
// For each player in the game, moves every Lost Soul from their soul-deck
// (if non-empty — Paragon mode) or main deck into that same player's
// land-of-bondage. Cross-player effect — bypasses the per-player consent
// flow used by all_players_shuffle_and_draw because the printed Harvest Time
// text reads "Regardless of protect abilities".
// ---------------------------------------------------------------------------
function playAllLostSoulsImpl(
  ctx: any,
  source: any,
  player: any,
  gameId: bigint,
) {
  const game = ctx.db.Game.id.find(gameId);
  if (!game) throw new SenderError('Game not found');

  const players = [...ctx.db.Player.player_game_id.filter(gameId)];
  if (players.length === 0) return;

  // Single scan, then partition per-player in JS.
  const allCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)];

  let totalMoved = 0;

  for (const p of players) {
    const playerCards = allCards.filter((c: any) => c.ownerId === p.id);
    const soulDeck = playerCards.filter((c: any) => c.zone === 'soul-deck');
    const sourceCards = soulDeck.length > 0
      ? soulDeck
      : playerCards.filter((c: any) => c.zone === 'deck');
    const lostSouls = sourceCards.filter((c: any) =>
      c.cardType === 'LS'
      || c.cardType === 'Lost Soul'
      || c.cardName.toLowerCase().includes('lost soul'),
    );
    if (lostSouls.length === 0) continue;

    let nextLobIdx = 0n;
    for (const c of playerCards) {
      if (c.zone === 'land-of-bondage' && c.zoneIndex >= nextLobIdx) {
        nextLobIdx = c.zoneIndex + 1n;
      }
    }

    for (const ls of lostSouls) {
      ctx.db.CardInstance.id.update({
        ...ls,
        zone: 'land-of-bondage',
        zoneIndex: nextLobIdx,
        posX: '',
        posY: '',
        isFlipped: false,
      });
      nextLobIdx += 1n;
      totalMoved++;
    }
  }

  if (totalMoved > 0) {
    logAction(
      ctx, gameId, player.id, 'PLAY_ALL_LOST_SOULS',
      JSON.stringify({
        sourceCardName: source.cardName,
        sourceCardImgFile: source.cardImgFile,
        count: totalMoved,
      }),
      game.turnNumber, game.currentPhase,
    );
  }
}

// ---------------------------------------------------------------------------
// Helper: bandHeroesFromDeckImpl
// Creation of the World: "Take all Heroes having a Genesis reference out of
// your draw pile and band them into the Field of Battle." Pulls from the
// ACTIVATOR's deck — execute_card_ability deliberately doesn't enforce
// ownership, so the effect follows whoever fired the menu item — and sends
// every match into the battle band in one transaction. Opening a closed band
// mirrors enter_battle exactly (attacker is whoever's turn it is, not the
// activator), so this is indistinguishable from dragging the Heroes in by
// hand. Deck zoneIndex gaps are left behind, same as playAllLostSoulsImpl.
// Row geometry lives in battlePlacement.ts (bandRowSlots) so it's unit-tested.
// ---------------------------------------------------------------------------
function bandHeroesFromDeckImpl(
  ctx: any,
  source: any,
  ability: Extract<CardAbility, { type: 'band_heroes_from_deck' }>,
  player: any,
  gameId: bigint,
) {
  const game = ctx.db.Game.id.find(gameId);
  if (!game) throw new SenderError('Game not found');
  if (game.status !== 'playing') throw new SenderError('Game is not in playing state');
  // Same battle-state gate enter_battle applies to a manual drag.
  if (game.battleState === 'awaiting-soul') {
    throw new SenderError('Battle is resolving a soul surrender');
  }

  const myCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
    (c: any) => c.ownerId === player.id,
  );
  // Deck order preserved so the band reads the way the deck was stacked.
  const heroes = myCards
    .filter((c: any) =>
      c.zone === 'deck'
      && isHeroCard({ cardType: c.cardType })
      && hasReferenceBook(c.reference, ability.referenceBook))
    .sort((a: any, b: any) => (a.zoneIndex < b.zoneIndex ? -1 : a.zoneIndex > b.zoneIndex ? 1 : 0));
  if (heroes.length === 0) return;

  // One tight row packed against the right end of the band, deliberately
  // independent of what's already banded: the arrivals always claim the same
  // predictable strip instead of chasing existing cards rightward and
  // eventually spilling off the edge.
  const slots = bandRowSlots(heroes.length);

  if (game.battleState === '') {
    ctx.db.Game.id.update({
      ...game,
      battleState: 'active',
      battleAttackerSeat: game.currentTurn.toString(),
      lastBattlePlayBySeat: '',
    });
  }

  const banded: { name: string; img: string }[] = [];
  for (let i = 0; i < heroes.length; i++) {
    const hero = heroes[i];
    writeBattleEntryMove(ctx, gameId, hero, String(slots[i]), String(BAND_ROW_Y));
    banded.push({ name: hero.cardName, img: hero.cardImgFile });
  }

  // Re-read: the open above and every writeBattleEntryMove's stampBattleEntry
  // wrote the Game row, so the `game` snapshot is stale by now.
  const latest = ctx.db.Game.id.find(gameId);
  logAction(
    ctx, gameId, player.id, 'BAND_HEROES_FROM_DECK',
    JSON.stringify({
      sourceCardName: source.cardName,
      sourceCardImgFile: source.cardImgFile,
      referenceBook: ability.referenceBook,
      count: banded.length,
      cards: banded,
    }),
    latest ? latest.turnNumber : game.turnNumber,
    latest ? latest.currentPhase : game.currentPhase,
  );
}

// ---------------------------------------------------------------------------
// Helper: discardCharactersFromReserveImpl
// Called by execute_card_ability when ability.type === 'discard_characters_from_reserve'.
// Discards every character (Hero / Evil Character) from the chosen player's
// Reserve. ability.target picks whose Reserve: 'self' = activating player,
// 'opponent' = the other player. Empty Reserve is a harmless no-op.
// ---------------------------------------------------------------------------
function discardCharactersFromReserveImpl(
  ctx: any,
  source: any,
  ability: Extract<CardAbility, { type: 'discard_characters_from_reserve' }>,
  player: any,
  gameId: bigint,
) {
  const game = ctx.db.Game.id.find(gameId);
  if (!game) throw new SenderError('Game not found');

  // Resolve whose Reserve to clear.
  let targetPlayerId = player.id;
  if (ability.target === 'opponent') {
    const opponent = [...ctx.db.Player.player_game_id.filter(gameId)].find(
      (p: any) => p.id !== player.id,
    );
    if (!opponent) throw new SenderError('Opponent not found');
    targetPlayerId = opponent.id;
  }

  const ownerCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)]
    .filter((c: any) => c.ownerId === targetPlayerId);
  const toDiscard = ownerCards.filter(
    (c: any) => c.zone === 'reserve' && isCharacterCard({ cardType: c.cardType }),
  );
  if (toDiscard.length === 0) return;

  // Append to the bottom of the target owner's discard pile.
  let nextDiscardIdx = 0n;
  for (const c of ownerCards) {
    if (c.zone === 'discard' && c.zoneIndex >= nextDiscardIdx) {
      nextDiscardIdx = c.zoneIndex + 1n;
    }
  }

  for (const c of toDiscard) {
    ctx.db.CardInstance.id.update({
      ...c,
      zone: 'discard',
      zoneIndex: nextDiscardIdx,
      posX: '',
      posY: '',
      isFlipped: false,
    });
    nextDiscardIdx += 1n;
  }

  logAction(
    ctx, gameId, player.id, 'DISCARD_CHARACTERS_FROM_RESERVE',
    JSON.stringify({
      sourceCardName: source.cardName,
      sourceCardImgFile: source.cardImgFile,
      target: ability.target,
      count: toDiscard.length,
    }),
    game.turnNumber, game.currentPhase,
  );
}

// ---------------------------------------------------------------------------
// Reducer: execute_card_ability
//
// Server-authoritative dispatch for per-card custom abilities defined in the
// shared CARD_ABILITIES registry. Client sends only (gameId, cardInstanceId,
// abilityIndex); the server re-reads the registry by the source card's
// identifier and dispatches. validate → compute → write ordering ensures no
// row is inserted until every precondition has passed.
// ---------------------------------------------------------------------------
export const execute_card_ability = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    abilityIndex: t.u64(),
  },
  (ctx, { gameId, cardInstanceId, abilityIndex }) => {
    // Phase 1 — validate.
    const player = findPlayerBySender(ctx, gameId);

    const source = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!source) throw new SenderError('Card not found');
    if (source.gameId !== gameId) throw new SenderError('Card not in this game');
    // Ownership intentionally not enforced — either player may activate a
    // card's right-click ability; effects route to the activator (player).

    // Registry keys match cardName (e.g., "Two Possessed (GoC)"). The
    // identifier field is a taxonomy descriptor and is not unique enough.
    // Use effective abilities so imitated souls' right-click abilities
    // dispatch correctly when triggered on an Imitate Lost Soul.
    const abilities = getEffectiveAbilities(source);
    const ability = abilities[Number(abilityIndex)];
    if (!ability) throw new SenderError('No such ability');

    // Abilities only fire when the source card is in play. Matches the
    // client-side menu gate but the server enforces independently.
    // LoR included so resting Heroes (Angel of the Harvest, etc.) can spawn.
    // An entry may widen that set with its own sourceZones (e.g. (Star)
    // abilities used from hand during the Pre-Game Phase).
    const allowedZones = ability.sourceZones ?? ABILITY_SOURCE_ZONES;
    if (!allowedZones.includes(source.zone)) {
      throw new SenderError('Source card must be in play');
    }

    // Phase 2 — dispatch.
    switch (ability.type) {
      case 'spawn_token':
        return spawnTokenImpl(ctx, source, ability, player, gameId);
      case 'shuffle_and_draw':
        throw new SenderError('shuffle_and_draw not yet implemented');
      case 'all_players_shuffle_and_draw': {
        // Caster effect applies immediately. Opponent effect requires consent
        // (inserts a ZoneSearchRequest with action='shuffle_and_draw' — the
        // caster's client fires opponent_shuffle_and_draw on approval).
        shuffleAndDrawForPlayerImpl(ctx, gameId, player, ability.shuffleCount, ability.drawCount);

        const allPlayers = [...ctx.db.Player.player_game_id.filter(gameId)];
        const opponent = allPlayers.find((p: any) => p.id !== player.id);
        if (opponent) {
          // Don't stack requests if the caster already has one pending.
          for (const req of ctx.db.ZoneSearchRequest.zone_search_request_game_id.filter(gameId)) {
            if (req.requesterId === player.id && req.status === 'pending') {
              throw new SenderError('You already have a pending request');
            }
          }
          ctx.db.ZoneSearchRequest.insert({
            id: 0n,
            gameId,
            requesterId: player.id,
            targetPlayerId: opponent.id,
            zone: 'deck',
            status: 'pending',
            createdAt: ctx.timestamp,
            action: 'shuffle_and_draw',
            actionParams: JSON.stringify({
              shuffleCount: ability.shuffleCount,
              drawCount: ability.drawCount,
            }),
          });
        }
        return;
      }
      case 'all_players_keep_one_shuffle_draw':
        // Needs the caster's keeper choice, so the client opens a picker and
        // fires keep_one_shuffle_draw instead of routing through here.
        throw new SenderError('all_players_keep_one_shuffle_draw is dispatched by the client, not this reducer');
      case 'reveal_own_deck':
        throw new SenderError('reveal_own_deck is dispatched by the client, not this reducer');
      case 'look_at_own_deck':
        throw new SenderError('look_at_own_deck is dispatched by the client, not this reducer');
      case 'look_at_own_deck_choose':
        throw new SenderError('look_at_own_deck_choose is dispatched by the client, not this reducer');
      case 'reveal_own_deck_choose':
        throw new SenderError('reveal_own_deck_choose is dispatched by the client, not this reducer');
      case 'look_at_opponent_deck_choose':
        throw new SenderError('look_at_opponent_deck_choose is dispatched by the client, not this reducer');
      case 'reveal_opponent_deck_choose':
        throw new SenderError('reveal_opponent_deck_choose is dispatched by the client, not this reducer');
      case 'discard_opponent_deck_choose':
        throw new SenderError('discard_opponent_deck_choose is dispatched by the client, not this reducer');
      case 'look_at_opponent_deck':
        throw new SenderError('look_at_opponent_deck is dispatched by the client, not this reducer');
      case 'reveal_opponent_deck':
        throw new SenderError('reveal_opponent_deck is dispatched by the client, not this reducer');
      case 'discard_opponent_deck':
        throw new SenderError('discard_opponent_deck is dispatched by the client, not this reducer');
      case 'three_nails_reset':
        throw new SenderError('three_nails_reset is dispatched by the client, not this reducer');
      case 'imitate_lost_soul':
        throw new SenderError('imitate_lost_soul is dispatched directly by the client');
      case 'resurrect_heroes':
        throw new SenderError('resurrect_heroes is dispatched via the resurrect_heroes reducer');
      case 'reserve_opponent_deck':
        throw new SenderError('reserve_opponent_deck is dispatched by the client, not this reducer');
      case 'reserve_top_of_deck':
        return reserveTopOfDeckImpl(ctx, source, ability, player, gameId);
      case 'draw_bottom_of_deck':
        return drawBottomOfDeckImpl(ctx, source, ability, player, gameId);
      case 'draw_bottom_of_deck_choose':
        throw new SenderError('draw_bottom_of_deck_choose is dispatched via execute_card_ability_with_count');
      case 'discard_bottom_of_deck':
        return discardBottomOfDeckImpl(ctx, source, player, gameId);
      case 'underdeck_top_of_deck':
        return underdeckTopOfDeckImpl(ctx, source, ability, player, gameId);
      case 'discard_characters_from_reserve':
        return discardCharactersFromReserveImpl(ctx, source, ability, player, gameId);
      case 'set_card_outline':
        return setCardOutlineImpl(ctx, source, ability, player, gameId);
      case 'set_rotation':
        return setRotationImpl(ctx, source, ability, player, gameId);
      case 'play_all_lost_souls':
        return playAllLostSoulsImpl(ctx, source, player, gameId);
      case 'band_heroes_from_deck':
        return bandHeroesFromDeckImpl(ctx, source, ability, player, gameId);
      case 'draw_and_topdeck_self':
        return drawAndTopdeckSelfImpl(ctx, source, player, gameId);
      case 'draw_brigades':
        throw new SenderError('draw_brigades is dispatched via matthew_draw_brigades, not this reducer');
      case 'toggle_top_deck_reveal': {
        // Persistent flag on the ACTIVATOR's player row — both clients (and
        // spectators) render that player's top deck card face up while set.
        const revealed = !player.topDeckRevealed;
        ctx.db.Player.id.update({ ...player, topDeckRevealed: revealed });
        const game = ctx.db.Game.id.find(gameId);
        logAction(
          ctx,
          gameId,
          player.id,
          'TOGGLE_TOP_DECK_REVEAL',
          JSON.stringify({
            revealed,
            sourceCardName: source.cardName,
            sourceCardImgFile: source.cardImgFile,
          }),
          game ? game.currentTurn : 0n,
          game ? game.currentPhase : 'draw',
        );
        return;
      }
      case 'custom':
        throw new SenderError('Custom abilities are dispatched by the client, not this reducer');
    }
  },
);

// ---------------------------------------------------------------------------
// Reducer: execute_card_ability_with_count
//
// Variant of execute_card_ability for abilities whose count is chosen by the
// player at activation time (currently only draw_bottom_of_deck_choose).
// Validates the same ownership/zone preconditions, then dispatches to the
// underlying impl with the client-supplied count.
// ---------------------------------------------------------------------------
export const execute_card_ability_with_count = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    abilityIndex: t.u64(),
    chosenCount: t.u64(),
  },
  (ctx, { gameId, cardInstanceId, abilityIndex, chosenCount }) => {
    const player = findPlayerBySender(ctx, gameId);

    const source = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!source) throw new SenderError('Card not found');
    if (source.gameId !== gameId) throw new SenderError('Card not in this game');
    // Ownership intentionally not enforced — either player may activate a
    // card's right-click ability; effects route to the activator (player).

    const abilities = getEffectiveAbilities(source);
    const ability = abilities[Number(abilityIndex)];
    if (!ability) throw new SenderError('No such ability');

    // Per-ability sourceZones override — see execute_card_ability.
    const allowedZones = ability.sourceZones ?? ABILITY_SOURCE_ZONES;
    if (!allowedZones.includes(source.zone)) {
      throw new SenderError('Source card must be in play');
    }

    if (ability.type !== 'draw_bottom_of_deck_choose') {
      throw new SenderError('Ability does not accept a chosen count');
    }
    if (chosenCount < 1n) throw new SenderError('Count must be at least 1');

    drawBottomOfDeckImpl(
      ctx,
      source,
      { type: 'draw_bottom_of_deck', count: Number(chosenCount) },
      player,
      gameId,
    );
  },
);

// ---------------------------------------------------------------------------
// Reducer: resurrect_heroes
//
// Interactive ability (Emptying the Tombs / Redemption [National]). The client
// gathers the player's selection of Heroes across every player's discard pile
// and sends their instance ids as a JSON array. Each selected Hero returns to
// its OWN owner's Territory — ownerId never changes. Selections are re-validated
// server-side (must be in this game, in 'discard', and a Hero); invalid ids are
// skipped rather than aborting the whole batch.
// ---------------------------------------------------------------------------
export const resurrect_heroes = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    abilityIndex: t.u64(),
    selectedIdsJson: t.string(),
  },
  (ctx, { gameId, cardInstanceId, abilityIndex, selectedIdsJson }) => {
    const player = findPlayerBySender(ctx, gameId);

    const source = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!source) throw new SenderError('Card not found');
    if (source.gameId !== gameId) throw new SenderError('Card not in this game');
    // Ownership intentionally not enforced — either player may activate a
    // card's right-click ability; effects route to the activator (player).

    if (!ABILITY_SOURCE_ZONES.includes(source.zone)) {
      throw new SenderError('Source card must be in play');
    }

    const ability = getEffectiveAbilities(source)[Number(abilityIndex)];
    if (!ability) throw new SenderError('No such ability');
    if (ability.type !== 'resurrect_heroes') {
      throw new SenderError('Ability is not resurrect_heroes');
    }

    let selectedIds: string[];
    try {
      selectedIds = JSON.parse(selectedIdsJson);
    } catch {
      throw new SenderError('Invalid selection');
    }
    if (!Array.isArray(selectedIds) || selectedIds.length === 0) return;

    // Next Territory zoneIndex per owner — resurrected Heroes land sequentially
    // in their own owner's Territory.
    const maxIdxByOwner = new Map<bigint, bigint>();
    for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
      if (c.zone === 'territory') {
        const cur = maxIdxByOwner.get(c.ownerId);
        if (cur === undefined || c.zoneIndex > cur) maxIdxByOwner.set(c.ownerId, c.zoneIndex);
      }
    }

    // Normalized 0–1 coordinates (client scales to pixels). Stagger per owner.
    const STAGGER_X = 0.05;
    const STAGGER_Y = 0.03;
    const BASE_X = 0.3;
    const BASE_Y = 0.4;
    const placedByOwner = new Map<bigint, number>();

    let resurrectedCount = 0;
    const byOwner: Record<string, number> = {};
    for (const idStr of selectedIds) {
      let id: bigint;
      try { id = BigInt(idStr); } catch { continue; }
      const card = ctx.db.CardInstance.id.find(id);
      if (!card) continue;
      if (card.gameId !== gameId) continue;
      if (card.zone !== 'discard') continue;
      if (!isHeroCard({ cardType: card.cardType })) continue;

      const owner = card.ownerId;
      const nextIdx = (maxIdxByOwner.get(owner) ?? -1n) + 1n;
      maxIdxByOwner.set(owner, nextIdx);
      const placed = placedByOwner.get(owner) ?? 0;
      placedByOwner.set(owner, placed + 1);

      ctx.db.CardInstance.id.update({
        ...card,
        zone: 'territory',
        zoneIndex: nextIdx,
        posX: String(BASE_X + (placed + 1) * STAGGER_X),
        posY: String(BASE_Y + (placed + 1) * STAGGER_Y),
      });
      resurrectedCount++;
      byOwner[owner.toString()] = (byOwner[owner.toString()] ?? 0) + 1;
    }

    if (resurrectedCount === 0) return;

    const game = ctx.db.Game.id.find(gameId);
    if (game) {
      logAction(
        ctx, gameId, player.id, 'RESURRECT_HEROES',
        JSON.stringify({
          sourceInstanceId: source.id.toString(),
          sourceCardName: source.cardName,
          sourceCardImgFile: source.cardImgFile,
          count: resurrectedCount,
          byOwner,
        }),
        game.turnNumber, game.currentPhase,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Reducer: imitate_lost_soul
//
// Swaps the source Imitate Lost Soul's cardImgFile to the target's bespoke
// art when registered in IMITATE_SOUL_IMAGES; always sets imitatingName so
// GameCardNode can render a label overlay when no art was swapped. The
// source must be an Imitate variant (per IMITATE_ORIGINAL_IMG keys); the
// target must be a Lost Soul currently in a Land of Bondage.
// ---------------------------------------------------------------------------
export const imitate_lost_soul = spacetimedb.reducer(
  {
    gameId: t.u64(),
    sourceInstanceId: t.u64(),
    targetInstanceId: t.u64(),
  },
  (ctx, { gameId, sourceInstanceId, targetInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const source = ctx.db.CardInstance.id.find(sourceInstanceId);
    if (!source) throw new SenderError('Source card not found');
    if (source.gameId !== gameId) throw new SenderError('Source not in this game');
    // Ownership intentionally not enforced — either player may activate a
    // card's right-click ability; effects route to the activator (player).
    if (!(source.cardName in IMITATE_ORIGINAL_IMG)) {
      throw new SenderError('Source is not an Imitate Lost Soul');
    }
    if (!ABILITY_SOURCE_ZONES.includes(source.zone)) {
      throw new SenderError('Source card must be in play');
    }

    const target = ctx.db.CardInstance.id.find(targetInstanceId);
    if (!target) throw new SenderError('Target card not found');
    if (target.gameId !== gameId) throw new SenderError('Target not in this game');
    if (target.cardType !== 'Lost Soul') throw new SenderError('Target must be a Lost Soul');
    if (target.zone !== 'land-of-bondage') {
      throw new SenderError('Target must be in a Land of Bondage');
    }
    if (!isNewTestamentLostSoul(target.reference)) {
      throw new SenderError('Target must be a New Testament Lost Soul');
    }

    // When the target has registered art, swap to it. Otherwise fall back to
    // the *canonical* Imitate art (not source.cardImgFile, which could be a
    // stale swap URL from a prior imitation). Pairs with the label-gating in
    // GameCardNode (renders the label only when cardImgFile equals canonical).
    const registered = IMITATE_SOUL_IMAGES[target.cardName];
    const newImg = registered ?? IMITATE_ORIGINAL_IMG[source.cardName];

    // Store the FULL target cardName so the menu (via getEffectiveAbilities)
    // can resolve the imitated soul's right-click abilities. The simplified
    // label is computed at render time in GameCardNode.
    ctx.db.CardInstance.id.update({
      ...source,
      cardImgFile: newImg,
      imitatingName: target.cardName,
    });

    const game = ctx.db.Game.id.find(gameId);
    if (game) {
      logAction(
        ctx,
        gameId,
        player.id,
        'IMITATE_LOST_SOUL',
        JSON.stringify({
          targetCardName: target.cardName,
          label: simplifyLostSoulName(target.cardName),
          hasArt: !!registered,
        }),
        game.turnNumber,
        game.currentPhase,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Reducer: stop_imitating_lost_soul
//
// Reverts an Imitate Lost Soul's cardImgFile to the canonical value from
// IMITATE_ORIGINAL_IMG and clears imitatingName. Safe to call when the card
// is not currently imitating (idempotent: rewrites with the same values).
// ---------------------------------------------------------------------------
export const stop_imitating_lost_soul = spacetimedb.reducer(
  { gameId: t.u64(), sourceInstanceId: t.u64() },
  (ctx, { gameId, sourceInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const source = ctx.db.CardInstance.id.find(sourceInstanceId);
    if (!source) throw new SenderError('Source card not found');
    if (source.gameId !== gameId) throw new SenderError('Source not in this game');
    // Ownership intentionally not enforced — either player may activate a
    // card's right-click ability; effects route to the activator (player).

    const original = IMITATE_ORIGINAL_IMG[source.cardName];
    if (!original) throw new SenderError('Source is not an Imitate Lost Soul');

    ctx.db.CardInstance.id.update({
      ...source,
      cardImgFile: original,
      imitatingName: '',
    });

    const game = ctx.db.Game.id.find(gameId);
    if (game) {
      logAction(
        ctx,
        gameId,
        player.id,
        'STOP_IMITATING_LOST_SOUL',
        '{}',
        game.turnNumber,
        game.currentPhase,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Helper: moveLostSoulToLor
// Shared implementation for surrender_lost_soul and rescue_lost_soul. Moves a
// Lost Soul from a Land of Bondage into a target player's Land of Redemption,
// transferring ownership, clearing in-play state, unlinking any accessories,
// compacting source LoB indices, and refilling the shared Soul Deck when a
// Paragon shared soul is rescued. Mirrors move_card's land-of-redemption path.
// ---------------------------------------------------------------------------
function moveLostSoulToLor(
  ctx: any,
  gameId: bigint,
  card: any,
  targetOwnerId: bigint,
  game: any,
) {
  const fromZone = card.zone;
  const sourceOwnerId = card.ownerId;

  // Highest zoneIndex + 1 in the target's LoR so the rescued soul stacks on top.
  let maxIdx = -1n;
  for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
    if (c.ownerId === targetOwnerId && c.zone === 'land-of-redemption' && c.zoneIndex > maxIdx) {
      maxIdx = c.zoneIndex;
    }
  }
  const finalZoneIndex = maxIdx + 1n;

  clearCountersIfLeavingPlay(ctx, card.id, fromZone, 'land-of-redemption');
  ctx.db.CardInstance.id.update({
    ...card,
    zone: 'land-of-redemption',
    zoneIndex: finalZoneIndex,
    posX: '',
    posY: '',
    isFlipped: false,
    ownerId: targetOwnerId,
    equippedToInstanceId: card.equippedToInstanceId !== 0n ? 0n : card.equippedToInstanceId,
    revealExpiresAt: undefined,
    revealStartedAt: undefined,
    ...leavePlayFieldOverrides(card, fromZone, 'land-of-redemption'),
  });

  // Defensive cascade: any accessories still pointing at this soul lose their link.
  for (const accessory of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
    if (accessory.equippedToInstanceId === card.id) {
      ctx.db.CardInstance.id.update({ ...accessory, equippedToInstanceId: 0n });
    }
  }

  if (fromZone === 'land-of-bondage') {
    compactLobIndices(ctx, gameId, sourceOwnerId);
  }

  const triggeredRefill =
    normalizeFormat(game.format) === 'Paragon' &&
    card.isSoulDeckOrigin === true &&
    fromZone === 'land-of-bondage' &&
    sourceOwnerId === 0n;
  if (triggeredRefill) {
    refillSoulDeck(ctx, gameId);
  }

  // Rescue win: this soul just landed in someone's land-of-redemption.
  checkAndApplyWin(ctx, gameId);
}

// ---------------------------------------------------------------------------
// Reducer: surrender_lost_soul
// Sends a Lost Soul from the actor's (or shared Paragon) Land of Bondage to
// the opponent's Land of Redemption, transferring ownership. Logs a distinct
// SURRENDER_LOST_SOUL action so the chat reads "surrendered X" rather than
// the generic move text.
// ---------------------------------------------------------------------------
export const surrender_lost_soul = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const isLostSoul = card.cardType === 'LS' || card.cardType === 'TOKEN_LS' || card.cardName.toLowerCase().includes('lost soul');
    if (!isLostSoul) throw new SenderError('Card is not a Lost Soul');
    if (card.zone !== 'land-of-bondage') throw new SenderError('Card must be in Land of Bondage');

    // Surrender is allowed when the soul is yours OR it's a shared Paragon soul.
    const isShared = card.ownerId === 0n;
    if (!isShared && card.ownerId !== player.id) {
      throw new SenderError('You can only surrender your own Lost Souls');
    }

    const opponent = [...ctx.db.Player.player_game_id.filter(gameId)].find(
      (p: any) => p.id !== player.id,
    );
    if (!opponent) throw new SenderError('Opponent not found');

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const fromOwnerId = card.ownerId;
    moveLostSoulToLor(ctx, gameId, card, opponent.id, game);

    logAction(
      ctx, gameId, player.id, 'SURRENDER_LOST_SOUL',
      JSON.stringify({
        cardInstanceId: cardInstanceId.toString(),
        cardName: card.cardName,
        cardImgFile: card.cardImgFile,
        fromOwnerId: fromOwnerId.toString(),
        targetOwnerId: opponent.id.toString(),
      }),
      game.turnNumber, game.currentPhase,
    );
  },
);

// ---------------------------------------------------------------------------
// Reducer: rescue_lost_soul
// Sends a Lost Soul from the opponent's (or shared Paragon) Land of Bondage
// to the actor's Land of Redemption, transferring ownership. Logs a distinct
// RESCUE_LOST_SOUL action so the chat reads "rescued X".
// ---------------------------------------------------------------------------
export const rescue_lost_soul = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const isLostSoul = card.cardType === 'LS' || card.cardType === 'TOKEN_LS' || card.cardName.toLowerCase().includes('lost soul');
    if (!isLostSoul) throw new SenderError('Card is not a Lost Soul');
    if (card.zone !== 'land-of-bondage') throw new SenderError('Card must be in Land of Bondage');

    // Rescue applies to opponent souls or shared Paragon souls — never your own.
    const isShared = card.ownerId === 0n;
    if (!isShared && card.ownerId === player.id) {
      throw new SenderError('You cannot rescue your own Lost Souls');
    }

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const fromOwnerId = card.ownerId;
    moveLostSoulToLor(ctx, gameId, card, player.id, game);

    logAction(
      ctx, gameId, player.id, 'RESCUE_LOST_SOUL',
      JSON.stringify({
        cardInstanceId: cardInstanceId.toString(),
        cardName: card.cardName,
        cardImgFile: card.cardImgFile,
        fromOwnerId: fromOwnerId.toString(),
        targetOwnerId: player.id.toString(),
      }),
      game.turnNumber, game.currentPhase,
    );
  },
);

// ---------------------------------------------------------------------------
// Reducer: attach_card
// Generic "attach accessory to host" — supports warrior+weapon in Territory
// and soul+site in Land of Bondage. Parameter names stay `weaponInstanceId` /
// `warriorInstanceId` for backward compatibility with existing client calls,
// but semantically they are accessory/host.
//
// The accessory ends up in the host's zone with equippedToInstanceId pointing
// at the host. In Territory it inherits the host's position (render layer
// derives offsets); in LOB the positions are cleared (auto-arranged).
// Enforces one-accessory-per-host server-side.
// ---------------------------------------------------------------------------
export const attach_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
    weaponInstanceId: t.u64(),
    warriorInstanceId: t.u64(),
  },
  (ctx, { gameId, weaponInstanceId, warriorInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const accessory = ctx.db.CardInstance.id.find(weaponInstanceId);
    const host = ctx.db.CardInstance.id.find(warriorInstanceId);
    if (!accessory || !host) throw new SenderError('Card not found');
    if (accessory.gameId !== gameId || host.gameId !== gameId) {
      throw new SenderError('Card not in this game');
    }
    if (accessory.ownerId !== player.id || host.ownerId !== player.id) {
      throw new SenderError('Cannot attach opponent cards');
    }
    if (weaponInstanceId === warriorInstanceId) {
      throw new SenderError('Cannot attach a card to itself');
    }

    // Determine the "natural" zone where this attachment lives:
    //   - Sites attach to souls in Land of Bondage.
    //   - Weapons attach to warriors in Territory.
    // We infer from the accessory's cardType: any type containing "site" or
    // "city" → LOB; otherwise → Territory (the weapon+warrior case). Both
    // cards end up in the natural zone, even if one of them had to move from
    // somewhere else (e.g. soul in Territory being dragged onto site in LOB).
    const accessoryType = accessory.cardType.toLowerCase();
    const accessoryIsSite =
      accessoryType.includes('site') || accessoryType.includes('city');
    // A host already in Battle keeps the attachment inside the band — the
    // weapon/site joins the host in 'battle' instead of its normal home zone.
    // Spec §4.
    const attachZone: string =
      host.zone === 'battle' ? 'battle' : accessoryIsSite ? 'land-of-bondage' : 'territory';

    // Host must be coming from a sensible zone (Territory, LOB, Hand, Reserve,
    // LOR, or already in Battle). We'll move the host to the attach zone if
    // it's not already there.
    const validSourceZones = new Set([
      'territory',
      'land-of-bondage',
      'land-of-redemption',
      'hand',
      'reserve',
      'battle',
    ]);
    if (!validSourceZones.has(host.zone)) {
      throw new SenderError('Host not in a valid zone to attach');
    }

    // Cap at one accessory per host (UI enforces this too; server is the source of truth).
    const existing = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.equippedToInstanceId === warriorInstanceId && c.id !== weaponInstanceId
    );
    if (existing.length >= 1) {
      throw new SenderError('Host already has an accessory attached');
    }

    const accessoryFromZone = accessory.zone;
    const hostFromZone = host.zone;
    const compactOwners = {
      hand: new Set<bigint>(),
      lob: new Set<bigint>(),
    };

    // Move the HOST to the attach zone if it's not there yet.
    if (hostFromZone !== attachZone) {
      let hostMaxIdx = -1n;
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === player.id && c.zone === attachZone && c.zoneIndex > hostMaxIdx) {
          hostMaxIdx = c.zoneIndex;
        }
      }
      const hostInheritPos = attachZone === 'territory';
      ctx.db.CardInstance.id.update({
        ...host,
        zone: attachZone,
        zoneIndex: hostMaxIdx + 1n,
        posX: hostInheritPos ? host.posX : '',
        posY: hostInheritPos ? host.posY : '',
        isFlipped: false,
      });
      if (hostFromZone === 'hand') compactOwners.hand.add(player.id);
      if (hostFromZone === 'land-of-bondage') compactOwners.lob.add(player.id);
    }

    // Move the ACCESSORY to the attach zone (inheriting host's position in
    // Territory/Battle; cleared in LOB).
    let accMaxIdx = -1n;
    for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
      if (c.ownerId === player.id && c.zone === attachZone && c.zoneIndex > accMaxIdx) {
        accMaxIdx = c.zoneIndex;
      }
    }
    const inheritPos = attachZone === 'territory' || attachZone === 'battle';
    // Re-read host in case we just updated it, to get fresh posX/posY.
    const hostNow = ctx.db.CardInstance.id.find(warriorInstanceId);
    const hostPosX = hostNow?.posX ?? host.posX;
    const hostPosY = hostNow?.posY ?? host.posY;
    // Stamp the weapon's own battle-origin fields when it's joining a host
    // already in Battle. Uses the accessory's pre-move zone/pos (its own
    // origin, not the host's) and no-ops if the accessory is already in
    // 'battle'. Spec §4.
    const accessoryBattleUpdates: any = {};
    if (attachZone === 'battle') {
      stampBattleEntry(ctx, gameId, accessory, accessoryBattleUpdates);
    }
    ctx.db.CardInstance.id.update({
      ...accessory,
      zone: attachZone,
      zoneIndex: accMaxIdx + 1n,
      posX: inheritPos ? hostPosX : '',
      posY: inheritPos ? hostPosY : '',
      isFlipped: false,
      equippedToInstanceId: warriorInstanceId,
      ...accessoryBattleUpdates,
    });
    if (accessoryFromZone === 'hand') compactOwners.hand.add(player.id);
    if (accessoryFromZone === 'land-of-bondage' && attachZone !== 'land-of-bondage') {
      compactOwners.lob.add(player.id);
    }

    for (const ownerId of compactOwners.hand) compactHandIndices(ctx, gameId, ownerId);
    for (const ownerId of compactOwners.lob) compactLobIndices(ctx, gameId, ownerId);

    // Log the host move (if any) and the accessory move (if any) as MOVE_CARD
    // entries so the action log stays consistent with normal moves.
    if (hostFromZone !== attachZone) {
      logAction(
        ctx,
        gameId,
        player.id,
        'MOVE_CARD',
        JSON.stringify({
          cardInstanceId: warriorInstanceId.toString(),
          from: hostFromZone,
          to: attachZone,
          cardName: host.cardName,
          cardImgFile: host.cardImgFile,
        }),
        game.turnNumber,
        game.currentPhase
      );
    }
    if (accessoryFromZone !== attachZone) {
      logAction(
        ctx,
        gameId,
        player.id,
        'MOVE_CARD',
        JSON.stringify({
          cardInstanceId: weaponInstanceId.toString(),
          from: accessoryFromZone,
          to: attachZone,
          cardName: accessory.cardName,
          cardImgFile: accessory.cardImgFile,
        }),
        game.turnNumber,
        game.currentPhase
      );
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: detach_card
// Break the equip link on a weapon. The weapon stays in its current zone
// (typically Territory) at the client-supplied position, which lets the UI
// keep the weapon visually in place after the link is severed.
// ---------------------------------------------------------------------------
export const detach_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
    weaponInstanceId: t.u64(),
    posX: t.string(),
    posY: t.string(),
  },
  (ctx, { gameId, weaponInstanceId, posX, posY }) => {
    const player = findPlayerBySender(ctx, gameId);

    const weapon = ctx.db.CardInstance.id.find(weaponInstanceId);
    if (!weapon) throw new SenderError('Card not found');
    if (weapon.gameId !== gameId) throw new SenderError('Card not in this game');
    if (weapon.ownerId !== player.id) throw new SenderError('Not your card');

    ctx.db.CardInstance.id.update({
      ...weapon,
      equippedToInstanceId: 0n,
      posX: posX || weapon.posX,
      posY: posY || weapon.posY,
    });
  }
);

// ---------------------------------------------------------------------------
// Reducer: reorder_hand
// ---------------------------------------------------------------------------
export const reorder_hand = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardIds: t.string(), // JSON array of card instance IDs as strings, in desired order
  },
  (ctx, { gameId, cardIds }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const ids: string[] = JSON.parse(cardIds);

    for (let i = 0; i < ids.length; i++) {
      const cardId = BigInt(ids[i]);
      const card = ctx.db.CardInstance.id.find(cardId);
      if (!card) continue;
      if (card.gameId !== gameId) continue;
      if (card.ownerId !== player.id) continue; // Only reorder own cards
      if (card.zone !== 'hand') continue; // Only reorder hand cards
      ctx.db.CardInstance.id.update({ ...card, zoneIndex: BigInt(i) });
    }

  }
);

// ---------------------------------------------------------------------------
// Reducer: reorder_lob
// ---------------------------------------------------------------------------
export const reorder_lob = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardIds: t.string(), // JSON array of card instance IDs as strings, in desired order
  },
  (ctx, { gameId, cardIds }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const ids: string[] = JSON.parse(cardIds);

    for (let i = 0; i < ids.length; i++) {
      const cardId = BigInt(ids[i]);
      const card = ctx.db.CardInstance.id.find(cardId);
      if (!card) continue;
      if (card.gameId !== gameId) continue;
      if (card.ownerId !== player.id) continue; // Only reorder own cards
      if (card.zone !== 'land-of-bondage') continue; // Only reorder LOB cards
      ctx.db.CardInstance.id.update({ ...card, zoneIndex: BigInt(i) });
    }

    logAction(ctx, gameId, player.id, 'REORDER_LOB', JSON.stringify({ count: ids.length }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: shuffle_deck
// ---------------------------------------------------------------------------
export const shuffle_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    // Get all player's deck cards
    const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === player.id && c.zone === 'deck'
    );

    // Increment rng counter and create seed
    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });

    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, newRngCounter);

    // Shuffle zoneIndex values
    const indices = deckCards.map((_: any, idx: number) => idx);
    seededShuffle(indices, seed);

    for (let i = 0; i < deckCards.length; i++) {
      ctx.db.CardInstance.id.update({
        ...deckCards[i],
        zoneIndex: BigInt(indices[i]),
      });
    }

    logAction(ctx, gameId, player.id, 'SHUFFLE', '', game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: shuffle_soul_deck
// Paragon-only. Shuffles all shared soul-deck cards (ownerId=0n) in a single
// seeded pass. Either seat may invoke it (the Soul Deck is shared). Mirrors
// goldfish's client-side SHUFFLE_SOUL_DECK action but runs authoritatively.
// ---------------------------------------------------------------------------
export const shuffle_soul_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    // Still require the sender to be a player in the game (stops drive-bys), but
    // either seat is authorized since the Soul Deck is shared.
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (normalizeFormat(game.format) !== 'Paragon') {
      throw new SenderError('Soul Deck only exists in Paragon format');
    }

    const soulCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === 0n && c.zone === 'soul-deck'
    );
    if (soulCards.length === 0) return;

    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });

    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, 0n, newRngCounter);
    const indices = soulCards.map((_: any, idx: number) => idx);
    seededShuffle(indices, seed);

    for (let i = 0; i < soulCards.length; i++) {
      ctx.db.CardInstance.id.update({
        ...soulCards[i],
        zoneIndex: BigInt(indices[i]),
      });
    }

    logAction(ctx, gameId, player.id, 'SHUFFLE_SOUL_DECK', '', game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: shuffle_card_into_deck
// ---------------------------------------------------------------------------
export const shuffle_card_into_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const fromZone = card.zone;

    const game0 = ctx.db.Game.id.find(gameId);
    if (!game0) throw new SenderError('Game not found');

    // Tokens can't be shuffled into a deck — delete the token instead.
    if (card.isToken) {
      deleteTokenWithCounters(ctx, card);
      if (fromZone === 'hand') compactHandIndices(ctx, gameId, card.ownerId);
      if (fromZone === 'land-of-bondage') compactLobIndices(ctx, gameId, card.ownerId);
      logAction(ctx, gameId, player.id, 'SHUFFLE_INTO_DECK', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: card.cardName, cardImgFile: card.cardImgFile, tokenCleanup: true, deckOwnerId: (card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId).toString() }), game0.turnNumber, game0.currentPhase);
      return;
    }

    // Route into the original owner's deck so a taken opponent card
    // shuffles back into the opponent's deck, not the controller's.
    const deckOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;
    clearCountersIfLeavingPlay(ctx, card.id, fromZone, 'deck');
    ctx.db.CardInstance.id.update({
      ...card,
      zone: 'deck',
      ownerId: deckOwnerId,
      isFlipped: true,
      revealExpiresAt: undefined,
      revealStartedAt: undefined,
      ...leavePlayFieldOverrides(card, fromZone, 'deck'),
    });

    // Now shuffle the deck owner's entire deck (same logic as shuffle_deck)
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === deckOwnerId && c.zone === 'deck'
    );

    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });

    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, deckOwnerId, newRngCounter);

    const indices = deckCards.map((_: any, idx: number) => idx);
    seededShuffle(indices, seed);

    for (let i = 0; i < deckCards.length; i++) {
      ctx.db.CardInstance.id.update({
        ...deckCards[i],
        zoneIndex: BigInt(indices[i]),
      });
    }

    // Compact hand indices if card left hand
    if (fromZone === 'hand') {
      compactHandIndices(ctx, gameId, deckOwnerId);
    }
    // Compact LOB indices if card left LOB
    if (fromZone === 'land-of-bondage') {
      compactLobIndices(ctx, gameId, deckOwnerId);
    }

    // Mirror move_card's hideIdentity rule: when a player shuffles a card from
    // their own hand into their own deck, the name is private — opponents never
    // saw it. Cross-player shuffles (e.g. a taken card sent back to opponent's
    // deck) reveal identity because the card was visible in play.
    const isCrossPlayerMove = player.id !== card.ownerId || player.id !== deckOwnerId;
    const hideIdentity = !isCrossPlayerMove && fromZone === 'hand' && player.id === card.ownerId;
    const logName = hideIdentity ? 'a face-down card' : card.cardName;
    const logImg = hideIdentity ? '' : card.cardImgFile;
    logAction(ctx, gameId, player.id, 'SHUFFLE_INTO_DECK', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: logName, cardImgFile: logImg, deckOwnerId: deckOwnerId.toString() }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: random_hand_to_zone
// ---------------------------------------------------------------------------
export const random_hand_to_zone = spacetimedb.reducer(
  {
    gameId: t.u64(),
    count: t.u64(),
    toZone: t.string(),
    deckPosition: t.string(),
  },
  (ctx, { gameId, count, toZone, deckPosition }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    const handCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === player.id && c.zone === 'hand'
    );

    if (handCards.length === 0) throw new SenderError('No cards in hand');
    const actualCount = Math.min(Number(count), handCards.length);

    // Use seeded PRNG to pick random cards
    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });
    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, newRngCounter);
    const rng = xorshift64(seed);

    // Fisher-Yates partial shuffle to select random indices
    const indices = handCards.map((_: any, i: number) => i);
    for (let i = indices.length - 1; i > indices.length - 1 - actualCount && i > 0; i--) {
      const j = Number(rng.next() % BigInt(i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const pickedCards = indices.slice(indices.length - actualCount).map((i: number) => handCards[i]);

    // Get max deck zoneIndex for bottom placement
    let maxDeckIndex = 0n;
    if (toZone === 'deck') {
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === player.id && c.zone === 'deck' && c.zoneIndex > maxDeckIndex) {
          maxDeckIndex = c.zoneIndex;
        }
      }
    }

    const movedCards: { name: string; img: string }[] = [];
    for (let i = 0; i < pickedCards.length; i++) {
      const card = pickedCards[i];
      movedCards.push({ name: card.cardName, img: card.cardImgFile });

      let newZoneIndex = 0n;
      if (toZone === 'deck') {
        if (deckPosition === 'top') {
          newZoneIndex = BigInt(-(i + 1));
        } else if (deckPosition === 'bottom') {
          newZoneIndex = maxDeckIndex + BigInt(i + 1);
        }
      }

      ctx.db.CardInstance.id.update({
        ...card,
        zone: toZone,
        zoneIndex: newZoneIndex,
        posX: '',
        posY: '',
        revealExpiresAt: undefined,
      revealStartedAt: undefined,
      });
    }

    // If shuffle into deck, shuffle entire deck
    if (toZone === 'deck' && deckPosition === 'shuffle') {
      const latestGame = ctx.db.Game.id.find(gameId);
      if (!latestGame) return;
      const shuffleRng = latestGame.rngCounter + 1n;
      ctx.db.Game.id.update({ ...latestGame, rngCounter: shuffleRng });

      const allDeckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.ownerId === player.id && c.zone === 'deck'
      );
      const shuffleIndices = allDeckCards.map((_: any, idx: number) => idx);
      const shuffleSeed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, shuffleRng);
      seededShuffle(shuffleIndices, shuffleSeed);
      for (let i = 0; i < allDeckCards.length; i++) {
        ctx.db.CardInstance.id.update({ ...allDeckCards[i], zoneIndex: BigInt(shuffleIndices[i]) });
      }
    }

    // Compact hand indices after cards were removed from hand
    compactHandIndices(ctx, gameId, player.id);

    const destLabel = toZone === 'deck' ? `deck (${deckPosition})` : toZone;
    logAction(ctx, gameId, player.id, 'RANDOM_HAND_TO_ZONE',
      JSON.stringify({ cards: movedCards, destination: destLabel, count: actualCount }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: random_opponent_hand_to_zone
// Authorised via an approved ZoneSearchRequest — the requester moves random
// cards from the target's hand to a destination zone. Mirrors random_hand_to_zone
// but operates on the request's targetPlayerId.
// ---------------------------------------------------------------------------
export const random_opponent_hand_to_zone = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
    count: t.u64(),
    toZone: t.string(),
    deckPosition: t.string(),
  },
  (ctx, { gameId, requestId, count, toZone, deckPosition }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Search request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.requesterId !== player.id) throw new SenderError('Not your search request');
    if (req.status !== 'approved') throw new SenderError('Search request not approved');

    const targetId = req.targetPlayerId;

    const handCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === targetId && c.zone === 'hand'
    );

    if (handCards.length === 0) throw new SenderError('Target has no cards in hand');
    const actualCount = Math.min(Number(count), handCards.length);

    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });
    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, targetId, newRngCounter);
    const rng = xorshift64(seed);

    const indices = handCards.map((_: any, i: number) => i);
    for (let i = indices.length - 1; i > indices.length - 1 - actualCount && i > 0; i--) {
      const j = Number(rng.next() % BigInt(i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const pickedCards = indices.slice(indices.length - actualCount).map((i: number) => handCards[i]);

    let maxDeckIndex = 0n;
    if (toZone === 'deck') {
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === targetId && c.zone === 'deck' && c.zoneIndex > maxDeckIndex) {
          maxDeckIndex = c.zoneIndex;
        }
      }
    }

    for (let i = 0; i < pickedCards.length; i++) {
      const card = pickedCards[i];

      let newZoneIndex = 0n;
      if (toZone === 'deck') {
        if (deckPosition === 'top') {
          newZoneIndex = BigInt(-(i + 1));
        } else if (deckPosition === 'bottom') {
          newZoneIndex = maxDeckIndex + BigInt(i + 1);
        }
      }

      ctx.db.CardInstance.id.update({
        ...card,
        zone: toZone,
        zoneIndex: newZoneIndex,
        posX: '',
        posY: '',
        isFlipped: toZone === 'deck' || toZone === 'reserve' ? true : card.isFlipped,
        revealExpiresAt: undefined,
      revealStartedAt: undefined,
      });
    }

    if (toZone === 'deck' && deckPosition === 'shuffle') {
      const latestGame = ctx.db.Game.id.find(gameId);
      if (!latestGame) return;
      const shuffleRng = latestGame.rngCounter + 1n;
      ctx.db.Game.id.update({ ...latestGame, rngCounter: shuffleRng });

      const allDeckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.ownerId === targetId && c.zone === 'deck'
      );
      const shuffleIndices = allDeckCards.map((_: any, idx: number) => idx);
      const shuffleSeed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, targetId, shuffleRng);
      seededShuffle(shuffleIndices, shuffleSeed);
      for (let i = 0; i < allDeckCards.length; i++) {
        ctx.db.CardInstance.id.update({ ...allDeckCards[i], zoneIndex: BigInt(shuffleIndices[i]) });
      }
    }

    compactHandIndices(ctx, gameId, targetId);

    const destLabel = toZone === 'deck' ? `deck (${deckPosition})` : toZone;
    logAction(ctx, gameId, player.id, 'RANDOM_OPPONENT_HAND_TO_ZONE',
      JSON.stringify({ destination: destLabel, count: actualCount, targetPlayerId: targetId.toString() }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: opponent_shuffle_and_draw
// Authorised via an approved ZoneSearchRequest (action='shuffle_and_draw').
// Applies a shuffle-N-and-draw-N effect to the target player (opponent of the
// caster). Used by the Mayhem ability after opponent consent.
// ---------------------------------------------------------------------------
export const opponent_shuffle_and_draw = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
    shuffleCount: t.u64(),
    drawCount: t.u64(),
  },
  (ctx, { gameId, requestId, shuffleCount, drawCount }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Search request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.requesterId !== player.id) throw new SenderError('Not your search request');
    if (req.status !== 'approved') throw new SenderError('Search request not approved');

    const allPlayers = [...ctx.db.Player.player_game_id.filter(gameId)];
    const target = allPlayers.find((p: any) => p.id === req.targetPlayerId);
    if (!target) throw new SenderError('Target player not found');

    shuffleAndDrawForPlayerImpl(ctx, gameId, target, Number(shuffleCount), Number(drawCount));
  }
);

// ---------------------------------------------------------------------------
// Reducer: keep_one_shuffle_draw
// Caster half of all_players_keep_one_shuffle_draw (Philip's Daughters).
// The caster picks their keeper client-side; the rest of their hand shuffles
// into their deck and they draw that many back. A ZoneSearchRequest
// (action='keep_one_shuffle_draw') then asks the opponent to do the same.
//
// Unlike Mayhem's opponent_shuffle_and_draw — where the cards are random so
// the caster can fire the opponent's half — each player must choose their own
// keeper, so the follow-up reducer is fired by the TARGET.
// ---------------------------------------------------------------------------
export const keep_one_shuffle_draw = spacetimedb.reducer(
  {
    gameId: t.u64(),
    sourceInstanceId: t.u64(),
    keepInstanceId: t.u64(),
  },
  (ctx, { gameId, sourceInstanceId, keepInstanceId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    const source = ctx.db.CardInstance.id.find(sourceInstanceId);
    if (!source || source.gameId !== gameId) throw new SenderError('Source card not found');
    if (!getEffectiveAbilities(source).some((a) => a.type === 'all_players_keep_one_shuffle_draw')) {
      throw new SenderError('No such ability');
    }

    // Don't stack requests if the caster already has one pending. Checked
    // before the effect so a rejected call can't half-apply — the reducer is
    // transactional, but keeping the guard first makes the intent explicit.
    const allPlayers = [...ctx.db.Player.player_game_id.filter(gameId)];
    const opponent = allPlayers.find((p: any) => p.id !== player.id);
    if (opponent) {
      for (const req of ctx.db.ZoneSearchRequest.zone_search_request_game_id.filter(gameId)) {
        if (req.requesterId === player.id && req.status === 'pending') {
          throw new SenderError('You already have a pending request');
        }
      }
    }

    shuffleAndDrawForPlayerImpl(ctx, gameId, player, 0, 0, keepInstanceId);

    if (opponent) {
      ctx.db.ZoneSearchRequest.insert({
        id: 0n,
        gameId,
        requesterId: player.id,
        targetPlayerId: opponent.id,
        zone: 'deck',
        status: 'pending',
        createdAt: ctx.timestamp,
        action: 'keep_one_shuffle_draw',
        actionParams: '{}',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: opponent_keep_one_shuffle_draw
// Target half of Philip's Daughters, fired by the TARGET after they approve
// the request and pick their own keeper. complete_zone_search only accepts the
// requester, so this reducer clears the request row itself.
// ---------------------------------------------------------------------------
export const opponent_keep_one_shuffle_draw = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
    keepInstanceId: t.u64(),
  },
  (ctx, { gameId, requestId, keepInstanceId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Search request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.targetPlayerId !== player.id) throw new SenderError('Not your request to answer');
    if (req.status !== 'approved') throw new SenderError('Search request not approved');
    if (req.action !== 'keep_one_shuffle_draw') throw new SenderError('Wrong action type');

    shuffleAndDrawForPlayerImpl(ctx, gameId, player, 0, 0, keepInstanceId);

    ctx.db.ZoneSearchRequest.id.delete(requestId);
  }
);

// ---------------------------------------------------------------------------
// Reducer: three_nails_reset_execute
// Authorised via an approved ZoneSearchRequest (action='three_nails_reset').
// Banishes the source reset card (any card registered with a
// three_nails_reset ability — Three Nails (GoC), A New Beginning (FoM)),
// then for each player sweeps their hand + territory + land-of-bondage into
// their deck (lost souls owned by the shared paragon soul-deck route back
// there), reshuffles, and draws 8.
// Dispatched by the requester after the opponent approves.
// ---------------------------------------------------------------------------
export const three_nails_reset_execute = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
  },
  (ctx, { gameId, requestId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Search request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.requesterId !== player.id) throw new SenderError('Not your search request');
    if (req.status !== 'approved') throw new SenderError('Search request not approved');
    if (req.action !== 'three_nails_reset') throw new SenderError('Wrong action type');

    // Parse sourceInstanceId from actionParams
    let sourceInstanceId: bigint;
    try {
      const params = JSON.parse(req.actionParams);
      sourceInstanceId = BigInt(params.sourceInstanceId);
    } catch {
      throw new SenderError('Invalid actionParams');
    }

    // Locate the reset card — verify it carries a three_nails_reset ability,
    // is still in a zone it can fire from, and is owned by the requester.
    // Not territory-only: Three Nails (GoC) is an Artifact and A New Beginning
    // (FoM) a Dominant, but A New Beginning [RR2] is a Good Enhancement played
    // into battle, so the source can legitimately sit in the battle zone.
    const source = ctx.db.CardInstance.id.find(sourceInstanceId);
    if (
      !source ||
      source.gameId !== gameId ||
      source.ownerId !== player.id ||
      !getEffectiveAbilities(source).some((a) => a.type === 'three_nails_reset') ||
      !ABILITY_SOURCE_ZONES.includes(source.zone)
    ) {
      // No-op path: the reset card was moved/negated mid-flight.
      logAction(
        ctx, gameId, player.id, 'THREE_NAILS_RESET_CANCELLED',
        JSON.stringify({ reason: 'source_card_not_in_play', cardName: source?.cardName, zone: source?.zone }),
        game.turnNumber, game.currentPhase,
      );
      // Leave request cleanup to complete_zone_search (client responsibility).
      return;
    }

    // Banish the reset card — clear in-play state before it leaves its zone.
    const sourceZone = source.zone;
    clearCountersIfLeavingPlay(ctx, source.id, sourceZone, 'banish');

    ctx.db.CardInstance.id.update({
      ...source,
      ...leavePlayFieldOverrides(source, sourceZone, 'banish'),
      zone: 'banish',
      zoneIndex: 0n,
      posX: '',
      posY: '',
      isFlipped: false,
      equippedToInstanceId: 0n,
    });

    const allPlayers = [...ctx.db.Player.player_game_id.filter(gameId)];
    const SWEEP_ZONES = new Set(['hand', 'territory', 'land-of-bondage']);

    // Track swept card IDs for defensive cascade below.
    // Include the source (the reset card) so accessories linked to it are also cleared.
    const sweptIds = new Set<bigint>([sourceInstanceId]);

    for (const card of [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)]) {
      if (card.id === sourceInstanceId) continue; // already banished
      if (!SWEEP_ZONES.has(card.zone)) continue;

      // Routing: shared-paragon souls (ownerId === 0n sentinel) → soul-deck.
      // All other cards → owner's deck.
      const ownerIsActivePlayer = allPlayers.some((p: any) => p.id === card.ownerId);
      const targetZone = ownerIsActivePlayer ? 'deck' : 'soul-deck';

      clearCountersIfLeavingPlay(ctx, card.id, card.zone, targetZone);

      ctx.db.CardInstance.id.update({
        ...card,
        ...leavePlayFieldOverrides(card, card.zone, targetZone),
        zone: targetZone,
        zoneIndex: 0n,
        posX: '',
        posY: '',
        isFlipped: true,
        equippedToInstanceId: 0n,
      });

      sweptIds.add(card.id);
    }

    // Defensive cascade — clear stale equippedToInstanceId on any card pointing
    // at a swept card. Cards already in non-sweep zones (deck, discard, etc.)
    // holding a link into the sweep set get their link cleared.
    for (const card of [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)]) {
      if (card.equippedToInstanceId !== 0n && sweptIds.has(card.equippedToInstanceId)) {
        ctx.db.CardInstance.id.update({ ...card, equippedToInstanceId: 0n });
      }
    }

    // Reshuffle each player's deck and draw 8.
    // shuffleAndDrawForPlayerImpl with shuffleCount=0 skips moving hand cards
    // (there are none left after the sweep above) then reshuffles the entire
    // deck and draws drawCount.
    for (const target of allPlayers) {
      shuffleAndDrawForPlayerImpl(ctx, gameId, target, 0, 8);
    }

    // Leave request cleanup to complete_zone_search (client responsibility).

    const finalGame = ctx.db.Game.id.find(gameId);
    if (finalGame) {
      logAction(
        ctx, gameId, player.id, 'THREE_NAILS_RESET',
        JSON.stringify({ requesterId: player.id.toString(), cardName: source.cardName }),
        finalGame.turnNumber, finalGame.currentPhase,
      );
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: discard_reserve_characters_execute
// Authorised via an approved ZoneSearchRequest (action='discard_reserve_characters').
// Darius' Decree "discard all characters from a Reserve" targeting the
// OPPONENT's reserve requires opponent consent. Dispatched by the requester
// after the opponent approves. Reuses discardCharactersFromReserveImpl with
// target='opponent'. Self-reserve activations skip this and fire immediately
// through execute_card_ability.
// ---------------------------------------------------------------------------
export const discard_reserve_characters_execute = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
  },
  (ctx, { gameId, requestId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Search request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.requesterId !== player.id) throw new SenderError('Not your search request');
    if (req.status !== 'approved') throw new SenderError('Search request not approved');
    if (req.action !== 'discard_reserve_characters') throw new SenderError('Wrong action type');

    // Parse sourceInstanceId from actionParams.
    let sourceInstanceId: bigint;
    try {
      const params = JSON.parse(req.actionParams);
      sourceInstanceId = BigInt(params.sourceInstanceId);
    } catch {
      throw new SenderError('Invalid actionParams');
    }

    // Verify the source (Darius' Decree) is still in play and owned by the
    // requester. No-op if it moved/was negated mid-flight; leave request
    // cleanup to complete_zone_search (client responsibility).
    const source = ctx.db.CardInstance.id.find(sourceInstanceId);
    if (
      !source ||
      source.gameId !== gameId ||
      source.ownerId !== player.id ||
      !ABILITY_SOURCE_ZONES.includes(source.zone)
    ) {
      logAction(
        ctx, gameId, player.id, 'DISCARD_CHARACTERS_FROM_RESERVE_CANCELLED',
        JSON.stringify({ reason: 'source_card_unavailable' }),
        game.turnNumber, game.currentPhase,
      );
      return;
    }

    discardCharactersFromReserveImpl(
      ctx, source, { type: 'discard_characters_from_reserve', target: 'opponent' }, player, gameId,
    );
    // Leave request cleanup to complete_zone_search (client responsibility).
  }
);

// ---------------------------------------------------------------------------
// Reducer: random_reserve_to_zone
// ---------------------------------------------------------------------------
export const random_reserve_to_zone = spacetimedb.reducer(
  {
    gameId: t.u64(),
    count: t.u64(),
    toZone: t.string(),
    deckPosition: t.string(),
  },
  (ctx, { gameId, count, toZone, deckPosition }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    const reserveCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === player.id && c.zone === 'reserve'
    );

    if (reserveCards.length === 0) throw new SenderError('No cards in reserve');
    const actualCount = Math.min(Number(count), reserveCards.length);

    // Use seeded PRNG to pick random cards
    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });
    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, newRngCounter);
    const rng = xorshift64(seed);

    // Fisher-Yates partial shuffle to select random indices
    const indices = reserveCards.map((_: any, i: number) => i);
    for (let i = indices.length - 1; i > indices.length - 1 - actualCount && i > 0; i--) {
      const j = Number(rng.next() % BigInt(i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    const pickedCards = indices.slice(indices.length - actualCount).map((i: number) => reserveCards[i]);

    // Get max deck zoneIndex for bottom placement
    let maxDeckIndex = 0n;
    if (toZone === 'deck') {
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === player.id && c.zone === 'deck' && c.zoneIndex > maxDeckIndex) {
          maxDeckIndex = c.zoneIndex;
        }
      }
    }

    const movedNames: string[] = [];
    for (let i = 0; i < pickedCards.length; i++) {
      const card = pickedCards[i];
      movedNames.push(card.cardName);

      let newZoneIndex = 0n;
      if (toZone === 'deck') {
        if (deckPosition === 'top') {
          newZoneIndex = BigInt(-(i + 1));
        } else if (deckPosition === 'bottom') {
          newZoneIndex = maxDeckIndex + BigInt(i + 1);
        }
      }

      ctx.db.CardInstance.id.update({
        ...card,
        zone: toZone,
        zoneIndex: newZoneIndex,
        posX: '',
        posY: '',
      });
    }

    // If shuffle into deck, shuffle entire deck
    if (toZone === 'deck' && deckPosition === 'shuffle') {
      const latestGame = ctx.db.Game.id.find(gameId);
      if (!latestGame) return;
      const shuffleRng = latestGame.rngCounter + 1n;
      ctx.db.Game.id.update({ ...latestGame, rngCounter: shuffleRng });

      const allDeckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.ownerId === player.id && c.zone === 'deck'
      );
      const shuffleIndices = allDeckCards.map((_: any, idx: number) => idx);
      const shuffleSeed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, shuffleRng);
      seededShuffle(shuffleIndices, shuffleSeed);
      for (let i = 0; i < allDeckCards.length; i++) {
        ctx.db.CardInstance.id.update({ ...allDeckCards[i], zoneIndex: BigInt(shuffleIndices[i]) });
      }
    }

    const destLabel = toZone === 'deck' ? `deck (${deckPosition})` : toZone;
    logAction(ctx, gameId, player.id, 'RANDOM_RESERVE_TO_ZONE',
      JSON.stringify({ cards: movedNames, destination: destLabel, count: actualCount }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: reload_deck
// ---------------------------------------------------------------------------
export const reload_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    deckId: t.string(),
    deckData: t.string(),
    paragon: t.string(),
  },
  (ctx, { gameId, deckId, deckData, paragon }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing' && game.status !== 'finished') throw new SenderError('Game is not in progress');

    const player = findPlayerBySender(ctx, gameId);

    // Validate deck data
    try { JSON.parse(deckData); } catch {
      throw new SenderError('Invalid deck data');
    }

    // 1. Delete all card instances and counters for this player
    for (const card of [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)]) {
      if (card.ownerId !== player.id) continue;
      for (const counter of [...ctx.db.CardCounter.card_counter_card_instance_id.filter(card.id)]) {
        ctx.db.CardCounter.id.delete(counter.id);
      }
      ctx.db.CardInstance.id.delete(card.id);
    }

    // 2. Update player's deck ID and paragon so the ParagonDrawer refreshes
    ctx.db.Player.id.update({ ...player, deckId, paragon });

    // 3. Insert new cards, shuffle, draw opening hand (reuses existing helper)
    const currentGame = ctx.db.Game.id.find(gameId);
    if (!currentGame) throw new SenderError('Game not found');
    insertCardsShuffleDraw(ctx, currentGame, player, deckData);

    logAction(ctx, gameId, player.id, 'RELOAD_DECK',
      JSON.stringify({ deckId }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: meek_card
// ---------------------------------------------------------------------------
export const meek_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    ctx.db.CardInstance.id.update({ ...card, isMeek: true });

    if (card.zone === 'hand') return;

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    logAction(ctx, gameId, player.id, 'MEEK', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: card.cardName, cardImgFile: card.cardImgFile }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: unmeek_card
// ---------------------------------------------------------------------------
export const unmeek_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    ctx.db.CardInstance.id.update({ ...card, isMeek: false });

    if (card.zone === 'hand') return;

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    logAction(ctx, gameId, player.id, 'UNMEEK', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: card.cardName, cardImgFile: card.cardImgFile }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: flip_card
// ---------------------------------------------------------------------------
export const flip_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const newFlipped = !card.isFlipped;
    // Flipping a card face-down turns it into a generic face-down card: drop any
    // player-added text and clear all counters. Flipping back face-up just
    // reveals the card — nothing to restore.
    if (newFlipped) {
      for (const counter of [...ctx.db.CardCounter.card_counter_card_instance_id.filter(cardInstanceId)]) {
        ctx.db.CardCounter.id.delete(counter.id);
      }
    }
    ctx.db.CardInstance.id.update({
      ...card,
      isFlipped: newFlipped,
      notes: newFlipped ? '' : card.notes,
    });

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const flipPayload: Record<string, string | boolean> = { cardInstanceId: cardInstanceId.toString(), isFlipped: newFlipped };
    if (!newFlipped) {
      // Flipping face-up — include card identity
      flipPayload.cardName = card.cardName;
      flipPayload.cardImgFile = card.cardImgFile;
    }
    logAction(ctx, gameId, player.id, 'FLIP', JSON.stringify(flipPayload), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: reveal_card_in_hand
// ---------------------------------------------------------------------------
// Temporarily reveals a single hand card to opponents/spectators for a fixed
// duration. Server-authoritative via reveal_expires_at; clients compare the
// timestamp against their local clock. Clears automatically whenever a
// move-out-of-hand reducer runs.
export const reveal_card_in_hand = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');
    if (card.ownerId !== player.id) throw new SenderError('Not your card');
    if (card.zone !== 'hand') throw new SenderError('Card must be in hand');

    // Fixed 30 second duration. Timestamps use microseconds since Unix epoch.
    const THIRTY_SECONDS_MICROS = 30_000_000n;
    const expiresAtMicros =
      ctx.timestamp.microsSinceUnixEpoch + THIRTY_SECONDS_MICROS;

    ctx.db.CardInstance.id.update({
      ...card,
      revealExpiresAt: new Timestamp(expiresAtMicros),
      revealStartedAt: ctx.timestamp,
    });

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    const payload = {
      cardInstanceId: cardInstanceId.toString(),
      cardName: card.cardName,
      cardImgFile: card.cardImgFile,
      expiresAtMicros: expiresAtMicros.toString(),
    };
    logAction(ctx, gameId, player.id, 'REVEAL_CARD', JSON.stringify(payload), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: update_card_position
// ---------------------------------------------------------------------------
export const update_card_position = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    posX: t.string(),
    posY: t.string(),
  },
  (ctx, { gameId, cardInstanceId, posX, posY }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    // Bump zoneIndex to max + 1 so repositioned card renders on top for all clients
    let maxIdx = -1n;
    for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
      if (c.ownerId === card.ownerId && c.zone === card.zone && c.zoneIndex > maxIdx) {
        maxIdx = c.zoneIndex;
      }
    }
    ctx.db.CardInstance.id.update({ ...card, posX, posY, zoneIndex: maxIdx + 1n });
    // No logAction — too noisy
  }
);

// ---------------------------------------------------------------------------
// Reducer: add_counter
// ---------------------------------------------------------------------------
export const add_counter = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    color: t.string(),
  },
  (ctx, { gameId, cardInstanceId, color }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    // Find existing counter for this card+color
    let existingCounter: any = null;
    for (const counter of ctx.db.CardCounter.card_counter_card_instance_id.filter(cardInstanceId)) {
      if (counter.color === color) {
        existingCounter = counter;
        break;
      }
    }

    if (existingCounter) {
      ctx.db.CardCounter.id.update({ ...existingCounter, count: existingCounter.count + 1n });
    } else {
      ctx.db.CardCounter.insert({
        id: 0n,
        cardInstanceId,
        color,
        count: 1n,
      });
    }

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    logAction(ctx, gameId, player.id, 'ADD_COUNTER', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), color, cardName: card.cardName, cardImgFile: card.cardImgFile }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: remove_counter
// ---------------------------------------------------------------------------
export const remove_counter = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    color: t.string(),
  },
  (ctx, { gameId, cardInstanceId, color }) => {
    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    let existingCounter: any = null;
    for (const counter of ctx.db.CardCounter.card_counter_card_instance_id.filter(cardInstanceId)) {
      if (counter.color === color) {
        existingCounter = counter;
        break;
      }
    }

    if (!existingCounter) throw new SenderError('No counter of that color found');

    if (existingCounter.count <= 1n) {
      ctx.db.CardCounter.id.delete(existingCounter.id);
    } else {
      ctx.db.CardCounter.id.update({ ...existingCounter, count: existingCounter.count - 1n });
    }

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    logAction(ctx, gameId, player.id, 'REMOVE_COUNTER', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), color, cardName: card.cardName, cardImgFile: card.cardImgFile }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: set_note
// ---------------------------------------------------------------------------
export const set_note = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
    text: t.string(),
  },
  (ctx, { gameId, cardInstanceId, text }) => {
    const player = findPlayerBySender(ctx, gameId);

    const trimmed = text.trim();
    if (trimmed.length > 40) throw new SenderError('Note too long (max 40 chars)');

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const previousNote = card.notes;
    ctx.db.CardInstance.id.update({ ...card, notes: trimmed });

    // The note pill is public, but a face-down or in-hand card's identity is
    // not — omit it from the log (mirrors flip_card/meek_card).
    const notePayload: Record<string, string> = {
      cardInstanceId: cardInstanceId.toString(),
      note: trimmed,
      previousNote,
    };
    if (!card.isFlipped && card.zone !== 'hand') {
      notePayload.cardName = card.cardName;
      notePayload.cardImgFile = card.cardImgFile;
    }
    logAction(
      ctx,
      gameId,
      player.id,
      'SET_NOTE',
      JSON.stringify(notePayload),
      game.turnNumber,
      game.currentPhase,
    );
  }
);

// ---------------------------------------------------------------------------
// Reducer: exchange_cards
// ---------------------------------------------------------------------------
export const exchange_cards = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceIds: t.string(),
  },
  (ctx, { gameId, cardInstanceIds }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const ids: string[] = JSON.parse(cardInstanceIds);

    // Validate ownership of each card
    for (const idStr of ids) {
      const cardId = BigInt(idStr);
      const card = ctx.db.CardInstance.id.find(cardId);
      if (!card) throw new SenderError('Card not found: ' + idStr);
      if (card.gameId !== gameId) throw new SenderError('Card not in this game: ' + idStr);
    }

    // Collect card details for the log BEFORE mutating. Each card's home
    // owner is captured so taken opponent cards log as going to the opponent's
    // deck, not the actor's.
    const exchangedCards: { name: string; img: string; fromZone: string; deckOwnerId: string }[] = [];
    const affectedDeckOwners = new Set<bigint>();
    for (const idStr of ids) {
      const card = ctx.db.CardInstance.id.find(BigInt(idStr));
      if (!card) continue;
      const deckOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;
      exchangedCards.push({ name: card.cardName, img: card.cardImgFile, fromZone: card.zone, deckOwnerId: deckOwnerId.toString() });
      affectedDeckOwners.add(deckOwnerId);
    }

    // Move all cards to their home-owner's deck, flipped
    for (const idStr of ids) {
      const cardId = BigInt(idStr);
      const card = ctx.db.CardInstance.id.find(cardId);
      if (!card) continue;
      const deckOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;
      const fromZone = card.zone;
      clearCountersIfLeavingPlay(ctx, card.id, fromZone, 'deck');
      ctx.db.CardInstance.id.update({
        ...card,
        zone: 'deck',
        ownerId: deckOwnerId,
        isFlipped: true,
        ...leavePlayFieldOverrides(card, fromZone, 'deck'),
      });
    }

    // Shuffle every deck that received a card (acting player's deck always,
    // plus any opponent decks when taken cards are exchanged back).
    let rngCounter = game.rngCounter;
    for (const deckOwnerId of affectedDeckOwners) {
      rngCounter += 1n;
      const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.ownerId === deckOwnerId && c.zone === 'deck'
      );
      const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, deckOwnerId, rngCounter);
      const indices = deckCards.map((_: any, idx: number) => idx);
      seededShuffle(indices, seed);
      for (let i = 0; i < deckCards.length; i++) {
        ctx.db.CardInstance.id.update({
          ...deckCards[i],
          zoneIndex: BigInt(indices[i]),
        });
      }
    }
    ctx.db.Game.id.update({ ...game, rngCounter });

    // Compact hand indices before drawing replacements so new cards get correct indices
    compactHandIndices(ctx, gameId, player.id);

    // Draw same number of replacement cards from the ACTING player's deck
    const latestGame = ctx.db.Game.id.find(gameId);
    if (latestGame) {
      drawCardsForPlayer(ctx, latestGame, player, ids.length);
    }

    logAction(ctx, gameId, player.id, 'EXCHANGE', JSON.stringify({ count: ids.length, cards: exchangedCards }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: exchange_from_deck — atomic pick-specific-cards exchange
// Unlike exchange_cards (which draws random replacements), this lets the
// player choose which deck cards to swap in and where they go.
// ---------------------------------------------------------------------------
export const exchange_from_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    exchangeCardIds: t.string(),   // JSON array of card instance IDs being sent to deck
    replacementMoves: t.string(),  // JSON array of { cardId: string, toZone: string, posX: string, posY: string }
  },
  (ctx, { gameId, exchangeCardIds, replacementMoves }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const exchangeIds: string[] = JSON.parse(exchangeCardIds);
    const moves: { cardId: string; toZone: string; posX: string; posY: string }[] = JSON.parse(replacementMoves);

    if (exchangeIds.length === 0) throw new SenderError('No cards to exchange');
    if (moves.length !== exchangeIds.length) throw new SenderError('Must pick same number of replacements as cards being exchanged');

    // Validate exchange cards exist and belong to this game. Ownership check
    // is relaxed — captured opponent cards (card.ownerId === player) pass,
    // and so do cards still under original ownership (which home-routes below).
    for (const idStr of exchangeIds) {
      const card = ctx.db.CardInstance.id.find(BigInt(idStr));
      if (!card) throw new SenderError('Exchange card not found: ' + idStr);
      if (card.gameId !== gameId) throw new SenderError('Card not in this game: ' + idStr);
    }

    // Validate replacement cards exist, are in deck, and belong to the player.
    // Replacements always come from the ACTING player's own deck.
    for (const move of moves) {
      const card = ctx.db.CardInstance.id.find(BigInt(move.cardId));
      if (!card) throw new SenderError('Replacement card not found: ' + move.cardId);
      if (card.gameId !== gameId) throw new SenderError('Card not in this game: ' + move.cardId);
      if (card.ownerId !== player.id) throw new SenderError('Card not owned by player: ' + move.cardId);
      if (card.zone !== 'deck') throw new SenderError('Replacement card not in deck: ' + move.cardId);
    }

    // Collect card details for the log BEFORE mutating. Each exchanged card
    // records its home-owner so taken opponent cards log as going to the
    // opponent's deck.
    const exchangedCards: { name: string; img: string; fromZone: string; deckOwnerId: string }[] = [];
    const affectedDeckOwners = new Set<bigint>();
    for (const idStr of exchangeIds) {
      const card = ctx.db.CardInstance.id.find(BigInt(idStr));
      if (!card) continue;
      const deckOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;
      exchangedCards.push({ name: card.cardName, img: card.cardImgFile, fromZone: card.zone, deckOwnerId: deckOwnerId.toString() });
      affectedDeckOwners.add(deckOwnerId);
    }
    const receivedCards: { name: string; img: string }[] = [];
    for (const move of moves) {
      const card = ctx.db.CardInstance.id.find(BigInt(move.cardId));
      if (card) receivedCards.push({ name: card.cardName, img: card.cardImgFile });
    }

    // Step 1: Move replacement cards from deck to their target zones
    for (const move of moves) {
      const card = ctx.db.CardInstance.id.find(BigInt(move.cardId));
      if (!card) continue;

      // Assign zoneIndex for the target zone
      let finalZoneIndex = 0n;
      if (move.toZone !== 'deck' && move.toZone !== 'hand') {
        let maxIdx = -1n;
        for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
          if (c.ownerId === player.id && c.zone === move.toZone && c.zoneIndex > maxIdx) {
            maxIdx = c.zoneIndex;
          }
        }
        finalZoneIndex = maxIdx + 1n;
      }
      if (move.toZone === 'hand') {
        finalZoneIndex = BigInt(
          [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
            (c: any) => c.ownerId === player.id && c.zone === 'hand'
          ).length
        );
      }

      ctx.db.CardInstance.id.update({
        ...card,
        zone: move.toZone,
        zoneIndex: finalZoneIndex,
        posX: move.posX,
        posY: move.posY,
        isFlipped: false, // Coming from deck = face up
      });
    }

    // Step 2: Move exchange cards to their home-owner's deck (face down)
    for (const idStr of exchangeIds) {
      const card = ctx.db.CardInstance.id.find(BigInt(idStr));
      if (!card) continue;
      const fromZone = card.zone;
      const fromOwner = card.ownerId;
      const deckOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;
      clearCountersIfLeavingPlay(ctx, card.id, fromZone, 'deck');
      ctx.db.CardInstance.id.update({
        ...card,
        zone: 'deck',
        ownerId: deckOwnerId,
        isFlipped: true,
        posX: '',
        posY: '',
        ...leavePlayFieldOverrides(card, fromZone, 'deck'),
      });
      // Compact hand/LOB against the card's PRE-move owner (that's the pile the card left)
      if (fromZone === 'hand') {
        compactHandIndices(ctx, gameId, fromOwner);
      }
      if (fromZone === 'land-of-bondage') {
        compactLobIndices(ctx, gameId, fromOwner);
      }
    }

    // Step 3: Shuffle every deck that received a card — player's deck (it lost
    // replacements) plus any opponent decks (they received taken cards back).
    affectedDeckOwners.add(player.id);
    let rngCounter = game.rngCounter;
    for (const deckOwnerId of affectedDeckOwners) {
      rngCounter += 1n;
      const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.ownerId === deckOwnerId && c.zone === 'deck'
      );
      const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, deckOwnerId, rngCounter);
      const indices = deckCards.map((_: any, idx: number) => idx);
      seededShuffle(indices, seed);
      for (let i = 0; i < deckCards.length; i++) {
        ctx.db.CardInstance.id.update({
          ...deckCards[i],
          zoneIndex: BigInt(indices[i]),
        });
      }
    }
    ctx.db.Game.id.update({ ...game, rngCounter });

    logAction(ctx, gameId, player.id, 'EXCHANGE', JSON.stringify({ count: exchangeIds.length, cards: exchangedCards, received: receivedCards }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: move_card_to_top_of_deck
// ---------------------------------------------------------------------------
export const move_card_to_top_of_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const fromZone = card.zone;

    // Route to the card's original owner's deck so a taken opponent card
    // topdecks to the opponent's deck, not the acting player's.
    const homeOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;

    // Tokens can't go onto a deck — delete the token instead.
    if (card.isToken) {
      deleteTokenWithCounters(ctx, card);
      if (fromZone === 'hand') compactHandIndices(ctx, gameId, card.ownerId);
      if (fromZone === 'land-of-bondage') compactLobIndices(ctx, gameId, card.ownerId);
      logAction(ctx, gameId, player.id, 'MOVE_TO_TOP_OF_DECK', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: card.cardName, cardImgFile: card.cardImgFile, tokenCleanup: true, targetOwnerId: homeOwnerId.toString() }), game.turnNumber, game.currentPhase);
      return;
    }

    // Shift all existing deck cards' zoneIndex += 1 (in the target deck)
    const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === homeOwnerId && c.zone === 'deck'
    );

    for (const dc of deckCards) {
      ctx.db.CardInstance.id.update({ ...dc, zoneIndex: dc.zoneIndex + 1n });
    }

    // Update the target card: zone = 'deck', zoneIndex = 0n, owner = home
    const updatedCard = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!updatedCard) throw new SenderError('Card not found');
    clearCountersIfLeavingPlay(ctx, updatedCard.id, fromZone, 'deck');
    ctx.db.CardInstance.id.update({
      ...updatedCard,
      zone: 'deck',
      zoneIndex: 0n,
      ownerId: homeOwnerId,
      isFlipped: true,
      revealExpiresAt: undefined,
      revealStartedAt: undefined,
      ...leavePlayFieldOverrides(updatedCard, fromZone, 'deck'),
    });

    // Compact hand indices if card left hand
    if (fromZone === 'hand') {
      compactHandIndices(ctx, gameId, card.ownerId);
    }
    // Compact LOB indices if card left LOB
    if (fromZone === 'land-of-bondage') {
      compactLobIndices(ctx, gameId, card.ownerId);
    }

    // Hide card identity only when the owner moves their own hand card.
    // Cross-player moves reveal the card (both players already know it).
    const hideIdentity = card.isFlipped || (fromZone === 'hand' && player.id === card.ownerId);
    const topLogName = hideIdentity ? 'a face-down card' : card.cardName;
    const topLogImg = hideIdentity ? '' : card.cardImgFile;
    logAction(ctx, gameId, player.id, 'MOVE_TO_TOP_OF_DECK', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: topLogName, cardImgFile: topLogImg, targetOwnerId: homeOwnerId.toString() }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: move_card_to_bottom_of_deck
// ---------------------------------------------------------------------------
export const move_card_to_bottom_of_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    const fromZone = card.zone;

    // Route to the card's original owner's deck so a taken opponent card
    // bottom-decks to the opponent's deck, not the acting player's.
    const homeOwnerId = card.originalOwnerId !== 0n ? card.originalOwnerId : card.ownerId;

    // Tokens can't go onto a deck — delete the token instead.
    if (card.isToken) {
      deleteTokenWithCounters(ctx, card);
      if (fromZone === 'hand') compactHandIndices(ctx, gameId, card.ownerId);
      if (fromZone === 'land-of-bondage') compactLobIndices(ctx, gameId, card.ownerId);
      logAction(ctx, gameId, player.id, 'MOVE_TO_BOTTOM_OF_DECK', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: card.cardName, cardImgFile: card.cardImgFile, tokenCleanup: true, targetOwnerId: homeOwnerId.toString() }), game.turnNumber, game.currentPhase);
      return;
    }

    // Find max zoneIndex among target deck's cards
    const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === homeOwnerId && c.zone === 'deck'
    );

    let maxIndex = -1n;
    for (const dc of deckCards) {
      if (dc.zoneIndex > maxIndex) {
        maxIndex = dc.zoneIndex;
      }
    }

    clearCountersIfLeavingPlay(ctx, card.id, fromZone, 'deck');
    ctx.db.CardInstance.id.update({
      ...card,
      zone: 'deck',
      zoneIndex: maxIndex + 1n,
      ownerId: homeOwnerId,
      isFlipped: true,
      revealExpiresAt: undefined,
      revealStartedAt: undefined,
      ...leavePlayFieldOverrides(card, fromZone, 'deck'),
    });

    // Compact hand indices if card left hand
    if (fromZone === 'hand') {
      compactHandIndices(ctx, gameId, card.ownerId);
    }
    // Compact LOB indices if card left LOB
    if (fromZone === 'land-of-bondage') {
      compactLobIndices(ctx, gameId, card.ownerId);
    }

    // Hide card identity only when the owner moves their own hand card.
    // Cross-player moves reveal the card (both players already know it).
    const hideIdentity = card.isFlipped || (fromZone === 'hand' && player.id === card.ownerId);
    const bottomLogName = hideIdentity ? 'a face-down card' : card.cardName;
    const bottomLogImg = hideIdentity ? '' : card.cardImgFile;
    logAction(ctx, gameId, player.id, 'MOVE_TO_BOTTOM_OF_DECK', JSON.stringify({ cardInstanceId: cardInstanceId.toString(), cardName: bottomLogName, cardImgFile: bottomLogImg, targetOwnerId: homeOwnerId.toString() }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: spawn_lost_soul
// ---------------------------------------------------------------------------
export const spawn_lost_soul = spacetimedb.reducer(
  {
    gameId: t.u64(),
    testament: t.string(),
    posX: t.string(),
    posY: t.string(),
    targetPlayerId: t.string(), // "" = self, otherwise player ID to spawn in their LOB
  },
  (ctx, { gameId, testament, posX, posY, targetPlayerId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);

    // Determine owner: self, target player, or shared sentinel (Paragon shared LoB).
    let ownerId = player.id;
    if (targetPlayerId === '0') {
      // Paragon: spawn into the shared Land of Bondage.
      ownerId = 0n;
    } else if (targetPlayerId) {
      const target = ctx.db.Player.id.find(BigInt(targetPlayerId));
      if (!target) throw new SenderError('Target player not found');
      if (target.gameId !== gameId) throw new SenderError('Target player not in this game');
      ownerId = target.id;
    }

    const isNT = testament === 'NT';
    const cardName = isNT
      ? 'Lost Soul Token "Harvest" [John 4:35]'
      : 'Lost Soul Token "Lost Souls" [Proverbs 2:16-17]';
    const cardSet = isNT ? 'GoC' : 'RR';
    const cardImgFile = isNT ? '/gameplay/nt_soul_token.png' : '/gameplay/ot_lost_soul.png';

    // Place at the end (rightmost) of existing LOB cards
    const lobIndex = BigInt(
      [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.ownerId === ownerId && c.zone === 'land-of-bondage'
      ).length
    );

    ctx.db.CardInstance.insert({
      id: 0n,
      gameId,
      ownerId,
      originalOwnerId: ownerId,
      zone: 'land-of-bondage',
      zoneIndex: lobIndex,
      posX,
      posY,
      isMeek: false,
      isFlipped: false,
      cardName,
      cardSet,
      cardImgFile,
      cardType: 'TOKEN_LS',
      brigade: '',
      strength: '',
      toughness: '',
      alignment: '',
      identifier: '',
      specialAbility: '',
      reference: '',
      notes: '',
      equippedToInstanceId: 0n,
      isSoulDeckOrigin: false,
      isToken: true,
      revealExpiresAt: undefined,
      revealStartedAt: undefined,
      originZone: '',
      originPosX: '',
      originPosY: '',
      outlineColor: '',
      isRotated: false,
      imitatingName: '',
    });

    logAction(ctx, gameId, player.id, 'SPAWN_LOST_SOUL', JSON.stringify({ testament }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: remove_token
// ---------------------------------------------------------------------------
export const remove_token = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardInstanceId: t.u64(),
  },
  (ctx, { gameId, cardInstanceId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const player = findPlayerBySender(ctx, gameId);

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');
    if (!card.cardType.startsWith('TOKEN_')) throw new SenderError('Card is not a token');

    ctx.db.CardInstance.id.delete(cardInstanceId);

    logAction(ctx, gameId, player.id, 'REMOVE_TOKEN', JSON.stringify({ cardInstanceId: cardInstanceId.toString() }), game.turnNumber, game.currentPhase);
  }
);

// ===========================================================================
// Utility reducers
// ===========================================================================

// ---------------------------------------------------------------------------
// Reducer: roll_dice
// ---------------------------------------------------------------------------
export const roll_dice = spacetimedb.reducer(
  {
    gameId: t.u64(),
    sides: t.u64(),
  },
  (ctx, { gameId, sides }) => {
    const player = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const newRngCounter = game.rngCounter + 1n;
    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, player.id, newRngCounter);
    const result = seededDiceRoll(Number(sides), seed);

    const rollData = JSON.stringify({ result, sides: Number(sides), rollerId: player.id.toString() });

    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter, lastDiceRoll: rollData });

    logAction(ctx, gameId, player.id, 'ROLL_DICE', rollData, game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: send_chat
// ---------------------------------------------------------------------------
export const send_chat = spacetimedb.reducer(
  {
    gameId: t.u64(),
    text: t.string(),
  },
  (ctx, { gameId, text }) => {
    // Try to find as player first
    let senderId: bigint | null = null;

    for (const player of ctx.db.Player.player_game_id.filter(gameId)) {
      if (player.identity.toHexString() === ctx.sender.toHexString()) {
        senderId = player.id;
        break;
      }
    }

    // If not a player, try spectator
    if (senderId === null) {
      for (const spectator of ctx.db.Spectator.spectator_game_id.filter(gameId)) {
        if (spectator.identity.toHexString() === ctx.sender.toHexString()) {
          senderId = spectator.id;
          break;
        }
      }
    }

    if (senderId === null) {
      throw new SenderError('Not a participant in this game');
    }

    ctx.db.ChatMessage.insert({
      id: 0n,
      gameId,
      senderId,
      text,
      sentAt: ctx.timestamp,
    });
  }
);

// ---------------------------------------------------------------------------
// Reducer: set_share_hand_with_spectators
// Per-player toggle that controls hand visibility to all current and future
// spectators. Global per player (not per-spectator).
// ---------------------------------------------------------------------------
export const set_share_hand_with_spectators = spacetimedb.reducer(
  { gameId: t.u64(), share: t.bool() },
  (ctx, { gameId, share }) => {
    const player = findPlayerBySender(ctx, gameId);
    if (player.shareHandWithSpectators === share) return;
    ctx.db.Player.id.update({ ...player, shareHandWithSpectators: share });
  }
);

// ---------------------------------------------------------------------------
// Reducer: set_game_private
// Either seated player flips Game.isPublic. Existing spectators stay; new
// joins via join_as_spectator are blocked while isPublic=false.
// ---------------------------------------------------------------------------
export const set_game_private = spacetimedb.reducer(
  { gameId: t.u64(), isPublic: t.bool() },
  (ctx, { gameId, isPublic }) => {
    const caller = findPlayerBySender(ctx, gameId);
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.isPublic === isPublic) return;

    ctx.db.Game.id.update({ ...game, isPublic });

    const text = isPublic
      ? `Game set to public by ${caller.displayName}`
      : `Game set to private by ${caller.displayName}`;
    ctx.db.ChatMessage.insert({
      id: 0n,
      gameId,
      senderId: 0n, // 0n = system message sentinel; autoInc IDs start at 1
      text,
      sentAt: ctx.timestamp,
    });
  }
);

// ---------------------------------------------------------------------------
// Reducer: kick_spectator
// Either seated player removes a spectator and bans their identity from
// rejoining for the remainder of this game.
// ---------------------------------------------------------------------------
export const kick_spectator = spacetimedb.reducer(
  { gameId: t.u64(), spectatorId: t.u64() },
  (ctx, { gameId, spectatorId }) => {
    const caller = findPlayerBySender(ctx, gameId);

    const target = ctx.db.Spectator.id.find(spectatorId);
    if (!target || target.gameId !== gameId) {
      throw new SenderError('Spectator not found in this game');
    }

    ctx.db.SpectatorBan.insert({
      id: 0n,
      gameId,
      identity: target.identity,
      bannedBySeat: caller.seat,
      bannedAt: ctx.timestamp,
    });

    ctx.db.Spectator.id.delete(target.id);

    ctx.db.ChatMessage.insert({
      id: 0n,
      gameId,
      senderId: 0n,
      text: `${target.displayName} was removed from spectators by ${caller.displayName}`,
      sentAt: ctx.timestamp,
    });
  }
);

// ---------------------------------------------------------------------------
// Reducer: set_player_option
// ---------------------------------------------------------------------------
export const set_player_option = spacetimedb.reducer(
  {
    gameId: t.u64(),
    optionName: t.string(),
    value: t.string(),
  },
  (ctx, { gameId, optionName, value }) => {
    const player = findPlayerBySender(ctx, gameId);

    if (optionName === 'autoRouteLostSouls') {
      ctx.db.Player.id.update({ ...player, autoRouteLostSouls: value === 'true' });
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: toggle_reveal_hand
// ---------------------------------------------------------------------------
export const toggle_reveal_hand = spacetimedb.reducer(
  {
    gameId: t.u64(),
    revealed: t.bool(),
  },
  (ctx, { gameId, revealed }) => {
    const player = findPlayerBySender(ctx, gameId);

    // Snapshot the current hand when revealing; clear when hiding. Cards drawn
    // after the reveal are not in the snapshot, so they render face-down.
    let snapshot = '[]';
    if (revealed) {
      const handIds: string[] = [];
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === player.id && c.zone === 'hand') {
          handIds.push(c.id.toString());
        }
      }
      snapshot = JSON.stringify(handIds);
    }

    ctx.db.Player.id.update({ ...player, handRevealed: revealed, handRevealSnapshot: snapshot });

    const game = ctx.db.Game.id.find(gameId);
    logAction(
      ctx,
      gameId,
      player.id,
      revealed ? 'REVEAL_HAND' : 'HIDE_HAND',
      '',
      game ? game.currentTurn : 0n,
      game ? game.currentPhase : 'draw',
    );
  }
);

// ---------------------------------------------------------------------------
// Reducer: toggle_reveal_reserve
// ---------------------------------------------------------------------------
export const toggle_reveal_reserve = spacetimedb.reducer(
  {
    gameId: t.u64(),
    revealed: t.bool(),
  },
  (ctx, { gameId, revealed }) => {
    const player = findPlayerBySender(ctx, gameId);
    ctx.db.Player.id.update({ ...player, reserveRevealed: revealed });

    const game = ctx.db.Game.id.find(gameId);
    logAction(
      ctx,
      gameId,
      player.id,
      revealed ? 'REVEAL_RESERVE' : 'HIDE_RESERVE',
      '',
      game ? game.currentTurn : 0n,
      game ? game.currentPhase : 'draw',
    );
  }
);

// ---------------------------------------------------------------------------
// Reducer: reveal_cards — broadcast revealed card IDs to all players.
// `context` is an optional JSON string carrying metadata (e.g. source card
// name + position + count for ability-triggered reveals). When present, the
// log payload wraps cardIds + context; when empty, logs cardIds directly for
// backward compatibility with the deck-menu "Reveal Top N" flow.
// ---------------------------------------------------------------------------
export const reveal_cards = spacetimedb.reducer(
  {
    gameId: t.u64(),
    cardIds: t.string(), // JSON array of card instance ID strings
    context: t.string(), // optional JSON object string; '' when omitted
  },
  (ctx, { gameId, cardIds, context }) => {
    const player = findPlayerBySender(ctx, gameId);
    ctx.db.Player.id.update({ ...player, revealedCards: cardIds });

    let logPayload = cardIds;
    if (context) {
      try {
        logPayload = JSON.stringify({ cardIds: JSON.parse(cardIds), context: JSON.parse(context) });
      } catch {
        // Malformed context — fall back to raw cardIds so the log still renders.
      }
    }

    const game = ctx.db.Game.id.find(gameId);
    logAction(
      ctx,
      gameId,
      player.id,
      'REVEAL_CARDS',
      logPayload,
      game ? game.currentTurn : 0n,
      game ? game.currentPhase : 'draw',
    );
  }
);

// ---------------------------------------------------------------------------
// Reducer: clear_revealed_cards — dismiss the reveal
// ---------------------------------------------------------------------------
export const clear_revealed_cards = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const player = findPlayerBySender(ctx, gameId);
    ctx.db.Player.id.update({ ...player, revealedCards: '' });
  }
);

// ---------------------------------------------------------------------------
// Lifecycle: clientConnected
// ---------------------------------------------------------------------------
export const onConnect = spacetimedb.clientConnected((ctx) => {
  // Presence is revived explicitly by register_presence from the game page.
  // Reviving isConnected here would revive rows in every game the identity
  // ever joined, keeping orphaned lobbies alive whenever the creator hit any
  // other page on the site.

  // Seed cleanup schedule if none exists
  const existingCleanup = [...ctx.db.CleanupSchedule.iter()];
  if (existingCleanup.length === 0) {
    ctx.db.CleanupSchedule.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + ONE_HOUR_MICROS),
    });
  }
});

// ---------------------------------------------------------------------------
// Reducer: log_search_deck (logs when a player searches their own deck)
// ---------------------------------------------------------------------------
export const log_search_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);
    logAction(ctx, gameId, player.id, 'SEARCH_OWN_DECK', '', game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: log_look_at_top (logs when a player privately looks at top N cards)
// ---------------------------------------------------------------------------
export const log_look_at_top = spacetimedb.reducer(
  {
    gameId: t.u64(),
    count: t.u64(),
    sourceCardName: t.string(),
    position: t.string(),
  },
  (ctx, { gameId, count, sourceCardName, position }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);
    const payload = (sourceCardName || position)
      ? JSON.stringify({
          count: Number(count),
          ...(sourceCardName ? { sourceCardName } : {}),
          position: position || 'top',
        })
      : String(count);
    logAction(ctx, gameId, player.id, 'LOOK_AT_TOP', payload, game.turnNumber, game.currentPhase);
  }
);

// ===========================================================================
// Zone Search reducers
// ===========================================================================

// ---------------------------------------------------------------------------
// Reducer: request_zone_search
// ---------------------------------------------------------------------------
export const request_zone_search = spacetimedb.reducer(
  {
    gameId: t.u64(),
    zone: t.string(),
  },
  (ctx, { gameId, zone }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);

    if (!['deck', 'hand', 'reserve', 'hand-reveal', 'action-priority', 'initiative'].includes(zone)) {
      throw new SenderError('Invalid zone for search: ' + zone);
    }

    const allPlayers = [...ctx.db.Player.player_game_id.filter(gameId)];
    const opponent = allPlayers.find(p => p.id !== player.id);
    if (!opponent) throw new SenderError('Opponent not found');

    for (const req of ctx.db.ZoneSearchRequest.zone_search_request_game_id.filter(gameId)) {
      if (req.requesterId === player.id && req.status === 'pending') {
        throw new SenderError('You already have a pending search request');
      }
    }

    ctx.db.ZoneSearchRequest.insert({
      id: 0n,
      gameId,
      requesterId: player.id,
      targetPlayerId: opponent.id,
      zone,
      status: 'pending',
      createdAt: ctx.timestamp,
      action: '',
      actionParams: '',
    });

    logAction(ctx, gameId, player.id, 'REQUEST_ZONE_SEARCH', JSON.stringify({ zone, targetName: opponent.displayName }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: pass_initiative
// One-way "I give initiative to my opponent" — no request/approve handshake.
// Inserts a synthetic, pre-approved ZoneSearchRequest so the opponent's
// existing approved-initiative subscription fires (toast + auto-complete).
// ---------------------------------------------------------------------------
export const pass_initiative = spacetimedb.reducer(
  {
    gameId: t.u64(),
  },
  (ctx, { gameId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);

    const allPlayers = [...ctx.db.Player.player_game_id.filter(gameId)];
    const opponent = allPlayers.find(p => p.id !== player.id);
    if (!opponent) throw new SenderError('Opponent not found');

    // requesterId=opponent so their client picks it up via approvedSearchRequest
    // (which filters on requesterId === myPlayer.id).
    ctx.db.ZoneSearchRequest.insert({
      id: 0n,
      gameId,
      requesterId: opponent.id,
      targetPlayerId: player.id,
      zone: 'initiative',
      status: 'approved',
      createdAt: ctx.timestamp,
      action: 'pass',
      actionParams: '',
    });

    logAction(ctx, gameId, player.id, 'PASS_INITIATIVE', '', game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: send_emote
// Fire-and-forget player emote (e.g. 'thumbs_up'). Both players and any
// spectators subscribed to the game see the new row and render an animation.
// ---------------------------------------------------------------------------
export const send_emote = spacetimedb.reducer(
  {
    gameId: t.u64(),
    kind: t.string(),
  },
  (ctx, { gameId, kind }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    if (!kind) throw new SenderError('kind required');

    const player = findPlayerBySender(ctx, gameId);

    ctx.db.Emote.insert({
      id: 0n,
      gameId,
      senderId: player.id,
      kind,
      createdAt: ctx.timestamp,
    });
  }
);

// ---------------------------------------------------------------------------
// Reducer: request_opponent_action
// Creates a pending ZoneSearchRequest tagged with an `action` (e.g.
// 'shuffle_deck', 'draw_deck_top') and JSON params. The requester waits for
// approval and then fires the corresponding reducer client-side.
// ---------------------------------------------------------------------------
export const request_opponent_action = spacetimedb.reducer(
  {
    gameId: t.u64(),
    action: t.string(),
    actionParams: t.string(),
  },
  (ctx, { gameId, action, actionParams }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);

    if (!action) throw new SenderError('action required');

    const allPlayers = [...ctx.db.Player.player_game_id.filter(gameId)];
    const opponent = allPlayers.find(p => p.id !== player.id);
    if (!opponent) throw new SenderError('Opponent not found');

    for (const req of ctx.db.ZoneSearchRequest.zone_search_request_game_id.filter(gameId)) {
      if (req.requesterId === player.id && req.status === 'pending') {
        throw new SenderError('You already have a pending request');
      }
    }

    ctx.db.ZoneSearchRequest.insert({
      id: 0n,
      gameId,
      requesterId: player.id,
      targetPlayerId: opponent.id,
      zone: 'deck',
      status: 'pending',
      createdAt: ctx.timestamp,
      action,
      actionParams,
    });

    logAction(ctx, gameId, player.id, 'REQUEST_OPPONENT_ACTION', JSON.stringify({ action, actionParams, targetName: opponent.displayName }), game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: approve_zone_search
// ---------------------------------------------------------------------------
export const approve_zone_search = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
  },
  (ctx, { gameId, requestId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.targetPlayerId !== player.id) throw new SenderError('Only the target player can approve');
    if (req.status !== 'pending') throw new SenderError('Request is not pending');

    ctx.db.ZoneSearchRequest.id.update({ ...req, status: 'approved' });

    const game = ctx.db.Game.id.find(gameId);
    // Suppress the approval log for action requests — the action itself will
    // log a specific entry (e.g. "discarded X"), which is clearer than a
    // generic "allowed deck search" line.
    if (game && !req.action) {
      logAction(ctx, gameId, player.id, 'APPROVE_ZONE_SEARCH', JSON.stringify({ zone: req.zone }), game.turnNumber, game.currentPhase);
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: deny_zone_search
// ---------------------------------------------------------------------------
export const deny_zone_search = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
  },
  (ctx, { gameId, requestId }) => {
    const player = findPlayerBySender(ctx, gameId);
    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.targetPlayerId !== player.id) throw new SenderError('Only the target player can deny');
    if (req.status !== 'pending') throw new SenderError('Request is not pending');

    const game = ctx.db.Game.id.find(gameId);
    const zone = req.zone;
    ctx.db.ZoneSearchRequest.id.delete(requestId);

    logAction(ctx, gameId, player.id, 'DENY_ZONE_SEARCH', JSON.stringify({ zone }), game ? game.turnNumber : 0n, game ? game.currentPhase : 'draw');
  }
);

// ---------------------------------------------------------------------------
// Reducer: complete_zone_search
// ---------------------------------------------------------------------------
export const complete_zone_search = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
    shuffled: t.bool(),
  },
  (ctx, { gameId, requestId, shuffled }) => {
    const player = findPlayerBySender(ctx, gameId);
    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.requesterId !== player.id) throw new SenderError('Only the requester can complete');
    if (req.status !== 'approved') throw new SenderError('Request is not approved');

    const game = ctx.db.Game.id.find(gameId);
    const allPlayers = [...ctx.db.Player.player_game_id.filter(gameId)];
    const opponent = allPlayers.find(p => p.id !== player.id);
    const targetName = opponent ? opponent.displayName : 'opponent';

    // If the requester elected to shuffle on close (deck-only), shuffle the
    // target's deck inline so the whole action emits a single log entry.
    if (shuffled && req.zone === 'deck' && game) {
      const targetId = req.targetPlayerId;
      const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
        (c: any) => c.ownerId === targetId && c.zone === 'deck'
      );
      const newRngCounter = game.rngCounter + 1n;
      ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });
      const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, targetId, newRngCounter);
      const indices = deckCards.map((_: any, idx: number) => idx);
      seededShuffle(indices, seed);
      for (let i = 0; i < deckCards.length; i++) {
        ctx.db.CardInstance.id.update({
          ...deckCards[i],
          zoneIndex: BigInt(indices[i]),
        });
      }
    }

    const wasAction = !!req.action;
    ctx.db.ZoneSearchRequest.id.delete(requestId);

    // Suppress the "finished searching..." completion log for action requests —
    // the executing reducer (move_cards_batch, shuffle_opponent_deck, etc.)
    // already logs the action it performed.
    if (game && !wasAction) {
      logAction(ctx, gameId, player.id, 'COMPLETE_ZONE_SEARCH', JSON.stringify({ zone: req.zone, targetName, shuffled }), game.turnNumber, game.currentPhase);
    }
  }
);

// ---------------------------------------------------------------------------
// Reducer: log_deck_search_no_shuffle
// Pure logging reducer (no state mutation). Emitted by the client when a
// player closes the Search Deck modal AFTER having placed at least one card
// on top/bottom of their own deck and explicitly chose NOT to shuffle. This
// is significant for opponents because the player now knows their own deck
// order — surfacing it as a clear log entry (rather than a silent absence
// of a shuffle) makes the choice unambiguous.
// ---------------------------------------------------------------------------
export const log_deck_search_no_shuffle = spacetimedb.reducer(
  {
    gameId: t.u64(),
    topCount: t.u32(),
    bottomCount: t.u32(),
  },
  (ctx, { gameId, topCount, bottomCount }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');
    if (game.status !== 'playing') throw new SenderError('Game is not in playing state');

    const player = findPlayerBySender(ctx, gameId);

    logAction(
      ctx,
      gameId,
      player.id,
      'DECK_SEARCH_NO_SHUFFLE',
      JSON.stringify({ topCount, bottomCount }),
      game.turnNumber,
      game.currentPhase,
    );
  }
);

// ---------------------------------------------------------------------------
// Reducer: move_opponent_card
// ---------------------------------------------------------------------------
export const move_opponent_card = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
    cardInstanceId: t.u64(),
    toZone: t.string(),
    posX: t.string(),
    posY: t.string(),
    newOwnerId: t.string(),
  },
  (ctx, { gameId, requestId, cardInstanceId, toZone, posX, posY, newOwnerId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const player = findPlayerBySender(ctx, gameId);

    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Search request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.requesterId !== player.id) throw new SenderError('Not your search request');
    if (req.status !== 'approved') throw new SenderError('Search request not approved');

    const card = ctx.db.CardInstance.id.find(cardInstanceId);
    if (!card) throw new SenderError('Card not found');
    if (card.gameId !== gameId) throw new SenderError('Card not in this game');

    // Battle entry must be stamped and owner-consented; a requester acting on
    // an opponent's zone-search approval must not be able to drop their card
    // into the closed battle band. Spec §7.
    if (toZone === 'battle') {
      throw new SenderError('Cannot move cards into battle for the opponent');
    }

    const fromZone = card.zone;
    // Moving to deck/soul-deck = face-down; leaving deck, reserve, or soul-deck = face-up; otherwise preserve
    const isFlipped = (toZone === 'deck' || toZone === 'soul-deck') ? true : (fromZone === 'deck' || fromZone === 'reserve' || fromZone === 'soul-deck') ? false : card.isFlipped;

    // Determine final owner: if newOwnerId is provided (non-empty) and differs
    // from current owner, reassign. This handles the "take from opponent's deck
    // to my territory" case — the card should end up owned by the player whose
    // zone it was dropped into.
    let finalOwnerId = card.ownerId;
    if (newOwnerId && newOwnerId.length > 0) {
      const parsedOwnerId = BigInt(newOwnerId);
      const targetOwner = ctx.db.Player.id.find(parsedOwnerId);
      if (!targetOwner) throw new SenderError('Target owner not found');
      if (targetOwner.gameId !== gameId) throw new SenderError('Target owner not in this game');
      finalOwnerId = parsedOwnerId;
    }

    // For free-form zones, auto-assign highest zoneIndex so new cards render
    // on top. For hand, append at the end so the taken card doesn't collide
    // with an existing hand slot.
    let finalZoneIndex = 0n;
    if (toZone === 'hand') {
      finalZoneIndex = BigInt(
        [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
          (c: any) => c.ownerId === finalOwnerId && c.zone === 'hand',
        ).length,
      );
    } else if (toZone !== 'deck') {
      let maxIdx = -1n;
      for (const c of ctx.db.CardInstance.card_instance_game_id.filter(gameId)) {
        if (c.ownerId === finalOwnerId && c.zone === toZone && c.zoneIndex > maxIdx) {
          maxIdx = c.zoneIndex;
        }
      }
      finalZoneIndex = maxIdx + 1n;
    }

    clearCountersIfLeavingPlay(ctx, card.id, fromZone, toZone);
    ctx.db.CardInstance.id.update({
      ...card,
      ownerId: finalOwnerId,
      zone: toZone,
      zoneIndex: finalZoneIndex,
      posX,
      posY,
      isFlipped,
      ...leavePlayFieldOverrides(card, fromZone, toZone),
    });

    // Compact hand indices if card left hand
    if (fromZone === 'hand') {
      compactHandIndices(ctx, gameId, card.ownerId);
    }
    // Compact LOB indices if card left LOB
    if (fromZone === 'land-of-bondage') {
      compactLobIndices(ctx, gameId, card.ownerId);
    }

    // Look up card owner's display name for richer log messages
    const cardOwner = ctx.db.Player.id.find(card.ownerId);
    const cardOwnerName = cardOwner ? cardOwner.displayName : 'opponent';

    logAction(ctx, gameId, player.id, 'MOVE_OPPONENT_CARD',
      JSON.stringify({
        requestId: requestId.toString(),
        cardInstanceId: cardInstanceId.toString(),
        from: fromZone,
        to: toZone,
        cardName: card.cardName,
        cardImgFile: card.cardImgFile,
        cardOwnerName,
        cardOwnerId: card.ownerId.toString(),
      }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: shuffle_opponent_deck
// Authorised via an approved ZoneSearchRequest — the requester can shuffle the
// target's deck (useful after browsing it, to randomise order they memorised).
// ---------------------------------------------------------------------------
export const shuffle_opponent_deck = spacetimedb.reducer(
  {
    gameId: t.u64(),
    requestId: t.u64(),
  },
  (ctx, { gameId, requestId }) => {
    const game = ctx.db.Game.id.find(gameId);
    if (!game) throw new SenderError('Game not found');

    const player = findPlayerBySender(ctx, gameId);

    const req = ctx.db.ZoneSearchRequest.id.find(requestId);
    if (!req) throw new SenderError('Search request not found');
    if (req.gameId !== gameId) throw new SenderError('Request not in this game');
    if (req.requesterId !== player.id) throw new SenderError('Not your search request');
    if (req.status !== 'approved') throw new SenderError('Search request not approved');

    const targetId = req.targetPlayerId;

    // Gather all of the target's deck cards and shuffle their zoneIndex values.
    const deckCards = [...ctx.db.CardInstance.card_instance_game_id.filter(gameId)].filter(
      (c: any) => c.ownerId === targetId && c.zone === 'deck'
    );

    const newRngCounter = game.rngCounter + 1n;
    ctx.db.Game.id.update({ ...game, rngCounter: newRngCounter });

    const seed = makeSeed(ctx.timestamp.microsSinceUnixEpoch, gameId, targetId, newRngCounter);

    const indices = deckCards.map((_: any, idx: number) => idx);
    seededShuffle(indices, seed);

    for (let i = 0; i < deckCards.length; i++) {
      ctx.db.CardInstance.id.update({
        ...deckCards[i],
        zoneIndex: BigInt(indices[i]),
      });
    }

    logAction(ctx, gameId, player.id, 'SHUFFLE_OPPONENT_DECK',
      JSON.stringify({ requestId: requestId.toString(), targetPlayerId: targetId.toString() }),
      game.turnNumber, game.currentPhase);
  }
);

// ---------------------------------------------------------------------------
// Reducer: request_spectator_hand_reveal
// Spectator-initiated request that prompts both players via a banner.
// Rate-limited: if a request from this spectator is already pending,
// silently no-op (client-side disable is bypassable; this is the real gate).
// ---------------------------------------------------------------------------
export const request_spectator_hand_reveal = spacetimedb.reducer(
  { gameId: t.u64() },
  (ctx, { gameId }) => {
    // Find the spectator row for the caller
    let spectator: any = null;
    for (const s of ctx.db.Spectator.spectator_game_id.filter(gameId)) {
      if (s.identity.toHexString() === ctx.sender.toHexString()) {
        spectator = s;
        break;
      }
    }
    if (!spectator) throw new SenderError('Not a spectator in this game');

    // Rate limit: silently no-op if an active request already exists for
    // this (gameId, spectatorId).
    for (const req of ctx.db.SpectatorHandRequest.spectator_hand_request_game_id.filter(gameId)) {
      if (req.spectatorId === spectator.id) return;
    }

    const row = ctx.db.SpectatorHandRequest.insert({
      id: 0n,
      gameId,
      spectatorId: spectator.id,
      spectatorName: spectator.displayName,
      requestedAt: ctx.timestamp,
    });

    ctx.db.ChatMessage.insert({
      id: 0n,
      gameId,
      senderId: 0n,
      text: `${spectator.displayName} requested to see hands`,
      sentAt: ctx.timestamp,
    });

    // Schedule expiry 30s out
    const future = ctx.timestamp.microsSinceUnixEpoch + 30_000_000n;
    ctx.db.SpectatorHandRequestExpiry.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(future),
      requestId: row.id,
    });
  }
);

// ---------------------------------------------------------------------------
// Scheduled reducer: expire_spectator_hand_request
// Auto-cleanup of SpectatorHandRequest 30s after creation. .find() before
// .delete() to no-op safely if the row was already removed elsewhere.
// ---------------------------------------------------------------------------
export const expire_spectator_hand_request = spacetimedb.reducer(
  { arg: SpectatorHandRequestExpiry.rowType },
  (ctx, { arg }) => {
    const row = ctx.db.SpectatorHandRequest.id.find(arg.requestId);
    if (row) ctx.db.SpectatorHandRequest.id.delete(arg.requestId);
  }
);

// Wire the scheduled reducer to the schema's forward reference
setSpectatorHandRequestExpiryReducer(expire_spectator_hand_request);

// ---------------------------------------------------------------------------
// Lifecycle: clientDisconnected
// ---------------------------------------------------------------------------
export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  // Find all player rows for this identity and set disconnected
  for (const player of ctx.db.Player.player_identity.filter(ctx.sender)) {
    const gameForPlayer = ctx.db.Game.id.find(player.gameId);
    ctx.db.Player.id.update({ ...player, isConnected: false });

    // Clear any pending pause/resume request owned by this disconnecting player
    // so the opponent isn't left staring at a request from someone who's gone.
    // An already-active pause is left intact — the absent player can rejoin
    // to a paused game, or the remaining player can request resume.
    if (gameForPlayer && gameForPlayer.pauseRequestedBy === player.seat.toString()) {
      ctx.db.Game.id.update({
        ...gameForPlayer,
        pauseRequestedBy: '',
        pauseRequestType: '',
      });
    }

    // For waiting and pregame, use a 30-second grace window — long enough to survive
    // WebSocket reconnections and page refreshes. The client proactively
    // calls leave_game on navigation, so this is only a fallback for
    // crashes/network drops.
    // For playing games, use the normal 5-minute timeout.
    const timeoutMicros = gameForPlayer && gameForPlayer.status === 'playing'
      ? 300_000_000n  // 5 minutes for active games
      : 30_000_000n;  // 30 seconds for waiting and pregame
    const futureTime = ctx.timestamp.microsSinceUnixEpoch + timeoutMicros;
    ctx.db.DisconnectTimeout.insert({
      scheduledId: 0n,
      scheduledAt: ScheduleAt.time(futureTime),
      gameId: player.gameId,
      playerId: player.id,
    });
  }

  // Safety net for spectators when leave_as_spectator never fires
  // (mobile backgrounding, crashes, network drops). Unlike Players,
  // Spectators get no reconnect grace — their only persistent state is
  // the row itself, so reconnect = re-call joinAsSpectator.
  for (const spectator of ctx.db.Spectator.iter()) {
    if (spectator.identity.toHexString() !== ctx.sender.toHexString()) continue;
    const displayName = spectator.displayName;
    const gameId = spectator.gameId;
    ctx.db.Spectator.id.delete(spectator.id);
    ctx.db.ChatMessage.insert({
      id: 0n,
      gameId,
      senderId: 0n,
      text: `${displayName} stopped spectating`,
      sentAt: ctx.timestamp,
    });
  }
});

// ---------------------------------------------------------------------------
// Procedure: ping
// Used by client-side connection-resilience logic to verify a WebSocket
// round-trip after the page returns from being hidden. Side-effect-free.
// Returns 'pong' on a healthy connection.
// ---------------------------------------------------------------------------
export const ping = spacetimedb.procedure(t.string(), (_ctx) => 'pong');
