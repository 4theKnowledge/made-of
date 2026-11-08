/**
 * Manifest solver (T-0242).
 *
 * Builds the frozen per-day find list from a `DailyConfig.manifest`
 * config. Runs at admin save-time (pin reachability check) and at
 * schedule-build time (full manifest generation).
 *
 * Two layers:
 *
 *   1. **`isReachable`** — a static transitive-closure check: is `id`
 *      producible in principle from the capped bundle's base ingredients
 *      given its recipes? Catches admin-pinned items that just can't be
 *      made because their recipes need items the capped bundle doesn't
 *      carry.
 *   2. **`simulateReachable`** — a dynamic headless-solver check: does
 *      the dealer + reducer actually surface the items in time, under
 *      today's seed, within a bounded turn budget? Catches reachability
 *      gaps that static closure can't see (crumble rate, hold capacity,
 *      dealer bias, etc.).
 *
 * Both are read-only over the bundle and cached per-call where cheap.
 */

import type { CombineRecipe, ThemeBundle, ThemeKey } from "./types";
import { DEFAULT_MANIFEST_SIZE, type DailyConfig } from "./daily-config";
import { newGame, reduce, type GameState } from "./engine";
import { matchAt } from "./match";

/* ========================================================================
 * Static reachability (transitive closure)
 * ====================================================================== */

/** Is `id` buildable from `bundle.base` using only `bundle.recipes`?
 *
 *  Memoised per-bundle-reference per-call via `cache`. A fresh cache is
 *  cheap; callers that want to batch many `isReachable` calls against the
 *  same bundle can pass a shared `cache` Map. */
export function isReachable(
  id: string,
  bundle: ThemeBundle,
  cache: Map<string, boolean> = new Map(),
): boolean {
  const base = new Set<string>(bundle.base);
  // Guard against recipe cycles — the item graph is a DAG in practice,
  // but a corrupt bundle shouldn't send us into infinite recursion.
  const visiting = new Set<string>();
  function walk(x: string): boolean {
    const hit = cache.get(x);
    if (hit !== undefined) return hit;
    if (base.has(x)) {
      cache.set(x, true);
      return true;
    }
    if (visiting.has(x)) {
      // Cycle — treat as unreachable for this branch; another branch
      // may still prove it.
      return false;
    }
    visiting.add(x);
    const candidates = bundle.recipes.filter((r) => r.out === x);
    let ok = false;
    for (const r of candidates) {
      if (r.all.every((part) => walk(part))) {
        ok = true;
        break;
      }
    }
    visiting.delete(x);
    cache.set(x, ok);
    return ok;
  }
  return walk(id);
}

/** Return every reachable output id in the bundle, sorted. Used by the
 *  admin preview endpoint to narrow the pool before sampling. */
export function reachableOutputs(bundle: ThemeBundle): string[] {
  const cache = new Map<string, boolean>();
  const out: string[] = [];
  for (const id of bundle.outputs) {
    if (isReachable(id, bundle, cache)) out.push(id);
  }
  out.sort();
  return out;
}

/* ========================================================================
 * Deterministic RNG (mirrors daily-schedule.ts)
 * ====================================================================== */

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/* ========================================================================
 * Headless simulator
 * ====================================================================== */

/** Can a helper-aware auto-player produce every item in `manifest`
 *  within `turnBudget` turns, using today's deterministic daily seed?
 *  Returns the number of turns taken, or null on failure.
 *
 *  The sim is in **debug mode** (`state.debug = true`), which the real
 *  engine uses to give helpers unlimited charges. That isn't the same
 *  as a real player's budget — a player gets ~2-5 of each helper per
 *  chapter — but we also cap helper use via `SIM_SWAP_BUDGET` and
 *  `SIM_CLEAR_BUDGET` below so the sim can't trivially solve things a
 *  player couldn't. The guarantee is: if the sim succeeds using ≤N
 *  swaps and ≤M clears, a player with ≥N swap charges + ≥M clear
 *  charges can replicate the sequence.
 *
 *  The policy, in priority order each turn:
 *    1. Direct manifest placement — any `place` that produces an
 *       unfound manifest item.
 *    2. Precursor placement — any `place` that produces an output on
 *       the recipe path to an unfound manifest item.
 *    3. Swap if the tray is a dead-end AND no precursor placement is
 *       on the board. Costs 1 of the swap budget.
 *    4. Clear a long-stale useless tile to unclog the board. Costs 1
 *       of the clear budget.
 *    5. Any legal placement (last-resort tray cycle).
 *
 *  This fixes the greedy sim's board-clog death spiral: on a broad
 *  theme, most dealt tiles are useless for a given manifest item.
 *  Without swap/clear, the board fills with junk and the sim dies.
 *  With a modest helper budget, the sim can route around unlucky deals
 *  and surface genuinely-reachable items. */
export function simulateReachable(
  manifest: string[],
  bundle: ThemeBundle,
  theme: ThemeKey,
  day: string,
  turnBudget: number,
): number | null {
  if (manifest.length === 0) return 0;
  const { state: initial } = newGame(theme, bundle, {
    mode: "daily",
    daily: day,
    size: 6,
    manifest,
  });
  let state = initial;
  // Flip debug flag so swap/clear bypass per-run helper counters. The
  // sim enforces its own helper budget below.
  state.debug = true;
  let swapsUsed = 0;
  let clearsUsed = 0;
  let lastTrayKey = trayKey(state.tray);
  let lastTrayStableFor = 0;
  for (let turn = 0; turn < turnBudget; turn++) {
    if (state.manifestFound.length >= manifest.length) {
      return turn;
    }
    if (state.over) return null;
    const unfound = new Set(
      manifest.filter((m) => !state.manifestFound.includes(m)),
    );
    const precursors = collectPrecursors(bundle, unfound);

    // 1a. Promote an on-board tile if a 1-input recipe fires toward
    //     an unfound manifest item. Evolution recipes (e.g. star →
    //     supernova) have no partner tile — placement can't trigger
    //     them, only the explicit `promote` action does. This is the
    //     only way to reach items that appear at the end of a chain of
    //     1-input "evolved" recipes, which is a surprisingly common
    //     shape in the KB.
    const promoteManifest = findPromoteToward(state, bundle, unfound);
    if (promoteManifest != null) {
      const r = reduce(state, bundle, { type: "promote", cell: promoteManifest });
      state = r.state;
      lastTrayKey = trayKey(state.tray);
      lastTrayStableFor = 0;
      // After promote, the engine may be in a choosing state if the
      // tile has multiple 1-input recipes. Pick the one that advances
      // toward the unfound item.
      if (state.choosing) {
        const idx = state.choosing.options.findIndex((o) => unfound.has(o.out));
        const r2 = reduce(state, bundle, { type: "choose", outputIndex: idx >= 0 ? idx : 0 });
        state = r2.state;
      }
      continue;
    }

    // 1b. Direct manifest placement.
    const direct = findPlaceToward(state, bundle, unfound);
    if (direct) {
      const r = reduce(state, bundle, direct);
      state = r.state;
      lastTrayKey = trayKey(state.tray);
      lastTrayStableFor = 0;
      continue;
    }

    // 2a. Promote/place toward a **direct** precursor (one hop from an
    //     unfound item). This is a strict improvement over "any transitive
    //     precursor": prefer building the thing that will fire the unfound
    //     recipe over building a distant precursor that's already on the
    //     board. Without this, the sim gets stuck pumping out base-chain
    //     items (e.g. `hydrogen + helium → star`) that qualify as transitive
    //     precursors but don't advance toward the unfound target.
    const directPrecursors = collectDirectPrecursors(bundle, unfound);
    if (directPrecursors.size > 0) {
      const promoteDirect = findPromoteToward(state, bundle, directPrecursors);
      if (promoteDirect != null) {
        const r = reduce(state, bundle, { type: "promote", cell: promoteDirect });
        state = r.state;
        lastTrayKey = trayKey(state.tray);
        lastTrayStableFor = 0;
        if (state.choosing) {
          const idx = state.choosing.options.findIndex((o) => directPrecursors.has(o.out));
          const r2 = reduce(state, bundle, { type: "choose", outputIndex: idx >= 0 ? idx : 0 });
          state = r2.state;
        }
        continue;
      }
      const placeDirect = findPlaceToward(state, bundle, directPrecursors);
      if (placeDirect) {
        const r = reduce(state, bundle, placeDirect);
        state = r.state;
        lastTrayKey = trayKey(state.tray);
        lastTrayStableFor = 0;
        continue;
      }
    }

    // 2b. Promote toward any transitive precursor.
    if (precursors.size > 0) {
      const promotePrecursor = findPromoteToward(state, bundle, precursors);
      if (promotePrecursor != null) {
        const r = reduce(state, bundle, { type: "promote", cell: promotePrecursor });
        state = r.state;
        lastTrayKey = trayKey(state.tray);
        lastTrayStableFor = 0;
        if (state.choosing) {
          const idx = state.choosing.options.findIndex((o) => precursors.has(o.out));
          const r2 = reduce(state, bundle, { type: "choose", outputIndex: idx >= 0 ? idx : 0 });
          state = r2.state;
        }
        continue;
      }

      // 2c. Any transitive precursor placement.
      const toward = findPlaceToward(state, bundle, precursors);
      if (toward) {
        const r = reduce(state, bundle, toward);
        state = r.state;
        lastTrayKey = trayKey(state.tray);
        lastTrayStableFor = 0;
        continue;
      }
    }

    // Classify current tray: does any tile contribute to a precursor or
    // manifest path? A tile `t` contributes if it appears in any recipe
    // whose output is in `unfound ∪ precursors`.
    const targets = new Set<string>([...unfound, ...precursors]);
    const trayUseful = state.tray.some(
      (t) => t != null && tileIsIngredientFor(bundle, t, targets),
    );

    // 3. Swap if the whole tray is useless AND we have budget left.
    //    Cap swaps conservatively — a player gets ~5/chapter max.
    if (!trayUseful && swapsUsed < SIM_SWAP_BUDGET) {
      const before = trayKey(state.tray);
      const r = reduce(state, bundle, { type: "swap" });
      state = r.state;
      swapsUsed++;
      const after = trayKey(state.tray);
      if (after === before) {
        // Dealer re-dealt the same tray (small bag). No point retrying —
        // treat as unsolvable.
        return null;
      }
      lastTrayKey = after;
      lastTrayStableFor = 0;
      continue;
    }

    // 4. Clear a stale board tile. "Stale" = on the board but not an
    //    ingredient for anything we care about. Only if clears budget
    //    allows AND the board has filled past a threshold (clearing an
    //    empty board does nothing useful).
    const boardFill = state.board.filter((c) => c != null).length;
    const boardCap = state.board.length;
    if (
      !trayUseful &&
      clearsUsed < SIM_CLEAR_BUDGET &&
      boardFill > boardCap * 0.6
    ) {
      const staleCell = findStaleCell(state, bundle, targets);
      if (staleCell != null) {
        const r = reduce(state, bundle, { type: "clear", cell: staleCell });
        state = r.state;
        clearsUsed++;
        continue;
      }
    }

    // 5. Last-resort tray cycle. If the same tray has survived many
    //    turns with no legal useful play, bail — the sim is stuck.
    const curTrayKey = trayKey(state.tray);
    if (curTrayKey === lastTrayKey) {
      lastTrayStableFor++;
      if (lastTrayStableFor > 3) return null;
    } else {
      lastTrayKey = curTrayKey;
      lastTrayStableFor = 0;
    }
    const fallback = findAnyLegalPlace(state);
    if (!fallback) return null;
    const r = reduce(state, bundle, fallback);
    state = r.state;
  }
  return state.manifestFound.length >= manifest.length ? turnBudget : null;
}

/** Per-sim helper budgets. Keep tight — the "player can replicate"
 *  guarantee holds only if a real daily grants at least this much. A
 *  Chapter-0 player starts with `swap:1, clear:1`, scaling up to
 *  `swap:5, clear:3` by late chapters. 5+3 is what a mid-run player
 *  has on hand. */
const SIM_SWAP_BUDGET = 5;
const SIM_CLEAR_BUDGET = 3;

function trayKey(tray: Array<string | null>): string {
  return tray.map((t) => t ?? "·").join("|");
}

/** Does tile `t` appear in any recipe whose output is in `targets`? */
function tileIsIngredientFor(
  bundle: ThemeBundle,
  t: string,
  targets: Set<string>,
): boolean {
  for (const r of bundle.recipes) {
    if (!targets.has(r.out)) continue;
    if (r.all.includes(t)) return true;
  }
  return false;
}

/** Find a cell whose tile is not an ingredient for anything in
 *  `targets`. Prefers tiles with high crumble pressure (closer to
 *  dying anyway), but returns any match. Null if every on-board tile
 *  is useful. */
function findStaleCell(
  state: GameState,
  bundle: ThemeBundle,
  targets: Set<string>,
): number | null {
  let bestIdx: number | null = null;
  let bestPressure = -1;
  for (let i = 0; i < state.board.length; i++) {
    const tile = state.board[i];
    if (tile == null) continue;
    if (tileIsIngredientFor(bundle, tile, targets)) continue;
    // warn is the locked countdown once a tile is in its final ticks.
    // Lower warn = more imminent crumble = easier choice to clear it.
    // Fall back to n (total turns spent in place) for non-warned tiles.
    const pressure = state.crumb[i]?.warn ?? -(state.crumb[i]?.n ?? 0);
    const score = 1000 - pressure;
    if (score > bestPressure) {
      bestPressure = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Outputs that appear as a **direct** ingredient in some recipe producing
 *  a target. One hop only — the items the sim actually needs on the board
 *  to fire the target's recipe. Used as a strict priority above transitive
 *  precursors so the sim doesn't waste turns building distant precursors
 *  that are already reachable via the dealer. */
function collectDirectPrecursors(
  bundle: ThemeBundle,
  targets: Set<string>,
): Set<string> {
  const out = new Set<string>();
  for (const r of bundle.recipes) {
    if (!targets.has(r.out)) continue;
    for (const p of r.all) {
      if (!bundle.outputs.has(p)) continue;
      if (targets.has(p)) continue;
      out.add(p);
    }
  }
  return out;
}

/** All outputs that appear (transitively) as ingredients in some recipe
 *  leading to a target. Excludes the targets themselves and any base
 *  ingredients. Used by the precursor-aware greedy simulator. */
function collectPrecursors(bundle: ThemeBundle, targets: Set<string>): Set<string> {
  const out = new Set<string>();
  const stack = [...targets];
  while (stack.length > 0) {
    const t = stack.pop()!;
    const recipes = bundle.recipes.filter((r) => r.out === t);
    for (const r of recipes) {
      for (const part of r.all) {
        // Only track things we can produce (items that appear as an
        // output somewhere). Pure base ingredients already live in the
        // tray via the dealer — no simulator help needed.
        if (!bundle.outputs.has(part)) continue;
        if (targets.has(part)) continue;
        if (out.has(part)) continue;
        out.add(part);
        stack.push(part);
      }
    }
  }
  return out;
}

/** Find a board cell whose tile can be `promote`d via a 1-input recipe
 *  to produce any item in `targets`. Evolution/promote-only recipes
 *  are invisible to `place` — only the explicit `promote` action
 *  fires them. Returns the cell index or null. */
function findPromoteToward(
  state: GameState,
  bundle: ThemeBundle,
  targets: Set<string>,
): number | null {
  for (let cell = 0; cell < state.board.length; cell++) {
    const tile = state.board[cell];
    if (tile == null) continue;
    const rs = (bundle.byIngredient.get(tile) ?? []).filter(
      (r) => r.all.length === 1,
    );
    for (const r of rs) {
      if (targets.has(r.out)) return cell;
    }
  }
  return null;
}

/** Find a `place` action whose immediate result would produce one of the
 *  `unfound` manifest items (via matchOn). Returns null if no such move
 *  exists this turn. */
function findPlaceToward(
  state: GameState,
  bundle: ThemeBundle,
  unfound: Set<string>,
): { type: "place"; slot: number; cell: number } | null {
  for (let slot = 0; slot < state.tray.length; slot++) {
    const tile = state.tray[slot];
    if (!tile) continue;
    for (let cell = 0; cell < state.board.length; cell++) {
      if (state.board[cell] != null) continue;
      // matchAt simulates placing `tile` at `cell` and reports the
      // recipe that would fire (if any). We don't need to mutate the
      // board — matchAt walks neighbours itself.
      const next = state.board.slice();
      next[cell] = tile;
      const m = matchAt(bundle, next, cell, tile, state.n);
      if (!m) continue;
      if (unfound.has(m.recipe.out)) {
        return { type: "place", slot, cell };
      }
    }
  }
  return null;
}

/** Find any legal `place` action — the first empty cell with the first
 *  non-null tray tile. Used as a tray-cycling fallback when no manifest
 *  progress is available this turn. */
function findAnyLegalPlace(state: GameState): {
  type: "place";
  slot: number;
  cell: number;
} | null {
  for (let slot = 0; slot < state.tray.length; slot++) {
    if (state.tray[slot] == null) continue;
    for (let cell = 0; cell < state.board.length; cell++) {
      if (state.board[cell] == null) {
        return { type: "place", slot, cell };
      }
    }
  }
  return null;
}

/* ========================================================================
 * Per-item difficulty (precompute)
 * ====================================================================== */

/** Difficulty map: outputId -> turns-to-solve for a 1-item manifest, or
 *  `null` when the greedy sim can't reach it inside the budget. `null`
 *  items are "sim-unsolvable" from this bundle and can never appear on a
 *  generated manifest (though an admin-pinned one still will — pins
 *  bypass the difficulty budget). */
export type DifficultyMap = Map<string, number | null>;

const difficultyCache = new WeakMap<ThemeBundle, Map<ThemeKey, DifficultyMap>>();

/** Per-item turn budget for the difficulty precompute. Much higher than
 *  the per-manifest budget because a solo item should get every
 *  reasonable chance — if the sim can't reach it alone, there's no
 *  universe where a size-8 manifest including it succeeds. */
const DIFFICULTY_PROBE_BUDGET = 200;

/** Compute (or fetch from cache) the simulator difficulty for every
 *  output in the bundle. Result is memoised per-bundle-reference per
 *  theme — callers that reuse a bundle across days (e.g. the schedule
 *  builder) pay the O(N * budget) cost once per schedule build. */
export function computeDifficulty(
  bundle: ThemeBundle,
  theme: ThemeKey,
): DifficultyMap {
  let perTheme = difficultyCache.get(bundle);
  if (!perTheme) {
    perTheme = new Map();
    difficultyCache.set(bundle, perTheme);
  }
  const cached = perTheme.get(theme);
  if (cached) return cached;

  const map: DifficultyMap = new Map();
  const probeDay = "2026-01-01"; // fixed day — difficulty is a property of
                                 // the bundle, not the calendar. Using one
                                 // day keeps results deterministic.
  const reachCache = new Map<string, boolean>();
  const baseSet = new Set<string>(bundle.base);
  for (const id of bundle.outputs) {
    if (baseSet.has(id)) {
      map.set(id, 0);
      continue;
    }
    if (!isReachable(id, bundle, reachCache)) {
      // Statically unreachable. Mark as null so the sampler excludes it;
      // a pin on this id will still fail with UnreachablePin as before.
      map.set(id, null);
      continue;
    }
    const turns = simulateReachable([id], bundle, theme, probeDay, DIFFICULTY_PROBE_BUDGET);
    map.set(id, turns);
  }
  perTheme.set(theme, map);
  return map;
}

/** Pool health summary for admin diagnostics. */
export interface PoolStats {
  total: number;
  reachable: number;
  solvable: number;
  unsolvable: number;
  unsolvableIds: string[];
  medianDifficulty: number;
  difficultyBuckets: Array<{ range: string; count: number }>;
}

/** Summarise a pool against the difficulty map. Used by the admin
 *  preview endpoint so the operator can see pool health before they
 *  regenerate the schedule. */
export function poolStats(pool: string[], difficulty: DifficultyMap): PoolStats {
  const total = pool.length;
  let reachable = 0;
  const solvableTurns: number[] = [];
  const unsolvableIds: string[] = [];
  for (const id of pool) {
    const d = difficulty.get(id);
    if (d === undefined) continue; // not in bundle — treat as unreachable
    reachable++;
    if (d === null) unsolvableIds.push(id);
    else solvableTurns.push(d);
  }
  const solvable = solvableTurns.length;
  const unsolvable = unsolvableIds.length;
  const medianDifficulty = median(solvableTurns);
  const buckets = bucketise(solvableTurns, [25, 50, 100, 200]);
  return {
    total,
    reachable,
    solvable,
    unsolvable,
    unsolvableIds,
    medianDifficulty,
    difficultyBuckets: buckets,
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function bucketise(xs: number[], edges: number[]): Array<{ range: string; count: number }> {
  const buckets = edges.map((_, i) => ({
    range: i === 0 ? `0-${edges[0]}` : `${edges[i - 1] + 1}-${edges[i]}`,
    count: 0,
  }));
  buckets.push({ range: `${edges[edges.length - 1] + 1}+`, count: 0 });
  for (const x of xs) {
    let placed = false;
    for (let i = 0; i < edges.length; i++) {
      if (x <= edges[i]) {
        buckets[i].count++;
        placed = true;
        break;
      }
    }
    if (!placed) buckets[buckets.length - 1].count++;
  }
  return buckets;
}

/* ========================================================================
 * Manifest builder
 * ====================================================================== */

export class UnreachablePin extends Error {
  constructor(public readonly pin: string) {
    super(`manifest pin "${pin}" is unreachable from the capped bundle`);
    this.name = "UnreachablePin";
  }
}

export class UnreachableManifest extends Error {
  constructor(
    public readonly manifest: string[],
    public readonly day: string,
    public readonly breakers?: Array<{ id: string; difficulty: number | null }>,
  ) {
    super(
      `manifest for ${day} failed solver after retries (${manifest.join(", ")})`,
    );
    this.name = "UnreachableManifest";
  }
}

/** Number of resample attempts before giving up. Each attempt reseeds
 *  from `manifest:${day}:${attempt}` and reshuffles the full candidate
 *  pool — distinct from the T-0242 bug where attempt N just shifted the
 *  pool by N positions. */
const MANIFEST_RESAMPLE_ATTEMPTS = 5;

/** Multiplier on `median * size` for the difficulty ceiling. Picks whose
 *  summed solo-solve turn count exceeds this are rejected before the
 *  full-manifest sim runs, which keeps us from sampling pathological
 *  mixes (one very-deep item in a size-8 bag).
 *
 *  1.5 leaves meaningful headroom for above-median items while still
 *  rejecting the worst-case samples. If this proves too tight on real
 *  pools, bump to 2.0; too loose, drop to 1.2. */
const DIFFICULTY_CEILING_MULTIPLIER = 1.5;

/** Build the frozen per-day manifest. Picks admin-pinned items first,
 *  fills the rest from the pool with rotation weighting + difficulty
 *  budgeting, verifies with the headless simulator. Resamples the
 *  non-pinned slots up to `MANIFEST_RESAMPLE_ATTEMPTS` times on failure.
 *
 *  `rotation` is a map of outputId -> days-since-last-served for every
 *  manifest item that appeared in the rotation window. Items absent
 *  from the map are "never served" and win placement priority — mirror
 *  of `pickGuests` to keep the vocabulary consistent.
 *
 *  `difficulty` is optional. When passed, sim-unsolvable items are
 *  dropped from the pool and the sampler enforces a total-difficulty
 *  budget. When omitted, the solver falls back to the pre-T-0250
 *  behaviour (raw sample, no budget) — kept for tests and for callers
 *  that can't afford the precompute. */
export function buildManifestForDay(args: {
  cappedBundle: ThemeBundle;
  theme: ThemeKey;
  config: NonNullable<DailyConfig["manifest"]>;
  day: string;
  pool: string[];
  rotation: Map<string, number>;
  turnBudget?: number;
  difficulty?: DifficultyMap;
}): { manifest: string[]; turnsToSolve: number } {
  const {
    cappedBundle,
    theme,
    config,
    day,
    pool: rawPool,
    rotation,
    difficulty,
  } = args;
  const size = config.size ?? DEFAULT_MANIFEST_SIZE;
  const pins = config.pins ?? [];
  // Turn budget: if we have difficulty data, scale from the actual
  // median solo-solve turns (the sim needs at least that much per item
  // in series, plus overhead for tray-sharing between items). Fall back
  // to the T-0237 heuristic when no difficulty map is available.
  const budgetFromDifficulty = args.difficulty
    ? (() => {
        const d = args.difficulty;
        const solvable: number[] = [];
        for (const id of rawPool) {
          const x = d.get(id);
          if (typeof x === "number") solvable.push(x);
        }
        if (solvable.length === 0) return null;
        const m = median(solvable);
        // 2× per-item median gives headroom for shared-tray contention;
        // minimum 320 so small-manifest runs don't starve.
        return Math.max(320, Math.round(size * m * 2));
      })()
    : null;
  const turnBudget = args.turnBudget ?? budgetFromDifficulty ?? 2 * size * 20;
  const cache = new Map<string, boolean>();
  // 1. Validate pins are reachable.
  for (const p of pins) {
    if (!isReachable(p, cappedBundle, cache)) {
      throw new UnreachablePin(p);
    }
  }
  // 2. Filter the pool: reachable outputs only, minus pins. If we have a
  //    difficulty map, also drop sim-unsolvable items — they'd dominate
  //    the sample and fail sim every time.
  const pinSet = new Set(pins);
  const reachablePool = rawPool.filter((id) => {
    if (pinSet.has(id)) return false;
    if (!isReachable(id, cappedBundle, cache)) return false;
    if (difficulty) {
      const d = difficulty.get(id);
      if (d === null || d === undefined) return false;
    }
    return true;
  });
  if (pins.length + reachablePool.length < size) {
    throw new UnreachableManifest(pins, day);
  }
  // 3. Rank by rotation (never-served first, then by staleness). The
  //    result is a *priority order* — attempt 0 tries the top `picksNeeded`
  //    items, retries resample across the whole pool.
  const neverRaw: string[] = [];
  const servedRaw: Array<{ id: string; stale: number }> = [];
  for (const id of reachablePool) {
    const r = rotation.get(id);
    if (r == null) neverRaw.push(id);
    else servedRaw.push({ id, stale: r });
  }
  servedRaw.sort((a, b) => b.stale - a.stale);

  // 4. Difficulty budget — only applied when `difficulty` is present.
  //    `median` is over the solvable pool; the per-manifest ceiling is
  //    `size * median * MULT`. Pins count toward the budget (their
  //    difficulty is probed but not re-validated for reachability).
  const picksNeeded = size - pins.length;
  const ceiling = difficulty
    ? (() => {
        const solvable: number[] = [];
        for (const id of reachablePool) {
          const d = difficulty.get(id);
          if (typeof d === "number") solvable.push(d);
        }
        const m = median(solvable);
        return size * m * DIFFICULTY_CEILING_MULTIPLIER;
      })()
    : null;
  const pinBudget = difficulty
    ? pins.reduce((acc, id) => acc + (difficulty.get(id) ?? 0), 0)
    : 0;

  // 5. Attempt loop. Each attempt reseeds the RNG from
  //    `manifest:${day}:${attempt}` and reshuffles within each rotation
  //    tier. Items that fail individually on *this day's* seed are
  //    recorded in `badOnDay` and excluded from subsequent attempts —
  //    this handles the difficulty map being day-independent while the
  //    actual sim is day-dependent (a particular seed can make an
  //    otherwise-solvable item fail).
  let lastPicks: string[] = [];
  const badOnDay = new Set<string>();
  for (let attempt = 0; attempt < MANIFEST_RESAMPLE_ATTEMPTS; attempt++) {
    const rand = mulberry32(hashStr(`manifest:${day}:${attempt}`));
    const shuffle = <T,>(xs: T[]): T[] => {
      const out = xs.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    };
    const neverFiltered = neverRaw.filter((id) => !badOnDay.has(id));
    const servedFiltered = servedRaw.filter((s) => !badOnDay.has(s.id));
    if (pins.length + neverFiltered.length + servedFiltered.length < size) {
      lastPicks = pins.slice();
      break; // too few survivors
    }
    const neverShuffled = shuffle(neverFiltered);
    const servedGrouped: string[] = [];
    let i = 0;
    while (i < servedFiltered.length) {
      let j = i;
      while (
        j < servedFiltered.length &&
        servedFiltered[j].stale === servedFiltered[i].stale
      ) j++;
      servedGrouped.push(...shuffle(servedFiltered.slice(i, j).map((s) => s.id)));
      i = j;
    }
    const candidates = [...neverShuffled, ...servedGrouped];
    const generated = candidates.slice(0, picksNeeded);
    const picks = [...pins, ...generated];
    lastPicks = picks;
    if (picks.length < size) continue;

    if (ceiling != null) {
      const genBudget = generated.reduce(
        (acc, id) => acc + (difficulty!.get(id) ?? 0),
        0,
      );
      if (genBudget + pinBudget > ceiling) continue;
    }

    const turns = simulateReachable(picks, cappedBundle, theme, day, turnBudget);
    if (turns != null) return { manifest: picks, turnsToSolve: turns };

    // Full-manifest sim failed. Probe each generated pick individually
    // on this day's seed; blacklist the ones that fail. This narrows
    // the sample for the next attempt instead of just reshuffling and
    // re-picking the same bad items.
    for (const id of generated) {
      if (badOnDay.has(id)) continue;
      const soloBudget = difficulty?.get(id);
      const probeBudget =
        typeof soloBudget === "number" ? Math.max(100, soloBudget * 3) : 200;
      const soloTurns = simulateReachable([id], cappedBundle, theme, day, probeBudget);
      if (soloTurns == null) badOnDay.add(id);
    }
  }

  const breakers = difficulty
    ? lastPicks.map((id) => ({
        id,
        difficulty: badOnDay.has(id) ? null : difficulty.get(id) ?? null,
      }))
    : undefined;
  throw new UnreachableManifest(lastPicks, day, breakers);
}

/* ========================================================================
 * Cluster manifest builder (T-0251)
 * ====================================================================== */

/** Transitive precursor set for an output — every output on any recipe
 *  path from base ingredients up to `id`. Includes `id` itself so Jaccard
 *  overlap captures "both items *are* each other's precursor". Base
 *  ingredients are excluded (the dealer provides them freely, so sharing
 *  them doesn't reduce sim contention). */
function precursorSet(bundle: ThemeBundle, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const t = stack.pop()!;
    if (out.has(t)) continue;
    if (!bundle.outputs.has(t)) continue;
    out.add(t);
    for (const r of bundle.recipes) {
      if (r.out !== t) continue;
      for (const p of r.all) {
        if (!out.has(p) && bundle.outputs.has(p)) stack.push(p);
      }
    }
  }
  return out;
}

/** Cache of precursor sets per bundle. Computed lazily on first lookup. */
const precursorCache = new WeakMap<ThemeBundle, Map<string, Set<string>>>();

function getPrecursors(bundle: ThemeBundle, id: string): Set<string> {
  let perBundle = precursorCache.get(bundle);
  if (!perBundle) {
    perBundle = new Map();
    precursorCache.set(bundle, perBundle);
  }
  const hit = perBundle.get(id);
  if (hit) return hit;
  const s = precursorSet(bundle, id);
  perBundle.set(id, s);
  return s;
}

/** Jaccard overlap between two items' precursor sets. 1.0 = identical
 *  build chains; 0.0 = no shared precursors. Used to rank cluster
 *  candidates by "will share tiles with the seed". */
export function precursorOverlap(bundle: ThemeBundle, a: string, b: string): number {
  if (a === b) return 1;
  const sa = getPrecursors(bundle, a);
  const sb = getPrecursors(bundle, b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  const small = sa.size < sb.size ? sa : sb;
  const big = small === sa ? sb : sa;
  for (const x of small) if (big.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 1 − overlap. Seeds must be at least `MIN_SEED_DISTANCE` apart; cluster
 *  members must be within `MAX_INTRA_CLUSTER_DISTANCE` of their seed. */
export function precursorDistance(bundle: ThemeBundle, a: string, b: string): number {
  return 1 - precursorOverlap(bundle, a, b);
}

/** Items in the pool ranked by overlap with `seed`. Seed itself is
 *  excluded. Items with zero overlap are included at the tail (if the
 *  cluster needs them to fill size) — the minimum-distance guard below
 *  rejects them in that case. */
export function kNeighbourhood(
  bundle: ThemeBundle,
  seed: string,
  pool: string[],
): Array<{ id: string; overlap: number }> {
  const out: Array<{ id: string; overlap: number }> = [];
  for (const id of pool) {
    if (id === seed) continue;
    out.push({ id, overlap: precursorOverlap(bundle, seed, id) });
  }
  out.sort((a, b) => b.overlap - a.overlap);
  return out;
}

/** Minimum precursor-distance between cluster seeds. 0.6 = seeds must
 *  share < 40% of their precursor chain, which keeps clusters topically
 *  distinct even on the broadest KB. Tunable. */
const MIN_SEED_DISTANCE = 0.6;

/** Maximum intra-cluster distance. 0.65 lets members share as little as
 *  35% of their chain with the seed — tight enough that the greedy sim
 *  benefits from shared precursors, loose enough that clusters of 3-4
 *  can actually form on mid-sized pools. */
const MAX_INTRA_CLUSTER_DISTANCE = 0.65;

/** Freshness bonus cap (days). Items never served get `rotation = null`
 *  and win placement priority; capped-fresh items get a capped bonus so
 *  a newly-added KB item doesn't permanently dominate selection once the
 *  "never served" tier empties. */
const FRESHNESS_CAP_DAYS = 30;

/** Cluster manifest builder output. Mirrors `buildManifestForDay` but
 *  also returns the `clusters` structure for admin diagnostics. */
export interface ClusterManifest {
  manifest: string[];
  turnsToSolve: number;
  clusters: Array<{ seed: string; members: string[] }>;
}

/** Build a manifest as `m` clusters of related items. Each cluster is
 *  seeded from a stale item in the pool, expanded to the top-K closest
 *  partners by precursor overlap, then verified with `simulateReachable`
 *  as a safety check.
 *
 *  Falls back to a single-cluster (`m=1`) build when the pool is small
 *  enough that multiple seeds can't satisfy `MIN_SEED_DISTANCE`. Pins
 *  still land first and bypass the cluster logic (they're forced into
 *  the final manifest even if they'd violate overlap constraints).
 *
 *  `rotation` is the same days-since-last-served map `buildManifestForDay`
 *  uses — read-only. */
export function buildClusterManifest(args: {
  cappedBundle: ThemeBundle;
  theme: ThemeKey;
  config: NonNullable<DailyConfig["manifest"]>;
  day: string;
  pool: string[];
  rotation: Map<string, number>;
  turnBudget?: number;
  difficulty?: DifficultyMap;
  /** Optional cluster count override. Defaults to `max(1, floor(sqrt(size)))`. */
  m?: number;
}): ClusterManifest {
  const {
    cappedBundle,
    theme,
    config,
    day,
    pool: rawPool,
    rotation,
    difficulty,
  } = args;
  const size = config.size ?? DEFAULT_MANIFEST_SIZE;
  const pins = config.pins ?? [];
  const picksNeeded = size - pins.length;
  const m = Math.max(1, args.m ?? Math.floor(Math.sqrt(size)));
  const turnBudget =
    args.turnBudget ??
    (difficulty
      ? (() => {
          const solvable: number[] = [];
          for (const id of rawPool) {
            const x = difficulty.get(id);
            if (typeof x === "number") solvable.push(x);
          }
          if (solvable.length === 0) return 320;
          const med = median(solvable);
          return Math.max(320, Math.round(size * med * 2));
        })()
      : 2 * size * 20);

  const cache = new Map<string, boolean>();
  for (const p of pins) {
    if (!isReachable(p, cappedBundle, cache)) throw new UnreachablePin(p);
  }
  const pinSet = new Set(pins);
  const reachablePool = rawPool.filter((id) => {
    if (pinSet.has(id)) return false;
    if (!isReachable(id, cappedBundle, cache)) return false;
    if (difficulty) {
      const d = difficulty.get(id);
      if (d === null || d === undefined) return false;
    }
    return true;
  });
  if (pins.length + reachablePool.length < size) {
    throw new UnreachableManifest(pins, day);
  }

  const badOnDay = new Set<string>();
  let lastPicks: string[] = [];

  for (let attempt = 0; attempt < MANIFEST_RESAMPLE_ATTEMPTS; attempt++) {
    const rand = mulberry32(hashStr(`cluster-manifest:${day}:${attempt}`));

    // 1. Build the staleness-weighted priority list. Never-served items
    //    win first; served items are sorted by days-since-last-served,
    //    capped so brand-new items don't permanently dominate.
    const ranked = rankByStaleness(reachablePool, rotation, badOnDay);
    if (ranked.length < picksNeeded) {
      lastPicks = pins.slice();
      break;
    }

    // 2. Pick m seeds: iterate staleness-ranked, apply small stochastic
    //    jitter so attempts differ, enforce MIN_SEED_DISTANCE between
    //    accepted seeds. If we can't place m seeds, fall back to 1.
    const seeds = pickSeeds(ranked, rand, m, cappedBundle);
    if (seeds.length === 0) {
      lastPicks = pins.slice();
      continue;
    }

    // 3. Split picks across the accepted seeds. Uneven splits are fine —
    //    sizes `[ceil(n/k), floor(n/k), ...]` to use up all slots.
    const sizes = partitionSizes(picksNeeded, seeds.length);
    const clusters: Array<{ seed: string; members: string[] }> = [];
    const chosen = new Set<string>([...pinSet, ...seeds]);
    let feasible = true;
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      const want = sizes[i]; // includes the seed itself
      const members: string[] = [seed];
      if (want > 1) {
        const neighbours = kNeighbourhood(cappedBundle, seed, reachablePool);
        for (const n of neighbours) {
          if (members.length >= want) break;
          if (chosen.has(n.id)) continue;
          if (badOnDay.has(n.id)) continue;
          if (1 - n.overlap > MAX_INTRA_CLUSTER_DISTANCE) continue;
          // Diversify within cluster: don't pick a member identical to
          // an already-picked member (overlap ~1 means same chain path).
          let tooClose = false;
          for (const m of members) {
            if (precursorOverlap(cappedBundle, m, n.id) > 0.95) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) continue;
          members.push(n.id);
          chosen.add(n.id);
        }
      }
      if (members.length < want) {
        feasible = false;
        break;
      }
      clusters.push({ seed, members });
    }

    if (!feasible) continue;

    const generated: string[] = clusters.flatMap((c) => c.members);
    const picks = [...pins, ...generated];
    lastPicks = picks;
    if (picks.length < size) continue;

    const turns = simulateReachable(picks, cappedBundle, theme, day, turnBudget);
    if (turns != null) {
      return { manifest: picks, turnsToSolve: turns, clusters };
    }

    // Probe each generated pick on this day's seed; blacklist breakers
    // for the next attempt.
    for (const id of generated) {
      if (badOnDay.has(id)) continue;
      const soloBudget = difficulty?.get(id);
      const probeBudget =
        typeof soloBudget === "number" ? Math.max(100, soloBudget * 3) : 200;
      const soloTurns = simulateReachable(
        [id],
        cappedBundle,
        theme,
        day,
        probeBudget,
      );
      if (soloTurns == null) badOnDay.add(id);
    }
  }

  const breakers = difficulty
    ? lastPicks.map((id) => ({
        id,
        difficulty: badOnDay.has(id) ? null : difficulty.get(id) ?? null,
      }))
    : undefined;
  throw new UnreachableManifest(lastPicks, day, breakers);
}

/** Rank the pool by (never-served > fresher-first > days-stale, capped),
 *  dropping items blacklisted for this day. */
function rankByStaleness(
  pool: string[],
  rotation: Map<string, number>,
  badOnDay: Set<string>,
): string[] {
  type Row = { id: string; priority: number };
  const never: string[] = [];
  const served: Row[] = [];
  for (const id of pool) {
    if (badOnDay.has(id)) continue;
    const r = rotation.get(id);
    if (r == null) never.push(id);
    else served.push({ id, priority: Math.min(r, FRESHNESS_CAP_DAYS) });
  }
  served.sort((a, b) => b.priority - a.priority);
  return [...never, ...served.map((s) => s.id)];
}

/** Pick up to `m` cluster seeds. Preserves the staleness priority (never-
 *  served first, then stalest) by walking in rank tiers, but shuffles
 *  within each tier so retries pick different seeds. Each seed must sit
 *  at ≥ `MIN_SEED_DISTANCE` from every already-accepted seed. Returns
 *  `[]` if we can't even pick one seed. */
function pickSeeds(
  ranked: string[],
  rand: () => number,
  m: number,
  bundle: ThemeBundle,
): string[] {
  const seeds: string[] = [];
  // Within-rank shuffle: ranked items with equal priority should be
  // permutable. We don't carry priorities through from rankByStaleness,
  // so approximate by shuffling the whole list before the distance walk.
  // This is a Fisher-Yates over a copy — the caller's list is untouched.
  const shuffled = ranked.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  for (const id of shuffled) {
    if (seeds.length >= m) break;
    let ok = true;
    for (const s of seeds) {
      if (precursorDistance(bundle, s, id) < MIN_SEED_DISTANCE) {
        ok = false;
        break;
      }
    }
    if (ok) seeds.push(id);
  }
  return seeds;
}

/** Split `n` picks across `k` clusters as evenly as possible. Returns
 *  `[ceil(n/k), ..., floor(n/k)]` summing to `n`. */
function partitionSizes(n: number, k: number): number[] {
  const base = Math.floor(n / k);
  const extra = n - base * k;
  const out: number[] = [];
  for (let i = 0; i < k; i++) out.push(base + (i < extra ? 1 : 0));
  return out;
}

/* ========================================================================
 * Pool resolver (combine_themes membership)
 * ====================================================================== */

/** Resolve the pool for a `DailyConfig.manifest.pool` — a
 *  `combine_themes.code`. Returns the set of output ids that are
 *  members of that combine theme AND appear as outputs in the bundle.
 *
 *  This is pure over the inputs so the admin preview endpoint and the
 *  schedule-builder can share it without a DB round-trip from here. */
export function resolveManifestPool(
  poolMemberIds: Iterable<string>,
  bundle: ThemeBundle,
): string[] {
  const out: string[] = [];
  for (const id of poolMemberIds) {
    if (bundle.outputs.has(id)) out.push(id);
  }
  out.sort();
  return out;
}

// Used by the recipe filter above; exported for tests + admin preview.
export type { CombineRecipe };
