import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/session";
import { getDb, schema } from "@/db/client";
import { loadSeason } from "@/combine/season";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const THEMES = new Set(["everything"] as const);
type Theme = typeof THEMES extends Set<infer T> ? T : never;

/**
 * Record the result of a finished Combine run. Called from the client when
 * `state.over` first flips true. We trust the client's totals (there's no
 * authoritative server-side game loop for Combine) but clamp them to defend
 * against stat poisoning.
 *
 * Body: { theme, score, made, age, daily?, season? }
 *   `daily` is the ISO day key the puzzle was for, or null/absent for endless
 *   runs. Stored on `result.daily` so future daily leaderboards can filter
 *   without a schema change.
 *   `season` is the client's known numAges at run start. Clamped to the
 *   server's stored max so a client whose bundle predates a promotion still
 *   gets stamped with the season it actually played. A missing / invalid /
 *   over-the-cap value falls back to the server's current season.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  let body: {
    theme?: unknown;
    score?: unknown;
    made?: unknown;
    age?: unknown;
    daily?: unknown;
    season?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const theme = typeof body.theme === "string" && (THEMES as Set<string>).has(body.theme)
    ? (body.theme as Theme)
    : null;
  if (!theme) {
    return NextResponse.json({ error: "Invalid theme" }, { status: 400 });
  }

  const score = clampInt(body.score, 0, 1_000_000);
  const made = clampInt(body.made, 0, 100_000);
  const age = clampInt(body.age, 0, 100);
  const daily =
    typeof body.daily === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.daily)
      ? body.daily
      : null;

  // Stamp the run with the theme's season (= numAges at play time). Prefer
  // the client's declared value, clamped to [0, server-known], so a run that
  // started before a mid-run promotion stays labelled with the season it
  // actually played. Fall back to the server's current value if the client
  // didn't send one.
  const serverSeason = await loadSeason(theme);
  const clientSeason =
    typeof body.season === "number" && Number.isFinite(body.season)
      ? Math.max(0, Math.min(serverSeason, Math.floor(body.season)))
      : null;
  const season = clientSeason ?? serverSeason;
  const base = { score, made, age, season };

  await getDb()
    .insert(schema.progress)
    .values({
      id: randomUUID(),
      userId: session.user.id,
      kind: "combine",
      ref: theme,
      result: daily ? { ...base, daily } : base,
    });

  return NextResponse.json({ ok: true });
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : min;
  return Math.max(min, Math.min(max, n));
}
