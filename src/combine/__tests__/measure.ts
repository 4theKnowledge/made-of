/**
 * Measure how long a Combine daily run takes by driving the real reducer
 * with a reasonable auto-player. Used to pick `dailyConfig` values that
 * land near a target playtime for a theme.
 *
 * Unlike `simulate.ts` (which is a behaviour-analysis dump), this harness
 * is designed to actually complete games: when no combine is available, it
 * escalates through swap → hold → clear → wipe-board → placement so the
 * run doesn't stall out at move 47.
 *
 *   npx tsx src/combine/__tests__/measure.ts [maxAges] [games]
 *
 * Defaults: maxAges=5 games=30.
 */

import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import type { DailyConfig } from "../daily-config";
import {
  hasAnyLegalAction,
  newGame,
  reduce,
  WIPE_UNLOCK_CHAPTER,
  type Action,
  type GameState,
} from "../engine";
import { matchAt, matchOn, type Board } from "../match";
import type { ThemeBundle, ThemeKey } from "../types";

export interface RunStats {
  seed: number;
  moves: number;
  score: number;
  finalAge: number;
  completed: boolean;
  firstFinds: number;
  made: number;
  movesPerAge: number[];
  endReason: "over" | "stuck" | "max-moves";
}

export interface MeasureResult {
  runs: RunStats[];
  p50Moves: number;
  p90Moves: number;
  meanMoves: number;
  completionRate: number;
  p50FirstFinds: number;
  meanFinalAge: number;
}

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

interface ScoredAction {
  action: Action;
  priority: number;
  outputBand?: number;
}

/** Enumerate every combine the tray can produce right now, scored for how
 *  much we want to play it (prefer current-age first-finds > current-age
 *  repeats > next-age > off-band). */
function enumerateCombines(state: GameState, bundle: ThemeBundle): ScoredAction[] {
  const out: ScoredAction[] = [];
  const empty = listEmpty(state.board);
  const occ = listOcc(state.board);
  const currentBand = state.chapter + 1;

  const scoreCombine = (band: number, _outputId: string, firstFind: boolean): number => {
    const d = band - currentBand;
    let s = 0;
    if (d === 0) s += 200;
    else if (d === -1) s += 80;
    else if (d <= -2) s += 20;
    else if (d === 1) s += 60;
    else s += 5;
    if (firstFind) s += 150;
    return s;
  };

  for (let slot = 0; slot < state.tray.length; slot++) {
    const tile = state.tray[slot];
    if (tile == null) continue;

    for (const i of empty) {
      const m = matchAt(bundle, state.board, i, tile, state.n);
      if (!m) continue;
      const firstFind = !state.found.includes(m.recipe.out);
      out.push({
        action: { type: "place", slot, cell: i },
        priority: scoreCombine(m.recipe.band, m.recipe.out, firstFind),
        outputBand: m.recipe.band,
      });
    }
    for (const j of occ) {
      const m = matchOn(bundle, state.board, j, tile, state.n);
      if (!m) continue;
      const firstFind = !state.found.includes(m.recipe.out);
      out.push({
        action: { type: "drop-on", slot, cell: j },
        priority: scoreCombine(m.recipe.band, m.recipe.out, firstFind),
        outputBand: m.recipe.band,
      });
    }
  }
  return out;
}

/** Non-combine placements. Used as a last-resort fallback. */
function enumeratePlacements(state: GameState): ScoredAction[] {
  const out: ScoredAction[] = [];
  const empty = listEmpty(state.board);
  for (let slot = 0; slot < state.tray.length; slot++) {
    if (state.tray[slot] == null) continue;
    for (const i of empty) {
      out.push({ action: { type: "place", slot, cell: i }, priority: 0 });
    }
  }
  return out;
}

/** Escalation ladder for a stuck state. Returns the first helper that looks
 *  viable, or null if we've truly run out. */
function pickHelper(state: GameState): Action | null {
  // Swap is cheap and often re-opens a combine.
  if (state.swaps > 0) return { type: "swap" };
  // Hold: stash a tray tile to free pressure if hold has space.
  if (state.hold.some((h) => h == null)) {
    for (let slot = 0; slot < state.tray.length; slot++) {
      if (state.tray[slot] != null) return { type: "hold", slot };
    }
  }
  // Clear: nuke one occupied cell to open space.
  if (state.clears > 0) {
    const occ = listOcc(state.board);
    if (occ.length) return { type: "clear", cell: occ[0] };
  }
  // Wipe is a last resort (costs an age) and only unlocks from a certain age.
  if (state.chapter >= WIPE_UNLOCK_CHAPTER) return { type: "wipe-board" };
  return null;
}

export function playOne(
  theme: ThemeKey,
  bundle: ThemeBundle,
  seed: number,
  maxMoves = 3000,
): RunStats {
  const { state: s0 } = newGame(theme, bundle, { seed });
  let state = s0;
  const numAges = bundle.theme.ages.length;
  const movesPerAge = Array(numAges).fill(0);
  let firstFinds = 0;
  let endReason: RunStats["endReason"] = "max-moves";

  // Safety: if the same move count is seen 10 times in a row with no state
  // change, bail. Shouldn't happen if the escalation ladder is correct, but
  // protects against infinite loops in weird bundle shapes.
  let lastMove = -1;
  let repeat = 0;

  while (!state.over && state.moves < maxMoves) {
    if (state.moves === lastMove) {
      repeat++;
      if (repeat > 10) {
        endReason = "stuck";
        break;
      }
    } else {
      lastMove = state.moves;
      repeat = 0;
    }

    // Resolve pending choice first.
    if (state.choosing) {
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
      const { state: ns, events } = reduce(state, bundle, {
        type: "choose",
        outputIndex: bestIdx,
      });
      state = ns;
      for (const e of events) if (e.type === "discovery") firstFinds++;
      continue;
    }

    let action: Action | null = null;

    const combines = enumerateCombines(state, bundle);
    if (combines.length) {
      combines.sort((a, b) => b.priority - a.priority);
      action = combines[0].action;
    } else {
      // No combine — try a helper to re-open the board before falling back
      // to a non-combine placement. Short-circuits stall-outs.
      action = pickHelper(state);
      if (!action) {
        const placements = enumeratePlacements(state);
        if (placements.length) {
          action = placements[0].action;
        } else if (!hasAnyLegalAction(state, bundle)) {
          endReason = "stuck";
          break;
        } else {
          endReason = "stuck";
          break;
        }
      }
    }

    const prevAge = state.chapter;
    const { state: ns, events } = reduce(state, bundle, action);
    state = ns;
    movesPerAge[prevAge] = (movesPerAge[prevAge] ?? 0) + 1;
    for (const e of events) if (e.type === "discovery") firstFinds++;
  }

  if (state.over) endReason = "over";

  return {
    seed,
    moves: state.moves,
    score: state.score,
    finalAge: state.chapter,
    completed: state.over && state.chapter === numAges - 1,
    firstFinds,
    made: state.made,
    movesPerAge,
    endReason,
  };
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Measure a bundle's daily playtime across N seeded runs. */
export function measureDailyLength(
  theme: ThemeKey,
  bundle: ThemeBundle,
  seeds: number[],
  maxMoves = 3000,
): MeasureResult {
  const runs = seeds.map((s) => playOne(theme, bundle, s, maxMoves));
  const moves = runs.map((r) => r.moves);
  return {
    runs,
    p50Moves: percentile(moves, 50),
    p90Moves: percentile(moves, 90),
    meanMoves: mean(moves),
    completionRate: runs.filter((r) => r.completed).length / runs.length,
    p50FirstFinds: percentile(
      runs.map((r) => r.firstFinds),
      50,
    ),
    meanFinalAge: mean(runs.map((r) => r.finalAge)),
  };
}

/** CLI entry point for ad-hoc sweeps. */
async function main() {
  const maxAges = parseInt(process.argv[2] ?? "", 10) || 5;
    const games = parseInt(process.argv[4] ?? "", 10) || 30;

  const kb = loadKnowledgeBase();
  const snap = buildSnapshot(toRows(kb));
  const cfg: DailyConfig = { maxAges };
  const bundle = buildThemeBundle(snap, "everything", 0, "daily", cfg);

  const seeds = Array.from({ length: games }, (_, i) => 0xC0FFEE ^ (i * 2654435761));
  const result = measureDailyLength("everything", bundle, seeds);

  console.log(`\nEverything daily  maxAges=${maxAges}`);
  console.log(`  ages in bundle:      ${bundle.theme.ages.length}`);
  console.log(`  recipes in bundle:   ${bundle.recipes.length}`);
  console.log(`  n games:             ${result.runs.length}`);
  console.log(`  completion rate:     ${(result.completionRate * 100).toFixed(0)}%`);
  console.log(`  moves p50:           ${result.p50Moves}`);
  console.log(`  moves p90:           ${result.p90Moves}`);
  console.log(`  moves mean:          ${result.meanMoves.toFixed(0)}`);
  console.log(`  mean final age:      ${result.meanFinalAge.toFixed(2)} / ${bundle.theme.ages.length - 1}`);
  console.log(`  p50 first-finds:     ${result.p50FirstFinds}`);

  // At 1.5 moves/sec assumed pace, an "enjoyable 15 min" target lands
  // around 1350 moves. Report that comparison explicitly.
  const targetMoves = 15 * 60 * 1.5;
  const p50Min = result.p50Moves / 1.5 / 60;
  const p90Min = result.p90Moves / 1.5 / 60;
  console.log(`\n  @ 1.5 moves/sec assumed pace:`);
  console.log(`    p50 playtime: ${p50Min.toFixed(1)} min`);
  console.log(`    p90 playtime: ${p90Min.toFixed(1)} min`);
  console.log(`    target:       15 min  (~${targetMoves} moves)`);

  const endReasons: Record<string, number> = {};
  for (const r of result.runs) endReasons[r.endReason] = (endReasons[r.endReason] ?? 0) + 1;
  console.log("\n  end reasons:", endReasons);
}

// Only run as CLI when invoked directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
