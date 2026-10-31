/**
 * Combine's data shapes. The engine, UI and tests all read from a prebuilt
 * `ThemeBundle`; the full graph never crosses this boundary.
 */

import type { Tier } from "../db/schema";

export type ThemeKey = "everyday" | "everything";

export interface ThemeMeta {
  k: ThemeKey;
  name: string;
  desc: string;
  ages: string[];
}

/** One recipe projected into Combine's world. In Combine both `f` (made
 *  from) and `w` (made with — tools) are consumed when the group matches. */
export interface CombineRecipe {
  /** Output item slug. */
  out: string;
  /** Ingredients that are "made from". */
  from: string[];
  /** Ingredients that are "made with" — tools. */
  with: string[];
  /** `uniq([...from, ...with])` — the match set. 2..7 items. */
  all: string[];
  /** Level in the whole-theme refinement order. */
  lvl: number;
  /** Age band (1..n), after the later-age fix-up pass. */
  band: number;
}

/** Light view of an item for Combine — just what tiles and cards need. */
export interface CombineItem {
  id: string;
  name: string;
  tier: Tier;
  symbol: string | null;
  fact: string;
  kind: string;
}

export interface ThemeBundle {
  theme: ThemeMeta;
  recipes: CombineRecipe[];
  /** Recipes indexed by every ingredient they contain, biggest first. */
  byIngredient: Map<string, CombineRecipe[]>;
  /** Every output item. */
  outputs: Set<string>;
  /** Every ingredient item. */
  ingredients: Set<string>;
  /** Ingredients that nothing makes — the raw stuff and tools we deal. */
  base: string[];
  /** Ingredients that are also outputs — made things we can chain through. */
  mid: string[];
  /** Items used anywhere as `w`. */
  tools: Set<string>;
  /** Outputs that nothing uses — finished goods, ship to the shelf. */
  terminal: Set<string>;
  /** Recipes grouped by `sort(all).join("+")` — alternative outputs for the
   *  same ingredient set. */
  sameIngredients: Map<string, CombineRecipe[]>;
  /** Item views for everything the bundle refers to. */
  items: Map<string, CombineItem>;
}
