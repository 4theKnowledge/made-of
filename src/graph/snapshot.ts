/**
 * In-memory graph snapshot.
 *
 * Built once at server boot from the seed rows (or directly from Postgres
 * in later phases). Pathfinding and "everything it takes" run against the
 * snapshot, never SQL.
 *
 * Mirrors the artifact's graph helpers (ancestors, bfsU, connect) so the
 * ported UI stays byte-identical in behaviour.
 */

import type { Confidence, LinkType } from "../db/schema";
import type { SeedRows } from "../data/rows";
import type { GraphEdge, GraphNode, PathStep } from "./types";

export interface Snapshot {
  /** Keyed by item uuid. */
  nodes: Map<string, GraphNode>;
  /** Convenience lookup by original artifact name (e.g. "big bang"). */
  byName: Map<string, GraphNode>;
  /** Convenience lookup by URL slug (e.g. "big-bang"). */
  bySlug: Map<string, GraphNode>;
  /** Per-theme DB-backed metadata. `combineThemes.code` → current
   *  `collection_version` (plus label/description for callers that need
   *  them). Only populated when the snapshot is built from the DB;
   *  empty when built from the KB file so Combine tests still work
   *  without DB access. */
  themeMeta?: Map<string, { code: string; label: string; description: string | null; collectionVersion: number }>;
}

export function buildSnapshot(rows: SeedRows): Snapshot {
  const nodes = new Map<string, GraphNode>();
  const byName = new Map<string, GraphNode>();
  const bySlug = new Map<string, GraphNode>();

  for (const it of rows.items) {
    const node: GraphNode = {
      id: it.id!,
      slug: it.slug,
      name: it.name,
      tier: it.tier,
      kind: it.kind,
      firstAppeared: it.firstAppeared ?? null,
      firstAppearedYa: it.firstAppearedYa ?? null,
      symbol: it.symbol ?? null,
      fact: it.fact ?? "",
      pictogram: (it as { pictogram?: string | null }).pictogram ?? null,
      recipes: [],
      // `tags` is `text[]` in Postgres which Drizzle infers as `string[]`;
      // the type is narrower (Tag[]) in our data module, so we cast here.
      // Values are validated at parse time by the DataItem type.
      tags: (it.tags ?? []) as GraphNode["tags"],
      // When loading from Postgres, this comes from the item_combine_themes
      // join. When building rows from the KB file (seed + tests), the map
      // isn't populated — fall back to inferring 'everything' membership
      // for every non-excluded item so the pre-migration behaviour holds
      // and the Combine tests don't need DB access.
      combineThemes: rows.combineThemesByItem
        ? rows.combineThemesByItem.get(it.id!) ?? []
        : (it as { isCombineExcluded?: boolean }).isCombineExcluded
          ? []
          : ["everything"],
      isCanary: it.isCanary ?? false,
      isCombineExcluded:
        (it as { isCombineExcluded?: boolean }).isCombineExcluded ?? false,
      up: [],
      down: [],
      neighbours: [],
    };
    nodes.set(node.id, node);
    byName.set(it.name, node);
    bySlug.set(it.slug, node);
  }

  for (const r of rows.recipes) {
    const n = nodes.get(r.itemId);
    if (!n || !r.id) continue;
    n.recipes.push({
      id: r.id,
      label: r.label ?? null,
      position: r.position ?? 0,
    });
  }
  for (const n of nodes.values()) n.recipes.sort((a, b) => a.position - b.position);

  // Build raw edge lists first, then dedupe below so we can pick the best
  // representative when the same (type, source, target) appears in several
  // of the source's recipes.
  for (const l of rows.links) {
    if (!l.id) continue;
    const srcId = l.recipeId
      ? recipeOwner(rows, l.recipeId)
      : l.itemId ?? null;
    const src = srcId ? nodes.get(srcId) : null;
    const dst = nodes.get(l.targetItemId);
    if (!src || !dst) continue;
    const common = {
      type: l.type as LinkType,
      confidence: (l.confidence ?? "established") as Confidence,
      recipeId: l.recipeId ?? null,
      linkId: l.id,
      hasEvidence: (l as { hasEvidence?: boolean }).hasEvidence ?? false,
      isCanary: l.isCanary ?? false,
    };
    const edgeUp: GraphEdge = { id: dst.id, ...common };
    const edgeDown: GraphEdge = { id: src.id, ...common };
    src.up.push(edgeUp);
    dst.down.push(edgeDown);
  }

  // Dedupe up edges within each (recipeId, type, target) tuple. A single
  // recipe listing `f:X` twice should still produce one chip.
  for (const n of nodes.values()) {
    n.up = pickBestPerKey(n.up, (e) => `${e.recipeId ?? "~"}|${e.type}|${e.id}`);
  }

  // Dedupe down edges by (type, source). From a target's point of view, the
  // same source hitting it in two of its recipes is still "source goes into
  // target" — one chip is right. The prototype does this at graph-build time
  // via a per-item `seen` set.
  for (const n of nodes.values()) {
    n.down = pickBestPerKey(n.down, (e) => `${e.type}|${e.id}`);
  }

  for (const n of nodes.values()) {
    const nbSet = new Set<string>();
    for (const e of n.up) nbSet.add(e.id);
    for (const e of n.down) nbSet.add(e.id);
    n.neighbours = [...nbSet];
  }

  return { nodes, byName, bySlug, themeMeta: rows.themeMeta };
}

/**
 * Keep one edge per key, preferring edges with evidence (so the dot still
 * renders) and stronger confidence. The relative order of the surviving
 * edges is otherwise preserved.
 */
function pickBestPerKey<T extends { hasEvidence: boolean; confidence: Confidence }>(
  edges: T[],
  keyFn: (e: T) => string,
): T[] {
  const confRank: Record<Confidence, number> = {
    established: 4,
    strong: 3,
    debated: 2,
    hypothesis: 1,
  };
  const order: string[] = [];
  const best = new Map<string, T>();
  for (const e of edges) {
    const k = keyFn(e);
    const cur = best.get(k);
    if (!cur) {
      best.set(k, e);
      order.push(k);
      continue;
    }
    const better =
      (e.hasEvidence && !cur.hasEvidence) ||
      (e.hasEvidence === cur.hasEvidence &&
        confRank[e.confidence] > confRank[cur.confidence]);
    if (better) best.set(k, e);
  }
  return order.map((k) => best.get(k)!);
}

const recipeToItem = new WeakMap<SeedRows, Map<string, string>>();
function recipeOwner(rows: SeedRows, recipeId: string): string | null {
  let map = recipeToItem.get(rows);
  if (!map) {
    map = new Map(
      rows.recipes
        .filter((r): r is typeof r & { id: string } => Boolean(r.id))
        .map((r) => [r.id, r.itemId]),
    );
    recipeToItem.set(rows, map);
  }
  return map.get(recipeId) ?? null;
}

/* ========================================================================
 * Graph queries.
 * ====================================================================== */

/**
 * Ancestors of an item within `depth` BFS hops along `up` edges. Returns the
 * set of visited ids excluding `id` itself. Mirrors `upstreamWithin` in the
 * artifact (used by the pricing page's difficulty-levels visualisation).
 */
export function upstreamWithin(
  snapshot: Snapshot,
  id: string,
  depth: number,
): Set<string> {
  const seen = new Set<string>([id]);
  let frontier: string[] = [id];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const x of frontier) {
      const node = snapshot.nodes.get(x);
      if (!node) continue;
      for (const e of node.up) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          next.push(e.id);
        }
      }
    }
    frontier = next;
  }
  seen.delete(id);
  return seen;
}

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
