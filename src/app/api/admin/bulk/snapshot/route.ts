import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin";
import { exportAll } from "@/lib/admin-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/bulk/snapshot — dump the current live KB in pack format,
 *  so an AI agent authoring a pack has the full list of existing items to
 *  reference and avoid duplicating. */
export async function GET() {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const payload = await exportAll();
  return NextResponse.json(payload, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="made-of-kb-snapshot-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
