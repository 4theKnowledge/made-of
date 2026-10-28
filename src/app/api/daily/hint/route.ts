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
import {
  generatePuzzle,
  nextHint,
  todayKeyUtc,
} from "@/graph/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/daily/hint
 * body: { from: itemCode, date?: "yyyy-mm-dd" }
 * returns: { hint: { code, name } | null }
 *
 * The hint names the next neighbour the player should pick. Any single hint
 * leaks only one step toward the goal, not the full path.
 */
export async function POST(req: NextRequest) {
  return withRateLimit(req, limiters.dailyMove, visitorKey(req), async () => {
    const body = (await req.json().catch(() => null)) as
      | { from?: string; date?: string }
      | null;
    if (!body?.from || !isValidCode(body.from)) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    const live = await getLiveSnapshot();
    const fromId = live.itemCodes.toId(body.from);
    if (!fromId) {
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

    const hintId = nextHint(live.snapshot, live.closed, fromId, puzzle.goalId);
    if (!hintId) return NextResponse.json({ hint: null });

    const node = live.snapshot.nodes.get(hintId)!;
    return NextResponse.json({
      hint: {
        code: live.itemCodes.toCode(hintId),
        name: node.name,
      },
    });
  }) as Promise<Response>;
}
