/**
 * Theme collection-version bump helper (T-0217).
 *
 * `combine_themes.collection_version` is a monotonic integer that increments
 * every time the player-facing discoverable set of a theme changes
 * (membership writes or closure_config changes). Completion
 * acknowledgements (`progress` rows with kind='combine-theme-complete')
 * are keyed against the version at which they were acknowledged, so a
 * stale completion stays accurate and a theme that gets expanded reads
 * as "complete through v3; 2 new items since" rather than silently
 * un-completing.
 *
 * Pure label/description/pictogram edits deliberately do NOT bump — they
 * don't change what the player can discover.
 */

import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/db/client";

/** A live db handle or a transaction object produced by `db.transaction`.
 *  Matches the pattern used in `graph/load.ts`. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Pure-function validator for a completion POST. Lets the route handler
 *  focus on IO and makes the branching trivially unit-testable. */
export type CompletionCheck =
  | { ok: true; itemCount: number }
  | { ok: false; reason: "version_mismatch" | "not_complete"; missing?: string[] };

export function validateCompletion(
  collectables: Iterable<string>,
  userDiscoveries: Iterable<string>,
  requestedVersion: number,
  currentVersion: number,
): CompletionCheck {
  if (requestedVersion !== currentVersion) {
    return { ok: false, reason: "version_mismatch" };
  }
  const have = userDiscoveries instanceof Set ? userDiscoveries : new Set(userDiscoveries);
  const need = collectables instanceof Set ? collectables : new Set(collectables);
  const missing: string[] = [];
  for (const id of need) if (!have.has(id)) missing.push(id);
  if (missing.length > 0) {
    return { ok: false, reason: "not_complete", missing };
  }
  return { ok: true, itemCount: need.size };
}

/** Atomically `collection_version = collection_version + 1` for one theme.
 *  Returns the new version, or `null` if the theme code didn't match a row. */
export async function bumpCollectionVersion(
  tx: DbOrTx,
  themeCode: string,
): Promise<number | null> {
  const [row] = await tx
    .update(schema.combineThemes)
    .set({
      collectionVersion: sql`${schema.combineThemes.collectionVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.combineThemes.code, themeCode))
    .returning({ collectionVersion: schema.combineThemes.collectionVersion });
  return row?.collectionVersion ?? null;
}
