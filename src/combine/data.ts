/**
 * Build Combine's per-theme recipe bundle from the live graph snapshot.
 *
 * One projection pass over the graph. Membership comes from the
 * item_combine_themes join table via inCombineTheme(); no hard-coded
 * name lists.
 */

import type { Snapshot } from "../graph/snapshot";
import type { GraphNode } from "../graph/types";
import type { DailyConfig } from "./daily-config";
import { THEMES, inCombineTheme, themeAgePool } from "./filters";
import { computeRefine } from "./levels";
import type {
  AgeSets,
  CombineItem,
  CombineRecipe,
  Mode,
  ThemeBundle,
  ThemeKey,
} from "./types";

/** Collect the parts for one of a node's recipes. All four recipe-scoped
 *  link types (f = made from, w = made with, n = needs, e = evolved from)
 *  are treated as combinable ingredients: the player places them together
 *  on the board. The sets stay separate so the UI/debug can distinguish
 *  them, but matching only cares about the deduped `all`. */
export function _recipeParts_FOR_TEST(
  node: GraphNode,
  recipeId: string,
): ReturnType<typeof recipeParts> {
  return recipeParts(node, recipeId);
}

function recipeParts(
  node: GraphNode,
  recipeId: string,
): {
  from: string[];
  with_: string[];
  needs: string[];
  evolved: string[];
  all: string[];
  /** True if the raw edge list named this recipe's output as one of its
   *  own parts (e.g. "recycled paper" from `paper + water`). We drop the
   *  self-ref so recipes don't loop, but that collapses the ingredient
   *  list and can produce spurious 1-input recipes ("water → paper"
   *  looks nonsensical to players). Callers use this to reject such
   *  collapses rather than surface them as promotes. */
  hadSelfRef: boolean;
} {
  const fromSet = new Set<string>();
  const withSet = new Set<string>();
  const needsSet = new Set<string>();
  const evolvedSet = new Set<string>();
  let hadSelfRef = false;
  for (const e of node.up) {
    if (e.recipeId !== recipeId) continue;
    if (e.id === node.id) {
      hadSelfRef = true;
      continue;
    }
    if (e.type === "f") fromSet.add(e.id);
    else if (e.type === "w") withSet.add(e.id);
    else if (e.type === "n") needsSet.add(e.id);
    else if (e.type === "e") evolvedSet.add(e.id);
  }
  const all = new Set<string>([
    ...fromSet,
    ...withSet,
    ...needsSet,
    ...evolvedSet,
  ]);
  return {
    from: [...fromSet],
    with_: [...withSet],
    needs: [...needsSet],
    evolved: [...evolvedSet],
    all: [...all],
    hadSelfRef,
  };
}

function recipesForTheme(
  snapshot: Snapshot,
  theme: ThemeKey,
): CombineRecipe[] {
  const out: CombineRecipe[] = [];
  for (const node of snapshot.nodes.values()) {
    if (!inCombineTheme(node, theme)) continue;
    for (const recipe of node.recipes) {
      const { from, with_, needs, evolved, all, hadSelfRef } = recipeParts(
        node,
        recipe.id,
      );
      // 1-ingredient recipes are kept — they're unreachable via normal
      // combining (nothing to "pair" with), so Combine surfaces them as an
      // explicit "promote" action on the board. matchAt/matchOn skip them
      // so a 1-input tile doesn't auto-fire on placement.
      if (all.length < 1 || all.length > 7) continue;
      if (all.some((partId) => partId === node.id)) continue;
      // Reject recipes where the raw input list referenced the output
      // itself and that self-ref was the only thing keeping it from being
      // ≤1-input (e.g. "recycled paper" from `paper + water` collapses
      // to just `water` → paper, which reads as nonsense). Those authored
      // recipes are still valid in Explore; they just don't belong in
      // Combine as 1-input promotes.
      if (hadSelfRef && all.length < 2) continue;

      const partNodes = all
        .map((id) => snapshot.nodes.get(id))
        .filter((n): n is GraphNode => Boolean(n));
      if (partNodes.length < all.length) continue;
      if (partNodes.some((p) => !inCombineTheme(p, theme))) continue;

      out.push({
        id: recipe.id,
        out: node.id,
        from,
        with: with_,
        needs,
        evolved,
        all,
        lvl: 0,
        band: 1,
      });
    }
  }
  return out;
}

/**
 * Pick how many age bands a theme should expose, given its recipe count and
 * the previously-promoted count. Monotonic: never shrinks, so a KB edit can
 * never retroactively collapse a leaderboard season.
 *
 * Rules:
 * - Volume drives growth: ~`RECIPES_PER_AGE` recipes per age.
 * - Floor at `MIN_AGES` so a tiny KB is still playable.
 * - Sparse-frontier guard: don't promote an age that would hold fewer than
 *   `MIN_RECIPES_PER_AGE` recipes. Those recipes still exist and are still
 *   dealt — they ride along in the current top band until the frontier
 *   thickens.
 * - Monotonic: result >= `prevNumAges` always.
 */
export function deriveNumAges(
  recipeCount: number,
  prevNumAges: number,
): number {
  const RECIPES_PER_AGE = 25;
  const MIN_AGES = 3;
  const MIN_RECIPES_PER_AGE = 3;

  const byVolume = Math.floor(recipeCount / RECIPES_PER_AGE);
  const sparsityCap = Math.floor(recipeCount / MIN_RECIPES_PER_AGE);
  // Floor at MIN_AGES, but never fabricate ages that can't hold the guard —
  // sparsityCap wins over MIN_AGES only when the KB is genuinely too small.
  const target = Math.min(sparsityCap, Math.max(MIN_AGES, byVolume));
  return Math.max(prevNumAges, target);
}

/** Minimum recipes a band may hold after push-forward. Below this the band
 *  is a "dead age" — the dealer can't produce enough current-age combos for
 *  the player to progress. The merge pass folds under-populated bands into
 *  their predecessor until every surviving band meets this floor. */
const MIN_BAND_SIZE = 10;

/** The merge pass will not drop below this many effective ages, even if the
 *  surviving bands would be sparse. Collapsing to a single age is worse UX
 *  (no progression visible) than keeping a thin top age. If the KB is so
 *  small it genuinely only populates fewer than this many bands, the
 *  effective count caps to the populated count. */
const MIN_EFFECTIVE_AGES = 3;

/** Assign refinement levels inside the theme, cut into ages, push outputs
 *  forward so no recipe needs a later-age part, then merge any sparse band
 *  into its predecessor. Returns the effective number of distinct bands
 *  after merging (≤ `numAges`). */
function assignAges(
  snapshot: Snapshot,
  recipes: CombineRecipe[],
  outputs: Set<string>,
  numAges: number,
): number {
  const refine = computeRefine(snapshot);

  // Theme outputs start at infinity; ingredients the theme doesn't make
  // carry their knowledge-base refine value.
  const d = new Map<string, number>();
  for (const r of recipes) {
    for (const x of [...r.all, r.out]) {
      if (!d.has(x)) {
        d.set(
          x,
          outputs.has(x) ? Number.POSITIVE_INFINITY : refine.get(x) ?? 0,
        );
      }
    }
  }

  const value = (r: CombineRecipe, loose: boolean): number => {
    const vs: number[] = [];
    for (const id of r.all) {
      const v = d.get(id) ?? Number.POSITIVE_INFINITY;
      if (loose && v === Number.POSITIVE_INFINITY) continue;
      vs.push(v);
    }
    if (!loose && vs.length < r.all.length) return Number.POSITIVE_INFINITY;
    return 1 + (vs.length ? Math.max(...vs) : 0);
  };

  for (const loose of [false, true]) {
    for (let k = 0; k < 80; k++) {
      let changed = false;
      for (const r of recipes) {
        const v = value(r, loose);
        const cur = d.get(r.out) ?? Number.POSITIVE_INFINITY;
        if (v < cur) {
          d.set(r.out, v);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  for (const r of recipes) r.lvl = value(r, true);

  // Cut recipes into bands so each band holds a similar number of recipes.
  // Walk the sorted level list, starting a new band whenever accumulated
  // size reaches a running target (recomputed per remaining band so an
  // early overshoot doesn't starve later bands). This gives smoother sizes
  // than quantile cuts on the raw rank array (which can dump all recipes
  // at a popular level into one band) and degrades gracefully as the KB
  // grows: more content → bands fill out evenly.
  const byLevel = new Map<number, number>();
  for (const r of recipes) byLevel.set(r.lvl, (byLevel.get(r.lvl) ?? 0) + 1);
  const uniqueLevels = [...byLevel.keys()].sort((a, b) => a - b);
  // The cut algorithm can produce at most `uniqueLevels.length` bands —
  // each cut sits between two adjacent levels. If `numAges` exceeds that,
  // the `levelsLeft >= bandsAfterCut` guard below refuses every cut
  // (there aren't enough levels left to populate the planned-remaining
  // bands), and everything collapses to band 1. Cap to what's actually
  // achievable so the guard behaves as intended.
  const targetAges = Math.min(numAges, Math.max(1, uniqueLevels.length));
  const cuts: number[] = [];
  let remaining = recipes.length;
  let acc = 0;
  for (let i = 0; i < uniqueLevels.length && cuts.length < targetAges - 1; i++) {
    const lvl = uniqueLevels[i];
    const n = byLevel.get(lvl) ?? 0;
    acc += n;
    remaining -= n;
    const bandsLeft = targetAges - cuts.length;
    const target = Math.ceil((acc + remaining) / bandsLeft);
    const levelsLeft = uniqueLevels.length - 1 - i;
    const bandsAfterCut = bandsLeft - 1;
    // Three gates:
    // 1. `levelsLeft >= bandsAfterCut` — never cut if doing so would leave
    //    more future bands than remaining levels (empty bands break the UI).
    // 2. `acc >= target` — prefer cuts that respect the balanced-size target.
    // 3. `levelsLeft == bandsAfterCut` — forced cut: from here on every
    //    remaining boundary must be used or we'll run out of levels. Without
    //    this, early misses on gate 2 lock us out of ever cutting (prod's
    //    2026-11 bug where numAges > uniqueLevels caused band collapse).
    const mustCut = levelsLeft === bandsAfterCut;
    const canCut = levelsLeft >= bandsAfterCut;
    if (canCut && (mustCut || acc >= target)) {
      cuts.push(lvl);
      acc = 0;
    }
  }
  for (const r of recipes) {
    let band = 1;
    for (const c of cuts) if (r.lvl > c) band++;
    r.band = Math.min(targetAges, band);
  }

  // Push a recipe forward if any of its parts is only made in a later age.
  // outBand[x] = min band across all recipes producing x. Recompute from
  // scratch inside the loop so bumping a recipe's band also lifts its
  // output's floor when applicable.
  const recomputeOutBand = (): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of recipes) {
      const cur = m.get(r.out);
      if (cur == null || r.band < cur) m.set(r.out, r.band);
    }
    return m;
  };
  for (let k = 0; k < 20; k++) {
    const outBand = recomputeOutBand();
    let changed = false;
    for (const r of recipes) {
      for (const partId of r.all) {
        const ob = outBand.get(partId);
        if (ob != null && ob > r.band) {
          r.band = ob;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Merge sparse bands. The balanced cut aims for equal recipe counts per
  // band, but push-forward can gut a band by shoving its outputs later.
  // Any band holding < MIN_BAND_SIZE recipes becomes a "dead age" — the
  // dealer can't surface enough current-age combos for players to progress,
  // so they get stuck. Fold any such band into its predecessor (or into
  // the following band if it's band 1 with no predecessor), then renumber
  // bands to be contiguous 1..M. Iterate until stable.
  //
  // Floor: never collapse below MIN_EFFECTIVE_AGES, even if that leaves a
  // sparse band behind. A single-age game is worse UX than a thin last age.
  // When the whole KB really is tiny, the floor caps to how many bands are
  // actually populated.
  let effective = numAges;
  // Clamp: effective can't exceed the current max band actually in use.
  const seenBands = new Set<number>(recipes.map((r) => r.band));
  effective = Math.min(effective, Math.max(0, ...seenBands));
  const populatedBands = seenBands.size;
  const floor = Math.min(MIN_EFFECTIVE_AGES, populatedBands);
  for (let pass = 0; pass < numAges; pass++) {
    if (effective <= floor) break;
    const sizes = new Array(effective + 1).fill(0);
    for (const r of recipes) sizes[r.band] = (sizes[r.band] ?? 0) + 1;
    let mergedAt = -1;
    for (let b = 1; b <= effective; b++) {
      if (sizes[b] > 0 && sizes[b] < MIN_BAND_SIZE) {
        mergedAt = b;
        break;
      }
    }
    if (mergedAt === -1) break;
    // Merge direction:
    //  - band X>1: fold band X into band X-1, slide everything above down.
    //  - band 1  : fold band 1 forward into band 2 (its successor), slide
    //              everything above down. (Band 1 has no predecessor.)
    // Both cases: dependency invariant is preserved — merging adjacent
    // bands can never introduce a "needs a later part" violation since the
    // relative order of all parts/outputs is unchanged.
    const mergeTarget = mergedAt === 1 ? 2 : mergedAt - 1;
    for (const r of recipes) {
      if (r.band === mergedAt) r.band = mergeTarget;
    }
    // Now compress: anything above the vacated slot slides down by one.
    const vacated = mergedAt === 1 ? 1 : mergedAt;
    for (const r of recipes) {
      if (r.band > vacated) r.band -= 1;
    }
    effective -= 1;
  }
  return Math.max(1, effective);
}

function makeItemView(node: GraphNode): CombineItem {
  const first = node.recipes[0];
  let lore: string[] | undefined;
  if (first) {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const e of node.up) {
      if (e.recipeId !== first.id) continue;
      if (e.type !== "f") continue;
      if (e.id === node.id) continue;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      parts.push(e.id);
    }
    if (parts.length > 0) lore = parts;
  }
  return {
    id: node.id,
    slug: node.slug,
    name: node.name,
    tier: node.tier,
    symbol: node.symbol,
    fact: node.fact,
    kind: node.kind,
    ...(lore ? { lore } : {}),
  };
}

/** Guest recipes to splice into a daily bundle after capping. Each one
 *  comes from the full (uncapped) theme recipe set via the scheduler and
 *  is placed in the final band so the dealer treats it like a current-age
 *  recipe. Pass `null` for non-daily or guest-less builds. */
export interface GuestRecipeExtension {
  /** The recipe row to splice in. Its `band` is overwritten to the cap. */
  recipe: CombineRecipe;
}

export function buildThemeBundle(
  snapshot: Snapshot,
  theme: ThemeKey,
  prevNumAges: number = 0,
  mode: Mode = "classic",
  dailyConfig: DailyConfig | null = null,
  guestRecipes: GuestRecipeExtension[] | null = null,
): ThemeBundle {
  const base_meta = THEMES[theme];
  let recipes = recipesForTheme(snapshot, theme);
  if (mode === "fast") {
    // Fast mode: short recipes only (≤ 3 ingredients). Pair-only was too
    // easy — a 3-part combo adds real board-reading without stretching into
    // the long chains that make classic feel slow. No age progression, so
    // every recipe lives in a single band.
    recipes = recipes.filter((r) => r.all.length <= 3);
  }

  let meta: typeof base_meta;
  let guestPool: string[] | undefined;
  if (mode === "fast") {
    // Fast mode has no age progression — every recipe stays in band 1 and
    // the theme exposes a single age label so UI surfaces that render age
    // chips still have something to show.
    for (const r of recipes) {
      r.lvl = 0;
      r.band = 1;
    }
    meta = { ...base_meta, ages: ["Fast"] };
  } else {
    const preOutputs = new Set<string>(recipes.map((r) => r.out));
    const pool = themeAgePool(theme);
    const rawNumAges = deriveNumAges(recipes.length, prevNumAges);
    // Never exceed the authored name pool; a KB that outgrows it needs new
    // authored names before promotion can take effect.
    const numAges = Math.min(rawNumAges, pool.length);
    // `assignAges` may merge sparse bands and return a smaller effective count.
    // The displayed age list reflects the merged layout — no "dead ages" with
    // too few recipes for the dealer to surface progression combos.
    let effectiveNumAges = assignAges(snapshot, recipes, preOutputs, numAges);
    // Daily may cap the run short. When capped, recipes above the cap are
    // dropped from the playable set (so the dealer never deals them and
    // victory fires at the capped final age); outputs from above-cap bands
    // are captured separately as the guest-ingredient pool.
    if (dailyConfig?.maxAges != null && dailyConfig.maxAges < effectiveNumAges) {
      effectiveNumAges = dailyConfig.maxAges;
    }
    meta = { ...base_meta, ages: pool.slice(0, effectiveNumAges) };

    if (dailyConfig?.maxAges != null && dailyConfig.guestIngredient && dailyConfig.guestIngredient.perRun > 0) {
      const minBand = Math.max(dailyConfig.guestIngredient.minBand, dailyConfig.maxAges + 1);
      // Guest = output whose *minimum* band is above the cap. If the same
      // output has any below-cap recipe, players can make it normally and it
      // shouldn't be a guest.
      const minBandByOutput = new Map<string, number>();
      for (const r of recipes) {
        const cur = minBandByOutput.get(r.out);
        if (cur == null || r.band < cur) minBandByOutput.set(r.out, r.band);
      }
      const pool: string[] = [];
      for (const [out, minB] of minBandByOutput) {
        if (minB >= minBand) pool.push(out);
      }
      guestPool = pool;
    }

    // Apply the daily age cap to the actual recipe set. Must happen AFTER
    // guest-pool capture so above-cap outputs are still reachable as guests.
    if (dailyConfig?.maxAges != null) {
      recipes = recipes.filter((r) => r.band <= dailyConfig.maxAges!);
    }

    // Splice in today's guest recipes. They live at the final band so the
    // dealer surfaces them as "current-age" combines; first-finds on them
    // count toward the daily collection (scope=daily) via the normal
    // discovery path. If maxAges is null (no cap), guests are a no-op —
    // the player already sees every recipe.
    if (guestRecipes && guestRecipes.length > 0 && dailyConfig?.maxAges != null) {
      const finalBand = dailyConfig.maxAges;
      for (const g of guestRecipes) {
        // Clone so we don't mutate the shared recipe object held by the
        // full-theme bundle. Overwrite band so age gating treats it as
        // current-age playable.
        recipes.push({ ...g.recipe, band: finalBand });
      }
    }
  }

  const outputs = new Set<string>(recipes.map((r) => r.out));
  const ingredients = new Set<string>(recipes.flatMap((r) => r.all));
  const tools = new Set<string>(recipes.flatMap((r) => r.with));
  const baseIng = [...ingredients].filter((x) => !outputs.has(x));
  const mid = [...ingredients].filter((x) => outputs.has(x));
  const terminal = new Set<string>(
    [...outputs].filter((x) => !ingredients.has(x)),
  );

  // Index recipes by every ingredient, biggest first.
  const byIngredient = new Map<string, CombineRecipe[]>();
  for (const r of recipes) {
    for (const x of r.all) {
      let list = byIngredient.get(x);
      if (!list) {
        list = [];
        byIngredient.set(x, list);
      }
      list.push(r);
    }
  }
  for (const list of byIngredient.values()) {
    list.sort((a, b) => b.all.length - a.all.length);
  }

  // Alternative outputs for the same ingredient set.
  const sameIngredients = new Map<string, CombineRecipe[]>();
  for (const r of recipes) {
    const k = [...r.all].sort().join("+");
    let list = sameIngredients.get(k);
    if (!list) {
      list = [];
      sameIngredients.set(k, list);
    }
    if (!list.some((q) => q.out === r.out)) list.push(r);
  }

  const items = new Map<string, CombineItem>();
  // Adding an item may surface lore parts (e.g. water's hydrogen+oxygen)
  // that aren't ingredients in this theme; they still need an item view
  // so the detail card can render them.
  const queue: string[] = [...outputs, ...ingredients];
  while (queue.length) {
    const id = queue.shift()!;
    if (items.has(id)) continue;
    const node = snapshot.nodes.get(id);
    if (!node) continue;
    const view = makeItemView(node);
    items.set(id, view);
    if (view.lore) {
      for (const p of view.lore) if (!items.has(p)) queue.push(p);
    }
  }

  const outBand = new Map<string, number>();
  for (const r of recipes) {
    const cur = outBand.get(r.out);
    if (cur == null || r.band < cur) outBand.set(r.out, r.band);
  }

  return {
    theme: meta,
    recipes,
    byIngredient,
    outputs,
    ingredients,
    base: baseIng,
    mid,
    tools,
    terminal,
    sameIngredients,
    items,
    outBand,
    dailyConfig: dailyConfig ?? null,
    guestPool,
  };
}

/**
 * The slice of a theme "in play" at a given age (0-based index).
 *
 * The dealer picks only from tiles whose recipes live in bands [age, age+1]
 * (1-based). Crumbling clears tiles that aren't useful across bands
 * [age, age+1, age+2].
 */
export function ageSets(bundle: ThemeBundle, age: number): AgeSets {
  const k = age + 1; // 1-based band to match the prototype
  const dealBands = new Set<number>([k - 1, k]);
  const useBands = new Set<number>([k - 1, k, k + 1]);
  const recipes = bundle.recipes.filter((r) => dealBands.has(r.band));
  const useRecipes = bundle.recipes.filter((r) => useBands.has(r.band));
  const ING = new Set<string>(recipes.flatMap((r) => r.all));
  const BASE = [...ING].filter((x) => !bundle.outputs.has(x));
  const MID = [...ING].filter((x) => bundle.outputs.has(x));
  const USE = new Set<string>(useRecipes.flatMap((r) => r.all));
  const NEXT = bundle.recipes.filter((r) => r.band === k + 1);
  return { age, recipes, ING, BASE, MID, USE, NEXT };
}

/** Catalogue every output in the theme, grouped by age (1-based bands,
 *  stored as 0-based index arrays). Within an age, items appear in recipe
 *  order and are deduplicated. Returns the groups plus the catalogue number
 *  for each output (No. 001 is the first thing you could ever make). */
export function catalogue(bundle: ThemeBundle): {
  byAge: string[][];
  no: Map<string, number>;
} {
  const numAges = bundle.theme.ages.length;
  const byAge: string[][] = Array.from({ length: numAges }, () => []);
  const seen = new Set<string>();
  const ordered = [...bundle.recipes].sort((a, b) => a.band - b.band);
  for (const r of ordered) {
    if (seen.has(r.out)) continue;
    seen.add(r.out);
    byAge[r.band - 1].push(r.out);
  }
  const no = new Map<string, number>();
  let n = 0;
  for (const list of byAge) for (const id of list) no.set(id, ++n);
  return { byAge, no };
}

/** Catalogue every item playable in the theme — outputs *and* base
 *  ingredients — grouped by `kind`. Base ingredients count because the
 *  player encounters them in the tray; collecting them tracks "used in a
 *  combo" rather than "crafted from a recipe". Buckets are stable across KB
 *  edits so the collection view doesn't shift when ages shift; players' own
 *  time-of-find story comes from `firstFoundAt`.
 *
 *  Kinds are sorted by their canonical "first appearance" ordering (base
 *  ingredients get band 0 since they're available immediately), so the
 *  layout still reads roughly earliest-first. Items within a kind are
 *  alpha-sorted for predictability. */
export function catalogueByKind(bundle: ThemeBundle): {
  kinds: { kind: string; items: string[] }[];
} {
  const byKind = new Map<string, string[]>();
  const kindBand = new Map<string, number>();
  const addId = (id: string, band: number) => {
    const it = bundle.items.get(id);
    if (!it) return;
    const k = it.kind || "other";
    let list = byKind.get(k);
    if (!list) {
      list = [];
      byKind.set(k, list);
    }
    list.push(id);
    const cur = kindBand.get(k);
    if (cur == null || band < cur) kindBand.set(k, band);
  };
  for (const id of bundle.outputs) {
    addId(id, bundle.outBand.get(id) ?? 99);
  }
  for (const id of bundle.base) {
    // Base ingredients land at band 0 so pure-ingredient kinds (e.g.
    // Element) sort to the top of the collection.
    addId(id, 0);
  }
  const kinds = [...byKind.entries()]
    .map(([kind, items]) => ({
      kind,
      items: items.sort((a, b) => {
        const na = bundle.items.get(a)?.name ?? a;
        const nb = bundle.items.get(b)?.name ?? b;
        return na.localeCompare(nb);
      }),
    }))
    .sort((a, b) => {
      const ba = kindBand.get(a.kind) ?? 99;
      const bb = kindBand.get(b.kind) ?? 99;
      if (ba !== bb) return ba - bb;
      return a.kind.localeCompare(b.kind);
    });
  return { kinds };
}

export function buildAllBundles(
  snapshot: Snapshot,
  prevNumAges: Partial<Record<ThemeKey, number>> = {},
): Record<ThemeKey, ThemeBundle> {
  return {
    everything: buildThemeBundle(
      snapshot,
      "everything",
      prevNumAges.everything ?? 0,
    ),
  };
}

/** Build the per-theme daily bundles. A theme without a `dailyConfig` just
 *  gets its endless bundle back (the daily plays the full-run shape). A
 *  theme with a config gets a bundle with capped ages, filtered recipes,
 *  optional ageNeedScale, and (if `guestRecipes` is supplied) today's
 *  guest items spliced in as current-age recipes.
 *
 *  Both `dailyConfigs` and `guestRecipes` are injected rather than loaded
 *  here so callers in server components stay cacheable and tests can
 *  supply synthetic values. */
export function buildAllDailyBundles(
  snapshot: Snapshot,
  prevNumAges: Partial<Record<ThemeKey, number>> = {},
  dailyConfigs: Partial<Record<ThemeKey, DailyConfig | null>> = {},
  guestRecipes: Partial<Record<ThemeKey, GuestRecipeExtension[] | null>> = {},
): Record<ThemeKey, ThemeBundle> {
  return {
    everything: buildThemeBundle(
      snapshot,
      "everything",
      prevNumAges.everything ?? 0,
      "classic",
      dailyConfigs.everything ?? null,
      guestRecipes.everything ?? null,
    ),
  };
}

/** Build fast-mode bundles for every theme. Fast mode shares the endless
 *  collection scope, but projects a different recipe set (2-part only, single
 *  band) so the board stays combinable without the age-progression tax. */
export function buildAllFastBundles(
  snapshot: Snapshot,
): Record<ThemeKey, ThemeBundle> {
  return {
    everything: buildThemeBundle(snapshot, "everything", 0, "fast"),
  };
}
