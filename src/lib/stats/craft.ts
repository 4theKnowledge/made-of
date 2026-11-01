// Pure aggregators over per-solve `progress` rows for the Craft game.
// Rows are written by src/app/api/craft/make/route.ts on win.

export type CraftResult = {
  moves: number;
  par: number;
  hints: number;
  timeMs: number;
  stars: number;
  // points is the final score shown on the win screen (1000 minus penalties
  // for hints, bad hides and detours). badHides is kept too so later tweaks
  // to the scoring formula can be recomputed from stored rows if needed.
  points: number;
  badHides: number;
};

export type CraftRow = {
  ref: string;          // target slug
  createdAt: Date;
  result: CraftResult;
};

export type CraftStats = {
  totalSolves: number;      // every winning row ever recorded
  uniqueTargets: number;    // distinct `ref`
  atOrUnderPar: number;     // solves where moves <= par
  threeStarSolves: number;  // solves where stars === 3
  bestScore: number;        // max points across every solve
  totalScore: number;       // sum of points across every solve
  // Per-target best, keyed by slug. Lets the UI surface personal bests.
  bestByTarget: Record<
    string,
    {
      bestMoves: number;
      bestTimeMs: number;
      bestStars: number;
      bestScore: number;
    }
  >;
};

export function computeCraftStats(rows: readonly CraftRow[]): CraftStats {
  const bestByTarget: CraftStats["bestByTarget"] = {};
  let atOrUnderPar = 0;
  let threeStarSolves = 0;
  let bestScore = 0;
  let totalScore = 0;

  for (const row of rows) {
    const { moves, par, timeMs, stars, points } = row.result;
    if (moves <= par) atOrUnderPar++;
    if (stars === 3) threeStarSolves++;
    if (points > bestScore) bestScore = points;
    totalScore += points;

    const prev = bestByTarget[row.ref];
    if (!prev) {
      bestByTarget[row.ref] = {
        bestMoves: moves,
        bestTimeMs: timeMs,
        bestStars: stars,
        bestScore: points,
      };
    } else {
      prev.bestMoves = Math.min(prev.bestMoves, moves);
      prev.bestTimeMs = prev.bestTimeMs === 0
        ? timeMs
        : timeMs === 0
          ? prev.bestTimeMs
          : Math.min(prev.bestTimeMs, timeMs);
      prev.bestStars = Math.max(prev.bestStars, stars);
      prev.bestScore = Math.max(prev.bestScore, points);
    }
  }

  return {
    totalSolves: rows.length,
    uniqueTargets: Object.keys(bestByTarget).length,
    atOrUnderPar,
    threeStarSolves,
    bestScore,
    totalScore,
    bestByTarget,
  };
}
