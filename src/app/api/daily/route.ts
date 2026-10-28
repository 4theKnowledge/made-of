import { NextResponse, type NextRequest } from "next/server";
import { and, eq, lte } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getLiveSnapshot } from "@/graph/live";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withRateLimit(req, limiters.daily, visitorKey(req), async () => {
    const today = isoDateUtc(new Date());
    const db = getDb();
    const [puzzle] = await db
      .select()
      .from(schema.dailyPuzzles)
      .where(and(eq(schema.dailyPuzzles.date, today), lte(schema.dailyPuzzles.date, today)))
      .limit(1);
    if (!puzzle) {
      return NextResponse.json({ error: "no_puzzle" }, { status: 404 });
    }
    const live = await getLiveSnapshot();
    // Only start, goal and par leave the server — the answer path never does.
    return NextResponse.json({
      date: puzzle.date,
      start: live.itemCodes.toCode(puzzle.startItemId) ?? "",
      goal: live.itemCodes.toCode(puzzle.goalItemId) ?? "",
      par: puzzle.par,
      difficulty: puzzle.difficulty,
    });
  }) as Promise<Response>;
}

function isoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}
