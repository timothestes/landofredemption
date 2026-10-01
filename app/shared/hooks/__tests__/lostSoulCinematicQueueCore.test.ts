import { describe, it, expect } from 'vitest';
import {
  EMPTY_CINEMATIC_QUEUE,
  enqueueCinematicBatch,
  advanceCinematicQueue,
  type SoulCinematicBatch,
} from '../lostSoulCinematicQueueCore';

const batch = (id: string, n = 1): SoulCinematicBatch => ({
  id,
  souls: Array.from({ length: n }, (_, i) => ({
    instanceId: `${id}-s${i}`,
    cardName: 'Lost Soul',
    imageUrl: '',
  })),
});

describe('enqueueCinematicBatch', () => {
  it('plays the batch immediately when nothing is active', () => {
    const next = enqueueCinematicBatch(EMPTY_CINEMATIC_QUEUE, batch('a'), true);
    expect(next.active?.id).toBe('a');
    expect(next.queued).toEqual([]);
  });

  it('queues behind an active batch instead of replacing it', () => {
    const playing = enqueueCinematicBatch(EMPTY_CINEMATIC_QUEUE, batch('a'), true);
    const next = enqueueCinematicBatch(playing, batch('b'), true);
    expect(next.active?.id).toBe('a');
    expect(next.queued.map(b => b.id)).toEqual(['b']);
  });

  it('is a no-op when the setting is OFF', () => {
    const next = enqueueCinematicBatch(EMPTY_CINEMATIC_QUEUE, batch('a'), false);
    expect(next).toBe(EMPTY_CINEMATIC_QUEUE);
  });

  it('ignores an empty batch', () => {
    const next = enqueueCinematicBatch(EMPTY_CINEMATIC_QUEUE, batch('a', 0), true);
    expect(next).toBe(EMPTY_CINEMATIC_QUEUE);
  });
});

describe('advanceCinematicQueue', () => {
  it('promotes the next queued batch when the active one finishes', () => {
    let s = enqueueCinematicBatch(EMPTY_CINEMATIC_QUEUE, batch('a'), true);
    s = enqueueCinematicBatch(s, batch('b'), true);
    s = enqueueCinematicBatch(s, batch('c'), true);
    s = advanceCinematicQueue(s);
    expect(s.active?.id).toBe('b');
    expect(s.queued.map(b => b.id)).toEqual(['c']);
  });

  it('clears the stage when nothing is queued', () => {
    const s = advanceCinematicQueue(enqueueCinematicBatch(EMPTY_CINEMATIC_QUEUE, batch('a'), true));
    expect(s.active).toBeNull();
    expect(s.queued).toEqual([]);
  });

  it('is a no-op on an idle queue', () => {
    expect(advanceCinematicQueue(EMPTY_CINEMATIC_QUEUE)).toBe(EMPTY_CINEMATIC_QUEUE);
  });
});
