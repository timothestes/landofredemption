import { createHash } from 'node:crypto';
import { CARD_TYPES, CONFIDENCES, FIELD_CAPS, gridIndex, oneOf } from './schema';

// Deck-photo transcription contract: the counterpart of schema.ts for a whole deck laid out on a table.
// Pure module: no network, no Supabase.

export const GROUP_ORIENTATIONS = ['upright', 'rotated_cw', 'rotated_ccw', 'upside_down'] as const;
export const DECK_PHOTO_QUALITIES = ['ok', 'blurry', 'dark', 'glare', 'no_cards'] as const;

/** Normalized [x0, y0, x1, y1], each 0-1. */
export type Box = [number, number, number, number];

export interface DeckGroup {
  id: number;
  orientation: (typeof GROUP_ORIENTATIONS)[number];
  bbox: Box;
  cardCount: number;
}

export interface DeckRead {
  title: string | null;
  strength: string | null;
  toughness: string | null;
  type: (typeof CARD_TYPES)[number];
  brigade: string | null;
  reference: string | null;
  group: number;
  position: number;
  titleBox: Box | null;
  confidence: (typeof CONFIDENCES)[number];
}

export interface DeckOutput {
  photoQuality: (typeof DECK_PHOTO_QUALITIES)[number];
  groups: DeckGroup[];
  cards: DeckRead[];
}

/** Most reads kept from one photo. */
export const DECK_DETECTION_CAP = 300;

export const DECK_INSTRUCTION = `You are reading a photograph of a Redemption CCG deck (Cactus Game Design) laid out on a table for a decklist photo. Cards are arranged in overlapping columns or fans so that only the top band of most cards is visible: the title band and, on Heroes and Evil Characters, the small strength/toughness box at the top-left. Usually one card at the end of each column is fully visible.

Transcribe every physical card you can see, one entry per card, including duplicates: if the same title appears five times in a fan, return five entries. Count carefully by following each repeated title-band edge; overlapping fans hide most of each card. Never merge duplicates into one entry.

For each card:
- title: the title band text copied exactly as printed. If the title cannot be read, return null; never guess a title. A partly hidden title gets your best reading of the visible letters and confidence "low".
- strength and toughness: the two numbers in the top-left box when visible ("7/8" means strength "7", toughness "8"), else null.
- type: Hero, Evil Character, Enhancement, Lost Soul, Dominant, Site, Fortress, Artifact, Covenant, Curse, City, or unknown, judged from the frame and the icon beside the stats box.
- brigade: the frame colour as colour words (Gold, Silver, White, Blue, Green, Purple, Red, Teal, Clay, Black, Brown, Crimson, Gray, Orange, Pale Green), a slash for two colours, or null.
- reference: the scripture reference at the end of the italic verse line, only when that verse line is visible (usually just the one fully visible card at the end of a column); otherwise null.
- group and position: group is the id of the group (below) the card belongs to; position is 1-based within the group, top to bottom for a column or left to right for a row.
- titleBox: a normalized box [x0, y0, x1, y1] (each 0 to 1, as fractions of the whole photo, origin top-left) around this card's visible title band; null when unsure.
- confidence: high only when the title is sharp and unambiguous.

Groups: list every visually separate run of cards (a column, a fan, a row) as a group with an integer id starting at 1, its orientation as it appears in the photo (upright, rotated_cw, rotated_ccw or upside_down), a normalized bounding box [x0, y0, x1, y1] (each 0 to 1, as fractions of the whole photo, origin top-left) and an estimated cardCount. A separate row of cards along the top or bottom edge is its own group.

Lost Soul cards show only the words "Lost Soul" when fanned; report each one with title "Lost Soul", and its reference when the verse line is visible. Do not identify cards from memory and do not say which card it is: copy what is printed. Never invent a card you cannot see.

photoQuality is one of ok, blurry, dark, glare, no_cards.`;

const S = ['string', 'null'];
// The API rejects minItems/maxItems, so a box is an unbounded number array checked in the parser.
const BOX = { type: 'array', items: { type: 'number' } };
const CARD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: S },
    strength: { type: S },
    toughness: { type: S },
    type: { type: 'string', enum: [...CARD_TYPES] },
    brigade: { type: S },
    reference: { type: S },
    group: { type: 'integer' },
    position: { type: 'integer' },
    titleBox: { type: ['array', 'null'], items: { type: 'number' } },
    confidence: { type: 'string', enum: [...CONFIDENCES] },
  },
  required: ['title', 'strength', 'toughness', 'type', 'brigade', 'reference', 'group', 'position', 'titleBox', 'confidence'],
};
const GROUP = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'integer' },
    orientation: { type: 'string', enum: [...GROUP_ORIENTATIONS] },
    bbox: BOX,
    cardCount: { type: 'integer' },
  },
  required: ['id', 'orientation', 'bbox', 'cardCount'],
};

export const DECK_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    photoQuality: { type: 'string', enum: [...DECK_PHOTO_QUALITIES] },
    groups: { type: 'array', items: GROUP },
    cards: { type: 'array', items: CARD },
  },
  required: ['photoQuality', 'groups', 'cards'],
};

export const DECK_PROMPT_HASH: string = createHash('sha256').update(DECK_INSTRUCTION + JSON.stringify(DECK_JSON_SCHEMA)).digest('hex').slice(0, 12);

const WHOLE: Box = [0, 0, 1, 1];
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Four finite numbers, clamped to 0-1 and ordered; anything else is null.
function toBox(v: unknown): Box | null {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(n => typeof n === 'number' && Number.isFinite(n))) return null;
  const [a, b, c, d] = v.map(clamp01);
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

const str = (v: unknown, cap: number): string | null => (typeof v === 'string' ? v.slice(0, cap) : null);

function countOf(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/** JSON.parse + shape check, capped. null on any failure. Unknown enums coerce; orphan cards go to group 0. */
export function parseDeckOutput(text: string): DeckOutput | null {
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cards)) return null;
    if (raw.cards.some((c: unknown) => !c || typeof c !== 'object' || Array.isArray(c))) return null;
    const rawGroups: unknown[] = Array.isArray(raw.groups) ? raw.groups : [];
    const groups: DeckGroup[] = rawGroups
      .filter((g): g is Record<string, any> => !!g && typeof g === 'object' && !Array.isArray(g))
      .map(g => ({
        id: gridIndex(g.id),
        orientation: oneOf(g.orientation, GROUP_ORIENTATIONS, 'upright'),
        bbox: toBox(g.bbox) ?? ([...WHOLE] as Box),
        cardCount: countOf(g.cardCount),
      }));
    const ids = new Set(groups.map(g => g.id));
    let orphans = 0;
    const cards: DeckRead[] = raw.cards.map((c: Record<string, any>) => {
      const known = typeof c.group === 'number' && ids.has(c.group);
      if (!known) orphans++;
      return {
        title: str(c.title, FIELD_CAPS.title),
        strength: str(c.strength, FIELD_CAPS.strength),
        toughness: str(c.toughness, FIELD_CAPS.toughness),
        type: oneOf(c.type, CARD_TYPES, 'unknown'),
        brigade: str(c.brigade, FIELD_CAPS.brigade),
        reference: str(c.reference, FIELD_CAPS.reference),
        group: known ? c.group : 0,
        position: gridIndex(c.position),
        titleBox: toBox(c.titleBox),
        confidence: oneOf(c.confidence, CONFIDENCES, 'low'),
      };
    });
    if (orphans > 0) groups.push({ id: 0, orientation: 'upright', bbox: [...WHOLE] as Box, cardCount: orphans });
    return { photoQuality: oneOf(raw.photoQuality, DECK_PHOTO_QUALITIES, 'ok'), groups, cards };
  } catch {
    return null;
  }
}
