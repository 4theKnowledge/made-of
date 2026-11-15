/**
 * One-shot: re-key `items.id` to the UUIDv5-from-slug value for every row
 * whose current id doesn't already match.
 *
 * Background: on 2026-11-14 a full reseed cascade-wiped combine_discoveries
 * because 244 prod items still carried pre-UUIDv5 random ids that didn't
 * match the current `itemIdForSlug(slug)` output. The seed's prune step
 * deleted every such row and the cascade did the rest. This script closes
 * that door by walking every item and updating its id (plus every FK
 * child) to the UUIDv5 value, so future reseeds are no-ops.
 *
 * How it works:
 *   1. Find all items where `id != itemIdForSlug(slug)`.
 *   2. Inside one transaction: flip all FKs pointing at items.id to
 *      DEFERRABLE INITIALLY DEFERRED, then update items and every FK
 *      child in bulk via a VALUES mapping. Constraints are checked at
 *      COMMIT, so the transient mismatch between parent and child is fine.
 *   3. Verify afterwards that no items row has a non-v5 id.
 *
 * Usage:
 *   railway ssh --service made-of node dist-scripts/reconcile-uuidv5-item-ids.js            # dry-run
 *   railway ssh --service made-of node dist-scripts/reconcile-uuidv5-item-ids.js --write    # execute
 *
 * Idempotent: once every id is v5, this script is a no-op. Safe to run
 * repeatedly.
 */

import { sql } from "drizzle-orm";
import { closeDb, getDb, schema } from "../src/db/client";
import { itemIdForSlug } from "../src/data/rows";

const DRY_RUN = !process.argv.includes("--write");

// Every FK that references items.id. Keep in sync with the schema; an
// unlisted FK means its child rows won't be updated and the transaction
// will fail at COMMIT (safe — nothing is written).
const ITEM_FK_CHILDREN: ReadonlyArray<{
  table: string;
  column: string;
  constraint: string;
}> = [
  { table: "combine_discoveries", column: "item_id", constraint: "combine_discoveries_item_id_items_id_fk" },
  { table: "daily_puzzles", column: "goal_item_id", constraint: "daily_puzzles_goal_item_id_items_id_fk" },
  { table: "daily_puzzles", column: "start_item_id", constraint: "daily_puzzles_start_item_id_items_id_fk" },
  { table: "item_combine_themes", column: "item_id", constraint: "item_combine_themes_item_id_items_id_fk" },
  { table: "links", column: "item_id", constraint: "links_item_id_items_id_fk" },
  { table: "links", column: "target_item_id", constraint: "links_target_item_id_items_id_fk" },
  { table: "recipes", column: "item_id", constraint: "recipes_item_id_items_id_fk" },
  { table: "reports", column: "item_id", constraint: "reports_item_id_items_id_fk" },
];

async function main(): Promise<void> {
  const db = getDb();
  const prefix = DRY_RUN ? "[dry-run]" : "[write]";

  const allItems = await db
    .select({ id: schema.items.id, slug: schema.items.slug })
    .from(schema.items);
  const remap: Array<{ oldId: string; newId: string; slug: string }> = [];
  for (const it of allItems) {
    const newId = itemIdForSlug(it.slug);
    if (newId !== it.id) remap.push({ oldId: it.id, newId, slug: it.slug });
  }

  console.log(`${prefix} ${allItems.length} items total, ${remap.length} need rekeying.`);
  if (remap.length === 0) {
    console.log(`${prefix} nothing to do.`);
    await closeDb();
    return;
  }

  // Collision check: the derivation is deterministic on a unique slug, so
  // two items should never map to the same target. If they do, that's a
  // data bug worth surfacing, not silently merging rows.
  const existingIds = new Set(allItems.map((it) => it.id));
  const collisions: Array<{ slug: string; newId: string }> = [];
  for (const r of remap) {
    if (existingIds.has(r.newId) && r.newId !== r.oldId) {
      collisions.push({ slug: r.slug, newId: r.newId });
    }
  }
  if (collisions.length > 0) {
    console.error(
      `${prefix} FATAL: ${collisions.length} target ids already belong to another item:`,
    );
    for (const c of collisions.slice(0, 20)) {
      console.error(`  - slug=${c.slug} → newId=${c.newId} (already taken)`);
    }
    process.exit(2);
  }

  if (DRY_RUN) {
    console.log(`${prefix} sample (first 10):`);
    for (const r of remap.slice(0, 10)) {
      console.log(`  - ${r.slug}: ${r.oldId} → ${r.newId}`);
    }
    console.log(`${prefix} re-run with --write to execute.`);
    await closeDb();
    return;
  }

  // Build a VALUES expression so each UPDATE joins old → new in one
  // statement. 244 pairs is well under Postgres' parameter cap.
  const valuesList = remap.map(
    (r) => sql`(${r.oldId}::uuid, ${r.newId}::uuid)`,
  );
  const mapping = sql.join(valuesList, sql`, `);

  await db.transaction(async (tx) => {
    // Defer every item-referencing FK for this transaction. Postgres
    // checks deferred constraints at COMMIT, which is when parent and
    // children are both in their new state.
    for (const fk of ITEM_FK_CHILDREN) {
      await tx.execute(
        sql.raw(
          `ALTER TABLE "${fk.table}" ALTER CONSTRAINT "${fk.constraint}" DEFERRABLE INITIALLY DEFERRED`,
        ),
      );
    }
    await tx.execute(sql`SET CONSTRAINTS ALL DEFERRED`);

    const parent = await tx.execute(sql`
      UPDATE items AS i
      SET id = m.new_id
      FROM (VALUES ${mapping}) AS m(old_id, new_id)
      WHERE i.id = m.old_id
    `);
    console.log(`${prefix} items updated: ${parent.count ?? "?"}`);

    for (const fk of ITEM_FK_CHILDREN) {
      const stmt = sql`
        UPDATE ${sql.identifier(fk.table)} AS c
        SET ${sql.identifier(fk.column)} = m.new_id
        FROM (VALUES ${mapping}) AS m(old_id, new_id)
        WHERE c.${sql.identifier(fk.column)} = m.old_id
      `;
      const res = await tx.execute(stmt);
      console.log(
        `${prefix}   ${fk.table}.${fk.column} updated: ${res.count ?? "?"}`,
      );
    }
  });

  const remaining = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.items)
    .where(
      sql`id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    );
  console.log(`${prefix} verify: ${remaining[0].n} items still non-UUIDv5.`);

  await closeDb();
}

main().catch(async (err) => {
  console.error("reconcile-uuidv5-item-ids failed:", err);
  await closeDb();
  process.exit(1);
});
