import { NextResponse, type NextRequest } from "next/server";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import {
  requireAdminApi,
  assertInvariants,
  invariantResponse,
  isInvariantViolation,
} from "@/lib/admin";
import { invalidateRunsForThemes } from "@/combine/run-store";
import { reloadSnapshot } from "@/graph/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/items/bulk-delete — delete many items at once.
 *
 * Separate from /bulk so a mis-mapped "edit" action can't silently delete
 * anything. Items with incoming links are protected by the FK (ON DELETE
 * RESTRICT); we pre-check so the response reports exactly which ids were
 * blocked rather than erroring on the first offender.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const itemIds = Array.isArray(body.itemIds)
    ? Array.from(new Set((body.itemIds as unknown[]).filter((x): x is string => typeof x === "string")))
    : [];
  if (!itemIds.length) return NextResponse.json({ error: "no_items" }, { status: 400 });

  const db = getDb();

  // Items that still have inbound links can't be deleted (would violate the
  // RESTRICT FK). Also catch items that use kinds in use — but that one is
  // handled by the kinds table, not this route.
  const incoming = await db
    .select({ targetItemId: schema.links.targetItemId })
    .from(schema.links)
    .where(inArray(schema.links.targetItemId, itemIds));
  const blockedByLinks = new Set(incoming.map((r) => r.targetItemId));

  const deletable = itemIds.filter((id) => !blockedByLinks.has(id));

  // Resolve affected themes before the delete so cascaded join rows don't
  // disappear before we can read them.
  const affectedThemes = deletable.length
    ? (
        await db
          .selectDistinct({ themeCode: schema.itemCombineThemes.themeCode })
          .from(schema.itemCombineThemes)
          .where(inArray(schema.itemCombineThemes.itemId, deletable))
      ).map((r) => r.themeCode)
    : [];

  let deletedCount = 0;
  if (deletable.length) {
    try {
      await db.transaction(async (tx) => {
        const deleted = await tx
          .delete(schema.items)
          .where(inArray(schema.items.id, deletable))
          .returning({ id: schema.items.id });
        deletedCount = deleted.length;
        if (deletedCount > 0) await assertInvariants(tx);
      });
    } catch (err) {
      if (isInvariantViolation(err)) return invariantResponse(err.audit);
      throw err;
    }
  }

  let invalidatedRuns = 0;
  if (deletedCount > 0) {
    await reloadSnapshot();
    invalidatedRuns = await invalidateRunsForThemes(affectedThemes);
  }

  return NextResponse.json({
    requested: itemIds.length,
    deleted: deletedCount,
    blocked: Array.from(blockedByLinks),
    invalidatedRuns,
  });
}
