import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getLiveSnapshot } from "@/graph/live";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import {
  generatePuzzle,
  shortestPathClosed,
  todayKeyUtc,
} from "@/graph/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/daily/giveup
 * body: { date?: "yyyy-mm-dd" }
 * returns: { steps: [{ code, name, tier, kind, symbol }, ...] }
 *
 * Reveals a shortest path from start to goal, respecting CLOSED. Called only
 * after the user clicks "Show me the way" in the UI.
 */
export async function POST(req: NextRequest) {
  return withRateLimit(req, limiters.dailyMove, visitorKey(req), async () => {
    const body = (await req.json().catch(() => null)) as
      | { date?: string }
      | null;
    const date = body?.date ?? todayKeyUtc();
    const live = await getLiveSnapshot();
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.dailyPuzzles)
      .where(eq(schema.dailyPuzzles.date, date))
      .limit(1);
    const puzzle = row
      ? { startId: row.startItemId, goalId: row.goalItemId }
      : generatePuzzle(live.snapshot, live.closed, date);

    const path = shortestPathClosed(
      live.snapshot,
      live.closed,
      puzzle.startId,
      puzzle.goalId,
    );
    if (!path) return NextResponse.json({ steps: [] });

    const steps = path.map((p) => {
      const node = live.snapshot.nodes.get(p.id)!;
      return {
        code: live.itemCodes.toCode(p.id),
        name: node.name,
        tier: node.tier,
        kind: node.kind,
        symbol: node.symbol,
        edge: p.edge,
      };
    });
    return NextResponse.json({ steps });
  }) as Promise<Response>;
}
