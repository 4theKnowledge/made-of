/**
 * Build Combine's per-theme recipe bundle from the live graph snapshot.
 *
 * One projection pass that mirrors `cbRecipesFor` + `cbUseTheme` in
 * legacy/made-of.html lines 3216–3261. Membership is tag-driven: no
 * hard-coded name lists.
 */

import type { Snapshot } from "../graph/snapshot";
import type { GraphNode } from "../graph/types";
import { THEMES, isCombineExcluded, isEveryday } from "./filters";
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
    if (isCombineExcluded(node)) continue;
    if (theme === "everyday") {
      if (!isEveryday(node)) continue;
      if (node.kind === "living") continue;
    }
    for (const recipe of node.recipes) {
      const { from, with_, all } = recipeParts(node, recipe.id);
      if (all.length < 2 || all.length > 7) continue;
      if (all.some((partId) => partId === node.id)) continue;

      const partNodes = all
        .map((id) => snapshot.nodes.get(id))
        .filter((n): n is GraphNode => Boolean(n));
      if (partNodes.length < all.length) continue;
      if (partNodes.some((p) => isCombineExcluded(p))) continue;

      if (theme === "everyday") {
        // Everyday recipes allow natural raw stuff and tools even when they
        // aren't tagged into the everyday universe.
        const ok = partNodes.every(
          (p) => isEveryday(p) || p.tier === "N" || p.kind === "tool",
        );
        if (!ok) continue;
      }

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

/** Assign refinement levels inside the theme, cut into ages, then push
 *  outputs forward so no recipe needs a later-age part. Mirrors cbUseTheme
 *  lines 3246–3260. */
function assignAges(
  snapshot: Snapshot,
  recipes: CombineRecipe[],
  outputs: Set<string>,
  numAges: number,
): void {
  const refine = computeRefine(snapshot);

  // Theme outputs start at infinity; ingredients the theme doesn't make
  // carry their knowledge-base refine value (so e.g. glass and copper wire
  // land at a sensible age even in Everyday).
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

  // Cut sorted levels into equal-ish bands.
  const levels = recipes.map((r) => r.lvl).sort((a, b) => a - b);
  const cuts: number[] = [];
  for (let b = 1; b < numAges; b++) {
    cuts.push(levels[Math.floor((levels.length * b) / numAges)]);
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
  return {
    id: node.id,
    name: node.name,
    tier: node.tier,
    symbol: node.symbol,
    fact: node.fact,
    kind: node.kind,
  };
}

export function buildThemeBundle(
  snapshot: Snapshot,
  theme: ThemeKey,
): ThemeBundle {
  const meta = THEMES[theme];
  const recipes = recipesForTheme(snapshot, theme);

  const outputs = new Set<string>(recipes.map((r) => r.out));
  const ingredients = new Set<string>(recipes.flatMap((r) => r.all));
  const tools = new Set<string>(recipes.flatMap((r) => r.with));
  const base = [...ingredients].filter((x) => !outputs.has(x));
  const mid = [...ingredients].filter((x) => outputs.has(x));
  const terminal = new Set<string>(
    [...outputs].filter((x) => !ingredients.has(x)),
  );

  assignAges(snapshot, recipes, outputs, meta.ages.length);

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
  const touched = new Set<string>([...outputs, ...ingredients]);
  for (const id of touched) {
    const node = snapshot.nodes.get(id);
    if (node) items.set(id, makeItemView(node));
  }

  return {
    theme: meta,
    recipes,
    byIngredient,
    outputs,
    ingredients,
    base,
    mid,
    tools,
    terminal,
    sameIngredients,
    items,
  };
}

/**
 * The slice of a theme "in play" at a given age (0-based index).
 *
 * The dealer picks only from tiles whose recipes live in bands [age, age+1]
 * (1-based). Crumbling clears tiles that aren't useful across bands
 * [age, age+1, age+2].
 *
 * Mirrors `cbAgeSets` in legacy/made-of.html line 3290.
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

export function buildAllBundles(
  snapshot: Snapshot,
): Record<ThemeKey, ThemeBundle> {
  return {
    everyday: buildThemeBundle(snapshot, "everyday"),
    everything: buildThemeBundle(snapshot, "everything"),
  };
}
