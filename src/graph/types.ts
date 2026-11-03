import type { Confidence, ItemKind, LinkType, Tier } from "../db/schema";
import type { Tag } from "../data/types";

export interface GraphEdge {
  /** The other end of the edge (always the slug/id). */
  id: string;
  type: LinkType;
  confidence: Confidence;
  /** If the edge belongs to a specific recipe (recipe id); null for item-level. */
  recipeId: string | null;
  /** The concrete link row id (same as rows.links[i].id). */
  linkId: string;
  /** True if this link has evidence rows (used to show the evidence dot). */
  hasEvidence: boolean;
  /** Canary links appear only in API responses, never on item pages. */
  isCanary: boolean;
}

export interface GraphNode {
  /** Opaque uuid primary key. */
  id: string;
  /** URL-safe slug (`big-bang`). Unique and stable across renames. */
  slug: string;
  name: string;
  tier: Tier;
  kind: ItemKind;
  firstAppeared: string | null;
  firstAppearedYa: number | null;
  symbol: string | null;
  fact: string;
  /** Item-specific SVG inner-markup. When null, Pictogram.tsx falls back
   *  to the kind's pictogram (and, for elements, the letter tile). */
  pictogram: string | null;
  recipes: Array<{ id: string; label: string | null; position: number }>;
  /** Membership markers. Empty array if none. */
  tags: Tag[];
  /** Combine theme codes this item belongs to. Empty array if none. */
  combineThemes: string[];
  /** True when the item is a canary (seeded fake, visible only in API
   *  responses — never on item pages, the sitemap, llms.txt, or the
   *  Index). */
  isCanary: boolean;
  /** All edges leading *up* (into the parents, i.e. what this item is made from). */
  up: GraphEdge[];
  /** All edges leading *down* (consumers of this item). */
  down: GraphEdge[];
  /** Dedup'd neighbours (ids), both directions, both recipes merged. */
  neighbours: string[];
}

export interface PathStep {
  id: string;
  /** Edge taken from the previous step to arrive here. Null for the start. */
  edge: { type: LinkType; direction: "up" | "down" } | null;
}
