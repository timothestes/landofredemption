import { describe, it, expect } from 'vitest';
import {
  battleSideOf,
  sideTotals,
  computeInitiative,
  summarizeAutoReturn,
  siteAttachedSoulIds,
  parseMeekStats,
  parseAlignmentStats,
  type BattleCardLike,
} from '../battleMath';
import { CARDS } from '@/lib/cards/lookup';

// Card factory. Defaults land the card on its OWNER's own half
// (dbX=0.6, cardRelW=0.1 -> centerX=0.65 >= 0.5) so most totals/initiative
// tests can just set `ownerSeat` to place a card on a given battle side.
// dbX is stored owner-local (spec §3), so a card's side-derivation math is
// identical regardless of which player owns it or which client is
// rendering it -- no separate "opponent-owned" variant is needed for these
// tests; battleSideOf's own describe block below covers the geometry.
function mkCard(overrides: Partial<BattleCardLike> = {}): BattleCardLike {
  return {
    ownerSeat: '0',
    dbX: 0.6,
    cardRelW: 0.1,
    strength: '5',
    toughness: '5',
    brigade: '',
    cardType: 'Hero',
    specialAbility: '',
    isFlipped: false,
    cardName: 'Test Hero',
    ...overrides,
  };
}

describe('battleSideOf', () => {
  it('centerX >= 0.5 puts the card on its owner side', () => {
    const c = mkCard({ ownerSeat: '0', dbX: 0.5, cardRelW: 0.1 }); // center 0.55
    expect(battleSideOf(c)).toBe('0');
  });

  it('centerX < 0.5 puts the card on the opponent side (dragged across the centerline)', () => {
    const c = mkCard({ ownerSeat: '0', dbX: 0.1, cardRelW: 0.1 }); // center 0.15
    expect(battleSideOf(c)).toBe('1');
  });

  it('centerX exactly 0.5 is inclusive (>=), stays on owner side', () => {
    const c = mkCard({ ownerSeat: '0', dbX: 0.4, cardRelW: 0.2 }); // center exactly 0.5
    expect(battleSideOf(c)).toBe('0');
  });

  it('works symmetrically for seat 1 as owner', () => {
    const c = mkCard({ ownerSeat: '1', dbX: 0.6, cardRelW: 0.1 }); // center 0.65
    expect(battleSideOf(c)).toBe('1');
  });

  it('anchor-clamp regression: dbX=0.33, cardRelW=0.67 (max clamped anchor) is OWN side', () => {
    // Write-time clamping caps an own-card anchor at 1 - cardRelW within a
    // 0.19-width band, so dbX alone can sit at 0.33 even for a card that's
    // fully on the owner's half. centerX = 0.33 + 0.67/2 = 0.665 >= 0.5.
    // An anchor-only `dbX >= 0.5` test would wrongly classify this as
    // opponent-side (0.33 < 0.5) -- this is the regression this lib guards.
    const c = mkCard({ ownerSeat: '0', dbX: 0.33, cardRelW: 0.67 });
    expect(battleSideOf(c)).toBe('0');
  });

  it('anchor-clamp regression at the realistic scale: cardRelW ≈ 0.07 in a full-width band '
    + 'makes the clamp mild -- an anchor alone at the clamp limit (0.93) with a center just '
    + 'past 0.5 still classifies as OWN side', () => {
    // A full-width band with ~14 card slots gives cardRelW ≈ 1/14 ≈ 0.0714.
    // The write-time clamp caps an own-card anchor at 1 - cardRelW ≈ 0.9286.
    // centerX = 0.9286 + 0.0714/2 ≈ 0.9643 >= 0.5, so the clamped anchor is
    // nowhere near the 0.5 boundary at this scale -- included as a
    // regression guard that the ANCHOR-alone view (0.9286, which reads as
    // "own side" too under a naive anchor-only check) doesn't mask a real
    // center-based classification bug.
    const cardRelW = 0.0714;
    const c = mkCard({ ownerSeat: '0', dbX: 1 - cardRelW, cardRelW });
    expect(battleSideOf(c)).toBe('0');
  });
});

describe('sideTotals', () => {
  it('sums strength/toughness only for cards on the requested side', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '3', toughness: '4' }),
      mkCard({ ownerSeat: '0', strength: '2', toughness: '1' }),
      mkCard({ ownerSeat: '1', strength: '9', toughness: '9' }),
    ];
    expect(sideTotals(cards, '0')).toEqual({ str: 5, tgh: 5, hasUnknown: false });
    expect(sideTotals(cards, '1')).toEqual({ str: 9, tgh: 9, hasUnknown: false });
  });

  it('unparseable stats ("", "*", "X") count as 0 and set hasUnknown', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '', toughness: '4' }),
      mkCard({ ownerSeat: '0', strength: '*', toughness: '4' }),
      mkCard({ ownerSeat: '0', strength: 'X', toughness: '4' }),
    ];
    const totals = sideTotals(cards, '0');
    expect(totals.str).toBe(0);
    expect(totals.tgh).toBe(12);
    expect(totals.hasUnknown).toBe(true);
  });

  it('face-down (isFlipped) cards are excluded from sums entirely and set hasUnknown', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '5', toughness: '5', isFlipped: false }),
      mkCard({ ownerSeat: '0', strength: '99', toughness: '99', isFlipped: true }),
    ];
    const totals = sideTotals(cards, '0');
    expect(totals.str).toBe(5);
    expect(totals.tgh).toBe(5);
    expect(totals.hasUnknown).toBe(true);
  });

  it('an empty side returns zero totals with no unknown flag', () => {
    const cards = [mkCard({ ownerSeat: '1' })];
    expect(sideTotals(cards, '0')).toEqual({ str: 0, tgh: 0, hasUnknown: false });
  });

  it('a stat-less enhancement (blank strength/toughness) counts as 0/0 without setting hasUnknown', () => {
    // Death of Unrighteous (Pat/FoM) prints no numbers — its Roots reprint
    // prints the same card as 0/0. 524 official enhancements are stat-less;
    // they must not poison the band totals with "?".
    const cards = [
      mkCard({ ownerSeat: '0', cardType: 'Evil Character', strength: '2', toughness: '1' }),
      mkCard({ ownerSeat: '0', cardType: 'EE', strength: '', toughness: '' }),
    ];
    expect(sideTotals(cards, '0')).toEqual({ str: 2, tgh: 1, hasUnknown: false });
  });

  it('stat-less non-characters generally (Dominant/Artifact in the band) count as 0/0, no unknown', () => {
    const cards = [
      mkCard({ ownerSeat: '0', cardType: 'Hero', strength: '5', toughness: '5' }),
      mkCard({ ownerSeat: '0', cardType: 'Dominant', strength: '', toughness: '' }),
      mkCard({ ownerSeat: '0', cardType: 'Artifact', strength: '', toughness: '' }),
    ];
    expect(sideTotals(cards, '0')).toEqual({ str: 5, tgh: 5, hasUnknown: false });
  });

  it('a variable-stat enhancement ("X"/"*") still sets hasUnknown', () => {
    const cards = [mkCard({ ownerSeat: '0', cardType: 'GE', strength: 'X', toughness: '*' })];
    expect(sideTotals(cards, '0').hasUnknown).toBe(true);
  });

  it('a blank-stat CHARACTER still sets hasUnknown (hidden/ungranted forge row)', () => {
    const cards = [mkCard({ ownerSeat: '0', cardType: 'Hero', strength: '', toughness: '' })];
    expect(sideTotals(cards, '0').hasUnknown).toBe(true);
  });

  it('initiative resolves (not "unknown") with a stat-less enhancement in the band', () => {
    // Screenshot repro: EC 2/1 + stat-less EE vs Heroes 17/9 — the blank EE
    // must not force the "Initiative unknown" banner.
    const cards = [
      mkCard({ ownerSeat: '0', cardType: 'Evil Character', strength: '2', toughness: '1' }),
      mkCard({ ownerSeat: '0', cardType: 'EE', strength: '', toughness: '' }),
      mkCard({ ownerSeat: '1', cardType: 'Hero', strength: '17', toughness: '9' }),
    ];
    const result = computeInitiative(cards, '1', '');
    expect(result).toEqual({ kind: 'initiative', seat: '0', reason: 'losing' });
  });
});

describe('parseMeekStats', () => {
  it('reads the meek side out of a "normal(meek)" stat string (Matthias (GoC): X(7) / 3(7) -> 7/7)', () => {
    expect(parseMeekStats('X(7)', '3(7)')).toEqual({ strength: 7, toughness: 7 });
  });

  it('handles a space before the parenthesized meek value', () => {
    expect(parseMeekStats('11 (7)', '7 (11)')).toEqual({ strength: 7, toughness: 11 });
  });

  it('returns null when either side has no parenthesized meek value', () => {
    expect(parseMeekStats('7', '7')).toBeNull();
    expect(parseMeekStats('7', '3(7)')).toBeNull();
    expect(parseMeekStats('', '')).toBeNull();
  });
});

describe('parseAlignmentStats — dual-icon cards', () => {
  it('Nebuchadnezzar (PoC): an Evil-aligned instance reads his 11/10 Evil Character side, not the 4/3 Hero side', () => {
    expect(parseAlignmentStats('4/11', '3/10', 'Evil')).toEqual({ strength: '11', toughness: '10' });
  });

  it('Abram/Abraham: a Good-aligned instance reads the first segment (Abram, 5/6)', () => {
    expect(parseAlignmentStats('5/10', '6/11', 'Good')).toEqual({ strength: '5', toughness: '6' });
  });

  it('Neutral GE/EE cards keep the GE side (Delivered 3/2), matching the pre-fix parseInt value', () => {
    expect(parseAlignmentStats('3/2', '2/3', 'Neutral')).toEqual({ strength: '3', toughness: '2' });
  });

  it('passes a stat-less good segment through verbatim so it still reads as unknown (Scapegoat (PoC))', () => {
    expect(parseAlignmentStats('-/0', '-/6', 'Neutral')).toEqual({ strength: '-', toughness: '-' });
  });

  it('returns null when there is no second side to choose (plain stats, blanked Forge fields)', () => {
    expect(parseAlignmentStats('5', '4', 'Evil')).toBeNull();
    expect(parseAlignmentStats('', '', 'Evil')).toBeNull();
  });

  it('returns null when the two fields disagree on how many sides they have', () => {
    expect(parseAlignmentStats('4/11', '3', 'Evil')).toBeNull();
    expect(parseAlignmentStats('4', '3/10', 'Evil')).toBeNull();
  });

  it('tolerates surrounding whitespace in both the stats and the alignment', () => {
    expect(parseAlignmentStats('4 / 11', '3 / 10', ' evil ')).toEqual({ strength: '11', toughness: '10' });
  });
});

describe('dual-icon cards in the battle band', () => {
  it('Nebuchadnezzar (PoC) fights as an 11/10, the numbers his crimson icon prints', () => {
    const nebbie = mkCard({
      ownerSeat: '0',
      cardName: 'Nebuchadnezzar (PoC)',
      cardType: 'Evil Character',
      strength: '11',
      toughness: '10',
    });
    expect(sideTotals([nebbie], '0')).toEqual({ str: 11, tgh: 10, hasUnknown: false });
  });

  it('and beats a blocker he used to lose to at his mistaken 4/3', () => {
    const cards = [
      mkCard({ ownerSeat: '0', cardType: 'Evil Character', strength: '11', toughness: '10' }),
      mkCard({ ownerSeat: '1', cardType: 'Hero', strength: '4', toughness: '5' }),
    ];
    // attacker 11 >= defender toughness 5, defender 4 < attacker toughness 10:
    // the defender is losing outright and takes initiative.
    expect(computeInitiative(cards, '0', '')).toEqual({
      kind: 'initiative',
      seat: '1',
      reason: 'losing',
    });
  });
});

// Drift guard. The rule above is only safe while the generated card data
// keeps listing dual stat lines good-side-first, and while the set of cards
// that print two of them stays the one we checked against real scans. A new
// slashed-stat card from `make update-cards` lands here first instead of
// silently taking a wrong segment into somebody's battle band.
describe('card data: every card that prints two stat lines', () => {
  const dualStatCards = CARDS.filter(
    (c) => c.strength.includes('/') || c.toughness.includes('/'),
  );

  it('is one of the six known printings', () => {
    expect(dualStatCards.map((c) => c.name).sort()).toEqual([
      'Abram/Abraham',
      'Delivered',
      'Nebuchadnezzar (PoC)',
      'Persian Horsemen / Persian Horses',
      'Philosophy',
      'Scapegoat (PoC)',
    ]);
  });

  it('resolves to the side its alignment icon prints', () => {
    const resolved = Object.fromEntries(
      dualStatCards.map((c) => [
        c.name,
        parseAlignmentStats(c.strength, c.toughness, c.alignment),
      ]),
    );
    expect(resolved).toEqual({
      // The bug this guards: his Evil Character side, not the Hero side.
      'Nebuchadnezzar (PoC)': { strength: '11', toughness: '10' },
      'Abram/Abraham': { strength: '5', toughness: '6' },
      'Persian Horsemen / Persian Horses': { strength: '2', toughness: '2' },
      'Delivered': { strength: '3', toughness: '2' },
      'Philosophy': { strength: '3', toughness: '2' },
      'Scapegoat (PoC)': { strength: '-', toughness: '-' },
    });
  });

  it('leaves five of the six on the number the old parseInt already produced', () => {
    for (const c of dualStatCards) {
      if (c.name === 'Nebuchadnezzar (PoC)') continue;
      const sided = parseAlignmentStats(c.strength, c.toughness, c.alignment)!;
      expect(parseInt(sided.strength, 10)).toEqual(parseInt(c.strength, 10));
      expect(parseInt(sided.toughness, 10)).toEqual(parseInt(c.toughness, 10));
    }
  });
});

describe('computeInitiative — REG table rows', () => {
  it('losing side has initiative: attacker 4/4 vs defender 5/5 (strA<tghB strict edge)', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '4', toughness: '4' }),
      mkCard({ ownerSeat: '1', strength: '5', toughness: '5' }),
    ];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'initiative', seat: '0', reason: 'losing' });
  });

  it('losing boundary: tghA<=strB is inclusive (tghA===strB=5 still counts as losing)', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '3', toughness: '5' }), // tghA=5
      mkCard({ ownerSeat: '1', strength: '5', toughness: '9' }), // strB=5
    ];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'initiative', seat: '0', reason: 'losing' });
  });

  it('winning side never gets initiative directly — asserted via the losing (defender) side', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '9', toughness: '9' }), // overwhelming attacker
      mkCard({ ownerSeat: '1', strength: '1', toughness: '1' }), // outmatched defender
    ];
    const result = computeInitiative(cards, '0', '');
    expect(result).toEqual({ kind: 'initiative', seat: '1', reason: 'losing' });
  });

  it('mutual destruction: 5/5 vs 5/5 (str>=opp tgh via equality, not stalemate)', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '5', toughness: '5' }),
      mkCard({ ownerSeat: '1', strength: '5', toughness: '5' }),
    ];
    expect(computeInitiative(cards, '0', '1')).toEqual({
      kind: 'initiative',
      seat: '0',
      reason: 'mutual-destruction',
    });
  });

  it('stalemate: 3/9 vs 3/9 (tgh>opp str strictly)', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '3', toughness: '9' }),
      mkCard({ ownerSeat: '1', strength: '3', toughness: '9' }),
    ];
    expect(computeInitiative(cards, '0', '0')).toEqual({ kind: 'initiative', seat: '1', reason: 'stalemate' });
  });

  it('stalemate/mutual initiative seat is whoever did NOT play last', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '3', toughness: '9' }),
      mkCard({ ownerSeat: '1', strength: '3', toughness: '9' }),
    ];
    expect(computeInitiative(cards, '0', '1')).toEqual({ kind: 'initiative', seat: '0', reason: 'stalemate' });
  });

  it('stalemate with lastPlayBySeat==="" is unknown (spec is silent on a default)', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '3', toughness: '9' }),
      mkCard({ ownerSeat: '1', strength: '3', toughness: '9' }),
    ];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'unknown' });
  });

  it('mutual destruction with lastPlayBySeat==="" is unknown', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '5', toughness: '5' }),
      mkCard({ ownerSeat: '1', strength: '5', toughness: '5' }),
    ];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'unknown' });
  });
});

describe('computeInitiative — empty-side and unknown-stat states', () => {
  it('defender side empty of characters -> waiting-blocker', () => {
    const cards = [mkCard({ ownerSeat: '0', cardType: 'Hero' })];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'waiting-blocker' });
  });

  it('attacker side empty of characters -> no-attacker', () => {
    const cards = [mkCard({ ownerSeat: '1', cardType: 'Evil Character' })];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'no-attacker' });
  });

  it('both sides empty of characters -> empty (band just opened; no banner)', () => {
    expect(computeInitiative([], '0', '')).toEqual({ kind: 'empty' });
  });

  it('non-character cards on both sides (e.g. Sites/Enhancements) still count as empty', () => {
    const cards = [
      mkCard({ ownerSeat: '0', cardType: 'GE', strength: '', toughness: '' }),
      mkCard({ ownerSeat: '1', cardType: 'Site', strength: '', toughness: '' }),
    ];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'empty' });
  });

  it('either side hasUnknown (face-down card) -> unknown even with both sides populated', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '5', toughness: '5', isFlipped: true }),
      mkCard({ ownerSeat: '1', strength: '5', toughness: '5' }),
    ];
    expect(computeInitiative(cards, '0', '1')).toEqual({ kind: 'unknown' });
  });

  it('either side hasUnknown (unparseable "*") -> unknown even with a clear REG row otherwise', () => {
    const cards = [
      mkCard({ ownerSeat: '0', strength: '4', toughness: '4' }),
      mkCard({ ownerSeat: '1', strength: '*', toughness: '5' }),
    ];
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'unknown' });
  });

  it('recognizes Evil Character (not just Hero) for the empty-side presence check', () => {
    const cards = [
      mkCard({ ownerSeat: '0', cardType: 'Hero', strength: '4', toughness: '4' }),
      mkCard({ ownerSeat: '1', cardType: 'Evil Character', strength: '5', toughness: '5' }),
    ];
    // Both sides populated with real characters -> falls through to the REG table,
    // not waiting-blocker/no-attacker.
    expect(computeInitiative(cards, '0', '')).toEqual({ kind: 'initiative', seat: '0', reason: 'losing' });
  });
});

describe('summarizeAutoReturn', () => {
  it('an equipped card (equippedToInstanceId set) counts as weaponsAttached, taking priority over its type', () => {
    const cards = [
      mkCard({ cardType: 'GE', equippedToInstanceId: 3n }), // would otherwise be an enhancement
    ];
    const summary = summarizeAutoReturn(cards);
    expect(summary.weaponsAttached).toBe(1);
    expect(summary.toDiscard).toBe(0);
    expect(summary.toTerritory).toBe(0);
  });

  it('equippedToInstanceId accepts a plain number too', () => {
    const cards = [mkCard({ cardType: 'GE', equippedToInstanceId: 7 })];
    expect(summarizeAutoReturn(cards).weaponsAttached).toBe(1);
  });

  it('equippedToInstanceId of 0n/0 means unattached (default) and falls through to its type', () => {
    const cards = [mkCard({ cardType: 'Hero', equippedToInstanceId: 0n })];
    const summary = summarizeAutoReturn(cards);
    expect(summary.weaponsAttached).toBe(0);
    expect(summary.toTerritory).toBe(1);
  });

  it('a Lost Soul card (cardType "LS") routes to toLandOfBondage', () => {
    const cards = [mkCard({ cardType: 'LS', cardName: 'Lost Soul (Adam)' })];
    expect(summarizeAutoReturn(cards).toLandOfBondage).toBe(1);
  });

  it('a Lost Soul recognized only by cardName ("lost soul" substring) still routes to toLandOfBondage', () => {
    const cards = [mkCard({ cardType: 'TOKEN', cardName: 'Lost Soul Token' })];
    expect(summarizeAutoReturn(cards).toLandOfBondage).toBe(1);
  });

  it('a character card routes to toTerritory', () => {
    const cards = [mkCard({ cardType: 'Hero' }), mkCard({ cardType: 'Evil Character' })];
    expect(summarizeAutoReturn(cards).toTerritory).toBe(2);
  });

  it('a GE/EE enhancement with no keep-heuristic match routes to toDiscard', () => {
    const cards = [mkCard({ cardType: 'GE', specialAbility: 'Adds 2 strength.', cardName: 'Sword' })];
    const summary = summarizeAutoReturn(cards);
    expect(summary.toDiscard).toBe(1);
    expect(summary.keptInPlay).toEqual([]);
  });

  it('a GE/EE enhancement whose specialAbility matches the "place" keep heuristic is kept in territory', () => {
    const cards = [
      mkCard({ cardType: 'EE', specialAbility: 'Place this card in your territory.', cardName: 'Curse of Stone' }),
    ];
    const summary = summarizeAutoReturn(cards);
    expect(summary.toDiscard).toBe(0);
    expect(summary.toTerritory).toBe(1);
    expect(summary.keptInPlay).toEqual(['Curse of Stone']);
  });

  it('"take the place of" / "in place of" phrasings are excluded from the keep heuristic (still discarded)', () => {
    const cards = [
      mkCard({ cardType: 'GE', specialAbility: 'May take the place of a Hero in battle.', cardName: 'Stand-In' }),
      mkCard({ cardType: 'GE', specialAbility: 'Used in place of a weapon.', cardName: 'Substitute' }),
    ];
    const summary = summarizeAutoReturn(cards);
    expect(summary.toDiscard).toBe(2);
    expect(summary.keptInPlay).toEqual([]);
  });

  it('cardType with a slash still matches the exact GE/EE segment (e.g. "Artifact/GE")', () => {
    const cards = [mkCard({ cardType: 'Artifact/GE', specialAbility: '', cardName: 'Odd Combo' })];
    expect(summarizeAutoReturn(cards).toDiscard).toBe(1);
  });

  it('everything else (Artifact/Curse/Fortress/unknown type) routes to toTerritory', () => {
    const cards = [
      mkCard({ cardType: 'Artifact' }),
      mkCard({ cardType: 'Fortress' }),
      mkCard({ cardType: 'SomeUnknownType' }),
    ];
    expect(summarizeAutoReturn(cards).toTerritory).toBe(3);
  });

  it('a Dominant played from hand routes to toDiscard, never back to hand', () => {
    const cards = [mkCard({ cardType: 'Dominant', originZone: 'hand', specialAbility: 'Discard an Evil Character.', cardName: 'Son of God' })];
    const summary = summarizeAutoReturn(cards);
    expect(summary.toDiscard).toBe(1);
    expect(summary.toOrigin).toBe(0);
    expect(summary.toTerritory).toBe(0);
  });

  it('a Dominant whose specialAbility matches the "place" keep heuristic is kept in territory', () => {
    const cards = [
      mkCard({ cardType: 'Dominant', originZone: 'hand', specialAbility: 'Place in your territory: when your NT Hero enters battle...', cardName: 'The Holy Spirit' }),
    ];
    const summary = summarizeAutoReturn(cards);
    expect(summary.toDiscard).toBe(0);
    expect(summary.toTerritory).toBe(1);
    expect(summary.keptInPlay).toEqual(['The Holy Spirit']);
  });

  it('a catch-all card (Artifact) stamped with a non-territory origin (hand) routes to toOrigin', () => {
    const cards = [mkCard({ cardType: 'Artifact', originZone: 'hand', cardName: 'Some Artifact' })];
    const summary = summarizeAutoReturn(cards);
    expect(summary.toOrigin).toBe(1);
    expect(summary.toTerritory).toBe(0);
  });

  it('a catch-all card (Fortress) with an empty origin still routes to toTerritory', () => {
    const cards = [mkCard({ cardType: 'Fortress', originZone: '', cardName: 'Some Fortress' })];
    const summary = summarizeAutoReturn(cards);
    expect(summary.toOrigin).toBe(0);
    expect(summary.toTerritory).toBe(1);
  });

  it('aggregates a mixed battle band into the correct bucket for every card', () => {
    const cards = [
      mkCard({ cardType: 'GE', equippedToInstanceId: 1n }), // weapon, attached
      mkCard({ cardType: 'LS', cardName: 'Lost Soul (Eve)' }), // -> LoB
      mkCard({ cardType: 'Hero' }), // -> territory
      mkCard({ cardType: 'GE', specialAbility: '', cardName: 'Fireball' }), // -> discard
      mkCard({ cardType: 'EE', specialAbility: 'Place in territory.', cardName: 'Curse' }), // -> kept in territory
      mkCard({ cardType: 'Artifact' }), // -> territory (rule 5, no origin stamped)
    ];
    const summary = summarizeAutoReturn(cards);
    expect(summary).toEqual({
      toTerritory: 3, // Hero + kept Curse + Artifact
      toOrigin: 0,
      toDiscard: 1, // Fireball
      toLandOfBondage: 1, // Lost Soul (Eve)
      keptInPlay: ['Curse'],
      weaponsAttached: 1,
    });
  });
});

describe('siteAttachedSoulIds', () => {
  // Attachment direction per the server's attach_card: the ACCESSORY row
  // carries the nonzero equippedToInstanceId pointing at the HOST (the
  // soul); the soul's own equippedToInstanceId is always 0n.
  it('marks a soul when an accessory row points at it', () => {
    const souls = [{ id: 10n }, { id: 11n }];
    const rows = [
      { equippedToInstanceId: 0n }, // the soul itself
      { equippedToInstanceId: 10n }, // the attached Site
      { equippedToInstanceId: 0n },
    ];
    expect(siteAttachedSoulIds(souls, rows)).toEqual(new Set(['10']));
  });

  it('ignores accessories pointing at non-soul hosts (weapon on a warrior)', () => {
    const souls = [{ id: 10n }];
    const rows = [
      { equippedToInstanceId: 99n }, // weapon -> warrior 99, not a stakes soul
    ];
    expect(siteAttachedSoulIds(souls, rows).size).toBe(0);
  });

  it('never marks a soul from its own (always-0n) equippedToInstanceId', () => {
    const souls = [{ id: 10n }];
    const rows = [{ equippedToInstanceId: 0n }];
    expect(siteAttachedSoulIds(souls, rows).size).toBe(0);
  });

  it('returns an empty set for no souls without scanning rows', () => {
    expect(siteAttachedSoulIds([], [{ equippedToInstanceId: 10n }]).size).toBe(0);
  });

  it('marks multiple souls independently', () => {
    const souls = [{ id: 10n }, { id: 11n }, { id: 12n }];
    const rows = [
      { equippedToInstanceId: 10n },
      { equippedToInstanceId: 12n },
    ];
    expect(siteAttachedSoulIds(souls, rows)).toEqual(new Set(['10', '12']));
  });
});
