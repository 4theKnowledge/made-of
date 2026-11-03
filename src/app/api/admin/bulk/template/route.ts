import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin";
import { BULK_UPLOAD_TEMPLATE } from "@/lib/bulk-upload/template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/bulk/template — download a worked example pack. */
export async function GET() {
  const guard = await requireAdminApi();
  if (guard) return guard;
  return NextResponse.json(BULK_UPLOAD_TEMPLATE, {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="made-of-bulk-template.json"`,
    },
  });
}
