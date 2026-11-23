import { describe, it, expect } from 'vitest';
// Lives outside spacetimedb/src (the module's tsconfig `include`) so its vitest
// import is never pulled into `spacetime publish`; root vitest still runs it via
// the **/__tests__/** glob.
import { isLeavingPlayField, equipLinksToClear } from '../src/playField';

// A card "leaves the play field" only when it moves from an on-field zone
// (territory, land-of-bondage, battle) to an OFF-field zone (deck, hand,
// discard, reserve, banish, soul-deck, land-of-redemption). Relocations that
// keep the card in play — most importantly the battle-zone round trip — are
// NOT leaving play. This predicate gates clearing the lasting `isMeek`
// characteristic and manual `notes` in leavePlayFieldOverrides.
describe('isLeavingPlayField', () => {
  it('does not count the battle round trip as leaving play (the meek bug)', () => {
    // Entering battle from territory, and returning battle -> territory, keep
    // the card on the field, so a meek hero must stay meek across both.
    expect(isLeavingPlayField('territory', 'battle')).toBe(false);
    expect(isLeavingPlayField('battle', 'territory')).toBe(false);
  });

  it('does not count moves between any two on-field zones as leaving play', () => {
    expect(isLeavingPlayField('territory', 'land-of-bondage')).toBe(false);
    expect(isLeavingPlayField('land-of-bondage', 'battle')).toBe(false);
    expect(isLeavingPlayField('battle', 'land-of-bondage')).toBe(false);
  });

  it('counts a move to an off-field zone as leaving play', () => {
    for (const to of ['deck', 'hand', 'discard', 'reserve', 'banish', 'soul-deck', 'land-of-redemption']) {
      expect(isLeavingPlayField('territory', to)).toBe(true);
      expect(isLeavingPlayField('battle', to)).toBe(true);
      expect(isLeavingPlayField('land-of-bondage', to)).toBe(true);
    }
  });

  it('is false when the card starts off-field, regardless of destination', () => {
    expect(isLeavingPlayField('deck', 'territory')).toBe(false);
    expect(isLeavingPlayField('hand', 'battle')).toBe(false);
    expect(isLeavingPlayField('discard', 'discard')).toBe(false);
  });

  it('is false for a no-op move within the same on-field zone', () => {
    expect(isLeavingPlayField('territory', 'territory')).toBe(false);
    expect(isLeavingPlayField('battle', 'battle')).toBe(false);
  });
});

// A card sent to the deck (top, bottom, shuffle, exchange) has left play, so
// its equip links must go. The bug: a hero shuffled into the deck left its
// weapon in Territory still pointing at it — invisible, because the client only
// draws a weapon beside its host — and the weapon reappeared when the hero was
// searched back out.
describe('equipLinksToClear', () => {
  const card = (id: bigint, equippedToInstanceId = 0n) => ({ id, equippedToInstanceId });
  const ids = (cards: { id: bigint }[]) => cards.map((c) => c.id);

  it('unlinks a weapon whose hero leaves play', () => {
    const hero = card(1n);
    const weapon = card(2n, 1n);
    expect(ids(equipLinksToClear([hero, weapon], new Set([1n])))).toEqual([2n]);
  });

  it("clears a leaving weapon's own link", () => {
    const hero = card(1n);
    const weapon = card(2n, 1n);
    expect(ids(equipLinksToClear([hero, weapon], new Set([2n])))).toEqual([2n]);
  });

  it('clears the link when hero and weapon leave together', () => {
    const hero = card(1n);
    const weapon = card(2n, 1n);
    expect(ids(equipLinksToClear([hero, weapon], new Set([1n, 2n])))).toEqual([2n]);
  });

  it('leaves other attached pairs and unattached cards alone', () => {
    const hero = card(1n);
    const weapon = card(2n, 1n);
    const otherHero = card(3n);
    const otherWeapon = card(4n, 3n);
    expect(ids(equipLinksToClear([hero, weapon, otherHero, otherWeapon], new Set([1n])))).toEqual([2n]);
    expect(equipLinksToClear([otherHero, otherWeapon], new Set([1n]))).toEqual([]);
  });
});
