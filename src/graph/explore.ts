/**
 * Server-side helper for the Explore page. Resolves a slug to the shape
 * the client needs, including the shortest chain from the big bang and the
 * ancestor count (used for "N things can go into it").
 */

import { getLiveSnapshot } from "./live";
import { ancestors, shortestPath } from "./snapshot";
import type { GraphEdge } from "./types";
import type {
  ExploreEdge,
  ExploreItem,
  ExploreView,
} from "@/components/explore/types";

const ORIGIN_SLUG = "big-bang";

export async function getExploreView(
  slug: string,
  opts: { includeCanary?: boolean } = {},
): Promise<ExploreView | null> {
  const live = await getLiveSnapshot();
  const node = live.snapshot.bySlug.get(slug);
  if (!node) return null;
  const includeCanary = opts.includeCanary ?? false;

  const toItem = (id: string): ExploreItem | null => {
    const n = live.snapshot.nodes.get(id);
    if (!n) return null;
    const code = live.itemCodes.toCode(n.slug);
    if (!code) return null;
    return {
      slug: n.slug,
      code,
      name: n.name,
      tier: n.tier,
      kind: n.kind,
      symbol: n.symbol,
      firstAppeared: n.firstAppeared,
      firstAppearedYa: n.firstAppearedYa,
      fact: n.fact,
    };
  };

  const toEdge = (e: GraphEdge): ExploreEdge | null => {
    if (!includeCanary && e.isCanary) return null;
    const target = toItem(e.id);
    const linkCode = live.linkCodes.toCode(e.linkId);
    if (!target || !linkCode) return null;
    return {
      type: e.type,
      confidence: e.confidence,
      recipeId: e.recipeId,
      linkCode,
      hasEvidence: e.hasEvidence,
      item: target,
    };
  };

  const item = toItem(node.id)!;
  const up = node.up
    .map(toEdge)
    .filter((e): e is ExploreEdge => e !== null);
  const down = node.down
    .map(toEdge)
    .filter((e): e is ExploreEdge => e !== null);

  // Chain from big bang → this item.
  let originChain: ExploreItem[] = [];
  let stepsFromBigBang: number | null = null;
  const origin = live.snapshot.bySlug.get(ORIGIN_SLUG);
  if (origin) {
    const path = shortestPath(live.snapshot, origin.id, node.id);
    if (path) {
      originChain = path
        .map((p) => toItem(p.id))
        .filter((it): it is ExploreItem => it !== null);
      stepsFromBigBang = path.length - 1;
    }
  }

  const ancestorCount = ancestors(live.snapshot, node.id).size;

  return {
    item,
    recipes: node.recipes,
    up,
    down,
    originChain,
    ancestorCount,
    stepsFromBigBang,
  };
}
