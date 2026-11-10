# Combine pacing — investigation history (2026-11-07)

Historical record of the pacing investigation. **Status: chapter progression (née soft bands) is now the sole Combine mechanic** (refactor landed as T-0187). This document is kept for context on why the mechanic exists; the live spec lives in `docs/PROGRESSION.html`. Legacy content below is preserved for the decision trail.

> **Reader note (T-0208):** everything below references the gp-overrides
> system (`?gp_override=mode=soft,tray=4`), the Playtest UI, and
> "banded vs soft" selection. All of those were **removed** in T-0187:
> gp-overrides.ts is deleted, there is no Playtest menu, and chapter
> progression is unconditional. Trust the current source for mechanics;
> read this file for *why* the current mechanics exist.

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
**Playtest (2026-11-07):**
- Sampling (soft dealer + temperature) feels good. Keeps.
- Crumble (20-move inactivity) too aggressive — tiles died before the player could combine them with what the dealer was dealing. Board kept clearing itself, stripping raw materials. Raised to 40. Future lever: tie TTL to board occupancy (tighten when full, loose when sparse).
**Known caveats:**
- Sim ramp slower than target (5.2h to 40%, target 1h). Likely targets were unrealistic.
- Soft mode is slow in sim (per-pick reachability recomputation now cached per tray).

**Status:** code landed in `src/combine/soft-bands.ts` + wired into `deal.ts` and `engine.ts`. Playtest UI ready. User plays with `NEXT_PUBLIC_COMBINE_PLAYTEST=1`.

### Option E — Strict soft (`?gp_override=mode=strict-soft`) — proposed, not built

Tighter cousin of soft bands. Dealer pool = tiles whose recipes are **fully-known** (every input discovered) + base ingredients. Compared to soft's "any one input known," strict-soft gates each tile behind full input mastery.

**Where it sits on the spectrum:**

```
hard-locked          soft (current)     flat (rejected)
"all inputs known"   "any input known"  "all tiles"
(strict-soft)        (soft bands)
```

**Pros:**
- Crystal-clear progression — dealer literally can't give you unearned tiles.
- One-sentence tutorial ("discover inputs to unlock outputs").
- Pacing is deterministic in shape per chapter.

**Cons:**
- Dead zones early: band 1 has only `H+He→star` and `H+He→sun` as fully-known combines from base, which collapses to the same single-goal grind we're trying to escape.
- 1-input promotes (24 in band 1) only unlock once `star` is discovered, which could create a worse version of the current "H+He forever, then promote star over and over."
- Late-game recipes with 4-5 inputs gated behind more unrelated finds — slower unlock curve than soft bands.
- Removes the "I see an unfamiliar tile, I recognize what it goes with" moment, which is gameplay.

**Build cost:** ~30 lines in `soft-bands.ts` (second pool-computation function) + wiring in `deal.ts`. Can ride on the same gp_override system, same chapter progression, same time-crumble, same dealer temperature.

**Decision deferred until** user playtests current soft mode. If soft feels right, strict-soft is probably unnecessary. If soft feels too chaotic ("tiles show up before I'm ready for them"), strict-soft becomes the fallback.

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
| T-0135 Combine pacing | in-progress | user playtest in prod |
| T-0161 Flat mode | done (rejected) | — |
| T-0162 Strategic sim + playability | done (4-way landed) | — |
| T-0163 Soft bands | in-progress | user playtest in prod |
| T-0164 4-tile tray | in-progress | user playtest in prod |
| T-0165 gp_override plumbing | done (deployed) | — |
| T-0166 Playtest reveal UI | done (deployed) | — |

## Deployed to prod (2026-11-07)

- Soft-bands sampler, 4-tile tray, all behind `?gp_override=mode=soft,tray=4`.
- `NEXT_PUBLIC_COMBINE_PLAYTEST=1` reveals Experiments row in TopBar hamburger.
- `combine_playtest_set` PostHog event on every toggle; variant props threaded via `getActivePlaytestProps()`.
- Commits: `24325c2` (feat) + `7e9fdde` (prod build lint fix).

User is playtesting on mobile. PostHog captures variant per run.

## Decisions / direction (2026-11-07)

**On progression bar semantics in soft mode:** the progression ladder is "stage of your discovery journey" (chapters), not "era of the world." Difficulty bands remain the dealer's reachability tiers. Catalogue groupings stay thematic as a display convention.
- **Open sub-question:** how does the progression bar update as the KB grows? The chapter thresholds need to scale sensibly whether the KB is 400 or 40000 items.

**On daily mode:** out of scope for now. If endless soft-bands ships, daily inherits.

**On helper scaling:** user-proposed shape — grants at discovery milestones (after 10, +15, +20, +25 unique finds…) rather than at age-up. This is a soft-mode-friendly rework; replaces the current `bandSize(age)`-indexed `helperGrants`.

## Orthogonal mechanic work (in flight while playtest runs)

Things we can investigate without needing playtest feedback:

1. **Progression bar for soft mode.** Current `AgesSheet` lies in soft mode (shows `ageMade / ageNeed`, which isn't what triggers age-up). Needs:
   - KB-size-invariant threshold curve (works at 400 / 4000 / 40000 items).
   - Copy that reads "stage of discovery journey," not "era of the world."
   - Catalogue remains thematic; only the progression indicator changes.
2. **Helper scaling by discoveries (not band).** Implement user's suggested shape: grants trigger every N discoveries. N could be fixed (10 at a time) or scaling (10, 15, 20, 25…). Replace `bandSize(age)` dependence in `helperGrants`.
3. **Crumble in soft mode.** Currently nothing crumbles because `A.USE` is the whole reachable pool. Candidate rule: crumble tiles not touched in the last N moves regardless of mode. Or: in soft, crumble tiles whose first-recipe band is far below the player's current chapter.

## Longer-term questions (parked)

- **RL sim player.** If post-playtest we need finer-grained pacing numbers (e.g. "what's the right threshold curve"), that's when RL earns its keep. Defer until needed.
- **Soft mode sim optimization.** Per-pick reachability recomputation is slow (~5× banded). Cache per-tray or per-N-moves if we need more sim runs.
