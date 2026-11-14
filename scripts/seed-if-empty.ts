/**
 * Seed-if-empty: runs `src/db/seed.ts` only when the `items` table is
 * empty. On a database that already has content (which is every deploy
 * past the initial boot), this is a no-op.
 *
 * Why so minimal: prod has data. Any re-seeding on a populated DB
 * overwrites admin edits (pictograms, tags) because the seed upserts
 * from `items.data.ts` where those columns are unset. An empty-table
 * check is the only one that still means "we need to materialise the
 * KB from source" — the previous tag/non-physical checks were about
 * historical data migrations that have long since finished.
 *
 * If you ever need to force a reseed, run `npm run db:seed` manually
 * (or via a Railway one-off container).
 */

import { getDb, closeDb, schema } from "@/db/client";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.items);
  await closeDb();

  if (count > 0) {
    console.log(`seed-if-empty: items table has ${count} rows, skipping seed.`);
    return;
  }

  console.log("seed-if-empty: items table is empty; running seed...");
  // Dynamic import so the seed script runs in its own module scope.
  await import("../src/db/seed");
}

main().catch(async (err) => {
  console.error("seed-if-empty failed:", err);
  await closeDb();
  process.exit(1);
});
