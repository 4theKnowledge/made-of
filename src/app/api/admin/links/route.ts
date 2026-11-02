import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import type { Confidence, LinkType } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LINK_TYPES: LinkType[] = ["f", "w", "n", "s", "e"];
const CONFIDENCES: Confidence[] = ["established", "strong", "debated", "hypothesis"];

/** POST /api/admin/links — create a link.
 *  Body: {
 *    type: LinkType,
 *    targetItemId: string,
 *    recipeId?: string,     // mutually exclusive with itemId
 *    itemId?: string,       // for item-level links (n, s)
 *    confidence?: Confidence,
 *    note?: string | null,
 *    isCanary?: boolean,
 *  }
 *  Returns { link } with the inserted row. */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const type = body.type as LinkType | undefined;
  if (!type || !LINK_TYPES.includes(type)) {
    return NextResponse.json({ error: "invalid_type" }, { status: 400 });
  }
  const targetItemId = typeof body.targetItemId === "string" ? body.targetItemId : null;
  if (!targetItemId) {
    return NextResponse.json({ error: "target_required" }, { status: 400 });
  }

  const recipeId = typeof body.recipeId === "string" ? body.recipeId : null;
  const itemId = typeof body.itemId === "string" ? body.itemId : null;
  if ((recipeId && itemId) || (!recipeId && !itemId)) {
    return NextResponse.json({ error: "exactly_one_scope" }, { status: 400 });
  }

  const confidence = (body.confidence as Confidence | undefined) ?? "established";
  if (!CONFIDENCES.includes(confidence)) {
    return NextResponse.json({ error: "invalid_confidence" }, { status: 400 });
  }

  const note = typeof body.note === "string" ? body.note : null;
  const isCanary = body.isCanary === true;

  const db = getDb();

  // Verify target exists so the FK insert gives us a clean 404 rather than a
  // Postgres error at the user.
  const [target] = await db
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(eq(schema.items.id, targetItemId))
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: "target_not_found" }, { status: 404 });
  }

  if (recipeId) {
    const [recipe] = await db
      .select({ id: schema.recipes.id })
      .from(schema.recipes)
      .where(eq(schema.recipes.id, recipeId))
      .limit(1);
    if (!recipe) {
      return NextResponse.json({ error: "recipe_not_found" }, { status: 404 });
    }
  } else if (itemId) {
    const [item] = await db
      .select({ id: schema.items.id })
      .from(schema.items)
      .where(eq(schema.items.id, itemId))
      .limit(1);
    if (!item) {
      return NextResponse.json({ error: "source_not_found" }, { status: 404 });
    }
  }

  const [inserted] = await db
    .insert(schema.links)
    .values({
      type,
      recipeId,
      itemId,
      targetItemId,
      confidence,
      note,
      isCanary,
    })
    .returning();

  return NextResponse.json({ link: inserted }, { status: 201 });
}
