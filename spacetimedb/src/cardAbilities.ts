// spacetimedb/src/cardAbilities.ts
// -----------------------------------------------------------------------------
// DUPLICATE of lib/cards/cardAbilities.ts — keep in sync.
// The SpacetimeDB module's tsconfig has rootDir: './src' and cannot reach the
// app's lib/. A parity test in lib/cards/__tests__/cardAbilities.test.ts
// (added by Task 11) asserts the two copies stay aligned.
// Precedent: soul-defs duplication documented in commit 3035dd5.
//
// TOKEN_CARD_DATA below hardcodes the metadata for the 5 token cards that v1
// spawns. Same reason — the server can't import findCard() or the CARDS
// dataset. If the registry grows to reference a new token, add its metadata
// to TOKEN_CARD_DATA here (and it must also exist in lib/cards/generated/
// cardData.ts, which the lib-side registry test verifies).
// -----------------------------------------------------------------------------

// Zone ids as strings (matches the stringified zone column on CardInstance).
// Kept local — no import from shared types.
type ZoneId = string;

type AbilityBase = { sourceZones?: ZoneId[] };

export const DEFAULT_ABILITY_SOURCE_ZONES: ReadonlyArray<ZoneId> = [
  'territory', 'land-of-bondage', 'land-of-redemption', 'battle',
];

export type CardAbility = AbilityBase & (
  // `cyclingTokenNames` + `cyclingAllowedUsers`: easter egg — when both are set
  // and the activating player's displayName (lowercased) is in cyclingAllowedUsers,
  // the spawn cycles through cyclingTokenNames instead of spawning `tokenName`.
  // Cycle index is derived from how many of those tokens the player already has
  // in play, so no extra state is stored. Everyone else gets `tokenName`.
  // `spawnForOpponent` places the token(s) in the OPPONENT's copy of
  // `defaultZone` (owned by the opponent) instead of the caster's — e.g. Lost
  // Soul "Harvest" creates its token in an opponent's Land of Bondage.
  | { type: 'spawn_token'; tokenName: string; count?: number; defaultZone?: ZoneId; spawnForOpponent?: boolean; cyclingTokenNames?: string[]; cyclingAllowedUsers?: string[] }
  | { type: 'shuffle_and_draw'; shuffleCount: number; drawCount: number }
  | { type: 'all_players_shuffle_and_draw'; shuffleCount: number; drawCount: number }
  // Philip's Daughters: each player keeps 1 card of their choice, shuffles the
  // rest of their hand into their deck, then draws that many back. Unlike
  // all_players_shuffle_and_draw the counts aren't printed — they're whatever
  // each hand happens to hold — so both sides pick their keeper in a modal
  // before anything moves.
  | { type: 'all_players_keep_one_shuffle_draw' }
  | { type: 'reveal_own_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'look_at_own_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  // Player-chosen-count variant of look_at_own_deck (e.g. Angel of the Harvest's
  // "look at top X, limit 7"). The menu opens a count prompt seeded with
  // defaultCount and capped at maxCount; like look_at_own_deck it's modal-driven
  // client-side (intercepted in the canvas, never routed through the reducer).
  | { type: 'look_at_own_deck_choose'; position: 'top' | 'bottom' | 'random'; defaultCount: number; maxCount: number }
  // The remaining three cells of the choose grid (own/opponent × look/reveal,
  // plus discard). Cards printing "top X" where X is a board-state count you
  // control — "X = # of your Armor of God Enhancements" — with a printed or
  // card-pool-derived cap. All four choose types are dispatched CLIENT-side
  // like look_at_own_deck_choose: the menu opens a count prompt, then the
  // canvas either opens the peek locally (own deck) or forwards the chosen
  // count through the existing opponent-consent flow, whose request payload
  // already carries an arbitrary count. No reducer is involved.
  | { type: 'reveal_own_deck_choose'; position: 'top' | 'bottom' | 'random'; defaultCount: number; maxCount: number }
  | { type: 'look_at_opponent_deck_choose'; position: 'top' | 'bottom' | 'random'; defaultCount: number; maxCount: number }
  | { type: 'reveal_opponent_deck_choose'; position: 'top' | 'bottom' | 'random'; defaultCount: number; maxCount: number }
  | { type: 'discard_opponent_deck_choose'; position: 'top' | 'bottom' | 'random'; defaultCount: number; maxCount: number }
  | { type: 'look_at_opponent_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'reveal_opponent_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'discard_opponent_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'reserve_opponent_deck'; position: 'top' | 'bottom' | 'random'; count: number }
  | { type: 'reserve_top_of_deck'; count: number }
  | { type: 'draw_bottom_of_deck'; count: number }
  | { type: 'draw_bottom_of_deck_choose' }
  | { type: 'discard_bottom_of_deck' }
  | { type: 'underdeck_top_of_deck'; count: number }
  | { type: 'discard_characters_from_reserve'; target: 'self' | 'opponent' }
  | { type: 'set_card_outline'; color: 'good' | 'evil'; label: string }
  // Two/Three Liner: turning the Lost Soul sideways (90°) in the Land of
  // Bondage marks the first of its two required rescues; the opposite item
  // turns it upright again.
  | { type: 'set_rotation'; rotated: boolean; label: string }
  | { type: 'play_all_lost_souls' }
  // Creation of the World: "Take all Heroes having a Genesis reference out of
  // your draw pile and band them into the Field of Battle." `referenceBook` is
  // matched against the Hero's printed reference (see hasReferenceBook).
  // "Your" draw pile is the ACTIVATOR's, matching every other ability here —
  // execute_card_ability deliberately doesn't enforce ownership, so effects
  // route to whoever fired the menu item. Lands in the 'battle' band in
  // multiplayer (opening it if closed, exactly as a manual drag does);
  // goldfish has no battle zone, so it bands into Territory instead.
  | { type: 'band_heroes_from_deck'; referenceBook: string }
  | { type: 'three_nails_reset' }
  | { type: 'imitate_lost_soul' }
  | { type: 'draw_and_topdeck_self' }
  | { type: 'resurrect_heroes' }
  // Draw cards equal to the number of distinct brigades of a given alignment in
  // the opponent's revealed hand. `alignment: 'total'` counts all brigades
  // (Matthew); 'good'/'evil' count only that alignment. `limit` caps the draw
  // when the card prints one (e.g. Ahijah limit 3, Divining Damsel limit 6).
  // Count is computed client-side from the live reveal snapshot and drawn via
  // the alignment-agnostic matthew_draw_brigades reducer.
  | { type: 'draw_brigades'; alignment: 'good' | 'evil' | 'total'; limit?: number }
  // The Foretelling Angel (PC): "Play with top card of deck face up." A
  // persistent toggle, not a one-shot reveal — while on, the activator's top
  // deck card renders face up (and draggable) on the deck pile for everyone.
  // The card's "If it's a Daniel card, you may add it to hand" half lives in
  // the deck context menu, gated on this toggle being active (isDanielCard).
  | { type: 'toggle_top_deck_reveal' }
  | { type: 'custom'; reducerName: string; label: string }
);

export const CARD_ABILITIES: Record<string, CardAbility[]> = {
  'Two Possessed (GoC)':                                 [{ type: 'spawn_token', tokenName: 'Violent Possessor Token', count: 2 }],
  'The Accumulator (GoC)':                               [{ type: 'spawn_token', tokenName: 'Wicked Spirit Token', count: 7 }],
  'The Proselytizers (GoC)':                             [{ type: 'spawn_token', tokenName: 'Proselyte Token' }],
  'The Church of Christ (GoC)':                          [{ type: 'spawn_token', tokenName: 'Follower Token' }],
  // "You may create a Lost Soul token in opponent's Land of Bondage." The token
  // belongs in the OPPONENT's Land of Bondage, same as the Lost Soul "Harvest"
  // entries below — it was previously spawning into the caster's own territory.
  'Angel of the Harvest (GoC)':                          [{ type: 'spawn_token', tokenName: 'Harvest Soul Token', defaultZone: 'land-of-bondage', spawnForOpponent: true }, { type: 'look_at_own_deck_choose', position: 'top', defaultCount: 3, maxCount: 7 }],
  'The Heavenly Host (GoC)':                             [{ type: 'spawn_token', tokenName: 'Heavenly Host Token', cyclingTokenNames: ['Heavenly Host Token (Blue)', 'Heavenly Host Token (Purple)', 'Heavenly Host Token (Silver)'], cyclingAllowedUsers: ['jaychambers'] }],
  'Kingdom of the Divine':                               [{ type: 'spawn_token', tokenName: 'Daniel Soul Token' }],
  'Kingdom of the Divine [T2C AB]':                      [{ type: 'spawn_token', tokenName: 'Daniel Soul Token' }],
  'Lost Soul "Harvest" [John 4:35]':                     [{ type: 'spawn_token', tokenName: 'Harvest Soul Token', defaultZone: 'land-of-bondage', spawnForOpponent: true }],
  'Lost Soul "Harvest" [John 4:35] [2023 - 2nd Place]':  [{ type: 'spawn_token', tokenName: 'Harvest Soul Token', defaultZone: 'land-of-bondage', spawnForOpponent: true }],
  'Lost Soul "Imitate" [III John 1:11]':                 [{ type: 'imitate_lost_soul' }],
  'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]':     [{ type: 'imitate_lost_soul' }],
  'Lost Soul "The First" [Luke 13:30]':                  [{ type: 'draw_and_topdeck_self' }],
  'Lost Soul "Lost Souls" [Proverbs 2:16-17]':           [{ type: 'spawn_token', tokenName: 'Lost Souls Token' }],
  // "This card counts as two Lost Souls. It must be rescued twice." Turning
  // the card sideways in the Land of Bondage marks the first rescue; once in
  // the Land of Redemption it counts 2 (see lostSoulValue / checkAndApplyWin).
  'Lost Souls (Two Liner)':                              [{ type: 'set_rotation', rotated: true, label: 'Turn Sideways', sourceZones: ['land-of-bondage'] }, { type: 'set_rotation', rotated: false, label: 'Turn Upright', sourceZones: ['land-of-bondage'] }],
  'Lost Souls (Three Liner)':                            [{ type: 'set_rotation', rotated: true, label: 'Turn Sideways', sourceZones: ['land-of-bondage'] }, { type: 'set_rotation', rotated: false, label: 'Turn Upright', sourceZones: ['land-of-bondage'] }],
  'Mayhem':                                              [{ type: 'all_players_shuffle_and_draw', shuffleCount: 6, drawCount: 6 }],
  'Mayhem (2020 Promo)':                                 [{ type: 'all_players_shuffle_and_draw', shuffleCount: 6, drawCount: 6 }],
  'Mayhem [Fundraiser]':                                 [{ type: 'all_players_shuffle_and_draw', shuffleCount: 6, drawCount: 6 }],
  'Mayhem (FoM)':                                        [{ type: 'all_players_shuffle_and_draw', shuffleCount: 6, drawCount: 6 }],
  'Lost Soul "Lawless" [Hebrews 12:8]':                  [{ type: 'reveal_own_deck', position: 'top', count: 6 }],
  'Lost Soul "Lawless" [Hebrews 12:8] [2021 - 1st Place]': [{ type: 'reveal_own_deck', position: 'top', count: 6 }],
  'Lost Soul "Lawless" [Hebrews 12:8] [AB - CoW]':       [{ type: 'reveal_own_deck', position: 'top', count: 6 }],
  'The Ancient of Days':                                 [{ type: 'reveal_own_deck', position: 'top', count: 3 }],
  'The Ancient of Days [T2C AB]':                        [{ type: 'reveal_own_deck', position: 'top', count: 3 }],
  'Given from God':                                      [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'Given from God [T2C AB]':                             [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'Anna, the Widow (GoC)':                               [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'Vain Vision (PoC)':                                   [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Shimei (CoW AB)':                                     [{ type: 'look_at_own_deck', position: 'top', count: 4 }],
  'Shimei (CoW)':                                        [{ type: 'look_at_own_deck', position: 'top', count: 4 }],
  'Zeresh, Wife of Haman (Roots)':                       [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Chaldeans [T2C AB]':                                  [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Chaldeans [T2C]':                                     [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Laban, the Deal Breaker (Roots)':                     [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Divination [K]':                                      [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Divination (1st Print - K)':                          [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  // TxP reprint words it as "look at the top six cards of deck" — same peek,
  // then take one evil card; the return-order clause is manual either way.
  'Divination (TxP)':                                    [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'House of Samuel':                                     [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'Mount Sinai':                                         [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'Faith of Isaac':                                      [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'Faith of Isaac (CoW AB)':                             [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  // "If you control Noah's Ark, look at the top X cards of deck" — X = # of
  // flood survivors you control (player picks the count; 8 survivors max).
  'Japheth':                                             [{ type: 'look_at_own_deck_choose', position: 'top', defaultCount: 3, maxCount: 8 }],
  'Japheth (CoW AB)':                                    [{ type: 'look_at_own_deck_choose', position: 'top', defaultCount: 3, maxCount: 8 }],
  'False Prophecy (PoC)':                                [{ type: 'look_at_opponent_deck', position: 'top', count: 6 }],
  'The Ends of the Earth (RoJ AB)':                      [{ type: 'reveal_opponent_deck', position: 'top', count: 7 }],
  'The Ends of the Earth (RoJ)':                         [{ type: 'reveal_opponent_deck', position: 'top', count: 7 }],
  // Promo printing reveals the top 3, NOT the 9 of the RR2 printing below —
  // same card name, different printed count.
  'Seeker of the Lost':                                  [{ type: 'reveal_opponent_deck', position: 'top', count: 3 }],
  'Matthew the Publican / Matthew (Levi) (GoC)':         [{ type: 'draw_brigades', alignment: 'total' }],
  // Reveal opponent's hand: draw X = distinct evil brigades (Ahijah limit 3).
  'Ahijah, Cloak Tearer':                                [{ type: 'draw_brigades', alignment: 'evil', limit: 3 }],
  'Hannah':                                              [{ type: 'draw_brigades', alignment: 'evil' }],
  'Mighty Men':                                          [{ type: 'draw_brigades', alignment: 'evil' }],
  // Reveal opponent's hand: draw X = distinct good brigades (Damsels limit 6).
  'The Divining Damsel (Promo)':                         [{ type: 'draw_brigades', alignment: 'good', limit: 6 }],
  'The Divining Damsel [Fundraiser]':                    [{ type: 'draw_brigades', alignment: 'good', limit: 6 }],
  'The Lying Prophet':                                   [{ type: 'draw_brigades', alignment: 'good' }],
  'Delivered':                                           [{ type: 'discard_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  // Kings printing discards ONE card ("the top card from opponent's draw pile"),
  // unlike the RR2 printing's 2. The paired "draw the top card from your draw
  // pile" half is left to the deck menu.
  'Plunderers':                                          [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Contagious Fear (GoC)':                               [{ type: 'reserve_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Jairus (GoC)':                                        [{ type: 'reserve_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  "Jairus' Daughter (GoC)":                              [{ type: 'reserve_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Massacre of Innocents (GoC)':                         [{ type: 'reserve_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Submission to Christ (GoC)':                          [{ type: 'reserve_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Talitha Kum! (GoC)':                                  [{ type: 'reserve_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Teaching in Parables (GoC)':                          [{ type: 'reserve_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Omen Interpreter':                                    [{ type: 'reveal_own_deck', position: 'top', count: 6 }],
  "Balaam's Prophecy":                                   [{ type: 'reveal_own_deck', position: 'top', count: 6 }],
  'Fruit of the Land':                                   [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'Intervening of Prophecy':                             [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  // (Star) abilities are used from hand during the REG Pre-Game Phase, so their
  // registered entry takes the hand override. Only entries encoding the card's
  // STAR clause qualify — the 12 star cards whose entry encodes their in-play
  // clause (Manna (PoC), The Outcasts, Redeeming Branch, …) deliberately do not.
  'The Coming Prince':                                   [{ type: 'look_at_own_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }, { type: 'underdeck_top_of_deck', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Abed-nego (Azariah) (PoC)':                           [{ type: 'underdeck_top_of_deck', count: 1 }],
  'Sign of Jonah':                                       [{ type: 'look_at_own_deck', position: 'top', count: 3, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Virgin Birth':                                        [{ type: 'look_at_own_deck', position: 'top', count: 6, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Eve, Mother of All (Roots)':                          [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'The Thankful Leper (GoC)':                            [{ type: 'look_at_own_deck', position: 'top', count: 10, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'David (Roots)':                                       [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'Malachi, the Loved':                                  [{ type: 'look_at_own_deck', position: 'top', count: 4 }],
  'Malachi, the Loved [T2C AB]':                         [{ type: 'look_at_own_deck', position: 'top', count: 4 }],
  'Samuel, Born of Prayer':                              [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'David the Psalmist':                                  [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'David, the Psalmist (CoW AB)':                        [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'Prophets of Gibeath (Promo)':                         [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  "David's Spies [K]":                                   [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  "David's Spies (1st Print - K)":                       [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'Servants by the River [T2C AB]':                      [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'Servants by the River [T2C]':                         [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'The Angel of His Presence [T2C AB]':                  [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'The Angel of His Presence [T2C]':                     [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'The Three Visitors':                                  [{ type: 'look_at_own_deck', position: 'top', count: 9, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Women of Israel [L]':                                 [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  'Women of Israel (1st Print - L)':                     [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  "Herod's Temple (GoC)":                                [{ type: 'reserve_top_of_deck', count: 1 }],
  "Herod's Temple [2022 - GoC P]":                       [{ type: 'reserve_top_of_deck', count: 1 }],
  'Treacherous Land':                                    [{ type: 'draw_bottom_of_deck', count: 1 }],
  'Treacherous Land (2022 - 2nd Place)':                 [{ type: 'draw_bottom_of_deck', count: 1 }],
  'Balaam Son of Beor':                                  [{ type: 'draw_bottom_of_deck', count: 2 }],
  'Destructive Sin (GoC)':                               [{ type: 'draw_bottom_of_deck', count: 1 }],
  'High Places (LoC)':                                   [{ type: 'draw_bottom_of_deck', count: 1 }],
  'Choked Seed (GoC)':                                   [{ type: 'draw_bottom_of_deck_choose' }],
  'Destroying Spirit (GoC)':                             [{ type: 'draw_bottom_of_deck_choose' }],
  'Messenger of Satan (EC)':                             [{ type: 'draw_bottom_of_deck_choose' }],
  // "Discard the bottom card of deck. If it is … a Lost Soul, play it instead."
  // Lost Souls route to the Land of Bondage; everything else is discarded.
  'The Gates of Hell':                                   [{ type: 'discard_bottom_of_deck' }],
  'The Gates of Hell (GoC)':                             [{ type: 'discard_bottom_of_deck' }],
  'The Gates of Hell [2024 - 2nd Place]':                [{ type: 'discard_bottom_of_deck' }],
  'Three Woes (RoJ AB)':                                 [{ type: 'set_card_outline', color: 'good', label: 'Choose Good' }, { type: 'set_card_outline', color: 'evil', label: 'Choose Evil' }],
  'Three Woes (RoJ)':                                    [{ type: 'set_card_outline', color: 'good', label: 'Choose Good' }, { type: 'set_card_outline', color: 'evil', label: 'Choose Evil' }],
  'Three Woes [Fundraiser]':                             [{ type: 'set_card_outline', color: 'good', label: 'Choose Good' }, { type: 'set_card_outline', color: 'evil', label: 'Choose Evil' }],
  'Three Woes [Fundraiser - Serialized]':                [{ type: 'set_card_outline', color: 'good', label: 'Choose Good' }, { type: 'set_card_outline', color: 'evil', label: 'Choose Evil' }],
  'Harvest Time (GoC)':                                  [{ type: 'play_all_lost_souls' }],
  'Harvest Time [Fundraiser]':                           [{ type: 'play_all_lost_souls' }],
  // The Patriarchs (green) printing only — "Creation of the World (Roots)" is a
  // different card (blue, "each player may play up to 3 …") and stays unregistered.
  'Creation of the World':                               [{ type: 'band_heroes_from_deck', referenceBook: 'Genesis' }],
  'Three Nails (GoC)':                                   [{ type: 'three_nails_reset' }],
  // "If it is your turn banish this card: Shuffle all cards in play, set-aside,
  // and hands. Each player must draw 8. Begin a new turn." Same board reset as
  // Three Nails (GoC) — the reset banishes the source card.
  'A New Beginning (FoM)':                               [{ type: 'three_nails_reset' }],
  // The original Patriarchs printing of the same reset: "ALL players shuffle ALL
  // cards in the field of play, set-aside areas and their hands back into their
  // draw pile … ALL players Draw 8." A Good Enhancement, so it fires from the
  // battle zone — the path #293 unblocked for the RR2 printing.
  'A New Beginning':                                     [{ type: 'three_nails_reset' }],
  // "You may discard this card to discard all characters from a Reserve."
  // Surfaced as two menu items so the activating player picks which Reserve;
  // no in-menu target picker needed.
  "Darius' Decree [T2C]":                                [{ type: 'discard_characters_from_reserve', target: 'self' }, { type: 'discard_characters_from_reserve', target: 'opponent' }],
  "Darius' Decree [T2C AB]":                             [{ type: 'discard_characters_from_reserve', target: 'self' }, { type: 'discard_characters_from_reserve', target: 'opponent' }],
  // "Resurrect any number of Heroes from each player." Opens a per-player
  // discard picker; selected Heroes return to their own owner's Territory.
  'Emptying the Tombs (GoC)':                            [{ type: 'resurrect_heroes' }],
  'Redemption [2025 - National]':                        [{ type: 'resurrect_heroes' }],

  // ---------------------------------------------------------------------------
  // Roots 2 (RR2)
  //
  // Reading convention, inherited from the cards already registered above:
  // printed "a deck" means an opponent's deck (The Ends of the Earth, Contagious
  // Fear), while "of deck" with no article means your own (Herod's Temple).
  // Cards whose only deck interaction is "take/play X from deck or Reserve" are
  // deliberately absent — the deck menu's Search Deck already covers those.
  // ---------------------------------------------------------------------------
  // Reprint of Messenger of Satan (EC), already registered above with the same
  // ability. X = # of good brigades in battle, so the count is player-chosen.
  'Messenger of Satan [RR2]':                            [{ type: 'draw_bottom_of_deck_choose' }],
  'Silas, the Bold [RR2]':                               [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  // "Reveal the bottom card of deck: If it is evil, …" — reveal only; the
  // follow-up take/play is a manual drag, same as the other reveal cards.
  'Evil Angel [RR2]':                                    [{ type: 'reveal_own_deck', position: 'bottom', count: 1 }],
  'Shadow Spirit [RR2]':                                 [{ type: 'reveal_own_deck', position: 'bottom', count: 1 }],
  'Seeker of the Lost [RR2]':                            [{ type: 'reveal_opponent_deck', position: 'top', count: 9 }],
  'Wash Basin [RR2]':                                    [{ type: 'reveal_opponent_deck', position: 'bottom', count: 2 }],
  'Children [RR2]':                                      [{ type: 'reserve_opponent_deck', position: 'top', count: 2 }],
  'Pharaoh Neco [RR2]':                                  [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Plunderers [RR2]':                                    [{ type: 'discard_opponent_deck', position: 'top', count: 2 }],
  'Wonders Forgotten [RR2]':                             [{ type: 'discard_opponent_deck', position: 'top', count: 2 }],
  // Curse. The EE half ("Discard a card from opponent's deck") is played from
  // hand, so hand joins the source zones the way Delivered's (Star) half does.
  'Confusion of Mind [RR2]':                             [{ type: 'discard_opponent_deck', position: 'random', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  // Covenant — "A: You may create a Lost Soul token in each Land of Bondage."
  // The identifier prints the token as ("Harvest", John 4:35), which is the
  // same handcrafted token Lost Soul "Harvest" spawns. Exposed as two items so
  // the player fires each Land separately; abilityLabel marks which is which.
  'I Am Salvation [RR2]':                                [
    { type: 'spawn_token', tokenName: 'Harvest Soul Token', defaultZone: 'land-of-bondage' },
    { type: 'spawn_token', tokenName: 'Harvest Soul Token', defaultZone: 'land-of-bondage', spawnForOpponent: true },
  ],
  // "Each player must select a card from hand and shuffle the rest to draw X."
  // X is the shuffled count, so it's Mayhem with a keep-one step and a dynamic
  // draw instead of Mayhem's fixed 6/6.
  'Philip’s Daughters [RR2]':                            [{ type: 'all_players_keep_one_shuffle_draw' }],
  // "If attacking, banish this card: Shuffle all cards and all hands. End the
  // battle. Each player must draw 8." Same board reset as Three Nails (GoC)
  // and A New Beginning (FoM) above — but this printing is a Good Enhancement
  // played into battle, not an Artifact or Dominant sitting in territory, so
  // the reset fires from the battle zone.
  'A New Beginning [RR2]':                               [{ type: 'three_nails_reset' }],

  // ---------------------------------------------------------------------------
  // Full-pool audit (all sets outside Roots 2)
  //
  // Same rule as the RR2 block above: automate what touches a hidden or ordered
  // zone, creates tokens, or is multi-card bookkeeping; leave tutoring to the
  // Search Deck menu. Printed "a deck" reads as an opponent's, "of deck" as your
  // own. Curses take the hand override only when the deck effect sits on the
  // EE: line (cf. Confusion of Mind [RR2]); an A:/ART:/"on activation" clause
  // resolves in play and is already covered by DEFAULT_ABILITY_SOURCE_ZONES.
  // ---------------------------------------------------------------------------

  // Token creation
  'Majestic Heavens (Promo)':                            [{ type: 'spawn_token', tokenName: 'Lost Soul Token NT (Majestic Heavens)', defaultZone: 'land-of-bondage', spawnForOpponent: true }, { type: 'spawn_token', tokenName: 'Lost Soul Token OT (Majestic Heavens)', defaultZone: 'land-of-bondage', spawnForOpponent: true }],

  // Look at your own deck (private peek)
  "Aaron, God's Mediator":                               [{ type: 'look_at_own_deck', position: 'bottom', count: 10, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Bless the Nations':                                   [{ type: 'look_at_own_deck', position: 'bottom', count: 6, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  "Eve's Descendant (PoC)":                              [{ type: 'look_at_own_deck', position: 'bottom', count: 6, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Foretelling Angel':                                   [{ type: 'look_at_own_deck', position: 'top', count: 3 }, { type: 'look_at_opponent_deck', position: 'top', count: 3 }],
  'Heavenly Trance':                                     [{ type: 'look_at_own_deck', position: 'top', count: 1 }, { type: 'look_at_opponent_deck', position: 'top', count: 1 }],
  'Honey from a Lion (CoW AB)':                          [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Honey from a Lion (CoW)':                             [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Hope':                                                [{ type: 'look_at_own_deck', position: 'top', count: 7 }],
  'Joel (PoC)':                                          [{ type: 'look_at_own_deck', position: 'top', count: 6, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Joseph, the Dreamer':                                 [{ type: 'look_at_own_deck', position: 'bottom', count: 6, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  "Joseph's Silver Cup (PoC)":                           [{ type: 'look_at_own_deck', position: 'top', count: 3 }],
  "Pharaoh's Magicians":                                 [{ type: 'look_at_own_deck', position: 'top', count: 1 }],
  'Philistine Soothsayers':                              [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Redeeming Branch':                                    [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Rhoda (Promo)':                                       [{ type: 'look_at_own_deck', position: 'top', count: 1 }],
  'Stone Cut Without Hands':                             [{ type: 'look_at_own_deck', position: 'bottom', count: 6, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Strong Demon (GoC)':                                  [{ type: 'look_at_own_deck', position: 'bottom', count: 3 }],
  'Taking the Ark (1st Print - L)':                      [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Taking the Ark [L]':                                  [{ type: 'look_at_own_deck', position: 'top', count: 6 }],
  'Triumphal Entry':                                     [{ type: 'look_at_own_deck', position: 'bottom', count: 6, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Zeresh':                                              [{ type: 'look_at_own_deck', position: 'top', count: 6 }],

  // Look at your own deck, player-chosen count (maxCount = printed limit, or a closed card-pool set)
  'Belt of Truth':                                       [{ type: 'look_at_own_deck_choose', position: 'top', defaultCount: 1, maxCount: 6 }],
  'Bezalel, the Builder':                                [{ type: 'look_at_own_deck_choose', position: 'top', defaultCount: 3, maxCount: 7 }],
  'Evil Armor (GoC)':                                    [{ type: 'look_at_own_deck_choose', position: 'top', defaultCount: 3, maxCount: 6 }],
  'Fortunatus':                                          [{ type: 'look_at_own_deck_choose', position: 'top', defaultCount: 3, maxCount: 8 }],
  'Haggai (PoC)':                                        [{ type: 'look_at_own_deck_choose', position: 'top', defaultCount: 3, maxCount: 12 }],
  'Legion (Roots)':                                      [{ type: 'look_at_own_deck_choose', position: 'bottom', defaultCount: 3, maxCount: 6 }],
  'Matthias (GoC)':                                      [{ type: 'look_at_own_deck_choose', position: 'top', defaultCount: 3, maxCount: 27 }],
  'Og, King of Bashan':                                  [{ type: 'look_at_own_deck_choose', position: 'top', defaultCount: 3, maxCount: 9 }],
  'Shealtiel, the Heir / Shealtiel, the Exilarch (LoC)': [{ type: 'look_at_own_deck_choose', position: 'top', defaultCount: 2, maxCount: 11 }],
  'The Mighty Warrior (FoM)':                            [{ type: 'look_at_own_deck_choose', position: 'top', defaultCount: 3, maxCount: 7 }],

  // Reveal your own deck (public — broadcast to the opponent)
  'Astrologers (PoC)':                                   [{ type: 'reveal_own_deck', position: 'top', count: 1 }, { type: 'reveal_own_deck', position: 'bottom', count: 1 }],
  'Astrologers (TxP)':                                   [{ type: 'reveal_own_deck', position: 'top', count: 1 }, { type: 'reveal_own_deck', position: 'bottom', count: 1 }],
  'Controlling Demon (J)':                               [{ type: 'reveal_own_deck', position: 'bottom', count: 1 }],
  'Egyptian Magicians':                                  [{ type: 'reveal_own_deck', position: 'top', count: 1 }, { type: 'reveal_own_deck', position: 'bottom', count: 1 }],
  'Egyptian Magicians (FoM)':                            [{ type: 'reveal_own_deck', position: 'top', count: 1 }, { type: 'reveal_own_deck', position: 'bottom', count: 1 }],
  'Elymas the Sorcerer (EC)':                            [{ type: 'reveal_own_deck', position: 'top', count: 1 }, { type: 'reveal_own_deck', position: 'bottom', count: 1 }],
  'Evil Armor (Pi)':                                     [{ type: 'reveal_own_deck', position: 'bottom', count: 1 }],
  'Evil Spawn (Pi)':                                     [{ type: 'reveal_own_deck', position: 'bottom', count: 1 }],
  'Inspection':                                          [{ type: 'reveal_own_deck', position: 'top', count: 1 }],
  'Jambres (FoM)':                                       [{ type: 'reveal_own_deck', position: 'bottom', count: 1 }],
  'Pestering Spirit':                                    [{ type: 'reveal_own_deck', position: 'bottom', count: 1 }],
  'Sorcerers (RoJ AB)':                                  [{ type: 'reveal_own_deck', position: 'top', count: 1 }, { type: 'reveal_own_deck', position: 'bottom', count: 1 }],
  'Sorcerers (RoJ)':                                     [{ type: 'reveal_own_deck', position: 'top', count: 1 }, { type: 'reveal_own_deck', position: 'bottom', count: 1 }],
  'Tested by Joseph':                                    [{ type: 'reveal_own_deck', position: 'top', count: 5 }, { type: 'reveal_opponent_deck', position: 'top', count: 5 }],
  'Wandering Spirit (GoC)':                              [{ type: 'reveal_own_deck', position: 'bottom', count: 1 }],
  'Wandering Spirit (TxP)':                              [{ type: 'reveal_own_deck', position: 'bottom', count: 1 }],

  // Look at an opponent's deck
  'Cut Off':                                             [{ type: 'look_at_opponent_deck', position: 'bottom', count: 6, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'His Name':                                            [{ type: 'look_at_opponent_deck', position: 'bottom', count: 6, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Joshua’s Scribes (Roots)':                            [{ type: 'look_at_opponent_deck', position: 'top', count: 7 }],
  'Light in the Darkness':                               [{ type: 'look_at_opponent_deck', position: 'top', count: 3, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Mattan, Priiest of Baal (LoC)':                       [{ type: 'look_at_opponent_deck', position: 'top', count: 1 }],
  'Prophets of Baal (PoC)':                              [{ type: 'look_at_opponent_deck', position: 'top', count: 1 }],
  'Strength Revealed':                                   [{ type: 'look_at_opponent_deck', position: 'top', count: 6 }],

  // Reveal an opponent's deck
  'House in Bethany':                                    [{ type: 'reveal_opponent_deck', position: 'top', count: 7 }],
  'Lost Soul Romans 3:23 (Revealer)':                    [{ type: 'reveal_opponent_deck', position: 'top', count: 2 }],
  'Plague of Blood (PoC)':                               [{ type: 'reveal_opponent_deck', position: 'top', count: 3 }],
  'Plague of Flies (LoC)':                               [{ type: 'reveal_opponent_deck', position: 'top', count: 4 }],
  'Samaritan Water Jar':                                 [{ type: 'reveal_opponent_deck', position: 'top', count: 3 }, { type: 'reveal_opponent_deck', position: 'top', count: 9 }],
  'Servants of the King [River]':                        [{ type: 'reveal_opponent_deck', position: 'top', count: 7 }],
  'Servants of the King [River] [T2C AB]':               [{ type: 'reveal_opponent_deck', position: 'top', count: 7 }],
  'Warning Against Rebellion':                           [{ type: 'reveal_opponent_deck', position: 'top', count: 5 }],
  'Warning Against Rebellion (CoW AB)':                  [{ type: 'reveal_opponent_deck', position: 'top', count: 5 }],
  'Wickedness Removed':                                  [{ type: 'reveal_opponent_deck', position: 'top', count: 5 }],

  // Discard from an opponent's deck
  'Amminadab, the Generous / Amminadab, the Gracious (LoC)': [{ type: 'discard_opponent_deck', position: 'top', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Amram, Moses’ Father (Roots)':                        [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Angel of the Harvest':                                [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Begging to go Back':                                  [{ type: 'discard_opponent_deck', position: 'top', count: 2 }],
  'Begging to go Back [IR]':                             [{ type: 'discard_opponent_deck', position: 'top', count: 2 }],
  'Beheaded':                                            [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  "Cupbearer's Complaints":                              [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Drusilla':                                            [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Egyptian Horsemen':                                   [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Egyptian Spear':                                      [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Egyptian Warden [IR]':                                [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Egyptian Wise Men [IR]':                              [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Eldad':                                               [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Famished':                                            [{ type: 'discard_opponent_deck', position: 'top', count: 3 }],
  'Given Over to Egypt':                                 [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Given to Egypt (Roots)':                              [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Huge Egyptian':                                       [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Lost Soul "Deck Discard" [Hosea 13:2 - LR]':          [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Lost Soul Hosea 13:2 (Deck Discarder)':               [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Manna (PoC)':                                         [{ type: 'discard_opponent_deck', position: 'bottom', count: 1 }],
  'Necromancer':                                         [{ type: 'discard_opponent_deck', position: 'bottom', count: 1 }],
  'Out of Egypt':                                        [{ type: 'discard_opponent_deck', position: 'bottom', count: 1 }],
  'Panic Demon (Gold)':                                  [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  "Pharaoh's Cupbearer [IR]":                            [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  "Pharaoh's Dream":                                     [{ type: 'discard_opponent_deck', position: 'top', count: 3 }],
  "Pharaoh's Gifts":                                     [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  "Pharaoh's Throne Room [IR]":                          [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Pithom':                                              [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Pithom (Roots)':                                      [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Plague of Boils (LoC)':                               [{ type: 'discard_opponent_deck', position: 'top', count: 5 }],
  'Plague of Hail (GoC)':                                [{ type: 'discard_opponent_deck', position: 'top', count: 5 }],
  'Plague of Locusts':                                   [{ type: 'discard_opponent_deck', position: 'top', count: 2 }],
  'Queen Tahpenes':                                      [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Raamses':                                             [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Ram, the Exalter / Ram, the Uplifted (LoC)':          [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Rash Oath':                                           [{ type: 'discard_opponent_deck', position: 'top', count: 1 }, { type: 'discard_opponent_deck', position: 'top', count: 2 }],
  'Salome (TxP)':                                        [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Send for Egyptians':                                  [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Slave to Egypt':                                      [{ type: 'discard_opponent_deck', position: 'top', count: 3 }],
  'Stealing':                                            [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Stormy Seas':                                         [{ type: 'discard_opponent_deck', position: 'top', count: 1 }, { type: 'discard_opponent_deck', position: 'top', count: 2 }],
  'Stronghold in the Desert':                            [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Taskmaster (FoM)':                                    [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'The Exodus':                                          [{ type: 'discard_opponent_deck', position: 'bottom', count: 1, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'The Hard-Hearted Pharaoh (CoW AB)':                   [{ type: 'discard_opponent_deck', position: 'top', count: 1 }, { type: 'discard_opponent_deck', position: 'top', count: 2 }],
  'The Hard-Hearted Pharaoh (CoW)':                      [{ type: 'discard_opponent_deck', position: 'top', count: 1 }, { type: 'discard_opponent_deck', position: 'top', count: 2 }],
  'The Outcasts':                                        [{ type: 'discard_opponent_deck', position: 'top', count: 1 }, { type: 'discard_opponent_deck', position: 'bottom', count: 1 }],
  'Third Seal (Famine) (RoJ AB)':                        [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Third Seal, Famine (RoJ)':                            [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Treasures of War':                                    [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],
  'Turn to Egypt':                                       [{ type: 'discard_opponent_deck', position: 'top', count: 2 }],
  "Warrior's Spear":                                     [{ type: 'discard_opponent_deck', position: 'top', count: 1 }],

  // Reserve from an opponent's deck
  'Bartimaeus (2022 - Regional)':                        [{ type: 'reserve_opponent_deck', position: 'top', count: 1 }],
  'Citizens of Sychar (GoC)':                            [{ type: 'reserve_opponent_deck', position: 'bottom', count: 1 }],
  'Nadab, the Wicked':                                   [{ type: 'reserve_opponent_deck', position: 'bottom', count: 1 }],
  'Ridicule (GoC)':                                      [{ type: 'reserve_opponent_deck', position: 'top', count: 2, sourceZones: ['hand', 'territory', 'land-of-bondage', 'land-of-redemption'] }],
  'Samaritan Water Jar (GoC)':                           [{ type: 'reserve_opponent_deck', position: 'top', count: 3 }],
  'Simon of Cyrene (Roots)':                             [{ type: 'reserve_opponent_deck', position: 'top', count: 1 }],
  'The Good Samaritan (GoC)':                            [{ type: 'reserve_opponent_deck', position: 'top', count: 1 }],
  'Watchful Servant (GoC)':                              [{ type: 'reserve_opponent_deck', position: 'bottom', count: 1 }],

  // Reserve the top of your own deck
  'Conspiring Herodians (GoC)':                          [{ type: 'reserve_top_of_deck', count: 1 }],

  // Discard the bottom of your own deck (Lost Souls route into play)
  'Foolish Builder (GoC)':                               [{ type: 'discard_bottom_of_deck' }],

  // Draw = distinct brigades in the opponent's revealed hand
  'Damsel with Spirit of Divination (TxP)':              [{ type: 'draw_brigades', alignment: 'good' }],

  // Return Heroes from discard piles to play
  'Everlasting Beings':                                  [{ type: 'resurrect_heroes' }],
  'Raising of the Saints (Wa)':                          [{ type: 'resurrect_heroes' }],
  'Valley of Dry Bones':                                 [{ type: 'resurrect_heroes' }],

  // ---------------------------------------------------------------------------
  // Player-chosen count — opponent-facing and reveal variants
  //
  // Only cards whose ceiling is printed on the card ("limit N") or enforced by
  // the engine (Outsiders: X = cards in your hand, bounded by HAND_LIMIT).
  // Cards whose X needs a card-pool census — Michal, Aaron's Staff, Egyptian
  // Treasures, Claudia, Eve (FoM) — are deliberately left out until someone
  // rules on the ceiling: a guessed maxCount silently truncates the effect.
  //
  // Angel of Revelation reveals "each player's deck", so it gets one entry per
  // deck rather than a combined shape.
  // ---------------------------------------------------------------------------
  'The Seventy Elders':                                  [{ type: 'reveal_opponent_deck_choose', position: 'top', defaultCount: 3, maxCount: 7 }],
  'Wash Basin':                                          [{ type: 'reveal_opponent_deck_choose', position: 'bottom', defaultCount: 2, maxCount: 2 }],
  'the gods of Egypt [IR]':                              [{ type: 'discard_opponent_deck_choose', position: 'top', defaultCount: 3, maxCount: 5 }],
  'Sabbath Breaker [Gray/Pale Green]':                   [{ type: 'look_at_opponent_deck_choose', position: 'top', defaultCount: 3, maxCount: 6 }],
  'Angel of Revelation (RoJ)':                           [{ type: 'reveal_own_deck_choose', position: 'top', defaultCount: 3, maxCount: 7 }, { type: 'reveal_opponent_deck_choose', position: 'top', defaultCount: 3, maxCount: 7 }],
  'Angel of Revelation (RoJ AB)':                        [{ type: 'reveal_own_deck_choose', position: 'top', defaultCount: 3, maxCount: 7 }, { type: 'reveal_opponent_deck_choose', position: 'top', defaultCount: 3, maxCount: 7 }],
  'Outsiders (Gray/Pale Green) (RoJ)':                   [{ type: 'look_at_opponent_deck_choose', position: 'top', defaultCount: 5, maxCount: 16 }],
  'Outsiders (Gray/Pale Green) (RoJ AB)':                [{ type: 'look_at_opponent_deck_choose', position: 'top', defaultCount: 5, maxCount: 16 }],

  // ---------------------------------------------------------------------------
  // Persistent top-of-deck reveal
  //
  // "Protect deck from discard. Play with top card of deck face up: While it's
  // a Daniel card, Daniel characters cannot be negated. If it's a Daniel card,
  // you may add it to hand. Cannot be negated." The toggle keeps the
  // activator's top deck card face up on the pile; the Daniel add-to-hand item
  // appears in the deck context menu while the toggle is active.
  // ---------------------------------------------------------------------------
  'The Foretelling Angel (PC)':                          [{ type: 'toggle_top_deck_reveal' }],
};

export function getAbilitiesForCard(identifier: string): CardAbility[] {
  return CARD_ABILITIES[identifier] ?? [];
}

/**
 * Returns the abilities for this card plus any inherited from a soul it's
 * currently imitating (filter out the nested imitate_lost_soul variant so
 * "Imitate..." doesn't appear twice). Server execute_card_ability and the
 * client CardContextMenu must both use this so abilityIndex stays in sync.
 */
export function getEffectiveAbilities(card: { cardName: string; imitatingName?: string }): CardAbility[] {
  const base = getAbilitiesForCard(card.cardName);
  if (!card.imitatingName) return base;
  const imitated = getAbilitiesForCard(card.imitatingName).filter(a => a.type !== 'imitate_lost_soul');
  return [...base, ...imitated];
}

/**
 * Exact-cardName → image path map for Imitate Lost Soul art swaps.
 * Files live under public/imitate-souls/cards/ (see public/imitate-souls/README.md).
 * Multiple cardName variants can point at the same file when the card
 * has alternate-border or promo variants sharing the same art.
 */
export const IMITATE_SOUL_IMAGES: Record<string, string> = {
  'Lost Soul "Awake" [Ephesians 5:14 - TPC]':                          '/imitate-souls/cards/awake.jpg',
  'Lost Soul "Crowds" [Luke 5:15] [2016 - Local]':                     '/imitate-souls/cards/crowds_local.jpg',
  'Lost Soul "Crowds" [Luke 5:15] [2025 - Worker]':                    '/imitate-souls/cards/crowds_worker.jpg',
  'Lost Soul "Defiled" [Mark 7:21-22]':                                '/imitate-souls/cards/defiled.jpg',
  'Lost Soul "Destruction" [Hebrews 10:39]':                           '/imitate-souls/cards/destruction.jpg',
  'Lost Soul "Destruction" [Hebrews 10:39] [AB - CoW]':                '/imitate-souls/cards/destruction.jpg',
  'Lost Soul "Dull" [Hebrews 5:11]':                                   '/imitate-souls/cards/dull.jpg',
  'Lost Soul "Dull" [Hebrews 5:11] [AB - CoW]':                        '/imitate-souls/cards/dull.jpg',
  'Lost Soul "Forsaken" [Hebrews 10:25]':                              '/imitate-souls/cards/forsaken.jpg',
  'Lost Soul "Forsaken" [Hebrews 10:25] [AB - CoW]':                   '/imitate-souls/cards/forsaken.jpg',
  'Lost Soul "Gain" [Jude 1:16]':                                      '/imitate-souls/cards/gain.jpg',
  'Lost Soul "Gain" [Jude 1:16]  [AB - RoJ]':                          '/imitate-souls/cards/gain.jpg',
  'Lost Soul "Galileans" [Luke 13:2]':                                 '/imitate-souls/cards/galileans.jpg',
  'Lost Soul "Harvest" [John 4:35]':                                   '/imitate-souls/cards/harvest.jpg',
  'Lost Soul "Harvest" [John 4:35] [2023 - 2nd Place]':                '/imitate-souls/cards/harvest_2nd.jpg',
  'Lost Soul "Hopper" [Matthew 18:12] [2025 - Seasonal]':              '/imitate-souls/cards/hopper.jpg',
  'Lost Soul "Humble" [James 4:6 / Proverbs 3:34 - RoJ]':              '/imitate-souls/cards/humble.jpg',
  'Lost Soul "Humble" [James 4:6 / Proverbs 3:34]  [AB - RoJ]':        '/imitate-souls/cards/humble.jpg',
  'Lost Soul "Humble" [James 4:6 / Proverbs 3:34] [2022 - 3rd Place]': '/imitate-souls/cards/humble_3rd.jpg',
  'Lost Soul "Imitate" [III John 1:11]':                               '/imitate-souls/cards/imitate.jpg',
  'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]':                   '/imitate-souls/cards/imitate.jpg',
  'Lost Soul "Lawless" [Hebrews 12:8]':                                '/imitate-souls/cards/lawless.jpg',
  'Lost Soul "Lawless" [Hebrews 12:8] [2021 - 1st Place]':             '/imitate-souls/cards/lawless.jpg',
  'Lost Soul "Lawless" [Hebrews 12:8] [AB - CoW]':                     '/imitate-souls/cards/lawless.jpg',
  'Lost Soul "Open Hand" [Hebrews 4:13]':                              '/imitate-souls/cards/open_hand.jpg',
  'Lost Soul "Open Hand" [Hebrews 4:13] [AB - CoW]':                   '/imitate-souls/cards/open_hand.jpg',
  'Lost Soul "Rejoice" [Luke 15:6 - J]':                               '/imitate-souls/cards/rejoice.jpg',
  'Lost Soul "Retribution" [Acts 16:22]':                              '/imitate-souls/cards/retribution.jpg',
  'Lost Soul "Revealer" [John 3:20]':                                  '/imitate-souls/cards/revealer.jpg',
  'Lost Soul "Salty" [Matthew 5:13]':                                  '/imitate-souls/cards/salty.jpg',
  'Lost Soul "Shut Door" [Luke 13:25 - LR]':                           '/imitate-souls/cards/shut_door.jpg',
  'Lost Soul "Tempter" [II Timothy 3:6-7 - TPC]':                      '/imitate-souls/cards/tempter.jpg',
  'Lost Soul "The First" [Luke 13:30]':                                '/imitate-souls/cards/the_first.jpg',
  'Lost Soul "Undesirables" [Luke 14:13]':                             '/imitate-souls/cards/undesireables.jpg',
};

/**
 * Original (canonical) imgFile for each Imitate Lost Soul variant. Used by
 * stop_imitating_lost_soul to revert. Values match the imgFile field in
 * lib/cards/generated/cardData.ts. Parity test enforces this.
 */
export const IMITATE_ORIGINAL_IMG: Record<string, string> = {
  'Lost Soul "Imitate" [III John 1:11]':              '23-Lost-Soul-Imitate-R',
  'Lost Soul "Imitate" [III John 1:11]  [AB - RoJ]':  'RoJ_AB_N23-Lost-Soul-Imitate-R',
};

/**
 * New Testament book names (lowercased). Duplicate of the array in
 * lib/cards/cardAbilities.ts; parity test enforces equality.
 */
const NT_BOOK_NAMES = [
  'matthew', 'mark', 'luke', 'john', 'acts', 'romans',
  'corinthians', 'galatians', 'ephesians', 'philippians',
  'colossians', 'thessalonians', 'timothy', 'titus', 'philemon',
  'hebrews', 'james', 'peter', 'jude', 'revelation',
];

/**
 * Returns true when the Lost Soul's reference is from the New Testament.
 * Strips leading Roman numerals (I, II, III, IV) or Arabic numerals
 * (1, 2, 3) so "III John 1:11" / "II Timothy 3:6-7" / "1 Corinthians 1:27"
 * all match their underlying book.
 */
export function isNewTestamentLostSoul(reference: string): boolean {
  if (!reference) return false;
  const lower = reference.toLowerCase().trim();
  const stripped = lower.replace(/^(i{1,3}|iv|\d+)\s+/, '');
  return NT_BOOK_NAMES.some(book => stripped.startsWith(book));
}

/**
 * Extracts a short label from a Lost Soul cardName for the imitation overlay.
 * Priority: quoted name → first parenthetical → cardName with "Lost Soul " prefix stripped.
 */
export function simplifyLostSoulName(cardName: string): string {
  const quoted = cardName.match(/"([^"]+)"/);
  if (quoted) return quoted[1];
  const paren = cardName.match(/\(([^)]+)\)/);
  if (paren) return paren[1];
  return cardName.replace(/^Lost Soul\s+/, '').trim();
}

/**
 * True when a card is a "character" in Redemption terms — a Hero or an Evil
 * Character (including their token variants and dual-type combos like
 * "Hero/Evil Character"). Handles both the goldfish `type` field and the
 * multiplayer `cardType` field. Duplicate of lib/cards/cardAbilities.ts.
 */
export function isCharacterCard(card: { type?: string; cardType?: string }): boolean {
  const t = (card.type ?? card.cardType ?? '').toLowerCase();
  if (!t) return false;
  return t.includes('hero') || t.includes('evil character');
}

/**
 * True when a card's type contains "Hero" — the valid-target rule for the
 * resurrect_heroes ability. "Contains" rather than exact match so dual-
 * alignment / compound-type Heroes (e.g. "Hero/Evil Character") qualify.
 * Handles both the goldfish `type` field and the multiplayer `cardType`
 * field. Duplicate of lib/cards/cardAbilities.ts.
 */
export function isHeroCard(card: { type?: string; cardType?: string }): boolean {
  const t = (card.type ?? card.cardType ?? '').toLowerCase();
  return t.includes('hero');
}

/**
 * True when a card's printed reference cites `book` — the match rule for
 * band_heroes_from_deck ("Heroes having a Genesis reference"). Every reference
 * in carddata leads with its book ("Genesis 2:7", "I Samuel 17:50"), and no
 * card cites Genesis anywhere but first, so a prefix test on the trimmed,
 * lowercased string is exact here and can't be fooled by a chapter:verse.
 * Duplicate of lib/cards/cardAbilities.ts.
 */
export function hasReferenceBook(reference: string, book: string): boolean {
  if (!reference || !book) return false;
  return reference.trim().toLowerCase().startsWith(book.trim().toLowerCase());
}

export interface TokenCardData {
  name: string;
  set: string;
  imgFile: string;
  cardType: string;
  brigade: string;
  strength: string;
  toughness: string;
  alignment: string;
  identifier: string;
  specialAbility: string;
  reference: string;
}

export const TOKEN_CARD_DATA: Record<string, TokenCardData> = {
  'Violent Possessor Token': {
    name: 'Violent Possessor Token',
    set: 'GoC',
    imgFile: 'Violent-Possessor-Token',
    cardType: 'Evil Character Token',
    brigade: 'Orange',
    strength: '2',
    toughness: '2',
    alignment: 'Evil',
    identifier: 'Generic, Demon',
    specialAbility: '',
    reference: 'Matthew 8:28',
  },
  'Wicked Spirit Token': {
    name: 'Wicked Spirit Token',
    set: 'GoC',
    imgFile: 'Wicked-Spirit-Token',
    cardType: 'Evil Character Token',
    brigade: 'Orange',
    strength: '1',
    toughness: '3',
    alignment: 'Evil',
    identifier: 'Generic, Demon',
    specialAbility: '',
    reference: 'Luke 11:26',
  },
  'Proselyte Token': {
    name: 'Proselyte Token',
    set: 'GoC',
    imgFile: 'Proselyte-Token',
    cardType: 'Evil Character Token',
    brigade: 'Gray',
    strength: '2',
    toughness: '2',
    alignment: 'Evil',
    identifier: 'Generic, Pharisee',
    specialAbility: '',
    reference: 'Matthew 23:15',
  },
  'Follower Token': {
    name: 'Follower Token',
    set: 'GoC',
    imgFile: 'Follower-Token',
    cardType: 'Hero Token',
    brigade: 'Clay',
    strength: '6',
    toughness: '8',
    alignment: 'Good',
    identifier: 'Generic, Has the selected church identifier',
    specialAbility: '',
    reference: 'Matthew 16:18',
  },
  'Heavenly Host Token': {
    name: 'Heavenly Host Token',
    set: 'GoC',
    imgFile: 'Heavenly-Host-Token',
    cardType: 'Hero Token',
    brigade: 'Silver',
    strength: '1',
    toughness: '9',
    alignment: 'Good',
    identifier: 'Generic, Nativity, Angel',
    specialAbility: '',
    reference: 'Luke 2:13',
  },
  // Handcrafted lost-soul tokens — images under public/gameplay/. imgFile
  // carries the full path with leading slash (unlike real carddata tokens
  // which use bare filenames resolved elsewhere).
  'Harvest Soul Token': {
    name: 'Lost Soul Token "Harvest"',
    set: '',
    imgFile: '/gameplay/harvest_soul_token.jpg',
    cardType: 'Lost Soul',
    brigade: '',
    strength: '',
    toughness: '',
    alignment: 'Neutral',
    identifier: '',
    specialAbility: '',
    reference: 'John 4:35',
  },
  'Lost Souls Token': {
    name: 'Lost Soul Token "Lost Souls"',
    set: '',
    imgFile: '/gameplay/lost_souls_token.jpg',
    cardType: 'Lost Soul',
    brigade: '',
    strength: '',
    toughness: '',
    alignment: 'Neutral',
    identifier: '',
    specialAbility: '',
    reference: 'Proverbs 2:16-17',
  },
  'Daniel Soul Token': {
    name: 'Daniel Soul Token',
    set: '',
    imgFile: '/gameplay/daniel_soul_token.png',
    cardType: 'Lost Soul',
    brigade: '',
    strength: '',
    toughness: '',
    alignment: 'Neutral',
    identifier: '',
    specialAbility: '',
    reference: '',
  },
  // Special cycling Heavenly Host tokens (easter egg). Metadata mirrors the
  // standard Heavenly Host Token; only the art differs (blue/purple/silver).
  'Heavenly Host Token (Blue)': {
    name: 'Heavenly Host Token (Blue)',
    set: 'GoC',
    imgFile: '/gameplay/heavenly_host_token_blue.webp',
    cardType: 'Hero Token',
    brigade: 'Silver',
    strength: '1',
    toughness: '9',
    alignment: 'Good',
    identifier: 'Generic, Nativity, Angel',
    specialAbility: '',
    reference: 'Luke 2:13',
  },
  'Heavenly Host Token (Purple)': {
    name: 'Heavenly Host Token (Purple)',
    set: 'GoC',
    imgFile: '/gameplay/heavenly_host_token_purple.webp',
    cardType: 'Hero Token',
    brigade: 'Silver',
    strength: '1',
    toughness: '9',
    alignment: 'Good',
    identifier: 'Generic, Nativity, Angel',
    specialAbility: '',
    reference: 'Luke 2:13',
  },
  'Heavenly Host Token (Silver)': {
    name: 'Heavenly Host Token (Silver)',
    set: 'GoC',
    imgFile: '/gameplay/heavenly_host_token_silver.webp',
    cardType: 'Hero Token',
    brigade: 'Silver',
    strength: '1',
    toughness: '9',
    alignment: 'Good',
    identifier: 'Generic, Nativity, Angel',
    specialAbility: '',
    reference: 'Luke 2:13',
  },
  // Majestic Heavens (Promo) prints two Lost Soul tokens — one N.T., one O.T.
  // Both are real Promo cards; metadata mirrored from lib/cards/generated/cardData.
  'Lost Soul Token NT (Majestic Heavens)': {
    name: 'Lost Soul Token NT (Majestic Heavens)',
    set: 'Pmo-P2',
    imgFile: 'Lost-Soul-Token-Majestic-Heavens-NT',
    cardType: 'Lost Soul Token',
    brigade: '',
    strength: '',
    toughness: '',
    alignment: 'Neutral',
    identifier: '',
    specialAbility: '',
    reference: 'New Testament',
  },
  'Lost Soul Token OT (Majestic Heavens)': {
    name: 'Lost Soul Token OT (Majestic Heavens)',
    set: 'Pmo-P2',
    imgFile: 'Lost-Soul-Token-Majestic-Heavens-OT',
    cardType: 'Lost Soul Token',
    brigade: '',
    strength: '',
    toughness: '',
    alignment: 'Neutral',
    identifier: '',
    specialAbility: '',
    reference: 'Old Testament',
  },
};

export function findTokenCard(name: string): TokenCardData | undefined {
  return TOKEN_CARD_DATA[name];
}

/**
 * Redeemed-soul value of a Lost Soul by cardName. The Two/Three Liner souls
 * print "This card counts as two Lost Souls" — each counts 2 toward the
 * rescue goal and the Land of Redemption count once redeemed; everything else
 * counts 1. Duplicate of lib/cards/cardAbilities.ts; parity test enforces
 * equality.
 */
export const DOUBLE_VALUE_LOST_SOULS: ReadonlyArray<string> = [
  'Lost Souls (Two Liner)',
  'Lost Souls (Three Liner)',
];

export function lostSoulValue(cardName: string): number {
  return DOUBLE_VALUE_LOST_SOULS.includes(cardName) ? 2 : 1;
}

/**
 * REG "Redeemed Soul": how much a card sitting in a Land of Redemption counts
 * toward the rescue goal. Lost Souls (including token souls) count their
 * lostSoulValue; a rescued captured character (Hero / Evil Character) counts
 * 1; anything else that legitimately sits there — Guardian of Your Souls is a
 * Dominant — counts 0. The soul check mirrors the server's isLostSoulRow idiom
 * (type OR name) so a soul whose enrichment failed still counts.
 *
 * Every Land of Redemption count — goldfish HUD/badge, multiplayer badges,
 * the players' and spectators' score headers, and the server-side win check —
 * goes through this so they can never disagree. Duplicate of
 * lib/cards/cardAbilities.ts; parity test enforces equality.
 */
export function redeemedSoulValue(card: { type?: string; cardType?: string; cardName: string }): number {
  const t = (card.type ?? card.cardType ?? '').toLowerCase();
  const isSoul = t === 'ls' || t === 'token_ls' || t.includes('lost soul')
    || card.cardName.toLowerCase().includes('lost soul');
  if (isSoul) return lostSoulValue(card.cardName);
  if (isCharacterCard(card)) return 1;
  return 0;
}
