import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import {
  HANDLE_PATTERN,
  isValidHandle,
  randomHandleCandidate,
} from "./handle-words";

export { HANDLE_PATTERN, isValidHandle, randomHandleCandidate };

/**
 * Picks a random adjective-noun handle that no user currently holds. We
 * check the DB per attempt because the pool is finite (~14k combos) and we
 * want to avoid handing a reroll suggestion that will fail at confirm time.
 *
 * The lookup is `lower(handle) = $1` to match the unique index. Returns
 * null in the (practically impossible) case where every random candidate
 * we tried was taken within `maxAttempts`.
 */
export async function suggestAvailableHandle(
  maxAttempts = 10,
): Promise<string | null> {
  const db = getDb();
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = randomHandleCandidate();
    const rows = await db
      .select({ id: schema.authUser.id })
      .from(schema.authUser)
      .where(sql`lower(${schema.authUser.handle}) = ${candidate}`)
      .limit(1);
    if (rows.length === 0) return candidate;
  }
  return null;
}
