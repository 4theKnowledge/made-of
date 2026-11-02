import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";

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
    return NextResponse.json({ recipe: updated });
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
  const [deleted] = await db
    .delete(schema.recipes)
    .where(eq(schema.recipes.id, id))
    .returning();
  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
