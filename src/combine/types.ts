/**
 * Combine's data shapes. The engine, UI and tests all read from a prebuilt
 * `ThemeBundle`; the full graph never crosses this boundary.
 */

import type { ItemKind, Tier } from "../db/schema";

export type ThemeKey = "everything";

/** Combine play mode. `classic` is the age-banded progression game (what
 *  endless and daily both play). `fast` restricts to 2-part recipes and
 *  flattens the age structure so every tile is almost always combinable —
 *  tuned for rapid-fire combos on the same 6×6 board. */
export type Mode = "classic" | "fast";

export interface ThemeMeta {
  k: ThemeKey;
  name: string;
  desc: string;
  /** Active per-run age labels. Length == the derived `numAges` for this
   *  bundle. On the authored config this is a *pool* that may be longer than
   *  today's numAges; `buildThemeBundle` slices it down. */
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
  /** Prerequisites — "needs" links. Treated as ingredients for matching
   *  purposes (the player must place them with everything else) but kept
   *  separate so UI/debug can distinguish catalyst-flavoured inputs. */
  needs: string[];
  /** Ancestors — "evolved from" links. Treated as ingredients for matching
   *  so evolve chains (fish → amphibians) actually combine on the board. */
  evolved: string[];
  /** `uniq([...from, ...with, ...needs, ...evolved])` — the match set.
   *  2..7 items. */
  all: string[];
  /** Level in the whole-theme refinement order. */
  lvl: number;
  /** Age band (1..n), after the later-age fix-up pass. */
  band: number;
}

/** Light view of an item for Combine — just what tiles and cards need. */
export interface CombineItem {
  id: string;
  /** URL slug for the Explore link. */
  slug: string;
  name: string;
  tier: Tier;
  symbol: string | null;
  fact: string;
  kind: ItemKind;
  /** The item's first `f` recipe parts (ids), straight from the knowledge
   *  base. Shown by the detail card when the gameplay bundle has filtered
   *  the recipe out. */
  lore?: string[];
}

/** The subset of a theme that is "in play" at a given age index (0-based).
 *  Tiles are dealt from bands [age, age+1]; tiles are "useful" (don't
 *  crumble) if they appear in bands [age, age+1, age+2]. */
export interface AgeSets {
  /** Age index (0-based). */
  age: number;
  /** Recipes whose band is `age+1` or `age` (1-based). */
  recipes: CombineRecipe[];
  /** All ingredients used by `recipes`. */
  ING: Set<string>;
  /** Raw (not outputs) within `ING`. */
  BASE: string[];
  /** Made (outputs) within `ING`. */
  MID: string[];
  /** Everything useful across bands [age, age+1, age+2]. */
  USE: Set<string>;
  /** Recipes in the band after the current one. */
  NEXT: CombineRecipe[];
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
  /** Minimum band (1..n) each output can be made in. */
  outBand: Map<string, number>;
}
