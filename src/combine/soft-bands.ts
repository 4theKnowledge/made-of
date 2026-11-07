/**
 * Soft-bands sampler (T-0163).
 *
 * Instead of hard age-banded gating, the dealer samples from a
 * *reachability pool* that grows as the player discovers items.
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
      pool.add(r.out);
      // All ingredients were already in known; added to pool via `known`.
    } else if (knownCount >= 1 && r.all.length >= 2) {
      // Partial match: add the missing ingredients so the dealer can
      // introduce them.
      for (const x of r.all) pool.add(x);
      // Don't add r.out — not reachable yet.
    }
    // knownCount === 0: no attachment; skip entirely (keeps pool graph-local).
  }

  // Derived views.
  const basePool: string[] = [];
  const midPool: string[] = [];
  for (const id of pool) {
    if (bundle.outputs.has(id)) midPool.push(id);
    else basePool.push(id);
  }

  return { known, reachableRecipes, pool, basePool, midPool };
}

/** Thresholds for soft-bands age-up, scaled to the theme size. Each age
 *  demands a fraction of the total collection discovered so far. Monotonic;
 *  the final age never completes (open-ended by design). */
export function softAgeThresholds(totalItems: number): number[] {
  // Rough shape: 4% / 10% / 20% / 35% / 55% / 80% / 100%.
  // At 397 items that's ~16 / 40 / 79 / 139 / 218 / 318 / 397.
  const fractions = [0.04, 0.1, 0.2, 0.35, 0.55, 0.8, 1.0];
  return fractions.map((f) => Math.max(1, Math.ceil(f * totalItems)));
}

/** How many unique discoveries to leave age `age`? Returns Infinity past
 *  the last threshold (treats final age as open-ended). */
export function softNeed(age: number, totalItems: number): number {
  const thresholds = softAgeThresholds(totalItems);
  return thresholds[age] ?? Number.POSITIVE_INFINITY;
}
