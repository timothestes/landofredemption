import { describe, it, expect } from 'vitest';
import type { GameCard } from '@/app/shared/types/gameCard';
import { isReserveEnhancement } from '../ReserveEnhancementModal';

const card = (type: string, reference: string) => ({ type, reference }) as GameCard;

describe('isReserveEnhancement', () => {
  it('accepts GE and EE, including dual types', () => {
    expect(isReserveEnhancement(card('GE', 'Matthew 5:9'))).toBe(true);
    expect(isReserveEnhancement(card('EE', 'Matthew 5:9'))).toBe(true);
    expect(isReserveEnhancement(card('GE/Evil Character', 'Matthew 5:9'))).toBe(true);
  });

  it('rejects non-enhancements', () => {
    expect(isReserveEnhancement(card('Hero', 'Genesis 1:1'))).toBe(false);
    expect(isReserveEnhancement(card('Evil Character', 'Genesis 1:1'))).toBe(false);
  });

  it('with OT, keeps only enhancements whose reference is Old Testament', () => {
    expect(isReserveEnhancement(card('GE', 'Genesis 1:1'), 'OT')).toBe(true);
    expect(isReserveEnhancement(card('EE', 'II Kings 2:23'), 'OT')).toBe(true);
    expect(isReserveEnhancement(card('GE', 'Psalm 23:1'), 'OT')).toBe(true);
    expect(isReserveEnhancement(card('GE', 'Matthew 5:9'), 'OT')).toBe(false);
    expect(isReserveEnhancement(card('GE', ''), 'OT')).toBe(false);
  });

  it('with OT, accepts a dual-testament reference', () => {
    expect(isReserveEnhancement(card('GE', 'Matthew 4:4 (Deuteronomy 8:3)'), 'OT')).toBe(true);
  });
});
