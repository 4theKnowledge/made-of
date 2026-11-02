import { NextResponse, type NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/items/[id]/themes — list theme codes this item belongs to. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;

  const db = getDb();
  const rows = await db
    .select({ themeCode: schema.itemCombineThemes.themeCode })
    .from(schema.itemCombineThemes)
    .where(eq(schema.itemCombineThemes.itemId, id));
  return NextResponse.json({ themes: rows.map((r) => r.themeCode) });
}

/** PUT /api/admin/items/[id]/themes — replace the full set.
 *  Body: { themes: string[] } */
export async function PUT(
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
  if (!Array.isArray(body.themes)) {
    return NextResponse.json({ error: "themes_required" }, { status: 400 });
  }
  const themeCodes = Array.from(
    new Set((body.themes as unknown[]).filter((t): t is string => typeof t === "string")),
  );

  const db = getDb();

  // Make sure the item exists.
  const [item] = await db
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(eq(schema.items.id, id))
    .limit(1);
  if (!item) return NextResponse.json({ error: "item_not_found" }, { status: 404 });

  // Validate theme codes against the live set.
  if (themeCodes.length) {
    const known = await db
      .select({ code: schema.combineThemes.code })
      .from(schema.combineThemes)
      .where(inArray(schema.combineThemes.code, themeCodes));
    const knownSet = new Set(known.map((k) => k.code));
    const unknown = themeCodes.filter((c) => !knownSet.has(c));
    if (unknown.length) {
      return NextResponse.json(
        { error: "unknown_themes", unknown },
        { status: 400 },
      );
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.itemCombineThemes).where(eq(schema.itemCombineThemes.itemId, id));
    if (themeCodes.length) {
      await tx
        .insert(schema.itemCombineThemes)
        .values(themeCodes.map((themeCode) => ({ itemId: id, themeCode })));
    }
  });

  return NextResponse.json({ themes: themeCodes });
}
