import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { computeClosure, type ClosureConfig } from "@/combine/closure";
import { loadGraphForClosure } from "../../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/combine-themes/[id]/preview-closure
 * Body: {
 *   seeds?: string[];           // defaults to current theme members
 *   extraSeeds?: string[];      // items to be added on top of seeds
 *   config?: ClosureConfig | null; // defaults to the theme's stored config
 * }
 *
 * Returns the closure result WITHOUT writing anything, so the client can
 * preview "if I apply this, N items will be in the theme" before committing.
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

  const db = getDb();
  const [theme] = await db
    .select({ code: schema.combineThemes.code, closureConfig: schema.combineThemes.closureConfig })
    .from(schema.combineThemes)
    .where(eq(schema.combineThemes.code, themeCode))
    .limit(1);
  if (!theme) return NextResponse.json({ error: "theme_not_found" }, { status: 404 });

  const toIds = (v: unknown): string[] =>
    Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : [];

  let seeds: Set<string>;
  if ("seeds" in body) {
    seeds = new Set(toIds(body.seeds));
  } else {
    const existing = await db
      .select({ itemId: schema.itemCombineThemes.itemId })
      .from(schema.itemCombineThemes)
      .where(eq(schema.itemCombineThemes.themeCode, themeCode));
    seeds = new Set(existing.map((r) => r.itemId));
  }
  for (const id of toIds(body.extraSeeds)) seeds.add(id);

  const config: ClosureConfig | null =
    "config" in body
      ? (body.config as ClosureConfig | null)
      : (theme.closureConfig as ClosureConfig | null);

  const graph = await loadGraphForClosure();
  const result = computeClosure({
    items: graph.items,
    recipes: graph.recipes,
    seeds,
    config: config ?? {},
  });

  // Decorate with names + tiers so the UI doesn't need a second lookup.
  const names = await db
    .select({ id: schema.items.id, name: schema.items.name, tier: schema.items.tier })
    .from(schema.items);
  const meta = new Map(names.map((n) => [n.id, { name: n.name, tier: n.tier }]));

  const decorate = (ids: string[]) =>
    ids
      .map((id) => ({ id, name: meta.get(id)?.name ?? id, tier: meta.get(id)?.tier ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    members: decorate([...result.members]),
    added: decorate(result.added),
    stoppedAt: decorate(result.stoppedAt),
    blockedByExcluded: decorate(result.blockedByExcluded),
    counts: {
      total: result.members.size,
      seeds: seeds.size,
      added: result.added.length,
      stoppedAt: result.stoppedAt.length,
      blockedByExcluded: result.blockedByExcluded.length,
    },
  });
}
