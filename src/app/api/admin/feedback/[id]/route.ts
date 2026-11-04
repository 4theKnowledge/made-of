import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(schema.feedbackStatusEnum.enumValues);

/** PATCH /api/admin/feedback/[id] — flip status, write an admin note. */
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

  const patch: Partial<typeof schema.feedback.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (typeof body.status === "string") {
    if (!STATUSES.has(body.status as schema.FeedbackStatus)) {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }
    patch.status = body.status as schema.FeedbackStatus;
  }

  if ("adminNote" in body) {
    if (body.adminNote === null) {
      patch.adminNote = null;
    } else if (typeof body.adminNote === "string") {
      const trimmed = body.adminNote.trim();
      patch.adminNote = trimmed ? trimmed.slice(0, 4000) : null;
    }
  }

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const db = getDb();
  const [updated] = await db
    .update(schema.feedback)
    .set(patch)
    .where(eq(schema.feedback.id, id))
    .returning();
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ entry: updated });
}

/** DELETE /api/admin/feedback/[id] — hard-delete (dismiss works for soft). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;
  const db = getDb();
  const [deleted] = await db
    .delete(schema.feedback)
    .where(eq(schema.feedback.id, id))
    .returning();
  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
