import { NextResponse, type NextRequest } from "next/server";
import { and, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import type { ItemStatus } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: ItemStatus[] = ["draft", "review", "live"];

/**
 * POST /api/admin/items/bulk — apply a patch to many items at once.
 *
 * Body: {
 *   itemIds: string[],
 *   patch: {
 *     status?: ItemStatus,
 *     isCanary?: boolean,
 *     addTags?: string[],
 *     removeTags?: string[],
 *     setThemes?: { add?: string[], remove?: string[] },
 *   },
 * }
 *
 * All operations happen in one transaction. Response reports updated count
 * per field so the client can decide whether to toast / reload.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const itemIds = Array.isArray(body.itemIds)
    ? Array.from(new Set((body.itemIds as unknown[]).filter((x): x is string => typeof x === "string")))
    : [];
  if (!itemIds.length) {
    return NextResponse.json({ error: "no_items" }, { status: 400 });
  }

  const patch = (body.patch ?? {}) as Record<string, unknown>;

  const status = typeof patch.status === "string" ? (patch.status as ItemStatus) : undefined;
  if (status && !STATUSES.includes(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const isCanary = typeof patch.isCanary === "boolean" ? patch.isCanary : undefined;

  const addTags = Array.isArray(patch.addTags)
    ? Array.from(new Set((patch.addTags as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0)))
    : [];
  const removeTags = Array.isArray(patch.removeTags)
    ? Array.from(new Set((patch.removeTags as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0)))
    : [];

  const themesOp = patch.setThemes as { add?: unknown; remove?: unknown } | undefined;
  const themeAdd = themesOp && Array.isArray(themesOp.add)
    ? Array.from(new Set((themesOp.add as unknown[]).filter((x): x is string => typeof x === "string")))
    : [];
  const themeRemove = themesOp && Array.isArray(themesOp.remove)
    ? Array.from(new Set((themesOp.remove as unknown[]).filter((x): x is string => typeof x === "string")))
    : [];

  const db = getDb();

  // Verify every id exists so the client gets a clear 404 count rather than
  // silent no-ops.
  const existing = await db
    .select({ id: schema.items.id })
    .from(schema.items)
    .where(inArray(schema.items.id, itemIds));
  const existingSet = new Set(existing.map((r) => r.id));
  const missing = itemIds.filter((id) => !existingSet.has(id));
  if (missing.length === itemIds.length) {
    return NextResponse.json({ error: "no_matching_items", missing }, { status: 404 });
  }
  const presentIds = itemIds.filter((id) => existingSet.has(id));

  // Validate theme codes once up front.
  if (themeAdd.length) {
    const known = await db
      .select({ code: schema.combineThemes.code })
      .from(schema.combineThemes)
      .where(inArray(schema.combineThemes.code, themeAdd));
    const knownSet = new Set(known.map((k) => k.code));
    const unknown = themeAdd.filter((c) => !knownSet.has(c));
    if (unknown.length) {
      return NextResponse.json({ error: "unknown_themes", unknown }, { status: 400 });
    }
  }

  const result = {
    requested: itemIds.length,
    matched: presentIds.length,
    missing,
    updatedFields: {
      status: 0,
      isCanary: 0,
      tags: 0,
      themesAdded: 0,
      themesRemoved: 0,
    },
  };

  await db.transaction(async (tx) => {
    // Core field patch.
    const coreUpdate: Partial<typeof schema.items.$inferInsert> = { updatedAt: new Date() };
    if (status) coreUpdate.status = status;
    if (typeof isCanary === "boolean") coreUpdate.isCanary = isCanary;
    const hasCore = Object.keys(coreUpdate).length > 1;
    if (hasCore) {
      const updated = await tx
        .update(schema.items)
        .set(coreUpdate)
        .where(inArray(schema.items.id, presentIds))
        .returning({ id: schema.items.id });
      if (status) result.updatedFields.status = updated.length;
      if (typeof isCanary === "boolean") result.updatedFields.isCanary = updated.length;
    }

    // Tag add/remove using Postgres array operators. Both deduplicate and
    // handle the empty-array case so a bulk strip can't produce NULL.
    if (addTags.length) {
      const updated = await tx
        .update(schema.items)
        .set({
          tags: sql`
            (SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::text[])
             FROM unnest(array_cat(${schema.items.tags}, ${addTags})) AS x)
          `,
          updatedAt: new Date(),
        })
        .where(inArray(schema.items.id, presentIds))
        .returning({ id: schema.items.id });
      result.updatedFields.tags += updated.length;
    }
    if (removeTags.length) {
      const updated = await tx
        .update(schema.items)
        .set({
          tags: sql`
            (SELECT COALESCE(array_agg(x), ARRAY[]::text[])
             FROM unnest(${schema.items.tags}) AS x
             WHERE x <> ALL(${removeTags}::text[]))
          `,
          updatedAt: new Date(),
        })
        .where(inArray(schema.items.id, presentIds))
        .returning({ id: schema.items.id });
      result.updatedFields.tags += updated.length;
    }

    // Theme add — insert all (itemId, themeCode) combos; ON CONFLICT skip.
    if (themeAdd.length) {
      const values = presentIds.flatMap((itemId) =>
        themeAdd.map((themeCode) => ({ itemId, themeCode })),
      );
      if (values.length) {
        const inserted = await tx
          .insert(schema.itemCombineThemes)
          .values(values)
          .onConflictDoNothing()
          .returning({ itemId: schema.itemCombineThemes.itemId });
        result.updatedFields.themesAdded = inserted.length;
      }
    }

    // Theme remove — delete join rows matching this item + theme set.
    if (themeRemove.length) {
      const deleted = await tx
        .delete(schema.itemCombineThemes)
        .where(
          and(
            inArray(schema.itemCombineThemes.itemId, presentIds),
            inArray(schema.itemCombineThemes.themeCode, themeRemove),
          ),
        )
        .returning({ itemId: schema.itemCombineThemes.itemId });
      result.updatedFields.themesRemoved = deleted.length;
    }
  });

  return NextResponse.json(result);
}
