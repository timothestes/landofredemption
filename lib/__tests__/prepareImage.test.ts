import { describe, it, expect } from 'vitest';
import { fitWithin } from '../prepareImage';

describe('fitWithin', () => {
  it('scales landscape to the max edge', () => {
    expect(fitWithin(4032, 3024, 2576)).toEqual({ w: 2576, h: 1932 });
  });
  it('scales portrait', () => {
    expect(fitWithin(3024, 4032, 2576)).toEqual({ w: 1932, h: 2576 });
  });
  it('leaves small images unchanged', () => {
    expect(fitWithin(1000, 800, 2576)).toEqual({ w: 1000, h: 800 });
  });
});
