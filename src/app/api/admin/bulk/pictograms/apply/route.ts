import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/admin";
import { reloadSnapshot } from "@/graph/live";
import {
  applyPictogramUpload,
  type PictogramPayload,
} from "@/lib/bulk-upload/pictogram-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApplyBody {
  payload: PictogramPayload;
  decisions: Record<string, "insert" | "overwrite" | "skip">;
  dryRun?: boolean;
}

/** POST /api/admin/bulk/pictograms/apply — commit a pictograms-only
 *  upload. Returns applied stats + the new snapshot version. */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  let body: ApplyBody;
  try {
    body = (await req.json()) as ApplyBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.payload || typeof body.payload !== "object") {
    return NextResponse.json({ error: "payload_required" }, { status: 400 });
  }

  const result = await applyPictogramUpload({
    payload: body.payload,
    decisions: body.decisions ?? {},
    dryRun: !!body.dryRun,
  });

  if (result.ok && !result.dryRun) {
    const snap = await reloadSnapshot();
    return NextResponse.json({ ...result, snapshotVersion: snap.version });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
