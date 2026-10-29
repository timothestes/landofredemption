import { describe, it, expect } from 'vitest';
import { parseDeckOutput, DECK_JSON_SCHEMA, DECK_INSTRUCTION } from '../deckSchema';
import { FIELD_CAPS } from '../schema';

const card = (p: object = {}) => ({ title: 'Abner', strength: '7', toughness: '6', type: 'Evil Character', brigade: 'Gray', reference: null, group: 1, position: 1, titleBox: [0.1, 0.1, 0.2, 0.12], confidence: 'high', ...p });
const out = (p: object = {}) => JSON.stringify({ photoQuality: 'ok', groups: [{ id: 1, orientation: 'upright', bbox: [0, 0, 0.5, 1], cardCount: 1 }], cards: [card()], ...p });

describe('parseDeckOutput', () => {
  it('parses a good response', () => { const o = parseDeckOutput(out())!; expect(o.cards[0]).toMatchObject({ title: 'Abner', group: 1, position: 1 }); expect(o.groups[0].orientation).toBe('upright'); });
  it('null on bad JSON or a missing cards array', () => { expect(parseDeckOutput('nope')).toBeNull(); expect(parseDeckOutput('{"photoQuality":"ok","groups":[]}')).toBeNull(); });
  it('caps strings with the scanner caps', () => expect(parseDeckOutput(out({ cards: [card({ title: 'x'.repeat(200) })] }))!.cards[0].title).toHaveLength(FIELD_CAPS.title));
  it('boxes are clamped and ordered', () => { const o = parseDeckOutput(out({ groups: [{ id: 1, orientation: 'upright', bbox: [0.9, 0.2, 0.1, 1.4], cardCount: 1 }], cards: [card({ titleBox: [0.3, 'x', 0.4, 0.5] })] }))!; expect(o.groups[0].bbox).toEqual([0.1, 0.2, 0.9, 1]); expect(o.cards[0].titleBox).toBeNull(); });
  it('a malformed group bbox becomes the whole photo', () => expect(parseDeckOutput(out({ groups: [{ id: 1, orientation: 'upright', bbox: null, cardCount: 1 }] }))!.groups[0].bbox).toEqual([0, 0, 1, 1]));
  it('orphan cards land in group 0', () => { const o = parseDeckOutput(out({ groups: [], cards: [card({ group: 4 }), card({ group: 4, position: 2 })] }))!; expect(o.cards.map(c => c.group)).toEqual([0, 0]); expect(o.groups).toContainEqual({ id: 0, orientation: 'upright', bbox: [0, 0, 1, 1], cardCount: 2 }); });
  it('unknown enums coerce', () => { const o = parseDeckOutput(out({ photoQuality: 'too_many_cards', groups: [{ id: 1, orientation: 'sideways', bbox: [0, 0, 1, 1], cardCount: 1 }], cards: [card({ type: 'Wizard', confidence: 'sure' })] }))!; expect(o.photoQuality).toBe('ok'); expect(o.groups[0].orientation).toBe('upright'); expect(o.cards[0].type).toBe('unknown'); expect(o.cards[0].confidence).toBe('low'); });
  it('a null title is kept (an unread card)', () => expect(parseDeckOutput(out({ cards: [card({ title: null })] }))!.cards[0].title).toBeNull());
  it('the schema requires every card field', () => expect((DECK_JSON_SCHEMA as any).properties.cards.items.required).toEqual(['title', 'strength', 'toughness', 'type', 'brigade', 'reference', 'group', 'position', 'titleBox', 'confidence']));
});

describe('DECK_INSTRUCTION', () => {
  it('still forbids inventing cards or naming them from memory', () => {
    expect(DECK_INSTRUCTION).toContain('Never invent a card you cannot see.');
    expect(DECK_INSTRUCTION).toContain('Do not identify cards from memory');
  });
  // photoCrops turns rotated_cw by -90 and rotated_ccw by +90, so the words must match that.
  it('describes each sideways orientation by where the card tops point', () => {
    expect(DECK_INSTRUCTION).toMatch(/rotated_cw when the cards lie sideways with their tops toward the right edge/);
    expect(DECK_INSTRUCTION).toMatch(/rotated_ccw when the cards lie sideways with their tops toward the left edge/);
  });
});
