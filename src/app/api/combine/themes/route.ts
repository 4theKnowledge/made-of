import { NextResponse } from "next/server";
import { asc, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/combine/themes
 *
 * Public list of themes available to the player in Endless/Fast modes.
 * Only published themes are returned (`is_published = TRUE`) and only
 * themes with at least one member item — an empty theme would deal zero
 * tiles.
 *
 * No auth required: this is a browse-time endpoint hit by the picker.
 * Response is small (one row per theme) and safe to cache at the edge.
 */
export async function GET() {
  const db = getDb();
  const rows = await db
    .select({
      code: schema.combineThemes.code,
      label: schema.combineThemes.label,
      description: schema.combineThemes.description,
      pictogram: schema.combineThemes.pictogram,
    })
    .from(schema.combineThemes)
    .where(eq(schema.combineThemes.isPublished, true))
    .orderBy(asc(schema.combineThemes.position), asc(schema.combineThemes.code));

  const counts = await db
    .select({ themeCode: schema.itemCombineThemes.themeCode, n: count() })
    .from(schema.itemCombineThemes)
    .groupBy(schema.itemCombineThemes.themeCode);
  const countByTheme = new Map(counts.map((c) => [c.themeCode, c.n]));

  const themes = rows
    .map((r) => ({
      code: r.code,
      label: r.label,
      description: r.description ?? "",
      pictogram: r.pictogram,
      memberCount: countByTheme.get(r.code) ?? 0,
    }))
    // Skip empty themes — they'd produce a bundle with no tiles to deal.
    .filter((t) => t.memberCount > 0);

  return NextResponse.json({ themes });
}
