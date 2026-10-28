import type { Confidence, ItemKind, LinkType, Tier } from "@/db/schema";

export interface ExploreItem {
  slug: string;
  code: string;
  name: string;
  tier: Tier;
  kind: ItemKind;
  symbol: string | null;
  firstAppeared: string | null;
  firstAppearedYa: number | null;
  fact: string;
}

export interface ExploreEdge {
  type: LinkType;
  confidence: Confidence;
  recipeId: string | null;
  linkCode: string;
  hasEvidence: boolean;
  item: ExploreItem;
}

export interface ExploreRecipe {
  id: string;
  label: string | null;
  position: number;
}

export interface ExploreView {
  item: ExploreItem;
  recipes: ExploreRecipe[];
  /** All up-edges across all recipes (plus item-level n/s). Client filters by selected recipe. */
  up: ExploreEdge[];
  /** Downstream edges, independent of recipe. */
  down: ExploreEdge[];
  /** Pre-computed shortest chain from big bang → this item (ids + names). */
  originChain: ExploreItem[];
  /** How many ancestors total — used for "N things can go into it". */
  ancestorCount: number;
  /** Steps from big bang (chain length minus one). */
  stepsFromBigBang: number | null;
}
