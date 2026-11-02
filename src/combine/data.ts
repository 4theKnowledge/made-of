/**
 * Build Combine's per-theme recipe bundle from the live graph snapshot.
 *
 * One projection pass over the graph. Membership comes from the
 * item_combine_themes join table via inCombineTheme(); no hard-coded
 * name lists.
 */

import type { Snapshot } from "../graph/snapshot";
import type { GraphNode } from "../graph/types";
import { THEMES, inCombineTheme, themeAgePool } from "./filters";
import { computeRefine } from "./levels";
import type {
  AgeSets,
  CombineItem,
  CombineRecipe,
  ThemeBundle,
  ThemeKey,
} from "./types";

/** Collect the parts for one of a node's recipes (f + w only, deduped). */
function recipeParts(
  node: GraphNode,
  recipeId: string,
): { from: string[]; with_: string[]; all: string[] } {
  const fromSet = new Set<string>();
  const withSet = new Set<string>();
  for (const e of node.up) {
    if (e.recipeId !== recipeId) continue;
    if (e.id === node.id) continue;
    if (e.type === "f") fromSet.add(e.id);
    else if (e.type === "w") withSet.add(e.id);
  }
  const all = new Set<string>([...fromSet, ...withSet]);
  return { from: [...fromSet], with_: [...withSet], all: [...all] };
}

function recipesForTheme(
  snapshot: Snapshot,
  theme: ThemeKey,
): CombineRecipe[] {
  const out: CombineRecipe[] = [];
  for (const node of snapshot.nodes.values()) {
    if (!inCombineTheme(node, theme)) continue;
    for (const recipe of node.recipes) {
      const { from, with_, all } = recipeParts(node, recipe.id);
      if (all.length < 2 || all.length > 7) continue;
      if (all.some((partId) => partId === node.id)) continue;

      const partNodes = all
        .map((id) => snapshot.nodes.get(id))
        .filter((n): n is GraphNode => Boolean(n));
      if (partNodes.length < all.length) continue;
      if (partNodes.some((p) => !inCombineTheme(p, theme))) continue;

      out.push({
        out: node.id,
        from,
        with: with_,
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

/** Assign refinement levels inside the theme, cut into ages, then push
 *  outputs forward so no recipe needs a later-age part. */
function assignAges(
  snapshot: Snapshot,
  recipes: CombineRecipe[],
  outputs: Set<string>,
  numAges: number,
): void {
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
  const cuts: number[] = [];
  let remaining = recipes.length;
  let acc = 0;
  for (let i = 0; i < uniqueLevels.length && cuts.length < numAges - 1; i++) {
    const lvl = uniqueLevels[i];
    const n = byLevel.get(lvl) ?? 0;
    acc += n;
    remaining -= n;
    const bandsLeft = numAges - cuts.length;
    const target = Math.ceil((acc + remaining) / bandsLeft);
    // Cut here unless the final bands wouldn't get at least one level each.
    const levelsLeft = uniqueLevels.length - 1 - i;
    const bandsAfterCut = bandsLeft - 1;
    if (acc >= target && levelsLeft >= bandsAfterCut) {
      cuts.push(lvl);
      acc = 0;
    }
  }
  for (const r of recipes) {
    let band = 1;
    for (const c of cuts) if (r.lvl > c) band++;
    r.band = Math.min(numAges, band);
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

export function buildThemeBundle(
  snapshot: Snapshot,
  theme: ThemeKey,
  prevNumAges: number = 0,
): ThemeBundle {
  const base_meta = THEMES[theme];
  const recipes = recipesForTheme(snapshot, theme);

  const outputs = new Set<string>(recipes.map((r) => r.out));
  const ingredients = new Set<string>(recipes.flatMap((r) => r.all));
  const tools = new Set<string>(recipes.flatMap((r) => r.with));
  const baseIng = [...ingredients].filter((x) => !outputs.has(x));
  const mid = [...ingredients].filter((x) => outputs.has(x));
  const terminal = new Set<string>(
    [...outputs].filter((x) => !ingredients.has(x)),
  );

  const pool = themeAgePool(theme);
  const rawNumAges = deriveNumAges(recipes.length, prevNumAges);
  // Never exceed the authored name pool; a KB that outgrows it needs new
  // authored names before promotion can take effect.
  const numAges = Math.min(rawNumAges, pool.length);
  const meta: typeof base_meta = {
    ...base_meta,
    ages: pool.slice(0, numAges),
  };
  assignAges(snapshot, recipes, outputs, numAges);

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

/** Catalogue every output in the theme, grouped by `kind`. Buckets are
 *  stable across KB edits so the collection view doesn't shift when ages
 *  shift; players' own time-of-find story comes from `firstFoundAt`.
 *
 *  Kinds are sorted by their canonical "first appearance" ordering (the
 *  earliest age-band in which any item of that kind can be built), so the
 *  layout still reads roughly earliest-first. Items within a kind are
 *  alpha-sorted for predictability. */
export function catalogueByKind(bundle: ThemeBundle): {
  kinds: { kind: string; items: string[] }[];
} {
  const byKind = new Map<string, string[]>();
  const kindBand = new Map<string, number>();
  for (const id of bundle.outputs) {
    const it = bundle.items.get(id);
    if (!it) continue;
    const k = it.kind || "other";
    let list = byKind.get(k);
    if (!list) {
      list = [];
      byKind.set(k, list);
    }
    list.push(id);
    const band = bundle.outBand.get(id) ?? 99;
    const cur = kindBand.get(k);
    if (cur == null || band < cur) kindBand.set(k, band);
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
