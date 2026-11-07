import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getRunOwner, serverRunsEnabled } from "@/lib/anon-session";
import { isAdmin, getSession } from "@/lib/session";
import {
  bundleForRun,
  replayActions,
  ReplayError,
  validateActionShape,
  type ServerMode,
} from "@/combine/server-engine";
import { endRun, getRunForOwner, saveRunCheckpoint } from "@/combine/run-store";
import { getDb, schema } from "@/db/client";
import { loadSeason } from "@/combine/season";
import type { Action, GameState } from "@/combine/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface FinishBody {
  baseEventCount?: unknown;
  /** Trailing actions that drive the run to `over` (or the last batch
   *  of play before a forfeit). May be empty if the client has already
   *  flushed everything via `/checkpoint`. */
  actions?: unknown;
}

/**
 * Close a server run. Applies any trailing actions, verifies the run
 * really did end (either `state.over === true` or the final action was
 * a `finish`), then writes the authoritative result to `progress`.
 *
 * Importantly, the `progress` row is written using the server's
 * computed totals — not anything the client sends alongside. This
 * closes the "client posts a fake score" exploit that the legacy
 * `/api/combine/result` endpoint accepted.
 *
 * Only signed-in users have a `progress` row written (guest anon runs
 * end cleanly but don't get a leaderboard entry, which matches the
 * pre-T-0175 behaviour where anonymous play produced no progress
 * rows either).
 */
export async function POST(
  req: Request,
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
  // end). Mirrors the legacy /api/combine/result shape so dashboards
  // keep working. All numbers are server-computed.
  const session = await getSession();
  const userId = session?.user?.id;
  if (userId) {
    const season = await loadSeason(run.theme);
    const base = {
      score: final.score,
      made: final.made,
      age: final.age,
      season,
      mode: run.mode,
    };
    const resultValue =
      run.mode === "daily"
        ? {
            ...base,
            daily: run.dailyKey || null,
            turns: final.moves,
            found: final.found.length,
            target: final.target ?? 0,
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
  }

  return NextResponse.json({
    state: final,
    eventCount: run.eventCount + result.appliedCount,
    events: result.events,
    ended: true,
  });
}
