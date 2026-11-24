import { describe, it, expect } from 'vitest';
import { CARDS } from '@/lib/cards/lookup';
import { matchesDeckCard, type DeckCardMatch } from '@/lib/cards/cardAbilities';
import type { Card } from '../../utils';
import { OPENING_HAND_CATEGORIES, isInCategory, openingHandCategory } from '../openingHandCategories';

const card = (name: string): Card => {
  const found = CARDS.find((c) => c.name === name);
  if (!found) throw new Error(`no card named ${name}`);
  return found as unknown as Card;
};

/** Ids of the categories a card counts toward. */
const idsFor = (name: string) =>
  OPENING_HAND_CATEGORIES.filter((cat) => isInCategory(card(name), cat)).map((cat) => cat.id);

describe('opening hand categories', () => {
  it('counts a good weapon as a good weapon and a Good Enhancement, not an evil weapon', () => {
    expect(idsFor("Abishai's Spear")).toEqual(['good-weapon', 'good-enhancement']);
  });

  it('counts an evil weapon as an evil weapon and an Evil Enhancement', () => {
    expect(idsFor("Goliath's Spear (Ki)")).toEqual(['evil-weapon', 'evil-enhancement']);
  });

  it('counts a dual GE/EE weapon as a weapon for either side', () => {
    expect(idsFor('Drawn Sword (Roots)')).toEqual(['good-weapon', 'evil-weapon', 'good-enhancement', 'evil-enhancement']);
  });

  it('does not count a non-weapon enhancement as a weapon', () => {
    expect(idsFor('A Child is Born')).toEqual(['good-enhancement']);
    expect(idsFor('A Look Back')).toEqual(['evil-enhancement']);
  });

  it('counts characters, artifacts and dominants under their own type', () => {
    expect(idsFor('Aaron (Di)')).toEqual(['hero']);
    expect(idsFor('Abaddon the Destroyer (L)')).toEqual(['evil-character']);
    expect(idsFor("Aaron's Staff (CoW AB)")).toEqual(['artifact']);
    expect(idsFor('A New Beginning (FoM)')).toEqual(['dominant']);
  });

  it('counts a dual Hero/Evil Character under both', () => {
    expect(idsFor('Abijah, the Conqueror / Abijam, the Half-Hearted (LoC)')).toEqual(['hero', 'evil-character']);
  });

  // The categories are self-contained so the public deck page's bundle stays
  // free of the card catalog; this keeps them agreeing with the game's matcher.
  it('agrees with matchesDeckCard on every card in the catalog', () => {
    const reference: Record<string, DeckCardMatch[]> = {
      hero: [{ types: ['Hero'] }],
      'evil-character': [{ types: ['Evil Character'] }],
      'good-weapon': [{ alignments: ['good'], cardClass: 'Weapon' }],
      'evil-weapon': [{ alignments: ['evil'], cardClass: 'Weapon' }],
      'good-enhancement': [{ types: ['Enhancement'], alignments: ['good'] }],
      'evil-enhancement': [{ types: ['Enhancement'], alignments: ['evil'] }],
      artifact: [{ types: ['Artifact'] }],
      dominant: [{ types: ['Dominant'] }],
    };
    const disagreements: string[] = [];
    for (const c of CARDS) {
      for (const cat of OPENING_HAND_CATEGORIES) {
        if (isInCategory(c as unknown as Card, cat) !== matchesDeckCard(c, reference[cat.id])) {
          disagreements.push(`${cat.id}: ${c.name}`);
        }
      }
    }
    expect(disagreements.slice(0, 10)).toEqual([]);
  });

  it('falls back to Hero for an unknown id', () => {
    expect(openingHandCategory('nope').id).toBe('hero');
  });
});
