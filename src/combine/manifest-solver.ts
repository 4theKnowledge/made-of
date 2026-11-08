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

/** Can a greedy auto-player produce every item in `manifest` within
 *  `turnBudget` turns, using today's deterministic daily seed? Returns
 *  the number of turns taken, or null on failure.
 *
 *  This isn't a perfect oracle — a smarter player could do better, and
 *  a worse player could do worse. The greedy policy is "any legal
 *  `place` action that produces a manifest item; otherwise any legal
 *  move that cycles the tray." It's conservative, so if the sim
 *  succeeds the real player will too; if it fails, the item might
 *  still be reachable with effort, but we reject to avoid serving a
 *  manifest nobody can finish.
 *
 *  Budget math: ~2 turns per manifest item per discovery depth (chain
 *  length), capped. Default is `2 * size * 20` as per T-0237's note. */
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
  for (let turn = 0; turn < turnBudget; turn++) {
    if (state.manifestFound.length >= manifest.length) {
      return turn;
    }
    if (state.over) return null;
    // Find any (traySlot, cell) that would produce a manifest item not
    // yet found. If multiple, prefer the one whose output is closest to
    // being manifest-completing (deepest unfound item first).
    const unfound = new Set(
      manifest.filter((m) => !state.manifestFound.includes(m)),
    );
    const move = findPlaceToward(state, bundle, unfound);
    if (move) {
      const r = reduce(state, bundle, move);
      state = r.state;
      continue;
    }
    // No manifest-producing placement available. Try any legal `place`
    // to cycle tiles so new trays deal — if the board is full, bail.
    const fallback = findAnyLegalPlace(state);
    if (!fallback) return null;
    const r = reduce(state, bundle, fallback);
    state = r.state;
  }
  return state.manifestFound.length >= manifest.length ? turnBudget : null;
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
  ) {
    super(
      `manifest for ${day} failed solver after retries (${manifest.join(", ")})`,
    );
    this.name = "UnreachableManifest";
  }
}

/** Build the frozen per-day manifest. Picks admin-pinned items first,
 *  fills the rest from the pool with rotation weighting, verifies with
 *  the headless simulator. Retries resampling the non-pinned slots up
 *  to 3× on simulator failure before throwing.
 *
 *  `rotation` is a map of outputId -> days-since-last-served for every
 *  manifest item that appeared in the rotation window. Items absent
 *  from the map are "never served" and win placement priority — mirror
 *  of `pickGuests` to keep the vocabulary consistent. */
export function buildManifestForDay(args: {
  cappedBundle: ThemeBundle;
  theme: ThemeKey;
  config: NonNullable<DailyConfig["manifest"]>;
  day: string;
  pool: string[];
  rotation: Map<string, number>;
  turnBudget?: number;
}): { manifest: string[]; turnsToSolve: number } {
  const {
    cappedBundle,
    theme,
    config,
    day,
    pool: rawPool,
    rotation,
  } = args;
  const size = config.size ?? DEFAULT_MANIFEST_SIZE;
  const pins = config.pins ?? [];
  const turnBudget = args.turnBudget ?? 2 * size * 20;
  const cache = new Map<string, boolean>();
  // 1. Validate pins are reachable.
  for (const p of pins) {
    if (!isReachable(p, cappedBundle, cache)) {
      throw new UnreachablePin(p);
    }
  }
  // 2. Filter the pool: reachable outputs only, minus pins.
  const pinSet = new Set(pins);
  const reachablePool = rawPool.filter(
    (id) => !pinSet.has(id) && isReachable(id, cappedBundle, cache),
  );
  if (pins.length + reachablePool.length < size) {
    throw new UnreachableManifest(pins, day);
  }
  // 3. Rotation-aware weighted sample from the pool.
  const rand = mulberry32(hashStr(`manifest:${day}`));
  const shuffle = <T,>(xs: T[]): T[] => {
    const out = xs.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const never: string[] = [];
  const served: Array<{ id: string; stale: number }> = [];
  for (const id of reachablePool) {
    const r = rotation.get(id);
    if (r == null) never.push(id);
    else served.push({ id, stale: r });
  }
  const neverShuffled = shuffle(never);
  served.sort((a, b) => b.stale - a.stale);
  const servedGrouped: string[] = [];
  let i = 0;
  while (i < served.length) {
    let j = i;
    while (j < served.length && served[j].stale === served[i].stale) j++;
    servedGrouped.push(...shuffle(served.slice(i, j).map((s) => s.id)));
    i = j;
  }
  const candidates = [...neverShuffled, ...servedGrouped];
  // 4. Attempt the pick; resample up to 3× if the simulator fails.
  const picksNeeded = size - pins.length;
  for (let attempt = 0; attempt < 3; attempt++) {
    // Rotate the candidates on each retry via a 1-position shift so we
    // get a different pick without re-shuffling the whole pool (keeps
    // the generation deterministic per (day, attempt)).
    const offset = attempt;
    const picks = [
      ...pins,
      ...candidates.slice(offset, offset + picksNeeded),
    ];
    if (picks.length < size) continue; // not enough reachable candidates
    const turns = simulateReachable(
      picks,
      cappedBundle,
      theme,
      day,
      turnBudget,
    );
    if (turns != null) return { manifest: picks, turnsToSolve: turns };
  }
  throw new UnreachableManifest([...pins, ...candidates.slice(0, picksNeeded)], day);
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
