import { describe, it, expect } from 'vitest';
import { resolveWinnerSeat, soulsBySeat } from '../bracketResult';

const players = [{ id: 10n, seat: 0n }, { id: 11n, seat: 1n }];
describe('resolveWinnerSeat', () => {
  it('WIN names the winner', () => expect(resolveWinnerSeat([{ actionType: 'WIN', playerId: 11n }], players)).toEqual({ kind: 'win', winnerSeat: 1 }));
  it('RESIGN names the loser', () => expect(resolveWinnerSeat([{ actionType: 'RESIGN', playerId: 11n }], players)).toEqual({ kind: 'resign', winnerSeat: 0 }));
  it('claimed TIMEOUT names the claimer', () => expect(resolveWinnerSeat([{ actionType: 'TIMEOUT', playerId: 10n, payload: JSON.stringify({ reason: 'claimed_by_opponent' }) }], players)).toEqual({ kind: 'timeout', winnerSeat: 0 }));
  it('disconnect TIMEOUT (waiting/pregame) → none', () => expect(resolveWinnerSeat([{ actionType: 'TIMEOUT', playerId: 11n, payload: JSON.stringify({ reason: 'disconnect_timeout' }) }], players)).toEqual({ kind: 'none', winnerSeat: null }));
  it('TIMEOUT with no or malformed payload → none', () => {
    expect(resolveWinnerSeat([{ actionType: 'TIMEOUT', playerId: 10n }], players)).toEqual({ kind: 'none', winnerSeat: null });
    expect(resolveWinnerSeat([{ actionType: 'TIMEOUT', playerId: 10n, payload: '{oops' }], players)).toEqual({ kind: 'none', winnerSeat: null });
  });
  it('no ending action → none', () => expect(resolveWinnerSeat([{ actionType: 'MOVE', playerId: 10n }], players)).toEqual({ kind: 'none', winnerSeat: null }));
  it('uses the last ending action', () => expect(resolveWinnerSeat([{ actionType: 'WIN', playerId: 10n }, { actionType: 'RESIGN', playerId: 10n }], players).winnerSeat).toBe(1));
});

describe('soulsBySeat', () => {
  it('me is seat 0', () => expect(soulsBySeat({ me: 3, opponent: 5 }, 0)).toEqual({ seat0: 3, seat1: 5 }));
  it('me is seat 1', () => expect(soulsBySeat({ me: 3, opponent: 5 }, 1)).toEqual({ seat0: 5, seat1: 3 }));
});
