import { describe, it, expect } from 'vitest';
import { SCAN_JSON_SCHEMA, SCAN_INSTRUCTION, PROMPT_HASH, capDetection, parseScanOutput } from '../schema';
const walk = (node: any, visit: (n: any) => void) => { if (!node || typeof node !== 'object') return; visit(node); for (const v of Object.values(node)) walk(v, visit); };
describe('schema', () => {
  it('every object forbids extra properties and lists all required keys', () => {
    walk(SCAN_JSON_SCHEMA, n => { if (n.type === 'object') { expect(n.additionalProperties).toBe(false); expect(Object.keys(n.properties).sort()).toEqual([...n.required].sort()); } });
  });
  it('carries no bounds the API rejects', () => walk(SCAN_JSON_SCHEMA, n => { for (const k of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems']) expect(n[k]).toBeUndefined(); }));
  it('has the v1.0 fields and not the rejected ones', () => {
    const props = (SCAN_JSON_SCHEMA as any).properties.cards.items.properties;
    for (const k of ['abilityEnd', 'promoText', 'illustrator', 'copyrightYear']) expect(props[k]).toBeTruthy();
    for (const k of ['border', 'setIcon']) expect(props[k]).toBeUndefined();
    expect(SCAN_INSTRUCTION).not.toMatch(/alternate-border|set symbol/);
  });
  it('hash is stable and 12 hex chars', () => expect(PROMPT_HASH).toMatch(/^[0-9a-f]{12}$/));
});
describe('capDetection / parseScanOutput', () => {
  it('caps and coerces', () => { const d = capDetection({ title: 'x'.repeat(100), type: 'Dragon', confidence: 'certain', grid: { row: 1, col: 1 } } as any); expect(d.title!.length).toBe(60); expect(d.type).toBe('unknown'); expect(d.confidence).toBe('low'); });
  it('rejects malformed output', () => { expect(parseScanOutput('not json')).toBeNull(); expect(parseScanOutput('{"photoQuality":"ok","cards":"nope"}')).toBeNull(); expect(parseScanOutput('{"photoQuality":"ok","cards":[]}')).toEqual({ photoQuality: 'ok', cards: [] }); });
  it('nulls non-string and missing input, defaults orientation and grid', () => {
    const d = capDetection({ title: 5, reference: undefined, orientation: 'sideways', grid: { row: 'a', col: 2.7 } } as any);
    expect(d.title).toBeNull(); expect(d.reference).toBeNull(); expect(d.strength).toBeNull();
    expect(d.orientation).toBe('upright'); expect(d.grid).toEqual({ row: 1, col: 2 });
    expect(capDetection({} as any).grid).toEqual({ row: 1, col: 1 });
  });
  it('caps each field per FIELD_CAPS', () => {
    const d = capDetection({ promoText: 'p'.repeat(200), copyrightYear: '20255', abilityEnd: 'a'.repeat(99), nickname: 'n'.repeat(99) } as any);
    expect([d.promoText!.length, d.copyrightYear!.length, d.abilityEnd!.length, d.nickname!.length]).toEqual([120, 4, 80, 30]);
  });
  it('parse rejects non-object cards and missing grid, and caps valid cards', () => {
    expect(parseScanOutput('{"photoQuality":"ok","cards":[1]}')).toBeNull();
    expect(parseScanOutput('{"photoQuality":"ok","cards":[{"title":"x"}]}')).toBeNull();
    expect(parseScanOutput('null')).toBeNull();
    const r = parseScanOutput(JSON.stringify({ photoQuality: 'ok', cards: [{ title: 't'.repeat(90), grid: { row: 1, col: 1 } }] }));
    expect(r!.cards[0].title!.length).toBe(60);
  });
});
