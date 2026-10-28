/**
 * Serialisation helpers: turn a snapshot node (plus its edges) into the
 * shape the API ships.
 *
 * The invariant from CLAUDE.md: a response never exposes more than one
 * item's neighbourhood. These helpers enforce that by only taking a single
 * node id and never traversing further than its immediate edges.
 *
 * Canary links are included in API responses as bait (so appearance
 * elsewhere proves copying). Item-page renderers must filter them out —
 * `shapeItemPage` is the filtered variant.
 */

import type { LiveSnapshot } from "../graph/live";
import type { GraphEdge, GraphNode } from "../graph/types";

export interface ApiItem {
  code: string;
  slug: string;
  name: string;
  tier: string;
  recipes: Array<{ code: string; label: string | null; position: number }>;
  up: ApiEdge[];
  down: ApiEdge[];
}

export interface ApiEdge {
  /** Opaque link code; use with /api/links/:code/evidence. */
  code: string;
  /** Opaque item code of the other end. */
  item: string;
  /** Direction-neutral type: f, w, n, s, e. */
  type: string;
  confidence: string;
  recipe?: string;
}

/**
 * Full neighbourhood response (used by /api/items/:code). Includes canaries
 * so bait appears in API traffic but not on item pages.
 */
export function shapeNeighbourhood(
  live: LiveSnapshot,
  node: GraphNode,
): ApiItem {
  return shape(live, node, { includeCanary: true });
}

/** Item-page shape (filtered: no canaries). */
export function shapeItemPage(live: LiveSnapshot, node: GraphNode): ApiItem {
  return shape(live, node, { includeCanary: false });
}

function shape(
  live: LiveSnapshot,
  node: GraphNode,
  opts: { includeCanary: boolean },
): ApiItem {
  const recipeCodes = new Map<string, string>();
  const recipes = node.recipes.map((r, i) => {
    const code = `r${i}:${live.itemCodes.toCode(node.id) ?? ""}`;
    recipeCodes.set(r.id, code);
    return { code, label: r.label, position: r.position };
  });

  const toEdge = (e: GraphEdge): ApiEdge | null => {
    if (!opts.includeCanary && e.isCanary) return null;
    const item = live.itemCodes.toCode(e.id);
    const code = live.linkCodes.toCode(e.linkId);
    if (!item || !code) return null;
    const out: ApiEdge = {
      code,
      item,
      type: e.type,
      confidence: e.confidence,
    };
    if (e.recipeId) {
      const r = recipeCodes.get(e.recipeId);
      if (r) out.recipe = r;
    }
    return out;
  };

  const up = node.up.map(toEdge).filter((e): e is ApiEdge => e !== null);
  const down = node.down.map(toEdge).filter((e): e is ApiEdge => e !== null);

  return {
    code: live.itemCodes.toCode(node.id) ?? "",
    slug: node.id,
    name: node.name,
    tier: node.tier,
    recipes,
    up,
    down,
  };
}
