/**
 * Load the knowledge base at src/data/*.data.ts into Postgres.
 *
 * Idempotent on a fresh database. Not safe to run against a database that
 * already contains edited content.
 */

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
    // Order matters: parents before children because of foreign keys.
    // Delete first for idempotency on a non-fresh dev DB.
    await tx.delete(schema.evidenceSources);
    await tx.delete(schema.linkEvidence);
    await tx.delete(schema.links);
    await tx.delete(schema.recipes);
    await tx.delete(schema.dailyPuzzles);
    await tx.delete(schema.reports);
    await tx.delete(schema.sources);
    await tx.delete(schema.items);

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

    await bulkInsert(tx, schema.items, rows.items);
    await bulkInsert(tx, schema.sources, rows.sources);
    await bulkInsert(tx, schema.recipes, rows.recipes);
    await bulkInsert(tx, schema.links, rows.links);
    await bulkInsert(tx, schema.linkEvidence, rows.linkEvidence);
    await bulkInsert(tx, schema.evidenceSources, rows.evidenceSources);
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

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
