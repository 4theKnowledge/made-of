/**
 * Headless Combine simulator — plays many games with a "reasonable player"
 * heuristic to measure age pacing, discoveries, premature mixing, and
 * stuck/game-over behaviour. Run with:
 *
 *   npx tsx src/combine/__tests__/simulate.ts [theme] [games]
 *
 * Defaults: theme=everything, games=50.
 */

import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import {
  newGame,
  reduce,
  type Action,
  type Event,
  type GameState,
} from "../engine";
import { matchAt, matchOn, type Board } from "../match";
import type { ThemeBundle, ThemeKey } from "../types";

interface MoveOption {
  action: Action;
  priority: number; // bigger is better
  recipeSize: number;
  outputBand: number;
  willShip: boolean;
}

function listEmpty(board: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] == null) out.push(i);
  return out;
}

function listNonEmpty(board: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < board.length; i++) if (board[i] != null) out.push(i);
  return out;
}

/** Find all playable moves (place-on-empty or drop-on-tile that combines).
 *  Also non-combine placements, as a fallback. */
function enumerateMoves(state: GameState, bundle: ThemeBundle): {
  combines: MoveOption[];
  placements: MoveOption[];
} {
  const combines: MoveOption[] = [];
  const placements: MoveOption[] = [];
  const empty = listEmpty(state.board);
  const occ = listNonEmpty(state.board);

  for (let s = 0; s < state.tray.length; s++) {
    const tile = state.tray[s];
    if (tile == null) continue;

    // Place on an empty cell with a match.
    for (const i of empty) {
      const m = matchAt(bundle, state.board, i, tile, state.n);
      if (m) {
        const band = m.recipe.band;
        const willShip = bundle.terminal.has(m.recipe.out);
        combines.push({
          action: { type: "place", slot: s, cell: i },
          priority: 1000 + m.recipe.all.length * 10 - Math.abs(band - (state.chapter + 1)) * 5,
          recipeSize: m.recipe.all.length,
          outputBand: band,
          willShip,
        });
      }
    }

    // Drop on an occupied cell for a match.
    for (const j of occ) {
      const m = matchOn(bundle, state.board, j, tile, state.n);
      if (m) {
        const band = m.recipe.band;
        const willShip = bundle.terminal.has(m.recipe.out);
        combines.push({
          action: { type: "drop-on", slot: s, cell: j },
          priority: 1000 + m.recipe.all.length * 10 - Math.abs(band - (state.chapter + 1)) * 5,
          recipeSize: m.recipe.all.length,
          outputBand: band,
          willShip,
        });
      }
    }

    // Non-combine placements.
    for (const i of empty) {
      placements.push({
        action: { type: "place", slot: s, cell: i },
        priority: 0,
        recipeSize: 0,
        outputBand: 0,
        willShip: false,
      });
    }
  }

  return { combines, placements };
}

interface AgeStats {
  age: number;
  ageName: string;
  movesInAge: number;
  madesInAge: number;
  discoveriesInAge: number;
  entered: boolean;
}

interface GameRun {
  seed: number;
  theme: ThemeKey;
  moves: number;
  score: number;
  made: number;
  discoveries: number;
  longestChain: number;
  finalAge: number;
  reachedAges: number;
  endReason: "over" | "stuck" | "max-moves";
  perAge: AgeStats[];
  // Count of combines by (output band vs current age) at the moment of the match.
  mixByAgeDelta: Record<string, number>;
  // How many moves spent in each age before advancing or dying.
  movesPerAge: number[];
  // Discoveries per age.
  discoveriesPerAge: number[];
  // Age index when game ended.
  endedAtAge: number;
  // Did the player ever face a choosing prompt? Count how often.
  choicePrompts: number;
  // Crumbles events.
  crumbles: number;
}

/** Policy knobs for the simulated player. */
interface PlayerPolicy {
  /** Prefer current-age (band == age+1) combines over earlier/later. */
  preferCurrentAge: boolean;
  /** Prefer bigger (more ingredients) recipes. */
  preferLargeRecipes: boolean;
  /** Tiebreak randomness. */
  randomTiebreak: boolean;
}

function playOne(
  theme: ThemeKey,
  bundle: ThemeBundle,
  seed: number,
  policy: PlayerPolicy,
  maxMoves = 400,
): GameRun {
  const { state: s0 } = newGame(theme, bundle, { seed });
  let state = s0;

  const numAges = bundle.theme.ages.length;
  const movesPerAge = Array(numAges).fill(0);
  const discoveriesPerAge = Array(numAges).fill(0);
  const madesPerAge = Array(numAges).fill(0);
  const mixByAgeDelta: Record<string, number> = {};

  let choicePrompts = 0;
  let crumbles = 0;
  let endReason: GameRun["endReason"] = "max-moves";

  const applyEvents = (evs: Event[]) => {
    for (const e of evs) {
      if (e.type === "combine") {
        const delta = e.mult; // not useful here
        void delta;
        // Age delta: output band minus (age+1 at time of combine)
      }
      if (e.type === "crumble") crumbles += e.cells.length;
    }
  };

  // Simple scorer for picking combines.
  const scoreOption = (opt: MoveOption, state: GameState): number => {
    let score = 0;
    const currentBand = state.chapter + 1;
    const d = opt.outputBand - currentBand;
    if (policy.preferCurrentAge) {
      // Prefer d==0 strongly, d==-1 fine, d>=1 penalise (premature).
      if (d === 0) score += 200;
      else if (d === -1) score += 60;
      else if (d <= -2) score += 20;
      else if (d === 1) score += 80; // moving ahead a bit is fine
      else score += 0; // large jumps = premature
    }
    if (policy.preferLargeRecipes) score += opt.recipeSize * 25;
    if (opt.willShip) score += 100;
    if (policy.randomTiebreak) score += Math.random() * 5;
    return score;
  };

  while (!state.over && state.moves < maxMoves) {
    // Handle any pending choice prompt.
    if (state.choosing) {
      choicePrompts++;
      // Pick the option whose output is unfound OR the one closest to the
      // current band.
      const opts = state.choosing.options;
      let bestIdx = 0;
      let bestScore = -Infinity;
      for (let k = 0; k < opts.length; k++) {
        const r = opts[k];
        const unseen = state.found.includes(r.out) ? 0 : 50;
        const bandDelta = Math.abs(r.band - (state.chapter + 1));
        const sc = unseen - bandDelta * 10;
        if (sc > bestScore) {
          bestScore = sc;
          bestIdx = k;
        }
      }
      const prev = state;
      const { state: ns, events } = reduce(prev, bundle, {
        type: "choose",
        outputIndex: bestIdx,
      });
      state = ns;
      applyEvents(events);
      for (const e of events) {
        if (e.type === "combine") {
          const d = (prev.choosing?.options[bestIdx].band ?? 0) - (prev.chapter + 1);
          const key = d >= 0 ? `+${d}` : `${d}`;
          mixByAgeDelta[key] = (mixByAgeDelta[key] ?? 0) + 1;
        }
        if (e.type === "discovery") discoveriesPerAge[prev.chapter] =
          (discoveriesPerAge[prev.chapter] ?? 0) + 1;
      }
      continue;
    }

    const { combines, placements } = enumerateMoves(state, bundle);

    // Pick best move: combine if available, else swap (if any), else place.
    let action: Action | null = null;
    let chosenOpt: MoveOption | null = null;
    if (combines.length) {
      combines.sort((a, b) => scoreOption(b, state) - scoreOption(a, state));
      chosenOpt = combines[0];
      action = chosenOpt.action;
    } else if (state.swaps > 0 && placements.length > 2) {
      // If no combine but tray has >=2 options and we have swaps, try swap
      // first a couple of times before giving up.
      action = { type: "swap" };
    } else if (placements.length) {
      // Place somewhere to try to open things up (pick a corner-ish empty).
      // Pick the empty cell with fewest filled neighbours.
      // Just use the first for simplicity.
      placements.sort((a, b) => Math.random() - 0.5);
      action = placements[0].action;
    } else {
      // No moves and no placements: stuck.
      endReason = "stuck";
      break;
    }

    if (!action) {
      endReason = "stuck";
      break;
    }

    const prev = state;
    const { state: ns, events } = reduce(prev, bundle, action);
    state = ns;
    movesPerAge[prev.chapter] = (movesPerAge[prev.chapter] ?? 0) + 1;
    applyEvents(events);
    for (const e of events) {
      if (e.type === "combine") {
        const band = chosenOpt?.outputBand ?? 0;
        const d = band - (prev.chapter + 1);
        const key = d >= 0 ? `+${d}` : `${d}`;
        mixByAgeDelta[key] = (mixByAgeDelta[key] ?? 0) + 1;
        madesPerAge[prev.chapter] = (madesPerAge[prev.chapter] ?? 0) + 1;
      }
      if (e.type === "discovery") discoveriesPerAge[prev.chapter] =
        (discoveriesPerAge[prev.chapter] ?? 0) + 1;
    }
  }

  if (state.over) endReason = "over";

  const perAge: AgeStats[] = bundle.theme.ages.map((name, i) => ({
    age: i,
    ageName: name,
    movesInAge: movesPerAge[i] ?? 0,
    madesInAge: madesPerAge[i] ?? 0,
    discoveriesInAge: discoveriesPerAge[i] ?? 0,
    entered: i <= state.chapter,
  }));

  return {
    seed,
    theme,
    moves: state.moves,
    score: state.score,
    made: state.made,
    discoveries: state.found.length,
    longestChain: state.longest,
    finalAge: state.chapter,
    reachedAges: state.chapter + 1,
    endReason,
    perAge,
    mixByAgeDelta,
    movesPerAge,
    discoveriesPerAge,
    endedAtAge: state.chapter,
    choicePrompts,
    crumbles,
  };
}

function pct(a: number, b: number): string {
  if (b === 0) return "0%";
  return ((a / b) * 100).toFixed(0) + "%";
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function reportRuns(label: string, runs: GameRun[], bundle: ThemeBundle) {
  console.log(`\n=== ${label}  (n=${runs.length}) ===`);
  console.log(`Discoveries  mean=${mean(runs.map((r) => r.discoveries)).toFixed(1)}  median=${median(runs.map((r) => r.discoveries))}  min=${Math.min(...runs.map((r) => r.discoveries))}  max=${Math.max(...runs.map((r) => r.discoveries))}`);
  console.log(`Made (count) mean=${mean(runs.map((r) => r.made)).toFixed(1)}  median=${median(runs.map((r) => r.made))}`);
  console.log(`Moves        mean=${mean(runs.map((r) => r.moves)).toFixed(1)}  median=${median(runs.map((r) => r.moves))}`);
  console.log(`Score        mean=${mean(runs.map((r) => r.score)).toFixed(0)}`);
  console.log(`Longest chain mean=${mean(runs.map((r) => r.longestChain)).toFixed(2)}`);
  console.log(`Final age (0..${bundle.theme.ages.length - 1})  mean=${mean(runs.map((r) => r.finalAge)).toFixed(2)}  median=${median(runs.map((r) => r.finalAge))}`);
  const endReasons: Record<string, number> = {};
  for (const r of runs) endReasons[r.endReason] = (endReasons[r.endReason] ?? 0) + 1;
  console.log("End reasons:", endReasons);

  // Age reach distribution.
  const reach = bundle.theme.ages.map((_, i) => runs.filter((r) => r.finalAge >= i).length);
  console.log(
    "Reach by age:",
    bundle.theme.ages
      .map((n, i) => `${n}=${reach[i]}/${runs.length} (${pct(reach[i], runs.length)})`)
      .join("  "),
  );

  // Per-age avg moves and avg discoveries.
  const avgMovesPerAge = bundle.theme.ages.map((_, i) =>
    mean(runs.filter((r) => r.finalAge >= i).map((r) => r.movesPerAge[i] ?? 0)),
  );
  const avgMadesPerAge = bundle.theme.ages.map((_, i) =>
    mean(runs.filter((r) => r.finalAge >= i).map((r) => r.perAge[i]?.madesInAge ?? 0)),
  );
  const avgDiscoveriesPerAge = bundle.theme.ages.map((_, i) =>
    mean(runs.filter((r) => r.finalAge >= i).map((r) => r.discoveriesPerAge[i] ?? 0)),
  );
  console.log("Per age (among players who entered):");
  bundle.theme.ages.forEach((n, i) => {
    const need = 6 + 2 * i;
    console.log(
      `  age ${i} ${n.padEnd(12)} | makes-needed=${need}  avg-makes=${avgMadesPerAge[i].toFixed(1)}  avg-moves=${avgMovesPerAge[i].toFixed(1)}  avg-discoveries=${avgDiscoveriesPerAge[i].toFixed(1)}`,
    );
  });

  // Premature-mixing / age-delta histogram.
  const agg: Record<string, number> = {};
  for (const r of runs)
    for (const [k, v] of Object.entries(r.mixByAgeDelta))
      agg[k] = (agg[k] ?? 0) + v;
  const total = Object.values(agg).reduce((a, b) => a + b, 0);
  console.log("Combine output vs current age (delta = output_band - (age+1)):");
  const keys = Object.keys(agg).sort((a, b) => parseInt(a) - parseInt(b));
  for (const k of keys) {
    console.log(`  Δ=${k.padStart(3)}  n=${agg[k]}  (${pct(agg[k], total)})`);
  }
}

function catalogueInfo(bundle: ThemeBundle) {
  const byBand = new Map<number, Set<string>>();
  for (const r of bundle.recipes) {
    if (!byBand.has(r.band)) byBand.set(r.band, new Set());
    byBand.get(r.band)!.add(r.out);
  }
  console.log(`Theme: ${bundle.theme.name}`);
  console.log(`Total recipes: ${bundle.recipes.length}`);
  console.log(`Total unique outputs: ${bundle.outputs.size}`);
  console.log(`Terminal outputs: ${bundle.terminal.size}`);
  console.log("Outputs per band (= age):");
  const ages = bundle.theme.ages;
  for (let b = 1; b <= ages.length; b++) {
    const n = byBand.get(b)?.size ?? 0;
    const recipes = bundle.recipes.filter((r) => r.band === b).length;
    const need = 6 + 2 * (b - 1);
    console.log(`  band ${b} ${ages[b - 1].padEnd(12)} | makes-needed-to-exit=${need}  outputs=${n}  recipes=${recipes}`);
  }
}

async function main() {
  const theme = (process.argv[2] as ThemeKey) || "everything";
  const nGames = parseInt(process.argv[3] ?? "", 10) || 50;

  const kb = loadKnowledgeBase();
  const rows = toRows(kb);
  const snap = buildSnapshot(rows);
  const bundle = buildThemeBundle(snap, theme);

  catalogueInfo(bundle);

  // Policy A: naive — grab anything that combines (no age preference, prefer big recipes).
  const policyA: PlayerPolicy = {
    preferCurrentAge: false,
    preferLargeRecipes: true,
    randomTiebreak: true,
  };
  // Policy B: age-aware — prefer current-age combines (simulates a careful player).
  const policyB: PlayerPolicy = {
    preferCurrentAge: true,
    preferLargeRecipes: true,
    randomTiebreak: true,
  };

  const runsA: GameRun[] = [];
  const runsB: GameRun[] = [];
  for (let i = 0; i < nGames; i++) {
    const seed = 0xC0FFEE ^ (i * 2654435761);
    runsA.push(playOne(theme, bundle, seed, policyA));
    runsB.push(playOne(theme, bundle, seed, policyB));
  }
  reportRuns("Policy A: naive (grab-anything)", runsA, bundle);
  reportRuns("Policy B: age-aware (prefer current band)", runsB, bundle);

  // Deep dive on a single game under policy A to see the arc.
  console.log("\n--- Trace: one Policy A game (seed 0) ---");
  traceOne(theme, bundle, 0xC0FFEE, policyA);
}

function traceOne(
  theme: ThemeKey,
  bundle: ThemeBundle,
  seed: number,
  policy: PlayerPolicy,
) {
  const { state: s0 } = newGame(theme, bundle, { seed });
  let state = s0;
  const nameOf = (id: string) => bundle.items.get(id)?.name ?? id;
  const bandOf = (id: string): number => {
    let min = 999;
    for (const r of bundle.recipes) if (r.out === id && r.band < min) min = r.band;
    return min === 999 ? 0 : min;
  };

  const scoreOption = (opt: MoveOption, state: GameState): number => {
    let score = 0;
    const currentBand = state.chapter + 1;
    const d = opt.outputBand - currentBand;
    if (policy.preferCurrentAge) {
      if (d === 0) score += 200;
      else if (d === -1) score += 60;
      else if (d <= -2) score += 20;
      else if (d === 1) score += 80;
      else score += 0;
    }
    if (policy.preferLargeRecipes) score += opt.recipeSize * 25;
    if (opt.willShip) score += 100;
    if (policy.randomTiebreak) score += Math.random() * 5;
    return score;
  };

  let move = 0;
  while (!state.over && state.moves < 300 && move < 300) {
    move++;
    if (state.choosing) {
      const { state: ns } = reduce(state, bundle, { type: "choose", outputIndex: 0 });
      state = ns;
      continue;
    }
    const { combines, placements } = enumerateMoves(state, bundle);
    let action: Action | null = null;
    if (combines.length) {
      combines.sort((a, b) => scoreOption(b, state) - scoreOption(a, state));
      action = combines[0].action;
    } else if (state.swaps > 0) action = { type: "swap" };
    else if (placements.length) action = placements[0].action;
    else break;

    const prev = state;
    const { state: ns, events } = reduce(prev, bundle, action);
    state = ns;
    for (const e of events) {
      if (e.type === "combine") {
        const band = bandOf(e.out);
        const first = !prev.found.includes(e.out);
        const inputsNames = e.inputs.map(nameOf).join("+");
        console.log(
          `  m${state.moves.toString().padStart(3)} chapter=${prev.chapter} → ${inputsNames} ⇒ ${nameOf(e.out)} [band ${band}] ${first ? "NEW" : ""} chain=${e.mult}`,
        );
      }
      if (e.type === "age-up") console.log(`  >>> CHAPTER UP → ${e.age}`);
      if (e.type === "shipped") console.log(`  m${state.moves} shipped ${nameOf(e.out)} +${e.bonus}`);
      if (e.type === "crumble") console.log(`  m${state.moves} crumbled ${e.cells.length} tile(s)`);
      if (e.type === "over") console.log(`  m${state.moves} GAME OVER (board full)`);
    }
  }
  console.log(
    `  → ended: age=${state.chapter}/${bundle.theme.ages.length - 1} discoveries=${state.found.length} made=${state.made} moves=${state.moves}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
