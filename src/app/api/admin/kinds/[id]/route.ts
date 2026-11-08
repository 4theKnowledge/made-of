import { NextResponse, type NextRequest } from "next/server";
import { count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { sanitisePictogram } from "@/pictograms/sanitise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/admin/kinds/[id] — update label, description, or position.
 *  code is immutable (would cascade across items.kind; too risky to expose
 *  as a casual rename). To change a code, delete + recreate while no items
 *  reference it. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;
  const code = decodeURIComponent(id);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: Partial<typeof schema.kinds.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.label === "string") {
    const label = body.label.trim();
    if (!label) return NextResponse.json({ error: "label_required" }, { status: 400 });
    patch.label = label;
  }
  if ("description" in body) {
    const d = body.description as string | null;
    patch.description = d && d.trim() ? d.trim() : null;
  }
  if (typeof body.position === "number" && Number.isInteger(body.position) && body.position >= 0) {
    patch.position = body.position;
  }
  if ("pictogram" in body) {
    const raw = body.pictogram as string | null;
    if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
      patch.pictogram = null;
    } else if (typeof raw === "string") {
      const result = sanitisePictogram(raw);
      if (!result.ok) {
        return NextResponse.json(
          { error: "bad_pictogram", details: result.errors },
          { status: 400 },
        );
      }
      patch.pictogram = result.value;
    }
  }

  // {updatedAt} alone shouldn't be a valid patch.
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const db = getDb();
  const [updated] = await db
    .update(schema.kinds)
    .set(patch)
    .where(eq(schema.kinds.code, code))
    .returning();
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Kind PATCH only accepts cosmetic fields (label, description, position,
  // pictogram) — none affect which items are playable. No invalidation.
  return NextResponse.json({ kind: updated });
}

/** DELETE /api/admin/kinds/[id] — refused if any item still uses the code. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;
  const code = decodeURIComponent(id);

  const db = getDb();
  const [usage] = await db
    .select({ n: count() })
    .from(schema.items)
    .where(eq(schema.items.kind, code));
  if (usage && usage.n > 0) {
    return NextResponse.json(
      { error: "in_use", message: `${usage.n} item(s) still use this kind. Retag them first.` },
      { status: 409 },
    );
  }

  const [deleted] = await db
    .delete(schema.kinds)
    .where(eq(schema.kinds.code, code))
    .returning();
  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
