/**
 * Serialise / rehydrate a ThemeBundle across the RSC boundary.
 *
 * ThemeBundle holds Map and Set instances that Next's RSC serialiser does
 * not pass through. We turn them into plain arrays on the server, then
 * reconstruct the full bundle on the client with one pass.
 */

import type {
  CombineItem,
  CombineRecipe,
  ThemeBundle,
  ThemeMeta,
} from "./types";

export interface SerialisedBundle {
  theme: ThemeMeta;
  recipes: CombineRecipe[];
  outputs: string[];
  ingredients: string[];
  base: string[];
  mid: string[];
  tools: string[];
  terminal: string[];
  items: CombineItem[];
}

export function serialiseBundle(bundle: ThemeBundle): SerialisedBundle {
  return {
    theme: bundle.theme,
    recipes: bundle.recipes,
    outputs: [...bundle.outputs],
    ingredients: [...bundle.ingredients],
    base: bundle.base,
    mid: bundle.mid,
    tools: [...bundle.tools],
    terminal: [...bundle.terminal],
    items: [...bundle.items.values()],
  };
}

export function hydrateBundle(s: SerialisedBundle): ThemeBundle {
  const byIngredient = new Map<string, CombineRecipe[]>();
  for (const r of s.recipes) {
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
  const sameIngredients = new Map<string, CombineRecipe[]>();
  for (const r of s.recipes) {
    const k = [...r.all].sort().join("+");
    let list = sameIngredients.get(k);
    if (!list) {
      list = [];
      sameIngredients.set(k, list);
    }
    if (!list.some((q) => q.out === r.out)) list.push(r);
  }
  const items = new Map<string, CombineItem>();
  for (const it of s.items) items.set(it.id, it);
  const outBand = new Map<string, number>();
  for (const r of s.recipes) {
    const cur = outBand.get(r.out);
    if (cur == null || r.band < cur) outBand.set(r.out, r.band);
  }
  return {
    theme: s.theme,
    recipes: s.recipes,
    byIngredient,
    outputs: new Set(s.outputs),
    ingredients: new Set(s.ingredients),
    base: s.base,
    mid: s.mid,
    tools: new Set(s.tools),
    terminal: new Set(s.terminal),
    sameIngredients,
    items,
    outBand,
  };
}
