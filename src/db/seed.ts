/**
 * Load the knowledge base at src/data/*.data.ts into Postgres.
 *
 * Idempotent on a fresh database. Not safe to run against a database that
 * already contains edited content.
 */

import { notInArray, sql } from "drizzle-orm";
import { loadKnowledgeBase } from "../data/load";
import { toRows } from "../data/rows";
import { buildCanaryLinks } from "../data/canaries";
import { closeDb, getDb, schema } from "./client";

async function main() {
  const parsed = loadKnowledgeBase();
  const rows = toRows(parsed);

  if (rows.stats.unresolvedEvidenceIds.length > 0) {
    throw new Error(
      `Evidence refers to ${rows.stats.unresolvedEvidenceIds.length} unknown link ids. First few: ${rows.stats.unresolvedEvidenceIds.slice(0, 5).join(", ")}`,
    );
  }

  // Plant the canary links. If any referenced slug is missing (because the
  // artifact changed), fail loudly — a stale canary set is worse than none.
  const canaries = buildCanaryLinks(rows.itemIdBySlug);
  if (canaries.missing.length > 0) {
    throw new Error(
      `Canary set references unknown items: ${canaries.missing.join(", ")}`,
    );
  }
  rows.links.push(...canaries.links);

  console.log("parsed:", {
    items: rows.stats.items,
    links: rows.stats.links,
    evidencedLinks: rows.stats.evidencedLinks,
    sources: rows.stats.sources,
    canaries: canaries.links.length,
  });

  const db = getDb();
  await db.transaction(async (tx) => {
    // Children that are regenerated wholesale each reseed. Their ids are
    // random on every run (recipes/links/evidence/sources), and nothing
    // outside this transaction FKs to them, so delete-all is fine.
    //
    // CRITICALLY: we do NOT delete `items` anymore. Item ids are now
    // derived from slug (UUIDv5), so a reseed produces the same id for the
    // same slug. We upsert items by id and delete only items whose slug is
    // no longer in the knowledge base. This keeps `combine_discoveries`
    // (and anything else FK'd to items with ON DELETE CASCADE) intact
    // across reseeds. We also no longer wipe `daily_puzzles` or `reports`
    // — they reference items by id, which now survive.
    await tx.delete(schema.evidenceSources);
    await tx.delete(schema.linkEvidence);
    await tx.delete(schema.links);
    await tx.delete(schema.recipes);
    await tx.delete(schema.sources);

    // Kinds table is populated by the migration, but a fresh DB that runs
    // this seeder may still need them. onConflictDoNothing keeps this
    // idempotent in both cases.
    await tx
      .insert(schema.kinds)
      .values([
        { code: "cosmic", label: "Cosmic", position: 0 },
        { code: "element", label: "Element", position: 1 },
        { code: "mineral", label: "Mineral", position: 2 },
        { code: "living", label: "Living", position: 3 },
        { code: "substance", label: "Substance", position: 4 },
        { code: "food", label: "Food", position: 5 },
        { code: "energy", label: "Energy", position: 6 },
        { code: "part", label: "Part", position: 7 },
        { code: "object", label: "Object", position: 8 },
        { code: "tool", label: "Tool", position: 9 },
        { code: "place", label: "Place", position: 10 },
        { code: "information", label: "Information", position: 11 },
      ])
      .onConflictDoNothing();

    // Prune items (and, via cascade, link/recipe/theme/discovery rows)
    // whose slug is no longer in the knowledge base. Do this BEFORE the
    // upsert so a rename (which changes the derived id) doesn't collide
    // with the old row's unique(name) or unique(slug) constraints. These
    // are legitimate removals — discoveries for them cascade too, which is
    // the right call (the item no longer exists).
    const keepIds = rows.items.map((it) => it.id!);
    const removed = await tx
      .delete(schema.items)
      .where(keepIds.length === 0 ? sql`true` : notInArray(schema.items.id, keepIds))
      .returning({ id: schema.items.id, slug: schema.items.slug });
    if (removed.length > 0) {
      console.log(
        `seed: pruned ${removed.length} items no longer in KB:`,
        removed.map((r) => r.slug).join(", "),
      );
    }

    await upsertItems(tx, rows.items);
    await bulkInsert(tx, schema.sources, rows.sources);
    await bulkInsert(tx, schema.recipes, rows.recipes);
    await bulkInsert(tx, schema.links, rows.links);
    await bulkInsert(tx, schema.linkEvidence, rows.linkEvidence);
    await bulkInsert(tx, schema.evidenceSources, rows.evidenceSources);

    // Everything theme membership. The 'everything' row itself is created
    // by migration 0010. Every item goes in except those marked
    // isCombineExcluded (currently just big bang).
    const everythingMembership = rows.items
      .filter((it) => !it.isCombineExcluded)
      .map((it) => ({ itemId: it.id!, themeCode: "everything" }));
    if (everythingMembership.length > 0) {
      for (let i = 0; i < everythingMembership.length; i += 500) {
        await tx
          .insert(schema.itemCombineThemes)
          .values(everythingMembership.slice(i, i + 500))
          .onConflictDoNothing();
      }
    }
  });

  console.log("seed complete");
  await closeDb();
}

async function bulkInsert<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  rows: T[],
  chunkSize = 500,
) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await tx.insert(table).values(rows.slice(i, i + chunkSize));
  }
}

/** Upsert items by id. KB updates should refresh existing rows in place
 *  rather than deleting + reinserting, so nothing downstream (discoveries,
 *  reports, daily puzzles) gets cascaded away. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertItems(tx: any, items: any[]) {
  if (items.length === 0) return;
  for (let i = 0; i < items.length; i += 500) {
    await tx
      .insert(schema.items)
      .values(items.slice(i, i + 500))
      .onConflictDoUpdate({
        target: schema.items.id,
        set: {
          slug: sql`excluded.slug`,
          name: sql`excluded.name`,
          tier: sql`excluded.tier`,
          kind: sql`excluded.kind`,
          firstAppeared: sql`excluded.first_appeared`,
          firstAppearedYa: sql`excluded.first_appeared_ya`,
          symbol: sql`excluded.symbol`,
          fact: sql`excluded.fact`,
          pictogram: sql`excluded.pictogram`,
          status: sql`excluded.status`,
          isCanary: sql`excluded.is_canary`,
          tags: sql`excluded.tags`,
          updatedAt: sql`now()`,
        },
      });
  }
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
