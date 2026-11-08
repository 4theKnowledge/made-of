import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/admin";
import { applyBulk } from "@/lib/bulk-upload/apply";
import { reloadSnapshot } from "@/graph/live";
import { invalidateAllActiveRuns } from "@/combine/run-store";
import type { BulkPack, ItemDecision } from "@/lib/bulk-upload/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ApplyBody {
  pack: BulkPack;
  decisions: Record<string, ItemDecision>;
  dryRun?: boolean;
}

/** POST /api/admin/bulk/apply — commit a planned bulk upload. */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  let body: ApplyBody;
  try {
    body = (await req.json()) as ApplyBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.pack || typeof body.pack !== "object") {
    return NextResponse.json({ error: "pack_required" }, { status: 400 });
  }
  if (!body.decisions || typeof body.decisions !== "object") {
    return NextResponse.json({ error: "decisions_required" }, { status: 400 });
  }

  const result = await applyBulk({
    pack: body.pack,
    decisions: body.decisions,
    dryRun: !!body.dryRun,
  });

  if (result.ok && !result.dryRun) {
    const snap = await reloadSnapshot();
    const invalidatedRuns = await invalidateAllActiveRuns();
    return NextResponse.json({ ...result, snapshotVersion: snap.version, invalidatedRuns });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
