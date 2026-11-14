import { NextResponse } from "next/server";
import { asc, isNull } from "drizzle-orm";
import { requireAdminApi } from "@/lib/admin";
import { getDb, schema } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/pictograms/missing — export every item with no pictogram
 *  (pictogram IS NULL) as JSON. Each item carries the context an AI needs
 *  to generate a 32×32 inner-markup SVG: name, kind, tier, fact, symbol.
 *
 *  Workflow: feed this file + the pictogram style guide
 *  (/api/admin/bulk/pictogram-style) to an agent, get back a { name: svg }
 *  dict, paste into /admin/pictograms/upload. */
export async function GET() {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const db = getDb();
  const rows = await db
    .select({
      name: schema.items.name,
      tier: schema.items.tier,
      kind: schema.items.kind,
      symbol: schema.items.symbol,
      fact: schema.items.fact,
    })
    .from(schema.items)
    .where(isNull(schema.items.pictogram))
    .orderBy(asc(schema.items.kind), asc(schema.items.name));

  const payload = {
    _readme: {
      purpose:
        "Items in the Made Of knowledge base that have no pictogram SVG set. Each item currently falls back to its kind's default glyph. Generate a 32×32 inner-markup SVG per item.",
      how_to_use: [
        "Fetch the style guide at /api/admin/bulk/pictogram-style for the authoring rules (viewBox, allowlisted elements, classes).",
        "For each item, produce an SVG inner-markup string (no outer <svg> tag).",
        "Return a single JSON object keyed by item name: { \"<name>\": \"<svg-inner>\", ... }.",
        "Paste the result into /admin/pictograms/upload. Keys match on item name first, then kind code; items that already have a pictogram require explicit overwrite.",
      ],
      count: rows.length,
    },
    items: rows,
  };

  const date = new Date().toISOString().slice(0, 10);
  return NextResponse.json(payload, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="made-of-pictograms-missing-${date}.json"`,
    },
  });
}
