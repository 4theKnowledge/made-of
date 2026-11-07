/**
 * Anon → user migration for server-authoritative Combine runs (T-0175).
 *
 * When a user signs in for the first time via magic link, Better Auth's
 * user-create hook fires. If the same browser has an anon cookie with
 * active runs, those rows are reassigned to the new user id so the
 * player keeps their mid-run state across the sign-in boundary.
 *
 * Idempotent: a second call with no matching rows is a no-op. Safe to
 * call on every login (not just first) if we ever want to catch
 * returning users with stale anon runs.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

/** Reassign all active `combine_runs` rows from `(owner_kind='anon',
 *  owner_id=anonId)` to `(owner_kind='user', owner_id=userId)`.
 *
 *  If the user already has an active run in the same (mode, dailyKey)
 *  slot, the anon row would violate the partial unique index. In that
 *  case the user's existing run wins and the anon row is marked
 *  `invalidated` so the uniqueness constraint holds.
 *
 *  Returns the number of rows reassigned (not counting invalidated
 *  collisions). */
export async function mergeAnonRuns(
  anonId: string,
  userId: string,
): Promise<{ moved: number; collided: number }> {
  const db = getDb();
  // First pass: collide with any user-side active run in the same slot.
  // We do this before the reassign so the unique index doesn't bark.
  const collided = await db.execute<{ id: string }>(sql`
    UPDATE combine_runs AS anon
    SET status = 'invalidated', ended_at = now(), updated_at = now()
    WHERE anon.owner_kind = 'anon'
      AND anon.owner_id = ${anonId}
      AND anon.status = 'active'
      AND EXISTS (
        SELECT 1 FROM combine_runs AS u
        WHERE u.owner_kind = 'user'
          AND u.owner_id = ${userId}
          AND u.status = 'active'
          AND u.mode = anon.mode
          AND u.daily_key = anon.daily_key
      )
    RETURNING anon.id
  `);
  // Second pass: everything else moves across.
  const moved = await db
    .update(schema.combineRuns)
    .set({ ownerKind: "user", ownerId: userId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.combineRuns.ownerKind, "anon"),
        eq(schema.combineRuns.ownerId, anonId),
      ),
    )
    .returning({ id: schema.combineRuns.id });
  // postgres-js returns an array-like with a `.length` on `execute()`.
  const collidedCount = Array.isArray(collided)
    ? collided.length
    : ((collided as unknown as { length?: number }).length ?? 0);
  return { moved: moved.length, collided: collidedCount };
}
