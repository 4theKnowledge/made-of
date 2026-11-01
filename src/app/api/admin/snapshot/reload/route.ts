import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin";
import { reloadSnapshot } from "@/graph/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/snapshot/reload — manually trigger a snapshot rebuild. */
export async function POST() {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const snap = await reloadSnapshot();
  return NextResponse.json({ snapshotVersion: snap.version });
}
