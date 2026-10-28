import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { isValidCode } from "@/graph/codes";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { everything } from "@/graph/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only endpoint that may return more than one item's neighbourhood.
 * Family plan only. Phase 4 wires up Better Auth + the `entitlements()`
 * function; for phase 2 we gate on a bearer token header so the test can
 * exercise the shape. Anyone without the entitlement sees 402.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  return withRateLimit(
    req,
    limiters.everythingPerUser,
    visitorKey(req),
    async () => {
      if (!isPaid(req)) {
        return NextResponse.json(
          { error: "payment_required" },
          { status: 402 },
        );
      }
      if (!isValidCode(code)) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      const live = await getLiveSnapshot();
      const id = live.itemCodes.toId(code);
      if (!id) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      const r = everything(live.snapshot, id);
      return NextResponse.json({
        items: r.items
          .map((x) => live.itemCodes.toCode(x))
          .filter((c): c is string => Boolean(c)),
      });
    },
  ) as Promise<Response>;
}

/**
 * Phase 2 stand-in for entitlements. Phase 4 replaces this with Better Auth
 * session lookup + the entitlements() function.
 */
function isPaid(req: NextRequest): boolean {
  if (process.env.NODE_ENV !== "production") {
    return req.headers.get("x-dev-entitlement") === "family";
  }
  return false;
}
