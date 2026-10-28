import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getLiveSnapshot } from "@/graph/live";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { generatePuzzle, todayKeyUtc } from "@/graph/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withRateLimit(req, limiters.daily, visitorKey(req), async () => {
    const today = todayKeyUtc();
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.dailyPuzzles)
      .where(eq(schema.dailyPuzzles.date, today))
      .limit(1);

    const live = await getLiveSnapshot();
    const puzzle = row
      ? {
          date: row.date,
          startId: row.startItemId,
          goalId: row.goalItemId,
          par: row.par,
          n: 0,
        }
      : generatePuzzle(live.snapshot, live.closed, today);

    const startNode = live.snapshot.nodes.get(puzzle.startId);
    const goalNode = live.snapshot.nodes.get(puzzle.goalId);
    if (!startNode || !goalNode) {
      return NextResponse.json({ error: "no_puzzle" }, { status: 404 });
    }

    // Opaque codes everywhere — never the slug, never the answer.
    return NextResponse.json({
      date: puzzle.date,
      number: puzzle.n,
      start: {
        code: live.itemCodes.toCode(startNode.id),
        name: startNode.name,
        tier: startNode.tier,
        kind: startNode.kind,
        symbol: startNode.symbol,
      },
      goal: {
        code: live.itemCodes.toCode(goalNode.id),
        name: goalNode.name,
        tier: goalNode.tier,
        kind: goalNode.kind,
        symbol: goalNode.symbol,
      },
      par: puzzle.par,
    });
  }) as Promise<Response>;
}
