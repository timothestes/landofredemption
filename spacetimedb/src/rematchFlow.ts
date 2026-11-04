/**
 * Rematch handshake rules. Pure — no ctx, no DB — so they're unit-testable.
 *
 * A rematch resets the finished Game row in place (same gameId, same Player
 * rows). That reuse is why both rules below exist.
 */

/**
 * What a `request_rematch` call means, given the pending state.
 *
 * - `request`: nobody has asked yet — the caller's request is recorded.
 * - `accept`: the OTHER seat already asked and is still waiting. Both players
 *   pressing Play Again is mutual consent, so the second press starts the
 *   rematch. Refusing it as a duplicate left that player with no feedback and
 *   a second button to find.
 * - `duplicate`: the caller already asked, or the request already resolved.
 */
export function rematchRequestOutcome(
  rematchRequestedBy: string,
  rematchResponse: string,
  callerSeat: string,
): 'request' | 'accept' | 'duplicate' {
  if (rematchRequestedBy === '') return 'request';
  if (rematchRequestedBy !== callerSeat && rematchResponse === '') return 'accept';
  return 'duplicate';
}

/**
 * When the current pre-game began, for stale-game cleanup. `createdAt` dates
 * the FIRST game on the row, so a rematch after a 30+ minute game looked
 * abandoned the moment it entered pre-game. `choosingDeadlineMicros` is
 * re-stamped every time a pre-game starts (join and rematch), so whichever is
 * later dates this one.
 */
export function pregameSinceMicros(createdAtMicros: bigint, choosingDeadlineMicros: bigint): bigint {
  return choosingDeadlineMicros > createdAtMicros ? choosingDeadlineMicros : createdAtMicros;
}
