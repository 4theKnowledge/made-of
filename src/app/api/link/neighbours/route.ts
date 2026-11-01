import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { isValidCode } from "@/graph/codes";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { resolvePuzzle, type PuzzleRefBody } from "@/graph/link-puzzle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/link/neighbours
 * body: { at, date? } | { at, free: { start, goal } }
 * returns: { arrived, neighbours }
 *
 * Hydrates the Link UI when the user reloads mid-game or undoes.
 */
export async function POST(req: NextRequest) {
  return withRateLimit(req, limiters.dailyMove, visitorKey(req), async () => {
    const body = (await req.json().catch(() => null)) as
      | ({ at?: string } & PuzzleRefBody)
      | null;
    if (!body?.at || !isValidCode(body.at)) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    const live = await getLiveSnapshot();
    const atId = live.itemCodes.toId(body.at);
    if (!atId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const puzzle = await resolvePuzzle(live, body);
    if (!puzzle.ok) {
      return NextResponse.json({ error: puzzle.error }, { status: puzzle.status });
    }

    const node = live.snapshot.nodes.get(atId)!;
    const neighbours = node.neighbours.map((nbId) => {
      const nb = live.snapshot.nodes.get(nbId)!;
      return {
        code: live.itemCodes.toCode(nbId) ?? "",
        name: nb.name,
        tier: nb.tier,
        kind: nb.kind,
        symbol: nb.symbol,
        closed: live.closed.has(nbId) && nbId !== puzzle.goalId,
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
