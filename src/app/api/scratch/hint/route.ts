import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { isValidCode } from "@/graph/codes";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import {
  bestRecipe,
  canMakeNow,
  costs,
  missing,
  recipesOf,
} from "@/graph/scratch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/scratch/hint
 * body: { haveCodes, targetCode }
 * returns: { hint: { code, slug, name } | null }
 *
 * Picks a hint by walking the missing set from the target, following best
 * recipes, until we find a leaf the player can currently make. The hint is
 * the shallowest leaf (closest to a ready item) so the player sees progress.
 */
export async function POST(req: NextRequest) {
  return withRateLimit(req, limiters.scratch, visitorKey(req), async () => {
    const body = (await req.json().catch(() => null)) as
      | { haveCodes?: unknown; targetCode?: unknown }
      | null;
    if (
      !body ||
      !Array.isArray(body.haveCodes) ||
      typeof body.targetCode !== "string"
    ) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    if (!body.haveCodes.every((c) => typeof c === "string" && isValidCode(c))) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    if (!isValidCode(body.targetCode)) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }

    const live = await getLiveSnapshot();
    const have = new Set<string>(["big-bang"]);
    for (const c of body.haveCodes as string[]) {
      const id = live.itemCodes.toId(c);
      if (id) have.add(id);
    }
    const targetId = live.itemCodes.toId(body.targetCode as string);
    if (!targetId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const c = costs(live.snapshot, have);
    const miss = missing(live.snapshot, targetId, have, c);

    // Pick a missing item the player can craft right now; prefer the one
    // closest to ready (fewer sub-requirements remaining).
    let bestHint: string | null = null;
    let bestCost = Infinity;
    for (const id of miss) {
      const n = live.snapshot.nodes.get(id);
      if (!n) continue;
      if (!canMakeNow(n, have)) continue;
      const r = recipesOf(n)[bestRecipe(n, c)];
      const cost = r?.requires.length ?? Infinity;
      if (cost < bestCost) {
        bestCost = cost;
        bestHint = id;
      }
    }

    if (!bestHint) return NextResponse.json({ hint: null });

    const node = live.snapshot.nodes.get(bestHint)!;
    const code = live.itemCodes.toCode(bestHint);
    return NextResponse.json({
      hint: { code, slug: node.id, name: node.name },
    });
  }) as Promise<Response>;
}
