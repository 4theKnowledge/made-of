import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { isValidCode } from "@/graph/codes";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { getExploreView } from "@/graph/explore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/view/:code
 * Returns the full Bowtie view (focus item, grouped up/down edges, chain
 * from the big bang, ancestor count). Used by:
 *   - Explore: client-side navigation between items without a reload.
 *   - Daily: re-render the bowtie around the new current item after a move.
 *
 * Includes canaries — the Bowtie is an API-driven surface, not a public
 * item page. Item pages at /i/<slug> still filter canaries.
 */
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
    const slug = live.itemCodes.toId(code);
    if (!slug) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const view = await getExploreView(slug, { includeCanary: true });
    if (!view) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(view);
  }) as Promise<Response>;
}
