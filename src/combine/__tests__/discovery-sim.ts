/**
 * Long-horizon discovery sim: can a motivated player eventually discover
 * everything in a theme by playing many games? Run with:
 *
 *   npx tsx src/combine/__tests__/discovery-sim.ts [theme] [games] [seed] [strategies]
 *
 * `strategies` is a comma-separated list; default `baseline` runs today's
 * dealer. Available: `baseline`, `creatability`, `aggressive-unfound`.
 * Each strategy runs on identical seeds so attempts/new-find comparisons
 * are apples-to-apples. See `docs/FIELD_NOTES_REVIEW.md` §2a / T-0279.
 *
 * Reports (per strategy):
 *   - per-game discovery distribution
 *   - cumulative collection growth (games to 50%, 90%, 100%)
 *   - attempts/new-find and local-loop percentiles (T-0274)
 *   - per-recipe local-mining traps (T-0280)
 *   - rarest-seen items
 * And at the end: a side-by-side comparison of the key metrics.
 */

import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import { setDealerWeightHook } from "../deal";
import {
  newGame,
  reduce,
  type Action,
  type GameState,
} from "../engine";
import { matchAt, matchOn } from "../match";
import type { CombineRecipe, ThemeBundle, ThemeKey } from "../types";

function enumerateCombines(
  state: GameState,
  bundle: ThemeBundle,
): Array<{ action: Action; recipe: CombineRecipe }> {
  const out: Array<{ action: Action; recipe: CombineRecipe }> = [];
  for (let s = 0; s < state.tray.length; s++) {
    const tile = state.tray[s];
    if (tile == null) continue;
    for (let i = 0; i < state.board.length; i++) {
      if (state.board[i] == null) {
        const m = matchAt(bundle, state.board, i, tile, state.n);
        if (m) out.push({ action: { type: "place", slot: s, cell: i }, recipe: m.recipe });
      } else {
        const m = matchOn(bundle, state.board, i, tile, state.n);
        if (m) out.push({ action: { type: "drop-on", slot: s, cell: i }, recipe: m.recipe });
      }
    }
  }
  return out;
}

function firstEmpty(state: GameState): number {
  for (let i = 0; i < state.board.length; i++) if (state.board[i] == null) return i;
  return -1;
}

/** T-0274. Per-session outcome returned by `playOne`. `attempts` is the
 *  number of successful combines, used to compute attempts-per-discovery
 *  as a difficulty metric. `maxLocalLoop` is the longest run of
 *  same-output combines without a new discovery — a "stuck mining" proxy.
 *  `perOutputLoop` is the max same-output streak observed for each
 *  output (T-0280 trap tracking). */
interface GameOutcome {
  found: Set<string>;
  attempts: number;
  newFinds: number;
  maxLocalLoop: number;
  perOutputLoop: Map<string, number>;
}

/* ========================================================================
 * Dealer strategies (T-0279).
 *
 * Each strategy is a `(bundle) => WeightHook` factory. The returned hook
 * is installed via `setDealerWeightHook` and sees every `DealerView` that
 * flows through the engine. Hooks return a multiplier on the baseline
 * weight — 1 is a no-op, >1 boosts, <1 suppresses.
 *
 * The baseline strategy (null hook) leaves production behavior intact,
 * so its sim results reproduce the current dealer exactly.
 * ====================================================================== */
type Strategy = {
  id: string;
  describe: string;
  install: (bundle: ThemeBundle) => void;
};

const strategies: Strategy[] = [
  {
    id: "baseline",
    describe: "no override — today's dealer as-is",
    install: () => setDealerWeightHook(null),
  },
  {
    id: "creatability",
    describe:
      "down-weight tiles proportional to how many of their recipe outputs the player has already made",
    install: (bundle) => {
      // Precompute: for each tile, which recipes consume it as an input.
      const consumedBy = new Map<string, CombineRecipe[]>();
      for (const r of bundle.recipes) {
        for (const ing of r.all) {
          let bucket = consumedBy.get(ing);
          if (!bucket) {
            bucket = [];
            consumedBy.set(ing, bucket);
          }
          bucket.push(r);
        }
      }
      setDealerWeightHook((view) => {
        const found = view._foundSet ?? new Set(view.found);
        return (_view, tile) => {
          const recipes = consumedBy.get(tile);
          if (!recipes || recipes.length === 0) return 1;
          // Fraction of this tile's downstream outputs the player has
          // already made. A tile whose every recipe produces something
          // known gets down-weighted heavily; a tile with unseen recipes
          // left stays at 1.
          let made = 0;
          for (const r of recipes) if (found.has(r.out)) made++;
          const frac = made / recipes.length;
          // Multiplier: 1 when nothing new is reachable via boost, down
          // to 0.25 when every output is already found. Keeps a floor so
          // "all made" tiles still fire when they're the only option.
          return 1 - 0.75 * frac;
        };
      });
    },
  },
  {
    id: "aggressive-unfound",
    describe:
      "strongly boost tiles whose recipes still have unfound outputs; suppress fully-exhausted tiles",
    install: (bundle) => {
      const consumedBy = new Map<string, CombineRecipe[]>();
      for (const r of bundle.recipes) {
        for (const ing of r.all) {
          let bucket = consumedBy.get(ing);
          if (!bucket) {
            bucket = [];
            consumedBy.set(ing, bucket);
          }
          bucket.push(r);
        }
      }
      setDealerWeightHook((view) => {
        const found = view._foundSet ?? new Set(view.found);
        return (_view, tile) => {
          const recipes = consumedBy.get(tile);
          if (!recipes || recipes.length === 0) return 1;
          let unseen = 0;
          for (const r of recipes) if (!found.has(r.out)) unseen++;
          if (unseen === 0) return 0.1;
          return 1 + Math.min(2, unseen); // +1 per unseen downstream output, capped at +2.
        };
      });
    },
  },
];

function playOne(
  theme: ThemeKey,
  bundle: ThemeBundle,
  seed: number,
  maxMoves = 300,
): GameOutcome {
  const { state: s0 } = newGame(theme, bundle, { seed });
  let state = s0;
  // Keep a Set view of found items so scoring stays O(1) per lookup.
  let foundSet = new Set(state.found);
  const foundRecipe = (id: string) => foundSet.has(id);
  // T-0274 metrics. `combinesMade` is the number of successful combines
  // over the session (dealer attempts against `state.made`). Local loops
  // count the longest run of same-output combines without finding a new
  // item — a proxy for "player got stuck making the same thing".
  let combinesMade = 0;
  let newFindsCount = 0;
  let maxLocalLoopLen = 0;
  let curLocalLoopLen = 0;
  let lastOutput: string | null = null;
  // T-0280: per-output max loop length observed this session. Updated
  // whenever a same-output streak ends (or when a game ends with a
  // streak still active). Aggregated across games by the caller.
  const perOutputLoop = new Map<string, number>();
  const recordLoop = () => {
    if (lastOutput && curLocalLoopLen > 0) {
      const prev = perOutputLoop.get(lastOutput) ?? 0;
      if (curLocalLoopLen > prev) perOutputLoop.set(lastOutput, curLocalLoopLen);
    }
  };

  const localScore = (recipe: CombineRecipe): number => {
    let score = 0;
    if (!foundRecipe(recipe.out)) score += 500;
    const d = recipe.band - (state.chapter + 1);
    if (d === 0) score += 100;
    else if (d === 1) score += 60;
    else if (d === -1) score += 20;
    else if (d === -2) score += 10;
    score += recipe.all.length * 15;
    if (bundle.terminal.has(recipe.out)) score += 30;
    return score;
  };

  while (!state.over && state.moves < maxMoves) {
    if (state.choosing) {
      let bestIdx = 0;
      let bestScore = -Infinity;
      const opts = state.choosing.options;
      for (let k = 0; k < opts.length; k++) {
        const r = opts[k];
        const unseen = foundRecipe(r.out) ? 0 : 1000;
        const bandDelta = Math.abs(r.band - (state.chapter + 1));
        const sc = unseen - bandDelta * 10 + r.all.length * 5;
        if (sc > bestScore) {
          bestScore = sc;
          bestIdx = k;
        }
      }
      const r = reduce(state, bundle, { type: "choose", outputIndex: bestIdx });
      state = r.state;
      foundSet = new Set(state.found);
      continue;
    }

    const combines = enumerateCombines(state, bundle);
    let action: Action | null = null;

    if (combines.length) {
      let best = combines[0];
      let bestScore = localScore(best.recipe);
      for (let i = 1; i < combines.length; i++) {
        const sc = localScore(combines[i].recipe);
        if (sc > bestScore) {
          bestScore = sc;
          best = combines[i];
        }
      }
      action = best.action;
    } else if (state.swaps > 0) {
      action = { type: "swap" };
    } else {
      const e = firstEmpty(state);
      if (e < 0) break;
      let slot = -1;
      for (let s = 0; s < state.tray.length; s++) if (state.tray[s] != null) { slot = s; break; }
      if (slot < 0) break;
      action = { type: "place", slot, cell: e };
    }

    const beforeMade = state.made;
    const beforeFoundSize = foundSet.size;
    const r = reduce(state, bundle, action);
    state = r.state;
    foundSet = new Set(state.found);
    // Count combines (state.made ticks in finishResolve). A single action
    // can chain, which bumps made > 1; count each as one attempt.
    const delta = state.made - beforeMade;
    if (delta > 0) {
      combinesMade += delta;
      // Last produced output for local-loop tracking. We approximate
      // "same output" by comparing against the previous combine; if
      // the chain produced multiple outputs, use the terminal one.
      const lastEvt = r.events.slice().reverse().find((e) => e.type === "combine");
      const outNow =
        lastEvt && lastEvt.type === "combine" ? lastEvt.out : null;
      const grew = foundSet.size > beforeFoundSize;
      if (grew) {
        recordLoop();
        newFindsCount += foundSet.size - beforeFoundSize;
        curLocalLoopLen = 0;
        lastOutput = outNow;
      } else if (outNow && outNow === lastOutput) {
        curLocalLoopLen += delta;
        if (curLocalLoopLen > maxLocalLoopLen) maxLocalLoopLen = curLocalLoopLen;
      } else {
        recordLoop();
        curLocalLoopLen = delta;
        lastOutput = outNow;
      }
    }
  }
  // Flush the trailing streak when the game ends mid-loop.
  recordLoop();

  return {
    found: new Set(state.found),
    attempts: combinesMade,
    newFinds: newFindsCount,
    maxLocalLoop: maxLocalLoopLen,
    perOutputLoop,
  };
}

function pct(a: number, b: number): string {
  if (b === 0) return "0%";
  return ((a / b) * 100).toFixed(1) + "%";
}

function histogram(xs: number[], bins: number[]): Record<string, number> {
  const h: Record<string, number> = {};
  for (let i = 0; i < bins.length - 1; i++) h[`${bins[i]}-${bins[i + 1] - 1}`] = 0;
  h[`${bins[bins.length - 1]}+`] = 0;
  for (const x of xs) {
    let placed = false;
    for (let i = 0; i < bins.length - 1; i++) {
      if (x >= bins[i] && x < bins[i + 1]) {
        h[`${bins[i]}-${bins[i + 1] - 1}`]++;
        placed = true;
        break;
      }
    }
    if (!placed) h[`${bins[bins.length - 1]}+`]++;
  }
  return h;
}

interface StrategyReport {
  id: string;
  attemptsPerNewFind: number;
  loopP50: number;
  loopP90: number;
  loopP99: number;
  loopMax: number;
  finalCollection: number;
  totalOutputs: number;
  gamesTo50: number | null;
  gamesTo90: number | null;
}

function run(
  theme: ThemeKey,
  nGames: number,
  baseSeed: number,
  strategy: Strategy,
  bundle: ThemeBundle,
): StrategyReport {
  const totalOutputs = bundle.outputs.size;
  console.log(`\n== ${theme} · strategy=${strategy.id} ==`);
  console.log(`  ${strategy.describe}`);
  console.log(`Theme has ${totalOutputs} unique outputs (ingredients + terminals).`);
  console.log(`Running ${nGames} games…`);
  strategy.install(bundle);

  const perGameDiscoveries: number[] = [];
  const cumulative = new Set<string>();
  const cumulativeOverTime: number[] = []; // cumulative size after each game
  const firstSeenAtGame = new Map<string, number>(); // itemId → game index when first discovered
  const timesSeen = new Map<string, number>();
  // T-0274 metrics across sessions.
  const perGameAttempts: number[] = [];
  const perGameNewFinds: number[] = [];
  const perGameMaxLocalLoop: number[] = [];
  // T-0280 per-output trap tracking: for each output, keep the max
  // same-output streak seen *in any single game*. "Worst trap length
  // observed" is a more actionable metric than a mean across games.
  const perOutputMaxLoop = new Map<string, number>();

  for (let i = 0; i < nGames; i++) {
    const seed = (baseSeed ^ (i * 2654435761)) | 0;
    const outcome = playOne(theme, bundle, seed);
    const found = outcome.found;
    perGameDiscoveries.push(found.size);
    perGameAttempts.push(outcome.attempts);
    perGameNewFinds.push(outcome.newFinds);
    perGameMaxLocalLoop.push(outcome.maxLocalLoop);
    for (const [out, loop] of outcome.perOutputLoop) {
      const prev = perOutputMaxLoop.get(out) ?? 0;
      if (loop > prev) perOutputMaxLoop.set(out, loop);
    }
    for (const id of found) {
      timesSeen.set(id, (timesSeen.get(id) ?? 0) + 1);
      if (!cumulative.has(id)) {
        cumulative.add(id);
        firstSeenAtGame.set(id, i);
      }
    }
    cumulativeOverTime.push(cumulative.size);
    if ((i + 1) % Math.max(1, Math.floor(nGames / 10)) === 0) {
      console.log(
        `  game ${i + 1}/${nGames}  cumulative=${cumulative.size}/${totalOutputs} (${pct(cumulative.size, totalOutputs)})`,
      );
    }
  }

  // Per-game stats.
  const sorted = [...perGameDiscoveries].sort((a, b) => a - b);
  const mean = perGameDiscoveries.reduce((a, b) => a + b, 0) / perGameDiscoveries.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];

  console.log(`\nPer-game discoveries:`);
  console.log(`  mean=${mean.toFixed(1)}  median=${median}  min=${min}  max=${max}  p90=${p90}  p99=${p99}`);
  console.log(
    `  as % of theme: mean=${pct(mean, totalOutputs)}  max=${pct(max, totalOutputs)}`,
  );

  const bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 100, 120, 150];
  const h = histogram(perGameDiscoveries, bins);
  console.log(`  distribution:`);
  for (const [k, v] of Object.entries(h)) {
    const bar = "█".repeat(Math.round((v / nGames) * 50));
    console.log(`    ${k.padStart(7)} games=${String(v).padStart(5)} (${pct(v, nGames).padStart(6)}) ${bar}`);
  }

  // Cumulative collection milestones.
  console.log(`\nCumulative collection growth across games:`);
  const milestones = [0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1.0];
  for (const m of milestones) {
    const target = Math.ceil(totalOutputs * m);
    const idx = cumulativeOverTime.findIndex((v) => v >= target);
    if (idx < 0) {
      console.log(`  ${(m * 100).toFixed(0).padStart(3)}%  (${target}/${totalOutputs})  not reached in ${nGames} games`);
    } else {
      console.log(`  ${(m * 100).toFixed(0).padStart(3)}%  (${target}/${totalOutputs})  after game ${idx + 1}`);
    }
  }
  console.log(`\n  Final collection: ${cumulative.size}/${totalOutputs} (${pct(cumulative.size, totalOutputs)})`);

  // Growth curve snapshot.
  console.log(`\nCumulative over time (sampled):`);
  const samples = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  for (const s of samples) {
    if (s > nGames) break;
    const v = cumulativeOverTime[s - 1];
    const bar = "█".repeat(Math.round((v / totalOutputs) * 50));
    console.log(`  after ${String(s).padStart(5)} games: ${String(v).padStart(4)}/${totalOutputs} (${pct(v, totalOutputs).padStart(6)}) ${bar}`);
  }

  // T-0274 metrics: attempts-per-discovery + local-loop stats.
  const totalAttempts = perGameAttempts.reduce((a, b) => a + b, 0);
  const totalNewFinds = perGameNewFinds.reduce((a, b) => a + b, 0);
  const attemptsPerNewFind = totalNewFinds > 0 ? totalAttempts / totalNewFinds : NaN;
  const loopSorted = [...perGameMaxLocalLoop].sort((a, b) => a - b);
  const loopP50 = loopSorted[Math.floor(loopSorted.length / 2)] ?? 0;
  const loopP90 = loopSorted[Math.floor(loopSorted.length * 0.9)] ?? 0;
  const loopP99 = loopSorted[Math.floor(loopSorted.length * 0.99)] ?? 0;
  const loopMax = loopSorted[loopSorted.length - 1] ?? 0;
  console.log(`\nDealer-pressure metrics (T-0274):`);
  console.log(
    `  attempts/new-find: ${isNaN(attemptsPerNewFind) ? "n/a" : attemptsPerNewFind.toFixed(1)}  (${totalAttempts} combines across ${totalNewFinds} new discoveries)`,
  );
  console.log(
    `  max same-output loop per game: p50=${loopP50}  p90=${loopP90}  p99=${loopP99}  max=${loopMax}`,
  );
  console.log(
    `  (larger = players mine the same recipe before finding something new)`,
  );

  // Items still missing (if any).
  const missing = [...bundle.outputs].filter((id) => !cumulative.has(id));
  console.log(`\nMissing after ${nGames} games: ${missing.length} items`);
  if (missing.length > 0 && missing.length < 30) {
    for (const id of missing) {
      const name = bundle.items.get(id)?.name ?? id;
      // What recipes make this?
      const recipes = bundle.recipes.filter((r) => r.out === id);
      const bands = [...new Set(recipes.map((r) => r.band))].sort((a, b) => a - b);
      console.log(`  - ${name} (band ${bands.join(",")}): ${recipes.length} recipe(s)`);
    }
  }

  // Rarest-seen items (even if eventually found).
  const seenPairs = [...bundle.outputs].map((id) => ({
    id,
    name: bundle.items.get(id)?.name ?? id,
    seen: timesSeen.get(id) ?? 0,
  }));
  seenPairs.sort((a, b) => a.seen - b.seen);
  console.log(`\n20 rarest-seen items (times discovered across ${nGames} games):`);
  for (const p of seenPairs.slice(0, 20)) {
    const recipes = bundle.recipes.filter((r) => r.out === p.id);
    const bands = [...new Set(recipes.map((r) => r.band))].sort((a, b) => a - b);
    console.log(`  ${p.name.padEnd(20)} seen in ${String(p.seen).padStart(5)} games (${pct(p.seen, nGames)})  band ${bands.join(",")}`);
  }

  // T-0280: per-recipe local-mining traps. The outputs with the longest
  // observed same-output streaks are the places the dealer leaves
  // players grinding before a new partner tile shows up. Band is added
  // for context (deep bands can rightfully take longer).
  const trapPairs = [...perOutputMaxLoop.entries()]
    .map(([id, loop]) => {
      const recipes = bundle.recipes.filter((r) => r.out === id);
      const bands = [...new Set(recipes.map((r) => r.band))].sort((a, b) => a - b);
      return {
        id,
        name: bundle.items.get(id)?.name ?? id,
        loop,
        bands: bands.join(","),
      };
    })
    .sort((a, b) => b.loop - a.loop);
  console.log(`\n20 worst local-mining traps (max same-output streak observed):`);
  for (const t of trapPairs.slice(0, 20)) {
    console.log(`  ${t.name.padEnd(20)} max streak=${String(t.loop).padStart(4)}  band ${t.bands}`);
  }

  return {
    id: strategy.id,
    attemptsPerNewFind: isNaN(attemptsPerNewFind) ? Infinity : attemptsPerNewFind,
    loopP50,
    loopP90,
    loopP99,
    loopMax,
    finalCollection: cumulative.size,
    totalOutputs,
    gamesTo50: (() => {
      const t = Math.ceil(totalOutputs * 0.5);
      const idx = cumulativeOverTime.findIndex((v) => v >= t);
      return idx < 0 ? null : idx + 1;
    })(),
    gamesTo90: (() => {
      const t = Math.ceil(totalOutputs * 0.9);
      const idx = cumulativeOverTime.findIndex((v) => v >= t);
      return idx < 0 ? null : idx + 1;
    })(),
  };
}

function printComparison(reports: StrategyReport[]): void {
  if (reports.length < 2) return;
  console.log(`\n\n=========================`);
  console.log(`A/B comparison (T-0279)`);
  console.log(`=========================`);
  const cols = [
    { h: "strategy", w: 22, f: (r: StrategyReport) => r.id },
    {
      h: "att/find",
      w: 10,
      f: (r: StrategyReport) =>
        Number.isFinite(r.attemptsPerNewFind) ? r.attemptsPerNewFind.toFixed(2) : "n/a",
    },
    { h: "loop p50", w: 10, f: (r: StrategyReport) => String(r.loopP50) },
    { h: "loop p90", w: 10, f: (r: StrategyReport) => String(r.loopP90) },
    { h: "loop p99", w: 10, f: (r: StrategyReport) => String(r.loopP99) },
    { h: "loop max", w: 10, f: (r: StrategyReport) => String(r.loopMax) },
    {
      h: "final %",
      w: 10,
      f: (r: StrategyReport) =>
        ((r.finalCollection / r.totalOutputs) * 100).toFixed(1) + "%",
    },
    {
      h: "games→50",
      w: 10,
      f: (r: StrategyReport) => (r.gamesTo50 == null ? "—" : String(r.gamesTo50)),
    },
    {
      h: "games→90",
      w: 10,
      f: (r: StrategyReport) => (r.gamesTo90 == null ? "—" : String(r.gamesTo90)),
    },
  ];
  console.log(cols.map((c) => c.h.padEnd(c.w)).join(""));
  console.log(cols.map((c) => "-".repeat(c.w - 1).padEnd(c.w)).join(""));
  for (const r of reports) {
    console.log(cols.map((c) => c.f(r).padEnd(c.w)).join(""));
  }
  console.log(
    `\nLower att/find is better (fewer wasted combines per discovery); lower loop p90/p99 is better (less grind).`,
  );
}

const theme = (process.argv[2] as ThemeKey) || "everything";
const nGames = parseInt(process.argv[3] ?? "", 10) || 1000;
const baseSeed = parseInt(process.argv[4] ?? "", 10) || 0xC0FFEE;
const strategyArg = (process.argv[5] ?? "baseline").toLowerCase();
const requestedIds = strategyArg.split(",").map((s) => s.trim()).filter(Boolean);
const toRun =
  requestedIds.length === 1 && requestedIds[0] === "all"
    ? strategies
    : strategies.filter((s) => requestedIds.includes(s.id));
if (toRun.length === 0) {
  console.error(
    `Unknown strategy "${strategyArg}". Available: ${strategies.map((s) => s.id).join(", ")}, or "all".`,
  );
  process.exit(1);
}
const kb = loadKnowledgeBase();
const snap = buildSnapshot(toRows(kb));
const bundle = buildThemeBundle(snap, theme);
const reports: StrategyReport[] = [];
for (const s of toRun) {
  reports.push(run(theme, nGames, baseSeed, s, bundle));
}
setDealerWeightHook(null); // clean up module state on exit.
printComparison(reports);
