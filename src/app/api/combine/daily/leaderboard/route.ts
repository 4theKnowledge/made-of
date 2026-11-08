import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const THEMES = new Set(["everything"] as const);

/**
 * Daily leaderboard for Combine. Returns up to the top 100 players for a
 * given (theme, day). Manifest daily rows (T-0241) sort by
 * `(manifestFound DESC, turns ASC, durationMs ASC, score DESC)` —
 * completions float to the top, partial completions rank by how many
 * manifest items were found, then ties break by turns, time, score.
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
  // distinct is resolved. `durationMs` may be missing on legacy rows — the
  // COALESCE treats missing as "slowest possible" so new timed runs win
  // tie-breaks against pre-timer rows.
  const rows = await getDb().execute<{
    handle: string | null;
    manifest_found: number | null;
    manifest_size: number | null;
    turns: number | null;
    duration_ms: number | null;
    score: number | null;
  }>(sql`
    SELECT handle, manifest_found, manifest_size, turns, duration_ms, score FROM (
      SELECT DISTINCT ON (p.user_id)
        u.handle AS handle,
        COALESCE((p.result->>'manifestFound')::int, 0) AS manifest_found,
        COALESCE((p.result->>'manifestSize')::int, 0) AS manifest_size,
        COALESCE((p.result->>'turns')::int, 0) AS turns,
        COALESCE((p.result->>'durationMs')::bigint, 9223372036854775807) AS duration_ms,
        COALESCE((p.result->>'score')::int, 0) AS score
      FROM progress p
      INNER JOIN "user" u ON u.id = p.user_id
      WHERE p.kind = 'combine'
        AND p.ref = ${theme}
        AND p.result->>'daily' = ${day}
      ORDER BY p.user_id,
               COALESCE((p.result->>'manifestFound')::int, 0) DESC,
               COALESCE((p.result->>'turns')::int, 0) ASC,
               COALESCE((p.result->>'durationMs')::bigint, 9223372036854775807) ASC,
               COALESCE((p.result->>'score')::int, 0) DESC
    ) best
    ORDER BY best.manifest_found DESC,
             best.turns ASC,
             best.duration_ms ASC,
             best.score DESC
    LIMIT 100
  `);

  const list = (rows as unknown as {
    rows?: Array<{
      handle: string | null;
      manifest_found: number;
      manifest_size: number;
      turns: number;
      duration_ms: number | string | null;
      score: number;
    }>;
  }).rows
    ?? (rows as unknown as Array<{
      handle: string | null;
      manifest_found: number;
      manifest_size: number;
      turns: number;
      duration_ms: number | string | null;
      score: number;
    }>);

  return NextResponse.json({
    day,
    theme,
    rows: list.map((r) => {
      // bigint comes back as string from pg; the sentinel for "no duration"
      // is Number.MAX_SAFE_INTEGER-ish — treat that as null on the wire so
      // the client can render "—" instead of 292M years.
      const raw = r.duration_ms == null ? null : Number(r.duration_ms);
      const durationMs =
        raw != null && Number.isFinite(raw) && raw < 24 * 60 * 60 * 1000 + 1
          ? raw
          : null;
      return {
        handle: r.handle ?? null,
        manifestFound: Number(r.manifest_found) || 0,
        manifestSize: Number(r.manifest_size) || 0,
        turns: Number(r.turns) || 0,
        durationMs,
        score: Number(r.score) || 0,
      };
    }),
  });
}
