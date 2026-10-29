import { describe, expect, it } from 'vitest';
import { nextAmber, rowKeyAction } from '../lib/walker';

describe('nextAmber', () => {
  const ids = ['a', 'b', 'c'];
  it('goes to the next id in order', () => {
    expect(nextAmber(ids, 'a')).toBe('b');
    expect(nextAmber(ids, 'b')).toBe('c');
  });
  it('wraps from the last to the first', () => {
    expect(nextAmber(ids, 'c')).toBe('a');
  });
  it('starts at the first with no current or an unknown one', () => {
    expect(nextAmber(ids, null)).toBe('a');
    expect(nextAmber(ids, 'zzz')).toBe('a');
  });
  it('is null when empty', () => {
    expect(nextAmber([], 'a')).toBeNull();
    expect(nextAmber([], null)).toBeNull();
  });
  it('stays on a lone id', () => {
    expect(nextAmber(['x'], 'x')).toBe('x');
  });
});

describe('rowKeyAction', () => {
  it.each([
    ['Enter', 'open'], ['+', 'inc'], ['=', 'inc'], ['-', 'dec'],
    ['Delete', 'remove'], ['Backspace', 'remove'], ['ArrowDown', 'next'], ['ArrowUp', 'prev'],
  ])('%s -> %s', (key, action) => {
    expect(rowKeyAction({ key })).toBe(action);
  });
  it('ignores other keys', () => {
    expect(rowKeyAction({ key: 'a' })).toBeNull();
  });
});
