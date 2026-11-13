import { describe, expect, it } from 'vitest';
import { CARDS } from '@/lib/cards/lookup';
import { lostSoulOptions, matchLostSouls, nicknameOf } from '../lib/lostSouls';

const all = CARDS.filter(c => c.type === 'Lost Soul');

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

  it('never lists a Lost Soul Token', () => {
    expect(CARDS.some(c => c.type === 'Lost Soul Token')).toBe(true);
    expect(lostSoulOptions(true).some(o => /token/i.test(o.name))).toBe(false);
  });

  it('gives every row a title, and no two rows the same two lines', () => {
    const list = lostSoulOptions(true);
    expect(list.every(o => o.title.trim() !== '')).toBe(true);
    const lines = list.map(o => `${o.title}|${o.detail}`);
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('lists named souls first, A to Z, then the ones known only by verse', () => {
    const list = lostSoulOptions(false);
    const firstBare = list.findIndex(o => !o.nickname);
    expect(list[0].nickname).not.toBe('');
    expect(list.slice(firstBare).every(o => !o.nickname)).toBe(true);
    const named = list.slice(0, firstBare).map(o => o.title);
    expect(named).toEqual([...named].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  });

  it('reads an old-style nickname from parentheses and the verse from the name', () => {
    const list = lostSoulOptions(true);
    expect(list.some(o => o.title === 'Hopper')).toBe(true);
    expect(list.find(o => o.name === 'Lost Soul (Daniel 9:7) [Fundraiser]')?.title).toBe('Daniel 9:7');
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
  const titles = (q: string, from = opts) => matchLostSouls(q, from).map(o => o.title);

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

  it('puts a nickname match first, even half typed', () => {
    expect(titles('shep')[0]).toBe('Shepherds');
    expect(titles('lost soul shepherds')[0]).toBe('Shepherds');
  });

  it('finds a soul by its full set name and by "1 samuel"', () => {
    expect(matchLostSouls('fundraiser', opts).length).toBeGreaterThan(0);
    expect(titles('1 samuel 25:7')).toContain('Shepherds');
  });

  it('does not let two letters match ability text', () => {
    const rotation = lostSoulOptions(false);
    expect(matchLostSouls('nt', rotation).length).toBeLessThan(rotation.length / 3);
  });
});
