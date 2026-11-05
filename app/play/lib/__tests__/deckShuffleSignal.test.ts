import { describe, it, expect } from 'vitest';
import {
  SOUL_DECK,
  decksShuffledSince,
  readShuffles,
  shuffledDecks,
  type LoggedAction,
} from '../deckShuffleSignal';

const SEATS = ['7', '9'];
let nextId = 1;
function action(playerId: number, actionType: string, payload: object | string = ''): LoggedAction {
  return {
    id: BigInt(nextId++),
    playerId: BigInt(playerId),
    actionType,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  };
}

describe('shuffledDecks', () => {
  it("names the actor's deck for a plain shuffle", () => {
    expect(shuffledDecks(action(7, 'SHUFFLE'), SEATS)).toEqual(['7']);
  });

  it("names the actor's deck for the effects that reshuffle it", () => {
    for (const type of ['SHUFFLE_AND_DRAW', 'KEEP_ONE_SHUFFLE_DRAW', 'UNDO_KEEP_ONE_SHUFFLE_DRAW']) {
      expect(shuffledDecks(action(9, type, { shuffled: 2, drawn: 2 }), SEATS)).toEqual(['9']);
    }
  });

  it('names every deck an exchange put a card back into', () => {
    const own = { name: 'Abel', img: 'a.jpg', fromZone: 'hand', deckOwnerId: '7' };
    const taken = { name: 'Cain', img: 'c.jpg', fromZone: 'territory', deckOwnerId: '9' };
    expect(shuffledDecks(action(7, 'EXCHANGE', { count: 1, cards: [own] }), SEATS)).toEqual(['7']);
    expect(shuffledDecks(action(7, 'EXCHANGE', { count: 2, cards: [own, taken] }), SEATS).sort()).toEqual(['7', '9']);
    // Only a taken card went back: the actor's own deck was not reshuffled.
    expect(shuffledDecks(action(7, 'EXCHANGE', { count: 1, cards: [taken] }), SEATS)).toEqual(['9']);
  });

  it("always names the actor's deck for an exchange with cards from the deck", () => {
    const taken = { name: 'Cain', img: 'c.jpg', fromZone: 'territory', deckOwnerId: '9' };
    const payload = { count: 1, cards: [taken], received: [{ name: 'Seth', img: 's.jpg' }] };
    expect(shuffledDecks(action(7, 'EXCHANGE', payload), SEATS).sort()).toEqual(['7', '9']);
  });

  it("falls back to the actor's deck for an exchange that lists no cards", () => {
    expect(shuffledDecks(action(7, 'EXCHANGE', { count: 0 }), SEATS)).toEqual(['7']);
    expect(shuffledDecks(action(7, 'EXCHANGE', 'not json'), SEATS)).toEqual(['7']);
  });

  it('names the Soul Deck', () => {
    expect(shuffledDecks(action(7, 'SHUFFLE_SOUL_DECK'), SEATS)).toEqual([SOUL_DECK]);
  });

  it("names the deck a card was shuffled into, which can be the other player's", () => {
    expect(shuffledDecks(action(7, 'SHUFFLE_INTO_DECK', { cardName: 'Abel', deckOwnerId: '7' }), SEATS)).toEqual(['7']);
    expect(shuffledDecks(action(7, 'SHUFFLE_INTO_DECK', { cardName: 'Abel', deckOwnerId: '9' }), SEATS)).toEqual(['9']);
  });

  it('ignores a token, which is deleted instead of shuffled in', () => {
    const token = action(7, 'SHUFFLE_INTO_DECK', { cardName: 'Angel', tokenCleanup: true, deckOwnerId: '7' });
    expect(shuffledDecks(token, SEATS)).toEqual([]);
  });

  it("names the target when a player shuffles the other player's deck", () => {
    expect(shuffledDecks(action(7, 'SHUFFLE_OPPONENT_DECK', { requestId: '3', targetPlayerId: '9' }), SEATS)).toEqual(['9']);
  });

  it('counts random moves only when they shuffle into the deck', () => {
    expect(shuffledDecks(action(7, 'RANDOM_HAND_TO_ZONE', { destination: 'deck (shuffle)', count: 2 }), SEATS)).toEqual(['7']);
    expect(shuffledDecks(action(7, 'RANDOM_RESERVE_TO_ZONE', { destination: 'deck (shuffle)', count: 1 }), SEATS)).toEqual(['7']);
    expect(shuffledDecks(action(7, 'RANDOM_HAND_TO_ZONE', { destination: 'deck (top)', count: 2 }), SEATS)).toEqual([]);
    expect(shuffledDecks(action(7, 'RANDOM_HAND_TO_ZONE', { destination: 'discard', count: 2 }), SEATS)).toEqual([]);
    expect(
      shuffledDecks(action(7, 'RANDOM_OPPONENT_HAND_TO_ZONE', { destination: 'deck (shuffle)', targetPlayerId: '9' }), SEATS),
    ).toEqual(['9']);
    expect(
      shuffledDecks(action(7, 'RANDOM_OPPONENT_HAND_TO_ZONE', { destination: 'deck (bottom)', targetPlayerId: '9' }), SEATS),
    ).toEqual([]);
  });

  it("names the other player's deck when a search of it ends with a shuffle", () => {
    expect(shuffledDecks(action(7, 'COMPLETE_ZONE_SEARCH', { zone: 'deck', shuffled: true }), SEATS)).toEqual(['9']);
    expect(shuffledDecks(action(9, 'COMPLETE_ZONE_SEARCH', { zone: 'deck', shuffled: true }), SEATS)).toEqual(['7']);
    expect(shuffledDecks(action(7, 'COMPLETE_ZONE_SEARCH', { zone: 'deck', shuffled: false }), SEATS)).toEqual([]);
    expect(shuffledDecks(action(7, 'COMPLETE_ZONE_SEARCH', { zone: 'reserve', shuffled: true }), SEATS)).toEqual([]);
  });

  it('ignores actions that leave deck order alone, and bad payloads', () => {
    expect(shuffledDecks(action(7, 'DRAW', { count: 1 }), SEATS)).toEqual([]);
    expect(shuffledDecks(action(7, 'DECK_SEARCH_NO_SHUFFLE', { topCount: 1 }), SEATS)).toEqual([]);
    expect(shuffledDecks(action(7, 'SHUFFLE_OPPONENT_DECK', 'not json'), SEATS)).toEqual([]);
    expect(shuffledDecks(action(7, 'SHUFFLE_INTO_DECK', ''), SEATS)).toEqual(['7']);
  });
});

describe('decksShuffledSince', () => {
  const log = [
    action(7, 'SHUFFLE'),
    action(9, 'DRAW'),
    action(9, 'SHUFFLE'),
    action(9, 'SHUFFLE'),
    action(7, 'SHUFFLE_SOUL_DECK'),
  ];

  it('reports only actions newer than the last one seen', () => {
    expect(decksShuffledSince(log, log[1].id, SEATS).sort()).toEqual(['9', SOUL_DECK].sort());
    expect(decksShuffledSince(log, log[3].id, SEATS)).toEqual([SOUL_DECK]);
    expect(decksShuffledSince(log, log[4].id, SEATS)).toEqual([]);
  });

  it('lists a deck once however many times it was shuffled', () => {
    expect(decksShuffledSince(log, log[0].id, SEATS).filter((deck) => deck === '9')).toHaveLength(1);
  });

  it('handles an empty log', () => {
    expect(decksShuffledSince([], BigInt(0), SEATS)).toEqual([]);
  });
});

describe('readShuffles', () => {
  const history = [action(7, 'SHUFFLE'), action(9, 'SHUFFLE_SOUL_DECK')];

  it('treats the log that is there on the first look as history', () => {
    const first = readShuffles(history, null, SEATS);
    expect(first.decks).toEqual([]);
    expect(first.seenId).toBe(history[1].id);
  });

  it('starts from zero when the first look finds an empty log', () => {
    const first = readShuffles([], null, SEATS);
    expect(first).toEqual({ seenId: BigInt(0), decks: [] });
    const shuffle = action(9, 'SHUFFLE');
    expect(readShuffles([shuffle], first.seenId, SEATS).decks).toEqual(['9']);
  });

  it('reports a shuffle once, on the look after it arrives', () => {
    const first = readShuffles(history, null, SEATS);
    const log = [...history, action(9, 'SHUFFLE')];
    const second = readShuffles(log, first.seenId, SEATS);
    expect(second.decks).toEqual(['9']);
    // Same rows in a new array, as when another table re-renders the hook.
    expect(readShuffles([...log], second.seenId, SEATS).decks).toEqual([]);
  });
});
