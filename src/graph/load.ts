/**
 * Load the graph from Postgres into the in-memory shape `buildSnapshot`
 * consumes.
 *
 * The query set is intentionally tiny: three selects for items, recipes and
 * links. Evidence and sources are fetched on demand by the per-link evidence
 * route — never shipped as a batch, so no "export the graph" shortcut exists.
 */

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../db/client";
import type { LoadedRows } from "../parser/load";

export async function loadRowsFromDb(opts?: {
  /** Include only status='live' items and their links. Default true. */
  liveOnly?: boolean;
}): Promise<LoadedRows> {
  const liveOnly = opts?.liveOnly ?? true;
  const db = getDb();

  const items = liveOnly
    ? await db
        .select()
        .from(schema.items)
        .where(eq(schema.items.status, "live"))
    : await db.select().from(schema.items);

  const liveIds = new Set(items.map((i) => i.id));

  const [recipes, links, evidence] = await Promise.all([
    db.select().from(schema.recipes),
    db.select().from(schema.links),
    db
      .selectDistinct({ linkId: schema.linkEvidence.linkId })
      .from(schema.linkEvidence),
  ]);

  const liveRecipes = recipes.filter((r) => liveIds.has(r.itemId));
  const liveRecipeIds = new Set(liveRecipes.map((r) => r.id));
  const linksWithEvidence = new Set(evidence.map((e) => e.linkId));

  const liveLinks = links
    .filter((l) => {
      if (!liveIds.has(l.targetItemId)) return false;
      if (l.recipeId && !liveRecipeIds.has(l.recipeId)) return false;
      if (l.itemId && !liveIds.has(l.itemId)) return false;
      return true;
    })
    .map((l) => ({
      ...l,
      hasEvidence: linksWithEvidence.has(l.id),
    }));

  return {
    items,
    recipes: liveRecipes,
    links: liveLinks,
    // These three are only needed by the seed/round-trip test. The runtime
    // graph does not need evidence or sources — the per-link evidence API
    // fetches them straight from Postgres on demand.
    linkEvidence: [],
    evidenceSources: [],
    sources: [],
    stats: {
      items: items.length,
      links: liveLinks.length,
      evidencedLinks: 0,
      sources: 0,
      unresolvedEvidenceIds: [],
    },
  };
}

/** Fetch one link's evidence + sources. Used by GET /api/links/:code/evidence. */
export async function loadLinkEvidence(linkId: string) {
  const db = getDb();
  const [link] = await db
    .select()
    .from(schema.links)
    .where(and(eq(schema.links.id, linkId)))
    .limit(1);
  if (!link) return null;

  const evidence = await db
    .select()
    .from(schema.linkEvidence)
    .where(eq(schema.linkEvidence.linkId, linkId));

  if (evidence.length === 0) return { link, evidence: [] };

  const evSources = await Promise.all(
    evidence.map(async (ev) => {
      const rows = await db
        .select({
          source: schema.sources,
          position: schema.evidenceSources.position,
        })
        .from(schema.evidenceSources)
        .innerJoin(
          schema.sources,
          eq(schema.evidenceSources.sourceId, schema.sources.id),
        )
        .where(eq(schema.evidenceSources.evidenceId, ev.id));
      return {
        ...ev,
        sources: rows
          .sort((a, b) => a.position - b.position)
          .map((r) => r.source),
      };
    }),
  );

  return { link, evidence: evSources };
}
