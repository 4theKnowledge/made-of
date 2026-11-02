import { and, eq, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

/**
 * Invite / promo code helpers.
 *
 * The sign-in flow calls `checkInvite()` before firing a magic link for a
 * brand-new email. Existing users (anyone with a row in `authUser`) skip
 * the gate entirely so returning players aren't locked out if we rotate
 * codes. On the first successful sign-in that creates a user we call
 * `redeemInvite()` to atomically bump `uses` and record the redemption.
 *
 * Normalisation: codes are compared case-insensitively and trimmed. The
 * stored form is whatever the admin minted; we don't rewrite it. The
 * primary key is the raw string, so admins should mint lowercase codes
 * to keep things tidy (the UI will suggest this).
 */

export type CodeKind = "invite" | "promo";

export function normalizeCode(input: string): string {
  return input.trim().toLowerCase();
}

export interface CheckResult {
  ok: boolean;
  reason?: "unknown" | "expired" | "spent";
}

/**
 * Validate a code without consuming it. Returns `{ ok: true }` only if the
 * code exists, hasn't expired, and has remaining uses (or no cap).
 */
export async function checkInvite(
  input: string,
  kind: CodeKind = "invite",
): Promise<CheckResult> {
  const code = normalizeCode(input);
  if (!code) return { ok: false, reason: "unknown" };
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.codes)
    .where(and(eq(schema.codes.code, code), eq(schema.codes.kind, kind)))
    .limit(1);
  if (!row) return { ok: false, reason: "unknown" };
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (row.maxUses != null && row.uses >= row.maxUses) {
    return { ok: false, reason: "spent" };
  }
  return { ok: true };
}

/**
 * Atomically consume one use of a code for `userId`. Idempotent for the
 * same (code, user) pair — redeeming twice is a no-op. Returns false if
 * the code is unknown, expired, or already fully consumed.
 */
export async function redeemInvite(
  input: string,
  userId: string,
  kind: CodeKind = "invite",
): Promise<boolean> {
  const code = normalizeCode(input);
  if (!code) return false;
  const db = getDb();
  // One statement: bump `uses` iff the code is still redeemable. Returns
  // the row on success, nothing on failure. This closes the race between
  // two near-simultaneous redemptions sharing the last slot.
  const [row] = await db
    .update(schema.codes)
    .set({ uses: sql`${schema.codes.uses} + 1` })
    .where(
      and(
        eq(schema.codes.code, code),
        eq(schema.codes.kind, kind),
        or(
          isNull(schema.codes.maxUses),
          sql`${schema.codes.uses} < ${schema.codes.maxUses}`,
        ),
        or(
          isNull(schema.codes.expiresAt),
          sql`${schema.codes.expiresAt} > now()`,
        ),
      ),
    )
    .returning();
  if (!row) return false;
  // Record who redeemed it. onConflictDoNothing handles the idempotent
  // case; the `uses++` above would still fire for a second redemption by
  // the same user, so compensate with a decrement when the insert is a
  // no-op. In practice this only runs if a user re-triggers the sign-up
  // flow after already redeeming.
  const inserted = await db
    .insert(schema.codeRedemptions)
    .values({ code, userId })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    await db
      .update(schema.codes)
      .set({ uses: sql`${schema.codes.uses} - 1` })
      .where(eq(schema.codes.code, code));
  }
  return true;
}
