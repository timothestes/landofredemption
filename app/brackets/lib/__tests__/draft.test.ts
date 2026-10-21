import { describe, it, expect } from 'vitest';
import { draftSummary, pruneForFamily, toggleDraftDeck, type DraftDeck } from '../draft';

const d = (id: string, format: string | null = 'Limited'): DraftDeck => ({ id, name: id, format, preview_card_1: null, preview_card_2: null, paragon: null });
describe('draft', () => {
  it('toggleDraftDeck adds, removes, and caps at 16', () => {
    expect(toggleDraftDeck([], d('a'))).toEqual([d('a')]);
    expect(toggleDraftDeck([d('a'), d('b')], d('a'))).toEqual([d('b')]);
    const sixteen = Array.from({ length: 16 }, (_, i) => d(`x${i}`));
    expect(toggleDraftDeck(sixteen, d('y'))).toHaveLength(16);
  });
  it('pruneForFamily drops decks of another family', () => {
    const r = pruneForFamily([d('a', 'Limited'), d('b', 'Unlimited'), d('c', 'Type 2')], 'T1');
    expect(r.kept.map(x => x.id)).toEqual(['a', 'b']);
    expect(r.dropped.map(x => x.id)).toEqual(['c']);
  });
  it('draftSummary', () => {
    expect(draftSummary(6)).toBe('6 decks · 8 slots · 2 byes');
    expect(draftSummary(4)).toBe('4 decks · no byes');
    expect(draftSummary(1)).toBe('1 deck · pick at least 2');
  });
});
