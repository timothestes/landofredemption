# Battle Zone ("Field of Battle") — Design Spec

Date: 2026-07-12
Status: Two review rounds incorporated — design review (Konva/layout + server/rules lenses), then spec review (implementability audit + REG-rules/UX judge audit).
Scope: Multiplayer play mode (`app/play`). Goldfish mode is out of scope except for shared-type fallout.

## 1. Overview

A dedicated battle zone for the Battle Phase. The 0.5%-tall divider between the two
territories animates open into a ~19%-height **Field of Battle** band. Both players drag
characters/enhancements in; the app computes side totals and initiative and automates
end-of-battle cleanup. Philosophy: **the app computes, players decide** — soft guidance,
no hard rules enforcement, everything manually overridable (consistent with Forge cards
having no mechanized abilities).

### Goals
1. Live strength/toughness totals per side, with side membership determined by card
   *placement* (own right half vs. the opponent's left half — every player plays into
   their own right, mirrored consistently on both screens), which transparently handles
   neutral cards, attacker-chosen blockers, and defender-drafted attackers.
2. Soft brigade-match warning when an enhancement has no matching-brigade character on
   its side (red pulse + toast with one-tap Discard). Never a hard block.
3. Auto-return after battle: survivors to their pre-battle territory spots, spent
   enhancements to discard, with carve-outs for attached weapons and "place" enhancements.
4. Live initiative banner per the REG Initiative Table (losing side; stalemate/mutual →
   whoever did not play the last card). **Special initiative is out of scope.**
5. Resolution flow: Claim Victory (attacker) / Battle Lost (defender) → soul-surrender
   dialog (T1: defender picks; T2 & Paragon: attacker picks, incl. Paragon shared
   LoB/soul-deck souls). An **unopposed rescue** (defender declines to block while souls
   are at stake — the most common battle in the game) also resolves through Claim
   Victory, dialog as usual. End Battle (either player) is only for no-stakes endings:
   stalemate, declined battle challenge, repelled attack (all attackers defeated), or
   escape hatch.

### Non-goals
Special initiative, automated ability resolution, automatic battle detection from phase
changes, hard legality enforcement, mobile-specific layout work beyond the Narrow profile.

## 2. Layout geometry

`calculateMultiplayerLayout` gains a `battleActive: boolean` parameter. Each profile gets
a battle variant. **Invariants (enforced by unit tests):**

- Row ratios sum to exactly 1.0 (sum-check comment like existing ones).
- T1/T2: the band's vertical midline equals the idle divider's center, so the board
  opens symmetrically around the seam. (Paragon has no divider — see the Paragon
  paragraph below.)
- Sidebar rects and `pileCard` dimensions are computed from the **idle** layout in all
  modes — piles never move or resize when battle opens/closes (reviewer F10).
- LoB heights unchanged (souls — the stakes — stay fully visible; `lobCard` stable).

Standard profile (idle divider center = 0.45):

| Row | Idle | Battle |
|---|---|---|
| Opp hand | 0.08 | 0.08 |
| Opp LoB | 0.09 | 0.09 |
| Opp territory | 0.2775 | 0.185 |
| Divider / Band | 0.005 | 0.19 (0.355–0.545, midline 0.45) |
| Player territory | 0.2775 | 0.21 |
| Player LoB | 0.09 | 0.09 |
| Player hand | 0.18 | 0.155 |

Narrow profile (idle divider center = 0.4525): band 0.17; opp territory 0.1975, player
territory 0.2125, player hand 0.15; opp hand/LoBs unchanged. Sum = 1.0.

Spectator: battle deltas compose on top of the existing spectator ratio mutation
(`multiplayerLayout.ts:292-298`); add a test that spectator+battle ratios also sum to 1.0.

Paragon: the band opens directly **below the shared LoB**, height taken equally from the
two territories. Shared LoB and Soul Deck shift up by half the band height during battle
(accepted); sidebar/pile geometry still comes from the idle layout and does not move.

Hand cards: existing cap logic (`handRect.height − 48`) shrinks hand cards ~13% while the
band is open; the size snap on open/close is accepted (no size tweens exist today).

Card sizes: `mainCard` stays width-derived (98×137 @1920) and is used in the band.
Because compressed territories can clip bottom-parked cards (positions are normalized,
write-time-clamped only), add a **render-time clamp** for free-form zones:
`y = min(y, zone.y + zone.height − cardHeight)` (mirrored for rot-180 opponent cards).

## 3. Coordinate model and side derivation

- **One zone string: `'battle'`.** One zone rect spanning the play-area width. No
  per-side zones, no stored side column.
- **Mirroring by card owner**, exactly like territories: positions stored owner-local
  (0–1), opponent-owned cards flipped at render (`toScreenPos(..., 'opponent')`, rot 180,
  bottom-right anchor). This automatically renders each player's cards on their own
  **right** half on *both* screens with zero new transform code — "whoever is attacking
  is on the right of the person attacking; if I'm defending, I block to the right" (every
  player plays into their own right half; mirroring renders my cards on my right, theirs
  on my left, consistently on both screens).
- **Side is derived, never stored,** from the card's owner-local **center**:
  `centerX = dbX + cardRelW / 2` (storage is top-left-anchored in the owner frame;
  rot-180 is render-only); side = `centerX >= 0.5 ? ownerSeat : opponentSeat`. The
  anchor alone is not equivalent: write-time clamping caps an own-card anchor at
  `1 − cardRelW`. In the left/right split this clamp is mild — `cardRelW ≈ 0.07` for a
  mainCard in a full-width band, so the clamped anchor (≈0.93) sits nowhere near the 0.5
  boundary — but `battleSideOf` still classifies from the center, never the anchor, so
  the math stays correct regardless of band/card ratio (the old top/bottom split's
  `cardRelH ≈ 0.67` made the anchor-vs-center distinction load-bearing; left/right just
  makes it a smaller margin, not a different rule). `battleSideOf(card)` lives in
  `app/play/lib/battleMath.ts` and is the single helper used by totals, initiative, and
  brigade checks. A card dragged past the centerline fights for the other side.
  Rationale for never storing: intra-zone drags go through `update_card_position`, which
  would never refresh a stored column.
- **Half membership is center-point-based** (a mainCard can be wider than a half-band at
  small scales; containment clamping degenerates). Cards clamp to the *full band* rect
  only.

## 4. Interaction

- **Hit-testing:** insert the band rect at the **front** of `findZoneAtPosition`'s check
  order, before territory rects — reachable only while the band is visible (phase-driven,
  see "Starting a battle" below); there is no idle divider-proxy strip. Half detection
  compares drop-center X to the centerline.
- **Ownership never transfers on battle drops:** battle drops send `targetOwnerId: ''`.
  (Modeling halves as owner-scoped zones would hand your hero to the opponent — F2.)
- **Starting a battle:** phase-driven, not drag-driven. The turn player calling
  `set_phase(gameId, 'battle')` opens the band when `battleState===''`: sets
  `battleState='active'`, `battleAttackerSeat` = the seat whose turn it is (not who
  drags first), and clears `lastBattlePlayBySeat` — the same open step `enter_battle`
  used to perform on the first drop. Leaving the battle phase (`set_phase` to any other
  phase) or ending the turn auto-returns and closes the band, mirroring the existing
  end_turn hook. The divider-proxy drag-to-open path is REMOVED — the phase bar
  (`TurnIndicator`) is the only opener. `enter_battle` is retained for two narrower
  cases where the band is already visible but `battleState===''`: starting a second
  battle in the same phase after an End Battle close, and modal drops (`useModalCardDrag`)
  that target the band directly.
- **Mid-drag safety (the old attempt's killer):**
  - Battle open/close layout flips are **deferred while `isDraggingRef.current`** and
    flushed at dragend (zone rects are recomputed at drop already; the problems are the
    dragged node teleporting via unconditional `x`/`y` props and stale snap-back refs).
  - Add an effect: if the dragged card's row changes zone server-side (e.g. opponent's
    end_battle auto-returned it), call `node.stopDrag()` and clear drag refs — never let
    react-konva destroy a node mid-drag (ghost-card class).
- **Weapons in battle:** extend the attach drop gate (today `territory && owner==='my'`)
  to accept battle-zone hosts; add a battle derived-weapon-position map (like territory's);
  server `attach_card` keeps `attachZone='battle'` when the host is in battle and stamps
  the weapon's battle fields from the host.
- `isFreeFormZone` learns `'battle'` (drives posX/posY writes, clamping, rotation adjust,
  same-zone repositions, batch positioning). Rotation adjust for battle targets keys on
  **card owner**, not target half. Marquee bounds (`allCardBounds`) and hover-glow rects
  (`allZoneRects`) include the band.

## 5. Rendering and animation

- **Single-step layout flip** (no per-frame React layout animation — it thrashes every
  memo and destroys/recreates FLIP tweens each frame). Cards glide via the existing
  `useHandLayoutTween` FLIP pattern extended with slot maps for territory/battle cards.
  Opponent-owned glide targets must bake the `+(cardW, cardH)` rot-180 anchor (PR #176
  lesson). The band background rect alone gets a one-off `Konva.Tween` for the
  "seam opens" visual.
- **Band chrome (Konva):** a **vertical** dashed centerline at the band's midX (own
  right half vs. opponent's left, per §3). Per-half totals chips (`⚔ STR/TGH`) **flank
  the centerline at the BOTTOM of the band**, 8px above its bottom edge (PR #197 —
  "move the numbers to the bottom of the band"; previously vertically centered) — the
  opponent's chip just left of midX, my chip just right of it. The
  header line stays **top-center**, spanning the band: "⚔ <attacker name> attacking —
  Rescue attempt | Battle challenge" (derived from `battleAttackerSeat` + stakes-LoB
  count). The initiative/status banner renders as a **compact single-line strip
  horizontally centered just below the band's bottom edge, outside the band** (PR #197 —
  moved out from beneath the header now that the chips no longer occupy the top
  corners); falls back to right-aligned (still below the band) if the centered strip
  would collide with the button row at narrow viewports. Text stays horizontal, nothing
  rotates. At 1366px the mainCard is 80%+ of band height and cards can straddle the
  centerline, so chips and the header get a backdrop and render **above** card nodes.
  Banner states key on which side is empty **relative to the attacker**: defender side
  empty → "Waiting for a blocker…"; attacker side empty → "No attacker in battle — End
  Battle?"; both populated → "⚔ INITIATIVE: <name> — losing / stalemate / mutual
  destruction". (The former attacker-only "No block? Claim Victory to rescue." sub-line
  was removed on product direction.)
- **Band buttons (HTML overlay via `virtualToScreen`,** zIndex between drag overlay 450
  and toasts 900): `⚑ Win Battle` (attacker only; the attacker's resolve action —
  formerly labeled "Claim Victory"), `🏳 Battle Lost` (defender only),
  `↩ End Battle` (both) — anchored just below the band's **bottom-left** corner (PR #197;
  previously bottom-right, where it overlapped the sidebar's Territory pile at narrower
  viewports).
- **Battle toasts:** every existing overlay (game toasts, emote overlay, request
  banners) is `pointerEvents: none` and top/bottom-anchored — none can host a button.
  Brigade-mismatch toasts (which carry a tappable **Discard** button) render in a NEW
  dedicated band-edge-anchored container with pointer events enabled, zIndex between
  the drag overlay (450) and toasts (900).
- **Drag-target guidance cue (PR #197):** while it's a player's move — their own side
  empty and either they're attacking or they're defending against an attacker who
  already has a character down, never during `awaiting-soul`, never for spectators — a
  dashed/tinted panel with ghosted "Drag attackers here" / "Drag a blocker here" text
  pulses gently on the viewer's own right half, below card nodes in z-order.

## 6. Battle math (client, pure lib + tests)

`app/play/lib/battleMath.ts`:
- Totals per side: Σ `parseInt(strength|toughness)` over that side's cards; unparseable
  (`''`, `*`, `X`) counts 0 and sets a `hasUnknown` flag rendered as `?` on the chip.
  Face-down cards (`isFlipped`) are excluded from sums and shown as `+?` (no info leak).
- Initiative per REG: side A **losing** iff `strA < tghB && tghA <= strB` → A has
  initiative; both `tgh > opp str` → stalemate; both `str >= opp tgh` → mutual
  destruction; stalemate/mutual → seat ≠ `lastBattlePlayBySeat`. Forge cards blank
  stats for non-granted spectators — accepted display noise.
- **Unknown-stat honesty:** when either side has `hasUnknown` or a face-down card, the
  banner must not assert a rules conclusion from zero-filled stats — it degrades to
  "⚔ INITIATIVE: unknown (variable/face-down stats)". The chips keep their `?` markers.
- Brigade soft-check: enhancement's brigade tokens (split on `/`, trimmed) ∩ brigades of
  same-side characters; neutral/generic matches anything. On mismatch: red pulsing border
  + toast "No matching brigade in battle — REG says discard it" [Discard]. Non-blocking.
- Existing `pass_initiative` toast handshake stays as the manual override.

## 7. Server model (SpacetimeDB)

All state must be reconstructible from rows (reconnect/spectator-join safe). Schema
changes require the `spacetimedb-deploy` skill and a `--clear` republish on dev.

**Game columns** (all `.default('')`, rollWinner-style strings):
- `battleState`: `'' | 'active' | 'awaiting-soul'`
- `battleAttackerSeat`: `'' | '0' | '1'`
- `lastBattlePlayBySeat`: `'' | '0' | '1'`
- **Must be added to the `respond_rematch` in-place reset list** (F1) — and to no other
  reset path; resign/finish leaves them dangling by design, so **all battle UI gates on
  `status === 'playing'`.**

**CardInstance columns** (`.default('')`): `originZone`, `originPosX`, `originPosY`.
No `battleSide` column (derived — §3).

**Zone-string blast radius** — `'battle'` must be added to:
- `clearCountersIfLeavingPlay` + `leavePlayFieldOverrides` in-play lists (counters/notes/
  meek/outline must clear on battle→discard/hand/etc.). `leavePlayFieldOverrides` also
  clears the three origin fields whenever `toZone !== 'battle'` — **clearing lives only
  here**, because both move reducers have three completing write paths (token-delete,
  lost-soul redirect, main) and ad-hoc clears will miss one (F3).
- `ABILITY_SOURCE_ZONES` — **6** copy-pasted server sites (index.ts 2188, 3957, 4077,
  4126, 4234, 5324 → extract one shared const) **plus the client gate**
  `DEFAULT_ABILITY_SOURCE_ZONES` in `lib/cards/cardAbilities.ts` (and its
  `spacetimedb/src/cardAbilities.ts` duplicate) — without the client change the
  right-click menu items stay hidden even though the reducers would accept them.
  Abilities with explicit per-ability `sourceZones` arrays keep their lists (extend
  case-by-case later).
- `shuffle_card_into_deck` and `move_opponent_card` bypass BOTH central helpers (they
  call neither `leavePlayFieldOverrides` nor `clearCountersIfLeavingPlay` — a
  pre-existing counters/notes leak from territory, incidentally). Route their zone
  writes through the helpers; `move_opponent_card` additionally must not accept
  `toZone='battle'` (stamping bypass).
- Client `ZoneId` union fallout (adding `'battle'`): `ZONE_LABELS`
  (`Record<ZoneId, string>`) needs an entry; goldfish `zoneLayout.ts` returns a
  fully-keyed `Record<ZoneId, ZoneRect>` and needs an off-canvas placeholder rect
  (follow the `paragonZone` precedent). `ALL_ZONES`: include `'battle'` and audit the
  shared iterators (`MultiCardContextMenu`, `ZoneBrowseModal`, `refill.test`) — note
  goldfish `createEmptyZones` builds from `ALL_ZONES` through a cast, so omission does
  NOT fail the build, it silently yields `zones['battle'] === undefined` at runtime.
- `HOME_ZONES`/`HIDDEN_HOME_ZONES`/`GRAVEYARD_PILE_ZONES`/`TOKEN_REMOVE_ZONES` correctly
  exclude battle — no change.

**Reducers:**
- `enter_battle(gameId, cardId, toPos)`: if `battleState===''` → set `'active'`, set
  `battleAttackerSeat` from `currentTurn`, clear `lastBattlePlayBySeat`; then move+stamp.
  Refuses when `status !== 'playing'`.
- `move_card` / `move_cards_batch` battle extensions: on entry into `'battle'`, stamp
  origin fields (from the card's pre-move zone/pos) + `lastBattlePlayBySeat` = **card
  owner's seat** (not sender — courtesy drags must not steal last-play). Never stamped by
  `update_card_position` (intra-band drags), exits, or token spawns. When
  `toZone==='battle'` but `battleState !== 'active'` → **redirect to territory** (mirror
  the lost-soul redirect pattern) so undo replays and stale dispatches can't create
  invisible cards in a closed band (F3/F10-undo).
- `resolve_battle(gameId)`: caller must be attacker (Claim Victory) or defender (Battle
  Lost); **refuses unless `battleState === 'active'`**. Paragon: run `refillSoulDeck`
  first so a transient empty shared LoB can't misclassify a live rescue as a challenge.
  If the stakes LoB (T1/T2: defender's; Paragon: shared) holds ≥1 Lost Soul →
  `battleState='awaiting-soul'`; else (battle challenge / nothing left to rescue) →
  auto-return + clear. Unopposed rescues resolve HERE, not via end_battle.
- `surrender_soul(gameId, cardId)`: **refuses unless `battleState === 'awaiting-soul'`**
  (kills the end_battle race — otherwise a defender's End Battle landing while the pick
  is in flight lets a soul score after the battle cleared). Caller permission by
  `normalizeFormat(game.format)` — T1: defender; T2/Paragon: attacker. Validates the
  card is a Lost Soul in the eligible LoB. Transfers via the existing
  **`moveLostSoulToLor(ctx, gameId, card, targetOwnerId, game)`** primitive targeted at
  **the attacker's LoR** regardless of caller (it already handles ownership transfer,
  site unlink, LoB compaction, Paragon shared-soul `ownerId 0n`, and `refillSoulDeck`).
  Every format (T1, T2, Paragon) awards exactly one soul per battle, so the reducer then
  auto-returns + clears `battleState=''` **unconditionally, in the same reducer** — never
  rely on a second client call (a disconnect between calls strands the state).
- `end_battle(gameId)`: either player, callable from **both `'active'` and
  `'awaiting-soul'`** — the unconditional escape hatch (defender can `reload_deck` away
  every surrenderable soul, or the picker can disconnect). When the caller is the **turn
  player**, it also advances `currentPhase` to `'discard'` after the auto-return (band
  collapses, the game moves on); a non-turn-player press remains auto-return-only and
  leaves the turn player's battle phase alone.
- `end_turn`: when `battleState !== ''`, run the auto-return routine first (battles
  cannot span turns).

**Auto-return routine** (shared helper; snapshot rows first, local per-(owner,zone)
zoneIndex counters — never re-derive from a stale snapshot):

Iterate rows currently in `zone==='battle'` (never a remembered id list — cards may have
been deleted by `reload_deck`):
1. Attached accessories (`equippedToInstanceId ≠ 0`) move with their host, attachment kept.
2. Lost Souls → owner's LoB (existing redirect semantics).
3. `isCharacterCard(...)` (handles duals + tokens) → `originZone==='territory'` ? origin
   position : a free territory spot (hand/reserve/discard-origin survivors go to
   territory per REG, never back to hidden zones).
4. Enhancements — exact `GE`/`EE` segment match on `cardType` (split on `/`, trim; there
   is **no** literal `"Enhancement"` type) → owner's **discard**, *unless* the keep
   heuristic matches: `/\bplace\b/i` on `specialAbility`, excluding "in place of" /
   "take the place of" phrasings → owner's territory free spot. Tokens whose
   destination is a removal pile go through `deleteTokenWithCounters`, not a move.
   **Dominants** (exact `Dominant` segment) follow the same rule — discard unless the
   keep heuristic matches. *(Amended 2026-11-01: they were originally in rule 5, which
   sent a Dominant played from hand back to the hand.)*
5. **Everything else — Artifacts, Curses, Fortresses, unknown types, and all
   Forge cards (their `specialAbility` is blanked on the public row, so `/place/i` can
   never match) → return to origin, never discard.** Discard is the destructive branch;
   default away from it. Players drag to fix mis-routes.

All routed writes clear the origin fields. One `BATTLE_END` logAction whose summary
**names every enhancement kept in play** (heuristic mis-routes are then one glance +
one drag to fix). Everything stays manually draggable afterward.

**Subscriptions:** no changes — player and spectator hooks already subscribe CardInstance
filtered only by gameId with the predicate on the hook. New Game columns flow through the
existing unfiltered Game `useTable`.

## 8. Resolution UX

- Attacker presses **Claim Victory** (win, mutual destruction, or unopposed rescue — a
  soul is rescued in all three per REG), or defender presses **Battle Lost** →
  soul-surrender modal for the chooser (T1 defender / T2+Paragon attacker) listing
  eligible souls as card images. Site-attached souls are badged ("⚑ in Site") so they
  aren't picked by accident; "cannot be rescued"-type souls remain table-talk — the
  dialog lists all souls and players self-police. If the LoB empties mid-pick (Dominant
  snipe), the dialog shows an explicit empty state with an inline End Battle button.
  Pick → soul glides to the attacker's LoR; the band auto-returns and closes immediately
  — every format (T1, T2, Paragon) awards exactly one soul per battle, so there is no
  "surrender another" loop.
- **End Battle** → no soul dialog, auto-return, band closes (stalemate, declined battle
  challenge, repelled attack, or escape hatch). **Never for unopposed rescues.** The turn
  player's press also advances the phase to `discard` (band collapses); a non-turn-player
  press remains an auto-return-only escape hatch.
- **All three buttons (Claim Victory / Battle Lost / End Battle) dispatch their reducer
  immediately on click — no confirm dialog.** Once the battle actually closes (auto-return
  has run server-side), each client independently fires a transient (~5s) non-interactive
  toast summarizing what happened — "Battle ended — 3 characters returned ·
  2 enhancements discarded · 1 kept in play" — via the existing game-toast mechanism.
  Built client-side from `summarizeAutoReturn` over a ref snapshot of the rows each
  client saw in the band immediately before `battleState` flipped to `''` (no server
  round-trip needed; `battleCardEntries` is already empty by the render where the flip
  itself lands).
- Defeated characters must still be dragged to discard manually *before* resolving — the
  routine only routes what's still in the band, and with no confirm step there is no
  "cancel and go back" safety net anymore: resolving first resurrects every "defeated"
  character back into territory as a survivor (also the mutual-destruction guard).
  Soul-surrender dialog/pill visibility is a pure function of `battleState` + format +
  seat (reconnect-safe). Spectators see a status line ("Waiting for <name> to choose a
  soul…"), never the modal; the non-chooser gets an End Battle escape button, also
  confirm-free. **End Turn during `awaiting-soul` gets a client confirm** ("A soul
  surrender is pending — end turn anyway?") — this one guards a different mistake and
  stays; the server end_turn hook remains the ultimate fallback.

## 9. Edge-case matrix

| Event mid-battle | Behavior |
|---|---|
| Resign / claim_timeout_victory | Game finishes; battle columns left dangling; all battle UI gated on `status==='playing'`; rematch reset clears them |
| Rematch accepted | `respond_rematch` resets battle columns (F1) |
| reload_deck | Deletes caller's battle cards; auto-return iterates live rows, degrades gracefully; `end_battle` escape always available |
| Opponent ends battle while I'm dragging | Layout flip deferred to dragend; stopDrag guard if my dragged card's row moved |
| Undo of a battle move after close | Server redirects `toZone='battle'` → territory |
| Same-turn second battle | `enter_battle` guard + origin fields re-stamped on entry; end-battle writes cleared them |
| Card re-dragged battle→territory→battle | Origin re-stamped (records the adjusted spot — fine) |
| Face-down card in battle | Excluded from totals, `+?` chip marker, banner degrades to "initiative unknown"; row data is already client-visible today (UI-masked only) — unchanged |
| Spectator joins mid-battle | Full state from rows; band renders; read-only; during `awaiting-soul` sees a status line, never the modal |
| end_battle vs surrender_soul race | `surrender_soul` refuses unless `battleState==='awaiting-soul'` — no soul can score after the battle cleared |
| End Turn during `awaiting-soul` | Client confirm ("soul surrender pending"); server end_turn hook auto-returns as fallback |
| Dominant ends the battle from hand (SoG/AoD) | Manual card play, then End Battle; during `awaiting-soul` the soul dialog live-updates (empty state if souls are gone) |
| Band empties entirely (retreat drags / all defeated) | `battleState` stays `'active'`, no auto-close; End Battle or end_turn closes it |
| Attacker side empties mid-battle | Banner switches to "No attacker in battle — End Battle?"; no auto-close |
| Non-turn player opens the band first (pre-emptive blocker) | `battleAttackerSeat` = turn seat regardless of who dragged |

## 10. Testing

- **Unit (vitest):** `battleMath` (all four initiative-table rows incl. the `<=`/`<`
  boundaries; center-based side derivation `dbX + cardRelW/2` incl. opponent mirroring
  AND the anchor-clamp regression — anchors max out at `1 − cardRelW`, so an
  anchor-based test must fail; neutral placement; face-down exclusion + banner-unknown
  degradation; unparseable stats); layout invariants (sums = 1.0, midline pinned
  **against the same-viewerKind idle layout** — the spectator idle center is 0.485, not
  0.45; idle-keyed sidebar, all profiles × formats × viewerKinds); auto-return routing table
  (every cardType class incl. duals `GE/Evil Character`, `Fortress / Evil Character` with
  stray spaces, tokens, Forge blanked rows, weapons-follow-host, place-enhancements).
- **E2E (verify skill, two sessions):** T1 full rescue (present → block → enhance →
  claim → defender surrender → LoR score + auto-return); T2 attacker-picks path; Paragon
  shared-soul surrender + soul-deck refill; escape hatch from `awaiting-soul`; end_turn
  auto-close.

## 11. Implementation phases

1. **Server:** schema columns + shared const extraction + stamping/clearing + redirect
   guard + reducers + auto-return + rematch reset. Deploy via `spacetimedb-deploy`
   (`--clear` on dev). Bindings regen. **Prod rollout:** the prod module publish must be
   paired with a Vercel deploy carrying the regenerated bindings (a bindings-only client
   deploy with no battle UI keeps the app shippable); already-open sessions need a
   refresh — schedule the publish accordingly.
2. **Layout:** battle profile variants + invariants + unit tests. `battleActive` param.
3. **Canvas plumbing (static band):** hit-test order, divider proxy, `isFreeFormZone`,
   render blocks (both owners, render-time clamp), drag-size/rotation rules, marquee/
   hover, weapon attach in battle.
4. **Battle math UI:** totals chips, initiative banner, brigade soft-check + anchored
   interactive toast.
5. **Resolution:** band buttons, `resolve_battle`/`surrender_soul` dialogs, end_turn
   hook, escape hatches.
6. **Animation & drag safety:** FLIP glides (battle + territory slot maps, rot-180
   anchors), band bg tween, mid-drag deferral + stopDrag guard.
7. **Formats & fallout:** Paragon band stacking, spectator deltas, goldfish `ZoneId`
   fallout, E2E passes.
