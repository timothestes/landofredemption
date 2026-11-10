import { osa, type MatchResult } from './match';
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
  /** For a not_found row: the nearest Limited-legal card names, for the tray's one-tap suggestions. */
  near?: { stem: string; d: number }[];
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

/** A misread this far from a legal card's name is still worth offering: "Cremus Choice" is 0.23 from Crowd's Choice. */
const NEAR_MAX = 0.4;
let legalStems: string[] | null = null;

/**
 * The three Limited-legal card names nearest a title the matcher could not place. Wider than the matcher's own
 * fuzzy radius (0.2), which is fine because these are only offered, never chosen.
 */
export function legalNear(title: string): { stem: string; d: number }[] {
  const { byStem, stems } = getScanIndex();
  legalStems ??= stems.filter(s => byStem.get(s)!.some(id => id.cards.some(rotation)));
  const t = normalizeTitle(title);
  if (!t) return [];
  const out: { stem: string; d: number }[] = [];
  for (const s of legalStems) {
    const len = Math.max(t.length, s.length);
    if (Math.abs(t.length - s.length) / len > NEAR_MAX) continue;
    const d = osa(t, s) / len;
    if (d <= NEAR_MAX) out.push({ stem: s, d });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, 3);
}

/** Under a point, the matcher's win is the type or an empty ability: fields a deck photo's title band does not show. */
const WEAK_WIN = 1;

/**
 * When the matcher picked a card that is not Rotation-legal over a same-name card on weak evidence, and exactly
 * one card of that name is legal, that card's identity; else null. A reference, stats or brigade that agrees
 * (a point or more) keeps the matcher's choice. The type does not, however sure the read: on the eval photos a
 * confident "Site" sat on Herod's Temple (GoC), a Fortress, three times.
 */
function soleLegalNamesake(m: MatchResult): string | null {
  const { identities, byStem } = getScanIndex();
  const chosen = identities.get(m.identityKey!);
  if (!chosen || chosen.cards.some(rotation)) return null;
  if (m.scores.matchScore - m.scores.runnerUpScore >= WEAK_WIN) return null;
  const legal = (byStem.get(chosen.normalizedStem) ?? []).filter(id => id.cards.some(rotation));
  return legal.length === 1 ? legal[0].key : null;
}

/** The spec's From reads to rows table: a deck read plus its matcher result becomes a row kind and printing. */
export function classifyDeckRead(read: DeckRead, m: MatchResult): DeckClass {
  if (read.title == null) return { kind: 'unread', key: null };
  if (m.printingReason === 'reference_missing' || (normalizeTitle(read.title).startsWith('lost soul') && m.status === 'not_found')) return { kind: 'lost_soul', key: null };
  if (m.printingReason === 'identity_ambiguous') {
    const cands = m.identityCandidates!;
    const legal = cands.filter(k => getScanIndex().identities.get(k)!.cards.some(rotation));
    // Decks are built for Limited first: one legal card among the tied ones is the answer, and with several the question is only among those.
    if (legal.length === 1) return { kind: m.nameReason === 'fuzzy' && read.confidence === 'low' ? 'read_as' : 'matched', key: deckPrinting(legal[0]) };
    const among = legal.length > 1 ? legal : cands;
    return { kind: 'which', key: deckPrinting(among[0]), identityCandidates: among };
  }
  if (m.printingReason === 'reference_ambiguous') return { kind: 'matched', key: deckPrinting(m.identityCandidates![0]) };
  if (m.status === 'not_found' || !m.identityKey) {
    const near = legalNear(read.title ?? '');
    return { kind: 'not_found', key: null, ...(near.length > 0 && { near }) };
  }
  const legal = soleLegalNamesake(m);
  const key = legal ? deckPrinting(legal) : deckPrinting(m.identityKey, m.chosen?.key);
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
