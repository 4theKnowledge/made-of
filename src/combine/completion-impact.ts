/**
 * Admin impact probes for theme mutations (T-0222).
 *
 * Themes are mutable and players carry two kinds of state against them:
 *  1. `combine_discoveries` — per-user per-item unlocks. An item removed
 *     from a theme orphans every user's discovery of it for that theme.
 *  2. `progress` with kind='combine-theme-complete' — per-user completion
 *     stamps at a specific `collection_version`. Admin changes that bump
 *     the version will drop completed players back below 100%.
 *
 * These helpers compute cheap counts the admin API routes surface as 409
 * payloads so the admin UI can confirm before proceeding.
 */

import { and, count, eq, sql } from "drizzle-orm";
import { schema } from "@/db/client";
import type { DbOrTx } from "./theme-version";

/** How many distinct users have any of these items as endless-scope
 *  discoveries. Used before removing items from a theme — those discovery
 *  rows won't be deleted (they're keyed on itemId, not themeCode), but the
 *  items will vanish from the theme's discoverable set. */
export async function countUsersAffectedByItemRemoval(
  tx: DbOrTx,
  itemIds: string[],
): Promise<number> {
  if (itemIds.length === 0) return 0;
  const [row] = await tx
    .select({
      n: sql<number>`count(distinct ${schema.combineDiscoveries.userId})::int`,
    })
    .from(schema.combineDiscoveries)
    .where(
      and(
        eq(schema.combineDiscoveries.scope, "endless"),
        sql`${schema.combineDiscoveries.itemId} = ANY(${itemIds})`,
      ),
    );
  return row?.n ?? 0;
}

/** How many users have a completion row for this theme at the given
 *  collection_version. Used before mutations that would bump the version —
 *  these players will drop below 100% and see the "N new" banner. */
export async function countUsersCompletedAtVersion(
  tx: DbOrTx,
  themeCode: string,
  version: number,
): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(schema.progress)
    .where(
      and(
        eq(schema.progress.kind, "combine-theme-complete"),
        eq(schema.progress.ref, themeCode),
        sql`(${schema.progress.result}->>'version')::int = ${version}`,
      ),
    );
  return row?.n ?? 0;
}

/** How many completion rows (across all versions) reference this theme.
 *  Used to block theme deletion — orphaning historical completion stamps
 *  would silently rewrite player stats, so it's strict rather than
 *  confirm-to-override. */
export async function countCompletionRowsForTheme(
  tx: DbOrTx,
  themeCode: string,
): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(schema.progress)
    .where(
      and(
        eq(schema.progress.kind, "combine-theme-complete"),
        eq(schema.progress.ref, themeCode),
      ),
    );
  return row?.n ?? 0;
}
