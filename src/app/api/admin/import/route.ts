import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi } from "@/lib/admin";
import { runImport, type AdminImportPayload } from "@/lib/admin-import";
import { reloadSnapshot } from "@/graph/live";
import { invalidateAllActiveRuns } from "@/combine/run-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/import?dryRun=1 — replace the DB from a Data* payload.
 *  Body shape: { items, evidenceLinks, sources } (see admin-import.ts). */
export async function POST(req: NextRequest) {
  const guard = await requireAdminApi();
  if (guard) return guard;

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";

  let payload: AdminImportPayload;
  try {
    payload = (await req.json()) as AdminImportPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const result = await runImport(payload, { dryRun });

  if (result.ok && !dryRun) {
    const snap = await reloadSnapshot();
    const invalidatedRuns = await invalidateAllActiveRuns();
    return NextResponse.json({ ...result, snapshotVersion: snap.version, invalidatedRuns });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
