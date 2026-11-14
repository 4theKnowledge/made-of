import { NextResponse, type NextRequest } from "next/server";
import { getRunOwner } from "@/lib/anon-session";
import { getSession } from "@/lib/session";
import { limiters, visitorKey, withRateLimit } from "@/api/rate-limit";
import { endRun, getRunForOwner } from "@/combine/run-store";
import { finalizeFromStoredState } from "@/combine/progress-writer";
import { todayKey } from "@/combine/rng";
import type { GameState } from "@/combine/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface FinalizeStaleBody {
  /** `"save"` writes a progress row from the stored state (ranked on
   *  yesterday's leaderboard by manifestFound → turns → duration → score);
   *  `"discard"` just endRun's with no progress written. */
  action?: unknown;
}

/**
 * Resolve an abandoned prior-day daily Combine run (T-0333). The run
 * must still be `active` and its `dailyKey` strictly before today —
 * otherwise this route is wrong for the job. Today's runs go through
 * `/finish`; already-ended runs are no-op idempotent.
 *
 * On "save" we trust the stored state (no replay) — same semantics as
 * `/finish`'s rescue path and `/finalize-legacy`. The progress row is
 * dated to the run's original `dailyKey`, so the player lands on the
 * leaderboard for the day they actually played.
 *
 * Only signed-in users can save (anon owners have no progress destination
 * and were filtered out upstream in `GET /stale-daily`).
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

  let body: FinalizeStaleBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (body.action !== "save" && body.action !== "discard") {
    return NextResponse.json(
      { error: "action must be 'save' or 'discard'" },
      { status: 400 },
    );
  }

  const run = await getRunForOwner(id, owner);
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  if (run.mode !== "daily") {
    return NextResponse.json(
      { error: "not a daily run" },
      { status: 400 },
    );
  }
  if (run.status !== "active") {
    return NextResponse.json({ alreadyEnded: true });
  }
  if (!run.dailyKey || run.dailyKey >= todayKey()) {
    return NextResponse.json(
      { error: "not a prior-day run; use /finish" },
      { status: 400 },
    );
  }

  if (body.action === "discard") {
    await endRun(run.id);
    return NextResponse.json({ ended: true, progressWritten: false });
  }

  // "save" — write progress row from stored state, scoped to the run's
  // own dailyKey. finalizeFromStoredState also calls endRun(); discoveries
  // from the stored state are persisted alongside.
  const session = await getSession();
  const userId = session?.user?.id ?? null;
  if (!userId) {
    // Owner was `user` upstream but session is now missing — session
    // expired between the GET prompt and this POST. End the run so the
    // prompt doesn't re-fire, but nothing to bank to.
    await endRun(run.id);
    return NextResponse.json({ ended: true, progressWritten: false });
  }
  const stored = run.stateJson as unknown as GameState;
  const result = await finalizeFromStoredState(run, stored, userId, {
    engineVersion: run.engineVersion,
    legacy: false,
  });
  return NextResponse.json({
    ended: true,
    progressWritten: result.progressWritten,
    discoveriesWritten: result.discoveriesWritten,
    dailyKey: run.dailyKey,
  });
}
