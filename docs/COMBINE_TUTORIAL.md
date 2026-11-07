# Combine tutorial — status + open issues

A short, scripted guided tutorial for Combine shipped across T-0200 →
T-0206. This note records where we stopped so future work can pick up
without re-reading the task history.

## Current shape

- **Mode**: `mode === "tutorial"` on `GameState`. Behaves like endless at
  the reducer level (`isClassic(mode) === true`) but never persists to
  any save slot, never calls the server run endpoints, never writes to
  `combine_discoveries`, and never updates best scores.
- **Entry points**:
  - First-visit landing nudge (dismissible banner, bottom-center).
  - "Tutorial" card in `ModeThemePicker` → "Learn" section (shown
    regardless of selected theme).
  - More menu → "Replay tutorial" (TopBar).
  - URL deep-link: `/combine?m=tutorial`.
- **Flag**: `authUser.hasSeenCombineTutorial` (bool, default false).
  Anon users fall back to `localStorage["madeof:cbtut"]`.
  Flipped on completion, on dismiss, or when the player closes the
  overlay via the X.
- **Scripted dealer**: `DealerView.scripted?: string[]` + matching
  `GameState.scripted?: string[]`. When present and non-empty,
  `dealTray` consumes from the front and bypasses every heuristic. Tops
  up with `pickOne` once the queue runs dry so the player can keep
  playing a real run after the tutorial deck ends.
- **Deck**: `TUTORIAL_DECK_SLUGS = ["rock", "water", "rock", "water",
  "rock", "water"]`. Universal ingredients; ChoicePicker opens on the
  combine (clay / soil / hot spring pool) and that's intentional —
  picker is a real mechanic worth teaching.
- **Opening board**: empty. `newGame` skips the 5-tile random seed when
  `mode === "tutorial"` so nothing can auto-combine with the deck or
  clutter step 1.
- **FSM (4 states)**: welcome → firstCombine → secondCombine → done.
  Each advance is triggered by a single `dealt` event, with one event
  consumed per transition so no state is skipped. `nextStep` is pure.
- **Step table** (see `src/combine/tutorial.ts`):

  | # | Step id | Trigger | Spotlight | Copy |
  |---|---|---|---|---|
  | 1 | `welcome` | 1st `dealt` | tray | "Drag all three tray tiles onto the board. Place touching tiles to combine them." |
  | 2 | `firstCombine` | 2nd `dealt` | chapter bar | "You made {clay/soil/...}. Every combine scores and lands in your collection." |
  | 3 | `secondCombine` | 3rd `dealt` | tray | "The dealer handed you more tiles. Combine them the same way — try making something new." |
  | 4 | `done` | (terminal) | — | overlay closes |

- **Dynamic copy**: step 2's copy is a function
  `({ lastOutName }) => string`. `CombineBoard` captures the output
  name from each `combine` event and threads it into `<TutorialOverlay
  lastOutName={…} />`.
- **Overlay** (`TutorialOverlay.tsx`): native, no third-party library.
  Portaled to `document.body`. A positioned div with the amber-glow
  box-shadow pulse (same vocabulary as the landing hero's chain beam —
  see `.heroChain-pulse` / `.cbtut-overlay-spotlight` / `@keyframes
  cbtutGlow` in `globals.css`) traces the target zone's
  `getBoundingClientRect()`. A floating popover anchored next to it
  carries the copy + a close X. `pointer-events: none` on both the
  container and the spotlight so drag-and-drop passes through; only the
  popover's close button catches events. `ResizeObserver` + `scroll`
  listener re-measure on movement.
- **Pause**: the overlay hides while any of `bookOpen / soundOpen /
  experimentsOpen / helpOpen / agesOpen / onboardOpen / wipeConfirm /
  overCardOpen / feedback` is open. Choosing (ChoicePicker) and
  infoTile (DetailCard) are **not** in the pause list — they're part of
  normal gameplay and the tutorial copy should stay visible underneath.
- **Mode chip**: during a tutorial run the TopBar's theme/mode chip
  reads "Tutorial" (amber accent + open-book glyph) instead of falling
  through to "Endless".

## Why reactour got ripped out (T-0203)

Original implementation used `@reactour/tour`. Mask's `clickArea` rect
has inline `pointer-events: auto` that caught every pointer outside the
spotlight cutout — swallowed drops onto the board. `disableInteraction=
{false}` only toggles the cutout's display; it doesn't change
`clickArea`. Plus 6 added packages + 18 npm audit warnings for
something we were overriding ~80% of.

Native overlay (`TutorialOverlay.tsx`, ~110 lines) solves it cleanly:
pointer-transparent by default, glow visual matches the app's existing
hero/attention vocabulary, zero deps, trivial to extend.

## Known issues / rough edges

1. **Deck is very short.** Six tiles → the tutorial ends after the
   player makes two combines. The user plans to lengthen / rewrite the
   script. Hooks for that are already in place (`TUTORIAL_DECK_SLUGS`
   is a slug array; new steps need (a) a new `TutorialStepId`, (b) an
   entry in `TUTORIAL_STEPS` + `TUTORIAL_STEP_ORDER`, (c) an
   `advanceOnce` branch).
2. **Picker opens on step 1.** rock+water has 3 valid outputs. Players
   see "These make more than one thing. Pick one." — we decided this is
   fine (teaches the mechanic) but if it turns out to confuse first-time
   players, two paths:
   - Find a slug pair with exactly one output (requires grep over the
     bundle's `sameIngredients` map).
   - Add an explicit tutorial step for the picker, highlight-pointing at
     it when `state.choosing !== null`.
3. **No chain / crumble / shelf / hold teaching.** Current flow only
   covers combine + score + re-deal. Everything else the player learns
   by playing (Helpers menu, crumble counters, hold zone). Candidate
   future steps are easy to add; each needs an engine event to key on:
   - Chain: `state.longest >= 2` (used to be `keepGoing`'s condition
     before we cut it)
   - Crumble warning: `type: "crumble"` event
   - Shelf: `type: "shipped"` event
   - Hold: watching `state.hold` for a non-null slot
4. **No "I understand, skip" button inside the tour.** The close X exits
   the whole tutorial. If we want per-step "got it, next" controls, add
   them to the popover.
5. **Popover positioning is `position: fixed` relative to the target
   rect.** On very short mobile viewports the popover can overlap the
   target. Mitigation already present: popover auto-flips above the
   target when there isn't enough room below. Hasn't been stress-tested
   on all phone sizes.
6. **`tutorialLastOutName` only tracks the most recent combine.** If a
   chain produces multiple outputs, step 2 reads the last one. That's
   probably what we want but worth noting.
7. **`scripted` is not serialised.** Tutorial runs never persist, so
   this is by design. If we ever want to let players pause and resume a
   tutorial, serialisation would need wiring in `storage.ts` (`toStored`
   / `hydrateGame`).
8. **The engine's `ENGINE_VERSION` wasn't bumped.** The `scripted` field
   is additive and only populated in tutorial mode, which never posts
   to the server. Per CLAUDE.md's bump rule, non-tutorial reducer
   output is byte-identical, so skipping the bump is correct.

## File map

| File | Role |
|---|---|
| `src/combine/tutorial.ts` | FSM + step table + deck (slugs) + resolver + `resolveTip` + `tutorialPlayableOn` + localStorage helpers |
| `src/combine/deal.ts:30-55,276-296` | `DealerView.scripted` queue consumption |
| `src/combine/engine.ts:118,842,862` | `state.scripted` field, cloneState copy, empty-board for tutorial |
| `src/combine/storage.ts:186-195` | `saveGame` short-circuit on `mode === "tutorial"` |
| `src/components/combine/TutorialOverlay.tsx` | Native overlay |
| `src/components/combine/CombineBoard.tsx` | `startTutorial`, `dismissTutorialNudge`, `tutorialStep` state, event-to-step wiring in `act`, overlay mount |
| `src/components/combine/CombinePageBody.tsx:146-168` | Server-reads `hasSeenCombineTutorial`; honours `?m=tutorial` |
| `src/components/combine/board-parts/overlays/ModeThemePicker.tsx` | "Learn" section + Tutorial card |
| `src/components/combine/board-parts/board/TopBar.tsx` | Mode chip reads "Tutorial" + More menu "Replay tutorial" entry |
| `src/components/combine/board-parts/board/TipLine.tsx` | No tutorial coupling (clean) |
| `src/app/api/combine/tutorial-seen/route.ts` | POST → flip `hasSeenCombineTutorial` |
| `src/db/schema.ts:389-396` | `authUser.hasSeenCombineTutorial` column |
| `drizzle/0028_chunky_calypso.sql` | Migration |
| `src/app/globals.css` | `.cbtut-nudge*`, `.cbtut-overlay*`, `@keyframes cbtutGlow`, `.cbmtpTutorial`, `.cbtheme-tutorial` |
| `src/combine/__tests__/tutorial.test.ts` | 17 unit + integration tests |

## Related tasks

- T-0200 — initial implementation (mode, scripted dealer, flag, nudge)
- T-0202 — reactour attempt (reverted)
- T-0203 — native overlay with amber-glow spotlight
- T-0204 — discoverability (mode picker card + renamed More menu)
- T-0205 — dynamic step 3 copy + FSM cascade fix + tray highlight
- T-0206 — rock+water deck, 3-step arc, empty tutorial board

## Pick-up checklist for future work

- To extend the tutorial: new step ids, new copy, new `advanceOnce`
  branches.
- To change the deck: edit `TUTORIAL_DECK_SLUGS`. `tutorialPlayableOn`
  is slug-driven; no theme-bundle gymnastics required.
- To change the glow: `.cbtut-overlay-spotlight` + `@keyframes
  cbtutGlow` in `globals.css`.
- To change pause behaviour: edit the `paused={…}` prop at the
  `<TutorialOverlay>` mount in `CombineBoard.tsx`.
