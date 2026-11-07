import { NextResponse } from "next/server";
import { getRunOwner, serverRunsEnabled } from "@/lib/anon-session";
import { listActiveRuns } from "@/combine/run-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * List every active Combine run for the current owner. The client
 * calls this on mount to hydrate a local resume UI without having to
 * know which (mode, theme, dailyKey) slots might carry state.
 *
 * Returns `{ runs: [] }` when the feature flag is off so the client
 * can fall back to its localStorage path without a branch on 404.
 */
export async function GET() {
  if (!serverRunsEnabled()) {
    return NextResponse.json({ runs: [] });
  }
  // `mint: false` — a GET shouldn't set a cookie on the first visit
  // (that's what POST /start is for). Players who've never written
  // get an empty list, which is the right answer.
  const owner = await getRunOwner({ mint: false });
  if (!owner) {
    return NextResponse.json({ runs: [] });
  }
  const rows = await listActiveRuns(owner);
  return NextResponse.json({
    runs: rows.map((r) => ({
      runId: r.id,
      mode: r.mode,
      theme: r.theme,
      dailyKey: r.dailyKey || null,
      seed: r.seed,
      state: r.stateJson,
      eventCount: r.eventCount,
      epoch: r.epoch,
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}
