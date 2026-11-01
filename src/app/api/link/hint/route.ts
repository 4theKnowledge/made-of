import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { isValidCode } from "@/graph/codes";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { nextHint } from "@/graph/link";
import { resolvePuzzle, type PuzzleRefBody } from "@/graph/link-puzzle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/link/hint
 * body: { from, date? } | { from, free: { start, goal } }
 * returns: { hint: { code, name, recipeLabel } | null }
 */
export async function POST(req: NextRequest) {
  return withRateLimit(req, limiters.dailyMove, visitorKey(req), async () => {
    const body = (await req.json().catch(() => null)) as
      | ({ from?: string } & PuzzleRefBody)
      | null;
    if (!body?.from || !isValidCode(body.from)) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    const live = await getLiveSnapshot();
    const fromId = live.itemCodes.toId(body.from);
    if (!fromId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const puzzle = await resolvePuzzle(live, body);
    if (!puzzle.ok) {
      return NextResponse.json({ error: puzzle.error }, { status: puzzle.status });
    }

    const hintId = nextHint(live.snapshot, live.closed, fromId, puzzle.goalId);
    if (!hintId) return NextResponse.json({ hint: null });

    const node = live.snapshot.nodes.get(hintId)!;

    // Recipe-context clause: if the hint target is reached via a *non-primary*
    // recipe of the current item, surface the recipe label so the player can
    // find the chip quickly. Mirrors the prototype (around line 2085).
    const fromNode = live.snapshot.nodes.get(fromId)!;
    let recipeLabel: string | null = null;
    if (fromNode.recipes.length > 1) {
      const primaryId = fromNode.recipes[0]?.id ?? null;
      const inPrimary = fromNode.up.some(
        (e) => e.id === hintId && (e.recipeId === primaryId || e.recipeId === null),
      );
      if (!inPrimary) {
        const inOther = fromNode.up.find(
          (e) => e.id === hintId && e.recipeId && e.recipeId !== primaryId,
        );
        if (inOther) {
          const r = fromNode.recipes.find((r) => r.id === inOther.recipeId);
          if (r?.label) recipeLabel = r.label;
        }
      }
    }

    return NextResponse.json({
      hint: {
        code: live.itemCodes.toCode(hintId),
        name: node.name,
        recipeLabel,
      },
    });
  }) as Promise<Response>;
}
