import type { MatchResult } from './match';
import type { Box, DeckGroup, DeckOutput, DeckRead } from './deckSchema';
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
  if (m.printingReason === 'reference_missing' || (normalizeTitle(read.title).startsWith('lost soul') && m.status === 'not_found')) return { kind: 'lost_soul', key: null };
  if (m.printingReason === 'identity_ambiguous') {
    const cands = m.identityCandidates!;
    const legal = cands.filter(k => getScanIndex().identities.get(k)!.cards.some(rotation));
    return { kind: 'which', key: deckPrinting(legal.length === 1 ? legal[0] : cands[0]), identityCandidates: cands };
  }
  if (m.printingReason === 'reference_ambiguous') return { kind: 'matched', key: deckPrinting(m.identityCandidates![0]) };
  if (m.status === 'not_found') return { kind: 'not_found', key: null };
  if (!m.identityKey) return { kind: 'not_found', key: null };
  const key = deckPrinting(m.identityKey, m.chosen?.key);
  return { kind: m.nameReason === 'fuzzy' && read.confidence === 'low' ? 'read_as' : 'matched', key };
}

/** One deck-photo read, matched and classified: the row the review screen shows. */
export interface DeckDetection {
  id: string;
  group: number;
  position: number;
  titleBox: Box | null;
  read: ScanDetection;
  status: MatchResult['status'];
  nameReason: MatchResult['nameReason'];
  printingReason: MatchResult['printingReason'];
  chosenKey: string | null;
  kind: DeckRowKind;
  deckKey: string | null;
  identityCandidates?: string[];
  near?: { stem: string; d: number }[];
  scores: MatchResult['scores'];
  candidates: MatchResult['candidates'];
}

/** POST /api/scan response when mode=deck. */
export interface DeckScanResponse {
  scanId: string;
  mode: 'deck';
  photoQuality: DeckOutput['photoQuality'];
  /** Clockwise degrees the photo was turned before it was read (turnPass.ts); groups and title boxes are in the turned frame. */
  rotation: 0 | 90 | 180 | 270;
  /** Size of the image that was read, in the turned frame: a small one is a copy saved smaller than the camera's original. */
  imageSize: { width: number; height: number };
  groups: DeckGroup[];
  detections: DeckDetection[];
  /** Groups the crop pass re-read, could not re-read, never reached (over MAX_CROP_GROUPS or out of budget), and dropped as nested in a cropped group. */
  crops: { cropped: number[]; failed: number[]; skipped: number[]; merged: number[] };
  usage: { model: string; latencyMs: number; attempts: number; costUsd?: number };
}
