/** Key for the shared Paragon Soul Deck among the decks returned below. */
export const SOUL_DECK = 'soul-deck';

export interface LoggedAction {
  id: bigint;
  playerId: bigint;
  actionType: string;
  payload: string;
}

function parsePayload(payload: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Which decks a logged action shuffled: player ids as strings, or SOUL_DECK.
 *
 * Every server reducer that reshuffles a deck during play logs one of these
 * actions. `seatIds` are the ids of the players in the game.
 */
export function shuffledDecks(action: LoggedAction, seatIds: string[]): string[] {
  const actor = String(action.playerId);
  switch (action.actionType) {
    case 'SHUFFLE':
    case 'SHUFFLE_AND_DRAW':
    case 'KEEP_ONE_SHUFFLE_DRAW':
    case 'UNDO_KEEP_ONE_SHUFFLE_DRAW':
      return [actor];
    case 'EXCHANGE': {
      // Each exchanged card goes back to its owner's deck, which is then
      // reshuffled. A card taken from the other player goes to their deck.
      const { cards, received } = parsePayload(action.payload);
      const decks = new Set<string>();
      if (Array.isArray(cards)) {
        for (const card of cards) {
          if (card && typeof card.deckOwnerId === 'string') decks.add(card.deckOwnerId);
        }
      }
      // An exchange with cards from the deck always reshuffles the actor's.
      if (received !== undefined || decks.size === 0) decks.add(actor);
      return [...decks];
    }
    case 'SHUFFLE_SOUL_DECK':
      return [SOUL_DECK];
    case 'SHUFFLE_INTO_DECK': {
      // A token is deleted instead of shuffled in, so no deck changes.
      const { tokenCleanup, deckOwnerId } = parsePayload(action.payload);
      if (tokenCleanup) return [];
      return [typeof deckOwnerId === 'string' ? deckOwnerId : actor];
    }
    case 'SHUFFLE_OPPONENT_DECK': {
      const { targetPlayerId } = parsePayload(action.payload);
      return typeof targetPlayerId === 'string' ? [targetPlayerId] : [];
    }
    case 'RANDOM_HAND_TO_ZONE':
    case 'RANDOM_RESERVE_TO_ZONE':
      return parsePayload(action.payload).destination === 'deck (shuffle)' ? [actor] : [];
    case 'RANDOM_OPPONENT_HAND_TO_ZONE': {
      const { destination, targetPlayerId } = parsePayload(action.payload);
      return destination === 'deck (shuffle)' && typeof targetPlayerId === 'string' ? [targetPlayerId] : [];
    }
    case 'COMPLETE_ZONE_SEARCH': {
      // The actor searched the other player's deck and shuffled it on close.
      const { zone, shuffled } = parsePayload(action.payload);
      if (zone !== 'deck' || shuffled !== true) return [];
      return seatIds.filter((id) => id !== actor);
    }
    default:
      return [];
  }
}

/**
 * The decks shuffled by actions logged after `seenId`, each listed once.
 * `actions` must be sorted by id, oldest first.
 */
export function decksShuffledSince(actions: LoggedAction[], seenId: bigint, seatIds: string[]): string[] {
  const decks = new Set<string>();
  for (let i = actions.length - 1; i >= 0 && actions[i].id > seenId; i--) {
    for (const deck of shuffledDecks(actions[i], seatIds)) decks.add(deck);
  }
  return [...decks];
}

/**
 * Look at the log again. `seenId` is the newest id from the last look, or
 * null on the first look. The first look is history, so it reports no decks.
 */
export function readShuffles(
  actions: LoggedAction[],
  seenId: bigint | null,
  seatIds: string[],
): { seenId: bigint; decks: string[] } {
  const newest = actions.length > 0 ? actions[actions.length - 1].id : BigInt(0);
  return { seenId: newest, decks: seenId === null ? [] : decksShuffledSince(actions, seenId, seatIds) };
}
