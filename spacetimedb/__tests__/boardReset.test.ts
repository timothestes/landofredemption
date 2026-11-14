import { describe, it, expect } from 'vitest';
// Lives outside spacetimedb/src (the module's tsconfig `include`) so its vitest
// import is never pulled into `spacetime publish`; root vitest runs it via the
// **/__tests__/** glob.
import { planResetRoute } from '../src/boardReset';

const ME = 1n;
const OPP = 2n;
const SHARED = 0n;
const PLAYERS = [ME, OPP];

const card = (zone: string, over: Partial<{ ownerId: bigint; originalOwnerId: bigint; isToken: boolean }> = {}) => ({
  zone,
  ownerId: ME,
  originalOwnerId: ME,
  isToken: false,
  ...over,
});

describe('planResetRoute', () => {
  it('sweeps cards in battle into their deck', () => {
    // The reported bug: A New Beginning shuffled everything except the battle.
    expect(planResetRoute(card('battle'), PLAYERS)).toEqual({ kind: 'move', zone: 'deck', ownerId: ME });
    expect(planResetRoute(card('battle', { ownerId: OPP, originalOwnerId: OPP }), PLAYERS))
      .toEqual({ kind: 'move', zone: 'deck', ownerId: OPP });
  });

  it.each(['hand', 'territory', 'land-of-bondage'])('sweeps %s into the deck', (zone) => {
    expect(planResetRoute(card(zone), PLAYERS)).toEqual({ kind: 'move', zone: 'deck', ownerId: ME });
  });

  it.each(['land-of-redemption', 'discard', 'banish', 'reserve', 'deck', 'soul-deck', 'paragon'])(
    'leaves %s alone',
    (zone) => {
      expect(planResetRoute(card(zone), PLAYERS)).toEqual({ kind: 'stay' });
    },
  );

  it('deletes tokens instead of shuffling them in', () => {
    expect(planResetRoute(card('battle', { isToken: true }), PLAYERS)).toEqual({ kind: 'delete' });
    expect(planResetRoute(card('territory', { isToken: true }), PLAYERS)).toEqual({ kind: 'delete' });
  });

  it("sends a captured card to its real owner's deck, not the captor's", () => {
    expect(planResetRoute(card('territory', { ownerId: ME, originalOwnerId: OPP }), PLAYERS))
      .toEqual({ kind: 'move', zone: 'deck', ownerId: OPP });
  });

  it('falls back to the current owner on rows with no original owner', () => {
    expect(planResetRoute(card('battle', { ownerId: OPP, originalOwnerId: 0n }), PLAYERS))
      .toEqual({ kind: 'move', zone: 'deck', ownerId: OPP });
  });

  it('returns shared Paragon souls to the soul deck', () => {
    expect(planResetRoute(card('land-of-bondage', { ownerId: SHARED, originalOwnerId: SHARED }), PLAYERS))
      .toEqual({ kind: 'move', zone: 'soul-deck', ownerId: SHARED });
  });
});
