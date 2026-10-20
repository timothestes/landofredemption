import { describe, it, expect } from 'vitest';
import {
  computeDeckSpreadLayout,
  spreadBucketKey,
  SPREAD_MAX_PER_COLUMN,
} from '../deckSpreadLayout';
import type { ZoneRect } from '../zoneLayout';
import type { GameCard } from '../../types';

function makeCard(overrides: Partial<GameCard> & { instanceId: string }): GameCard {
  return {
    cardName: overrides.instanceId,
    cardSet: 'T',
    cardImgFile: 'X',
    type: 'Hero',
    brigade: '',
    strength: '',
    toughness: '',
    specialAbility: '',
    identifier: '',
    reference: '',
    alignment: '',
    isMeek: false,
    counters: [],
    isFlipped: true,
    isToken: false,
    zone: 'deck',
    ownerId: 'player1',
    notes: '',
    ...overrides,
  };
}

function many(n: number, prefix: string, extra: Partial<GameCard> = {}): GameCard[] {
  return Array.from({ length: n }, (_, i) =>
    makeCard({ instanceId: `${prefix}${i}`, cardName: `${prefix}${String(i).padStart(3, '0')}`, ...extra }),
  );
}

// A roomy territory so the default pitches are never squeezed.
const BIG_ZONE: ZoneRect = { x: 10, y: 50, width: 3000, height: 3000, label: 'Territory' };
const CARD_W = 120;
const CARD_H = 168;
const PITCH = CARD_W + Math.round(CARD_W * 0.14); // 137
const STRIP = Math.round(CARD_H * 0.235); // 39
const X0 = BIG_ZONE.x + 8;
const Y0 = BIG_ZONE.y + 24;

function lay(main: GameCard[], reserve: GameCard[] = [], zone: ZoneRect = BIG_ZONE) {
  return computeDeckSpreadLayout({ main, reserve }, zone, CARD_W, CARD_H);
}

// Columns are told apart by their x; a column's cards share one x.
function columnsOf(layout: ReturnType<typeof computeDeckSpreadLayout>): Map<number, string[]> {
  const cols = new Map<number, string[]>();
  for (const id of layout.orderedIds) {
    const { posX } = layout.positions[id];
    const list = cols.get(posX) ?? [];
    list.push(id);
    cols.set(posX, list);
  }
  return cols;
}

describe('spreadBucketKey', () => {
  it('reproduces the deck builder type buckets', () => {
    expect(spreadBucketKey('GE')).toBe('Good Enhancement');
    expect(spreadBucketKey('EE')).toBe('Evil Enhancement');
    expect(spreadBucketKey('Hero')).toBe('Hero');
    expect(spreadBucketKey('Evil Character')).toBe('Evil Character');
    expect(spreadBucketKey('Lost Soul')).toBe('Lost Soul');
    expect(spreadBucketKey('Dominant')).toBe('Dominant');
  });

  it('merges Artifact, Covenant and Curse into one bucket', () => {
    expect(spreadBucketKey('Artifact')).toBe('Artifact/Covenant/Curse');
    expect(spreadBucketKey('Covenant')).toBe('Artifact/Covenant/Curse');
    expect(spreadBucketKey('Curse')).toBe('Artifact/Covenant/Curse');
  });

  it('merges Fortress, Site and City into one bucket', () => {
    expect(spreadBucketKey('Fortress')).toBe('Fortress/Site');
    expect(spreadBucketKey('Site')).toBe('Fortress/Site');
    expect(spreadBucketKey('City')).toBe('Fortress/Site');
  });

  it('puts any slash type into Dual-Type', () => {
    expect(spreadBucketKey('Hero/Evil Character')).toBe('Dual-Type');
    expect(spreadBucketKey('GE/EE')).toBe('Dual-Type');
    expect(spreadBucketKey('Fortress / Evil Character')).toBe('Dual-Type');
  });
});

describe('computeDeckSpreadLayout — main deck', () => {
  it('returns nothing for no cards', () => {
    const out = lay([]);
    expect(out.orderedIds).toEqual([]);
    expect(out.positions).toEqual({});
  });

  it('places every card exactly once', () => {
    const cards = [...many(5, 'h'), ...many(3, 'e', { type: 'EE' })];
    const out = lay(cards);
    expect(out.orderedIds).toHaveLength(8);
    expect(new Set(out.orderedIds).size).toBe(8);
    for (const c of cards) expect(out.positions[c.instanceId]).toBeDefined();
  });

  it('orders buckets canonically left to right', () => {
    const cards = [
      makeCard({ instanceId: 'ee', type: 'EE' }),
      makeCard({ instanceId: 'hero', type: 'Hero' }),
      makeCard({ instanceId: 'ls', type: 'Lost Soul' }),
      makeCard({ instanceId: 'dom', type: 'Dominant' }),
      makeCard({ instanceId: 'ec', type: 'Evil Character' }),
      makeCard({ instanceId: 'ge', type: 'GE' }),
      makeCard({ instanceId: 'dual', type: 'Hero/Evil Character' }),
      makeCard({ instanceId: 'fort', type: 'Fortress' }),
      makeCard({ instanceId: 'art', type: 'Artifact' }),
    ];
    const out = lay(cards);
    const byX = [...out.orderedIds].sort((a, b) => out.positions[a].posX - out.positions[b].posX);
    expect(byX).toEqual(['dom', 'art', 'fort', 'ls', 'dual', 'hero', 'ge', 'ec', 'ee']);
  });

  it('sorts within a bucket by brigade then name and keeps copies adjacent', () => {
    const cards = [
      makeCard({ instanceId: 'r1', cardName: 'Zed', brigade: 'Red' }),
      makeCard({ instanceId: 'b1', cardName: 'Moses', brigade: 'Blue' }),
      makeCard({ instanceId: 'r2', cardName: 'Zed', brigade: 'Red' }),
      makeCard({ instanceId: 'b2', cardName: 'Aaron', brigade: 'Blue' }),
    ];
    expect(lay(cards).orderedIds).toEqual(['b2', 'b1', 'r1', 'r2']);
  });

  it('stacks a column top to bottom at the deck builder strip (0.235 of card height)', () => {
    const out = lay(many(3, 'h'));
    expect(out.orderedIds.map((id) => out.positions[id])).toEqual([
      { posX: X0, posY: Y0 },
      { posX: X0, posY: Y0 + STRIP },
      { posX: X0, posY: Y0 + STRIP * 2 },
    ]);
  });

  it('spaces columns at card width plus the deck builder gap (0.14 of card width)', () => {
    const out = lay([makeCard({ instanceId: 'h', type: 'Hero' }), makeCard({ instanceId: 'e', type: 'EE' })]);
    expect(out.positions.h.posX).toBe(X0);
    expect(out.positions.e.posX).toBe(X0 + PITCH);
  });

  it('caps a column at 17 and splits 18 singletons 9 + 9', () => {
    expect(SPREAD_MAX_PER_COLUMN).toBe(17);
    const cols = [...columnsOf(lay(many(18, 'h'))).values()].map((c) => c.length);
    expect(cols).toEqual([9, 9]);
  });

  it('splits 35 singletons 12 + 12 + 11', () => {
    const cols = [...columnsOf(lay(many(35, 'h'))).values()].map((c) => c.length);
    expect(cols).toEqual([12, 12, 11]);
  });

  it('never splits a run of copies across two columns', () => {
    // 7 singles, then 3 copies of one card, then 8 singles = 18. The deck
    // builder balances on whole entries: the triple joins column 1 (10) and
    // the rest make column 2 (8).
    const out = lay([...many(7, 'a'), ...many(3, 'c', { cardName: 'Copy' }), ...many(8, 'z')]);
    const cols = [...columnsOf(out).values()];
    expect(cols.map((c) => c.length)).toEqual([10, 8]);
    expect(cols[0].slice(7)).toEqual(['c0', 'c1', 'c2']);
  });

  it('emits ids column by column, top to bottom, so later ids paint on top', () => {
    const out = lay([...many(2, 'h'), ...many(2, 'e', { type: 'EE' })]);
    const pos = out.orderedIds.map((id) => out.positions[id]);
    expect(pos[0].posX).toBe(pos[1].posX);
    expect(pos[1].posY).toBeGreaterThan(pos[0].posY);
    expect(pos[2].posX).toBeGreaterThan(pos[1].posX);
    expect(pos[2].posY).toBe(pos[0].posY);
  });

  it('tightens the column pitch below card width when the zone is narrow', () => {
    const zone: ZoneRect = { x: 0, y: 0, width: 300, height: 3000, label: 'T' };
    const out = lay([
      makeCard({ instanceId: 'h', type: 'Hero' }),
      makeCard({ instanceId: 'g', type: 'GE' }),
      makeCard({ instanceId: 'e', type: 'EE' }),
    ], [], zone);
    const availW = zone.width - 16;
    const pitch = (availW - CARD_W) / 2; // 82 < 120
    expect(pitch).toBeLessThan(CARD_W);
    expect(out.positions.g.posX - out.positions.h.posX).toBeCloseTo(pitch);
    expect(out.positions.e.posX + CARD_W).toBeLessThanOrEqual(zone.x + zone.width - 8);
  });

  it('tightens the strip when a full column would overflow the zone height', () => {
    const zone: ZoneRect = { x: 0, y: 0, width: 3000, height: 300, label: 'T' };
    const out = lay(many(17, 'h'), [], zone);
    const availH = zone.height - 32;
    const strip = (availH - CARD_H) / 16;
    expect(strip).toBeLessThan(STRIP);
    const ys = out.orderedIds.map((id) => out.positions[id].posY);
    expect(ys[1] - ys[0]).toBeCloseTo(strip);
    expect(ys[16] + CARD_H).toBeLessThanOrEqual(zone.y + zone.height - 8);
  });
});

describe('computeDeckSpreadLayout — reserve', () => {
  const GAP = Math.round(CARD_W * 0.14); // the deck builder's extra `ml-4` before the reserve

  it('puts the reserve in one sorted column after the main columns with an extra gap', () => {
    const main = [makeCard({ instanceId: 'h', type: 'Hero' }), makeCard({ instanceId: 'e', type: 'EE' })];
    // Reserve is sorted but NOT bucketed: raw type order puts 'GE' before 'Hero'.
    const reserve = [
      makeCard({ instanceId: 'r1', cardName: 'Aaron', type: 'Hero' }),
      makeCard({ instanceId: 'r2', cardName: 'Zed', type: 'GE' }),
    ];
    const out = lay(main, reserve);
    expect(out.orderedIds).toEqual(['h', 'e', 'r2', 'r1']);
    expect(out.positions.r2).toEqual({ posX: X0 + 2 * PITCH + GAP, posY: Y0 });
    expect(out.positions.r1).toEqual({ posX: X0 + 2 * PITCH + GAP, posY: Y0 + STRIP });
  });

  it('adds no gap when there is no main deck to separate from', () => {
    const out = lay([], [makeCard({ instanceId: 'r' })]);
    expect(out.positions.r).toEqual({ posX: X0, posY: Y0 });
  });

  it('splits a long reserve at 17 so the strip is not squeezed by one column', () => {
    const cols = [...columnsOf(lay([], many(20, 'r'))).values()].map((c) => c.length);
    expect(cols).toEqual([10, 10]);
  });

  it('counts the reserve gap when tightening the pitch to fit', () => {
    const zone: ZoneRect = { x: 0, y: 0, width: 300, height: 3000, label: 'T' };
    const main = [makeCard({ instanceId: 'h', type: 'Hero' }), makeCard({ instanceId: 'e', type: 'EE' })];
    const out = lay(main, [makeCard({ instanceId: 'r' })], zone);
    const availW = zone.width - 16;
    const pitch = (availW - CARD_W - GAP) / 2;
    expect(out.positions.e.posX - out.positions.h.posX).toBeCloseTo(pitch);
    expect(out.positions.r.posX).toBeCloseTo(8 + 2 * pitch + GAP);
    expect(out.positions.r.posX + CARD_W).toBeLessThanOrEqual(zone.x + zone.width - 8);
  });
});
