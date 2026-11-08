/**
 * Load the graph from Postgres into the in-memory shape `buildSnapshot`
 * consumes.
 *
 * The query set is intentionally tiny: three selects for items, recipes and
 * links. Evidence and sources are fetched on demand by the per-link evidence
 * route — never shipped as a batch, so no "export the graph" shortcut exists.
 */

import { and, eq } from "drizzle-orm";
import { getDb, schema, type Db } from "../db/client";
import type { SeedRows } from "../data/rows";

/** Drizzle's tx object exposes the same `.select()` surface as the top-level
 *  db handle. We type the executor loosely so the audit helper can run the
 *  same reads from inside a transaction (so uncommitted writes are visible
 *  to the audit). */
export type DbExecutor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function loadRowsFromDb(opts?: {
  /** Include only status='live' items and their links. Default true. */
  liveOnly?: boolean;
  /** Executor to read through. Defaults to the global db handle. Pass a
   *  `tx` to see uncommitted writes within a transaction. */
  executor?: DbExecutor;
}): Promise<SeedRows> {
  const liveOnly = opts?.liveOnly ?? true;
  const db = opts?.executor ?? getDb();

  const items = liveOnly
    ? await db
        .select()
        .from(schema.items)
        .where(eq(schema.items.status, "live"))
    : await db.select().from(schema.items);

  const liveIds = new Set(items.map((i) => i.id));

  const [recipes, links, evidence, itemThemes, themes] = await Promise.all([
    db.select().from(schema.recipes),
    db.select().from(schema.links),
    db
      .selectDistinct({ linkId: schema.linkEvidence.linkId })
      .from(schema.linkEvidence),
    db
      .select({
        itemId: schema.itemCombineThemes.itemId,
        themeCode: schema.itemCombineThemes.themeCode,
      })
      .from(schema.itemCombineThemes),
    db
      .select({
        code: schema.combineThemes.code,
        label: schema.combineThemes.label,
        description: schema.combineThemes.description,
        collectionVersion: schema.combineThemes.collectionVersion,
      })
      .from(schema.combineThemes),
  ]);

  const themeMeta = new Map<string, { code: string; label: string; description: string | null; collectionVersion: number }>();
  for (const t of themes) themeMeta.set(t.code, t);

  const combineThemesByItem = new Map<string, string[]>();
  for (const row of itemThemes) {
    if (!liveIds.has(row.itemId)) continue;
    const list = combineThemesByItem.get(row.itemId) ?? [];
    list.push(row.themeCode);
    combineThemesByItem.set(row.itemId, list);
  }

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
    combineThemesByItem,
    themeMeta,
    // These three are only needed by the seed/round-trip test. The runtime
    // graph does not need evidence or sources — the per-link evidence API
    // fetches them straight from Postgres on demand.
    linkEvidence: [],
    evidenceSources: [],
    sources: [],
    // Lookup maps are only populated when building rows from the knowledge
    // base. Reading straight from the DB leaves them empty.
    itemIdByName: new Map(),
    itemIdBySlug: new Map(),
    sourceIdByCode: new Map(),
    stats: {
      items: items.length,
      links: liveLinks.length,
      evidencedLinks: 0,
      sources: 0,
      unresolvedEvidenceIds: [],
    },
  };
}

/** Load the fallback pictograms keyed by kind code. Called once per snapshot
 *  build; the result is pinned alongside the snapshot in memory. */
export async function loadKindPictograms(): Promise<Map<string, string>> {
  const db = getDb();
  const rows = await db
    .select({ code: schema.kinds.code, pictogram: schema.kinds.pictogram })
    .from(schema.kinds);
  const m = new Map<string, string>();
  for (const r of rows) {
    if (r.pictogram) m.set(r.code, r.pictogram);
  }
  return m;
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
