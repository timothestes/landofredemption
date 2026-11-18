import { describe, it, expect } from 'vitest';
import type { CardData } from '../generated/cardData';
import { isWarrior, isWeapon } from '../lookup';

function makeCard(overrides: Partial<CardData> = {}): CardData {
  return {
    name: 'Test',
    set: 'T',
    imgFile: 'Test',
    officialSet: 'Test',
    type: 'Hero',
    brigade: 'White',
    strength: '',
    toughness: '',
    class: '',
    identifier: '',
    specialAbility: '',
    rarity: 'Common',
    reference: '',
    alignment: 'Good',
    legality: '',
    artist: '',
    ...overrides,
  };
}

describe('isWarrior', () => {
  it('is true for plain Warrior class', () => {
    expect(isWarrior(makeCard({ class: 'Warrior' }))).toBe(true);
  });
  it('is true for compound classes containing Warrior', () => {
    expect(isWarrior(makeCard({ class: 'Warrior, Cloud' }))).toBe(true);
    expect(isWarrior(makeCard({ class: 'Territory, Warrior' }))).toBe(true);
    expect(isWarrior(makeCard({ class: 'Territory / Warrior' }))).toBe(true);
    expect(isWarrior(makeCard({ class: 'Territory/Warrior' }))).toBe(true);
    expect(isWarrior(makeCard({ class: 'Warrior, Weapon' }))).toBe(true);
  });
  it('is false when class is empty or unrelated', () => {
    expect(isWarrior(makeCard({ class: '' }))).toBe(false);
    expect(isWarrior(makeCard({ class: 'Cloud' }))).toBe(false);
    expect(isWarrior(makeCard({ class: 'Weapon' }))).toBe(false);
  });
  it('is false for undefined', () => {
    expect(isWarrior(undefined)).toBe(false);
  });
});

describe('isWeapon', () => {
  it('is true for plain Weapon class', () => {
    expect(isWeapon(makeCard({ class: 'Weapon' }))).toBe(true);
  });
  it('is true for compound classes containing Weapon', () => {
    expect(isWeapon(makeCard({ class: 'Weapon, Star' }))).toBe(true);
    expect(isWeapon(makeCard({ class: 'Warrior, Weapon' }))).toBe(true);
  });
  it('is false when class is empty or unrelated', () => {
    expect(isWeapon(makeCard({ class: '' }))).toBe(false);
    expect(isWeapon(makeCard({ class: 'Warrior' }))).toBe(false);
  });
  it('is false for undefined', () => {
    expect(isWeapon(undefined)).toBe(false);
  });
});
