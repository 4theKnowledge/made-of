import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import {
  requireAdminApi,
  assertInvariants,
  invariantResponse,
  isInvariantViolation,
} from "@/lib/admin";
import { parseYear } from "@/data/load";
import { sanitisePictogram } from "@/pictograms/sanitise";
import type { ItemKind, ItemStatus, Tier } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;

  const db = getDb();
  const [item] = await db.select().from(schema.items).where(eq(schema.items.id, id)).limit(1);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [recipes, outLinks, inLinks] = await Promise.all([
    db.select().from(schema.recipes).where(eq(schema.recipes.itemId, id)),
    db.select().from(schema.links).where(eq(schema.links.itemId, id)),
    db.select().from(schema.links).where(eq(schema.links.targetItemId, id)),
  ]);
  const recipeIds = recipes.map((r) => r.id);
  const recipeLinks = recipeIds.length
    ? (await db.select().from(schema.links)).filter((l) => l.recipeId && recipeIds.includes(l.recipeId))
    : [];

  return NextResponse.json({
    item,
    recipes,
    recipeLinks,
    itemLinks: outLinks,
    incomingLinks: inLinks,
  });
}

/** PATCH /api/admin/items/[id] — update core fields.
 *  Body: any subset of { name, tier, kind, firstAppeared, symbol, fact, tags, status, isCanary }. */
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

  const patch: Partial<typeof schema.items.$inferInsert> = { updatedAt: new Date() };
  if (typeof body.name === "string") patch.name = body.name.trim().toLowerCase();
  if (typeof body.tier === "string") patch.tier = body.tier as Tier;
  if (typeof body.kind === "string") patch.kind = body.kind as ItemKind;
  if ("firstAppeared" in body) {
    const fa = body.firstAppeared as string | null;
    patch.firstAppeared = fa && fa.trim() ? fa.trim() : null;
    const parsed = parseYear(patch.firstAppeared);
    patch.firstAppearedYa = parsed ? Math.round(parsed.ya) : null;
  }
  if ("symbol" in body) {
    const s = body.symbol as string | null;
    patch.symbol = s && s.trim() ? s.trim() : null;
  }
  if (typeof body.fact === "string") patch.fact = body.fact;
  if (Array.isArray(body.tags)) patch.tags = body.tags as string[];
  if (typeof body.status === "string") patch.status = body.status as ItemStatus;
  if (typeof body.isCanary === "boolean") patch.isCanary = body.isCanary;
  if (typeof body.isCombineExcluded === "boolean") {
    patch.isCombineExcluded = body.isCombineExcluded;
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

  // Scope the audit: only shape-affecting fields can regress invariants.
  // Editorial fields (fact, pictogram, firstAppeared, symbol, tags, status,
  // isCanary) can't orphan an item or create a dead-end raw, so skip the
  // ~30ms snapshot rebuild for those.
  const needsAudit =
    "tier" in patch ||
    "kind" in patch ||
    "isCombineExcluded" in patch ||
    "name" in patch;

  const db = getDb();
  try {
    let updated: typeof schema.items.$inferSelect | undefined;
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(schema.items)
        .set(patch)
        .where(eq(schema.items.id, id))
        .returning();
      updated = row;
      if (!row) return;
      if (needsAudit) await assertInvariants(tx);
    });
    if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ item: updated });
  } catch (err) {
    if (isInvariantViolation(err)) return invariantResponse(err.audit);
    throw err;
  }
}

/** DELETE /api/admin/items/[id] — only allowed if nothing targets this item. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;

  const db = getDb();
  const incoming = await db
    .select({ id: schema.links.id })
    .from(schema.links)
    .where(eq(schema.links.targetItemId, id))
    .limit(1);
  if (incoming.length) {
    return NextResponse.json(
      { error: "has_incoming_links", message: "Remove inbound links before deleting." },
      { status: 409 },
    );
  }

  try {
    let deleted: typeof schema.items.$inferSelect | undefined;
    await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(schema.items)
        .where(eq(schema.items.id, id))
        .returning();
      deleted = row;
      if (!row) return;
      await assertInvariants(tx);
    });
    if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isInvariantViolation(err)) return invariantResponse(err.audit);
    throw err;
  }
}
