import { NextResponse } from "next/server";
import { getRunOwner } from "@/lib/anon-session";
import { getLatestStaleDailyRun } from "@/combine/run-store";
import { todayKey } from "@/combine/rng";
import type { GameState } from "@/combine/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Returns the most-recent active daily run whose `dailyKey` is strictly
 * before today, if one exists. Powers the "recover yesterday's abandoned
 * daily" prompt (T-0333) that fires on mount — the player then chooses
 * Save (POST /finalize-stale {action:"save"}) or Discard
 * (POST /finalize-stale {action:"discard"}).
 *
 * Anon runs don't get prompted — there's no progress-row destination
 * without a user_id. For anon owners we return `{run: null}` so the
 * client's one-shot check is a cheap no-op.
 *
 * Returns the stored-state totals (score, moves, manifestFound,
 * manifestSize, dailyKey) so the client can render the prompt without
 * a second fetch. Full state isn't sent — this is a prompt, not a
 * resume (resume is the deferred third-option from the planning notes).
 */
export async function GET() {
  const owner = await getRunOwner({ mint: false });
  if (!owner || owner.kind !== "user") {
    return NextResponse.json({ run: null });
  }
  const row = await getLatestStaleDailyRun(owner, todayKey());
  if (!row) {
    return NextResponse.json({ run: null });
  }
  const stored = row.stateJson as unknown as GameState;
  return NextResponse.json({
    run: {
      runId: row.id,
      dailyKey: row.dailyKey,
      theme: row.theme,
      score: stored?.score ?? 0,
      moves: stored?.moves ?? 0,
      made: stored?.made ?? 0,
      manifestFound: stored?.manifestFound?.length ?? 0,
      manifestSize: stored?.manifest?.length ?? 0,
    },
  });
}
