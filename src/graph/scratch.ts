/**
 * Scratch-mode game logic. Pure functions over the snapshot plus a client-
 * supplied `have` set (what the player has made so far).
 *
 * Server-authoritative: the client sends `have` on every request, the server
 * replies with ready items / win / hint / par. No bulk graph ever leaves the
 * server.
 *
 * All logic ported from legacy/made-of.html's From Scratch block (lines
 * 2117-2420). We keep names close to the prototype: `recipesOf`, `reqs`,
 * `canMakeNow`, `costs`, `bestRecipe`, `missing`.
 */

import type { ItemKind, Tier } from "@/db/schema";
import type { Snapshot } from "./snapshot";
import type { GraphEdge, GraphNode } from "./types";

const ORIGIN = "big-bang";

/** A recipe view suitable for both client UI and server math. */
export interface ScratchRecipe {
  id: string;
  label: string | null;
  position: number;
  /** Required inputs (unique, in `reqs()` order: e + f + w + r.n + item.n). */
  requires: string[];
}

/** Normalise an item's recipes. An item with no recipes still gets one empty default. */
export function recipesOf(node: GraphNode): ScratchRecipe[] {
  if (node.recipes.length === 0) {
    // The prototype treats recipeless items as having one empty recipe.
    return [
      { id: `${node.id}:r0`, label: null, position: 0, requires: [] },
    ];
  }
  // Collect requirements per recipe + item-level `n` edges.
  const itemLevelN = node.up
    .filter((e) => e.recipeId === null && e.type === "n")
    .map((e) => e.id);

  return node.recipes.map((r) => {
    const edges = node.up.filter((e) => e.recipeId === r.id);
    const requires = pickReqs(edges, itemLevelN);
    return { ...r, requires };
  });
}

function pickReqs(edges: GraphEdge[], itemLevelN: string[]): string[] {
  // Prototype order: e, f, w, r.n, item.n — then uniq.
  const by = (t: GraphEdge["type"]) =>
    edges.filter((e) => e.type === t).map((e) => e.id);
  const combined = [
    ...by("e"),
    ...by("f"),
    ...by("w"),
    ...by("n"),
    ...itemLevelN,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of combined) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** All requirements for one recipe of an item (prototype's `reqs`). */
export function reqs(node: GraphNode, recipe: ScratchRecipe): string[] {
  return recipe.requires;
  // kept as a function for API parity with the prototype
  void node;
}

/** True if the item has any recipe with at least one requirement. */
export function hasAnyReq(node: GraphNode): boolean {
  return recipesOf(node).some((r) => r.requires.length > 0);
}

/** Can the player make this item right now, given what they have? */
export function canMakeNow(node: GraphNode, have: Set<string>): boolean {
  if (have.has(node.id)) return false;
  if (!hasAnyReq(node)) return false;
  return recipesOf(node).some((r) => r.requires.every((x) => have.has(x)));
}

/** All items the player can make right now. */
export function ready(
  snapshot: Snapshot,
  have: Set<string>,
): GraphNode[] {
  const out: GraphNode[] = [];
  for (const n of snapshot.nodes.values()) {
    if (canMakeNow(n, have)) out.push(n);
  }
  return out;
}

/**
 * Shortest-path cost in "steps to make" terms. Items in `have` cost 0; others
 * cost 1 + sum of best-recipe inputs. Mirrors the prototype's `costs` with
 * the same 100-iteration cap.
 */
export function costs(
  snapshot: Snapshot,
  have: Set<string>,
): Map<string, number> {
  const c = new Map<string, number>();
  for (const n of snapshot.nodes.values()) {
    c.set(n.id, have.has(n.id) ? 0 : Infinity);
  }
  for (let k = 0; k < 100; k++) {
    let changed = false;
    for (const n of snapshot.nodes.values()) {
      if (have.has(n.id) || !hasAnyReq(n)) continue;
      let best = Infinity;
      for (const r of recipesOf(n)) {
        let s = 1;
        for (const x of r.requires) s += c.get(x) ?? Infinity;
        if (s < best) best = s;
      }
      if (best < (c.get(n.id) ?? Infinity)) {
        c.set(n.id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return c;
}

/** Best-recipe index for an item, given current costs. */
export function bestRecipe(
  node: GraphNode,
  c: Map<string, number>,
): number {
  let bi = 0;
  let bv = Infinity;
  const recipes = recipesOf(node);
  recipes.forEach((r, i) => {
    let s = 0;
    for (const x of r.requires) s += c.get(x) ?? Infinity;
    if (s < bv) {
      bv = s;
      bi = i;
    }
  });
  return bi;
}

/** All items still needed to make `target`, following best recipes. */
export function missing(
  snapshot: Snapshot,
  target: string,
  have: Set<string>,
  c: Map<string, number>,
): Set<string> {
  const set = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const id = stack.pop()!;
    if (have.has(id) || set.has(id)) continue;
    set.add(id);
    const node = snapshot.nodes.get(id);
    if (!node) continue;
    const recipes = recipesOf(node);
    const r = recipes[bestRecipe(node, c)];
    if (r) r.requires.forEach((x) => stack.push(x));
  }
  // Prototype keeps the target itself in the set — it's a step the player
  // still has to take.
  return set;
}

/** Par (minimum steps) for making `target` from scratch (big bang only). */
export function parFor(snapshot: Snapshot, target: string): number {
  const have = new Set<string>([ORIGIN]);
  const c = costs(snapshot, have);
  return missing(snapshot, target, have, c).size;
}

/** The initial `have` set for a new run. */
export function initialHave(): Set<string> {
  return new Set<string>([ORIGIN]);
}

/**
 * Difficulty tier of a target (used by the picker). Approximates the
 * prototype's `levelOf` which thresholds par.
 */
export type Difficulty = "easy" | "medium" | "hard" | "extra";
export function difficultyOf(
  snapshot: Snapshot,
  target: string,
): Difficulty {
  // Thresholds tuned to the current content: the shortest path from the big
  // bang to anything buildable is 5 (water, graphite). We size the buckets
  // so each has a healthy supply of targets.
  const p = parFor(snapshot, target);
  if (p <= 6) return "easy";
  if (p <= 10) return "medium";
  if (p <= 16) return "hard";
  return "extra";
}

/**
 * Serialise a node + its recipes for the client. Used by /api/scratch/state
 * for the Target card.
 */
export interface ScratchItemView {
  slug: string;
  code: string;
  name: string;
  tier: Tier;
  kind: ItemKind;
  symbol: string | null;
  fact: string;
  firstAppeared: string | null;
}

export function viewOf(
  node: GraphNode,
  code: string,
): ScratchItemView {
  return {
    slug: node.id,
    code,
    name: node.name,
    tier: node.tier,
    kind: node.kind,
    symbol: node.symbol,
    fact: node.fact,
    firstAppeared: node.firstAppeared,
  };
}
