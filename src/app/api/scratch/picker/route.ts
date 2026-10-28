import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { difficultyOf, parFor } from "@/graph/scratch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/scratch/picker?difficulty=easy|medium|hard|extra&q=
 * Returns the list of pickable targets (ex-fundamental items with recipes),
 * grouped by difficulty. Used by the From Scratch target picker dialog.
 *
 * This is the one place we return a bulk list of items. We limit it to live,
 * non-canary items with at least one recipe (so the player can actually make
 * them from scratch), restrict the result shape (code, name only, no edges),
 * and rate-limit via the scratch limiter.
 */
export async function GET(req: NextRequest) {
  return withRateLimit(req, limiters.scratch, visitorKey(req), async () => {
    const difficulty = req.nextUrl.searchParams.get("difficulty") ?? "";
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();

    const live = await getLiveSnapshot();
    const results: Array<{
      code: string;
      name: string;
      slug: string;
      tier: string;
      kind: string;
      symbol: string | null;
      difficulty: string;
      par: number;
    }> = [];

    for (const n of live.snapshot.nodes.values()) {
      // Must have at least one real recipe (not just item-level n/s links).
      if (n.recipes.length === 0) continue;
      // Fundamentals aren't picker targets (they're the origin).
      if (n.tier === "F") continue;
      const d = difficultyOf(live.snapshot, n.id);
      if (difficulty && difficulty !== d) continue;
      if (q && !n.name.toLowerCase().includes(q)) continue;
      const code = live.itemCodes.toCode(n.id);
      if (!code) continue;
      results.push({
        code,
        slug: n.id,
        name: n.name,
        tier: n.tier,
        kind: n.kind,
        symbol: n.symbol,
        difficulty: d,
        par: parFor(live.snapshot, n.id),
      });
    }

    results.sort((a, b) => a.par - b.par || a.name.localeCompare(b.name));
    return NextResponse.json({ results });
  }) as Promise<Response>;
}
