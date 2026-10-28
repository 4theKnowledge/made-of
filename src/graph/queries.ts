/**
 * Server-side read helpers for pages.
 *
 * These go through the live snapshot, not Postgres directly, so they return
 * canary-free data when `includeCanary=false` and share the opaque code map
 * the API uses. Pages render with slugs in URLs but include item codes in
 * data attributes for the client to call /api/* later.
 */

import { getLiveSnapshot } from "./live";
import type { GraphEdge } from "./types";
import type { Confidence, ItemKind, LinkType, Tier } from "@/db/schema";

export type RelType = LinkType;

export interface PageEdge {
  type: RelType;
  confidence: Confidence;
  recipeId: string | null;
  linkId: string;
  linkCode: string;
  /** The target node (filtered, non-canary, live). */
  item: {
    slug: string;
    code: string;
    name: string;
    tier: Tier;
    kind: ItemKind;
    symbol: string | null;
  };
}

export interface PageItem {
  slug: string;
  code: string;
  name: string;
  tier: Tier;
  kind: ItemKind;
  symbol: string | null;
  firstAppeared: string | null;
  firstAppearedYa: number | null;
  fact: string;
  recipes: Array<{ id: string; label: string | null; position: number }>;
  up: PageEdge[];
  down: PageEdge[];
}

/** Resolve a slug to a page-ready item, or null if the slug is unknown or not live. */
export async function getItemPage(
  slug: string,
  opts: { includeCanary?: boolean } = {},
): Promise<PageItem | null> {
  const live = await getLiveSnapshot();
  const node = live.snapshot.nodes.get(slug);
  if (!node) return null;

  const code = live.itemCodes.toCode(node.id);
  if (!code) return null;

  const includeCanary = opts.includeCanary ?? false;

  const toPageEdge = (e: GraphEdge): PageEdge | null => {
    if (!includeCanary && e.isCanary) return null;
    const target = live.snapshot.nodes.get(e.id);
    const targetCode = live.itemCodes.toCode(e.id);
    const linkCode = live.linkCodes.toCode(e.linkId);
    if (!target || !targetCode || !linkCode) return null;
    return {
      type: e.type,
      confidence: e.confidence,
      recipeId: e.recipeId,
      linkId: e.linkId,
      linkCode,
      item: {
        slug: target.id,
        code: targetCode,
        name: target.name,
        tier: target.tier,
        kind: target.kind,
        symbol: target.symbol,
      },
    };
  };

  return {
    slug: node.id,
    code,
    name: node.name,
    tier: node.tier,
    kind: node.kind,
    symbol: node.symbol,
    firstAppeared: node.firstAppeared,
    firstAppearedYa: node.firstAppearedYa,
    fact: node.fact,
    recipes: node.recipes,
    up: node.up.map(toPageEdge).filter((e): e is PageEdge => e !== null),
    down: node.down.map(toPageEdge).filter((e): e is PageEdge => e !== null),
  };
}
