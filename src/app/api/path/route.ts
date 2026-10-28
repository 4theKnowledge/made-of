import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { isValidCode } from "@/graph/codes";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { shortestPath } from "@/graph/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Phase 4 will plug in Better Auth and switch to the per-user daily limit
  // for signed-in users. For now everyone goes through the anon-daily bucket.
  return withRateLimit(
    req,
    limiters.pathAnonDaily,
    visitorKey(req),
    async () => {
      const fromCode = req.nextUrl.searchParams.get("from") ?? "";
      const toCode = req.nextUrl.searchParams.get("to") ?? "";
      if (!isValidCode(fromCode) || !isValidCode(toCode)) {
        return NextResponse.json({ error: "bad_request" }, { status: 400 });
      }
      const live = await getLiveSnapshot();
      const fromId = live.itemCodes.toId(fromCode);
      const toId = live.itemCodes.toId(toCode);
      if (!fromId || !toId) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      const path = shortestPath(live.snapshot, fromId, toId);
      if (!path) {
        return NextResponse.json({ error: "unreachable" }, { status: 404 });
      }
      // Emit codes, not slugs; opaque to clients.
      return NextResponse.json({
        length: path.length - 1,
        steps: path.map((s) => ({
          item: live.itemCodes.toCode(s.id) ?? "",
          edge: s.edge,
        })),
      });
    },
  ) as Promise<Response>;
}
