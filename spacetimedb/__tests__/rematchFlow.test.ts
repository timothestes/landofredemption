import { describe, it, expect } from 'vitest';
import { rematchRequestOutcome, pregameSinceMicros } from '../src/rematchFlow';

describe('rematchRequestOutcome', () => {
  it('records the first request', () => {
    expect(rematchRequestOutcome('', '', '0')).toBe('request');
    expect(rematchRequestOutcome('', '', '1')).toBe('request');
  });
  it('treats the other seat pressing Play Again as accepting', () => {
    expect(rematchRequestOutcome('0', '', '1')).toBe('accept');
    expect(rematchRequestOutcome('1', '', '0')).toBe('accept');
  });
  it('refuses a repeat from the seat already waiting', () => {
    expect(rematchRequestOutcome('0', '', '0')).toBe('duplicate');
  });
  it('refuses once the request has resolved', () => {
    expect(rematchRequestOutcome('0', 'accepted', '1')).toBe('duplicate');
  });
});

describe('pregameSinceMicros', () => {
  it('uses createdAt for a first game that never reached pre-game', () => {
    expect(pregameSinceMicros(1_000n, 0n)).toBe(1_000n);
  });
  it('uses the re-stamped choose deadline for a rematch on an old row', () => {
    const createdAt = 1_000n;
    const rematchDeadline = createdAt + 3_600_000_000n; // an hour-long first game
    expect(pregameSinceMicros(createdAt, rematchDeadline)).toBe(rematchDeadline);
  });
});
