// Pure aggregators over the user's Combine discovery rows and finished-run
// session rows (one per completed game).

import type { Tier } from "@/db/schema";

export type CombineRow = {
  itemId: string;
  tier: Tier;
  firstFoundAt: Date;
};

export type CombineRunResult = {
  score: number;
  made: number;
  age: number;
};

export type CombineRun = {
  ref: string;           // theme key: "everyday" | "everything"
  createdAt: Date;
  result: CombineRunResult;
};

export type CombineThemeBest = {
  bestScore: number;
  totalRuns: number;
  totalScore: number;
};

export type CombineStats = {
  totalDiscovered: number;
  byTier: Record<Tier, number>;
  firstEver: Date | null;
  latest: Date | null;
  // Finished-run stats, keyed by theme (empty object if the user has no
  // runs on record yet).
  bestByTheme: Record<string, CombineThemeBest>;
  totalRuns: number;
  bestScoreEver: number;
};

const EMPTY_BY_TIER: Record<Tier, number> = {
  F: 0, N: 0, M: 0, C: 0, P: 0, S: 0,
};

export function computeCombineStats(
  discoveries: readonly CombineRow[],
  runs: readonly CombineRun[] = [],
): CombineStats {
  const byTier: Record<Tier, number> = { ...EMPTY_BY_TIER };
  let firstEver: Date | null = null;
  let latest: Date | null = null;

  for (const row of discoveries) {
    byTier[row.tier] = (byTier[row.tier] ?? 0) + 1;
    if (!firstEver || row.firstFoundAt < firstEver) firstEver = row.firstFoundAt;
    if (!latest || row.firstFoundAt > latest) latest = row.firstFoundAt;
  }

  const bestByTheme: Record<string, CombineThemeBest> = {};
  let bestScoreEver = 0;

  for (const run of runs) {
    const { score } = run.result;
    if (score > bestScoreEver) bestScoreEver = score;
    const prev = bestByTheme[run.ref];
    if (!prev) {
      bestByTheme[run.ref] = { bestScore: score, totalRuns: 1, totalScore: score };
    } else {
      prev.bestScore = Math.max(prev.bestScore, score);
      prev.totalRuns += 1;
      prev.totalScore += score;
    }
  }

  return {
    totalDiscovered: discoveries.length,
    byTier,
    firstEver,
    latest,
    bestByTheme,
    totalRuns: runs.length,
    bestScoreEver,
  };
}
