import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { isValidCode } from "@/graph/codes";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { freeplayPar } from "@/graph/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/link/freeplay/start
 * body: { start: itemCode, goal: itemCode }
 * returns: { ok, par, start, goal } | { ok: false, error }
 *
 * Validates a free-play pair before the client starts a game. Rejects:
 * - same start and goal (nothing to solve)
 * - either side unknown
 * - no path exists under the established/strong confidence filter
 *
 * The response contains par and the full item details for both ends, so the
 * client can seed its board without a second round-trip.
 */
export async function POST(req: NextRequest) {
  return withRateLimit(req, limiters.daily, visitorKey(req), async () => {
    const body = (await req.json().catch(() => null)) as
      | { start?: string; goal?: string }
      | null;
    if (!body?.start || !body?.goal) {
      return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    }
    if (!isValidCode(body.start) || !isValidCode(body.goal)) {
      return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    }
    const live = await getLiveSnapshot();
    const startId = live.itemCodes.toId(body.start);
    const goalId = live.itemCodes.toId(body.goal);
    if (!startId || !goalId) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    if (startId === goalId) {
      return NextResponse.json({ ok: false, error: "same_item" }, { status: 422 });
    }
    const par = freeplayPar(live.snapshot, startId, goalId, live.closed);
    if (par === null) {
      return NextResponse.json({ ok: false, error: "no_path" }, { status: 422 });
    }

    const startNode = live.snapshot.nodes.get(startId)!;
    const goalNode = live.snapshot.nodes.get(goalId)!;
    return NextResponse.json({
      ok: true,
      par,
      start: {
        code: live.itemCodes.toCode(startId),
        name: startNode.name,
        tier: startNode.tier,
        kind: startNode.kind,
        symbol: startNode.symbol,
      },
      goal: {
        code: live.itemCodes.toCode(goalId),
        name: goalNode.name,
        tier: goalNode.tier,
        kind: goalNode.kind,
        symbol: goalNode.symbol,
      },
    });
  }) as Promise<Response>;
}
