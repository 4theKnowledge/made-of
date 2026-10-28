import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { isValidCode } from "@/graph/codes";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { shapeNeighbourhood } from "@/api/shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  return withRateLimit(req, limiters.items, visitorKey(req), async () => {
    if (!isValidCode(code)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const live = await getLiveSnapshot();
    const id = live.itemCodes.toId(code);
    if (!id) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const node = live.snapshot.nodes.get(id);
    if (!node) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(shapeNeighbourhood(live, node), {
      headers: { "cache-control": "public, max-age=0, s-maxage=120" },
    });
  }) as Promise<Response>;
}
