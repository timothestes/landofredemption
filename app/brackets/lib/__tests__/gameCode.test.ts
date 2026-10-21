import { describe, it, expect } from 'vitest';
import { generateGameCode } from '../gameCode';
describe('generateGameCode', () => {
  it('is six characters from the unambiguous alphabet', () => {
    const code = generateGameCode();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });
  it('is deterministic for a fixed random source', () => {
    expect(generateGameCode(() => 0)).toBe('AAAAAA');
  });
});
