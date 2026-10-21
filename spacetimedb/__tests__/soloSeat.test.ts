import { describe, it, expect } from 'vitest';
import { pickSoloRow } from '../src/soloSeat';
const s0 = { id: 10n, seat: 0n }, s1 = { id: 11n, seat: 1n };
describe('pickSoloRow', () => {
  it('ignores every hint when the sender holds one row (two-human game)', () => {
    expect(pickSoloRow([s1], { seat: 0n }, 0n, null)).toBe(s1);
    expect(pickSoloRow([s1], { cardId: 5n }, 0n, 10n)).toBe(s1);
  });
  it('uses the seat in hand with no hint', () => expect(pickSoloRow([s0, s1], undefined, 1n, null)).toBe(s1));
  it('resolves seat, playerId and card-owner hints', () => {
    expect(pickSoloRow([s0, s1], { seat: 0n }, 1n, null)).toBe(s0);
    expect(pickSoloRow([s0, s1], { playerId: 11n }, 0n, null)).toBe(s1);
    expect(pickSoloRow([s0, s1], { cardId: 5n }, 1n, 10n)).toBe(s0);
  });
  it('falls back to the seat in hand for a shared card', () => expect(pickSoloRow([s0, s1], { cardId: 5n }, 1n, 0n)).toBe(s1));
  it('returns undefined with no rows', () => expect(pickSoloRow([], undefined, 0n, null)).toBeUndefined());
});
