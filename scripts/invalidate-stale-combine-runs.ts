/**
 * Predeploy: invalidate every `combine_runs` row whose `engine_version`
 * doesn't match the current `ENGINE_VERSION`.
 *
 * `getActiveRun` / `listActiveRuns` already lazy-invalidate stale rows,
 * but they only fire when the row is read. A proactive sweep at deploy
 * time keeps the active-runs set clean for background jobs, dashboards,
 * and admin tooling — and stops stale rows from quietly accumulating
 * when users never return to play again.
 *
 * Does NOT preserve scores for players mid-run during the bump. That's
 * the finish-route auto-finalize's job (T-0315); if the player comes back
 * and tries to finish a stale run, the server-side rescue writes their
 * progress row from the last-known stored state.
 *
 * Idempotent: a no-op after the first call per deploy. Safe to run
 * concurrently across replicas (two UPDATEs touching the same rows is
 * the same UPDATE), but the typical Railway deploy only runs this once.
 */

import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "../src/db/client";
import { ENGINE_VERSION } from "../src/combine/engine";

async function main(): Promise<void> {
  const db = getDb();
  const rows = await db
    .update(schema.combineRuns)
    .set({
      status: "invalidated",
      endedAt: new Date(),
      updatedAt: new Date(),
      epoch: sql`${schema.combineRuns.epoch} + 1`,
    })
    .where(
      and(
        lt(schema.combineRuns.engineVersion, ENGINE_VERSION),
        eq(schema.combineRuns.status, "active"),
      ),
    )
    .returning({ id: schema.combineRuns.id });
  console.log(
    `[invalidate-stale-combine-runs] current ENGINE_VERSION=${ENGINE_VERSION}, invalidated ${rows.length} active stale run(s)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[invalidate-stale-combine-runs] failed:", err);
    process.exit(1);
  });
