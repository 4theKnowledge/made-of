# Combine pacing — investigation state (2026-11-07)

Living summary of the pacing / grind investigation. Current branch of the discussion: strategic sim built, three prototype variants wired behind a unified `gp_override` system, playtest UI gated behind an env flag. Awaiting playtest data + a run of the four-way playability comparison.

## Problem statement

Players (user playtest, 2026-11-05 → 2026-11-07) report that bands 1 and 2 of Combine endless mode feel grindy. Tile repetition is heavy, the game slows down, discovery feels gated behind the same 5 tiles (H, O, C, water, He) showing up repeatedly. See T-0135.

## What the sim measurements have shown

### Four-way playability comparison (50 runs × 15k move cap, strategic player, 3 sec/placement)

| Config | Coverage (50 runs) | Moves to 40% | Unreachable | Discoveries/run |
|---|---|---|---|---|
| Banded 3-tile (baseline) | 29.2% | never | 281 | 49.6 |
| **Soft 3-tile** | **59.2%** | 5.2h | **162** | **78.2** |
| **Soft + 4-tile** | **61.5%** | **4.1h** | **153** | **81.9** |
| Banded + 4-tile | 30.2% | never | 277 | 52.3 |

**Headlines:**
- Soft bands roughly **doubles coverage** (29% → 59%).
- 4-tile tray alone does almost nothing in banded mode (+1% coverage).
- 4-tile adds a small boost on soft (+2% coverage, 1h faster to 40%).
- All four still FAIL the arbitrary targets I set (40% @1h). Likely my targets are too aggressive — a playtest will say if 5h-to-40% feels fine.

This is the *quantitative* version of the user's complaint and its candidate fixes. The *mechanical* signal (soft bands doubles reach) is unambiguous. The remaining questions are UX (does it feel right, is the ramp fast enough).

### Known content shape issues (T-0135)

- Band 1 has 26 outputs but only 2 real 2-input combines (`H+He→star`, `H+He→sun`).
- The other 24 band-1 outputs are 1-input "promote" recipes (star→element, plant→crop).
- 12 of them are *plants* (apple tree, grape vine, etc.) that thematically belong in band 4+ but got scheduled into band 1 by `assignAges`.
- The 1-input gate is why the dealer's board-aware sampling degenerates into "cycle H and He forever."

### Why we're not hand-editing band assignments

User constraint (2026-11-07): the band assignment algorithm (`assignAges` in `src/combine/data.ts`) must keep working as the KB grows. Manual overrides are brittle. Any fix must be at the *system* level — sampler, progression, or tray size — not the data level.

## Acceptance criteria for any fix

Stated by user:

1. **Collection is unlockable** in some reasonable number of plays (not too few either).
2. **Scales with the KB** — a 4000-item or 40000-item KB shouldn't collapse the pacing.
3. **Progression feels logical** — user learns things in an order that makes sense, not randomly jumping across the graph.

## Design options explored

### Option A — Banded (current)

- ✅ Progression feels logical (bands are a thematic ladder).
- ❌ Collection unreachable (sim: only 35% in 50 plays).
- ⚠️ KB growth: currently fine; brittle to content shape.

### Option B — Flat mode (`?gp_override=mode=flat`) — tested & rejected

Dealer samples from the whole theme pool regardless of age; age-up on unique-find count.

- ✅ Collection reachable (sim shows 10× tile diversity per run).
- ✅ KB scales trivially — no bands.
- ❌ Progression broken. User playtest verdict: "sampling is better (more diverse) but the logical progression of learning things isn't there, we have so many different things."
- **Verdict:** mechanically works, feels wrong. Rejected as the sole mode.

### Option C — Soft bands (`?gp_override=mode=soft`) — built, sim-verified, awaiting playtest

Dealer samples from a reachability-defined pool that grows as the player discovers:
- `known` = base ingredients + player's discoveries
- `pool` = known ∪ one recipe-hop out (ingredients that would complete a partially-known recipe)
- Age-up on unique-find thresholds, scaled to KB size.

Why it should pass all three criteria:
- Progression is logical by construction — you only see tiles one hop from what you already know.
- Scales — pool is graph-local, not band-indexed.
- Collection reachable — every item has a finite chain of (known → one-hop-out) moves.

**Sim result:** 59.2% coverage in 50 runs vs 29.2% baseline. Doubles collection reach.
**Known caveats:**
- Sim ramp is slower than target (5.2h to 40%, target 1h). Could be too-conservative thresholds, strategic-player-not-tuned-for-soft, or my targets being unrealistic.
- Soft mode is slow in sim (per-pick reachability recomputation). Fine for playtest; optimise later if we want more sim runs.
- No crumble in soft mode (every in-pool tile counts as "in use"). Low-priority tweak.

**Status:** code landed in `src/combine/soft-bands.ts` + wired into `deal.ts` and `engine.ts`. Playtest UI ready. User plays with `NEXT_PUBLIC_COMBINE_PLAYTEST=1`.

### Option D — 4-tile tray (`?gp_override=tray=4`) — built, sim-verified, low-signal

Expands tray from 3 to 4 tiles. Expected to help multiplicatively; actually ~1% coverage improvement in banded, ~2% on soft.

**Sim result:** adds very little on its own. Small boost on top of soft (5.2h → 4.1h to 40%). Works with any mode.
**Verdict:** worth keeping as an optional lever; not a primary fix.

## Other things considered but not pursued

- **Content migration (move 24 reflexives to later bands):** would work mechanically but violates constraint 2 (brittle to KB evolution). **Dropped.**
- **Dealer-level tweaks (heavy-tile ban, overlap rejection):** sim showed these reduce repetition in banded mode but at the cost of progression (banning H and O also starves the bridge to band 2). **Dropped as a primary fix.** May be useful as a secondary tweak later.
- **Reinforcement learning for the sim player:** considered. Deferred. The decisions in front of us are design decisions (which progression system?), not tuning decisions. A smarter sim player would answer tuning questions. Revisit if we end up needing finer-grained pacing numbers after choosing a progression system.

## Simulation tooling

Everything in `src/combine/__tests__/`:

- **`simulate.ts`** — original greedy sim (naive + age-aware heuristics, no hold/helpers).
- **`promote-sim.ts`** — greedy + promote-aware player (combines when it can, promotes board tiles otherwise). Added tile-frequency histogram per run.
- **`random-sampler-sim.ts`** — overrode the dealer with uniform / board-aware / found-aware random samplers (pre-engine prototype of what became soft-bands / flat).
- **`strategic-sim.ts`** — current best player model: hold, helpers (swap/clear), undo, 1-step chain lookahead. Still hand-coded heuristics.
- **`playability.ts`** — the quantitative acceptance metric. Measures:
  - Cross-play ramp (moves to reach 40%/75%/95% of collection).
  - Playtime estimate using `3 sec/placement` (tunable).
  - Long-tail: items unreachable at move cap; items seen in <20% of runs.
  - Optional growth-robustness pass that subsamples the theme at 50%/75%/100% and reports scaling exponent.
  - All thresholds configurable via CLI flags (`--sec`, `--cap`, `--runs`, `--ramp-fracs`, `--ramp-hours`, `--unreach-cap`, `--growth`).

### Known limitations of the sim

- Still hand-coded heuristics. A real player chasing a specific recipe ("I want silicon") behaves differently from reactive greedy.
- No learning curve — all runs use the same policy.
- No "I'm bored" / "I quit" signal — grind feel is only approximated via repetition metrics.
- **These limitations don't invalidate the mechanical findings** (counting problems are counting problems), but we shouldn't use the sim for pure UX decisions like "does flat feel right."

## Infrastructure landed

### `src/combine/gp-overrides.ts`

Central playtest-override system. One URL param (`?gp_override=`), one localStorage key, env-var fallback for Node sims. Shape:

```ts
{ mode: "banded" | "flat" | "soft"; traySize: 3 | 4 }
```

Accessors: `getGpOverrides()`, `setGpOverride(key, value)`, `getActivePlaytestProps()` (for analytics), `isPlaytestEnabled()` (reads `NEXT_PUBLIC_COMBINE_PLAYTEST`).

### Playtest UI (`src/components/combine/board-parts/overlays/PlaytestMenu.tsx`)

In-game Experiments menu row — gated on `NEXT_PUBLIC_COMBINE_PLAYTEST=1`, so prod cohort is empty by construction. Toggles mode + tray size, writes to localStorage via the gp-overrides setter, emits `combine_playtest_set` PostHog event on every change. Changes take effect on the next new game.

## Open work

| Task | Status | Blocked on |
|---|---|---|
| T-0135 Combine pacing | in-progress | moved to T-0162 for sim fidelity |
| T-0161 Flat mode | done (rejected) | — |
| T-0162 Strategic sim + playability | in-progress | 4-way comparison still needed |
| T-0163 Soft bands | in-progress | sim needs caching; then playtest |
| T-0164 4-tile tray | in-progress | 4-way sim comparison |
| T-0165 gp_override plumbing | in-progress | code landed; just needs merge |
| T-0166 Playtest reveal UI | in-progress | code landed; needs `NEXT_PUBLIC_COMBINE_PLAYTEST=1` in `.env.local` to try |

## Immediate next steps

1. **Optimise `softPool`** — cache `(found.size, found.last)` → pool so the dealer's per-pick calls don't rebuild it. Should bring config-2 sim time from "timeout" back into the ~90s range.
2. **Run the 4-way playability comparison** (banded/soft × 3-tile/4-tile) and record the numbers in the T-0162 comment.
3. **User playtests soft-bands + 4-tile** via the Experiments menu (needs `NEXT_PUBLIC_COMBINE_PLAYTEST=1` set locally). PostHog captures which variant each run used.
4. **Decide** between staying banded (status quo), shipping soft-bands, or soft+tray=4. Decision input: sim numbers + user feel from playtest + PostHog session data.

## Longer-term questions (parked)

- **Soft-bands age labelling.** Bands are currently labelled "I, II, III…" with thematic names from `theme.ages`. If soft-bands ships, the labelled age concept becomes "stage of your discovery journey" rather than "era of the world." Catalogue groupings stay banded (users still see "big bang era / cells era / tech era" in the collection), but the progression bar needs rethinking.
- **Daily mode compatibility.** Daily is target-list ending (`state.target`). Soft-bands sampler would work in daily mode but the "guest of the day" mechanic may want to override the softPool constraint ("include this specific tile today even if it's far from what you know"). Punt until endless mode is settled.
- **Helpers scaling.** `helperGrants` scales to `bandSize(age)` which reads from `bundle.outBand`. In soft-bands this is still well-defined but may feel arbitrary. Revisit after pacing is settled.
- **Crumble in soft-bands.** Soft-bands `tallyBoard` uses the reachability pool for "in use" detection; this means anything in the pool never crumbles. Could get sticky over long runs. Low priority but needs attention before soft-bands ships.
- **RL sim player.** If we end up needing finer-grained pacing numbers (e.g. "what's the right discovery threshold for age 3 → 4?"), that's when RL earns its keep. Defer until needed.
