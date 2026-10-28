/**
 * In-memory graph snapshot.
 *
 * Built once at server boot from the loaded parser rows (or directly from
 * Postgres in later phases). Pathfinding and "everything it takes" run
 * against the snapshot, never SQL.
 *
 * Mirrors the artifact's graph helpers (ancestors, bfsU, connect) so the
 * ported UI stays byte-identical in behaviour.
 */

import type { Confidence, LinkType } from "../db/schema";
import type { LoadedRows } from "../parser/load";
import type { GraphEdge, GraphNode, PathStep } from "./types";

export interface Snapshot {
  nodes: Map<string, GraphNode>;
  /** Convenience lookup by original artifact name (e.g. "big bang"). */
  byName: Map<string, GraphNode>;
}

export function buildSnapshot(rows: LoadedRows): Snapshot {
  const nodes = new Map<string, GraphNode>();
  const byName = new Map<string, GraphNode>();

  for (const it of rows.items) {
    const node: GraphNode = {
      id: it.id,
      name: it.name,
      tier: it.tier,
      recipes: [],
      up: [],
      down: [],
      neighbours: [],
    };
    nodes.set(it.id, node);
    byName.set(it.name, node);
  }

  for (const r of rows.recipes) {
    const n = nodes.get(r.itemId);
    if (!n) continue;
    n.recipes.push({
      id: r.id,
      label: r.label ?? null,
      position: r.position ?? 0,
    });
  }
  for (const n of nodes.values()) n.recipes.sort((a, b) => a.position - b.position);

  for (const l of rows.links) {
    const srcId = l.recipeId
      ? recipeOwner(rows, l.recipeId)
      : l.itemId!;
    const src = srcId ? nodes.get(srcId) : null;
    const dst = nodes.get(l.targetItemId);
    if (!src || !dst) continue;
    const edgeUp: GraphEdge = {
      id: dst.id,
      type: l.type as LinkType,
      confidence: (l.confidence ?? "established") as Confidence,
      recipeId: l.recipeId ?? null,
    };
    const edgeDown: GraphEdge = {
      id: src.id,
      type: l.type as LinkType,
      confidence: (l.confidence ?? "established") as Confidence,
      recipeId: l.recipeId ?? null,
    };
    src.up.push(edgeUp);
    dst.down.push(edgeDown);
  }

  for (const n of nodes.values()) {
    const nbSet = new Set<string>();
    for (const e of n.up) nbSet.add(e.id);
    for (const e of n.down) nbSet.add(e.id);
    n.neighbours = [...nbSet];
  }

  return { nodes, byName };
}

const recipeToItem = new WeakMap<LoadedRows, Map<string, string>>();
function recipeOwner(rows: LoadedRows, recipeId: string): string | null {
  let map = recipeToItem.get(rows);
  if (!map) {
    map = new Map(rows.recipes.map((r) => [r.id, r.itemId]));
    recipeToItem.set(rows, map);
  }
  return map.get(recipeId) ?? null;
}

/* ========================================================================
 * Graph queries.
 * ====================================================================== */

/**
 * All ancestors of an item (what it is ultimately made from, following `up`
 * edges). Mirrors `ancestors` in the artifact.
 */
export function ancestors(snapshot: Snapshot, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const x = stack.pop()!;
    const node = snapshot.nodes.get(x);
    if (!node) continue;
    for (const e of node.up) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        stack.push(e.id);
      }
    }
  }
  seen.delete(id);
  return seen;
}

/**
 * Shortest undirected path between two items (traversing both up and down
 * edges). Mirrors `connect` in the artifact — the daily game walks the graph
 * in either direction. Returns the step list including both endpoints, or
 * null if unreachable.
 *
 * `closed` lets the caller forbid certain items (used by the daily puzzle
 * generator to close the busiest hubs; see artifact CLOSED set).
 */
export function shortestPath(
  snapshot: Snapshot,
  from: string,
  to: string,
  closed?: Set<string>,
): PathStep[] | null {
  if (from === to) return [{ id: from, edge: null }];
  if (!snapshot.nodes.has(from) || !snapshot.nodes.has(to)) return null;

  interface Prev {
    id: string;
    type: LinkType;
    dir: "up" | "down";
  }
  const prev = new Map<string, Prev | null>([[from, null]]);
  const q: string[] = [from];
  while (q.length) {
    const x = q.shift()!;
    if (x === to) break;
    const node = snapshot.nodes.get(x)!;
    for (const e of node.down) {
      if (prev.has(e.id) || closed?.has(e.id)) continue;
      prev.set(e.id, { id: x, type: e.type, dir: "down" });
      q.push(e.id);
    }
    for (const e of node.up) {
      if (prev.has(e.id) || closed?.has(e.id)) continue;
      prev.set(e.id, { id: x, type: e.type, dir: "up" });
      q.push(e.id);
    }
  }
  if (!prev.has(to)) return null;

  const steps: PathStep[] = [];
  let cursor = to;
  while (cursor !== from) {
    const p = prev.get(cursor)!;
    steps.unshift({
      id: cursor,
      edge: { type: p.type, direction: p.dir },
    });
    cursor = p.id;
  }
  steps.unshift({ id: from, edge: null });
  return steps;
}

/**
 * Shortest-path length (BFS), identical to `bfsU` in the artifact. Returns a
 * map of id -> hop distance from the source. Treats the graph as undirected.
 */
export function distancesFrom(
  snapshot: Snapshot,
  from: string,
  closed?: Set<string>,
): Map<string, number> {
  const d = new Map<string, number>([[from, 0]]);
  if (!snapshot.nodes.has(from)) return d;
  const q: string[] = [from];
  while (q.length) {
    const x = q.shift()!;
    const node = snapshot.nodes.get(x)!;
    for (const nbId of node.neighbours) {
      if (d.has(nbId) || closed?.has(nbId)) continue;
      d.set(nbId, d.get(x)! + 1);
      q.push(nbId);
    }
  }
  return d;
}

/**
 * Full "everything it takes" set: every ancestor and every ancestor's
 * recipe-level dependencies. For now this is equivalent to `ancestors`,
 * since recipe-level links are already walked by the up edges. Kept as a
 * separate function because the API will later apply the paid-tier filter.
 */
export function everything(
  snapshot: Snapshot,
  id: string,
): { items: string[] } {
  const ids = ancestors(snapshot, id);
  return { items: [...ids] };
}

/**
 * Switch recipe: given an item id and a recipe id, return the subset of
 * neighbour ids that are reached via that recipe plus the item-level links.
 * This mirrors the artifact's recipe switcher: the bowtie view shows only
 * the links that belong to the selected recipe (plus always-required item
 * links).
 */
export function recipeNeighbourhood(
  snapshot: Snapshot,
  id: string,
  recipeId: string,
): { up: GraphEdge[]; down: GraphEdge[] } {
  const node = snapshot.nodes.get(id);
  if (!node) return { up: [], down: [] };
  const up = node.up.filter(
    (e) => e.recipeId === recipeId || e.recipeId === null,
  );
  // "down" is not partitioned by recipe (consumers reference *us*), so return
  // all of them. The UI typically shows down links regardless of selection.
  return { up, down: node.down };
}
