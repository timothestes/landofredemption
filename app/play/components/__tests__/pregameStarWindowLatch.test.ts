import { describe, it, expect } from 'vitest';
import { hadStarsThisWindow } from '../PregameRail';

// The star window's empty-hand timer must only arm for a hand that never held
// a star during the window. A hand that HAD a star and now reads empty is a
// player mid-action — the star left by drag or ability, not by absence — and
// a timer firing there answered "no stars" and skipped the seat ahead to the
// Lost Souls step (the bug this latch exists to prevent).

describe('hadStarsThisWindow', () => {
  it('is false while my star window is closed, whatever the hand holds', () => {
    expect(hadStarsThisWindow(false, false, 0)).toBe(false);
    expect(hadStarsThisWindow(false, false, 2)).toBe(false);
  });

  it('stays false for an open window whose hand never held a star', () => {
    expect(hadStarsThisWindow(false, true, 0)).toBe(false);
  });

  it('latches once a star is seen in hand during the open window', () => {
    expect(hadStarsThisWindow(false, true, 1)).toBe(true);
  });

  it('stays latched after the last star is dragged out of hand', () => {
    const latched = hadStarsThisWindow(false, true, 1);
    expect(hadStarsThisWindow(latched, true, 0)).toBe(true);
  });

  it('resets when the window closes, so the next window starts clean', () => {
    const latched = hadStarsThisWindow(false, true, 1);
    expect(hadStarsThisWindow(latched, false, 0)).toBe(false);
  });
});
