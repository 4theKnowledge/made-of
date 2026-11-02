import { NextResponse, type NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/recipes — create a recipe for an item.
 *  Body: { itemId: string, label?: string | null, position?: number }.
 *  If position is not provided, we append (max + 1). */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const itemId = typeof body.itemId === "string" ? body.itemId : null;
  if (!itemId) return NextResponse.json({ error: "item_required" }, { status: 400 });

  const db = getDb();
  const [item] = await db
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(eq(schema.items.id, itemId))
    .limit(1);
  if (!item) return NextResponse.json({ error: "item_not_found" }, { status: 404 });

  const label =
    typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;

  let position: number;
  if (typeof body.position === "number" && Number.isInteger(body.position) && body.position >= 0) {
    position = body.position;
  } else {
    const [last] = await db
      .select({ position: schema.recipes.position })
      .from(schema.recipes)
      .where(eq(schema.recipes.itemId, itemId))
      .orderBy(desc(schema.recipes.position))
      .limit(1);
    position = last ? last.position + 1 : 0;
  }

  const [inserted] = await db
    .insert(schema.recipes)
    .values({ itemId, label, position })
    .returning();

  return NextResponse.json({ recipe: inserted }, { status: 201 });
}
