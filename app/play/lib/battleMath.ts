// Pure client-side battle math for the Battle Zone (spec §3/§6). No canvas,
// no server, no React — every function here is a plain data transform so it
// can be unit tested in isolation and reused by rendering/interaction code
// (Tasks 10/12/13) without dragging in any of that machinery.

export type BattleSeat = '0' | '1';

export interface BattleCardLike {
  ownerSeat: BattleSeat;
  dbX: number;
  cardRelW: number;
  strength: string;
  toughness: string;
  brigade: string;
  cardType: string;
  specialAbility: string;
  isFlipped: boolean;
  // Extra fields for summarizeAutoReturn (not part of the original per-card
  // battle math above) — see the "Interface conflict" note in the task
  // report for why these were added beyond the brief's literal interface.
  cardName: string;
  equippedToInstanceId?: bigint | number;
  // Stamped origin zone (CardInstance.originZone) — mirrors the server's
  // runBattleAutoReturn rule 5: catch-all cards (Artifacts/Curses/
  // Fortresses/unknown) return to this zone when set and it isn't
  // 'territory', instead of landing in territory.
  originZone?: string;
}

function otherSeat(seat: BattleSeat): BattleSeat {
  return seat === '0' ? '1' : '0';
}

/**
 * Side is derived, never stored, from the card's owner-local CENTER, not its
 * top-left anchor: centerX = dbX + cardRelW / 2. Write-time clamping caps an
 * own-card anchor at `1 - cardRelW`, so an anchor-only `dbX >= 0.5` check
 * would misclassify a legitimately-own-side card as opponent-side. Every
 * player plays into their OWN right half (centerX >= 0.5 = own side) — owner-
 * local mirroring means each client renders its own cards on its own right
 * and the opponent's on its left, consistently on both screens. A card whose
 * center crosses the 0.5 line (dragged across the centerline) fights for the
 * opponent's side instead.
 */
export function battleSideOf(c: BattleCardLike): BattleSeat {
  const centerX = c.dbX + c.cardRelW / 2;
  return centerX >= 0.5 ? c.ownerSeat : otherSeat(c.ownerSeat);
}

export interface SideTotals {
  str: number;
  tgh: number;
  hasUnknown: boolean;
}

/**
 * Parses one stat string for the band totals. A BLANK stat on a
 * non-character means the card simply has no printed numbers — 524 official
 * enhancements ship that way (Death of Unrighteous's Roots reprint prints
 * the very same card as 0/0), and Dominants/Artifacts never have stats — so
 * it counts as 0. A blank stat on a CHARACTER is hidden information (an
 * ungranted forge row; official characters always print numbers) and a
 * non-blank unparseable stat ('*', 'X') is genuinely variable — both return
 * null so the caller sets hasUnknown.
 */
function parseBattleStat(raw: string, cardType: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return isCharacterType(cardType) ? null : 0;
  }
  const n = parseInt(trimmed, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Sums strength/toughness for every card on `side`. Variable stat strings
 * ('*', 'X', ...) contribute 0 and set hasUnknown; blank stats only do so on
 * characters (see parseBattleStat). Face-down cards are excluded from the
 * sum entirely (their stats are hidden information) and also set hasUnknown,
 * so the caller never asserts a rules conclusion from a band with hidden
 * cards in it.
 */
export function sideTotals(cards: BattleCardLike[], side: BattleSeat): SideTotals {
  let str = 0;
  let tgh = 0;
  let hasUnknown = false;

  for (const c of cards) {
    if (battleSideOf(c) !== side) continue;
    if (c.isFlipped) {
      hasUnknown = true;
      continue;
    }
    const s = parseBattleStat(c.strength, c.cardType);
    const t = parseBattleStat(c.toughness, c.cardType);
    if (s === null) {
      hasUnknown = true;
    } else {
      str += s;
    }
    if (t === null) {
      hasUnknown = true;
    } else {
      tgh += t;
    }
  }

  return { str, tgh, hasUnknown };
}

/**
 * Extracts the meek-side stat from a raw CardInstance strength/toughness
 * string. Redemption printings that support a Meek conversion encode both
 * stats in one field, "<normal>(<meek>)" — e.g. Matthias (GoC): strength
 * "X(7)", toughness "3(7)" both carry a meek side of 7. CardInstance rows
 * copy these strings verbatim from card data at deal time and the
 * meek_card/unmeek_card reducers only flip the isMeek boolean (never touch
 * strength/toughness), so the meek value is always sitting in the row's
 * existing field — no separate data source or card lookup needed. Returns
 * null when there's no parenthesized meek value to read (plain "7", a
 * blanked Forge field, a non-meek card), so callers can fall back to their
 * existing "unknown" handling.
 */
function parseMeekStatValue(raw: string): number | null {
  const match = raw.match(/\((-?\d+)\)\s*$/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isNaN(n) ? null : n;
}

export function parseMeekStats(strength: string, toughness: string): { strength: number; toughness: number } | null {
  const s = parseMeekStatValue(strength);
  const t = parseMeekStatValue(toughness);
  if (s === null || t === null) return null;
  return { strength: s, toughness: t };
}

/**
 * Picks the stat pair matching a dual-icon card's CURRENT alignment.
 *
 * Six official cards print two stat lines and the generated card data joins
 * them with a slash into one field — Nebuchadnezzar (PoC) ships
 * strength "4/11", toughness "3/10". `parseInt` stops at the slash, so
 * before this helper every one of them silently contributed its LEFT value
 * to the band totals.
 *
 * The segments are ordered GOOD SIDE FIRST. That holds for the dual-type
 * printings by construction (Delivered / Philosophy are "GE/EE"; Scapegoat
 * (PoC) is "GE/Evil Character" with stats "-/0" and "-/6" — the GE side has
 * no printed numbers), and the Nebuchadnezzar (PoC) scan confirms it for the
 * single-type case: his card prints the crimson 11/10 on the LEFT and the
 * purple/white 4/3 on the right, i.e. the data order is the reverse of the
 * card's visual order.
 *
 * So an Evil-aligned instance reads the last segment and everything else
 * reads the first. Applied to the six real cards that means:
 *
 *   Nebuchadnezzar (PoC)  Evil     -> 11/10  (his Evil Character side; he
 *                                    "Begins as an Evil Character" and only
 *                                    converts to the 4/3 Hero AFTER battle,
 *                                    so 11/10 is the only value a card in
 *                                    the band can have)
 *   Persian Horsemen      Evil     -> 2/2    (both segments are 2/2)
 *   Abram/Abraham         Good     -> 5/6    (Abram, the printed base state)
 *   Delivered, Philosophy Neutral  -> 3/2    (the GE side)
 *   Scapegoat (PoC)       Neutral  -> "-"    (unparseable -> band shows "?",
 *                                    exactly as before)
 *
 * Only Nebuchadnezzar changes value; the other five keep the number the old
 * `parseInt` produced. Returns null when there is nothing to disambiguate
 * (a single-segment stat, or a segment count that doesn't line up), so
 * callers fall through to the raw string and every existing "unknown"
 * path is untouched. Deliberately returns STRINGS, not numbers: a segment
 * can be "-", "X" or "" and parseBattleStat already knows what each means.
 */
export function parseAlignmentStats(
  strength: string,
  toughness: string,
  alignment: string,
): { strength: string; toughness: string } | null {
  const s = strength.split('/');
  const t = toughness.split('/');
  // Both fields must offer the same two sides, or we can't say which stat
  // belongs to which icon — bail rather than pair mismatched segments.
  if (s.length !== 2 || t.length !== 2) return null;
  const i = alignment.trim().toLowerCase() === 'evil' ? 1 : 0;
  return { strength: s[i].trim(), toughness: t[i].trim() };
}

export type InitiativeState =
  | { kind: 'empty' }
  | { kind: 'waiting-blocker' }
  | { kind: 'no-attacker' }
  | { kind: 'unknown' }
  | { kind: 'initiative'; seat: BattleSeat; reason: 'losing' | 'stalemate' | 'mutual-destruction' };

/** Character-in-battle detection, mirroring spacetimedb/src/cardAbilities.ts's
 * isCharacterCard: a substring check on the lowercased cardType so dual-type
 * ("Hero/Evil Character") and token variants still count. Enhancements/sites/
 * souls never count as "presence" for the empty-side checks below. */
function isCharacterType(cardType: string): boolean {
  const t = cardType.toLowerCase();
  return t.includes('hero') || t.includes('evil character');
}

/**
 * REG initiative table + the two "band isn't a real fight yet" states.
 * Side A is "losing" iff strA < tghB && tghA <= strB, and the losing side
 * gets initiative. If both sides' toughness beats the opponent's strength,
 * it's a stalemate; if both sides' strength matches/beats the opponent's
 * toughness, it's mutual destruction — for those two, initiative goes to
 * whichever seat did NOT make the last play (`lastPlayBySeat`); if that's
 * unset ('') the spec is silent on a default, so this returns 'unknown'
 * rather than assert one.
 */
export function computeInitiative(
  cards: BattleCardLike[],
  attackerSeat: BattleSeat,
  lastPlayBySeat: BattleSeat | ''
): InitiativeState {
  const defenderSeat = otherSeat(attackerSeat);

  const attackerHasCharacters = cards.some(
    (c) => battleSideOf(c) === attackerSeat && isCharacterType(c.cardType)
  );
  const defenderHasCharacters = cards.some(
    (c) => battleSideOf(c) === defenderSeat && isCharacterType(c.cardType)
  );

  if (!attackerHasCharacters) {
    // Neither side has a character yet (band just opened, or only
    // enhancements/sites are down): there is no fight to assess — callers
    // suppress the status banner and let the drag-guidance cue do the
    // talking instead of showing a contradictory "waiting for a blocker".
    return defenderHasCharacters ? { kind: 'no-attacker' } : { kind: 'empty' };
  }
  if (!defenderHasCharacters) {
    return { kind: 'waiting-blocker' };
  }

  const attacker = sideTotals(cards, attackerSeat);
  const defender = sideTotals(cards, defenderSeat);
  if (attacker.hasUnknown || defender.hasUnknown) {
    return { kind: 'unknown' };
  }

  // a: attacker cannot destroy defender outright; b: defender cannot destroy
  // attacker outright. These two booleans partition every stat combination
  // into exactly the four REG rows below (see task report for the proof).
  const a = attacker.str < defender.tgh;
  const b = defender.str < attacker.tgh;

  if (a && !b) {
    return { kind: 'initiative', seat: attackerSeat, reason: 'losing' };
  }
  if (b && !a) {
    return { kind: 'initiative', seat: defenderSeat, reason: 'losing' };
  }

  if (lastPlayBySeat === '') {
    return { kind: 'unknown' };
  }
  const seat = otherSeat(lastPlayBySeat);
  return { kind: 'initiative', seat, reason: a && b ? 'stalemate' : 'mutual-destruction' };
}

export interface AutoReturnSummary {
  toTerritory: number;
  toOrigin: number;
  toDiscard: number;
  toLandOfBondage: number;
  keptInPlay: string[];
  weaponsAttached: number;
}

function isEquipped(v: bigint | number | undefined): boolean {
  return v !== undefined && v !== 0 && v !== 0n;
}

// Mirrors spacetimedb/src/index.ts's isLostSoulCard idiom (runBattleAutoReturn).
function isLostSoulLike(c: BattleCardLike): boolean {
  return c.cardType === 'LS' || c.cardType === 'TOKEN_LS' || c.cardName.toLowerCase().includes('lost soul');
}

// Mirrors the server's isPlaceKeep: "place" wording that isn't "in (the)
// place of" / "take the place of".
function isPlaceKeep(specialAbility: string): boolean {
  return (
    /\bplace\b/i.test(specialAbility) &&
    !/\bin (the )?place of\b/i.test(specialAbility) &&
    !/take the place of/i.test(specialAbility)
  );
}

// Mirrors the server's enhSegment: exact 'GE'/'EE' segment on cardType,
// split on '/' and trimmed — there is no literal "Enhancement" type.
function isEnhancementSegment(cardType: string): boolean {
  return cardType
    .split('/')
    .map((s) => s.trim())
    .some((s) => s === 'GE' || s === 'EE');
}

// Mirrors the server's domSegment: Dominants are discarded after use like
// enhancements, never returned to the hand they were played from.
function isDominantSegment(cardType: string): boolean {
  return cardType
    .split('/')
    .map((s) => s.trim())
    .some((s) => s === 'Dominant');
}

/**
 * Client mirror of the server's end-of-battle auto-return routing
 * precedence (spec §7 runBattleAutoReturn), for the pre-resolve confirm
 * dialog. Not a rules engine — just a count-and-name summary of where each
 * card in `cards` (everything currently in the battle band) would land:
 * equipped accessories stay attached (weaponsAttached), Lost Souls go to
 * the Land of Bondage, characters go to territory, and GE/EE enhancements
 * and Dominants go to discard unless their specialAbility matches the
 * "place" keep heuristic, in which case they stay in territory and their
 * name is recorded in keptInPlay. The catch-all "everything else" bucket
 * (Artifacts/Curses/Fortresses/unknown/Forge-blanked types)
 * mirrors the server's runBattleAutoReturn rule 5: it returns to the
 * card's stamped originZone when one is set and isn't 'territory' (counted
 * in toOrigin), otherwise it lands in territory like today (toTerritory).
 */
export function summarizeAutoReturn(cards: BattleCardLike[]): AutoReturnSummary {
  let toTerritory = 0;
  let toOrigin = 0;
  let toDiscard = 0;
  let toLandOfBondage = 0;
  let weaponsAttached = 0;
  const keptInPlay: string[] = [];

  for (const c of cards) {
    if (isEquipped(c.equippedToInstanceId)) {
      weaponsAttached++;
      continue;
    }
    if (isLostSoulLike(c)) {
      toLandOfBondage++;
      continue;
    }
    if (isCharacterType(c.cardType)) {
      toTerritory++;
      continue;
    }
    if (isEnhancementSegment(c.cardType) || isDominantSegment(c.cardType)) {
      if (isPlaceKeep(c.specialAbility)) {
        keptInPlay.push(c.cardName);
        toTerritory++;
      } else {
        toDiscard++;
      }
      continue;
    }
    // Rule 5 catch-all: origin zone wins when stamped and not 'territory'
    // (or 'battle', defensively — see runBattleAutoReturn) — otherwise
    // falls back to territory, same as before this bucket existed.
    if (c.originZone && c.originZone !== 'territory' && c.originZone !== 'battle') {
      toOrigin++;
    } else {
      toTerritory++;
    }
  }

  return { toTerritory, toOrigin, toDiscard, toLandOfBondage, keptInPlay, weaponsAttached };
}

/**
 * Which of the stakes Lost Souls have a Site (or any accessory) attached.
 *
 * Attachment direction (server attach_card / the unlink cascade in
 * moveLostSoulToLor): the ACCESSORY row carries the nonzero
 * equippedToInstanceId pointing at its HOST — a soul's own
 * equippedToInstanceId is always 0n. So "soul s is site-attached" iff any
 * other row in the game points at s. Any-accessory-pointing-at-soul is the
 * safe superset (attach_card infers site-vs-weapon from the accessory's own
 * type; only site/city accessories attach to souls in practice).
 *
 * Pure so the derivation is unit-testable; the caller (MultiplayerCanvas)
 * feeds it every card row in the game plus the eligible-souls list.
 */
export function siteAttachedSoulIds(
  souls: ReadonlyArray<{ id: bigint }>,
  allRows: ReadonlyArray<{ equippedToInstanceId: bigint }>,
): Set<string> {
  const result = new Set<string>();
  if (souls.length === 0) return result;
  const soulIds = new Set(souls.map((s) => s.id.toString()));
  for (const row of allRows) {
    if (row.equippedToInstanceId === 0n) continue;
    const hostId = row.equippedToInstanceId.toString();
    if (soulIds.has(hostId)) result.add(hostId);
  }
  return result;
}
