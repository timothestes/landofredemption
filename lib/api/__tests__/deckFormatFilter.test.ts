import { describe, it, expect } from 'vitest';
import { deckFamilyFilterFor } from '../cache';
describe('deckFamilyFilterFor', () => {
  it('T1 covers Limited, Unlimited, Teams and null', () =>
    expect(deckFamilyFilterFor('T1')).toEqual({ kind: 'or', clause: 'format.is.null,format.in.(Type 1,Limited,Unlimited,Classic,Teams)' }));
  it('T2 and Paragon match deckFormatFilterFor', () => {
    expect(deckFamilyFilterFor('T2')).toEqual({ kind: 'in', values: ['Type 2', 'T2'] });
    expect(deckFamilyFilterFor('Paragon')).toEqual({ kind: 'eq', value: 'Paragon' });
  });
});
