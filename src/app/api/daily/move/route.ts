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
  bfsOpen,
  generatePuzzle,
  isLegalMove,
  todayKeyUtc,
} from "@/graph/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/daily/move
 * body: { from: itemCode, to: itemCode, date?: "yyyy-mm-dd" }
 * returns: { ok, closed?, done?, delta: "closer"|"same"|"further", neighbourhood }
 *
 * The server checks every move. The answer path never leaves — only the
 * closer/same/further delta leaks out (that's what powers the ▲●▼ squares).
 *
 * We don't trust the client's "from" blindly: it must be a valid item code,
 * but we treat it as declarative. The server does not persist state here —
 * progress lives in `progress` table (phase 4) and localStorage for anon.
 */
export async function POST(req: NextRequest) {
  return withRateLimit(req, limiters.dailyMove, visitorKey(req), async () => {
    const body = (await req.json().catch(() => null)) as
      | { from?: string; to?: string; date?: string }
      | null;
    if (!body?.from || !body?.to) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    if (!isValidCode(body.from) || !isValidCode(body.to)) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }

    const live = await getLiveSnapshot();
    const fromId = live.itemCodes.toId(body.from);
    const toId = live.itemCodes.toId(body.to);
    if (!fromId || !toId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const date = body.date ?? todayKeyUtc();
    const puzzle = await loadOrGeneratePuzzle(live, date);
    if (!puzzle) {
      return NextResponse.json({ error: "no_puzzle" }, { status: 404 });
    }

    // Closed? Reject with a dedicated reason so the client can show the
    // right message ("X is a busy hub, so it's closed in puzzles").
    if (live.closed.has(toId)) {
      return NextResponse.json({
        ok: false,
        reason: "closed",
        name: live.snapshot.nodes.get(toId)?.name ?? toId,
      });
    }
    if (!isLegalMove(live.snapshot, live.closed, fromId, toId)) {
      return NextResponse.json({ ok: false, reason: "not_adjacent" });
    }

    // Delta to the goal — this is the only answer-side bit we leak.
    const distToGoal = bfsOpen(live.snapshot, puzzle.goalId, live.closed);
    const dBefore = distToGoal.get(fromId) ?? Infinity;
    const dAfter = distToGoal.get(toId) ?? Infinity;
    const delta =
      dAfter < dBefore ? "closer" : dAfter === dBefore ? "same" : "further";

    const done = toId === puzzle.goalId;

    // Return the neighbourhood of the arrived-at item so the client can
    // render the next step without a second request.
    const node = live.snapshot.nodes.get(toId)!;
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
      ok: true,
      done,
      delta,
      arrived: {
        code: live.itemCodes.toCode(toId),
        name: node.name,
        tier: node.tier,
        kind: node.kind,
        symbol: node.symbol,
      },
      neighbours,
    });
  }) as Promise<Response>;
}

async function loadOrGeneratePuzzle(
  live: Awaited<ReturnType<typeof getLiveSnapshot>>,
  date: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.dailyPuzzles)
    .where(eq(schema.dailyPuzzles.date, date))
    .limit(1);
  if (row) {
    return {
      startId: row.startItemId,
      goalId: row.goalItemId,
      par: row.par,
    };
  }
  return generatePuzzle(live.snapshot, live.closed, date);
}
