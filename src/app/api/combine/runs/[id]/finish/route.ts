import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getRunOwner, serverRunsEnabled } from "@/lib/anon-session";
import { isAdmin, getSession } from "@/lib/session";
import { limiters, visitorKey, withRateLimit } from "@/api/rate-limit";
import {
  bundleForRun,
  isEngineVersionCurrent,
  replayActions,
  ReplayError,
  validateActionShape,
  type ServerMode,
} from "@/combine/server-engine";
import { endRun, getRunForOwner, saveRunCheckpoint } from "@/combine/run-store";
import { getDb, schema } from "@/db/client";
import { loadSeason } from "@/combine/season";
import { writeDiscoveriesFromState } from "@/combine/discoveries-writer";
import { ENGINE_VERSION, type Action, type GameState } from "@/combine/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface FinishBody {
  baseEventCount?: unknown;
  /** Trailing actions that drive the run to `over` (or the last batch
   *  of play before a forfeit). May be empty if the client has already
   *  flushed everything via `/checkpoint`. */
  actions?: unknown;
  /** Elapsed wall-clock time for the run, measured client-side from the
   *  moment the player confirmed "Start" (daily) or opened the board
   *  (endless/fast). Stored on the `progress` row's `result.durationMs`
   *  for daily leaderboard tie-breaks and end-card display. Server-
   *  trusted — anti-cheat is weak here, but the number isn't a scoring
   *  input. */
  durationMs?: unknown;
}

/**
 * Close a server run. Applies any trailing actions, verifies the run
 * really did end (either `state.over === true` or the final action was
 * a `finish`), then writes the authoritative result to `progress`.
 *
 * Importantly, the `progress` row is written using the server's
 * computed totals — not anything the client sends alongside. This is
 * the single path to the Combine leaderboard; the legacy
 * `/api/combine/result` route was retired in T-0195.
 *
 * Only signed-in users have a `progress` row written (guest anon runs
 * end cleanly but don't get a leaderboard entry).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!serverRunsEnabled()) {
    return NextResponse.json({ error: "feature off" }, { status: 404 });
  }
  const owner = await getRunOwner({ mint: false });
  if (!owner) {
    return NextResponse.json({ error: "no identity" }, { status: 401 });
  }
  const { id } = await params;
  // Rate-limit the write-path. Shares the `combineRun` bucket with
  // /checkpoint so a hostile client can't dodge by alternating
  // endpoints.
  const limited = await withRateLimit(
    req,
    limiters.combineRun,
    `${id}:${visitorKey(req)}`,
    () => null,
  );
  if (limited instanceof Response) return limited;

  let body: FinishBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const baseCount =
    typeof body.baseEventCount === "number" &&
    Number.isFinite(body.baseEventCount)
      ? Math.floor(body.baseEventCount)
      : null;
  if (baseCount === null || baseCount < 0) {
    return NextResponse.json({ error: "invalid baseEventCount" }, { status: 400 });
  }
  if (!Array.isArray(body.actions)) {
    return NextResponse.json({ error: "actions must be an array" }, { status: 400 });
  }
  if (body.actions.length > 100) {
    return NextResponse.json({ error: "batch too large" }, { status: 413 });
  }
  // Cap duration at 24h — anything longer is almost certainly a stale
  // tab / clock skew, and we don't want absurd values polluting the
  // leaderboard tie-break.
  let durationMs: number | null = null;
  if (body.durationMs != null) {
    const n = Number(body.durationMs);
    if (Number.isFinite(n) && n >= 0 && n <= 24 * 60 * 60 * 1000) {
      durationMs = Math.floor(n);
    }
  }
  const parsed: Action[] = [];
  for (let i = 0; i < body.actions.length; i++) {
    const a = body.actions[i];
    if (!validateActionShape(a)) {
      return NextResponse.json({ error: "invalid action", at: i }, { status: 400 });
    }
    parsed.push(a as Action);
  }

  const run = await getRunForOwner(id, owner);
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  if (run.status !== "active") {
    // Idempotent finish: a second POST after end is a no-op that
    // returns the stored state for completeness.
    return NextResponse.json({
      state: run.stateJson,
      eventCount: run.eventCount,
      alreadyEnded: true,
    });
  }
  // Reject replay against a stored run that predates the running reducer.
  // Replaying would silently produce a different score. Client treats
  // `engineVersionMismatch` the same as the ordinary 409 reconcile path —
  // drop local state and start a fresh run.
  if (!isEngineVersionCurrent(run.engineVersion)) {
    return NextResponse.json(
      {
        error: "engine version mismatch",
        engineVersionMismatch: true,
        serverEventCount: run.eventCount,
        state: run.stateJson,
      },
      { status: 409 },
    );
  }
  if (baseCount !== run.eventCount) {
    return NextResponse.json(
      {
        error: "event count mismatch",
        serverEventCount: run.eventCount,
        state: run.stateJson,
      },
      { status: 409 },
    );
  }

  let bundle;
  try {
    bundle = await bundleForRun(
      run.mode as ServerMode,
      run.theme,
      run.dailyKey || null,
    );
  } catch (err) {
    console.error("[runs/finish] bundle build failed:", err);
    return NextResponse.json({ error: "bundle unavailable" }, { status: 500 });
  }

  const admin = await isAdmin();
  let result;
  try {
    result = replayActions(run.stateJson as unknown as GameState, bundle, parsed, {
      allowDebug: admin,
    });
  } catch (err) {
    if (err instanceof ReplayError) {
      return NextResponse.json(
        { error: err.message, at: err.atIndex },
        { status: 422 },
      );
    }
    console.error("[runs/finish] replay failed:", err);
    return NextResponse.json({ error: "replay failed" }, { status: 500 });
  }

  const final = result.state;
  // Validate the run actually ended.
  if (!final.over) {
    return NextResponse.json(
      { error: "run not over after replay" },
      { status: 422 },
    );
  }

  // Save the final state so a repeat finish is idempotent + a review
  // UI can read it.
  await saveRunCheckpoint(run.id, final, run.eventCount + result.appliedCount);
  await endRun(run.id);

  // Write to `progress` (only for signed-in users — anon runs just
  // end). All numbers are server-computed.
  const session = await getSession();
  const userId = session?.user?.id;
  if (userId) {
    const season = await loadSeason(run.theme);
    // `engineVersion` travels with the progress row so a future
    // ENGINE_VERSION bump doesn't silently mix rows scored under
    // different reducers on the same leaderboard. Mirror of the
    // `combine_runs.engine_version` column. See SECURITY_AUDIT H3c /
    // T-0195 / T-0201.
    const base = {
      score: final.score,
      made: final.made,
      chapter: final.chapter,
      season,
      mode: run.mode,
      engineVersion: ENGINE_VERSION,
    };
    const manifestSize = final.manifest?.length ?? 0;
    const manifestFound = final.manifestFound.length;
    const resultValue =
      run.mode === "daily"
        ? {
            ...base,
            daily: run.dailyKey || null,
            turns: final.moves,
            found: final.found.length,
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
    } catch (err) {
      // Non-fatal — the run is ended, the player sees their score.
      console.error("[runs/finish] progress insert failed:", err);
    }
    // Write discoveries from the server-replayed state. H3b: the client
    // used to POST these to `/api/combine/collection` with no
    // cross-check; now the server is the sole writer. Non-fatal — a
    // failure here drops this run's unlocks but doesn't break the
    // score write above.
    try {
      await writeDiscoveriesFromState(userId, final);
    } catch (err) {
      console.error("[runs/finish] discovery write failed:", err);
    }
  }

  return NextResponse.json({
    state: final,
    eventCount: run.eventCount + result.appliedCount,
    events: result.events,
    ended: true,
  });
}
