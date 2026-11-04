/**
 * How "action-packed" does fast mode actually feel on a 6x6?
 *
 * Builds the fast bundle, simulates many games with a greedy-combo policy,
 * and reports:
 *   - combines per game, combines per move
 *   - fraction of moves where at least one combine was available
 *   - average number of available combines when the player chose
 *   - how often the game ends "stuck" (no moves) vs runs to a cap
 *   - top-out score distribution
 *
 * Also inspects a freshly-dealt board (no play) to measure static density:
 *   - pct of tiles that pair with at least one other on-board tile
 *   - avg distinct combinable pairs per board
 *
 * Run: npx tsx src/combine/__tests__/fast-sim.ts [games] [maxMoves]
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
import type { ThemeBundle } from "../types";

function listEmpty(b: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) if (b[i] == null) out.push(i);
  return out;
}
function listOcc(b: Board): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) if (b[i] != null) out.push(i);
  return out;
}

interface Move {
  action: Action;
  size: number;
  out: string;
}

function enumerateCombines(state: GameState, bundle: ThemeBundle): Move[] {
  const out: Move[] = [];
  const empty = listEmpty(state.board);
  const occ = listOcc(state.board);
  for (let s = 0; s < state.tray.length; s++) {
    const tile = state.tray[s];
    if (tile == null) continue;
    for (const i of empty) {
      const m = matchAt(bundle, state.board, i, tile, state.n);
      if (m)
        out.push({
          action: { type: "place", slot: s, cell: i },
          size: m.recipe.all.length,
          out: m.recipe.out,
        });
    }
    for (const j of occ) {
      const m = matchOn(bundle, state.board, j, tile, state.n);
      if (m)
        out.push({
          action: { type: "drop-on", slot: s, cell: j },
          size: m.recipe.all.length,
          out: m.recipe.out,
        });
    }
  }
  return out;
}

function enumeratePlacements(state: GameState): Action[] {
  const out: Action[] = [];
  const empty = listEmpty(state.board);
  for (let s = 0; s < state.tray.length; s++) {
    if (state.tray[s] == null) continue;
    for (const i of empty) out.push({ type: "place", slot: s, cell: i });
  }
  return out;
}

/** Count distinct unordered combinable pairs among tiles currently on the
 *  board. Each pair counted once regardless of how many cells it occupies. */
function boardCombinablePairs(
  state: GameState,
  bundle: ThemeBundle,
): { pairs: number; tilesWithPartner: number; tiles: number } {
  const tilesOnBoard = new Set<string>();
  for (const c of state.board) if (c) tilesOnBoard.add(c);
  const arr = [...tilesOnBoard];
  let pairs = 0;
  const partnered = new Set<string>();
  for (let i = 0; i < arr.length; i++) {
    for (let j = i; j < arr.length; j++) {
      // A pair recipe must have exactly these two tiles as its ingredient set.
      const key = [arr[i], arr[j]].sort().join("+");
      const rs = bundle.sameIngredients.get(key);
      if (rs && rs.length > 0) {
        pairs++;
        partnered.add(arr[i]);
        partnered.add(arr[j]);
      }
    }
  }
  return { pairs, tilesWithPartner: partnered.size, tiles: arr.length };
}

interface GameStats {
  moves: number;
  combines: number;
  score: number;
  movesWithOption: number;
  sumAvailableCombines: number;
  endedStuck: boolean;
  avgPairsOnBoardSample: number; // sampled every N moves
  pairSamples: number;
}

function runOne(bundle: ThemeBundle, maxMoves: number, seed: number): GameStats {
  const { state: s0 } = newGame("everything", bundle, { seed });
  let state = s0;
  const stats: GameStats = {
    moves: 0,
    combines: 0,
    score: 0,
    movesWithOption: 0,
    sumAvailableCombines: 0,
    endedStuck: false,
    avgPairsOnBoardSample: 0,
    pairSamples: 0,
  };

  while (stats.moves < maxMoves && !state.over) {
    // Sample board density every 5 moves.
    if (stats.moves % 5 === 0) {
      const { pairs } = boardCombinablePairs(state, bundle);
      stats.avgPairsOnBoardSample += pairs;
      stats.pairSamples++;
    }

    const combines = enumerateCombines(state, bundle);
    let action: Action | null = null;
    if (combines.length > 0) {
      stats.movesWithOption++;
      stats.sumAvailableCombines += combines.length;
      // Greedy: take any combine. Sort by size desc (bigger clears first,
      // though fast mode is all size 2 anyway).
      combines.sort((a, b) => b.size - a.size);
      action = combines[0].action;
    } else {
      // No combine available — make an arbitrary placement to advance.
      const placements = enumeratePlacements(state);
      if (placements.length === 0) {
        stats.endedStuck = true;
        break;
      }
      action = placements[0];
    }
    const result = reduce(state, bundle, action);
    state = result.state;
    stats.moves++;
    // Auto-resolve picker (fast mode has no multi-output decisions on 2-part
    // alts? Let's handle it generically.)
    while (state.choosing) {
      const next = reduce(state, bundle, { type: "choose", outputIndex: 0 });
      state = next.state;
    }
    for (const e of result.events as Event[]) {
      if (e.type === "combine") stats.combines++;
    }
  }
  stats.score = state.score;
  if (state.over) stats.endedStuck = true;
  return stats;
}

function pct(n: number, d: number): string {
  if (d === 0) return "0%";
  return ((n / d) * 100).toFixed(1) + "%";
}
function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function p(nums: number[], q: number): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.floor(q * s.length));
  return s[i];
}

async function main() {
  const games = parseInt(process.argv[2] ?? "200", 10);
  const maxMoves = parseInt(process.argv[3] ?? "200", 10);

  const rows = toRows(loadKnowledgeBase());
  const snap = buildSnapshot(rows);
  const fast = buildThemeBundle(snap, "everything", 0, "fast");

  console.log(`Fast bundle: ${fast.recipes.length} recipes, ${fast.outputs.size} outputs, ${fast.base.length} base ingredients`);
  console.log(`Simulating ${games} games, cap ${maxMoves} moves each.\n`);

  const results: GameStats[] = [];
  for (let g = 0; g < games; g++) {
    results.push(runOne(fast, maxMoves, 1000 + g));
  }

  const moves = results.map((r) => r.moves);
  const combines = results.map((r) => r.combines);
  const scores = results.map((r) => r.score);
  const comboRate = results.map((r) => (r.moves ? r.combines / r.moves : 0));
  const optionRate = results.map((r) =>
    r.moves ? r.movesWithOption / r.moves : 0,
  );
  const avgAvail = results.map((r) =>
    r.movesWithOption ? r.sumAvailableCombines / r.movesWithOption : 0,
  );
  const stuck = results.filter((r) => r.endedStuck).length;
  const avgPairs = results.map((r) =>
    r.pairSamples ? r.avgPairsOnBoardSample / r.pairSamples : 0,
  );

  console.log("== Per-game aggregates ==");
  console.log(`  moves:              avg ${avg(moves).toFixed(1)}  p50 ${p(moves, 0.5)}  p95 ${p(moves, 0.95)}`);
  console.log(`  combines:           avg ${avg(combines).toFixed(1)}  p50 ${p(combines, 0.5)}  p95 ${p(combines, 0.95)}`);
  console.log(`  score:              avg ${avg(scores).toFixed(0)}  p50 ${p(scores, 0.5)}  p95 ${p(scores, 0.95)}`);
  console.log(`  combines/move:      avg ${(avg(comboRate) * 100).toFixed(1)}%`);
  console.log(`  moves with option:  avg ${(avg(optionRate) * 100).toFixed(1)}%`);
  console.log(`  avail combines:     avg ${avg(avgAvail).toFixed(1)} per move-with-option`);
  console.log(`  avg pairs on board: avg ${avg(avgPairs).toFixed(1)} (unique tile pairs)`);
  console.log(`  ended stuck:        ${stuck}/${games}  (${pct(stuck, games)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
