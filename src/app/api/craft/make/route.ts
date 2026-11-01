import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { isValidCode } from "@/graph/codes";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { canMakeNow } from "@/graph/craft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/craft/make
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
    const have = new Set<string>();
    const bigBang = live.snapshot.bySlug.get("big-bang");
    if (bigBang) have.add(bigBang.id);
    for (const c of body.haveCodes as string[]) {
      const n = live.nodeByCode(c);
      if (n) have.add(n.id);
    }
    const node = live.nodeByCode(body.makeCode as string);
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
    const targetNode = targetCode ? live.nodeByCode(targetCode) : null;

    return NextResponse.json({
      ok: true,
      item: {
        code: body.makeCode,
        slug: node.slug,
        name: node.name,
        tier: node.tier,
        kind: node.kind,
        symbol: node.symbol,
        fact: node.fact,
        firstAppeared: node.firstAppeared,
      },
      won: targetNode ? node.id === targetNode.id : false,
    });
  }) as Promise<Response>;
}
