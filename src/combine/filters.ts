/**
 * Combine theme metadata + membership helpers.
 *
 * Membership (which items appear in which theme) now lives in Postgres on
 * the item_combine_themes join table, exposed on each GraphNode as
 * `combineThemes: string[]`. This file holds the static per-theme metadata
 * (ages, display strings) that doesn't belong in the DB.
 *
 * Legacy: `isCombineExcluded` previously drove Everything membership via
 * the `combine-exclude` tag. It stays as a safety net — an item marked
 * exclude is treated as if it weren't in any theme even if the join table
 * says otherwise. The admin theme validator flags that contradiction.
 */

import type { GraphNode } from "../graph/types";
import type { ThemeKey, ThemeMeta } from "./types";

/** Age-label pool per theme. The active bundle slices this down to the
 *  derived `numAges`; extra entries are headroom for future KB growth so a
 *  new age doesn't need a code change. */
const AGE_POOL: Record<ThemeKey, string[]> = {
  everything: [
    "I",
    "II",
    "III",
    "IV",
    "V",
    "VI",
    "VII",
    "VIII",
    "IX",
    "X",
    "XI",
    "XII",
    "XIII",
    "XIV",
    "XV",
  ],
};

export const THEMES: Record<ThemeKey, ThemeMeta> = {
  everything: {
    k: "everything",
    name: "Everything",
    desc: "The whole map: atoms, stars, life, food, factories, machines.",
    ages: AGE_POOL.everything,
  },
};

/** Open-ended age-label pool for a theme. `buildThemeBundle` slices this to
 *  the derived `numAges` and puts the slice on the active `ThemeMeta.ages`. */
export function themeAgePool(theme: ThemeKey): string[] {
  return AGE_POOL[theme];
}

/** Never dealt or made in Combine (fab chain, big bang). Kept as a safety
 *  net; the join table is the source of truth for Everything membership. */
export function isCombineExcluded(node: GraphNode): boolean {
  return node.tags.includes("combine-exclude");
}

/** True when the node belongs to the given Combine theme. Enforces the
 *  "exclude trumps membership" rule so a stray exclude tag can't leak into
 *  the game via the join table. */
export function inCombineTheme(node: GraphNode, theme: ThemeKey): boolean {
  if (isCombineExcluded(node)) return false;
  return node.combineThemes.includes(theme);
}
