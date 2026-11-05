import { useEffect, useRef, useState } from 'react';
import { readShuffles, type LoggedAction } from '../lib/deckShuffleSignal';

/**
 * Counts shuffles per deck as they happen, so a pile can animate when its
 * count goes up. Keys are player ids as strings, plus SOUL_DECK.
 *
 * The log that is already there when the game loads is history, so nothing in
 * it counts. `ready` says that log has arrived.
 */
export function useDeckShuffleTicks(
  actions: LoggedAction[],
  ready: boolean,
  seatIds: Array<bigint | undefined>,
): Record<string, number> {
  const [ticks, setTicks] = useState<Record<string, number>>({});
  const seenId = useRef<bigint | null>(null);
  const seats = useRef<string[]>([]);
  seats.current = seatIds.filter((id) => id !== undefined).map(String);

  useEffect(() => {
    if (!ready) return;
    const { seenId: newest, decks } = readShuffles(actions, seenId.current, seats.current);
    seenId.current = newest;
    if (decks.length === 0) return;
    setTicks((prev) => {
      const next = { ...prev };
      for (const deck of decks) next[deck] = (next[deck] ?? 0) + 1;
      return next;
    });
  }, [actions, ready]);

  return ticks;
}
