import { describe, it, expect } from 'vitest';
// Lives outside spacetimedb/src (the module's tsconfig `include`) so its vitest
// import is never pulled into `spacetime publish`; root vitest still runs it via
// the **/__tests__/** glob.
import { resolveDestinationOwnerId, resolveHomeOwnerId } from '../src/cardOwnership';

const ME = 1n;
const OPP = 2n;
/** originalOwnerId sentinel for "this card has never changed hands". */
const UNSET = 0n;

describe('resolveDestinationOwnerId', () => {
  describe('graveyard piles belong to the card owner', () => {
    // The reported bug: peeking the top 3 of the OPPONENT's deck and
    // right-click → Reserve put their card in MY reserve. A card leaving its
    // owner's deck goes to that owner's pile — the actor never gains it.
    it("sends an opponent's deck card to the opponent's reserve, not mine", () => {
      expect(
        resolveDestinationOwnerId({
          ownerId: OPP,
          originalOwnerId: UNSET,
          fromZone: 'deck',
          toZone: 'reserve',
          actorId: ME,
          targetOwnerId: null,
        }),
      ).toBe(OPP);
    });

    it.each(['discard', 'banish'])(
      "sends an opponent's deck card to the opponent's %s",
      (toZone) => {
        expect(
          resolveDestinationOwnerId({
            ownerId: OPP,
            originalOwnerId: UNSET,
            fromZone: 'deck',
            toZone,
            actorId: ME,
            targetOwnerId: null,
          }),
        ).toBe(OPP);
      },
    );

    // Dragging an opponent's card onto my own reserve pile is still their card
    // leaving play, so it goes home rather than defecting to my pile.
    it("keeps an opponent's card home even when dropped on my reserve", () => {
      expect(
        resolveDestinationOwnerId({
          ownerId: OPP,
          originalOwnerId: UNSET,
          fromZone: 'deck',
          toZone: 'reserve',
          actorId: ME,
          targetOwnerId: ME,
        }),
      ).toBe(OPP);
    });

    it('sends my own deck card to my reserve', () => {
      expect(
        resolveDestinationOwnerId({
          ownerId: ME,
          originalOwnerId: UNSET,
          fromZone: 'deck',
          toZone: 'reserve',
          actorId: ME,
          targetOwnerId: null,
        }),
      ).toBe(ME);
    });

    // A captured hero sitting in my territory still banishes to its real
    // owner's pile.
    it('returns a captured card to its original owner when it leaves play', () => {
      expect(
        resolveDestinationOwnerId({
          ownerId: ME,
          originalOwnerId: OPP,
          fromZone: 'territory',
          toZone: 'banish',
          actorId: ME,
          targetOwnerId: null,
        }),
      ).toBe(OPP);
    });
  });

  describe('taking from an opponent hidden zone', () => {
    // The "taking" exception survives for hand — that is what makes cards like
    // "take the top card of the opponent's deck into your hand" work.
    it("takes the opponent's top deck card into my hand", () => {
      expect(
        resolveDestinationOwnerId({
          ownerId: OPP,
          originalOwnerId: UNSET,
          fromZone: 'deck',
          toZone: 'hand',
          actorId: ME,
          targetOwnerId: null,
        }),
      ).toBe(ME);
    });

    it('honors an explicit drop on the opponent hand (giving a card away)', () => {
      expect(
        resolveDestinationOwnerId({
          ownerId: ME,
          originalOwnerId: UNSET,
          fromZone: 'hand',
          toZone: 'hand',
          actorId: ME,
          targetOwnerId: OPP,
        }),
      ).toBe(OPP);
    });
  });

  describe('explicit drops and shared zones', () => {
    it('honors an explicit Land of Bondage drop over home routing', () => {
      expect(
        resolveDestinationOwnerId({
          ownerId: OPP,
          originalOwnerId: UNSET,
          fromZone: 'territory',
          toZone: 'land-of-bondage',
          actorId: ME,
          targetOwnerId: ME,
        }),
      ).toBe(ME);
    });

    // The reported bug: the opponent dragged their warrior (weapon attached,
    // both theirs) into MY Land of Bondage to hand over a captured hero. The
    // batch reducer redirects the riding weapon to Discard, but routed its
    // owner against the LoB drop — so the explicit-drop rule gave the weapon
    // to me. Once the reducer routes against the weapon's real landing zone
    // (Discard), the graveyard rule sends it home to its owner's pile.
    it("sends a captured hero's weapon to its owner's discard, not the captor's", () => {
      expect(
        resolveDestinationOwnerId({
          ownerId: OPP,
          originalOwnerId: UNSET,
          fromZone: 'territory',
          toZone: 'discard',
          actorId: OPP,
          targetOwnerId: ME,
        }),
      ).toBe(OPP);
    });

    it('keeps the current owner when moving within shared table zones', () => {
      expect(
        resolveDestinationOwnerId({
          ownerId: OPP,
          originalOwnerId: UNSET,
          fromZone: 'territory',
          toZone: 'battle',
          actorId: ME,
          targetOwnerId: null,
        }),
      ).toBe(OPP);
    });
  });
});

describe('resolveHomeOwnerId', () => {
  it('routes a card taken from an opponent hidden zone to the actor', () => {
    expect(
      resolveHomeOwnerId({
        ownerId: OPP,
        originalOwnerId: UNSET,
        fromZone: 'deck',
        toZone: 'hand',
        actorId: ME,
        targetOwnerId: null,
      }),
    ).toBe(ME);
  });

  it('routes a card leaving a public zone to its true owner', () => {
    expect(
      resolveHomeOwnerId({
        ownerId: ME,
        originalOwnerId: OPP,
        fromZone: 'territory',
        toZone: 'discard',
        actorId: ME,
        targetOwnerId: null,
      }),
    ).toBe(OPP);
  });
});
