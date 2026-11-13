import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { getLiveSnapshot } from "@/graph/live";
import { getActiveDaily } from "@/combine/daily-config-db";
import { buildThemeBundle } from "@/combine/data";
import { guestPoolFor } from "@/combine/daily-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Return the active daily's resolved guest pool as `{ id, name }[]`.
 *  Powers the per-day edit modal's guest typeahead. The pool is
 *  determined by the active config's `guestIngredient.minBand` against
 *  the active theme's full bundle — same function the scheduler uses. */
export async function GET() {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const active = await getActiveDaily();
  if (!active) {
    return NextResponse.json({ items: [] });
  }

  const { snapshot } = await getLiveSnapshot();
  const fullBundle = buildThemeBundle(snapshot, active.themeCode);
  const poolIds = guestPoolFor(fullBundle, active.config);
  if (poolIds.length === 0) return NextResponse.json({ items: [] });

  const db = getDb();
  const rows = await db
    .select({ id: schema.items.id, name: schema.items.name })
    .from(schema.items)
    .where(inArray(schema.items.id, poolIds));
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ items: rows });
}
