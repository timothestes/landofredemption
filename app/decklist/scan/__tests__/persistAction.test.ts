import { describe, expect, it } from 'vitest';
import { deckTrayReducer, initialDeckTray } from '../lib/deckTrayReducer';
import { persistAction } from '../hooks/useDeckTray';

describe('persistAction', () => {
  it('writes while editing or saving, clears once saved', () => {
    const s = initialDeckTray('u1');
    expect(persistAction(s)).toBe('write');
    const saving = deckTrayReducer(s, { type: 'saving' });
    expect(persistAction(saving)).toBe('write');
    expect(persistAction(deckTrayReducer(saving, { type: 'saved', deckId: 'd1' }))).toBe('clear');
    expect(persistAction(deckTrayReducer(saving, { type: 'saveFailed' }))).toBe('write');
  });
});
