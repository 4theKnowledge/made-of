import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { computeClosure, isClosureEnabled, type ClosureConfig } from "@/combine/closure";
import { invalidateRunsForTheme } from "@/combine/run-store";
import { bumpCollectionVersion } from "@/combine/theme-version";
import { reloadSnapshot } from "@/graph/live";
import { loadGraphForClosure } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/combine-themes/[id]/members
 * Body: { add?: string[]; remove?: string[]; applyClosure?: boolean }
 *
 * Bulk add/remove item memberships for one theme in a single transaction.
 * When the theme has a closure_config set and applyClosure !== false,
 * `add` is expanded via the closure before writing. Returns the resulting
 * member id set so the client can reconcile.
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

  const toStringArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? Array.from(new Set((v as unknown[]).filter((x): x is string => typeof x === "string" && x.length > 0)))
      : [];

  const addRaw = toStringArray(body.add);
  const remove = toStringArray(body.remove);
  const applyClosure = body.applyClosure !== false; // default true

  if (addRaw.length === 0 && remove.length === 0) {
    return NextResponse.json({ error: "no_changes" }, { status: 400 });
  }
  const overlap = addRaw.filter((x) => remove.includes(x));
  if (overlap.length) {
    return NextResponse.json(
      { error: "add_remove_overlap", message: `items appear in both add and remove: ${overlap.join(", ")}` },
      { status: 400 },
    );
  }

  const db = getDb();

  const [theme] = await db
    .select({ code: schema.combineThemes.code, closureConfig: schema.combineThemes.closureConfig })
    .from(schema.combineThemes)
    .where(eq(schema.combineThemes.code, themeCode))
    .limit(1);
  if (!theme) return NextResponse.json({ error: "theme_not_found" }, { status: 404 });

  // Compute the effective add set. If the theme has closure enabled and the
  // caller didn't opt out, expand the add set to include every dependency
  // pulled in by the closure. Everything in addRaw is tagged source=manual;
  // everything added by the closure is source=closure.
  const manualAdd = new Set(addRaw);
  const closureAdd = new Set<string>();

  if (
    addRaw.length > 0 &&
    applyClosure &&
    isClosureEnabled(theme.closureConfig as ClosureConfig | null)
  ) {
    const graph = await loadGraphForClosure();
    const existing = await db
      .select({ itemId: schema.itemCombineThemes.itemId })
      .from(schema.itemCombineThemes)
      .where(eq(schema.itemCombineThemes.themeCode, themeCode));
    const removeSet = new Set(remove);
    const seeds = new Set<string>();
    for (const r of existing) if (!removeSet.has(r.itemId)) seeds.add(r.itemId);
    for (const id of addRaw) seeds.add(id);

    const res = computeClosure({
      items: graph.items,
      recipes: graph.recipes,
      seeds,
      config: theme.closureConfig as ClosureConfig,
    });
    const existingSet = new Set(existing.map((r) => r.itemId));
    for (const id of res.members) {
      if (existingSet.has(id) && !removeSet.has(id)) continue; // already in theme
      if (manualAdd.has(id)) continue; // author-added, keep manual
      closureAdd.add(id);
    }
  }

  const add = [...manualAdd, ...closureAdd];
  if (add.length) {
    const known = await db
      .select({ id: schema.items.id })
      .from(schema.items)
      .where(inArray(schema.items.id, add));
    const knownSet = new Set(known.map((k) => k.id));
    const unknown = add.filter((id) => !knownSet.has(id));
    if (unknown.length) {
      return NextResponse.json({ error: "unknown_items", unknown }, { status: 400 });
    }
  }

  await db.transaction(async (tx) => {
    if (remove.length) {
      await tx
        .delete(schema.itemCombineThemes)
        .where(
          and(
            eq(schema.itemCombineThemes.themeCode, themeCode),
            inArray(schema.itemCombineThemes.itemId, remove),
          ),
        );
    }
    // Insert manual items as source=manual; closure items as source=closure.
    // onConflictDoUpdate so re-adding a closure-sourced item via a manual
    // add promotes it (and vice versa — a manual add shouldn't be
    // demoted by a subsequent closure pass).
    const rows = [
      ...[...manualAdd].map((itemId) => ({ itemId, themeCode, source: "manual" })),
      ...[...closureAdd].map((itemId) => ({ itemId, themeCode, source: "closure" })),
    ];
    if (rows.length) {
      // Split by source so closure additions don't demote existing manuals.
      const manualRows = rows.filter((r) => r.source === "manual");
      const closureRows = rows.filter((r) => r.source === "closure");
      if (manualRows.length) {
        await tx
          .insert(schema.itemCombineThemes)
          .values(manualRows)
          .onConflictDoUpdate({
            target: [schema.itemCombineThemes.itemId, schema.itemCombineThemes.themeCode],
            set: { source: "manual" },
          });
      }
      if (closureRows.length) {
        await tx
          .insert(schema.itemCombineThemes)
          .values(closureRows)
          .onConflictDoNothing(); // keep whatever source already there (manual stays manual)
      }
    }
    // Any membership mutation changes the discoverable set. See T-0217.
    const wroteSomething = remove.length > 0 || rows.length > 0;
    if (wroteSomething) {
      await bumpCollectionVersion(tx, themeCode);
    }
  });

  const finalRows = await db
    .select({ itemId: schema.itemCombineThemes.itemId, source: schema.itemCombineThemes.source })
    .from(schema.itemCombineThemes)
    .where(eq(schema.itemCombineThemes.themeCode, themeCode));

  await reloadSnapshot();
  const invalidatedRuns = await invalidateRunsForTheme(themeCode);

  return NextResponse.json({
    members: finalRows.map((r) => r.itemId),
    memberSources: Object.fromEntries(finalRows.map((r) => [r.itemId, r.source])),
    applied: { manual: [...manualAdd], closure: [...closureAdd], remove },
    invalidatedRuns,
  });
}
