/**
 * Chapter-progression sampler.
 *
 * The dealer samples from a *reachability pool* that grows as the player
 * discovers items — not a fixed content window.
 *
 * Definitions (per run, computed from the current found set):
 *
 *   known      = base ingredients ∪ items the player has discovered
 *   oneHopIng  = ingredients x such that some recipe r has x in r.all
 *                AND ≥1 other ingredient of r is in `known`
 *   oneHopOut  = outputs of recipes whose ingredients are entirely in `known`
 *                (these can fire right now)
 *   pool       = known ∪ oneHopIng ∪ oneHopOut
 *
 * The dealer is biased toward recipes that use something the player already
 * knows, so the board accumulates logical neighbours rather than random
 * jumps. Progression is player-driven: the pool grows with discoveries.
 *
 * Scales with KB: the pool is graph-local, never band-indexed. A larger KB
 * means a larger eventual pool, but the "one hop from known" invariant
 * keeps per-turn choices bounded.
 */

import type { CombineRecipe, ThemeBundle } from "./types";

export interface SoftPool {
  /** Items the player has engaged with: discoveries ∪ base ingredients.
   *  The anchor for everything else. */
  known: Set<string>;
  /** Recipes where every ingredient is in `known` — these can fire now.
   *  Outputs of these are first-class discoverables. */
  reachableRecipes: CombineRecipe[];
  /** All tiles safe to deal: anything already-known or one recipe-hop away. */
  pool: Set<string>;
  /** Ingredients subset of pool (callers that need raw inputs). */
  basePool: string[];
  /** Outputs subset of pool (callers that need mid-game tiles). */
  midPool: string[];
}

/** Compute the soft pool for the current player state. Pure function;
 *  `known` is derived from `found` + bundle base ingredients. */
export function softPool(bundle: ThemeBundle, found: string[]): SoftPool {
  const known = new Set<string>();
  for (const id of bundle.base) known.add(id);
  for (const id of found) known.add(id);

  // Pass 1: recipes whose ingredients are entirely in known → their outputs
  // are reachable (will become known-equivalent once discovered). Also
  // partially-known recipes contribute their "missing" ingredients as
  // one-hop-out candidates — those are the tiles the dealer will serve.
  const reachableRecipes: CombineRecipe[] = [];
  const pool = new Set<string>(known);
  for (const r of bundle.recipes) {
    let knownCount = 0;
    for (const x of r.all) if (known.has(x)) knownCount++;
    if (knownCount === r.all.length) {
      reachableRecipes.push(r);
      // Skip terminal outputs: nothing consumes them, so dealing them
      // raw clogs the board (they sit until crumble). Still reachable —
      // the player can make them by placing the ingredients themselves.
      if (!bundle.terminal.has(r.out)) pool.add(r.out);
    } else if (knownCount >= 1 && r.all.length >= 2) {
      // Partial match: add the missing ingredients so the dealer can
      // introduce them. Terminal ingredients don't exist by definition
      // (ingredients are by definition consumed), so no gate needed here.
      for (const x of r.all) pool.add(x);
      // Don't add r.out — not reachable yet.
    }
    // knownCount === 0: no attachment; skip entirely (keeps pool graph-local).
  }

  // Terminals never belong in the dealable pool, even if the player has
  // already discovered them (so they'd otherwise ride in via `known`).
  // The dealer must never surface a tile with no outgoing recipe —
  // nothing combines with it and it just sits until crumble.
  for (const id of bundle.terminal) pool.delete(id);

  // Derived views.
  const basePool: string[] = [];
  const midPool: string[] = [];
  for (const id of pool) {
    if (bundle.outputs.has(id)) midPool.push(id);
    else basePool.push(id);
  }

  return { known, reachableRecipes, pool, basePool, midPool };
}

/**
 * KB-size-invariant chapter thresholds.
 *
 * Replaces the earlier fraction-of-KB scheme (`softAgeThresholds`) which
 * broke at large KBs — at 40k items the first chapter would demand 1600
 * finds. Log-scaling is independent of KB size: chapter N always takes
 * ~N finds, so early-game dopamine stays steady regardless of content
 * volume. See T-0167.
 *
 *   threshold(k) = floor(a * b^k), a=10, b=1.8
 *   → [10, 18, 32, 58, 105, 189, 340, 612, 1101, 1983, ...]
 *
 * Chapters are open-ended; the caller treats "past the last computed
 * threshold" as `Infinity` (same open-ended semantics as the prior flat
 * variant).
 */
const CHAPTER_A = 10;
const CHAPTER_B = 1.8;
const CHAPTER_DEPTH = 12; // precompute 12 chapters; past that → Infinity

const CHAPTER_THRESHOLDS: readonly number[] = (() => {
  const xs: number[] = [];
  for (let k = 0; k < CHAPTER_DEPTH; k++) xs.push(Math.floor(CHAPTER_A * CHAPTER_B ** k));
  return xs;
})();

/** Cumulative unique-find count required to enter chapter `k` (0-based).
 *  Chapter 0 entry threshold is 0 (always true). Past `CHAPTER_DEPTH`,
 *  returns Infinity (open-ended tail). */
export function chapterThreshold(k: number): number {
  if (k <= 0) return 0;
  const idx = k - 1;
  return CHAPTER_THRESHOLDS[idx] ?? Number.POSITIVE_INFINITY;
}

/** Highest chapter index achievable with `finds` cumulative discoveries.
 *  Returns 0 for finds < threshold(1). */
export function chapterIndex(finds: number): number {
  let k = 0;
  for (let i = 0; i < CHAPTER_THRESHOLDS.length; i++) {
    if (finds >= CHAPTER_THRESHOLDS[i]) k = i + 1;
    else break;
  }
  return k;
}

/** Legacy accessor (kept so engine.ts doesn't break; forwards to chapters). */
export function softNeed(age: number, _totalItems: number): number {
  return chapterThreshold(age + 1);
}

/**
 * Helper-grant milestones. Same curve shape as chapters, offset by 50% so
 * helpers fire mid-chapter. Players get a reward every few discoveries
 * early on, with intervals widening as they progress.
 *
 *   helperThreshold(k) = floor(c * b^k), c=5, b=1.8
 *   → [5, 9, 16, 29, 52, 94, 170, 306, ...]
 */
const HELPER_C = 5;
const HELPER_B = 1.8;
const HELPER_DEPTH = 14;

const HELPER_THRESHOLDS: readonly number[] = (() => {
  const xs: number[] = [];
  for (let k = 0; k < HELPER_DEPTH; k++) xs.push(Math.floor(HELPER_C * HELPER_B ** k));
  return xs;
})();

/** Cumulative discoveries required to earn helper milestone `k` (0-based).
 *  Milestone 0 is always granted (initial game setup). */
export function helperMilestoneThreshold(k: number): number {
  if (k <= 0) return 0;
  const idx = k - 1;
  return HELPER_THRESHOLDS[idx] ?? Number.POSITIVE_INFINITY;
}

/** Highest helper milestone achieved at `finds` cumulative discoveries. */
export function helperMilestoneIndex(finds: number): number {
  let k = 0;
  for (let i = 0; i < HELPER_THRESHOLDS.length; i++) {
    if (finds >= HELPER_THRESHOLDS[i]) k = i + 1;
    else break;
  }
  return k;
}

/** Legacy constant TTL — retained as an upper reference for the
 *  occupancy-scaled TTL below and as the fallback when the caller doesn't
 *  provide an occupancy. The active formula is `effectiveCrumbleTtl`. */
export const CRUMBLE_INACTIVITY_MOVES = 40;

/**
 * Occupancy-scaled crumble TTL (T-0176).
 *
 * Idle tiles die faster as the board fills up. Pressure emerges from the
 * player's own board state instead of a fixed timer: an empty board is
 * generous, a nearly-full board forces declutter.
 *
 *   occ = occupied / total
 *   t = max(0, (occ - START) / (1 - START))
 *   ttl = TTL_MAX - (TTL_MAX - TTL_MIN) * t
 *
 * With defaults (MAX=60, MIN=20, START=0.3) and a 6×6 board:
 *   occ   0%  → 60 moves (very lenient)
 *   occ  30%  → 60 moves (pressure begins)
 *   occ  50%  → 43 moves
 *   occ  70%  → 26 moves
 *   occ 100%  → 20 moves (tight)
 */
export const CRUMBLE_TTL_MAX = 60;
export const CRUMBLE_TTL_MIN = 20;
export const CRUMBLE_OCCUPANCY_START = 0.3;

/** Return the effective inactivity TTL for a board at the given occupancy
 *  fraction (0..1). Linear ramp from TTL_MAX to TTL_MIN once occupancy
 *  exceeds OCCUPANCY_START. */
export function effectiveCrumbleTtl(occupancy: number): number {
  const span = 1 - CRUMBLE_OCCUPANCY_START;
  const t = Math.max(0, (occupancy - CRUMBLE_OCCUPANCY_START) / (span > 0 ? span : 1));
  const ttl = CRUMBLE_TTL_MAX - (CRUMBLE_TTL_MAX - CRUMBLE_TTL_MIN) * Math.min(1, t);
  return Math.round(ttl);
}

/** Dealer down-weight for tiles the player has already discovered (T-0170).
 *  Discovered tiles aren't removed from the sampling pool — they're still
 *  useful as ingredients for undiscovered recipes — but they appear ~80%
 *  less often in trays so fresh discoveries get more airtime. 1.0 would
 *  disable this. */
export const DISCOVERED_WEIGHT = 0.2;
