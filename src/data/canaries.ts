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

import { randomUUID } from "node:crypto";
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
 * Review this list whenever the knowledge base gains or loses items.
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
 * do not pollute an existing recipe. The caller supplies a slug → item uuid
 * map so canaries can reference existing items by their stable id.
 */
export function buildCanaryLinks(
  itemIdBySlug: Map<string, string>,
): { links: NewLink[]; missing: string[] } {
  const links: NewLink[] = [];
  const missing: string[] = [];
  for (const c of CANARIES) {
    const src = itemIdBySlug.get(c.srcSlug);
    if (!src) {
      missing.push(c.srcSlug);
      continue;
    }
    const target = itemIdBySlug.get(c.targetSlug);
    if (!target) {
      missing.push(c.targetSlug);
      continue;
    }
    links.push({
      id: randomUUID(),
      recipeId: null,
      itemId: src,
      type: c.type,
      targetItemId: target,
      confidence: "strong",
      note: c.note,
      isCanary: true,
    });
  }
  return { links, missing };
}
