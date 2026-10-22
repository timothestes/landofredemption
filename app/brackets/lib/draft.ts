import { getFormatDef } from '@/lib/formats';
import { sizeFor } from '@/lib/bracket';
import type { BracketEntry, BracketFormat } from '@/lib/bracket/types';

export interface DraftDeck {
  id: string;
  name: string;
  format: string | null;
  preview_card_1: string | null;
  preview_card_2: string | null;
  paragon: string | null;
}

/** Add the deck if absent (ignored once `max` are in), remove it if present. */
export function toggleDraftDeck(picked: DraftDeck[], deck: DraftDeck, max = 16): DraftDeck[] {
  if (picked.some(p => p.id === deck.id)) return picked.filter(p => p.id !== deck.id);
  if (picked.length >= max) return picked;
  return [...picked, deck];
}

/** Fisher-Yates over a copy. */
export function shuffleDraft(picked: DraftDeck[], random: () => number): DraftDeck[] {
  const out = [...picked];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pruneForFamily(picked: DraftDeck[], family: BracketFormat): { kept: DraftDeck[]; dropped: DraftDeck[] } {
  const kept: DraftDeck[] = [];
  const dropped: DraftDeck[] = [];
  for (const deck of picked) (getFormatDef(deck.format).family === family ? kept : dropped).push(deck);
  return { kept, dropped };
}

const decks = (n: number) => `${n} ${n === 1 ? 'deck' : 'decks'}`;

export function draftSummary(count: number): string {
  if (count < 1) return 'Pick at least 2 decks';
  if (count < 2) return `${decks(count)} · pick at least 2`;
  const size = sizeFor(count);
  const byes = size - count;
  if (byes === 0) return `${decks(count)} · no byes`;
  return `${decks(count)} · ${size} slots · ${byes} ${byes === 1 ? 'bye' : 'byes'}`;
}

/** Entries for the round-1 preview: ids 'draft-<deckId>', seeded by pick order. */
export function draftEntries(picked: DraftDeck[]): BracketEntry[] {
  return picked.map((d, i) => ({
    id: `draft-${d.id}`,
    seed: i + 1,
    deckId: d.id,
    deckName: d.name,
    deckFormat: d.format ?? '',
    previewCard1: d.preview_card_1,
    previewCard2: d.preview_card_2,
    paragon: d.paragon,
    keyCards: [],
  }));
}
