import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { shortestPathClosed } from "@/graph/link";
import { resolvePuzzle, type PuzzleRefBody } from "@/graph/link-puzzle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/link/giveup
 * body: { date? } | { free: { start, goal } }
 * returns: { steps: [{ code, name, tier, kind, symbol, edge }, ...] }
 */
export async function POST(req: NextRequest) {
  return withRateLimit(req, limiters.dailyMove, visitorKey(req), async () => {
    const body = (await req.json().catch(() => null)) as PuzzleRefBody | null;
    const live = await getLiveSnapshot();
    const puzzle = await resolvePuzzle(live, body);
    if (!puzzle.ok) {
      return NextResponse.json({ error: puzzle.error }, { status: puzzle.status });
    }

    // Allow start/goal through CLOSED so free-play's hub endpoints work.
    const effectiveClosed = new Set(live.closed);
    effectiveClosed.delete(puzzle.startId);
    effectiveClosed.delete(puzzle.goalId);
    const path = shortestPathClosed(
      live.snapshot,
      effectiveClosed,
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
