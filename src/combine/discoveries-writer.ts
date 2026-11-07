/**
 * Server-side write path for `combine_discoveries` (T-0195, H3b).
 *
 * Discoveries used to be written by a client-trusted POST to
 * `/api/combine/collection`. That's gone — the server derives them from
 * the replay-validated game state instead. This module is the single
 * writer; `/runs/[id]/checkpoint` and `/runs/[id]/finish` both call it
 * after a successful replay.
 *
 * Shape matches what the old collection route produced, so the GET
 * handler and the client's optimistic UI need no changes:
 *   - Row keyed by (userId, itemId, scope).
 *   - `recipeSignatures` is the union of sorted-ingredient signatures the
 *     player has used to make this item under this scope, capped.
 *   - Existing rows keep their original `firstFoundAt` (preserving the
 *     "first time I saw this" timestamp across re-finds).
 */

import { inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import type { GameState } from "./engine";

/** Max signatures per (user, item, scope). Admin edits could keep
 *  minting variants; capping bounds row size. */
const MAX_SIGS_PER_ITEM = 32;

export type DiscoveryScope = "endless" | "daily";

/** Pick the scope a run writes to. Daily runs are sandboxed (see
 *  CLAUDE.md: daily collection is isolated so endless grinding can't
 *  walk a daily into pre-unlocked items); endless + fast share. */
export function scopeForRun(dailyKey: string | null): DiscoveryScope {
  return dailyKey ? "daily" : "endless";
}

/** Write discoveries for a signed-in user from a replay-validated game
 *  state. Idempotent: calling twice with the same state is a no-op past
 *  the first write (ON CONFLICT merges signatures and keeps timestamps).
 *
 *  Returns the count of rows touched (inserts + merges). Zero for empty
 *  `state.found` or when no ids survive item-existence validation.
 *
 *  `userId` is the Better Auth user id. Call only for signed-in users —
 *  anon runs don't get a progress record either (see
 *  `/runs/[id]/finish`). */
export async function writeDiscoveriesFromState(
  userId: string,
  state: GameState,
): Promise<number> {
  if (state.found.length === 0) return 0;

  const scope = scopeForRun(state.daily);
  const db = getDb();

  // Validate item ids exist. The engine can't invent item ids — it only
  // ships ids that came out of a ThemeBundle built from the live
  // snapshot — but the FK on `combine_discoveries.item_id` is strict
  // and a stale bundle during a content edit could reference a
  // just-deleted item. Filter defensively; a missing id is silently
  // dropped (the player saw it in-run; a later game will re-discover).
  const existing = await db
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(inArray(schema.items.id, state.found));
  const validIds = existing.map((r) => r.id);
  if (validIds.length === 0) return 0;
  const validSet = new Set(validIds);

  const now = new Date();
  const rows = validIds.map((id) => ({
    userId,
    itemId: id,
    scope,
    firstFoundAt: now,
    recipeSignatures: signaturesForItem(state, id),
  }));
  void validSet; // (used implicitly via `validIds`)

  const result = await db
    .insert(schema.combineDiscoveries)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        schema.combineDiscoveries.userId,
        schema.combineDiscoveries.itemId,
        schema.combineDiscoveries.scope,
      ],
      set: {
        // Merge-on-conflict: keep the row's original firstFoundAt
        // (omitted from `set`), union existing signatures with incoming
        // ones, dedupe, cap. Mirrors the retired collection route so
        // the GET handler and client see no shape change.
        recipeSignatures: sql`(
          SELECT COALESCE(array_agg(s), ARRAY[]::text[])
          FROM (
            SELECT DISTINCT s
            FROM unnest(${schema.combineDiscoveries.recipeSignatures} || excluded.recipe_signatures) AS s
            LIMIT ${MAX_SIGS_PER_ITEM}
          ) AS merged
        )`,
      },
    })
    .returning({ itemId: schema.combineDiscoveries.itemId });

  return result.length;
}

/** The sorted-ingredient signatures the player has actually used to make
 *  `itemId` in this run. Empty list = unlocked via a base-ingredient
 *  leak (recorded a find but never combined). Mirrors how the engine
 *  populates `state.howMade`. */
function signaturesForItem(state: GameState, itemId: string): string[] {
  const recipe = state.howMade[itemId];
  if (!recipe || recipe.length === 0) return [];
  return [[...recipe].sort().join("+")];
}
