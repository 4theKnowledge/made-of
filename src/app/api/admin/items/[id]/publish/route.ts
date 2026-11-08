import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireAdminApi } from "@/lib/admin";
import { reloadSnapshot } from "@/graph/live";
import { invalidateRunsForItems } from "@/combine/run-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin/items/[id]/publish — flip status to 'live' and reload
 *  the in-memory snapshot so the change is visible immediately.
 *
 *  Single-instance only: the reload happens in this process. If replicas are
 *  added later, the reload needs to go through Postgres LISTEN/NOTIFY so
 *  every instance picks it up (see CLAUDE.md). */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi();
  if (guard) return guard;
  const { id } = await params;

  const db = getDb();
  const [updated] = await db
    .update(schema.items)
    .set({ status: "live", updatedAt: new Date() })
    .where(eq(schema.items.id, id))
    .returning();
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const snap = await reloadSnapshot();
  const invalidatedRuns = await invalidateRunsForItems([id]);
  return NextResponse.json({ item: updated, snapshotVersion: snap.version, invalidatedRuns });
}
