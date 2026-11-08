import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { fetchManifestPool } from "@/combine/daily-schedule-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin lookup: resolve a `combine_themes.code` to its member items,
 *  returning `{ id, name }` pairs sorted by name. Powers the Manifest
 *  admin UI's pool dropdown + pin typeahead (T-0243).
 *
 *  Live items only — matches the schedule-builder's pool resolution so
 *  what the admin picks lines up with what the solver sees. */
export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const pool = req.nextUrl.searchParams.get("pool") ?? "";
  if (!pool) return NextResponse.json({ error: "missing_pool" }, { status: 400 });
  const db = getDb();
  const memberIds = await fetchManifestPool(pool);
  if (memberIds.length === 0) {
    return NextResponse.json({ pool, items: [] });
  }
  const rows = await db
    .select({ id: schema.items.id, name: schema.items.name })
    .from(schema.items)
    .where(
      and(
        inArray(schema.items.id, memberIds),
        eq(schema.items.status, "live"),
      ),
    );
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ pool, items: rows });
}
