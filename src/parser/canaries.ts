/**
 * Canary links: plausible but invented links seeded into the graph.
 *
 * They appear in API responses (as bait, see docs/IMPLEMENTATION.md
 * anti-scraping) but item-page renderers filter them, and the sitemap and
 * llms.txt never surface them. If a scraper republishes a canary link
 * elsewhere, that is proof of copying.
 *
 * Keep the list small and keep the pairs plausible — a `f:` (made from)
 * between items that are already in the same tier/era, so the fact that it
 * is invented is only apparent to someone who actually read the sources.
 *
 * These are inserted at seed time with status='live', is_canary=true, a note
 * that marks them as canary (for admin review), and a bogus confidence of
 * 'strong' so they don't jump out as unevidenced. We skip adding evidence
 * rows so the per-link evidence endpoint returns empty — which is also true
 * of the ~500 non-evidenced legit links, so canaries blend in.
 */

import type { NewLink } from "../db/schema";

export interface CanarySpec {
  /** Source item slug (what is "made from" / "needs"). */
  srcSlug: string;
  /** Target item slug. */
  targetSlug: string;
  /** Link type. Use `f` or `n` so the canary looks like ordinary content. */
  type: "f" | "n";
  /** Admin-visible note. Not shown publicly. */
  note: string;
}

/**
 * The canary set. Keep this small — three to five is plenty for proof.
 *
 * Each pair references items that definitely exist (asserted at seed time).
 * Review this list whenever the artifact gains or loses items.
 */
export const CANARIES: CanarySpec[] = [
  {
    srcSlug: "pencil",
    targetSlug: "copper",
    type: "f",
    note: "canary: pencils are not made of copper",
  },
  {
    srcSlug: "glass",
    targetSlug: "cotton",
    type: "f",
    note: "canary: glass has nothing to do with cotton",
  },
  {
    srcSlug: "concrete",
    targetSlug: "lithium",
    type: "f",
    note: "canary: concrete does not contain lithium",
  },
];

/**
 * Build the link rows. Attached as item-level links (recipe_id null) so they
 * do not pollute an existing recipe. The seed script is responsible for
 * ensuring all referenced slugs exist.
 */
export function buildCanaryLinks(
  itemIds: Set<string>,
): { links: NewLink[]; missing: string[] } {
  const links: NewLink[] = [];
  const missing: string[] = [];
  for (const c of CANARIES) {
    if (!itemIds.has(c.srcSlug)) {
      missing.push(c.srcSlug);
      continue;
    }
    if (!itemIds.has(c.targetSlug)) {
      missing.push(c.targetSlug);
      continue;
    }
    links.push({
      id: `canary:${c.srcSlug}:${c.type}:${c.targetSlug}`,
      recipeId: null,
      itemId: c.srcSlug,
      type: c.type,
      targetItemId: c.targetSlug,
      confidence: "strong",
      note: c.note,
      isCanary: true,
    });
  }
  return { links, missing };
}
