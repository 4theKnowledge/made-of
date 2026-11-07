/**
 * Reachability validator for a Combine theme.
 *
 * Mirrors Combine's runtime (src/combine/data.ts): a theme's recipes are
 * only those whose parts are all in-theme (drop-wise). "Base" ingredients
 * are items that appear as a part of at least one surviving recipe but are
 * never produced by one — those get dealt directly by the game. An item is
 * "buildable" if it's a base OR if some playable recipe exists where every
 * part is already buildable (iteratively closed).
 *
 * A member that is neither buildable nor appears as a part of any theme
 * recipe is reported as broken: the game would silently skip it.
 *
 * Softer problems:
 *   - "orphan" — a dealable base ingredient (has recipes but none are
 *     in-theme) that also isn't used by any theme recipe. Dealable but
 *     decorative. Not an error.
 *   - "excluded" — an item in the theme that's also flagged
 *     isCombineExcluded. The game would skip it.
 *
 * The validator runs over plain row-shaped input so it's trivially testable
 * without hitting the DB.
 */

export interface ValidatorItem {
  id: string;
  name: string;
  isCombineExcluded: boolean;
}

export interface ValidatorRecipe {
  id: string;
  itemId: string;
  /** Union of f and w parts (tools count — the game consumes them). */
  parts: string[];
}

export interface ValidatorInput {
  items: ValidatorItem[];
  recipes: ValidatorRecipe[];
  /** Set of item ids that belong to the theme. */
  themeMembers: Set<string>;
}

export interface BrokenItem {
  itemId: string;
  name: string;
  reason:
    | { kind: "unreachable"; missingDeps: string[] }
    | { kind: "excluded-and-member" };
}

export interface ValidatorResult {
  memberCount: number;
  baseCount: number;
  buildableCount: number;
  broken: BrokenItem[];
  warnings: { itemId: string; name: string; kind: "orphan" }[];
}

export function validateTheme(input: ValidatorInput): ValidatorResult {
  const itemById = new Map<string, ValidatorItem>();
  for (const it of input.items) itemById.set(it.id, it);

  // Only playable recipes owned by a theme member whose parts are ALL in
  // the theme survive. This matches `recipesForTheme` in src/combine/data.ts.
  // Non-member recipes don't produce in-theme items — the game never fires
  // them.
  const inThemeRecipes = input.recipes.filter(
    (r) => input.themeMembers.has(r.itemId) && r.parts.every((p) => input.themeMembers.has(p)),
  );

  const recipesByItem = new Map<string, ValidatorRecipe[]>();
  for (const r of inThemeRecipes) {
    const list = recipesByItem.get(r.itemId) ?? [];
    list.push(r);
    recipesByItem.set(r.itemId, list);
  }

  // Runtime's `baseIng = ingredients - outputs` derived from surviving
  // recipes. Items dealt directly by the game.
  const outputs = new Set<string>();
  const ingredients = new Set<string>();
  for (const r of inThemeRecipes) {
    outputs.add(r.itemId);
    for (const p of r.parts) ingredients.add(p);
  }
  const dealableBase = new Set<string>();
  for (const id of ingredients) {
    if (!outputs.has(id)) dealableBase.add(id);
  }

  // Iteratively close: start from dealable base, add any member whose
  // surviving recipes have all parts already buildable.
  const buildable = new Set<string>(dealableBase);
  let changed = true;
  let safety = input.themeMembers.size + 1;
  while (changed && safety-- > 0) {
    changed = false;
    for (const itemId of input.themeMembers) {
      if (buildable.has(itemId)) continue;
      const rs = recipesByItem.get(itemId) ?? [];
      for (const r of rs) {
        if (r.parts.every((p) => buildable.has(p))) {
          buildable.add(itemId);
          changed = true;
          break;
        }
      }
    }
  }

  // Which members are actually usable by the runtime? Dealable base OR
  // producible by a surviving recipe. Anything else = broken.
  const usable = new Set<string>([...buildable]);

  // For each member not already in `usable`, pick the "closest" recipe
  // (fewest missing parts) using ALL known playable recipes (not just
  // in-theme ones) so we can tell the author what's missing.
  const allRecipesByItem = new Map<string, ValidatorRecipe[]>();
  for (const r of input.recipes) {
    const list = allRecipesByItem.get(r.itemId) ?? [];
    list.push(r);
    allRecipesByItem.set(r.itemId, list);
  }

  const broken: BrokenItem[] = [];
  for (const itemId of input.themeMembers) {
    const item = itemById.get(itemId);
    if (!item) continue;

    if (item.isCombineExcluded) {
      broken.push({ itemId, name: item.name, reason: { kind: "excluded-and-member" } });
      continue;
    }
    if (usable.has(itemId)) continue;

    const recipes = allRecipesByItem.get(itemId) ?? [];
    let bestMissing: string[] | null = null;
    for (const r of recipes) {
      const missing = r.parts.filter((p) => !input.themeMembers.has(p));
      if (!bestMissing || missing.length < bestMissing.length) bestMissing = missing;
    }
    broken.push({
      itemId,
      name: item.name,
      reason: {
        kind: "unreachable",
        missingDeps: (bestMissing ?? []).map((id) => itemById.get(id)?.name ?? id),
      },
    });
  }

  // Warnings: a dealable-base item that isn't itself referenced as an
  // ingredient by any theme recipe would still play, but we never warn on
  // those (dealable base by definition IS used as an ingredient). The
  // interesting warning case is a member that's in `buildable` but NOT in
  // `ingredients` and NOT in `outputs` — purely decorative, won't appear
  // in the bundle. That can only happen if it's in `dealableBase` (never)
  // or added by iterative close without being an ingredient of anything
  // (also impossible — iterative close only adds outputs).
  // Keep the warnings array for forward compat; empty for now.
  const warnings: ValidatorResult["warnings"] = [];

  return {
    memberCount: input.themeMembers.size,
    baseCount: dealableBase.size,
    buildableCount: usable.size,
    broken,
    warnings,
  };
}
