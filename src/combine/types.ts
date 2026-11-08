/**
 * Combine's data shapes. The engine, UI and tests all read from a prebuilt
 * `ThemeBundle`; the full graph never crosses this boundary.
 */

import type { ItemKind, Tier } from "../db/schema";
import type { DailyConfig } from "./daily-config";

/** A Combine theme's `combine_themes.code`. Any admin-published theme is
 *  valid — the legacy "everything" alias remains in the data for continuity
 *  but new themes just plug in by code. */
export type ThemeKey = string;

/** The fallback / historical default theme. Used when no theme is supplied
 *  (legacy URLs, missing config) and as the publish-gate seed. */
export const DEFAULT_THEME: ThemeKey = "everything";

/** Combine play mode. Four first-class modes:
 *  - `endless` — chapter-based progression, long-running, score+collection.
 *  - `daily` — chapter-based progression tuned by a theme's `dailyConfig`
 *    (capped ages, guest-of-the-day). Separate collection scope.
 *  - `fast` — 2-part recipes only, single band, score-only. Shares the
 *    endless collection scope at the DB level but does not add to it.
 *  - `tutorial` — guided, scripted-deck run on the endless bundle. Never
 *    persists to save slots, never posts to the server, never writes to
 *    the lifetime collection. Reuses the endless reducer paths so the
 *    player learns on the same board behaviour they'll see in endless.
 *
 *  `endless`, `daily` and `tutorial` share the same reducer paths (see
 *  `isClassic`); the mode is kept distinct for UI, admin, leaderboards,
 *  and stats. */
export type Mode = "endless" | "daily" | "fast" | "tutorial";

/** True when the mode uses the chapter-based "classic" reducer paths
 *  (endless + daily + tutorial). Fast is the only non-classic mode today.
 *  The engine historically used `mode === "classic"` for this; the
 *  predicate keeps that logic working after the mode rename. */
export function isClassic(mode: Mode): boolean {
  return mode !== "fast";
}

export interface ThemeMeta {
  k: ThemeKey;
  name: string;
  desc: string;
  /** Active per-run age labels. Length == the derived `numAges` for this
   *  bundle. On the authored config this is a *pool* that may be longer than
   *  today's numAges; `buildThemeBundle` slices it down. */
  ages: string[];
  /** Monotonic counter bumped when the theme's discoverable set changes.
   *  Drives completion acknowledgements (T-0217). Zero when built outside
   *  of a DB-backed snapshot (tests, legacy paths) — the DB is the source
   *  of truth. */
  collectionVersion: number;
}

/** One recipe projected into Combine's world. In Combine both `f` (made
 *  from) and `w` (made with — tools) are consumed when the group matches. */
export interface CombineRecipe {
  /** Underlying `recipes.id` (UUID). Used by the reactions UI to vote on
   *  the specific authored recipe row, and by admin triage to join with
   *  reactions / feedback tables. May be empty for synthetic recipes in
   *  tests — all production bundles carry it. */
  id: string;
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
  /** When set, this bundle was built for a daily run. Carries the
   *  theme's `dailyConfig` so the dealer + target resolver can read
   *  guest-ingredient settings and target discoveries. */
  dailyConfig?: DailyConfig | null;
  /** Output ids eligible as guest-of-the-day tiles. Only populated on
   *  daily bundles whose `dailyConfig.guestIngredient.perRun > 0`. */
  guestPool?: string[];
}
