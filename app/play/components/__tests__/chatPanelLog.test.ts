import { describe, it, expect } from 'vitest';

import { formatActionType, nodeToText } from '../ChatPanel';

/**
 * Guards on the two pure pieces of the game log.
 *
 * `formatActionType` falls back to `actionType.toLowerCase().replace(/_/g,' ')`
 * for anything it doesn't know, which is silent: an unhandled type renders as
 * plausible-looking lowercase prose rather than throwing. That is how the
 * end-of-game line came to read "alice win" — the single most consequential
 * entry in the log, with the soul count that decided the game discarded.
 *
 * `nodeToText` is what search indexes, and it can only see props it knows
 * about. When it silently returned '' for multi-card lines, search claimed a
 * card had never been discarded.
 */

const asText = (node: ReturnType<typeof formatActionType>) => nodeToText(node);

describe('formatActionType — how the game ended', () => {
  it('renders a soul-goal win with the count and the goal for the format', () => {
    const out = asText(
      formatActionType('WIN', JSON.stringify({ winnerName: 'Alice', soulCount: 5, format: 'Limited' })),
    );
    expect(out).toContain('won the game');
    expect(out).toContain('5/5 souls rescued');
  });

  it('uses the T2 goal of 7 souls', () => {
    const out = asText(
      formatActionType('WIN', JSON.stringify({ winnerName: 'Alice', soulCount: 7, format: 'T2' })),
    );
    expect(out).toContain('7/7 souls rescued');
  });

  it('distinguishes the two TIMEOUT reasons, which are logged against opposite players', () => {
    // claimed_by_opponent is logged by the WINNER…
    expect(asText(formatActionType('TIMEOUT', JSON.stringify({ reason: 'claimed_by_opponent' }))))
      .toContain('won the game');
    // …and disconnect_timeout by the player who dropped.
    expect(asText(formatActionType('TIMEOUT', JSON.stringify({ reason: 'disconnect_timeout' }))))
      .toContain('lost the game');
  });

  it('never renders a bare snake-case action type for an end-of-game event', () => {
    for (const type of ['WIN', 'TIMEOUT', 'DISCONNECT_TIMEOUT_WARNING']) {
      // No payload at all — must still fall back to a label, not the raw type.
      const out = asText(formatActionType(type));
      expect(out).not.toBe(type.toLowerCase().replace(/_/g, ' '));
      expect(out.length).toBeGreaterThan(0);
    }
  });
});

describe('formatActionType — collapsed runs of a repeated action', () => {
  it('renders a draw run as one counted line', () => {
    const out = asText(
      formatActionType('DRAW_REPEAT', JSON.stringify({ count: 8, of: 'DRAW' })),
    );
    expect(out).toBe('drew 8 cards');
  });

  it('falls back rather than inventing a phrase for an unknown grouped type', () => {
    const out = asText(formatActionType('MYSTERY_REPEAT', JSON.stringify({ count: 3, of: 'MYSTERY' })));
    expect(out).not.toContain('3');
  });
});

describe('nodeToText — what search can actually find', () => {
  it('reads a single card name off a HoverableCard-style `name` prop', () => {
    const out = asText(
      formatActionType(
        'MOVE_CARD',
        JSON.stringify({ cardName: 'Angel at Shur (Wa)', cardImgFile: 'Angel_at_Shur_(Wa)', to: 'territory' }),
      ),
    );
    expect(out).toContain('Angel at Shur (Wa)');
  });

  it('reads every card out of a multi-card line', () => {
    // MOVE_CARDS_BATCH renders through CardNameList, which passes a `cards`
    // array and neither `name` nor `children` — it used to flatten to '', so
    // none of these names were searchable. Multi-card moves are the common
    // case on a phone (drag-select several, discard them at once).
    const out = asText(
      formatActionType(
        'MOVE_CARDS_BATCH',
        // Server shape (spacetimedb/src/index.ts): { name, img, from } per card.
        JSON.stringify({
          count: 2,
          toZone: 'discard',
          cards: [
            { name: 'Angel at Shur (Wa)', img: 'Angel_at_Shur_(Wa)', from: 'territory' },
            { name: 'Angel Chariots (Wa)', img: 'Angel_Chariots_(Wa)', from: 'territory' },
          ],
        }),
      ),
    );
    expect(out).toContain('Angel at Shur (Wa)');
    expect(out).toContain('Angel Chariots (Wa)');
  });
});

describe("formatActionType — Philip's Daughters", () => {
  it('reads the counts off a keep-one shuffle and draw', () => {
    const out = asText(
      formatActionType('KEEP_ONE_SHUFFLE_DRAW', JSON.stringify({ shuffled: 4, requestedShuffle: 4, drawn: 4, requestedDraw: 4 })),
    );
    expect(out).toContain('kept 1 card');
    expect(out).toContain('shuffled 4');
    expect(out).toContain('drew 4');
  });

  it('says why nothing was drawn on the shuffle-only variant', () => {
    const out = asText(
      formatActionType('KEEP_ONE_SHUFFLE_DRAW', JSON.stringify({ shuffled: 3, requestedShuffle: 3, drawn: 0, requestedDraw: 0, drawSkipped: true })),
    );
    expect(out).toContain('shuffled 3');
    expect(out).toContain('draw prevented');
    expect(out).not.toContain('drew 0');
  });

  it('describes the undo as a restore, never as bare snake case', () => {
    const out = asText(formatActionType('UNDO_KEEP_ONE_SHUFFLE_DRAW', JSON.stringify({ shuffled: 2, drawn: 2 })));
    expect(out).toContain('undid Philip’s Daughters');
    expect(out).toContain('2 cards back in hand');
    expect(asText(formatActionType('UNDO_KEEP_ONE_SHUFFLE_DRAW'))).not.toBe('undo keep one shuffle draw');
  });
});
