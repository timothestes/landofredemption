import { describe, it, expect, vi } from 'vitest';

// MultiplayerCanvas.tsx is a `'use client'` Konva component, so importing it in
// the node test environment fails on react-konva's CJS/ESM interop (it require()s
// the ESM `konva` package). `isHandCardFaceVisible` is a pure exported function
// that touches none of that, so we stub only the react-konva entry point to let
// the module load. Nothing under test depends on the stub.
vi.mock('react-konva', () => ({
  Stage: () => null,
  Layer: () => null,
  Rect: () => null,
  Text: () => null,
  Group: () => null,
  Image: () => null,
}));

import {
  isHandCardFaceVisible,
  isFaceDownInPlayCardVisible,
  isRevealedReserveCard,
  canViewerToggleMeek,
  isBattleBandActive,
} from '../MultiplayerCanvas';

// Unit coverage for the hand-card visibility predicate that gates whether a
// hand card renders face-up for self / opponent / spectator viewers. This is
// the core of the spectator "share my hand" privacy model, so the false
// (hidden) cases matter as much as the visible ones.

const NOW = 1_000_000n;

/** A hand card with no per-card reveal flash. */
const plainCard = (id: bigint) => ({ id, revealExpiresAt: null });

/** A hand card whose per-card reveal flash is still active (expires after NOW). */
const flashingCard = (id: bigint) => ({
  id,
  revealExpiresAt: { microsSinceUnixEpoch: NOW + 1_000n },
});

/** A hand card whose per-card reveal flash has already expired. */
const expiredFlashCard = (id: bigint) => ({
  id,
  revealExpiresAt: { microsSinceUnixEpoch: NOW - 1_000n },
});

const owner = (over: Partial<{
  handRevealed: boolean;
  handRevealSnapshot: string;
  shareHandWithSpectators: boolean;
}> = {}) => ({
  handRevealed: false,
  handRevealSnapshot: '[]',
  shareHandWithSpectators: false,
  ...over,
});

describe('isHandCardFaceVisible', () => {
  describe("viewerKind 'self'", () => {
    it('always sees its own hand face-up, even with no owner', () => {
      expect(isHandCardFaceVisible(plainCard(1n), 'self', null, NOW)).toBe(true);
      expect(
        isHandCardFaceVisible(plainCard(1n), 'self', owner(), NOW),
      ).toBe(true);
    });
  });

  it('hides everything when the owner player is missing (non-self viewers)', () => {
    expect(
      isHandCardFaceVisible(flashingCard(1n), 'opponent', null, NOW),
    ).toBe(false);
    expect(
      isHandCardFaceVisible(flashingCard(1n), 'spectator', null, NOW),
    ).toBe(false);
  });

  describe('per-card reveal flash', () => {
    it('shows the card to an opponent while the flash is active', () => {
      expect(
        isHandCardFaceVisible(flashingCard(1n), 'opponent', owner(), NOW),
      ).toBe(true);
    });

    it('shows the card to a spectator while the flash is active', () => {
      expect(
        isHandCardFaceVisible(flashingCard(1n), 'spectator', owner(), NOW),
      ).toBe(true);
    });

    it('ignores an expired flash (falls through to the normal rules)', () => {
      expect(
        isHandCardFaceVisible(expiredFlashCard(1n), 'opponent', owner(), NOW),
      ).toBe(false);
      expect(
        isHandCardFaceVisible(expiredFlashCard(1n), 'spectator', owner(), NOW),
      ).toBe(false);
    });
  });

  describe("viewerKind 'opponent'", () => {
    it('hidden by default (not revealed, empty snapshot)', () => {
      expect(
        isHandCardFaceVisible(plainCard(1n), 'opponent', owner(), NOW),
      ).toBe(false);
    });

    it('visible only when handRevealed AND the card is in the snapshot', () => {
      expect(
        isHandCardFaceVisible(
          plainCard(1n),
          'opponent',
          owner({ handRevealed: true, handRevealSnapshot: '[1]' }),
          NOW,
        ),
      ).toBe(true);
    });

    it('hidden when revealed but the card is NOT in the snapshot', () => {
      expect(
        isHandCardFaceVisible(
          plainCard(2n),
          'opponent',
          owner({ handRevealed: true, handRevealSnapshot: '[1]' }),
          NOW,
        ),
      ).toBe(false);
    });

    it('hidden when in the snapshot but handRevealed is false', () => {
      expect(
        isHandCardFaceVisible(
          plainCard(1n),
          'opponent',
          owner({ handRevealed: false, handRevealSnapshot: '[1]' }),
          NOW,
        ),
      ).toBe(false);
    });

    it('does NOT use shareHandWithSpectators (that flag is spectator-only)', () => {
      expect(
        isHandCardFaceVisible(
          plainCard(1n),
          'opponent',
          owner({ shareHandWithSpectators: true }),
          NOW,
        ),
      ).toBe(false);
    });
  });

  describe("viewerKind 'spectator'", () => {
    it('hidden by default (not shared, empty snapshot)', () => {
      expect(
        isHandCardFaceVisible(plainCard(1n), 'spectator', owner(), NOW),
      ).toBe(false);
    });

    it('visible for ALL cards when shareHandWithSpectators is true', () => {
      const sharing = owner({ shareHandWithSpectators: true });
      expect(
        isHandCardFaceVisible(plainCard(1n), 'spectator', sharing, NOW),
      ).toBe(true);
      expect(
        isHandCardFaceVisible(plainCard(999n), 'spectator', sharing, NOW),
      ).toBe(true);
    });

    it('visible when the card is in the snapshot even if not sharing the whole hand', () => {
      expect(
        isHandCardFaceVisible(
          plainCard(7n),
          'spectator',
          owner({ shareHandWithSpectators: false, handRevealSnapshot: '[7]' }),
          NOW,
        ),
      ).toBe(true);
    });

    it('hidden when shareHandWithSpectators is undefined and snapshot empty', () => {
      // owner shape without the optional flag at all
      const noFlag = { handRevealed: false, handRevealSnapshot: '[]' };
      expect(
        isHandCardFaceVisible(plainCard(1n), 'spectator', noFlag, NOW),
      ).toBe(false);
    });
  });

  it('revealAll (solo) shows every card, even with no owner or reveal', () => {
    expect(isHandCardFaceVisible(plainCard(1n), 'opponent', owner(), NOW, true)).toBe(true);
    expect(isHandCardFaceVisible(plainCard(1n), 'opponent', null, NOW, true)).toBe(true);
    // Default stays false: two-human games are unchanged.
    expect(isHandCardFaceVisible(plainCard(1n), 'opponent', owner(), NOW)).toBe(false);
  });

  it('treats a malformed handRevealSnapshot as an empty set', () => {
    expect(
      isHandCardFaceVisible(
        plainCard(1n),
        'spectator',
        owner({ handRevealSnapshot: 'not-json' }),
        NOW,
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isFaceDownInPlayCardVisible — gates hover-preview of FACE-DOWN in-play cards.
// The caller handles face-up / actively-revealed cards; this only decides
// whether a face-down card's identity may leak to the viewer.
// ---------------------------------------------------------------------------

const NEITHER = { myShareHand: false, oppShareHand: false };

describe('isFaceDownInPlayCardVisible', () => {
  describe("viewerKind 'player'", () => {
    it('sees its own face-down card (player1), regardless of share flags', () => {
      expect(isFaceDownInPlayCardVisible('player', 'player1', NEITHER)).toBe(true);
      expect(
        isFaceDownInPlayCardVisible('player', 'player1', {
          myShareHand: true,
          oppShareHand: true,
        }),
      ).toBe(true);
    });

    it("never sees the opponent's face-down card (player2)", () => {
      expect(isFaceDownInPlayCardVisible('player', 'player2', NEITHER)).toBe(false);
      // Share flags are a spectator concept and must not affect the player view.
      expect(
        isFaceDownInPlayCardVisible('player', 'player2', {
          myShareHand: true,
          oppShareHand: true,
        }),
      ).toBe(false);
    });
  });

  it("revealAll (solo) shows the opponent's face-down card", () => {
    expect(isFaceDownInPlayCardVisible('player', 'player2', NEITHER, true)).toBe(true);
    expect(isFaceDownInPlayCardVisible('player', 'player2', NEITHER)).toBe(false);
  });

  describe("viewerKind 'spectator'", () => {
    it('hidden for both seats by default (nobody sharing)', () => {
      expect(isFaceDownInPlayCardVisible('spectator', 'player1', NEITHER)).toBe(false);
      expect(isFaceDownInPlayCardVisible('spectator', 'player2', NEITHER)).toBe(false);
    });

    it("sees seat0's (player1) card only when seat0 shares", () => {
      expect(
        isFaceDownInPlayCardVisible('spectator', 'player1', {
          myShareHand: true,
          oppShareHand: false,
        }),
      ).toBe(true);
      // seat1 sharing must not expose seat0.
      expect(
        isFaceDownInPlayCardVisible('spectator', 'player1', {
          myShareHand: false,
          oppShareHand: true,
        }),
      ).toBe(false);
    });

    it("sees seat1's (player2) card only when seat1 shares", () => {
      expect(
        isFaceDownInPlayCardVisible('spectator', 'player2', {
          myShareHand: false,
          oppShareHand: true,
        }),
      ).toBe(true);
      expect(
        isFaceDownInPlayCardVisible('spectator', 'player2', {
          myShareHand: true,
          oppShareHand: false,
        }),
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// canViewerToggleMeek — any player may toggle meek (own or opponent's card);
// spectators are read-only.
// ---------------------------------------------------------------------------

describe('canViewerToggleMeek', () => {
  it('allows a player (their own or an opponent card)', () => {
    expect(canViewerToggleMeek('player')).toBe(true);
  });

  it('forbids a spectator (read-only)', () => {
    expect(canViewerToggleMeek('spectator')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isBattleBandActive — the Field of Battle band only opens during a live game.
// A concede mid-battle flips status to 'finished' without clearing the phase or
// battleState, so the status gate is what closes the band.
// ---------------------------------------------------------------------------

describe('isBattleBandActive', () => {
  it('open while playing and in the battle phase', () => {
    expect(isBattleBandActive('playing', 'battle', '')).toBe(true);
  });

  it('open while playing and a battle is resolving (battleState set, phase moved on)', () => {
    expect(isBattleBandActive('playing', 'main', 'awaiting-soul')).toBe(true);
  });

  it('closed while playing with no battle', () => {
    expect(isBattleBandActive('playing', 'main', '')).toBe(false);
  });

  it('closed once finished even if phase/battleState were never cleared (concede mid-battle)', () => {
    expect(isBattleBandActive('finished', 'battle', 'active')).toBe(false);
  });

  it('closed while waiting (pre-game)', () => {
    expect(isBattleBandActive('waiting', 'battle', 'active')).toBe(false);
  });
});

describe('isRevealedReserveCard', () => {
  it('shows every reserve card, flipped or not, once the reserve is revealed', () => {
    expect(isRevealedReserveCard({ zone: 'reserve' }, true)).toBe(true);
  });
  it('does not reveal while the reserve is hidden', () => {
    expect(isRevealedReserveCard({ zone: 'reserve' }, false)).toBe(false);
  });
  it('never applies outside the reserve zone', () => {
    expect(isRevealedReserveCard({ zone: 'territory' }, true)).toBe(false);
  });
});
