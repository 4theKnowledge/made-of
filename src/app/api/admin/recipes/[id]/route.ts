import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import {
  requireAdminApi,
  assertInvariants,
  invariantResponse,
  isInvariantViolation,
} from "@/lib/admin";
import { invalidateRunsForItems } from "@/combine/run-store";
import { reloadSnapshot } from "@/graph/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/admin/recipes/[id] — update label or position.
 *  Position collisions within the same itemId return 409. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: Partial<typeof schema.recipes.$inferInsert> = {};
  if ("label" in body) {
    const label = body.label as string | null;
    patch.label = label && label.trim() ? label.trim() : null;
  }
  if (typeof body.position === "number" && Number.isInteger(body.position) && body.position >= 0) {
    patch.position = body.position;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const db = getDb();
  try {
    const [updated] = await db
      .update(schema.recipes)
      .set(patch)
      .where(eq(schema.recipes.id, id))
      .returning();
    if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
    // Position affects recipe ordering (which recipe is primary). Label
    // is cosmetic — skip invalidation for label-only edits.
    let invalidatedRuns = 0;
    if ("position" in patch) {
      await reloadSnapshot();
      invalidatedRuns = await invalidateRunsForItems([updated.itemId]);
    }
    return NextResponse.json({ recipe: updated, invalidatedRuns });
  } catch (e) {
    // unique_violation on (itemId, position)
    if (e instanceof Error && /unique/i.test(e.message)) {
      return NextResponse.json({ error: "position_conflict" }, { status: 409 });
    }
    throw e;
  }
}

/** DELETE /api/admin/recipes/[id] — removes the recipe and cascades its links. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;

  const db = getDb();
  try {
    let deleted: typeof schema.recipes.$inferSelect | undefined;
    await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(schema.recipes)
        .where(eq(schema.recipes.id, id))
        .returning();
      deleted = row;
      if (!row) return;
      await assertInvariants(tx);
    });
    if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await reloadSnapshot();
    const invalidatedRuns = await invalidateRunsForItems([deleted.itemId]);
    return NextResponse.json({ ok: true, invalidatedRuns });
  } catch (err) {
    if (isInvariantViolation(err)) return invariantResponse(err.audit);
    throw err;
  }
}
