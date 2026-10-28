/**
 * Load the artifact at legacy/made-of.html into Postgres.
 *
 * Idempotent on a fresh database. Not safe to run against a database that
 * already contains edited content (the round-trip test asserts a clean seed).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parsePrototype } from "../parser/prototype";
import { toRows } from "../parser/load";
import { closeDb, getDb, schema } from "./client";

const HTML_PATH = resolve(process.cwd(), "legacy/made-of.html");

async function main() {
  const html = await readFile(HTML_PATH, "utf8");
  const parsed = parsePrototype(html);
  const rows = toRows(parsed);

  if (rows.stats.unresolvedEvidenceIds.length > 0) {
    throw new Error(
      `Evidence refers to ${rows.stats.unresolvedEvidenceIds.length} unknown link ids. First few: ${rows.stats.unresolvedEvidenceIds.slice(0, 5).join(", ")}`,
    );
  }

  console.log("parsed:", {
    items: rows.stats.items,
    links: rows.stats.links,
    evidencedLinks: rows.stats.evidencedLinks,
    sources: rows.stats.sources,
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
