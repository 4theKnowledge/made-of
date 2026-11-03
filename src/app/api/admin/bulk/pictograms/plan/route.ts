import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/admin";
import {
  planPictogramUpload,
  type PictogramPayload,
} from "@/lib/bulk-upload/pictogram-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/bulk/pictograms/plan — classify a pictogram-only
 *  payload against the current DB. Returns the plan the admin reviews. */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  let payload: PictogramPayload;
  try {
    payload = (await req.json()) as PictogramPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "payload_not_object" }, { status: 400 });
  }

  const plan = await planPictogramUpload(payload);
  return NextResponse.json({ ok: true, plan });
}
