/**
 * Pure queue for the Lost Soul cinematic. One batch plays at a time; batches
 * that arrive while one is on screen wait their turn. No React / DOM imports
 * so it is unit-testable — `useLostSoulCinematic` wraps it with the timers.
 */

export interface SoulCinematicCard {
  instanceId: string;
  cardName: string;
  /**
   * Fully-resolved image URL, ready to drop into `<img src>`. The caller
   * resolves it (`resolveCardImageUrl` for Forge refs, `getCardImageUrl` for
   * official cards) so the cinematic stays image-source agnostic. Empty
   * string when no image is available.
   */
  imageUrl: string;
}

export interface SoulCinematicBatch {
  id: string;
  souls: SoulCinematicCard[];
}

export interface CinematicQueueState {
  active: SoulCinematicBatch | null;
  queued: SoulCinematicBatch[];
}

export const EMPTY_CINEMATIC_QUEUE: CinematicQueueState = { active: null, queued: [] };

/**
 * Add a batch. Plays immediately when the stage is free, otherwise queues
 * behind the active batch. Returns the same state object (no re-render) when
 * the setting is off or the batch has no souls.
 */
export function enqueueCinematicBatch(
  state: CinematicQueueState,
  batch: SoulCinematicBatch,
  enabled: boolean,
): CinematicQueueState {
  if (!enabled || batch.souls.length === 0) return state;
  if (state.active) return { active: state.active, queued: [...state.queued, batch] };
  return { active: batch, queued: state.queued };
}

/** The active batch finished: promote the next queued one, or clear the stage. */
export function advanceCinematicQueue(state: CinematicQueueState): CinematicQueueState {
  if (!state.active && state.queued.length === 0) return state;
  const [next = null, ...rest] = state.queued;
  return { active: next, queued: rest };
}
