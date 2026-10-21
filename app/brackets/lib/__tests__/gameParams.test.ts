import { afterEach, describe, expect, it, vi } from 'vitest';
import { stdbFormatFor, writeSoloGameParams, type BracketGameParams } from '../gameParams';

const bracketParams: BracketGameParams = {
  gameId: 'g1', bracketId: 'br1', matchId: 'm1', gameNumber: 1, bestOf: 3,
  mode: 'solo', entryAId: 'ea', entryBId: 'eb', deckAName: 'Alpha', deckBName: 'Beta', returnTo: '/brackets/br1',
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('gameParams', () => {
  it('writes the solo params under the play client key', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { setItem: (k: string, v: string) => store.set(k, v) });
    writeSoloGameParams('ABC234', { deckAId: 'a', deckBId: 'b', displayName: 'Tim', supabaseUserId: 'u', format: 'Type 1', firstSeat: 1, bracket: bracketParams });
    const parsed = JSON.parse(store.get('stdb_game_params_ABC234')!);
    expect(parsed).toMatchObject({ role: 'solo', deckId: 'a', soloDeckBId: 'b', firstSeat: 1, format: 'Type 1' });
    expect(parsed.bracket.matchId).toBe(bracketParams.matchId);
  });
  it('maps families to the play format strings', () => { expect(stdbFormatFor('T1')).toBe('Type 1'); expect(stdbFormatFor('T2')).toBe('Type 2'); });
});
