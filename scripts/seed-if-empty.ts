/**
 * Seed-if-empty: runs the Phase 1 seed only when the items table is empty.
 * Safe to run on every deploy as a predeploy command.
 *
 * We check the count via a tiny psql query so this script works even if the
 * schema has drifted (e.g. first boot before migrations ran — the migrate
 * step precedes this in the predeploy chain).
 */

import { getDb, closeDb, schema } from "@/db/client";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.items);
  if (count > 0) {
    console.log(`seed-if-empty: items table has ${count} rows, skipping seed.`);
    await closeDb();
    return;
  }
  console.log("seed-if-empty: items table empty, running seed...");
  await closeDb();
  // Dynamic import so the seed script runs in its own module scope.
  await import("../src/db/seed");
}

main().catch(async (err) => {
  console.error("seed-if-empty failed:", err);
  await closeDb();
  process.exit(1);
});
