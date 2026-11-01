/**
 * Combine theme metadata + tag-based filters.
 *
 * Membership (which items appear in which theme) lives on each item as a
 * `Tag` in src/data/types.ts. This file holds only the themes themselves
 * and the helpers that read tags.
 */

import type { GraphNode } from "../graph/types";
import type { ThemeKey, ThemeMeta } from "./types";

export const THEMES: Record<ThemeKey, ThemeMeta> = {
  everything: {
    k: "everything",
    name: "Everything",
    desc: "The whole map: atoms, stars, life, food, factories, machines.",
    ages: ["Cosmos", "Earth", "Craft", "Industry", "Machines", "Modern"],
  },
};

/** Never dealt or made in Combine (fab chain, big bang). */
export function isCombineExcluded(node: GraphNode): boolean {
  return node.tags.includes("combine-exclude");
}
