import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { isValidCode } from "@/graph/codes";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { canMakeNow } from "@/graph/scratch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/scratch/make
 * body: { haveCodes: string[], makeCode: string }
 * returns: {
 *   ok, reason?,
 *   item?: {code, slug, name, tier, kind, symbol, fact, firstAppeared},
 *   won?: boolean
 * }
 *
 * Validates that `makeCode` is actually craftable from the player's `have`
 * set. Returns the item view (with fact for the pop-up) on success.
 */
export async function POST(req: NextRequest) {
  return withRateLimit(req, limiters.scratch, visitorKey(req), async () => {
    const body = (await req.json().catch(() => null)) as
      | { haveCodes?: unknown; makeCode?: unknown; targetCode?: unknown }
      | null;
    if (
      !body ||
      !Array.isArray(body.haveCodes) ||
      typeof body.makeCode !== "string"
    ) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    if (!body.haveCodes.every((c) => typeof c === "string" && isValidCode(c))) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    if (!isValidCode(body.makeCode)) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }

    const live = await getLiveSnapshot();
    const have = new Set<string>(["big-bang"]);
    for (const c of body.haveCodes as string[]) {
      const id = live.itemCodes.toId(c);
      if (id) have.add(id);
    }
    const makeId = live.itemCodes.toId(body.makeCode as string);
    if (!makeId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const node = live.snapshot.nodes.get(makeId);
    if (!node) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (!canMakeNow(node, have)) {
      return NextResponse.json({ ok: false, reason: "not_craftable" });
    }

    const targetCode =
      typeof body.targetCode === "string" && isValidCode(body.targetCode)
        ? body.targetCode
        : null;
    const targetId = targetCode ? live.itemCodes.toId(targetCode) : null;

    const newHave = new Set(have);
    newHave.add(makeId);

    return NextResponse.json({
      ok: true,
      item: {
        code: body.makeCode,
        slug: node.id,
        name: node.name,
        tier: node.tier,
        kind: node.kind,
        symbol: node.symbol,
        fact: node.fact,
        firstAppeared: node.firstAppeared,
      },
      won: targetId ? makeId === targetId : false,
    });
  }) as Promise<Response>;
}
