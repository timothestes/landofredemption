import { describe, expect, it } from 'vitest';
import { CARDS } from '@/lib/cards/lookup';
import { lostSoulOptions, matchLostSouls, nicknameOf } from '../lib/lostSouls';

const all = CARDS.filter(c => c.type.includes('Lost Soul'));

describe('lostSoulOptions', () => {
  it('lists Rotation-legal Lost Soul printings by default', () => {
    const n = all.filter(c => c.legality === 'Rotation').length;
    expect(n).toBeGreaterThan(0);
    expect(lostSoulOptions(false)).toHaveLength(n);
    expect(lostSoulOptions(false).every(o => o.rotation)).toBe(true);
  });

  it('showAll adds every Lost Soul printing', () => {
    expect(lostSoulOptions(true)).toHaveLength(all.length);
  });

  it('sorts by nickname then reference', () => {
    const list = lostSoulOptions(true);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      const c = a.nickname.localeCompare(b.nickname) || a.reference.localeCompare(b.reference);
      expect(c).toBeLessThanOrEqual(0);
    }
  });
});

describe('nicknameOf', () => {
  it('takes the quoted word', () => {
    expect(nicknameOf('Lost Soul "Accusers" [Ezra 4:6]')).toBe('Accusers');
  });
  it('is empty for a plain name', () => {
    expect(nicknameOf('Lost Soul [Luke 8:2]')).toBe('');
  });
});

describe('matchLostSouls', () => {
  const opts = lostSoulOptions(true);
  it('matches nickname, reference and set, ignoring case', () => {
    const nick = opts.find(o => o.nickname)!;
    expect(matchLostSouls(nick.nickname.toUpperCase(), opts).some(o => o.key === nick.key)).toBe(true);
    const ref = opts.find(o => o.reference)!;
    expect(matchLostSouls(ref.reference.toLowerCase(), opts).some(o => o.key === ref.key)).toBe(true);
    const set = opts[0];
    expect(matchLostSouls(set.set.toLowerCase(), opts).some(o => o.key === set.key)).toBe(true);
  });
  it('returns everything for a blank query and nothing for gibberish', () => {
    expect(matchLostSouls('  ', opts)).toHaveLength(opts.length);
    expect(matchLostSouls('zzzqqq', opts)).toHaveLength(0);
  });
});
