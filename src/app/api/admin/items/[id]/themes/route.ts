import { NextResponse, type NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { invalidateRunsForThemes } from "@/combine/run-store";
import { reloadSnapshot } from "@/graph/live";
import { bumpCollectionVersion } from "@/combine/theme-version";
import {
  countUsersAffectedByItemRemoval,
  countUsersCompletedAtVersion,
} from "@/combine/completion-impact";

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
  const force = body.force === true;

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

  // Compute the symmetric-difference of old vs new theme sets so we only
  // bump collection_version for themes that actually gained or lost this
  // item. See T-0217.
  const oldRows = await db
    .select({ themeCode: schema.itemCombineThemes.themeCode })
    .from(schema.itemCombineThemes)
    .where(eq(schema.itemCombineThemes.itemId, id));
  const oldSet = new Set(oldRows.map((r) => r.themeCode));
  const newSet = new Set(themeCodes);
  const removed = [...oldSet].filter((c) => !newSet.has(c));
  const added = [...newSet].filter((c) => !oldSet.has(c));
  const changed = [...removed, ...added];

  // T-0222: friction when the delta affects players. Added themes will bump
  // their collection_version, dropping completed players below 100%.
  // Removed themes orphan this item's discoveries against those themes'
  // collection bars. Bulk-safe: counts completion rows for the affected
  // themes and endless-scope discoveries of this item.
  if (!force && changed.length > 0) {
    const [bumpedThemes] = await Promise.all([
      Promise.all(
        changed.map(async (themeCode) => {
          const [v] = await db
            .select({ v: schema.combineThemes.collectionVersion })
            .from(schema.combineThemes)
            .where(eq(schema.combineThemes.code, themeCode))
            .limit(1);
          return v ? await countUsersCompletedAtVersion(db, themeCode, v.v) : 0;
        }),
      ),
    ]);
    const completedUsers = bumpedThemes.reduce((a, b) => a + b, 0);
    const discoveryUsers = removed.length
      ? await countUsersAffectedByItemRemoval(db, [id])
      : 0;
    if (completedUsers > 0 || discoveryUsers > 0) {
      const bits: string[] = [];
      if (completedUsers > 0) {
        bits.push(
          `${completedUsers} completion${completedUsers === 1 ? "" : "s"} across ${changed.length} theme${changed.length === 1 ? "" : "s"} will drop below 100%`,
        );
      }
      if (discoveryUsers > 0) {
        bits.push(
          `${discoveryUsers} player${discoveryUsers === 1 ? "'s" : "s'"} discoveries reference this item`,
        );
      }
      return NextResponse.json(
        {
          error: "confirm_required",
          reason: "item_theme_change_affects_players",
          completedUsers,
          discoveryUsers,
          message: `${bits.join("; ")}. Pass { force: true } to proceed.`,
        },
        { status: 409 },
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
    for (const themeCode of changed) {
      await bumpCollectionVersion(tx, themeCode);
    }
  });

  let invalidatedRuns = 0;
  if (changed.length > 0) {
    await reloadSnapshot();
    invalidatedRuns = await invalidateRunsForThemes(changed);
  }
  return NextResponse.json({ themes: themeCodes, invalidatedRuns });
}
