import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/admin";
import { exportAll } from "@/lib/admin-export";
import { buildReadme } from "@/lib/bulk-upload/template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/bulk/snapshot — dump the current live KB in pack format,
 *  so an AI agent authoring a pack has the full list of existing items to
 *  reference and avoid duplicating.
 *
 *  Query params:
 *    - mode=compact          drop `pictogram` on items, drop `evidenceLinks`,
 *                            `sources`, `kinds`. Keeps item/recipe/link shape.
 *    - includeSchema=1       prepend a `_readme` block (vocab + field schema)
 *                            so an agent gets the shape rules alongside the
 *                            data. Works with both modes. */
export async function GET(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const compact = req.nextUrl.searchParams.get("mode") === "compact";
  const includeSchema = req.nextUrl.searchParams.get("includeSchema") === "1";
  const payload = await exportAll();

  const trimmed = compact
    ? {
        items: payload.items.map((i) => {
          const copy = { ...i };
          delete copy.pictogram;
          return copy;
        }),
        evidenceLinks: [],
        sources: {},
      }
    : payload;

  const body = includeSchema
    ? {
        _readme: buildReadme(compact ? "snapshot-compact" : "snapshot"),
        ...trimmed,
      }
    : trimmed;

  const date = new Date().toISOString().slice(0, 10);
  const parts = ["made-of-kb-snapshot"];
  if (compact) parts.push("compact");
  if (includeSchema) parts.push("schema");
  parts.push(date);
  const filename = `${parts.join("-")}.json`;

  return NextResponse.json(body, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
