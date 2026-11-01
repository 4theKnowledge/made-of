import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { isValidCode } from "@/graph/codes";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { bfsOpen, isLegalMove } from "@/graph/link";
import { resolvePuzzle, type PuzzleRefBody } from "@/graph/link-puzzle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/link/move
 * body: { from, to, date? } | { from, to, free: { start, goal } }
 * returns: { ok, closed?, done?, delta, neighbourhood }
 *
 * The server checks every move. The answer path never leaves — only the
 * closer/same/further delta leaks out (that's what powers the ▲●▼ squares).
 */
export async function POST(req: NextRequest) {
  return withRateLimit(req, limiters.dailyMove, visitorKey(req), async () => {
    const body = (await req.json().catch(() => null)) as
      | ({ from?: string; to?: string } & PuzzleRefBody)
      | null;
    if (!body?.from || !body?.to) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    if (!isValidCode(body.from) || !isValidCode(body.to)) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }

    const live = await getLiveSnapshot();
    const fromNode = live.nodeByCode(body.from);
    const toNode = live.nodeByCode(body.to);
    if (!fromNode || !toNode) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const fromId = fromNode.id;
    const toId = toNode.id;

    const puzzle = await resolvePuzzle(live, body);
    if (!puzzle.ok) {
      return NextResponse.json({ error: puzzle.error }, { status: puzzle.status });
    }

    if (live.closed.has(toId) && toId !== puzzle.goalId) {
      return NextResponse.json({
        ok: false,
        reason: "closed",
        name: live.snapshot.nodes.get(toId)?.name ?? toId,
      });
    }
    if (!isLegalMove(live.snapshot, live.closed, fromId, toId)) {
      return NextResponse.json({ ok: false, reason: "not_adjacent" });
    }

    // Delta uses the daily CLOSED set so hub nodes stay un-walkable except as
    // endpoints. For free play that lets the player feel closed-hub traps the
    // same way daily does — the only extra freedom is that start/goal
    // themselves may be hubs.
    const effectiveClosed = new Set(live.closed);
    effectiveClosed.delete(puzzle.goalId);
    const distToGoal = bfsOpen(live.snapshot, puzzle.goalId, effectiveClosed);
    const dBefore = distToGoal.get(fromId) ?? Infinity;
    const dAfter = distToGoal.get(toId) ?? Infinity;
    const delta =
      dAfter < dBefore ? "closer" : dAfter === dBefore ? "same" : "further";

    const done = toId === puzzle.goalId;

    const node = live.snapshot.nodes.get(toId)!;
    const neighbours = node.neighbours.map((nbId) => {
      const nb = live.snapshot.nodes.get(nbId)!;
      return {
        code: live.itemCodes.toCode(nb.slug) ?? "",
        name: nb.name,
        tier: nb.tier,
        kind: nb.kind,
        symbol: nb.symbol,
        closed: live.closed.has(nbId) && nbId !== puzzle.goalId,
        isGoal: nbId === puzzle.goalId,
      };
    });

    return NextResponse.json({
      ok: true,
      done,
      delta,
      arrived: {
        code: live.itemCodes.toCode(node.slug),
        name: node.name,
        tier: node.tier,
        kind: node.kind,
        symbol: node.symbol,
      },
      neighbours,
    });
  }) as Promise<Response>;
}
