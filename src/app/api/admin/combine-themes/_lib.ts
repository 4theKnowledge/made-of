/**
 * Shared loaders for the combine-themes admin API.
 *
 * The members and preview-closure endpoints both need the full graph (items
 * + playable recipes, parts filtered to combinable types + playable-recipe
 * rule) to compute closures. Keep it in one place so the two can't drift.
 */

import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { collectRecipeParts, isPlayableRecipe, type RecipePartType } from "@/combine/parts";
import type { ClosureItem, ClosureRecipe } from "@/combine/closure";

export interface GraphForClosure {
  items: ClosureItem[];
  recipes: ClosureRecipe[];
}

/** One trip per call — fine at current graph size (~350 items, ~500
 *  recipes). Caller passes it to computeClosure. */
export async function loadGraphForClosure(): Promise<GraphForClosure> {
  const db = getDb();

  const items = await db
    .select({
      id: schema.items.id,
      tier: schema.items.tier,
      kind: schema.items.kind,
      tags: schema.items.tags,
      isCombineExcluded: schema.items.isCombineExcluded,
    })
    .from(schema.items);

  const recipes = await db
    .select({ id: schema.recipes.id, itemId: schema.recipes.itemId })
    .from(schema.recipes);

  const recipeIds = recipes.map((r) => r.id);
  const links = recipeIds.length
    ? await db
        .select({
          recipeId: schema.links.recipeId,
          targetItemId: schema.links.targetItemId,
          type: schema.links.type,
        })
        .from(schema.links)
        .where(inArray(schema.links.recipeId, recipeIds))
    : [];

  // Group raw edges by recipe, preserving type-alignment with parts so the
  // closure can honour followLinkTypes.
  const edgesByRecipe = new Map<string, { type: string; targetId: string }[]>();
  for (const l of links) {
    if (!l.recipeId) continue;
    const list = edgesByRecipe.get(l.recipeId) ?? [];
    list.push({ type: l.type, targetId: l.targetItemId });
    edgesByRecipe.set(l.recipeId, list);
  }

  const playable: ClosureRecipe[] = [];
  for (const r of recipes) {
    const edges = edgesByRecipe.get(r.id) ?? [];
    const { all, hadSelfRef } = collectRecipeParts(edges, r.itemId);
    if (!isPlayableRecipe({ all, hadSelfRef })) continue;

    // Re-derive partTypes aligned with `all`. collectRecipeParts dedups,
    // so pick the first-seen type for each part id.
    const typeByPart = new Map<string, RecipePartType>();
    for (const e of edges) {
      if (e.targetId === r.itemId) continue;
      if (e.type !== "f" && e.type !== "w" && e.type !== "n" && e.type !== "e") continue;
      if (!typeByPart.has(e.targetId)) typeByPart.set(e.targetId, e.type as RecipePartType);
    }

    playable.push({
      id: r.id,
      itemId: r.itemId,
      parts: all,
      partTypes: all.map((id) => typeByPart.get(id) ?? "f"),
    });
  }

  return {
    items: items.map((i) => ({
      id: i.id,
      tier: i.tier,
      kind: i.kind,
      tags: i.tags ?? [],
      isCombineExcluded: i.isCombineExcluded,
    })),
    recipes: playable,
  };
}
