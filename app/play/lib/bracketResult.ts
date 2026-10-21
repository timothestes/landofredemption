// Pure: which seat won a finished game, read from its action log. Used by the
// bracket flow to record a result for a /play game launched from a bracket.

export type EndKind = 'win' | 'resign' | 'timeout' | 'none';

/**
 * Scans the action log from the end for the last game-ending action.
 * WIN → that player's seat; RESIGN → the other seat; TIMEOUT → the claimer's
 * seat, but only when it was a claim (claim_timeout_victory logs
 * reason 'claimed_by_opponent'). A waiting/pregame disconnect timeout logs
 * TIMEOUT with the disconnected player's id and reason 'disconnect_timeout':
 * that ended the game with no result. No ending action → none.
 */
export function resolveWinnerSeat(
  actions: Array<{ actionType: string; playerId: bigint; payload?: string }>,
  players: Array<{ id: bigint; seat: bigint }>,
): { kind: EndKind; winnerSeat: 0 | 1 | null } {
  for (let i = actions.length - 1; i >= 0; i--) {
    const type = (actions[i].actionType ?? '').toUpperCase();
    const kind: EndKind | null =
      type === 'WIN' ? 'win' : type === 'RESIGN' ? 'resign' : type === 'TIMEOUT' ? 'timeout' : null;
    if (!kind) continue;
    if (kind === 'timeout' && timeoutReason(actions[i].payload) !== 'claimed_by_opponent') {
      return { kind: 'none', winnerSeat: null };
    }
    const actor = players.find((p) => p.id === actions[i].playerId);
    if (!actor) return { kind: 'none', winnerSeat: null };
    const actorSeat = Number(actor.seat) === 1 ? 1 : 0;
    return { kind, winnerSeat: kind === 'resign' ? (actorSeat === 1 ? 0 : 1) : actorSeat };
  }
  return { kind: 'none', winnerSeat: null };
}

function timeoutReason(payload: string | undefined): string | null {
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed && typeof parsed === 'object' && typeof (parsed as { reason?: unknown }).reason === 'string') {
      return (parsed as { reason: string }).reason;
    }
  } catch {
    // Malformed payload: treat as no claim.
  }
  return null;
}

/**
 * Maps viewer-relative soul counts to seats. `mySeat` is the seat whose view
 * `me` is (in solo, the seat in hand).
 */
export function soulsBySeat(
  souls: { me: number; opponent: number },
  mySeat: 0 | 1,
): { seat0: number; seat1: number } {
  return mySeat === 0
    ? { seat0: souls.me, seat1: souls.opponent }
    : { seat0: souls.opponent, seat1: souls.me };
}
