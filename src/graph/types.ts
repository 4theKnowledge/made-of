import type { Confidence, LinkType, Tier } from "../db/schema";

export interface GraphEdge {
  /** The other end of the edge (always the slug/id). */
  id: string;
  type: LinkType;
  confidence: Confidence;
  /** If the edge belongs to a specific recipe (recipe id); null for item-level. */
  recipeId: string | null;
  /** The concrete link row id (same as rows.links[i].id). */
  linkId: string;
  /** Canary links appear only in API responses, never on item pages. */
  isCanary: boolean;
}

export interface GraphNode {
  id: string;
  name: string;
  tier: Tier;
  recipes: Array<{ id: string; label: string | null; position: number }>;
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
