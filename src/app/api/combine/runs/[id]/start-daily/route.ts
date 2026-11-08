import { NextResponse, type NextRequest } from "next/server";
import { getRunOwner, serverRunsEnabled } from "@/lib/anon-session";
import { limiters, visitorKey, withRateLimit } from "@/api/rate-limit";
import { markRunStarted } from "@/combine/run-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Mark a daily run as "started" server-side (T-0247).
 *
 * The client calls this when the player taps Start on the manifest-
 * preview sheet. We stamp `startedAt = now()` on the row (idempotent;
 * second call on the same run is a no-op returning the existing row).
 *
 * `/finish` later reads `startedAt` to compute a server-trusted
 * `durationMs` — anti-cheat for the daily leaderboard timing column.
 * Clearing localStorage or reloading no longer lets the player replay
 * the "peek, then commit" exploit: once stamped, the server-side
 * marker stays set for the lifetime of the row.
 *
 * Non-daily runs may call this too; it's a no-op for them (the
 * `startedAt` column isn't read for endless/fast finishes).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!serverRunsEnabled()) {
    return NextResponse.json({ error: "feature off" }, { status: 404 });
  }
  const owner = await getRunOwner({ mint: false });
  if (!owner) {
    return NextResponse.json({ error: "no identity" }, { status: 401 });
  }
  const { id } = await params;
  // Rate-limit shares the combineRun bucket with /checkpoint /finish
  // so a hostile client can't dodge by alternating endpoints.
  const limited = await withRateLimit(
    req,
    limiters.combineRun,
    `${id}:${visitorKey(req)}`,
    () => null,
  );
  if (limited instanceof Response) return limited;

  const row = await markRunStarted(id, owner);
  if (!row) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  return NextResponse.json({
    runId: row.id,
    startedAt: row.startedAt?.toISOString() ?? null,
  });
}
