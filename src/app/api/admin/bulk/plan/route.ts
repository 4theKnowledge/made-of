import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/admin";
import { buildPlan } from "@/lib/bulk-upload/plan";
import { loadKbIndex } from "@/lib/bulk-upload/load-kb";
import type { BulkPack } from "@/lib/bulk-upload/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/bulk/plan — classify a pack against the current KB.
 *  Returns a Plan (issues, item dispositions with default decisions,
 *  counts). The admin reviews it, flips decisions, then calls /apply. */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  let pack: BulkPack;
  try {
    pack = (await req.json()) as BulkPack;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!pack || typeof pack !== "object") {
    return NextResponse.json({ error: "payload_not_object" }, { status: 400 });
  }
  if (!Array.isArray(pack.items)) {
    return NextResponse.json({ error: "items_not_array" }, { status: 400 });
  }
  if (!Array.isArray(pack.evidenceLinks)) {
    return NextResponse.json({ error: "evidenceLinks_not_array" }, { status: 400 });
  }
  if (!pack.sources || typeof pack.sources !== "object") {
    return NextResponse.json({ error: "sources_not_object" }, { status: 400 });
  }

  const kb = await loadKbIndex();
  const plan = buildPlan(pack, kb);

  return NextResponse.json({ ok: true, plan });
}
