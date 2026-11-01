/**
 * One-shot: assign a random adjective-noun handle to every user whose
 * `handle` column is NULL. New users get a handle via the Better Auth
 * user.create hook (src/lib/auth.ts), so this script only exists for the
 * population that signed up before the feature shipped.
 *
 * Run with:  npx tsx scripts/backfill-handles.ts
 *
 * Idempotent: users who already have a handle are skipped. Assigned handles
 * are left unlocked (handleLockedAt NULL) so each user can still reroll on
 * /account before committing.
 */

import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "../src/db/client";
import { suggestAvailableHandle } from "../src/lib/handle";
import { randomHandleCandidate } from "../src/lib/handle-words";

const PER_USER_ATTEMPTS = 10;

async function assignOne(userId: string): Promise<string | null> {
  const db = getDb();
  for (let i = 0; i < PER_USER_ATTEMPTS; i++) {
    const candidate =
      (await suggestAvailableHandle()) ?? randomHandleCandidate();
    try {
      const updated = await db
        .update(schema.authUser)
        .set({ handle: candidate })
        .where(
          and(
            eq(schema.authUser.id, userId),
            isNull(schema.authUser.handle),
          ),
        )
        .returning({ id: schema.authUser.id });
      // Zero rows means another process (or an earlier retry) already set
      // this user's handle. Treat as success and move on.
      if (updated.length === 0) return null;
      return candidate;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "23505") throw err;
      // Unique-violation: another user grabbed this candidate between our
      // availability check and the UPDATE. Retry with a fresh one.
    }
  }
  return null;
}

async function main() {
  const db = getDb();

  const pending = await db
    .select({ id: schema.authUser.id, email: schema.authUser.email })
    .from(schema.authUser)
    .where(isNull(schema.authUser.handle));

  if (pending.length === 0) {
    console.log("backfill-handles: no users need backfilling");
    return;
  }

  console.log(
    `backfill-handles: assigning handles to ${pending.length} user(s)`,
  );

  let assigned = 0;
  let failed = 0;

  for (const user of pending) {
    try {
      const handle = await assignOne(user.id);
      if (handle) {
        assigned++;
        console.log(`  ${user.email} -> ${handle}`);
      } else {
        // Already had a handle by the time we got there — count as a skip,
        // not a failure.
        console.log(`  ${user.email} (already assigned)`);
      }
    } catch (err) {
      failed++;
      console.error(`  ${user.email} FAILED:`, err);
    }
  }

  console.log(
    `backfill-handles: done. assigned=${assigned} failed=${failed}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
