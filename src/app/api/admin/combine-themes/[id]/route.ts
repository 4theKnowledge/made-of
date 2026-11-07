import { NextResponse, type NextRequest } from "next/server";
import { count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const patch: Partial<typeof schema.combineThemes.$inferInsert> = { updatedAt: new Date() };
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
  // closure_config: object | null. See src/combine/closure.ts ClosureConfig.
  if ("closure_config" in body) {
    const c = body.closure_config;
    if (c === null) {
      patch.closureConfig = null;
    } else if (typeof c === "object" && c !== null && !Array.isArray(c)) {
      patch.closureConfig = c;
    } else {
      return NextResponse.json({ error: "invalid_closure_config" }, { status: 400 });
    }
  }
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const db = getDb();
  const [updated] = await db
    .update(schema.combineThemes)
    .set(patch)
    .where(eq(schema.combineThemes.code, code))
    .returning();
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ theme: updated });
}

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
    .from(schema.itemCombineThemes)
    .where(eq(schema.itemCombineThemes.themeCode, code));
  if (usage && usage.n > 0) {
    return NextResponse.json(
      { error: "in_use", message: `${usage.n} item(s) are still in this theme. Remove them first.` },
      { status: 409 },
    );
  }

  const [deleted] = await db
    .delete(schema.combineThemes)
    .where(eq(schema.combineThemes.code, code))
    .returning();
  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
