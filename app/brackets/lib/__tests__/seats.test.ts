import { describe, expect, it } from 'vitest';
import { seatDeckName, seatEntryId, soulsForEntries, type BracketGameParams } from '../gameParams';

const base: BracketGameParams = {
  gameId: 'g', bracketId: 'b', matchId: 'm', gameNumber: 1, bestOf: 3, mode: 'online',
  entryAId: 'ea', entryBId: 'eb', deckAName: 'Deck A', deckBName: 'Deck B', returnTo: '/brackets/b',
};

describe('bracket seat mapping', () => {
  it('seats the host on entry A by default', () => {
    expect(seatEntryId(base, 0)).toBe('ea');
    expect(seatEntryId(base, 1)).toBe('eb');
    expect(seatDeckName(base, 0)).toBe('Deck A');
    expect(soulsForEntries(base, { seat0: 3, seat1: 1 })).toEqual({ soulsA: 3, soulsB: 1 });
  });

  it('seats the host on entry B after a swap, and credits souls to the right entry', () => {
    const swapped = { ...base, hostSide: 'b' as const };
    expect(seatEntryId(swapped, 0)).toBe('eb');
    expect(seatEntryId(swapped, 1)).toBe('ea');
    expect(seatDeckName(swapped, 0)).toBe('Deck B');
    expect(seatDeckName(swapped, 1)).toBe('Deck A');
    expect(soulsForEntries(swapped, { seat0: 3, seat1: 1 })).toEqual({ soulsA: 1, soulsB: 3 });
  });
});
