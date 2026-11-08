#!/usr/bin/env tsx
/**
 * T-0240: wipe pre-manifest Combine state.
 *
 * Deletes every daily payload (they're `version: 1` with `targetDiscoveries`;
 * the new shape requires `manifest`) and every combine progress row (they
 * reference `result.target` / `result.found` under the old leaderboard
 * schema). Also invalidates every in-flight `combine_runs` so clients
 * reconcile cleanly on next checkpoint under ENGINE_VERSION 3.
 *
 * Playtester approval: only two prod players; wipe was explicitly
 * authorised. Does NOT touch:
 *   - combine_discoveries (lifetime collections — those still make sense)
 *   - combine_themes / item_combine_themes (admin-curated content)
 *   - user / session / account / auth state
 *
 * Run (local or against DATABASE_URL):
 *   npx tsx scripts/wipe-combine-for-manifest.ts
 */

import { getDb, schema } from "../src/db/client";
import { eq, sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  console.log("[wipe] combine_dailies …");
  await db.execute(sql`TRUNCATE TABLE ${schema.combineDailies}`);
  console.log("[wipe] progress WHERE kind='combine' …");
  const prog = await db
    .delete(schema.progress)
    .where(eq(schema.progress.kind, "combine"))
    .returning({ id: schema.progress.id });
  console.log(`[wipe]   deleted ${prog.length} combine progress rows`);
  console.log("[wipe] combine_runs (invalidate active) …");
  const runs = await db
    .update(schema.combineRuns)
    .set({
      status: "invalidated",
      endedAt: new Date(),
      updatedAt: new Date(),
      epoch: sql`${schema.combineRuns.epoch} + 1`,
    })
    .where(eq(schema.combineRuns.status, "active"))
    .returning({ id: schema.combineRuns.id });
  console.log(`[wipe]   invalidated ${runs.length} active combine runs`);
  console.log("[wipe] done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
