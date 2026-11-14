// Pure card routing for the board reset (three_nails_reset: Three Nails (GoC),
// A New Beginning (FoM), A New Beginning [RR2]). No SpacetimeDB runtime
// imports so it can be unit tested in isolation (see __tests__/boardReset.test.ts).
import { resolveTrueHomeOwnerId } from './cardOwnership';

// "Shuffle all cards in play, set-aside areas and hands": every table zone,
// battle included, plus hands. Land of Redemption, discard, banish and reserve
// stay where they are.
export const RESET_SWEEP_ZONES: string[] = ['hand', 'territory', 'land-of-bondage', 'battle'];

export interface ResetCard {
  zone: string;
  /** Current owner. 0n is the shared (Paragon soul) sentinel. */
  ownerId: bigint;
  /** Owner the card was dealt to; 0n when it has never changed hands. */
  originalOwnerId: bigint;
  isToken: boolean;
}

export type ResetRoute =
  | { kind: 'stay' }
  | { kind: 'delete' }
  | { kind: 'move'; zone: 'deck' | 'soul-deck'; ownerId: bigint };

/** Where one card goes when the board resets. `playerIds` = the game's seated players. */
export function planResetRoute(card: ResetCard, playerIds: bigint[]): ResetRoute {
  if (!RESET_SWEEP_ZONES.includes(card.zone)) return { kind: 'stay' };
  // Tokens can't be shuffled into a deck, same as every other deck move.
  if (card.isToken) return { kind: 'delete' };
  const home = resolveTrueHomeOwnerId(card);
  // Shared Paragon souls belong to no seat: back to the soul deck.
  if (!playerIds.includes(home)) return { kind: 'move', zone: 'soul-deck', ownerId: card.ownerId };
  // A captured card goes home to its real owner's deck, not the captor's.
  return { kind: 'move', zone: 'deck', ownerId: home };
}
