import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import type { Confidence } from "@/db/schema";

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

  return NextResponse.json({ link: updated });
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
  const [deleted] = await db.delete(schema.links).where(eq(schema.links.id, id)).returning();
  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
