import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getRunOwner } from "@/lib/anon-session";
import { getSession } from "@/lib/session";
import { limiters, visitorKey, withRateLimit } from "@/api/rate-limit";
import { endRun, getRunForOwner, invalidateRun } from "@/combine/run-store";
import { getDb, schema } from "@/db/client";
import { loadSeason } from "@/combine/season";
import { writeDiscoveriesFromState } from "@/combine/discoveries-writer";
import { ENGINE_VERSION, type GameState } from "@/combine/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface FinalizeBody {
  /** Local GameState the client has at the moment it discovered the run
   *  is on a stale engine. The server can't replay it (that's the whole
   *  point), so we accept it and bound-check against our last-known
   *  checkpoint. */
  state?: unknown;
  /** Elapsed wall-clock for the run. Same semantics as `/finish`. */
  durationMs?: unknown;
}

/**
 * Finalize a run whose stored engine version no longer matches the
 * current ENGINE_VERSION. Writes a `progress` row stamped with the
 * stored (old) version so leaderboards can segment by engine, then
 * invalidates the run. Trusts the client's local GameState, bounded
 * by sanity checks against the last server-replayed checkpoint.
 *
 * This route is deliberately narrow: it only accepts stale-engine
 * runs. A current-engine run must go through `/finish` (replayed).
 *
 * Only signed-in users get a progress row — anon runs just end.
 *
 * See T-0313 for the UX rationale ("auto-finalize mid-run on engine
 * bump") and why we chose this over versioned reducers.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const owner = await getRunOwner({ mint: false });
  if (!owner) {
    return NextResponse.json({ error: "no identity" }, { status: 401 });
  }
  const { id } = await params;
  const limited = await withRateLimit(
    req,
    limiters.combineRun,
    `${id}:${visitorKey(req)}`,
    () => null,
  );
  if (limited instanceof Response) return limited;

  let body: FinalizeBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const submitted = body.state;
  if (!submitted || typeof submitted !== "object") {
    return NextResponse.json({ error: "state required" }, { status: 400 });
  }
  const s = submitted as Partial<GameState>;
  if (
    typeof s.score !== "number" ||
    typeof s.made !== "number" ||
    typeof s.moves !== "number" ||
    typeof s.chapter !== "number" ||
    !Array.isArray(s.found)
  ) {
    return NextResponse.json({ error: "invalid state shape" }, { status: 400 });
  }
  let clientDurationMs: number | null = null;
  if (body.durationMs != null) {
    const n = Number(body.durationMs);
    if (Number.isFinite(n) && n >= 0 && n <= 24 * 60 * 60 * 1000) {
      clientDurationMs = Math.floor(n);
    }
  }

  const run = await getRunForOwner(id, owner);
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  // Route is for stale engines only — a current-engine run has to go
  // through the real replay path.
  if (run.engineVersion === ENGINE_VERSION) {
    return NextResponse.json(
      { error: "run engine is current; use /finish" },
      { status: 400 },
    );
  }
  if (run.status !== "active") {
    return NextResponse.json({ alreadyEnded: true });
  }

  // Sanity-bound the client's claimed totals against our last-known
  // server-replayed checkpoint. Trust-but-verify — we can't rerun the
  // reducer on the submitted state (that's the whole reason this route
  // exists), but we can refuse obvious nonsense.
  const stored = run.stateJson as unknown as GameState;
  if (s.score < stored.score) {
    return NextResponse.json(
      { error: "submitted score below checkpoint" },
      { status: 422 },
    );
  }
  if (s.moves < stored.moves) {
    return NextResponse.json(
      { error: "submitted moves below checkpoint" },
      { status: 422 },
    );
  }
  const storedFound = new Set(stored.found);
  for (const id of storedFound) {
    if (!s.found.includes(id)) {
      return NextResponse.json(
        { error: "submitted discoveries missing from checkpoint" },
        { status: 422 },
      );
    }
  }
  // Generous per-run ceiling. A plausible long endless tops out well
  // below this. Catches "submitted 2^31" junk without flagging real
  // long runs. Revisit if players start hitting it.
  const SCORE_CEILING = 1_000_000;
  if (s.score > SCORE_CEILING) {
    return NextResponse.json(
      { error: "submitted score exceeds ceiling" },
      { status: 422 },
    );
  }

  // Build the progress row with the client's totals, stamped with the
  // STORED engine version (not current). This is how leaderboards can
  // badge or filter legacy-engine rows without quarantining them.
  const session = await getSession();
  const userId = session?.user?.id;
  let progressWritten = false;
  if (userId) {
    const season = await loadSeason(run.theme);
    let durationMs: number | null = clientDurationMs;
    if (run.mode === "daily" && run.startedAt) {
      const elapsed = Date.now() - run.startedAt.getTime();
      if (Number.isFinite(elapsed) && elapsed >= 0) {
        durationMs = Math.min(elapsed, 24 * 60 * 60 * 1000);
      }
    }
    const base = {
      score: s.score,
      made: s.made,
      chapter: s.chapter,
      season,
      mode: run.mode,
      engineVersion: run.engineVersion,
      legacyFinalize: true,
    };
    const manifestSize = s.manifest?.length ?? 0;
    const manifestFound = s.manifestFound?.length ?? 0;
    const resultValue =
      run.mode === "daily"
        ? {
            ...base,
            daily: run.dailyKey || null,
            turns: s.moves,
            found: s.found.length,
            manifestFound,
            manifestSize,
            durationMs,
          }
        : base;
    try {
      await getDb()
        .insert(schema.progress)
        .values({
          id: randomUUID(),
          userId,
          kind: "combine",
          ref: run.theme,
          result: resultValue,
        });
      progressWritten = true;
    } catch (err) {
      console.error("[runs/finalize-legacy] progress insert failed:", err);
    }
    // Discoveries from the submitted state. Already sanity-bounded as a
    // superset of the server's record; non-fatal on write failure.
    try {
      await writeDiscoveriesFromState(userId, submitted as GameState);
    } catch (err) {
      console.error("[runs/finalize-legacy] discovery write failed:", err);
    }
  }

  // Mark the run invalidated (distinct from `ended` — this run didn't
  // reach a natural conclusion under the current reducer).
  await invalidateRun(run.id);
  // Defensive: if invalidateRun didn't match (race with a concurrent
  // ender), endRun is idempotent on non-active rows.
  await endRun(run.id);

  return NextResponse.json({
    finalized: true,
    progressWritten,
    engineVersion: run.engineVersion,
  });
}
