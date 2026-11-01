/**
 * Seed-if-stale: runs the seed script on three triggers.
 *
 *   1. The items table is empty (first boot).
 *   2. No row carries any tag (the deploy predates the tag migration).
 *   3. Any of the five non-physical items are still present (the deploy
 *      predates the data module which filters them out at parse time).
 *
 * Any of those conditions means the DB has drifted from the source of
 * truth at src/data/items.data.ts and the game won't behave right — in
 * particular, the Combine Everyday bundle depends on the combine-everyday
 * tag being present on items, and will produce a blank board + empty tray
 * if no item carries it.
 *
 * The seed itself is idempotent on its own transaction (delete + bulk
 * insert), so running it again is safe.
 */

import { getDb, closeDb, schema } from "@/db/client";
import { inArray, sql } from "drizzle-orm";

/** The five items that must never appear in the DB (dropped at parse time
 *  in src/data/load.ts). If they're there, the DB predates the data
 *  module. */
const NONPHYSICAL = [
  "sunlight",
  "lightning",
  "electricity",
  "internet",
  "fire",
];

async function needsReseed(): Promise<string | null> {
  const db = getDb();

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.items);
  if (count === 0) return "items table is empty";

  const [{ tagged }] = await db
    .select({
      tagged: sql<number>`count(*)::int filter (where array_length(tags, 1) > 0)`,
    })
    .from(schema.items);
  if (tagged === 0) {
    return "no items carry any tag — predates the tag migration";
  }

  const nonPhysicalRows = await db
    .select({ name: schema.items.name })
    .from(schema.items)
    .where(inArray(schema.items.name, NONPHYSICAL));
  if (nonPhysicalRows.length > 0) {
    return `found non-physical items (${nonPhysicalRows
      .map((r) => r.name)
      .join(", ")}) — predates the data module`;
  }

  return null;
}

async function main() {
  const reason = await needsReseed();
  await closeDb();
  if (!reason) {
    console.log("seed-if-stale: DB is current, skipping seed.");
    return;
  }
  console.log(`seed-if-stale: ${reason}; running seed...`);
  // Dynamic import so the seed script runs in its own module scope.
  await import("../src/db/seed");
}

main().catch(async (err) => {
  console.error("seed-if-stale failed:", err);
  await closeDb();
  process.exit(1);
});
