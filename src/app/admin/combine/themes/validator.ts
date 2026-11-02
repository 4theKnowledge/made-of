/**
 * Reachability validator for a Combine theme.
 *
 * An item is "buildable in the theme" if it has at least one recipe (f/w)
 * whose ingredients are all either:
 *   (a) in the theme and themselves buildable, or
 *   (b) base ingredients (items in the theme with no recipe at all).
 *
 * We also report two softer problems:
 *   - "orphan" — an item in the theme that nothing in the theme uses and
 *     which itself has no recipe. It can be dealt but doesn't participate.
 *     (Not an error; just a warning.)
 *   - "excluded" — an item in the theme that's also tagged combine-exclude.
 *     That's a contradiction; the game would skip it.
 *
 * The validator runs over plain row-shaped input so it's trivially testable
 * without hitting the DB.
 */

export interface ValidatorItem {
  id: string;
  name: string;
  tags: string[];
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

  // Recipes grouped by owner.
  const recipesByItem = new Map<string, ValidatorRecipe[]>();
  for (const r of input.recipes) {
    const list = recipesByItem.get(r.itemId) ?? [];
    list.push(r);
    recipesByItem.set(r.itemId, list);
  }

  // Which items get used as a part by some recipe owned by a theme member?
  const usedInTheme = new Set<string>();
  for (const r of input.recipes) {
    if (!input.themeMembers.has(r.itemId)) continue;
    for (const p of r.parts) usedInTheme.add(p);
  }

  // Seed: theme members that have no recipe at all are "base" (dealt
  // directly by the game).
  const buildable = new Set<string>();
  const broken: BrokenItem[] = [];

  for (const itemId of input.themeMembers) {
    const recipes = recipesByItem.get(itemId) ?? [];
    if (recipes.length === 0) buildable.add(itemId);
  }

  // Iteratively close: an item is buildable if any of its recipes has all
  // parts in buildable. Repeat until no change (bounded by member count).
  let changed = true;
  let safety = input.themeMembers.size + 1;
  while (changed && safety-- > 0) {
    changed = false;
    for (const itemId of input.themeMembers) {
      if (buildable.has(itemId)) continue;
      const recipes = recipesByItem.get(itemId) ?? [];
      for (const r of recipes) {
        if (r.parts.every((p) => buildable.has(p))) {
          buildable.add(itemId);
          changed = true;
          break;
        }
      }
    }
  }

  // Anything in theme that isn't buildable is broken. Reason: list the
  // most-complete recipe's missing deps (fewest unmet).
  for (const itemId of input.themeMembers) {
    const item = itemById.get(itemId);
    if (!item) continue;

    if (item.tags.includes("combine-exclude")) {
      broken.push({ itemId, name: item.name, reason: { kind: "excluded-and-member" } });
      continue;
    }
    if (buildable.has(itemId)) continue;

    const recipes = recipesByItem.get(itemId) ?? [];
    let bestMissing: string[] | null = null;
    for (const r of recipes) {
      const missing = r.parts.filter((p) => !buildable.has(p));
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

  // Orphans: in theme, buildable (so no error), zero incoming recipe usage,
  // and no recipe of their own. (A base ingredient that no theme recipe
  // uses — functionally decorative.)
  const warnings: ValidatorResult["warnings"] = [];
  for (const itemId of input.themeMembers) {
    const item = itemById.get(itemId);
    if (!item) continue;
    if (!buildable.has(itemId)) continue;
    const hasRecipe = (recipesByItem.get(itemId)?.length ?? 0) > 0;
    if (hasRecipe) continue;
    if (!usedInTheme.has(itemId)) {
      warnings.push({ itemId, name: item.name, kind: "orphan" });
    }
  }

  let baseCount = 0;
  for (const itemId of input.themeMembers) {
    if ((recipesByItem.get(itemId)?.length ?? 0) === 0) baseCount++;
  }

  return {
    memberCount: input.themeMembers.size,
    baseCount,
    buildableCount: buildable.size,
    broken,
    warnings,
  };
}
