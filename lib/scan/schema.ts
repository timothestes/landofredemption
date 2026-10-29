import { createHash } from 'node:crypto';

// Transcription contract shared by the recognizer and the scan route.
// Pure module: no network, no Supabase.

export const CARD_TYPES = ['Hero', 'Evil Character', 'Enhancement', 'Lost Soul', 'Dominant', 'Site', 'Fortress', 'Artifact', 'Covenant', 'Curse', 'City', 'token', 'unknown'] as const;
export const ORIENTATIONS = ['upright', 'rotated', 'upside_down'] as const;
export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export const PHOTO_QUALITIES = ['ok', 'blurry', 'dark', 'glare', 'too_many_cards', 'no_cards'] as const;

export interface ScanDetection {
  title: string | null;
  reference: string | null;
  nickname: string | null;
  abilityStart: string | null;
  abilityEnd: string | null;
  type: (typeof CARD_TYPES)[number];
  brigade: string | null;
  strength: string | null;
  toughness: string | null;
  identifier: string | null;
  printNumber: string | null;
  rarityCode: string | null;
  promoText: string | null;
  illustrator: string | null;
  copyrightYear: string | null;
  grid: { row: number; col: number };
  orientation: (typeof ORIENTATIONS)[number];
  confidence: (typeof CONFIDENCES)[number];
}

export interface ScanOutput {
  photoQuality: (typeof PHOTO_QUALITIES)[number];
  cards: ScanDetection[];
}

export const SCAN_INSTRUCTION = `You are reading a photograph that may contain Redemption CCG trading cards (Cactus Game Design). Transcribe what is printed on each card you can see. Do not identify or name the card from memory and do not say which card it is: copy the printed text exactly, and return null for any field you cannot read clearly. Never guess a value.

Where things are on a Redemption card:
- title: the band across the top of the card (top right on newer frames, centered on older frames).
- strength and toughness: two numbers separated by a slash in a small box at the top-left, only on Heroes and Evil Characters (for example "7/8" means strength 7, toughness 8).
- type: from the icon box under the stats and the frame: Hero, Evil Character, Enhancement (good or evil), Lost Soul, Dominant, Site, Fortress, Artifact, Covenant, Curse, City. Use "unknown" if unsure.
- brigade: the color of the frame around the art, as color words (Gold, Silver, White, Blue, Green, Purple, Red, Teal, Clay, Black, Brown, Crimson, Gray, Orange, Pale Green). Use a slash for two colors.
- identifier: the small text in a pill just above the ability box (for example "Demon, Persian").
- nickname: on Lost Souls only, the quoted word in that pill (for example "Accusers").
- abilityStart: the first six words of the bold special ability text in the box below the art.
- reference: the scripture reference at the end of the italic verse text near the bottom, book then chapter:verse (for example "Daniel 10:13", "I Kings 1:41").
- promoText: any tournament, event, placement or promotional text printed anywhere on the card, copied exactly (for example "25th Annual Redemption National Tournament, Knoxville, TN, August 1-3, 2019", "State Promo", "2nd Place Promo", "Redemption Gift Set"); null if none.
- abilityEnd: the last four words of the special ability text.
- illustrator: the artist credit line near the bottom, copied exactly (for example "Illus. AI Generated", "Illus. © Cahaba Productions", "Illus. Tom Simonton"); null if unreadable.
- copyrightYear: the four-digit year in the copyright line near the bottom (for example "© 2025 Cactus Game Design, Inc." gives "2025"); null if unreadable.
- printNumber and rarityCode: small text in the bottom-left corner on newer frames, a number and a letter code (for example "76" and "UR", "33" and "R", "LR65" is number "65" and code "LR", "UR+" is code "UR+"). Older frames have only a letter or nothing. Promo text such as "State Promo" or "Seasonal Redemption Promo" may appear there instead; put that text in rarityCode.

Cards may be in plastic sleeves, in binder pages, overlapping, rotated, upside down, foil, glossy, or photographed at an angle. Report every card whose title you can read at least partly. Give each card a grid position (row, col) counting from 1 in reading order, top-left to bottom-right; a lone card is row 1, col 1. Set confidence to high only when the title is sharp and unambiguous. photoQuality is one of ok, blurry, dark, glare, too_many_cards, no_cards.`;

const S = ['string', 'null'];
const CARD = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: S },
    reference: { type: S },
    nickname: { type: S },
    abilityStart: { type: S },
    abilityEnd: { type: S },
    type: { type: 'string', enum: [...CARD_TYPES] },
    brigade: { type: S },
    strength: { type: S },
    toughness: { type: S },
    identifier: { type: S },
    printNumber: { type: S },
    rarityCode: { type: S },
    promoText: { type: S },
    illustrator: { type: S },
    copyrightYear: { type: S },
    grid: { type: 'object', additionalProperties: false, properties: { row: { type: 'integer' }, col: { type: 'integer' } }, required: ['row', 'col'] },
    orientation: { type: 'string', enum: [...ORIENTATIONS] },
    confidence: { type: 'string', enum: [...CONFIDENCES] },
  },
  required: ['title', 'reference', 'nickname', 'abilityStart', 'abilityEnd', 'type', 'brigade', 'strength', 'toughness', 'identifier', 'printNumber', 'rarityCode', 'promoText', 'illustrator', 'copyrightYear', 'grid', 'orientation', 'confidence'],
};

export const SCAN_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    photoQuality: { type: 'string', enum: [...PHOTO_QUALITIES] },
    cards: { type: 'array', items: CARD },
  },
  required: ['photoQuality', 'cards'],
};

export const PROMPT_HASH: string = createHash('sha256').update(SCAN_INSTRUCTION + JSON.stringify(SCAN_JSON_SCHEMA)).digest('hex').slice(0, 12);

type StringField = Exclude<keyof ScanDetection, 'grid' | 'orientation' | 'confidence'>;

/** Stored-field caps. The schema itself carries no length bounds (the API rejects them). */
export const FIELD_CAPS: Record<StringField, number> = {
  title: 60, reference: 40, nickname: 30, abilityStart: 80, abilityEnd: 80, identifier: 40, type: 30, brigade: 40,
  strength: 8, toughness: 8, printNumber: 8, rarityCode: 8, promoText: 120, illustrator: 60, copyrightYear: 4,
};

const STRING_LEAVES = Object.keys(FIELD_CAPS).filter(k => k !== 'type') as Exclude<StringField, 'type'>[];

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

// Grid default is 1 (the spec numbers positions from 1; a lone card is row 1, col 1).
export function gridIndex(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
}

/** Truncate string fields, null non-strings, coerce unknown enums. Never throws. */
export function capDetection(d: ScanDetection): ScanDetection {
  const src = (d && typeof d === 'object' ? d : {}) as Record<string, any>;
  const out: Record<string, unknown> = {};
  for (const k of STRING_LEAVES) out[k] = typeof src[k] === 'string' ? src[k].slice(0, FIELD_CAPS[k]) : null;
  // A copyright line read whole ("© 2025 Cactus…") keeps its year, not its first four characters.
  if (typeof src.copyrightYear === 'string') out.copyrightYear = /\b(?:19|20)\d\d\b/.exec(src.copyrightYear)?.[0] ?? out.copyrightYear;
  const g = src.grid && typeof src.grid === 'object' ? src.grid : {};
  return {
    ...(out as Omit<ScanDetection, 'type' | 'grid' | 'orientation' | 'confidence'>),
    type: oneOf(src.type, CARD_TYPES, 'unknown'),
    grid: { row: gridIndex(g.row), col: gridIndex(g.col) },
    orientation: oneOf(src.orientation, ORIENTATIONS, 'upright'),
    confidence: oneOf(src.confidence, CONFIDENCES, 'low'),
  };
}

/** JSON.parse + shape check, capped. null on any failure. An unknown photoQuality coerces to 'ok'. */
export function parseScanOutput(text: string): ScanOutput | null {
  try {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cards)) return null;
    for (const c of raw.cards) {
      if (!c || typeof c !== 'object' || Array.isArray(c) || !c.grid || typeof c.grid !== 'object') return null;
    }
    return { photoQuality: oneOf(raw.photoQuality, PHOTO_QUALITIES, 'ok'), cards: raw.cards.map(capDetection) };
  } catch {
    return null;
  }
}
