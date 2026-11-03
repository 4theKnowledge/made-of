import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin";
import { PICTOGRAM_STYLE_GUIDE } from "@/lib/bulk-upload/pictogram-style-guide";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/bulk/pictogram-style — download the pictogram style
 *  guide as markdown. Hand this to an AI with a list of item names. */
export async function GET() {
  const guard = await requireAdminApi();
  if (guard) return guard;
  return new NextResponse(PICTOGRAM_STYLE_GUIDE, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="made-of-pictogram-style.md"`,
    },
  });
}
