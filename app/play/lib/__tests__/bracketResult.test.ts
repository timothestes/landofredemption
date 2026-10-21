import { describe, it, expect } from 'vitest';
import { resolveWinnerSeat, soulsBySeat } from '../bracketResult';

const players = [{ id: 10n, seat: 0n }, { id: 11n, seat: 1n }];
describe('resolveWinnerSeat', () => {
  it('WIN names the winner', () => expect(resolveWinnerSeat([{ actionType: 'WIN', playerId: 11n }], players)).toEqual({ kind: 'win', winnerSeat: 1 }));
  it('RESIGN names the loser', () => expect(resolveWinnerSeat([{ actionType: 'RESIGN', playerId: 11n }], players)).toEqual({ kind: 'resign', winnerSeat: 0 }));
  it('TIMEOUT names the claimer', () => expect(resolveWinnerSeat([{ actionType: 'TIMEOUT', playerId: 10n }], players)).toEqual({ kind: 'timeout', winnerSeat: 0 }));
  it('no ending action → none', () => expect(resolveWinnerSeat([{ actionType: 'MOVE', playerId: 10n }], players)).toEqual({ kind: 'none', winnerSeat: null }));
  it('uses the last ending action', () => expect(resolveWinnerSeat([{ actionType: 'WIN', playerId: 10n }, { actionType: 'RESIGN', playerId: 10n }], players).winnerSeat).toBe(1));
});

describe('soulsBySeat', () => {
  it('me is seat 0', () => expect(soulsBySeat({ me: 3, opponent: 5 }, 0)).toEqual({ seat0: 3, seat1: 5 }));
  it('me is seat 1', () => expect(soulsBySeat({ me: 3, opponent: 5 }, 1)).toEqual({ seat0: 5, seat1: 3 }));
});
