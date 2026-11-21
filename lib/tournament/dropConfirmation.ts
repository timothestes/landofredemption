// lib/tournament/dropConfirmation.ts
//
// What the Drop confirmation tells the host. Pure, so the wording rule is
// unit-testable.
//
// Ending a round pairs the next one straight away, so a player dropped between
// rounds — the usual moment — is already in the current round's pairings. Their
// unscored match is then scored as a forfeit at End Round
// (lib/tournament/dropForfeit.ts). The old text promised the opposite.

/** A current-round match, reduced to what the wording depends on. */
export interface DropRoundMatch {
  player1_id: string;
  player2_id: string;
  player1_score: number | null;
  player2_score: number | null;
}

/** True, and enough, when the player has no unscored match in the current round. */
export const DROP_BEFORE_PAIRING_TEXT =
  "They will not appear in next round's pairings. You can restore them later from this list.";

const hasResult = (m: DropRoundMatch) =>
  m.player1_score !== null && m.player2_score !== null;

/**
 * @param currentRound  tournaments.current_round, or null when unknown.
 * @param roundMatches  every match of that round.
 */
export function dropConfirmationText(
  participantId: string,
  currentRound: number | null,
  roundMatches: DropRoundMatch[],
): string {
  if (currentRound === null) return DROP_BEFORE_PAIRING_TEXT;

  const own = roundMatches.find(
    (m) => m.player1_id === participantId || m.player2_id === participantId,
  );
  if (!own || hasResult(own)) return DROP_BEFORE_PAIRING_TEXT;

  const paired = `Already paired for round ${currentRound}. Their match will count as a forfeit when the round ends.`;
  // Regenerate pairings is only offered while the round has no results.
  return roundMatches.some(hasResult)
    ? paired
    : `${paired} To pair the round without them, use Regenerate pairings (the wrench on the Rounds tab) before any results are entered.`;
}
