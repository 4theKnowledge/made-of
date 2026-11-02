/**
 * How refined is a thing, over the whole knowledge base.
 *
 * Natural things (tier F or N) and anything with no recipe are 0. Everything
 * else is 1 + the smallest, across its recipes, of the largest refine value
 * among that recipe's `f + w` parts. Solved by repeated relaxation: a strict
 * pass (a recipe counts only once every part is known) then a loose pass
 * that ignores unknown parts, which breaks loops (steel needs a furnace
 * that needs steel).
 *
 * Computed once per snapshot and memoised against the snapshot identity.
 */

import type { Snapshot } from "../graph/snapshot";
import type { GraphNode } from "../graph/types";

const CACHE = new WeakMap<Snapshot, Map<string, number>>();

function isRaw(node: GraphNode): boolean {
  if (node.tier === "F" || node.tier === "N") return true;
  if (!node.recipes.length) return true;
  return false;
}

/** `f + w` ids grouped by recipe id (deduped, self-excluded). */
function partsByRecipe(node: GraphNode): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of node.recipes) out.set(r.id, []);
  for (const e of node.up) {
    if (e.recipeId == null) continue;
    if (e.type !== "f" && e.type !== "w") continue;
    if (e.id === node.id) continue;
    const list = out.get(e.recipeId);
    if (list) list.push(e.id);
  }
  for (const [k, v] of out) out.set(k, [...new Set(v)]);
  return out;
}

export function computeRefine(snapshot: Snapshot): Map<string, number> {
  const cached = CACHE.get(snapshot);
  if (cached) return cached;

  const d = new Map<string, number>();
  for (const n of snapshot.nodes.values()) {
    d.set(n.id, isRaw(n) ? 0 : Number.POSITIVE_INFINITY);
  }

  const partsIndex = new Map<string, Map<string, string[]>>();
  for (const n of snapshot.nodes.values()) partsIndex.set(n.id, partsByRecipe(n));

  const evaluate = (nodeId: string, loose: boolean): number => {
    const parts = partsIndex.get(nodeId);
    if (!parts) return Number.POSITIVE_INFINITY;
    let best = Number.POSITIVE_INFINITY;
    for (const partIds of parts.values()) {
      if (partIds.length === 0) continue;
      const values = partIds
        .map((id) => d.get(id) ?? Number.POSITIVE_INFINITY)
        .filter((v) => !loose || v !== Number.POSITIVE_INFINITY);
      if (!loose && values.length < partIds.length) continue;
      const level = 1 + (values.length ? Math.max(...values) : 0);
      if (level < best) best = level;
    }
    return best;
  };

  for (const loose of [false, true]) {
    for (let k = 0; k < 80; k++) {
      let changed = false;
      for (const n of snapshot.nodes.values()) {
        if (d.get(n.id) === 0) continue;
        const v = evaluate(n.id, loose);
        if (v < (d.get(n.id) ?? Number.POSITIVE_INFINITY)) {
          d.set(n.id, v);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  // Treat items we couldn't place as raw.
  for (const [k, v] of d) if (v === Number.POSITIVE_INFINITY) d.set(k, 0);

  CACHE.set(snapshot, d);
  return d;
}

export function refineOf(snapshot: Snapshot, id: string): number {
  return computeRefine(snapshot).get(id) ?? 0;
}
