import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin";
import { exportAll } from "@/lib/admin-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/export — dump the DB as a `Data*`-shape JSON. */
export async function GET() {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const payload = await exportAll();
  return NextResponse.json(payload, {
    headers: {
      "content-disposition": `attachment; filename=\"made-of-export-${new Date().toISOString().slice(0, 10)}.json\"`,
    },
  });
}
