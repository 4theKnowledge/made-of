# Combine Daily — Manifest / Find-List Variant (Design Spike)

**Task:** T-0237 · **Status:** approved — implementation in progress
**Parent:** T-0233 · **Implementation subtasks:** T-0240..T-0245 · **Priority:** P1 (daily is unplayable without this)
**Author:** claude · **Date:** 2026-11-08

> A 40-discovery daily finishes in ~2 min because "any 40 discoveries" degenerates to "combine fast". The manifest variant replaces the count with a **named shopping list** — identical for every player on the day, surfaced up-front, tracked during play, and settled on the end card.

**Scope — daily only.** Endless and fast modes are untouched. Every change is gated on `state.manifest != null`; absent that, the engine, dealer, and UI behave exactly as they do today. Manifest is a daily-only play mode.

**Revision 2026-11-08:** With only 2 playtesters in prod and a strong "no dead code" preference, target-count daily is being **ripped out entirely** rather than kept as a mutually-exclusive co-tenant. `combine_dailies` and `progress WHERE kind='combine'` get truncated; `DailyConfig.manifest` is **required** (not optional), `DailyPayload.manifest` is required (payload version stays 1 since no v1-shaped data survives the wipe), `GameState.target` + `DEFAULT_TARGET_DISCOVERIES` + `resolveDailyTarget` + `dailyTargetForRun` all get deleted. The migration path from the design note's "coexistence" plan is: delete the old shape, not shim it.

**JourneySheet as the manifest hub.** Rather than introduce a dedicated `ManifestTracker.tsx`, the existing `JourneySheet` (opened from the hold bar) is where the in-run manifest list lives. A compact pill above the shelf shows `Manifest  3/8  ›` and taps through to the JourneySheet's daily branch, which renders the shared grid with tap-to-info on each tile. Three surfaces share one `ManifestGrid` primitive: start-sheet, JourneySheet, end-card.

---

## Recommendation — **Variant 1c (Themed + Reachable + Curated-overlay)**

Pick **1c**: Admin names a **theme/category**; generator selects N **reachable** items from that category using the day's RNG; admin can **pin** up to K slots with explicit overrides (rejected at save-time if unreachable). This keeps the editorial voice of 1a without the operational cost of babysitting rejections, and avoids 1b's "list feels random" failure mode.

Settled stances on the 8 open questions:

1. **List composition** — **All-or-nothing win, graded completion.** Win = all manifest items found. Leaderboard sort: `(manifest_found DESC, moves ASC, durationMs ASC)`. Partial completions still post to the leaderboard with a `found/total` grade. Keeps "daily puzzle" identity but is kind to new players (they still get a rank).
2. **List size** — **8 items**, fixed. Four columns × two rows of pictograms fit the start card and the in-run tracker without a scroll. Admin may override to 6–12 via the per-day cell.
3. **Reachability guarantee** — **Hybrid (1c)**. Generator picks reachable items from a theme/category pool; admin overrides are validated at save-time and rejected (with suggested near-matches) if unreachable. No silent drops — the admin always sees why.
4. **Dealer bias toward manifest items** — **Reuse `guestIngredient` scaffolding.** The manifest items are injected as guest recipes with `minBand=1` (full pool) — they ride the existing dealer's reachability flow. **Add** a soft bias (+0.3× dealer weight) on tiles that are direct partners of unfound manifest items. Cheap to implement; measurable in playtest.
5. **Fairness under a shared seed** — seed + manifest live in `DailyPayload`; rotation history applies to the manifest pool so the same item doesn't appear two days in a row. Scoring is turn-count then time, both server-stamped — impossible to game.
6. **UI shape** — start-daily sheet with pictogram grid, in-run collapsible find-log docked above the shelf, end-card manifest panel with checkmarks and greyed-out misses. Wireframes below.
7. **Collection interaction** — unchanged. Manifest finds write `combine_discoveries` with `scope='daily'` via the existing discovery path. No new scope, no new table.
8. **Backwards compat** — `DailyConfig.manifest?` is **optional**; absent → today's target-count behaviour is preserved verbatim. Co-existence per theme/day via the opt-in field.

---

## Data model

```ts
// daily-config.ts — new optional branch
export interface DailyConfig {
  guestIngredient?: { perRun: number; minBand: number };
  targetDiscoveries?: number;
  targetByDow?: Record<string, number>;

  /** Opt-in manifest variant. When present at schedule-build time, the
   *  day's payload carries `manifest: string[]` and `targetDiscoveries`
   *  is ignored. */
  manifest?: {
    /** Theme/category id — a kind code, a tag, or a combine-theme code.
     *  Items in this pool are candidates for the generated manifest. */
    pool: string;
    /** Target manifest size. 6–12. Default 8. */
    size: number;
    /** Admin-pinned item ids (0–size). Must be reachable; validated at
     *  save-time with a reachability check against the capped bundle. */
    pins?: string[];
    /** +X.X dealer bias on tiles that are direct partners of unfound
     *  manifest items. 0 disables the bias. Default 0.3. */
    partnerBias?: number;
  };
}

// daily-schedule.ts — new payload field
export interface DailyPayload {
  version: 2;                 // bumped
  config: DailyConfig;
  guestOutputIds: string[];
  seed: number;
  targetDiscoveries?: number; // legacy / mutually exclusive with manifest
  manifest?: string[];        // frozen ordered item ids for the day
  generatedAt: string;
}
```

Why `version: 2`: the payload shape acquires a new mutually-exclusive branch. Readers that see `version: 1` continue treating `targetDiscoveries` as authoritative; `version: 2` with `manifest` present wins. Legacy rows are untouched.

---

## Reachability-verification algorithm (runs during schedule generation)

```
buildManifestForDay(fullBundle, cappedBundle, config, day, rotation):
  pool := itemsInPool(fullBundle, config.manifest.pool)
            filter: id is an output OR a base ingredient of fullBundle
            filter: id is reachable in cappedBundle (see isReachable)
  size := config.manifest.size                       # 6..12
  pins := config.manifest.pins ?? []

  # 1. Validate pins. Save-time already ran this, but we re-run here
  #    because the capped bundle for `day` may differ.
  for p in pins:
    if not isReachable(p, cappedBundle):
      throw UnreachablePin(p, suggest = nearestReachable(p, pool))

  # 2. Derive the generator pool (pool minus pins).
  genPool := pool \ pins
  # 3. Rotation: prefer items not served in the last rotationWindow days.
  rand := mulberry32(hash("manifest:" + day))
  weighted := applyRotation(genPool, rotation, day)   # mirrors pickGuests
  picks := pins ++ sampleWithoutReplacement(weighted, size - pins.length)

  # 4. Forward-simulate a bounded reachability proof. The dealer uses
  #    the SAME seed players will see, so if the sim can produce every
  #    manifest item within a turn budget from an empty board, the day
  #    is certified solvable. If not, drop the offending item and
  #    resample (max 3 attempts), else error and require admin to
  #    loosen the pool / lower size.
  if not simulateReachable(picks, cappedBundle, seed = dailySeed(day),
                           turnBudget = 2 * size * 20):
    picks := resample(...); retry up to 3 times
    else throw UnreachableManifest(day, picks)

  return picks

isReachable(id, cappedBundle):
  # Transitive closure over cappedBundle.byIngredient: true iff there's
  # a DAG path from cappedBundle.base to id using only cappedBundle
  # recipes. Memoise per bundle build.
  return id in cappedBundle.base OR
         exists recipe r in cappedBundle.recipes with r.out == id
           AND for all x in r.all: isReachable(x, cappedBundle)

simulateReachable(manifest, bundle, seed, turnBudget):
  # Headless greedy solver. Starts from newGame()'s seed layout, uses
  # the real dealTray / match / resolve machinery, but picks moves
  # greedily toward unfound manifest items (BFS over byIngredient to
  # pick the nearest buildable manifest target). Terminates when every
  # manifest item is discovered OR turnBudget is exhausted.
  state := newGame(bundle, seed)
  for turn in 1..turnBudget:
    if manifest ⊆ state.found: return true
    target := nearestUnfoundManifestItem(manifest \ state.found, state)
    action := pickBestMove(state, target)
             # prefer: drop-on completing a combine toward target's
             # recipe chain; fallback: place; last-resort: swap/clear.
    state := reduce(state, bundle, action)
    if state.over: return false
  return false
```

Runs at admin save-time (for pins) and at schedule-build time (for the whole manifest). Expected budget per day: < 100 ms with memoised reachability; the simulate step is the hot path but is bounded.

---

## Engine changes

**`GameState`** — two new fields:

```ts
/** Daily manifest the player must find to win. Null for endless/fast
 *  and for legacy target-count dailies. Order is stable (payload-order)
 *  so UI renders consistently. */
manifest: string[] | null;

/** Subset of `manifest` the player has discovered, preserving manifest
 *  order (not find order). Derived from `found` ∩ `manifest`, but kept
 *  denormalised so the reducer can short-circuit the win check in O(1)
 *  and the UI doesn't have to recompute every render. */
manifestFound: string[];
```

**Win condition in `afterMove`** (replaces the `state.target` gate at line 593):

```ts
if (state.mode === "daily") {
  if (state.manifest != null) {
    if (state.manifestFound.length >= state.manifest.length) {
      state.over = true;
      events.push({ type: "over" });
      return;
    }
  } else if (state.target != null && state.found.length >= state.target) {
    state.over = true;
    events.push({ type: "over" });
    return;
  }
}
```

**Update on discovery** — in `finishResolve` where `found.push(recipe.out)` lands, also:

```ts
if (state.manifest && state.manifest.includes(recipe.out)
    && !state.manifestFound.includes(recipe.out)) {
  // Insert preserving manifest order.
  state.manifestFound = state.manifest.filter(
    (id) => id === recipe.out || state.manifestFound.includes(id)
  );
}
```

**Also:** `newGame` accepts `manifest?: string[] | null`; `cloneState` copies the two new fields; `/finish` route stamps `progress.result.manifestFound` and `progress.result.manifestSize` for leaderboard sort.

### ENGINE_VERSION bump plan

Current `ENGINE_VERSION = 2`. This change:
- changes win condition (daily),
- adds new state fields replayed on `/checkpoint` and `/finish`,
- adds a dealer bias branch (partner-bias when `state.manifest` is non-null).

All three are scoring-affecting under CLAUDE.md's hard rule. **Bump `ENGINE_VERSION` to `3`** in the same PR that lands the manifest reducer. Server replay auto-rejects in-flight v2 runs with 409; clients drop local state and restart. Deploy during a low-traffic window to minimise collateral; no DB migration is needed (the engine version is stamped per-run, not per-row).

---

## UI wireframes (ASCII)

### Start-daily sheet — with manifest preview

```
+----------------------------------------------+
|  Daily · 2026-11-08 · Everything             |
|                                              |
|  Today's manifest — find these 8:            |
|                                              |
|   [GLS]  [WDL]  [NAL]  [IRO]                 |
|   glass  wood   nail   iron                  |
|                                              |
|   [HMR]  [SAW]  [AXE]  [CHS]                 |
|   hmmr   saw    axe    chsl                  |
|                                              |
|  Win when you've made every item on the      |
|  list. Timer starts when you hit Start.      |
|                                              |
|            [  Start daily  ]                 |
+----------------------------------------------+
```

8 pictograms in a 4×2 grid, ~44px tiles with 6-char labels. Reuses the shelf's `cbslot` style. Pictogram-only on narrow widths (<340px) with a reveal-on-tap name.

### In-run find-log tracker

Docked above the shelf as a one-row bar; tap chevron to expand to the full grid:

```
collapsed:
+----------------------------------------------+
|  Manifest  3 / 8    ^                        |
|  [v][v][v][·][·][·][·][·]                    |
+----------------------------------------------+

expanded:
+----------------------------------------------+
|  Manifest  3 / 8    v                        |
|  [GLS v][WDL v][NAL v][IRO ·]                |
|  [HMR ·][SAW ·][AXE ·][CHS ·]                |
+----------------------------------------------+
```

Found items render with a check overlay and dimmed tier colour; unfound items stay full-colour as a "still to do" cue. Tapping a found tile shows the recipe path used (reuses DetailCard).

### End-card manifest summary

```
+----------------------------------------------+
|  Daily complete · 2026-11-08                 |
|  [=====================] 8 / 8               |
|                                              |
|   SCORE       TURNS      TIME       RANK     |
|   12,840      34         3:47       #12      |
|                                              |
|  Manifest:                                   |
|  [v GLS] [v WDL] [v NAL] [v IRO]             |
|  [v HMR] [v SAW] [v AXE] [v CHS]             |
|                                              |
|   [ Share ]  [ Play endless ]                |
+----------------------------------------------+

# partial completion variant:
|  Daily stopped · 2026-11-08                  |
|  [============--------] 5 / 8                |
|  ... same stats block ...                    |
|  Manifest:                                   |
|  [v GLS] [v WDL] [v NAL] [v IRO]             |
|  [v HMR] [x SAW] [x AXE] [x CHS]  <- greyed  |
```

Missed items render with a muted surface and the strike glyph; found items get the check. Replaces the "new discoveries" chip row for manifest runs.

---

## Admin surface sketch — curating the manifest

New section inside `DailyAdmin.tsx`, under **Daily length** when `manifest` mode is selected via a radio toggle (`Target count` | `Manifest`):

```
+-- Daily shape ------------------------------------------+
| ( ) Target count    (o) Manifest                        |
|                                                         |
|  Pool             [ kind:tool     v ]  (?)              |
|  Manifest size    [ 8  ] (6–12)                         |
|  Partner bias     [ 0.3 ] (0 disables)                  |
|                                                         |
|  Pinned items (0–8). Admin-chosen; must be reachable:   |
|   [+ Add pin]                                           |
|   [x nail]  [x hammer]  [x saw]                         |
|                                                         |
|  [Preview today's manifest]                             |
|                                                         |
|  Preview (2026-11-08):                                  |
|   PINNED:   nail · hammer · saw                         |
|   GENERATED: glass · wood · iron · axe · chisel         |
|   Simulation: 8/8 reachable in ~56 turns (OK)           |
|                                                         |
+---------------------------------------------------------+
```

Behaviours:
- **Pool** pulls from `kinds`, `tags`, or a `combine-theme` (admin picks the taxonomy; defaults to kind).
- **Add pin** opens a typeahead over the pool with a live reachability chip (`reachable` / `unreachable — try X, Y`).
- **Preview** calls a new `/api/admin/combine/daily/preview-manifest?day=…` endpoint that runs the generator + simulator and returns the picks plus the "turns to solve" estimate. Hard-fail if the simulator can't solve it.
- The existing **Schedule** section continues to render; manifest rows show the item pictograms inline where `guests` used to render.
- Unresolved-pin warning banner mirrors the existing `unresolvedExamples` surface.

---

## Migration plan (co-existence)

Shipping order, each step independently deployable:

1. **Schema / payload (no behaviour change).** Add `DailyConfig.manifest?` + `DailyPayload.manifest?` + bump `DailyPayload.version` to `2`. Scheduler writes `version: 2` for new rows; readers accept both. Normaliser rejects simultaneous `targetDiscoveries` + `manifest` on the same config (mutually exclusive).
2. **Engine (behind flag).** Add `GameState.manifest` / `manifestFound`; `newGame` accepts them; win condition prefers manifest when non-null. `ENGINE_VERSION` bump to `3` lands here. No admin surface changes yet — the field is unreachable in prod.
3. **Scheduler + reachability.** Implement `buildManifestForDay` and the headless simulator. Admin **preview** endpoint ships; still no production manifest.
4. **Admin UI.** Radio toggle + pool picker + pins + preview. Admin can now opt a theme into manifest mode per day.
5. **Player UI.** Start-daily sheet manifest grid (depends on T-0236's start dialog); in-run tracker; end-card summary (depends on T-0235's end-card polish).
6. **Partner-bias dealer tweak.** Ship last, isolated so it can be reverted without touching the win condition.

Rollback path at any step: because `DailyConfig.manifest` is opt-in, deleting the field on the active config returns the daily to target-count behaviour on the next `regenerate`. Existing `version: 2` payloads without `manifest` still work.

---

## Open follow-ups (explicitly deferred)

- **Hint system** for manifest mode (show one unfound item's recipe graph) — spec after playtest.
- **Daily streaks** with manifest grading (partial = half-streak?) — leaderboard team, not this spike.
- **Share string** format: `Daily 2026-11-08 · 8/8 · 34t · 3:47` — trivial, bundle into player-UI step.
