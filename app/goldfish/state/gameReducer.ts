import {
  GameState,
  GameAction,
  GameCard,
  ZoneId,
  PHASE_ORDER,
} from '../types';
import { buildInitialGameState } from './gameInitializer';
import { refillSoulDeck } from '@/app/shared/paragon/refill';
import {
  type CardAbility,
  DEFAULT_ABILITY_SOURCE_ZONES,
  getAbilitiesForCard,
  getEffectiveAbilities,
  resolveTokenCard,
  IMITATE_SOUL_IMAGES,
  isNewTestamentLostSoul,
  isCharacterCard,
  isHeroCard,
  hasReferenceBook,
} from '@/lib/cards/cardAbilities';
import { findCard } from '@/lib/cards/lookup';

const MAX_HISTORY = 20;
const HAND_LIMIT = 16;

function isLostSoul(card: GameCard): boolean {
  return card.type === 'LS' || card.type === 'Lost Soul' || card.type.toLowerCase().includes('lost soul');
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function cloneZones(zones: GameState['zones']): GameState['zones'] {
  const cloned = {} as GameState['zones'];
  for (const key of Object.keys(zones) as ZoneId[]) {
    cloned[key] = zones[key].map(c => ({ ...c }));
  }
  return cloned;
}

/**
 * Compute a run of staggered positions that cascade down-right from a base
 * point, skipping any slot that overlaps an already-occupied position. Each
 * placed slot is itself treated as occupied so the returned slots never
 * collide with each other. This is what gives visual feedback when tokens are
 * spawned in a row: a second spawn lands on free slots instead of stacking
 * exactly on the first batch.
 */
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

function spawnTokenInState(
  state: GameState,
  source: GameCard,
  ability: Extract<CardAbility, { type: 'spawn_token' }>,
  history: GameState[],
): GameState {
  // Easter egg: gated users get cycling colored tokens instead of the normal
  // one. The cycle position is derived from how many of the cycling tokens the
  // player already has in territory (count-based) — no extra state stored.
  // Removing a token before the next spawn can repeat a color; acceptable here.
  let effectiveTokenName = ability.tokenName;
  const cyclingNames = ability.cyclingTokenNames ?? [];
  const me = (state.currentUsername ?? '').toLowerCase();
  if (cyclingNames.length > 0 && me !== '' && (ability.cyclingAllowedUsers ?? []).includes(me)) {
    const cyclingDisplayNames = new Set<string>();
    for (const n of cyclingNames) {
      const d = resolveTokenCard(n);
      if (d) cyclingDisplayNames.add(d.name);
    }
    const inPlay = state.zones.territory.filter(
      c => c.ownerId === source.ownerId && c.isToken && cyclingDisplayNames.has(c.cardName),
    ).length;
    effectiveTokenName = cyclingNames[inPlay % cyclingNames.length];
  }

  // Phase 1 — validate. Any failure returns state unchanged.
  // resolveTokenCard checks SPECIAL_TOKEN_CARDS first (handcrafted lost-soul
  // tokens under public/gameplay/) then falls back to findCard() for tokens
  // that exist in the generated CARDS dataset.
  const tokenData = resolveTokenCard(effectiveTokenName);
  if (!tokenData) {
    console.warn('[cardAbilities] unknown token', effectiveTokenName);
    return state;
  }
  const count = ability.count ?? 1;
  if (count < 1) return state;

  // Always spawn tokens in Territory by default — it's the visible main play
  // area and cards in LoR/LoB strips can't lay out free-form. A registry
  // entry can override via ability.defaultZone (e.g., for tokens that
  // thematically belong in LoB).
  const targetZone: ZoneId = ability.defaultZone ?? 'territory';

  // Whose zone the token lands in. `spawnForOpponent` (Harvest-style souls that
  // "create a token in an opponent's Land of Bondage") places it in the
  // opponent's copy of the zone, owned by the opponent side.
  const tokenOwnerId = ability.spawnForOpponent
    ? (source.ownerId === 'player1' ? 'player2' : 'player1')
    : source.ownerId;

  // Stagger each token relative to the source's position IF the source is
  // already in territory. Otherwise use a reasonable default near the
  // center-ish area so tokens appear together and visible.
  const STAGGER_X = 55;
  const STAGGER_Y = 15;
  const sourceInTerritory = source.zone === 'territory';
  const sourcePosX =
    typeof source.posX === 'number'
      ? source.posX
      : typeof source.posX === 'string' && source.posX !== ''
        ? Number(source.posX)
        : NaN;
  const sourcePosY =
    typeof source.posY === 'number'
      ? source.posY
      : typeof source.posY === 'string' && source.posY !== ''
        ? Number(source.posY)
        : NaN;
  const baseX = sourceInTerritory && Number.isFinite(sourcePosX) ? sourcePosX : 200;
  const baseY = sourceInTerritory && Number.isFinite(sourcePosY) ? sourcePosY : 200;

  // Existing same-owner cards already in the target zone. Cascading past these
  // means a second spawn-in-a-row lands on fresh slots instead of stacking
  // invisibly on the first batch (the visual feedback this is meant to give).
  const occupied: Array<{ x: number; y: number }> =
    targetZone === 'territory'
      ? state.zones[targetZone]
          .filter(c => c.ownerId === tokenOwnerId)
          .map(c => ({ x: Number(c.posX), y: Number(c.posY) }))
          .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
      : [];
  const slots = staggerSlots(occupied, baseX, baseY, STAGGER_X, STAGGER_Y, count);

  // Phase 2 — build all new cards in memory. No state mutation yet.
  const newCards: GameCard[] = Array.from({ length: count }, (_, i) => ({
    instanceId: crypto.randomUUID(),
    cardName: tokenData.name,
    cardSet: tokenData.set,
    cardImgFile: tokenData.imgFile,
    type: tokenData.type,
    brigade: tokenData.brigade ?? '',
    strength: tokenData.strength ?? '',
    toughness: tokenData.toughness ?? '',
    specialAbility: tokenData.specialAbility ?? '',
    identifier: tokenData.identifier ?? '',
    reference: tokenData.reference ?? '',
    alignment: tokenData.alignment ?? '',
    isMeek: false,
    counters: [],
    isFlipped: false,
    isToken: true,
    zone: targetZone,
    ownerId: tokenOwnerId,
    notes: '',
    posX: targetZone === 'territory' ? slots[i].x : undefined,
    posY: targetZone === 'territory' ? slots[i].y : undefined,
  }));

  // Phase 3 — commit in a single shallow clone.
  const zones = cloneZones(state.zones);
  zones[targetZone] = [...zones[targetZone], ...newCards];
  return { ...state, zones, history };
}

/**
 * Resurrect Heroes: move the selected Heroes from the discard pile into
 * Territory. Each Hero stays owned by its current owner (goldfish is single-
 * seat, so this is player1's own discard). Atomic — returns the original
 * state reference when nothing valid is selected.
 */
function resurrectHeroesInState(
  state: GameState,
  selectedInstanceIds: string[],
  history: GameState[],
): GameState {
  // Phase 1 — validate. Only Heroes currently in the discard pile qualify.
  const idSet = new Set(selectedInstanceIds);
  const toResurrect = state.zones.discard.filter(c => idSet.has(c.instanceId) && isHeroCard(c));
  if (toResurrect.length === 0) return state;

  // Phase 2 — build. Stagger the resurrected Heroes into Territory.
  const STAGGER_X = 55;
  const STAGGER_Y = 15;
  const baseX = 200;
  const baseY = 200;
  const movedIds = new Set(toResurrect.map(c => c.instanceId));
  const resurrected: GameCard[] = toResurrect.map((c, i) => ({
    ...c,
    zone: 'territory' as ZoneId,
    posX: baseX + (i + 1) * STAGGER_X,
    posY: baseY + (i + 1) * STAGGER_Y,
  }));

  // Phase 3 — commit.
  const zones = cloneZones(state.zones);
  zones.discard = zones.discard.filter(c => !movedIds.has(c.instanceId));
  zones.territory = [...zones.territory, ...resurrected];
  return { ...state, zones, history };
}

function imitateLostSoulInState(
  state: GameState,
  sourceInstanceId: string,
  targetInstanceId: string,
  history: GameState[],
): GameState {
  // Locate source and target across all zones.
  let source: GameCard | undefined;
  let target: GameCard | undefined;
  for (const zone of Object.values(state.zones)) {
    for (const c of zone) {
      if (c.instanceId === sourceInstanceId) source = c;
      else if (c.instanceId === targetInstanceId) target = c;
    }
  }
  if (!source || !target) return state;

  // Validate source is an Imitate Soul and in play.
  if (!source.cardName.startsWith('Lost Soul "Imitate"')) return state;
  if (!DEFAULT_ABILITY_SOURCE_ZONES.includes(source.zone)) return state;

  // Validate target is a Lost Soul in LoB, and is a New Testament soul
  // (Imitate's rules text only permits copying N.T. Lost Souls).
  if (!isLostSoul(target)) return state;
  if (target.zone !== 'land-of-bondage') return state;
  if (!isNewTestamentLostSoul(target.reference)) return state;

  // When the target has registered art, swap to it. Otherwise fall back to
  // the *canonical* Imitate art (not source.cardImgFile, which could be a
  // stale swap URL from a prior imitation). Pairs with the label-gating in
  // GameCardNode (renders the label only when cardImgFile equals canonical).
  const canonical = findCard(source.cardName)?.imgFile ?? source.cardImgFile;
  const newImg = IMITATE_SOUL_IMAGES[target.cardName] ?? canonical;
  // Store the FULL target cardName so the menu can resolve its abilities via
  // getEffectiveAbilities(). simplifyLostSoulName() is computed at render time
  // for the label overlay.
  const newImitating = target.cardName;

  // Build updated zones — mutate the source card in place.
  const zones = cloneZones(state.zones);
  for (const zoneKey of Object.keys(zones) as ZoneId[]) {
    const idx = zones[zoneKey].findIndex(c => c.instanceId === sourceInstanceId);
    if (idx !== -1) {
      zones[zoneKey] = [...zones[zoneKey]];
      zones[zoneKey][idx] = {
        ...zones[zoneKey][idx],
        cardImgFile: newImg,
        imitatingName: newImitating,
      };
      break;
    }
  }

  return { ...state, zones, history };
}

function stopImitatingInState(
  state: GameState,
  sourceInstanceId: string,
  history: GameState[],
): GameState {
  let source: GameCard | undefined;
  for (const zone of Object.values(state.zones)) {
    const found = zone.find(c => c.instanceId === sourceInstanceId);
    if (found) { source = found; break; }
  }
  if (!source) return state;
  if (!source.cardName.startsWith('Lost Soul "Imitate"')) return state;

  // Restore canonical imgFile from cardData.
  const canonical = findCard(source.cardName)?.imgFile;
  if (!canonical) return state;

  const zones = cloneZones(state.zones);
  for (const zoneKey of Object.keys(zones) as ZoneId[]) {
    const idx = zones[zoneKey].findIndex(c => c.instanceId === sourceInstanceId);
    if (idx !== -1) {
      zones[zoneKey] = [...zones[zoneKey]];
      zones[zoneKey][idx] = {
        ...zones[zoneKey][idx],
        cardImgFile: canonical,
        imitatingName: '',
      };
      break;
    }
  }

  return { ...state, zones, history };
}

function setCardOutlineInState(
  state: GameState,
  source: GameCard,
  ability: Extract<CardAbility, { type: 'set_card_outline' }>,
  history: GameState[],
): GameState {
  // Re-picking the same color clears it (mutually-exclusive toggle); picking
  // the other color switches.
  const next: GameCard['outlineColor'] =
    source.outlineColor === ability.color ? undefined : ability.color;

  const zones = cloneZones(state.zones);
  for (const key of Object.keys(zones) as ZoneId[]) {
    const idx = zones[key].findIndex(c => c.instanceId === source.instanceId);
    if (idx !== -1) {
      zones[key][idx] = { ...zones[key][idx], outlineColor: next };
      break;
    }
  }
  return { ...state, zones, history };
}

function setRotationInState(
  state: GameState,
  source: GameCard,
  ability: Extract<CardAbility, { type: 'set_rotation' }>,
  history: GameState[],
): GameState {
  // Sideways marker only exists in the Land of Bondage (first-of-two-rescues
  // record on the Two/Three Liner souls); the menu already zone-gates via
  // sourceZones, this is the reducer-side backstop.
  if (source.zone !== 'land-of-bondage') return state;
  if ((source.isRotated ?? false) === ability.rotated) return state;

  const zones = cloneZones(state.zones);
  const idx = zones['land-of-bondage'].findIndex(c => c.instanceId === source.instanceId);
  if (idx === -1) return state;
  zones['land-of-bondage'][idx] = { ...zones['land-of-bondage'][idx], isRotated: ability.rotated };
  return { ...state, zones, history };
}

function shuffleAndDrawInState(
  state: GameState,
  _ownerId: string,
  shuffleCount: number,
  drawCount: number,
  history: GameState[],
  // Philip's Daughters (all_players_keep_one_shuffle_draw): when set, the pick
  // becomes "every hand card except this one" and the draw matches whatever
  // that count turns out to be. shuffleCount/drawCount are ignored.
  keepInstanceId?: string,
): GameState {
  const keepMode = keepInstanceId !== undefined;

  // Phase 1 — validate.
  if (!keepMode && (shuffleCount < 0 || drawCount < 0)) return state;

  // Phase 2 — build new zones in memory.
  const zones = cloneZones(state.zones);

  const picked: GameCard[] = [];
  const remainingHand: GameCard[] = [];
  if (keepMode) {
    // An empty hand is a legitimate no-op; anything else must actually contain
    // the keeper or the whole hand would be shuffled away by mistake.
    if (zones.hand.length > 0 && !zones.hand.some(c => c.instanceId === keepInstanceId)) return state;
    zones.hand.forEach((card) => {
      if (card.instanceId === keepInstanceId) remainingHand.push(card);
      else picked.push({ ...card, zone: 'deck', isFlipped: true });
    });
  } else {
    // Pick up to shuffleCount random hand cards. Hand shortage: shuffle all.
    const actualShuffle = Math.min(shuffleCount, zones.hand.length);
    const handIndices = zones.hand.map((_c, i) => i);
    // Fisher-Yates partial shuffle — indices at the tail are the picks.
    for (let i = handIndices.length - 1; i > handIndices.length - 1 - actualShuffle && i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [handIndices[i], handIndices[j]] = [handIndices[j], handIndices[i]];
    }
    const pickedSet = new Set(handIndices.slice(handIndices.length - actualShuffle));
    zones.hand.forEach((card, i) => {
      if (pickedSet.has(i)) {
        picked.push({ ...card, zone: 'deck', isFlipped: true });
      } else {
        remainingHand.push(card);
      }
    });
  }
  zones.hand = remainingHand;

  // Merge picked cards into deck and reshuffle entire deck.
  const mergedDeck = [...zones.deck, ...picked];
  zones.deck = shuffleArray(mergedDeck);

  // Phase 3 — draw, respecting auto-route Lost Souls and hand limit. Keep mode
  // draws back exactly what it shuffled away. Short-deck draws what it can.
  const actualDraw = keepMode ? picked.length : drawCount;
  for (let i = 0; i < actualDraw; i++) {
    if (zones.deck.length === 0) break;
    if (zones.hand.length >= HAND_LIMIT && !state.options.autoRouteLostSouls) break;

    let card = zones.deck.shift()!;
    // Auto-route consecutive Lost Souls if the option is on.
    while (state.options.autoRouteLostSouls && isLostSoul(card)) {
      card.zone = 'land-of-bondage';
      card.isFlipped = false;
      zones['land-of-bondage'].push(card);
      if (zones.deck.length === 0) { card = undefined as unknown as GameCard; break; }
      card = zones.deck.shift()!;
    }
    if (!card) break;

    if (zones.hand.length >= HAND_LIMIT) {
      zones.deck.unshift(card); // put back — no room
      break;
    }
    card.zone = 'hand';
    card.isFlipped = false;
    zones.hand.push(card);
  }

  return { ...state, zones, history };
}

function drawBottomOfDeckInState(
  state: GameState,
  _source: GameCard,
  ability: Extract<CardAbility, { type: 'draw_bottom_of_deck' }>,
  history: GameState[],
): GameState {
  if (ability.count < 1) return state;
  if (state.zones.deck.length === 0) return state;

  const zones = cloneZones(state.zones);
  const autoRoute = state.options.autoRouteLostSouls;
  const handRoom = Math.max(0, HAND_LIMIT - zones.hand.length);
  const want = Math.min(ability.count, zones.deck.length, handRoom);
  if (want === 0) return state;

  // Walk up from the bottom of the deck. With auto-route on, a drawn Lost Soul
  // goes to Land of Bondage without consuming a draw, so we keep walking up to
  // pull a replacement from the next bottom card — same rule as top-of-deck.
  const toHand: GameCard[] = [];
  const toLob: GameCard[] = [];
  const consumed = new Set<string>();
  for (let i = zones.deck.length - 1; i >= 0 && toHand.length < want; i--) {
    const c = zones.deck[i];
    consumed.add(c.instanceId);
    if (autoRoute && isLostSoul(c)) {
      toLob.push({ ...c, zone: 'land-of-bondage' as ZoneId, isFlipped: false, posX: undefined, posY: undefined });
    } else {
      toHand.push({ ...c, zone: 'hand' as ZoneId, isFlipped: false, posX: undefined, posY: undefined });
    }
  }
  if (toHand.length === 0 && toLob.length === 0) return state;

  zones.deck = zones.deck.filter(c => !consumed.has(c.instanceId));
  zones.hand = [...zones.hand, ...toHand];
  zones['land-of-bondage'] = [...zones['land-of-bondage'], ...toLob];

  return { ...state, zones, history };
}

// Gates of Hell: discard the bottom card of deck — except Lost Souls, which
// the printed text plays instead (routed to the Land of Bondage).
function discardBottomOfDeckInState(
  state: GameState,
  _source: GameCard,
  history: GameState[],
): GameState {
  if (state.zones.deck.length === 0) return state;

  const zones = cloneZones(state.zones);
  const card = zones.deck[zones.deck.length - 1];
  zones.deck = zones.deck.slice(0, -1);

  const destZone: ZoneId = isLostSoul(card) ? 'land-of-bondage' : 'discard';
  zones[destZone] = [...zones[destZone], {
    ...card,
    zone: destZone,
    isFlipped: false,
    posX: undefined,
    posY: undefined,
  }];

  return { ...state, zones, history };
}

function playAllLostSoulsInState(
  state: GameState,
  source: GameCard,
  history: GameState[],
): GameState {
  // Per-player: pull from soul-deck if any cards live there (Paragon mode),
  // otherwise from the main deck. Goldfish convention (matching
  // all_players_shuffle_and_draw) is to operate on the source's owner only.
  const ownerId = source.ownerId;
  const ownerSoul = state.zones['soul-deck'].filter(c => c.ownerId === ownerId);
  const sourceZone: ZoneId = ownerSoul.length > 0 ? 'soul-deck' : 'deck';
  const candidates = state.zones[sourceZone].filter(c => c.ownerId === ownerId);
  const lostSouls = candidates.filter(isLostSoul);
  if (lostSouls.length === 0) return state;

  const movingIds = new Set(lostSouls.map(c => c.instanceId));
  const zones = cloneZones(state.zones);
  zones[sourceZone] = zones[sourceZone].filter(c => !movingIds.has(c.instanceId));
  const moved: GameCard[] = lostSouls.map(c => ({
    ...c,
    zone: 'land-of-bondage',
    isFlipped: false,
    posX: undefined,
    posY: undefined,
    revealUntil: undefined,
  }));
  zones['land-of-bondage'] = [...zones['land-of-bondage'], ...moved];

  return { ...state, zones, history };
}

function bandHeroesFromDeckInState(
  state: GameState,
  source: GameCard,
  ability: Extract<CardAbility, { type: 'band_heroes_from_deck' }>,
  history: GameState[],
): GameState {
  // Goldfish is single-seat, so the activator is always the source's owner —
  // the same convention playAllLostSoulsInState uses just above. There's no
  // Field of Battle here (app/goldfish/layout/zoneLayout.ts never renders one),
  // so the band lands in Territory, the only free-form play area.
  const ownerId = source.ownerId;
  const heroes = state.zones.deck.filter(
    c => c.ownerId === ownerId
      && isHeroCard(c)
      && hasReferenceBook(c.reference, ability.referenceBook),
  );
  if (heroes.length === 0) return state;

  // Lay them out as a wrapped row rather than the diagonal cascade staggerSlots
  // produces — a Genesis deck can put a dozen Heroes on the table at once, and
  // a cascade would run them off the zone. Column/row pitch mirrors the canvas'
  // own territory autogrid (CARD_WIDTH 120 plus a gap; rows overlap at roughly
  // cardHeight * 0.35).
  const COLS = 8;
  const COL_W = 130;
  const ROW_H = 62;
  const BASE_X = 100;
  const BASE_Y = 120;

  const movingIds = new Set(heroes.map(c => c.instanceId));
  const banded: GameCard[] = heroes.map((c, i) => ({
    ...c,
    zone: 'territory' as ZoneId,
    isFlipped: false,
    revealUntil: undefined,
    posX: BASE_X + (i % COLS) * COL_W,
    posY: BASE_Y + Math.floor(i / COLS) * ROW_H,
  }));

  const zones = cloneZones(state.zones);
  zones.deck = zones.deck.filter(c => !movingIds.has(c.instanceId));
  zones.territory = [...zones.territory, ...banded];

  return { ...state, zones, history };
}

function discardCharactersFromReserveInState(
  state: GameState,
  source: GameCard,
  ability: Extract<CardAbility, { type: 'discard_characters_from_reserve' }>,
  history: GameState[],
): GameState {
  // Goldfish is single-seat (player1). 'self' clears the source owner's
  // Reserve; 'opponent' targets any other owner, which normally has no cards
  // in goldfish — a harmless no-op there.
  const targetIsSelf = ability.target === 'self';
  const discarding = state.zones.reserve.filter(c =>
    (targetIsSelf ? c.ownerId === source.ownerId : c.ownerId !== source.ownerId)
    && isCharacterCard(c),
  );
  if (discarding.length === 0) return state;

  const discardingIds = new Set(discarding.map(c => c.instanceId));
  const zones = cloneZones(state.zones);
  zones.reserve = zones.reserve.filter(c => !discardingIds.has(c.instanceId));
  const moved: GameCard[] = discarding.map(c => ({
    ...c,
    zone: 'discard',
    isFlipped: false,
    isMeek: false,
    posX: undefined,
    posY: undefined,
    counters: [],
    outlineColor: undefined,
    notes: '',
  }));
  zones.discard = [...zones.discard, ...moved];

  return { ...state, zones, history };
}

function threeNailsResetInState(
  state: GameState,
  source: GameCard,
  history: GameState[],
): GameState {
  const zones = cloneZones(state.zones);

  const ownerId = source.ownerId;
  const SWEEP_ZONES: ZoneId[] = ['hand', 'territory', 'land-of-bondage'];

  // Pull the source out of whichever zone it's in and route to banish (cleared
  // in-play state). Not territory-only: Three Nails (GoC) is an Artifact and
  // A New Beginning (FoM) a Dominant, but A New Beginning [RR2] is a Good
  // Enhancement played into battle. Filtering only territory would leave the
  // real card sitting in battle while a copy landed in banish.
  zones[source.zone] = zones[source.zone].filter(c => c.instanceId !== source.instanceId);
  zones.banish = [
    ...zones.banish,
    {
      ...source,
      zone: 'banish',
      isFlipped: false,
      posX: undefined,
      posY: undefined,
      counters: [],
      outlineColor: undefined,
      notes: '',
      isMeek: false,
    },
  ];

  // Sweep the owner's cards from hand + territory + land-of-bondage into deck,
  // clearing in-play state. Only the owner's cards move (single-player goldfish
  // means there's only one player anyway, but be explicit).
  const swept: GameCard[] = [];
  for (const zoneId of SWEEP_ZONES) {
    const remaining: GameCard[] = [];
    for (const card of zones[zoneId]) {
      if (card.ownerId !== ownerId) {
        remaining.push(card);
        continue;
      }
      swept.push({
        ...card,
        zone: 'deck',
        isFlipped: true,
        posX: undefined,
        posY: undefined,
        counters: [],
        outlineColor: undefined,
        notes: '',
        isMeek: false,
      });
    }
    zones[zoneId] = remaining;
  }

  zones.deck = shuffleArray([...zones.deck, ...swept]);

  // Draw 8 — same auto-route + hand-limit logic as shuffleAndDrawInState.
  for (let i = 0; i < 8; i++) {
    if (zones.deck.length === 0) break;
    if (zones.hand.length >= HAND_LIMIT && !state.options.autoRouteLostSouls) break;

    let card = zones.deck.shift()!;
    while (state.options.autoRouteLostSouls && isLostSoul(card)) {
      card.zone = 'land-of-bondage';
      card.isFlipped = false;
      zones['land-of-bondage'].push(card);
      if (zones.deck.length === 0) { card = undefined as unknown as GameCard; break; }
      card = zones.deck.shift()!;
    }
    if (!card) break;

    if (zones.hand.length >= HAND_LIMIT) {
      zones.deck.unshift(card);
      break;
    }
    card.zone = 'hand';
    card.isFlipped = false;
    zones.hand.push(card);
  }

  return { ...state, zones, history };
}

function drawAndTopdeckSelfInState(
  state: GameState,
  source: GameCard,
  history: GameState[],
): GameState {
  // Phase 1 — validate.
  if (!DEFAULT_ABILITY_SOURCE_ZONES.includes(source.zone)) return state;

  // Phase 2 — build.
  const zones = cloneZones(state.zones);

  // Pull source out of its current zone and topdeck onto soul-deck (index 0 = top).
  // Clear in-play state (counters, outline, notes, meek) since the card is leaving play.
  zones[source.zone] = zones[source.zone].filter(c => c.instanceId !== source.instanceId);
  const topdecked: GameCard = {
    ...source,
    zone: 'soul-deck',
    isFlipped: true,
    posX: undefined,
    posY: undefined,
    counters: [],
    outlineColor: undefined,
    notes: '',
    isMeek: false,
  };
  zones['soul-deck'] = [topdecked, ...zones['soul-deck']];

  // Draw 1 from top of deck → hand. No auto-route; matches other ability draws.
  if (zones.deck.length > 0 && zones.hand.length < HAND_LIMIT) {
    const drawn = zones.deck.shift()!;
    drawn.zone = 'hand';
    drawn.isFlipped = false;
    drawn.posX = undefined;
    drawn.posY = undefined;
    zones.hand = [...zones.hand, drawn];
  }

  return { ...state, zones, history };
}

function underdeckTopOfDeckInState(
  state: GameState,
  _source: GameCard,
  ability: Extract<CardAbility, { type: 'underdeck_top_of_deck' }>,
  history: GameState[],
): GameState {
  // Phase 1 — validate.
  if (ability.count < 1) return state;
  if (state.zones.deck.length === 0) return state;

  // Phase 2 — take top N off the deck (index 0..n-1, matching shift() top-of-deck
  // convention) and re-append at the bottom. Stays in deck zone face-down.
  const zones = cloneZones(state.zones);
  const n = Math.min(ability.count, zones.deck.length);
  const taken = zones.deck.slice(0, n).map(c => ({
    ...c,
    isFlipped: true,
    posX: undefined,
    posY: undefined,
  }));
  zones.deck = [...zones.deck.slice(n), ...taken];

  return { ...state, zones, history };
}

function reserveTopOfDeckInState(
  state: GameState,
  _source: GameCard,
  ability: Extract<CardAbility, { type: 'reserve_top_of_deck' }>,
  history: GameState[],
): GameState {
  // Phase 1 — validate.
  if (ability.count < 1) return state;
  if (state.zones.deck.length === 0) return state;

  // Phase 2 — build new zones. Top of deck is zones.deck[0] (matches shift()
  // usage in shuffleAndDrawInState and drawCard). Reserved cards land face-down
  // on top of the reserve with a 10s reveal so the player can briefly see what
  // came off the deck (matches the per-card hand reveal mechanic). Lost Souls
  // auto-route to Land of Bondage face-up (no reveal) when the option is on.
  const zones = cloneZones(state.zones);
  const n = Math.min(ability.count, zones.deck.length);
  const taken = zones.deck.slice(0, n);
  zones.deck = zones.deck.slice(n);

  const REVEAL_MS = 10_000;
  const revealUntil = Date.now() + REVEAL_MS;
  const reservedCards: GameCard[] = [];
  for (const card of taken) {
    if (state.options.autoRouteLostSouls && isLostSoul(card)) {
      zones['land-of-bondage'] = [...zones['land-of-bondage'], {
        ...card,
        zone: 'land-of-bondage',
        isFlipped: false,
        posX: undefined,
        posY: undefined,
        revealUntil: undefined,
        revealDurationMs: undefined,
      }];
    } else {
      reservedCards.push({
        ...card,
        zone: 'reserve',
        isFlipped: true,
        posX: undefined,
        posY: undefined,
        revealUntil,
        revealDurationMs: REVEAL_MS,
      });
    }
  }
  zones.reserve = [...reservedCards, ...zones.reserve];

  return { ...state, zones, history };
}

function pushHistory(state: GameState): GameState[] {
  // Store a snapshot (without history to avoid nesting)
  const snapshot: GameState = {
    ...state,
    zones: cloneZones(state.zones),
    history: [],
  };
  const history = [...state.history, snapshot];
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
  return history;
}

function findAndRemoveCard(
  zones: GameState['zones'],
  instanceId: string
): { card: GameCard; fromZone: ZoneId } | null {
  for (const zoneId of Object.keys(zones) as ZoneId[]) {
    const idx = zones[zoneId].findIndex(c => c.instanceId === instanceId);
    if (idx !== -1) {
      const [card] = zones[zoneId].splice(idx, 1);
      return { card, fromZone: zoneId };
    }
  }
  return null;
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  return pruneDeckSpread(reduceGame(state, action));
}

/**
 * Keep `deckSpreadIds` honest after every action: a spread card that leaves
 * Territory for any reason (dragged to hand, discarded, shuffled in, an
 * ability moved it) stops being "spread", and coming back later does not
 * re-add it. Runs here, once, instead of inside every path that can move a
 * card. Returns the same object when nothing changed so no-op actions stay
 * referentially no-op.
 */
function pruneDeckSpread(state: GameState): GameState {
  const ids = state.deckSpreadIds;
  if (!ids) return state;
  const inTerritory = new Set(state.zones.territory.map(c => c.instanceId));
  const kept = ids.filter(id => inTerritory.has(id));
  if (kept.length === ids.length) return state;
  return { ...state, deckSpreadIds: kept.length > 0 ? kept : undefined };
}

function reduceGame(state: GameState, action: GameAction): GameState {
  // Handle special meta-actions
  if (action.payload.value === '__UNDO__') {
    return undoAction(state);
  }
  if (action.payload.value === '__TOGGLE_SPREAD__') {
    return { ...state, isSpreadHand: !state.isSpreadHand };
  }
  if (action.type === 'RESET_GAME' && action.payload.value) {
    try {
      return JSON.parse(action.payload.value as string);
    } catch {
      return state;
    }
  }

  const history = pushHistory(state);
  const zones = cloneZones(state.zones);

  switch (action.type) {
    case 'MOVE_CARD': {
      const { cardInstanceId, toZone, toIndex, posX, posY } = action.payload;
      if (!cardInstanceId || !toZone) return state;

      const result = findAndRemoveCard(zones, cardInstanceId);
      if (!result) return state;

      // Tokens dropped into reserve/banish/discard/hand/deck are removed entirely
      const TOKEN_REMOVE_ZONES: ZoneId[] = ['reserve', 'banish', 'discard', 'hand', 'deck'];
      if (result.card.isToken && TOKEN_REMOVE_ZONES.includes(toZone)) {
        return { ...state, zones, history };
      }

      // Flip face-up only when the card is actually leaving the deck
      if (result.fromZone === 'deck' && toZone !== 'deck') {
        result.card.isFlipped = false;
      }
      // Paragon: revealing a card from the Soul Deck flips it face-up as it leaves.
      if (result.fromZone === 'soul-deck' && toZone !== 'soul-deck') {
        result.card.isFlipped = false;
      }
      result.card.zone = toZone;
      // Per-card hand reveals are ephemeral — clear when the card changes zone.
      if (result.fromZone !== toZone) {
        result.card.revealUntil = undefined;
      }
      // Counters, text notes, and the Three Woes Choose Good/Evil outline are
      // in-play state — drop them whenever the card leaves Territory or Land
      // of Bondage for any other zone.
      if (
        result.fromZone !== toZone &&
        (result.fromZone === 'territory' || result.fromZone === 'land-of-bondage')
      ) {
        result.card.counters = [];
        result.card.notes = '';
        result.card.outlineColor = undefined;
        result.card.isRotated = undefined;
        // If the Imitate Lost Soul leaves LoB (rescued, shuffled, banished,
        // etc.), drop the imitation and restore its canonical art.
        if (result.card.imitatingName) {
          const canonical = findCard(result.card.cardName)?.imgFile;
          if (canonical) result.card.cardImgFile = canonical;
          result.card.imitatingName = '';
        }
      }
      // Paragon: rescuing a Soul-Deck-origin card transfers ownership from
      // the shared sentinel to the rescuing player. Marker stays set.
      const movedFromSharedLob =
        result.fromZone === 'land-of-bondage' &&
        result.card.ownerId === 'shared' &&
        result.card.isSoulDeckOrigin === true;
      if (movedFromSharedLob) {
        result.card.ownerId = 'player1'; // goldfish: only player1 is the seat
      }
      // Store free-form position for territory only (LOB is auto-arranged)
      const FREE_FORM_ZONES: ZoneId[] = ['territory'];
      if (FREE_FORM_ZONES.includes(toZone) && posX !== undefined && posY !== undefined) {
        result.card.posX = posX;
        result.card.posY = posY;
      } else {
        result.card.posX = undefined;
        result.card.posY = undefined;
      }
      // Auto-detach on exit from territory. Clear this mover's equippedTo
      // (if any). For cards that pointed at this mover: normally just unlink,
      // but if the destination is Land of Bondage, auto-discard them (a warrior
      // going to LOB takes its weapons down with it).
      if (toZone !== 'territory') {
        if (result.card.equippedTo) {
          result.card.equippedTo = undefined;
        }
        for (const zoneId of Object.keys(zones) as ZoneId[]) {
          for (let i = 0; i < zones[zoneId].length; i++) {
            const other = zones[zoneId][i];
            if (other.equippedTo !== cardInstanceId) continue;
            if (toZone === 'land-of-bondage') {
              const leavingPlay =
                zoneId === 'territory' || zoneId === 'land-of-bondage';
              zones[zoneId].splice(i, 1);
              i--;
              zones.discard.push({
                ...other,
                zone: 'discard',
                equippedTo: undefined,
                posX: undefined,
                posY: undefined,
                counters: leavingPlay ? [] : other.counters,
                notes: leavingPlay ? '' : other.notes,
                outlineColor: leavingPlay ? undefined : other.outlineColor,
              });
            } else {
              zones[zoneId][i] = { ...other, equippedTo: undefined };
            }
          }
        }
      }
      if (toIndex !== undefined && toIndex >= 0) {
        zones[toZone].splice(toIndex, 0, result.card);
      } else {
        zones[toZone].push(result.card);
      }

      let finalZones = zones;
      const needsRefill =
        state.format === 'Paragon' &&
        result.fromZone === 'land-of-bondage' &&
        result.card.isSoulDeckOrigin === true &&
        toZone === 'land-of-redemption';
      if (needsRefill) {
        finalZones = refillSoulDeck(zones);
      }
      return { ...state, zones: finalZones, history };
    }

    case 'DRAW_CARD': {
      if (zones.deck.length === 0) return state;
      if (zones.hand.length >= HAND_LIMIT && !state.options.autoRouteLostSouls) return state;

      const card = zones.deck.shift()!;

      if (state.options.autoRouteLostSouls && isLostSoul(card)) {
        card.zone = 'land-of-bondage';
        card.isFlipped = false;
        zones['land-of-bondage'].push(card);
        // Draw a replacement if deck has cards
        if (zones.deck.length > 0) {
          // Recursively handle — but we need to be careful about Lost Soul chains
          // For safety, do an iterative approach
          let replacement = zones.deck.shift();
          while (replacement && isLostSoul(replacement) && state.options.autoRouteLostSouls) {
            replacement.zone = 'land-of-bondage';
            replacement.isFlipped = false;
            zones['land-of-bondage'].push(replacement);
            replacement = zones.deck.length > 0 ? zones.deck.shift() : undefined;
          }
          if (replacement) {
            if (zones.hand.length >= HAND_LIMIT) {
              // Put it back
              zones.deck.unshift(replacement);
            } else {
              replacement.zone = 'hand';
              replacement.isFlipped = false;
              zones.hand.push(replacement);
            }
          }
        }
      } else if (zones.hand.length >= HAND_LIMIT) {
        // Hand full, put card back
        zones.deck.unshift(card);
        return state;
      } else {
        card.zone = 'hand';
        card.isFlipped = false;
        zones.hand.push(card);
      }

      return { ...state, zones, history };
    }

    case 'DRAW_MULTIPLE': {
      const count = action.payload.quantity || 3;
      let newState = { ...state, zones, history };
      for (let i = 0; i < count; i++) {
        if (newState.zones.deck.length === 0) break;
        if (newState.zones.hand.length >= HAND_LIMIT) break;
        newState = gameReducer(
          { ...newState, history: [] }, // avoid nested history
          { ...action, type: 'DRAW_CARD', payload: {} }
        );
        newState.history = history; // preserve the original history entry
      }
      return newState;
    }

    case 'SHUFFLE_DECK': {
      zones.deck = shuffleArray(zones.deck);
      return { ...state, zones, history };
    }

    case 'SHUFFLE_SOUL_DECK': {
      zones['soul-deck'] = shuffleArray(zones['soul-deck']);
      return { ...state, zones, history };
    }

    case 'MOVE_TO_TOP_OF_DECK': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      const result = findAndRemoveCard(zones, cardInstanceId);
      if (!result) return state;
      if (result.card.isToken) return { ...state, zones, history };
      result.card.zone = 'deck';
      result.card.revealUntil = undefined;
      if (result.fromZone === 'territory' || result.fromZone === 'land-of-bondage') {
        result.card.counters = [];
        result.card.notes = '';
        result.card.outlineColor = undefined;
      }
      zones.deck.unshift(result.card);
      return { ...state, zones, history };
    }

    case 'MOVE_TO_BOTTOM_OF_DECK': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      const result = findAndRemoveCard(zones, cardInstanceId);
      if (!result) return state;
      if (result.card.isToken) return { ...state, zones, history };
      result.card.zone = 'deck';
      result.card.revealUntil = undefined;
      if (result.fromZone === 'territory' || result.fromZone === 'land-of-bondage') {
        result.card.counters = [];
        result.card.notes = '';
        result.card.outlineColor = undefined;
      }
      zones.deck.push(result.card);
      return { ...state, zones, history };
    }

    case 'ADD_COUNTER': {
      const { cardInstanceId, color = 'red' } = action.payload;
      if (!cardInstanceId) return state;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const idx = zones[zoneId].findIndex(c => c.instanceId === cardInstanceId);
        if (idx >= 0) {
          const card = zones[zoneId][idx];
          const existingIdx = card.counters.findIndex(c => c.color === color);
          const newCounters = existingIdx >= 0
            ? card.counters.map((c, i) => i === existingIdx ? { ...c, count: c.count + 1 } : c)
            : [...card.counters, { color, count: 1 }];
          zones[zoneId] = [...zones[zoneId]];
          zones[zoneId][idx] = { ...card, counters: newCounters };
          return { ...state, zones, history };
        }
      }
      return state;
    }

    case 'REMOVE_COUNTER': {
      const { cardInstanceId, color = 'red' } = action.payload;
      if (!cardInstanceId) return state;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const idx = zones[zoneId].findIndex(c => c.instanceId === cardInstanceId);
        if (idx >= 0) {
          const card = zones[zoneId][idx];
          const existing = card.counters.find(c => c.color === color);
          if (existing && existing.count > 0) {
            const newCounters = existing.count === 1
              ? card.counters.filter(c => c.color !== color)
              : card.counters.map(c => c.color === color ? { ...c, count: c.count - 1 } : c);
            zones[zoneId] = [...zones[zoneId]];
            zones[zoneId][idx] = { ...card, counters: newCounters };
          }
          return { ...state, zones, history };
        }
      }
      return state;
    }

    case 'MEEK_CARD': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const card = zones[zoneId].find(c => c.instanceId === cardInstanceId);
        if (card) {
          card.isMeek = true;
          return { ...state, zones, history };
        }
      }
      return state;
    }

    case 'UNMEEK_CARD': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const card = zones[zoneId].find(c => c.instanceId === cardInstanceId);
        if (card) {
          card.isMeek = false;
          return { ...state, zones, history };
        }
      }
      return state;
    }

    case 'FLIP_CARD': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const card = zones[zoneId].find(c => c.instanceId === cardInstanceId);
        if (card) {
          card.isFlipped = !card.isFlipped;
          // Flipping face-down makes it a generic face-down card: drop any
          // player-added text and clear all counters.
          if (card.isFlipped) {
            card.counters = [];
            card.notes = '';
          }
          return { ...state, zones, history };
        }
      }
      return state;
    }

    case 'ADD_NOTE': {
      const { cardInstanceId, value } = action.payload;
      if (!cardInstanceId) return state;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const card = zones[zoneId].find(c => c.instanceId === cardInstanceId);
        if (card) {
          card.notes = String(value || '');
          return { ...state, zones, history };
        }
      }
      return state;
    }

    case 'ADVANCE_PHASE': {
      const currentIdx = PHASE_ORDER.indexOf(state.phase as any);
      if (currentIdx === -1 || currentIdx >= PHASE_ORDER.length - 1) {
        return state;
      }
      return { ...state, phase: PHASE_ORDER[currentIdx + 1], history };
    }

    case 'REGRESS_PHASE': {
      const currentIdx = PHASE_ORDER.indexOf(state.phase as any);
      if (currentIdx <= 0) {
        return state;
      }
      return { ...state, phase: PHASE_ORDER[currentIdx - 1], history };
    }

    case 'END_TURN': {
      // End turn: increment turn, reset to draw phase, and auto-draw 3 cards
      let newState: GameState = {
        ...state,
        zones,
        turn: state.turn + 1,
        phase: 'draw',
        drawnThisTurn: true,
        history,
      };
      // Draw 3 cards for the new turn
      for (let i = 0; i < 3; i++) {
        if (newState.zones.deck.length === 0) break;
        if (newState.zones.hand.length >= HAND_LIMIT) break;
        newState = gameReducer(
          { ...newState, history: [] },
          { ...action, type: 'DRAW_CARD', payload: {} }
        );
        newState.history = history;
        newState.drawnThisTurn = true;
      }
      if (newState.format === 'Paragon') {
        newState = { ...newState, zones: refillSoulDeck(newState.zones) };
      }
      return newState;
    }

    case 'MOVE_CARDS_BATCH': {
      const { cardInstanceIds, toZone, positions } = action.payload;
      if (!cardInstanceIds || !toZone) return state;

      const movedIds = new Set(cardInstanceIds);
      // Pre-compute per-card final destination. Weapons whose attached warrior
      // is also in this batch and going to LOB get redirected to discard — a
      // warrior heading to LOB takes its weapons down with it.
      const finalZoneById = new Map<string, ZoneId>();
      for (const id of cardInstanceIds) {
        let cardObj: GameCard | undefined;
        for (const zoneId of Object.keys(zones) as ZoneId[]) {
          const found = zones[zoneId].find(c => c.instanceId === id);
          if (found) { cardObj = found; break; }
        }
        if (!cardObj) continue;
        const redirected =
          toZone === 'land-of-bondage' &&
          !!cardObj.equippedTo &&
          movedIds.has(cardObj.equippedTo);
        finalZoneById.set(id, redirected ? 'discard' : toZone);
      }

      let anyRescue = false;
      for (const instanceId of cardInstanceIds) {
        const result = findAndRemoveCard(zones, instanceId);
        if (!result) continue;
        const finalZone = finalZoneById.get(instanceId) ?? toZone;
        // Tokens group-dragged into a non-play zone are removed entirely —
        // mirror of the single MOVE_CARD rule. findAndRemoveCard already pulled
        // it out of its source zone, so skipping the re-add deletes it.
        const TOKEN_REMOVE_ZONES: ZoneId[] = ['reserve', 'banish', 'discard', 'hand', 'deck'];
        if (result.card.isToken && TOKEN_REMOVE_ZONES.includes(finalZone)) {
          continue;
        }
        if (result.fromZone === 'deck' && finalZone !== 'deck') {
          result.card.isFlipped = false;
        }
        if (result.fromZone === 'soul-deck' && finalZone !== 'soul-deck') {
          result.card.isFlipped = false;
        }
        result.card.zone = finalZone;
        if (result.fromZone !== finalZone) {
          result.card.revealUntil = undefined;
        }
        if (
          result.fromZone !== finalZone &&
          (result.fromZone === 'territory' || result.fromZone === 'land-of-bondage')
        ) {
          result.card.counters = [];
          result.card.notes = '';
          result.card.outlineColor = undefined;
          result.card.isRotated = undefined;
        }
        const wasSharedSoulFromLob =
          result.fromZone === 'land-of-bondage' &&
          result.card.ownerId === 'shared' &&
          result.card.isSoulDeckOrigin === true;
        if (wasSharedSoulFromLob) {
          result.card.ownerId = 'player1';
        }
        if (
          result.fromZone === 'land-of-bondage' &&
          result.card.isSoulDeckOrigin === true &&
          finalZone === 'land-of-redemption'
        ) {
          anyRescue = true;
        }
        const pos = positions?.[instanceId];
        result.card.posX = finalZone === 'territory' ? pos?.posX : undefined;
        result.card.posY = finalZone === 'territory' ? pos?.posY : undefined;
        // Leaving territory — always unlink (batch grouping doesn't preserve
        // the attach the way it used to). If destination is LOB, any weapon
        // pointing at this mover that's NOT already in the batch auto-discards.
        if (finalZone !== 'territory') {
          if (result.card.equippedTo) {
            result.card.equippedTo = undefined;
          }
          for (const zoneId of Object.keys(zones) as ZoneId[]) {
            for (let i = 0; i < zones[zoneId].length; i++) {
              const other = zones[zoneId][i];
              if (other.equippedTo !== instanceId) continue;
              if (movedIds.has(other.instanceId)) {
                // Batch-member weapon — finalZoneById already routes it.
                zones[zoneId][i] = { ...other, equippedTo: undefined };
                continue;
              }
              if (finalZone === 'land-of-bondage') {
                const leavingPlay =
                  zoneId === 'territory' || zoneId === 'land-of-bondage';
                zones[zoneId].splice(i, 1);
                i--;
                zones.discard.push({
                  ...other,
                  zone: 'discard',
                  equippedTo: undefined,
                  posX: undefined,
                  posY: undefined,
                  counters: leavingPlay ? [] : other.counters,
                  notes: leavingPlay ? '' : other.notes,
                  outlineColor: leavingPlay ? undefined : other.outlineColor,
                });
              } else {
                zones[zoneId][i] = { ...other, equippedTo: undefined };
              }
            }
          }
        }
        zones[finalZone].push(result.card);
      }
      let finalZones = zones;
      if (state.format === 'Paragon' && anyRescue) {
        finalZones = refillSoulDeck(zones);
      }
      return { ...state, zones: finalZones, history };
    }

    case 'ADD_OPPONENT_LOST_SOUL': {
      const testament = (action.payload.value as string) === 'OT' ? 'OT' : 'NT';
      const cardName = testament === 'NT'
        ? 'Lost Soul Token "Harvest" [John 4:35]'
        : 'Lost Soul Token "Lost Souls" [Proverbs 2:16-17]';
      const cardImgFile = testament === 'NT'
        ? '/gameplay/nt_soul_token.png'
        : '/gameplay/ot_lost_soul.png';
      const opponentSoul: GameCard = {
        instanceId: crypto.randomUUID(),
        cardName,
        cardSet: testament === 'NT' ? 'GoC' : 'RR',
        cardImgFile,
        type: 'LS',
        brigade: '',
        strength: '',
        toughness: '',
        specialAbility: '',
        identifier: testament,
        reference: '',
        alignment: 'Neutral',
        isMeek: false,
        counters: [],
        isFlipped: false,
        isToken: true,
        zone: 'land-of-bondage',
        ownerId: 'player2',
        notes: '',
        posX: action.payload.posX,
        posY: action.payload.posY,
      };
      zones['land-of-bondage'].push(opponentSoul);
      return { ...state, zones, history };
    }

    case 'ADD_PLAYER_LOST_SOUL': {
      const soul: GameCard = {
        instanceId: crypto.randomUUID(),
        cardName: 'Lost Soul Token "Lost Souls" [Proverbs 2:16-17]',
        cardSet: 'RR',
        cardImgFile: '/gameplay/ot_lost_soul.png',
        type: 'LS',
        brigade: '',
        strength: '',
        toughness: '',
        specialAbility: '',
        identifier: 'OT',
        reference: '',
        alignment: 'Neutral',
        isMeek: false,
        counters: [],
        isFlipped: false,
        isToken: true,
        zone: 'land-of-redemption',
        ownerId: 'player1',
        notes: '',
      };
      zones['land-of-redemption'].push(soul);
      return { ...state, zones, history };
    }

    case 'REMOVE_OPPONENT_TOKEN': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      findAndRemoveCard(zones, cardInstanceId);
      return { ...state, zones, history };
    }

    case 'REORDER_HAND': {
      const { cardInstanceIds } = action.payload;
      if (!cardInstanceIds || cardInstanceIds.length === 0) return state;

      // Build a map of instanceId → card for quick lookup
      const handMap = new Map<string, GameCard>();
      for (const card of zones.hand) {
        handMap.set(card.instanceId, card);
      }

      // Reorder hand to match the provided ID order
      const reordered: GameCard[] = [];
      for (const id of cardInstanceIds) {
        const card = handMap.get(id);
        if (card) {
          reordered.push(card);
          handMap.delete(id);
        }
      }
      // Append any cards not in the provided list (safety net)
      for (const card of handMap.values()) {
        reordered.push(card);
      }

      zones.hand = reordered;
      return { ...state, zones, history };
    }

    case 'REORDER_LOB': {
      const { cardInstanceIds } = action.payload;
      if (!cardInstanceIds || cardInstanceIds.length === 0) return state;

      const lobMap = new Map<string, GameCard>();
      for (const card of zones['land-of-bondage']) {
        lobMap.set(card.instanceId, card);
      }

      const reordered: GameCard[] = [];
      for (const id of cardInstanceIds) {
        const card = lobMap.get(id);
        if (card) {
          reordered.push(card);
          lobMap.delete(id);
        }
      }
      for (const card of lobMap.values()) {
        reordered.push(card);
      }

      zones['land-of-bondage'] = reordered;
      return { ...state, zones, history };
    }

    case 'ATTACH_CARD': {
      const { cardInstanceId, warriorInstanceId } = action.payload;
      if (!cardInstanceId || !warriorInstanceId) return state;
      const warrior = zones.territory.find(c => c.instanceId === warriorInstanceId);
      if (!warrior) return state;
      // Weapon may be in ANY zone (e.g. hand, territory). Pull it out, move
      // it into territory, and set equippedTo. Insert it in the territory
      // array immediately BEFORE the warrior so render order places it behind.
      const found = findAndRemoveCard(zones, cardInstanceId);
      if (!found) return state;
      const attachedWeapon: GameCard = {
        ...found.card,
        zone: 'territory',
        equippedTo: warriorInstanceId,
        posX: warrior.posX,
        posY: warrior.posY,
        isFlipped: false,
      };
      const warriorIdx = zones.territory.findIndex(c => c.instanceId === warriorInstanceId);
      if (warriorIdx >= 0) {
        zones.territory.splice(warriorIdx, 0, attachedWeapon);
      } else {
        zones.territory.push(attachedWeapon);
      }
      return { ...state, zones, history };
    }

    case 'DETACH_CARD': {
      const { cardInstanceId, posX, posY } = action.payload;
      if (!cardInstanceId) return state;
      // Remove the weapon wherever it is, then reinsert it into territory
      // immediately BEFORE its (former) warrior — this keeps it rendered
      // behind the warrior after the link is broken.
      let foundIdx = -1;
      let foundZone: ZoneId | null = null;
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        const idx = zones[zoneId].findIndex(c => c.instanceId === cardInstanceId);
        if (idx >= 0) { foundIdx = idx; foundZone = zoneId; break; }
      }
      if (foundIdx === -1 || !foundZone) return state;
      const weapon = zones[foundZone][foundIdx];
      const warriorId = weapon.equippedTo;
      const detached: GameCard = {
        ...weapon,
        equippedTo: undefined,
        posX: posX ?? weapon.posX,
        posY: posY ?? weapon.posY,
      };
      zones[foundZone].splice(foundIdx, 1);
      if (foundZone === 'territory' && warriorId) {
        const warriorIdxAfter = zones.territory.findIndex(c => c.instanceId === warriorId);
        if (warriorIdxAfter >= 0) {
          zones.territory.splice(warriorIdxAfter, 0, detached);
        } else {
          zones.territory.push(detached);
        }
      } else {
        zones[foundZone].splice(foundIdx, 0, detached);
      }
      return { ...state, zones, history };
    }

    case 'EXECUTE_CARD_ABILITY': {
      const { cardInstanceId, abilityIndex } = action.payload;
      if (!cardInstanceId || abilityIndex === undefined) return state;

      // Locate the source across all zones.
      let source: GameCard | undefined;
      for (const zone of Object.values(state.zones)) {
        const found = zone.find(c => c.instanceId === cardInstanceId);
        if (found) { source = found; break; }
      }
      if (!source) return state;

      // Abilities only fire when the source card is in play. Matches the
      // CardContextMenu gate — a malformed dispatch from elsewhere still
      // no-ops here rather than leaving weird state. Includes Land of
      // Redemption so resting Heroes can trigger abilities.
      if (!DEFAULT_ABILITY_SOURCE_ZONES.includes(source.zone)) return state;

      // Registry keys match GameCard.cardName (includes the set suffix for the
      // v1 cards, e.g., "Two Possessed (GoC)"). The card's identifier field is
      // a taxonomy descriptor ("Generic, Demon", etc.) and is NOT unique enough
      // to key the registry.
      // Use effective abilities so an Imitate Soul's inherited abilities
      // resolve at the correct index when dispatched from the menu.
      const ability = getEffectiveAbilities(source)[abilityIndex];
      if (!ability) return state;

      switch (ability.type) {
        case 'spawn_token':
          return spawnTokenInState(state, source, ability, history);
        case 'shuffle_and_draw':
          // Reserved for future — v1 ships spawn_token only.
          return state;
        case 'all_players_shuffle_and_draw':
          // Goldfish is single-player — apply to the card's owner only.
          return shuffleAndDrawInState(state, source.ownerId, ability.shuffleCount, ability.drawCount, history);
        case 'reveal_own_deck':
        case 'look_at_own_deck':
        case 'look_at_own_deck_choose':
        case 'reveal_own_deck_choose':
        case 'look_at_opponent_deck':
        case 'look_at_opponent_deck_choose':
        case 'reveal_opponent_deck':
        case 'reveal_opponent_deck_choose':
        case 'discard_opponent_deck':
        case 'discard_opponent_deck_choose':
        case 'reserve_opponent_deck':
          // Modal-driven or opponent-required — GoldfishCanvas intercepts, or
          // the effect is multiplayer-only. No-op here. (look_at_own_deck_choose
          // is opened via the count prompt → executeCardAbilityWithCount path.)
          return state;
        case 'reserve_top_of_deck':
          return reserveTopOfDeckInState(state, source, ability, history);
        case 'draw_bottom_of_deck':
          return drawBottomOfDeckInState(state, source, ability, history);
        case 'draw_bottom_of_deck_choose':
          // Client opens a count dialog and dispatches EXECUTE_CARD_ABILITY_WITH_COUNT
          // — this action carries no count, so no-op here.
          return state;
        case 'discard_bottom_of_deck':
          return discardBottomOfDeckInState(state, source, history);
        case 'underdeck_top_of_deck':
          return underdeckTopOfDeckInState(state, source, ability, history);
        case 'discard_characters_from_reserve':
          return discardCharactersFromReserveInState(state, source, ability, history);
        case 'set_card_outline':
          return setCardOutlineInState(state, source, ability, history);
        case 'set_rotation':
          return setRotationInState(state, source, ability, history);
        case 'play_all_lost_souls':
          return playAllLostSoulsInState(state, source, history);
        case 'band_heroes_from_deck':
          return bandHeroesFromDeckInState(state, source, ability, history);
        case 'draw_brigades':
          // Reads the opponent's revealed hand — meaningless in single-player
          // goldfish. Dispatched client-side in multiplayer. No-op here.
          return state;
        case 'toggle_top_deck_reveal':
          // Persistent flag — the canvas renders the top deck card face up
          // (and draggable) while set. Nothing else in the state changes.
          return { ...state, topDeckRevealed: !state.topDeckRevealed, history };
        case 'custom':
          // Custom abilities are dispatched client-side in multiplayer and
          // never reach the goldfish reducer in v1. No-op defensively.
          return state;
        case 'three_nails_reset':
          return threeNailsResetInState(state, source, history);
        case 'imitate_lost_soul':
          // Targeting variant — dispatched via the dedicated IMITATE_LOST_SOUL
          // action which carries a target. No-op here.
          return state;
        case 'draw_and_topdeck_self':
          return drawAndTopdeckSelfInState(state, source, history);
        case 'resurrect_heroes':
          // Interactive picker — dispatched via the dedicated RESURRECT_HEROES
          // action which carries the selected card ids. No-op here.
          return state;
        case 'all_players_keep_one_shuffle_draw':
          // Interactive picker — dispatched via the dedicated
          // KEEP_ONE_SHUFFLE_DRAW action which carries the kept card. No-op here.
          return state;
        default: {
          const _exhaustive: never = ability;
          return state;
        }
      }
    }

    case 'EXECUTE_CARD_ABILITY_WITH_COUNT': {
      const { cardInstanceId, abilityIndex, quantity } = action.payload;
      if (!cardInstanceId || abilityIndex === undefined || typeof quantity !== 'number') return state;
      if (quantity < 1) return state;

      let source: GameCard | undefined;
      for (const zone of Object.values(state.zones)) {
        const found = zone.find(c => c.instanceId === cardInstanceId);
        if (found) { source = found; break; }
      }
      if (!source) return state;

      if (!DEFAULT_ABILITY_SOURCE_ZONES.includes(source.zone)) return state;

      const ability = getEffectiveAbilities(source)[abilityIndex];
      if (!ability) return state;
      if (ability.type !== 'draw_bottom_of_deck_choose') return state;

      return drawBottomOfDeckInState(
        state,
        source,
        { type: 'draw_bottom_of_deck', count: quantity },
        history,
      );
    }

    case 'RESURRECT_HEROES': {
      const { cardInstanceIds } = action.payload;
      if (!Array.isArray(cardInstanceIds) || cardInstanceIds.length === 0) return state;
      return resurrectHeroesInState(state, cardInstanceIds, history);
    }

    case 'KEEP_ONE_SHUFFLE_DRAW': {
      // Goldfish is single-seat, so only the source's owner is affected — the
      // same convention all_players_shuffle_and_draw follows here.
      const { keepInstanceId } = action.payload;
      if (!keepInstanceId) return state;
      return shuffleAndDrawInState(state, 'player1', 0, 0, history, keepInstanceId);
    }

    case 'IMITATE_LOST_SOUL': {
      const { cardInstanceId, targetInstanceId } = action.payload;
      if (!cardInstanceId || !targetInstanceId) return state;
      return imitateLostSoulInState(state, cardInstanceId, targetInstanceId, history);
    }

    case 'STOP_IMITATING_LOST_SOUL': {
      const { cardInstanceId } = action.payload;
      if (!cardInstanceId) return state;
      return stopImitatingInState(state, cardInstanceId, history);
    }

    case 'REVEAL_CARD_IN_HAND': {
      const { cardInstanceId, value } = action.payload;
      if (!cardInstanceId || typeof value !== 'number') return state;
      // Only reveal cards that are actually in hand — silently no-op otherwise.
      const idx = zones.hand.findIndex(c => c.instanceId === cardInstanceId);
      if (idx === -1) return state;
      zones.hand = [...zones.hand];
      zones.hand[idx] = { ...zones.hand[idx], revealUntil: value };
      return { ...state, zones, history };
    }

    case 'DECK_SPREAD': {
      // Gear menu "Spread Deck": the pile goes face-up onto Territory at the
      // positions GoldfishCanvas computed from the deck-builder layout. Cards
      // are appended in the given order so each one paints over the card
      // above it, leaving the deck builder's top strips visible.
      const { cardInstanceIds, positions } = action.payload;
      if (!cardInstanceIds || zones.deck.length === 0) return state;
      const moved: string[] = [];
      for (const id of cardInstanceIds) {
        const idx = zones.deck.findIndex(c => c.instanceId === id);
        if (idx === -1) continue;
        const [card] = zones.deck.splice(idx, 1);
        const pos = positions?.[id];
        zones.territory.push({
          ...card,
          zone: 'territory',
          isFlipped: false,
          revealUntil: undefined,
          posX: pos?.posX,
          posY: pos?.posY,
        });
        moved.push(id);
      }
      if (moved.length === 0) return state;
      return { ...state, zones, history, deckSpreadIds: moved };
    }

    case 'DECK_GATHER': {
      // Gear menu "Gather Deck": the spread cards still in Territory go back
      // to the pile face-down with their in-play state dropped (the same
      // cleanup MOVE_CARD does on leaving Territory, plus meek — MOVE_CARD
      // into the deck never clears that), then the pile is shuffled. Cards the
      // player moved elsewhere were already pruned from the list.
      const ids = state.deckSpreadIds;
      if (!ids || ids.length === 0) return state;
      const gathering = new Set(ids);
      const returned: GameCard[] = [];
      zones.territory = zones.territory.filter(card => {
        if (!gathering.has(card.instanceId)) return true;
        returned.push({
          ...card,
          zone: 'deck',
          isFlipped: true,
          isMeek: false,
          counters: [],
          notes: '',
          outlineColor: undefined,
          isRotated: undefined,
          revealUntil: undefined,
          revealDurationMs: undefined,
          posX: undefined,
          posY: undefined,
          equippedTo: undefined,
        });
        return false;
      });
      if (returned.length === 0) return state;
      // A weapon the player attached to a gathered card stays put, unlinked.
      for (const zoneId of Object.keys(zones) as ZoneId[]) {
        zones[zoneId] = zones[zoneId].map(c =>
          c.equippedTo && gathering.has(c.equippedTo) ? { ...c, equippedTo: undefined } : c,
        );
      }
      zones.deck = shuffleArray([...zones.deck, ...returned]);
      return { ...state, zones, history, deckSpreadIds: undefined };
    }

    default:
      return state;
  }
}

export function undoAction(state: GameState): GameState {
  if (state.history.length === 0) return state;
  const previous = state.history[state.history.length - 1];
  return {
    ...previous,
    history: state.history.slice(0, -1),
  };
}
