import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { getLiveSnapshot } from "@/graph/live";
import { isValidCode } from "@/graph/codes";
import {
  limiters,
  visitorKey,
  withRateLimit,
} from "@/api/rate-limit";
import { canMakeNow, parFor } from "@/graph/craft";
import { getSession } from "@/lib/session";
import { getDb, schema } from "@/db/client";

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
    const won = targetNode ? node.id === targetNode.id : false;

    // Record the solve. Writes are best-effort — if the DB blips, the player
    // still gets their "you won" response. The win itself is server-verified
    // (canMakeNow + target match above), so a persisted row always reflects
    // a legitimate completion. Numeric fields come from the client because the
    // server doesn't track turn count or wall time; we clamp them to defend
    // against hostile values poisoning future stats queries.
    if (won && targetNode) {
      const session = await getSession();
      if (session) {
        const extra = body as {
          moves?: unknown;
          hints?: unknown;
          timeMs?: unknown;
          stars?: unknown;
          points?: unknown;
          badHides?: unknown;
        };
        const par = parFor(live.snapshot, targetNode.id);
        const moves = clampInt(extra.moves, par, 10_000);
        const hints = clampInt(extra.hints, 0, 1_000);
        const timeMs = clampInt(extra.timeMs, 0, 1000 * 60 * 60 * 24);
        const stars = clampInt(extra.stars, 0, 3);
        const badHides = clampInt(extra.badHides, 0, 10_000);
        // Points can go negative if a player racks up penalties beyond the
        // 1000 base; clamp to -10000..1000 so an attacker can't inject a
        // million-point win.
        const points = clampInt(extra.points, -10_000, 1_000);
        try {
          await getDb()
            .insert(schema.progress)
            .values({
              id: randomUUID(),
              userId: session.user.id,
              kind: "craft",
              ref: targetNode.slug,
              result: { moves, par, hints, timeMs, stars, points, badHides },
            });
        } catch (err) {
          console.error("[craft/make] failed to record progress", err);
        }
      }
    }

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
      won,
    });
  }) as Promise<Response>;
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : min;
  return Math.max(min, Math.min(max, n));
}
