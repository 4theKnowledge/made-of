import { NextResponse, type NextRequest } from "next/server";
import { count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { invalidateRunsForTheme } from "@/combine/run-store";
import { bumpCollectionVersion } from "@/combine/theme-version";
import { reloadSnapshot } from "@/graph/live";

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
  // is_published: boolean. Admin flips this when a theme is ready for
  // players. Unpublishing is non-destructive: data stays, picker hides it.
  if ("is_published" in body) {
    if (typeof body.is_published !== "boolean") {
      return NextResponse.json({ error: "invalid_is_published" }, { status: 400 });
    }
    patch.isPublished = body.is_published;
  }
  // pictogram: string (SVG inner markup) or null. 32×32 viewBox, same
  // authoring rules as items/kinds.
  if ("pictogram" in body) {
    const p = body.pictogram;
    if (p === null) patch.pictogram = null;
    else if (typeof p === "string") patch.pictogram = p.trim() || null;
    else return NextResponse.json({ error: "invalid_pictogram" }, { status: 400 });
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
  // Closure config drives the auto-expanded set of theme members. Bump
  // when the key is present — a no-op "same shape" patch is rare enough
  // that comparing old vs new isn't worth the extra read. See T-0217.
  if ("closure_config" in body) {
    await bumpCollectionVersion(db, code);
  }
  await reloadSnapshot();
  const invalidated = await invalidateRunsForTheme(code);
  return NextResponse.json({ theme: updated, invalidatedRuns: invalidated });
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
  await reloadSnapshot();
  const invalidated = await invalidateRunsForTheme(code);
  return NextResponse.json({ ok: true, invalidatedRuns: invalidated });
}
