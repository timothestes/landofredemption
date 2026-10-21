import type { BracketEntry, BracketMatch, BracketGame } from '../types';

export const entry = (i: number, deckId: string | null = `d${i}`): BracketEntry =>
  ({ id: `e${i}`, seed: i, deckId, deckName: `Deck ${i}`, deckFormat: 'Limited', previewCard1: null, previewCard2: null, paragon: null });
export const entries = (n: number) => Array.from({ length: n }, (_, i) => entry(i + 1));
let counter = 0;
export const ids = () => `m${++counter}`;

export const match = (over: Partial<BracketMatch> = {}): BracketMatch =>
  ({ id: 'm1', round: 1, position: 0, entryAId: 'e1', entryBId: 'e2', winnerEntryId: null, isBye: false, ...over });
export const game = (n: number, winner: string | null, over: Partial<BracketGame> = {}): BracketGame =>
  ({ id: `g${n}`, matchId: 'm1', gameNumber: n, mode: 'manual', code: null, firstEntryId: null, winnerEntryId: winner, soulsA: null, soulsB: null, ...over });
