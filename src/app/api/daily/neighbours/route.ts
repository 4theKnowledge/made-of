import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getLiveSnapshot } from "@/graph/live";
import { isValidCode } from "@/graph/codes";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { generatePuzzle, todayKeyUtc } from "@/graph/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/daily/neighbours
 * body: { at: itemCode, date?: "yyyy-mm-dd" }
 * returns: { arrived, neighbours }
 *
 * Hydrates the Daily UI when the user reloads mid-game or undoes. Does not
 * reveal distance — if you want the delta, you must take a move.
 */
export async function POST(req: NextRequest) {
  return withRateLimit(req, limiters.dailyMove, visitorKey(req), async () => {
    const body = (await req.json().catch(() => null)) as
      | { at?: string; date?: string }
      | null;
    if (!body?.at || !isValidCode(body.at)) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    const live = await getLiveSnapshot();
    const atId = live.itemCodes.toId(body.at);
    if (!atId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const date = body.date ?? todayKeyUtc();
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.dailyPuzzles)
      .where(eq(schema.dailyPuzzles.date, date))
      .limit(1);
    const puzzle = row
      ? { goalId: row.goalItemId }
      : generatePuzzle(live.snapshot, live.closed, date);

    const node = live.snapshot.nodes.get(atId)!;
    const neighbours = node.neighbours.map((nbId) => {
      const nb = live.snapshot.nodes.get(nbId)!;
      return {
        code: live.itemCodes.toCode(nbId) ?? "",
        name: nb.name,
        tier: nb.tier,
        kind: nb.kind,
        symbol: nb.symbol,
        closed: live.closed.has(nbId),
        isGoal: nbId === puzzle.goalId,
      };
    });

    return NextResponse.json({
      arrived: {
        code: live.itemCodes.toCode(atId),
        name: node.name,
        tier: node.tier,
        kind: node.kind,
        symbol: node.symbol,
      },
      neighbours,
    });
  }) as Promise<Response>;
}
