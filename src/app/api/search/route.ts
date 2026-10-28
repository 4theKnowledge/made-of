import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESULTS = 10;

export async function GET(req: NextRequest) {
  return withRateLimit(req, limiters.search, visitorKey(req), async () => {
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
    if (q.length < 2) return NextResponse.json({ results: [] });

    const live = await getLiveSnapshot();
    const results: Array<{ code: string; name: string }> = [];

    // Pass 1: prefix match on name.
    for (const node of live.snapshot.nodes.values()) {
      if (node.name.toLowerCase().startsWith(q)) {
        const code = live.itemCodes.toCode(node.id);
        if (code) results.push({ code, name: node.name });
        if (results.length >= MAX_RESULTS) break;
      }
    }
    // Pass 2: substring match, excluding already-collected.
    if (results.length < MAX_RESULTS) {
      const have = new Set(results.map((r) => r.name));
      for (const node of live.snapshot.nodes.values()) {
        if (have.has(node.name)) continue;
        if (node.name.toLowerCase().includes(q)) {
          const code = live.itemCodes.toCode(node.id);
          if (code) results.push({ code, name: node.name });
          if (results.length >= MAX_RESULTS) break;
        }
      }
    }

    return NextResponse.json({ results });
  }) as Promise<Response>;
}
