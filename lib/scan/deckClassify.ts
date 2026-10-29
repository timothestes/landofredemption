import { CARDS } from '@/lib/cards/lookup';
import type { MatchResult } from './match';
import type { DeckRead } from './deckSchema';
import type { ScanDetection } from './schema';
import { getScanIndex } from './stemIndex';
import { cardKey, isAB, normalizeTitle } from './vocab';

export type DeckRowKind = 'matched' | 'which' | 'read_as' | 'not_found' | 'unread' | 'lost_soul';

export interface DeckClass {
  kind: DeckRowKind;
  /** The deck printing's cardKey for matched, read_as and which (the provisional choice); else null. */
  key: string | null;
  identityCandidates?: string[];
}

/** A deck read as a matcher detection: title, stats, type, brigade and reference only. */
export function deckReadToDetection(read: DeckRead): ScanDetection {
  return {
    title: read.title, reference: read.reference, nickname: null, abilityStart: null, abilityEnd: null,
    type: read.type, brigade: read.brigade, strength: read.strength, toughness: read.toughness,
    identifier: null, printNumber: null, rarityCode: null, promoText: null, illustrator: null, copyrightYear: null,
    grid: { row: read.position, col: read.group }, orientation: 'upright', confidence: read.confidence,
  };
}

const rotation = (c: { legality: string }) => c.legality === 'Rotation';

/** The identity's deck printing: matcher choice if Rotation-legal, else first non-AB Rotation, else first Rotation, else first. */
export function deckPrinting(identityKey: string, matcherChosenKey?: string): string {
  const cards = getScanIndex().identities.get(identityKey)!.cards;
  const chosen = matcherChosenKey && cards.find(c => cardKey(c) === matcherChosenKey);
  if (chosen && rotation(chosen)) return cardKey(chosen);
  const legal = cards.filter(rotation);
  return cardKey(legal.find(c => !isAB(c)) ?? legal[0] ?? cards[0]);
}

/** The spec's From reads to rows table: a deck read plus its matcher result becomes a row kind and printing. */
export function classifyDeckRead(read: DeckRead, m: MatchResult): DeckClass {
  if (read.title == null) return { kind: 'unread', key: null };
  if (normalizeTitle(read.title).startsWith('lost soul') && (m.printingReason === 'reference_missing' || m.status === 'not_found')) return { kind: 'lost_soul', key: null };
  if (m.printingReason === 'identity_ambiguous') {
    const cands = m.identityCandidates!;
    const legal = cands.filter(k => getScanIndex().identities.get(k)!.cards.some(rotation));
    return { kind: 'which', key: deckPrinting(legal.length === 1 ? legal[0] : cands[0]), identityCandidates: cands };
  }
  if (m.printingReason === 'reference_ambiguous') return { kind: 'matched', key: deckPrinting(m.identityCandidates![0]) };
  if (m.status === 'not_found') return { kind: 'not_found', key: null };
  const key = deckPrinting(m.identityKey!, m.chosen?.key);
  return { kind: m.nameReason === 'fuzzy' && read.confidence === 'low' ? 'read_as' : 'matched', key };
}
