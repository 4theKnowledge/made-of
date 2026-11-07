import { NextResponse, type NextRequest } from "next/server";
import { getRunOwner, serverRunsEnabled } from "@/lib/anon-session";
import { getSession, isAdmin } from "@/lib/session";
import { bundleForRun, isEngineVersionCurrent, replayActions, ReplayError, validateActionShape, type ServerMode } from "@/combine/server-engine";
import { getRunForOwner, saveRunCheckpoint } from "@/combine/run-store";
import { writeDiscoveriesFromState } from "@/combine/discoveries-writer";
import { limiters, visitorKey, withRateLimit } from "@/api/rate-limit";
import type { Action, GameState } from "@/combine/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface CheckpointBody {
  /** Event count the client thinks the server is at. Mismatch → 409
   *  with the server's current state so the client reconciles. */
  baseEventCount?: unknown;
  /** Ordered actions to apply after `baseEventCount`. */
  actions?: unknown;
}

/**
 * Apply a batch of client-side actions to a server run. The server
 * replays the actions against the stored state; if replay succeeds
 * the stored state is overwritten and the new (state, eventCount) is
 * returned. If the client's `baseEventCount` doesn't match the
 * server's, the server returns 409 with its state so the client can
 * reconcile (drop its optimistic buffer and replay from truth).
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
  // Rate-limit the write-path. Keyed on runId + IP so one hostile run
  // can't throttle a legitimate one on the same egress IP, and a
  // hostile IP can't starve a different user's run id.
  const limited = await withRateLimit(
    req,
    limiters.combineRun,
    `${id}:${visitorKey(req)}`,
    () => null,
  );
  if (limited instanceof Response) return limited;

  let body: CheckpointBody;
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
  // Cap payload size — a malicious client shouldn't be able to push an
  // unbounded replay batch. 100 actions covers legitimate "page unload
  // after a long idle" cases with headroom.
  if (body.actions.length > 100) {
    return NextResponse.json({ error: "batch too large" }, { status: 413 });
  }
  const parsed: Action[] = [];
  for (let i = 0; i < body.actions.length; i++) {
    const a = body.actions[i];
    if (!validateActionShape(a)) {
      return NextResponse.json(
        { error: "invalid action", at: i },
        { status: 400 },
      );
    }
    parsed.push(a as Action);
  }

  const run = await getRunForOwner(id, owner);
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  if (run.status !== "active") {
    return NextResponse.json(
      {
        error: "run not active",
        status: run.status,
        epoch: run.epoch,
      },
      { status: 409 },
    );
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
        epoch: run.epoch,
      },
      { status: 409 },
    );
  }
  if (baseCount !== run.eventCount) {
    // Client is ahead or behind the server. Return server truth so the
    // client can reconcile (reset its local buffer, re-render from the
    // server state, and resume from here).
    return NextResponse.json(
      {
        error: "event count mismatch",
        serverEventCount: run.eventCount,
        state: run.stateJson,
        epoch: run.epoch,
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
    console.error("[runs/checkpoint] bundle build failed:", err);
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
        { error: err.message, at: err.atIndex, epoch: run.epoch },
        { status: 422 },
      );
    }
    console.error("[runs/checkpoint] replay failed:", err);
    return NextResponse.json({ error: "replay failed" }, { status: 500 });
  }

  const saved = await saveRunCheckpoint(
    run.id,
    result.state,
    run.eventCount + result.appliedCount,
  );
  if (!saved) {
    return NextResponse.json({ error: "save failed" }, { status: 500 });
  }

  // Grow the lifetime collection mid-run (H3b). Replay already produced
  // `result.state.found`; the write is scoped per `state.daily`. Guest
  // runs don't write — only signed-in users. Non-fatal — a failure here
  // delays unlock visibility but doesn't block the checkpoint.
  const session = await getSession();
  if (session?.user?.id) {
    try {
      await writeDiscoveriesFromState(session.user.id, result.state);
    } catch (err) {
      console.error("[runs/checkpoint] discovery write failed:", err);
    }
  }

  return NextResponse.json({
    state: saved.stateJson,
    eventCount: saved.eventCount,
    epoch: saved.epoch,
    events: result.events,
    appliedCount: result.appliedCount,
  });
}
