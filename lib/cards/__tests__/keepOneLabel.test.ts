import { describe, it, expect } from 'vitest';
import { abilityLabel, getAbilitiesForCard } from '../cardAbilities';

describe("Philip's Daughters menu items", () => {
  it('offers the printed effect and a draw-prevented variant as two distinct labels', () => {
    const labels = getAbilitiesForCard('Philip’s Daughters [RR2]').map(abilityLabel);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatch(/draw that many/);
    expect(labels[1]).toMatch(/^Draw prevented/);
    expect(labels[1]).toMatch(/no draw/);
    expect(new Set(labels).size).toBe(2);
  });
});
