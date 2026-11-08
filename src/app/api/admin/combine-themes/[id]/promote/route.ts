import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/combine-themes/[id]/promote
 * Body: { itemIds: string[] }
 *
 * Promote one or more existing closure-sourced members to manual, so they
 * stick around even if the author later changes the auto-chain settings.
 * Idempotent — already-manual rows stay manual.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;
  const themeCode = decodeURIComponent(id);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const itemIds: string[] = Array.isArray(body.itemIds)
    ? Array.from(new Set((body.itemIds as unknown[]).filter((x): x is string => typeof x === "string")))
    : [];
  if (itemIds.length === 0) return NextResponse.json({ error: "no_items" }, { status: 400 });

  const db = getDb();
  await db
    .update(schema.itemCombineThemes)
    .set({ source: "manual" })
    .where(
      and(
        eq(schema.itemCombineThemes.themeCode, themeCode),
        inArray(schema.itemCombineThemes.itemId, itemIds),
      ),
    );

  // Promote only flips the `source` provenance (closure→manual). The item
  // stays in the theme either way, so the playable bundle is unchanged.
  return NextResponse.json({ ok: true, promoted: itemIds });
}
