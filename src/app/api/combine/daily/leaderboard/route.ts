import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const THEMES = new Set(["everything"] as const);

/**
 * Daily leaderboard for Combine. Returns up to the top 100 players for a
 * given (theme, day). Target-list daily rows sort by
 * `(found DESC, turns ASC, score DESC)` — completions float to the top,
 * partial runs rank below by how much was found, and ties break by score.
 *
 * Each user appears once (their best attempt at the day). No userIds leak
 * — only the public handle is returned.
 *
 * Submissions are auth-only: `/api/combine/runs/[id]/finish` requires a session, so
 * every `progress` row with `kind='combine'` has a real `user_id`. The
 * `INNER JOIN "user"` below makes that guarantee structural — any orphaned
 * row (shouldn't exist but belt-and-suspenders) is silently dropped.
 *
 * GET /api/combine/daily/leaderboard?day=YYYY-MM-DD&theme=everything
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const day = url.searchParams.get("day") ?? "";
  const theme = url.searchParams.get("theme") ?? "everything";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "Invalid day" }, { status: 400 });
  }
  if (!(THEMES as Set<string>).has(theme)) {
    return NextResponse.json({ error: "Invalid theme" }, { status: 400 });
  }

  // `DISTINCT ON (user_id)` pinned to the leaderboard sort keeps each user
  // at their best attempt for the day. The outer ORDER BY applies after the
  // distinct is resolved.
  const rows = await getDb().execute<{
    handle: string | null;
    found: number | null;
    turns: number | null;
    score: number | null;
  }>(sql`
    SELECT handle, found, turns, score FROM (
      SELECT DISTINCT ON (p.user_id)
        u.handle AS handle,
        COALESCE((p.result->>'found')::int, 0) AS found,
        COALESCE((p.result->>'turns')::int, 0) AS turns,
        COALESCE((p.result->>'score')::int, 0) AS score
      FROM progress p
      INNER JOIN "user" u ON u.id = p.user_id
      WHERE p.kind = 'combine'
        AND p.ref = ${theme}
        AND p.result->>'daily' = ${day}
      ORDER BY p.user_id,
               COALESCE((p.result->>'found')::int, 0) DESC,
               COALESCE((p.result->>'turns')::int, 0) ASC,
               COALESCE((p.result->>'score')::int, 0) DESC
    ) best
    ORDER BY best.found DESC, best.turns ASC, best.score DESC
    LIMIT 100
  `);

  const list = (rows as unknown as {
    rows?: Array<{ handle: string | null; found: number; turns: number; score: number }>;
  }).rows
    ?? (rows as unknown as Array<{ handle: string | null; found: number; turns: number; score: number }>);

  return NextResponse.json({
    day,
    theme,
    rows: list.map((r) => ({
      handle: r.handle ?? null,
      found: Number(r.found) || 0,
      turns: Number(r.turns) || 0,
      score: Number(r.score) || 0,
    })),
  });
}
