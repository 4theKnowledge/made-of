// Pure aggregators over the user's Combine discovery rows and finished-run
// session rows (one per completed game).

import type { Tier } from "@/db/schema";

export type CombineScope = "endless" | "daily";

export type CombineRow = {
  itemId: string;
  tier: Tier;
  scope: CombineScope;
  firstFoundAt: Date;
};

export type CombineRunResult = {
  score: number;
  made: number;
  age: number;
  /** The theme's `numAges` at the moment this run finished. Older rows (pre
   *  derived-ages) are missing this field — treat absence as season 0 for
   *  comparison. Leaderboards segment by (ref, season). */
  season?: number;
  /** Day key for daily runs. */
  daily?: string;
  /** Play mode at run-end. Absent in rows written before Fast launched —
   *  treat missing as endless. Legacy `"classic"` (written before the
   *  endless/daily split) is also read as endless. Used to split stats so
   *  Fast doesn't share a best-score bucket with the classic reducer. */
  mode?: "endless" | "daily" | "fast" | "classic";
};

export type CombineRun = {
  ref: string;           // theme key: "everything"
  createdAt: Date;
  result: CombineRunResult;
};

export type CombineThemeBest = {
  bestScore: number;
  totalRuns: number;
  totalScore: number;
};

/** T-0217 slice 3: one row per theme-completion event. Re-completions
 *  (after admin-added items) stack as separate rows. */
export type CombineCompletion = {
  themeCode: string;
  /** Resolved display label from `combine_themes.label`, or `themeCode`
   *  as a fallback if the theme has since been deleted. */
  themeLabel: string;
  completedVersion: number;
  completedAt: Date;
  itemCount: number;
};

export type CombineScopeDiscovery = {
  total: number;
  byTier: Record<Tier, number>;
};

export type CombineStats = {
  // Combined counts (across endless + daily) — kept for callers that just
  // want "how many items has the player ever discovered in Combine".
  totalDiscovered: number;
  byTier: Record<Tier, number>;
  // Per-scope split: endless (both themes share) vs daily (its own pool).
  // Daily starts empty for everyone post-migration so the counts stay fair.
  byScope: Record<CombineScope, CombineScopeDiscovery>;
  firstEver: Date | null;
  latest: Date | null;
  // Finished-run stats for classic (endless + daily), keyed by theme.
  // Empty object if no classic runs on record.
  bestByTheme: Record<string, CombineThemeBest>;
  // Finished-run stats for Fast runs, keyed by theme. Split from classic
  // because Fast is a different game — pair-dense scoring — and bundling
  // them hides the Fast surface entirely.
  bestByFastTheme: Record<string, CombineThemeBest>;
  totalRuns: number;
  bestScoreEver: number;
  // Combine is a high-score game — the collection is a progression aid
  // along the way, not the goal. `totalScoreEver` is the running tally
  // across every finished run.
  totalScoreEver: number;
  // T-0217 slice 3: theme completion log, newest first. Each row is a
  // discrete "I finished this theme at version N" event; re-completions
  // after an admin expansion stack as additional rows.
  completions: CombineCompletion[];
};

const EMPTY_BY_TIER: Record<Tier, number> = {
  F: 0, N: 0, M: 0, C: 0, P: 0, S: 0,
};

function emptyScope(): CombineScopeDiscovery {
  return { total: 0, byTier: { ...EMPTY_BY_TIER } };
}

export function computeCombineStats(
  discoveries: readonly CombineRow[],
  runs: readonly CombineRun[] = [],
  completions: readonly CombineCompletion[] = [],
): CombineStats {
  const byTier: Record<Tier, number> = { ...EMPTY_BY_TIER };
  const byScope: Record<CombineScope, CombineScopeDiscovery> = {
    endless: emptyScope(),
    daily: emptyScope(),
  };
  let firstEver: Date | null = null;
  let latest: Date | null = null;

  for (const row of discoveries) {
    byTier[row.tier] = (byTier[row.tier] ?? 0) + 1;
    const bucket = byScope[row.scope];
    bucket.total += 1;
    bucket.byTier[row.tier] = (bucket.byTier[row.tier] ?? 0) + 1;
    if (!firstEver || row.firstFoundAt < firstEver) firstEver = row.firstFoundAt;
    if (!latest || row.firstFoundAt > latest) latest = row.firstFoundAt;
  }

  const bestByTheme: Record<string, CombineThemeBest> = {};
  const bestByFastTheme: Record<string, CombineThemeBest> = {};
  let bestScoreEver = 0;
  let totalScoreEver = 0;

  for (const run of runs) {
    const { score } = run.result;
    totalScoreEver += score;
    if (score > bestScoreEver) bestScoreEver = score;
    const bucket = run.result.mode === "fast" ? bestByFastTheme : bestByTheme;
    const prev = bucket[run.ref];
    if (!prev) {
      bucket[run.ref] = { bestScore: score, totalRuns: 1, totalScore: score };
    } else {
      prev.bestScore = Math.max(prev.bestScore, score);
      prev.totalRuns += 1;
      prev.totalScore += score;
    }
  }

  // Newest first — stats page renders chronologically newest-to-oldest.
  const sortedCompletions = completions
    .slice()
    .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());

  return {
    totalDiscovered: discoveries.length,
    byTier,
    byScope,
    firstEver,
    latest,
    bestByTheme,
    bestByFastTheme,
    totalRuns: runs.length,
    bestScoreEver,
    totalScoreEver,
    completions: sortedCompletions,
  };
}
