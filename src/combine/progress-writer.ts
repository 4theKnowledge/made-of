/**
 * Shared progress-row write for completed Combine runs.
 *
 * `/finish` writes progress inline on the happy path. This helper exists
 * for the rescue paths: when `/finish` would otherwise 409 (engine-version
 * mismatch or event-count drift) but the stored state is already `over`,
 * we know the run really did end during an earlier checkpoint — the
 * finish POST just raced. Write the progress row from the stored state
 * so the player lands on the leaderboard instead of seeing "rank
 * unavailable" (T-0315).
 *
 * Writes discoveries + ends the run as a side effect.
 */

import { randomUUID } from "node:crypto";
import { getDb, schema } from "@/db/client";
import type { CombineRun } from "@/db/schema";
import { writeDiscoveriesFromState } from "./discoveries-writer";
import { endRun } from "./run-store";
import { loadSeason } from "./season";
import { ENGINE_VERSION, type GameState } from "./engine";

export interface FinalizeFromStoredOpts {
  /** Mark the row's engine_version in the progress result — pass
   *  `run.engineVersion` to tag legacy-engine finalizes (so the
   *  leaderboard can segment), or `ENGINE_VERSION` for current. */
  engineVersion: number;
  /** When true, stamps `legacyFinalize: true` on the result — the
   *  leaderboard includes these but UIs can tell them apart. */
  legacy?: boolean;
  /** Optional client-reported duration; the server-authoritative value
   *  (from `run.startedAt`) wins when present. */
  clientDurationMs?: number | null;
}

export interface FinalizeFromStoredResult {
  progressWritten: boolean;
  discoveriesWritten: boolean;
}

/** Finalize a run from its stored state. Caller has already verified
 *  `stored.over === true`. Idempotent at the row level (duplicate
 *  progress rows are possible if the client retries aggressively, but
 *  the leaderboard's `DISTINCT ON (user_id)` best-attempt collapses
 *  them). For the `userId === null` case (anon run), only ends the run. */
export async function finalizeFromStoredState(
  run: CombineRun,
  stored: GameState,
  userId: string | null,
  opts: FinalizeFromStoredOpts,
): Promise<FinalizeFromStoredResult> {
  await endRun(run.id);

  if (!userId) {
    return { progressWritten: false, discoveriesWritten: false };
  }

  const season = await loadSeason(run.theme);
  let durationMs: number | null = opts.clientDurationMs ?? null;
  if (run.mode === "daily" && run.startedAt) {
    const elapsed = Date.now() - run.startedAt.getTime();
    if (Number.isFinite(elapsed) && elapsed >= 0) {
      durationMs = Math.min(elapsed, 24 * 60 * 60 * 1000);
    }
  }

  const base: Record<string, unknown> = {
    score: stored.score,
    made: stored.made,
    chapter: stored.chapter,
    season,
    mode: run.mode,
    engineVersion: opts.engineVersion,
  };
  if (opts.legacy) base.legacyFinalize = true;

  const manifestSize = stored.manifest?.length ?? 0;
  const manifestFound = stored.manifestFound?.length ?? 0;
  const resultValue =
    run.mode === "daily"
      ? {
          ...base,
          daily: run.dailyKey || null,
          turns: stored.moves,
          found: stored.found.length,
          manifestFound,
          manifestSize,
          durationMs,
        }
      : base;

  let progressWritten = false;
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
    console.error("[progress-writer] progress insert failed:", err);
  }

  let discoveriesWritten = false;
  try {
    await writeDiscoveriesFromState(userId, stored);
    discoveriesWritten = true;
  } catch (err) {
    console.error("[progress-writer] discovery write failed:", err);
  }

  return { progressWritten, discoveriesWritten };
}

/** Re-export so callers don't need a direct import just to pick the
 *  current engine version when finalizing a current-engine stored state. */
export { ENGINE_VERSION };
