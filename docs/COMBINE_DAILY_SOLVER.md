# Combine Daily Manifest Solver — State + Options

**Context:** `src/combine/manifest-solver.ts` validates that each day's
auto-generated manifest can actually be completed by a hypothetical
player on today's deterministic seed. If validation fails the admin's
`/admin/combine/daily` preview + the scheduled `combine_dailies` row
both reject the day. T-0250 reworked this after prod showed the old
solver couldn't handle broad pools.

## Current state (as of T-0250)

### What the sim does now

`simulateReachable` is a helper-aware greedy auto-player. Each turn it
picks an action in this priority order:

1. **Promote toward an unfound manifest item** — `promote` fires 1-input
   "evolution" recipes (e.g. `star → supernova`). Previously the sim was
   blind to these; they're a surprisingly common recipe shape, so this
   was a big lift.
2. **Direct manifest placement** — any `place` that produces an unfound
   manifest item via `matchAt`.
3. **Promote toward a precursor** — same as (1) but for an item on the
   recipe path to an unfound manifest item.
4. **Direct precursor placement** — any `place` that produces a
   precursor.
5. **Swap the tray** — when the whole tray contributes nothing to the
   target chain. Budget: **5 swaps per probe**.
6. **Clear a stale board cell** — when the board is >60% full and no
   useful placement exists. Budget: **3 clears per probe**.
7. **Any legal placement** (last-resort tray cycle). Bail if the tray
   stays stable for 3 turns.

Helpers (swap/clear) use the engine's existing debug mode to bypass
per-run counters; budgets above are what a real player has access to
by mid-run, preserving the "if sim succeeds, player can succeed"
guarantee.

### What `buildManifestForDay` does with that

- **Per-item difficulty precompute** (`computeDifficulty`): one pass
  over `bundle.outputs` that records solo-solve turns (or `null` for
  sim-unsolvable items). Cached per-bundle via a `WeakMap`, so the
  30-day schedule builder pays it once per regenerate. Cost: ~60s for
  the ~400-item Everything bundle; irrelevant for narrower themes.
- **Difficulty-budgeted sampling**: candidate manifests whose summed
  solo difficulty exceeds `size × median × 1.5` are rejected before
  the expensive full-manifest sim runs.
- **Real retry reshuffle**: each attempt reseeds RNG from
  `manifest:${day}:${attempt}`. The old code shifted the pool by 1
  position per attempt, so retries sampled nearly the same items.
- **Day-aware blacklist**: items that fail the full-manifest sim on
  *this day's* seed are added to a per-call `badOnDay` set and dropped
  from subsequent retry attempts. Handles difficulty being
  day-independent while the actual sim is day-dependent (a particular
  seed can make an otherwise-solvable item fail).
- **Scaled turn budget**: `max(320, size × median × 2)`. The old
  hardcoded `2 × size × 20 = 320` was way too tight for deep bundles.

### Admin diagnostics

The `/admin/combine/daily` preview panel now shows:

- Pool health header: `N in pool · M reachable · K solvable by sim · J unsolvable`
- Median solo-solve turn count
- Solvable-turn histogram (`0–25t`, `26–50t`, etc.)
- Expandable "unsolvable items" list (with names, not UUIDs)
- On preview failure: the specific items from the last attempt, each
  tagged with its solo-solve turn cost or "unsolvable" if blacklisted
  on this day

## Where this leaves us on the Everything pool

Numbers from the current KB (~400 items, Everything theme):

| Metric | Before T-0250 | After T-0250 |
|---|---|---|
| Solvable individually | 4 / 305 | **37 / 305** |
| Max manifest size that builds | 0 | **3** |
| Admin can see which items are bad | No | Yes |

So the sim is **9× more capable** at single items — but the engine's
`normaliseDailyConfig` still enforces `size ≥ 6`, which Everything
can't currently satisfy.

### Why size 4+ still fails

Every one of the 8 picks in a size-8 attempt is individually solvable,
but the full-manifest sim running them together fails. The sim solves
items **in sequence**, not jointly:

1. It greedily works toward item A's precursors.
2. When A is complete, the board + tray are devoted to A's chain.
3. Item B then starts from a depleted state — specific tiles it needs
   may have been consumed building A; its precursors may not be on the
   board; its target tiles may not be in the tray.
4. The sim's shared turn budget runs out before all 8 complete.

A real planning simulator would pick placements that **keep options
open** for subsequent items, share intermediate outputs across chains,
and sequence items by dependency overlap. The current sim can't do any
of that.

## Options for closing the gap

Three honest paths forward, in increasing order of effort.

### Option A — Lower the size floor to 3

- **Change:** `normaliseDailyConfig.size.min: 6 → 3`.
- **Result:** Everything dailies work *today* at size 3. Smaller themes
  still support up to 12.
- **Trade-off:** Size 3 is a short daily. Still a game (find 3 items),
  but less of a hook than 8. As the KB grows, the solvable pool grows
  and the admin can raise the size manually.
- **Effort:** 5 minutes.

### Option B — Ship what's here, don't change the floor

- **Change:** None to config. The sim is simply smarter; admins still
  choose narrower pools for larger manifests.
- **Result:** All existing dailies (which use curated pools today)
  benefit from the smarter sim with no surface change. Broad-pool
  dailies remain out of reach until a planning sim lands.
- **Trade-off:** Doesn't solve the originating pain (broad-pool
  dailies failing), just makes diagnostics clearer and makes narrow-
  pool solving more robust.
- **Effort:** Zero beyond what's merged.

### Option C — Proper planning simulator (beam search or MCTS)

This is what would actually unlock size 6–8 on broad pools.

#### Beam search sketch

- **State:** `(board, tray, turnsUsed, bagHash, manifestFound)`.
- **Expansion each turn:** enumerate every legal `place` + `promote`
  from the current tray. Also include `swap` and `clear` as separate
  branches when the heuristic flags the tray/board as poor.
- **Heuristic score** per state:
  - +N for each manifest item already found
  - +K for each precursor present on the board or in the tray
  - +M for "constructibility" — count of unfound manifest items whose
    required precursor set is ≥ partially present
  - -J for board occupancy (clog penalty)
  - -X for turns used
- **Beam width:** 16–32 states kept per turn after pruning.
- **Termination:** all manifest items found, or beam collapses (no
  legal moves anywhere), or turn budget exhausted.

Why this works where greedy fails: the beam explores *multiple*
competing plans in parallel. One branch might pursue item A greedily;
another might build a shared precursor first; a third might prioritise
items by their dependency chains. The winning branch is whichever
reaches the finish line first.

#### MCTS sketch

Same state/action space as beam, but replaces the beam with:

- Random rollouts from each candidate action, scored by "did any
  manifest items get found."
- UCB1 selection to balance exploration vs exploitation.
- Node reuse across turns so computed value estimates compound.

MCTS is probably **better** for this problem than beam search because
the state space is huge and the useful plans are sparse — bandit
selection focuses search on promising branches. But the implementation
is more intricate and performance is harder to reason about.

#### Scope + risk

- **Lines:** 400–800 depending on how much state we have to serialise.
  The engine's `GameState` has a lot of fields (crumb counters, shored
  flags, chapter state, etc.) — we'd either clone it defensively or
  build a minimal-state proxy for the search.
- **Performance:** 400 items × 16-wide beam × 50 turns per search ≈
  300K reducer calls per precompute. The current greedy precompute is
  ~60s for the Everything bundle; beam could be 5–10× slower. May need
  to parallelise via workers or cache more aggressively.
- **Heuristic risk:** the quality of the heuristic determines whether
  beam/MCTS actually finds more solutions than greedy. A bad heuristic
  can perform *worse* than greedy by burning budget on dead ends. Would
  need iterative tuning against real pool data.
- **Guarantee weakens slightly.** Greedy's "if sim succeeds, player
  can" was easy to argue. A beam-of-K heuristic sim is still
  conservative but harder to reason about formally. Should stay
  conservative — the cost of accepting an unwinnable manifest is a
  broken daily, which is worse than rejecting a winnable one.

#### Honest timeline

- Beam search with a workable heuristic: 1–2 days
- Tuning against the KB until size 6–8 works on Everything: another 1–2 days
- Total: **3–4 focused days**, with the risk that the heuristic needs
  further iteration based on how it performs on themes we add later

### Option D — Narrow the sim's guarantee

- **Change:** Treat sim success as a *plausibility check*, not a proof.
  Let the admin see sim results but override: "this item is unsolvable
  by sim but I know it's winnable, include it anyway."
- **Result:** Shifts risk from code to admin judgement. Admin can run
  broad-pool dailies if they're willing to sign off.
- **Trade-off:** This is a judgement escape hatch, not a solver fix.
  If the admin's wrong, players get an unwinnable daily.
- **Effort:** Half a day (UI + a new "force-include" column in the
  pool, plus server-side bypass).

## Recommendation

Ship **B** (strict improvement, no config change) as the T-0250
completion. File **C** (planning simulator) as a separate task — it's
the only option that actually closes the broad-pool gap, and it's big
enough to deserve its own scope. **A** (lower size floor) should only
land if the user wants to unblock Everything dailies in the short term
while C is in flight; it's a workaround, not a fix.

**D** is a decision-shaping option, not a technical one — worth
discussing if C doesn't pan out or takes too long.

## References

- Task: `T-0250` in `pm/tasks.jsonl`
- Solver code: `src/combine/manifest-solver.ts`
- Schedule builder: `src/combine/daily-schedule-db.ts`
  (`scheduleActiveDaily`)
- Admin preview endpoint: `src/app/api/admin/combine/daily/preview-manifest/route.ts`
- Admin UI: `src/app/admin/combine/daily/DailyAdmin.tsx`
  (`PoolHealth` component)
- Engine actions used by the sim: `src/combine/engine.ts`
  (`place`, `promote`, `swap`, `clear`, `choose`)
- Daily manifest design (upstream): `docs/COMBINE_DAILY_MANIFEST.md`
