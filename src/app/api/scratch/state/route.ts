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
  parFor,
  recipesOf,
  viewOf,
} from "@/graph/scratch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/scratch/state
 * body: { haveCodes: string[], targetCode: string }
 * returns: {
 *   target: { ...view, par, bestRecipeIndex, recipes[] (slugs+names) },
 *   ready: Array<view>,
 *   missingCount, won
 * }
 *
 * Fully self-contained: the client sends what it holds (as codes), the
 * server answers with everything the UI needs for this turn. No graph ever
 * leaves except the small ready-list for the player's current state.
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

    const have = new Set<string>();
    for (const c of body.haveCodes as string[]) {
      const id = live.itemCodes.toId(c);
      if (id) have.add(id);
    }
    // The big bang is always in `have` — enforce server-side.
    have.add("big-bang");

    const targetId = live.itemCodes.toId(body.targetCode);
    if (!targetId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const targetNode = live.snapshot.nodes.get(targetId);
    if (!targetNode) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const c = costs(live.snapshot, have);
    const miss = missing(live.snapshot, targetId, have, c);
    const won = have.has(targetId);

    // Target card: recipes list with per-input codes.
    const targetView = viewOf(targetNode, body.targetCode as string);
    const targetRecipes = recipesOf(targetNode).map((r) => ({
      id: r.id,
      label: r.label,
      position: r.position,
      requires: r.requires
        .map((slug) => {
          const n = live.snapshot.nodes.get(slug);
          const code = live.itemCodes.toCode(slug);
          if (!n || !code) return null;
          return {
            slug,
            code,
            name: n.name,
            tier: n.tier,
            kind: n.kind,
            symbol: n.symbol,
            have: have.has(slug),
          };
        })
        .filter(
          (x): x is NonNullable<typeof x> => x !== null,
        ),
    }));
    const bestRecipeIndex = bestRecipe(targetNode, c);

    // Ready list: things the player can make now.
    const readyItems: ReturnType<typeof viewOf>[] = [];
    for (const n of live.snapshot.nodes.values()) {
      if (canMakeNow(n, have)) {
        const code = live.itemCodes.toCode(n.id);
        if (code) readyItems.push(viewOf(n, code));
      }
    }

    return NextResponse.json({
      target: targetView,
      targetRecipes,
      bestRecipeIndex,
      par: parFor(live.snapshot, targetId),
      ready: readyItems,
      missing: miss.size,
      won,
    });
  }) as Promise<Response>;
}
