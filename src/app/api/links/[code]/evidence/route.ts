import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import { isValidCode } from "@/graph/codes";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { loadLinkEvidence } from "@/graph/load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  return withRateLimit(req, limiters.evidence, visitorKey(req), async () => {
    if (!isValidCode(code)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const live = await getLiveSnapshot();
    const linkId = live.linkCodes.toId(code);
    if (!linkId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const payload = await loadLinkEvidence(linkId);
    if (!payload) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      evidence: payload.evidence.map((e) => ({
        type: e.type,
        stance: e.stance,
        summary: e.summary,
        sources: e.sources.map((s) => ({
          id: s.id,
          kind: s.kind,
          title: s.title,
          authors: s.authors,
          year: s.year,
          published: s.published,
          url: s.url,
        })),
      })),
    });
  }) as Promise<Response>;
}
