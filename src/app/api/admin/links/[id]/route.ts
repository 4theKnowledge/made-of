import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import {
  requireAdminApi,
  assertInvariants,
  invariantResponse,
  isInvariantViolation,
} from "@/lib/admin";
import type { Confidence } from "@/db/schema";
import { invalidateRunsForItems } from "@/combine/run-store";
import { reloadSnapshot } from "@/graph/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/admin/links/[id] — update { confidence, note, isCanary }.
 *  The link's shape (type/recipeId/itemId/targetItemId) is immutable here;
 *  create a new link instead of mutating structure. */
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

  const patch: Partial<typeof schema.links.$inferInsert> = {};
  if (typeof body.confidence === "string") patch.confidence = body.confidence as Confidence;
  if ("note" in body) patch.note = (body.note as string | null) ?? null;
  if (typeof body.isCanary === "boolean") patch.isCanary = body.isCanary;

  const db = getDb();
  const [updated] = await db.update(schema.links).set(patch).where(eq(schema.links.id, id)).returning();
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // confidence and note are cosmetic; isCanary gates whether the link enters
  // the bundle so it's structural.
  let invalidatedRuns = 0;
  if ("isCanary" in patch) {
    await reloadSnapshot();
    const itemsTouched = await resolveItemsForLink(updated);
    invalidatedRuns = await invalidateRunsForItems(itemsTouched);
  }
  return NextResponse.json({ link: updated, invalidatedRuns });
}

/** DELETE /api/admin/links/[id] — removes the link and cascades its evidence. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;

  const db = getDb();
  try {
    let deleted: typeof schema.links.$inferSelect | undefined;
    await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(schema.links)
        .where(eq(schema.links.id, id))
        .returning();
      deleted = row;
      if (!row) return;
      await assertInvariants(tx);
    });
    if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await reloadSnapshot();
    const itemsTouched = await resolveItemsForLink(deleted);
    const invalidatedRuns = await invalidateRunsForItems(itemsTouched);
    return NextResponse.json({ ok: true, invalidatedRuns });
  } catch (err) {
    if (isInvariantViolation(err)) return invariantResponse(err.audit);
    throw err;
  }
}

/** Resolve the item ids affected by a link mutation: the target item, the
 *  source item (for item-scoped links), and the recipe's parent item (for
 *  recipe-scoped links). */
async function resolveItemsForLink(link: typeof schema.links.$inferSelect): Promise<string[]> {
  const ids = new Set<string>();
  if (link.targetItemId) ids.add(link.targetItemId);
  if (link.itemId) ids.add(link.itemId);
  if (link.recipeId) {
    const db = getDb();
    const [recipe] = await db
      .select({ itemId: schema.recipes.itemId })
      .from(schema.recipes)
      .where(eq(schema.recipes.id, link.recipeId))
      .limit(1);
    if (recipe) ids.add(recipe.itemId);
  }
  return [...ids];
}
