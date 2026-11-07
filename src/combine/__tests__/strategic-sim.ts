/**
 * Strategic Combine simulator (T-0162).
 *
 * Fills the fidelity gap in `promote-sim.ts` by modelling hold, helpers,
 * undo, and 1-step lookahead. The "strategic" player still doesn't
 * think deeply, but it uses the full action vocabulary the engine exposes,
 * so the sim is a better stand-in for how a thoughtful human plays.
 *
 * Decisions per turn, in priority order:
 *   1. If the tray has a combine → pick the best one (lookahead: prefer
 *      combines whose output lands next to a partner already on the
 *      board, or starts a chain).
 *   2. Else if a board tile can be promoted and the output is unfound
 *      → promote (costs a turn, banks a discovery).
 *   3. Else if a tray tile is worth banking (unfound promote reachable
 *      on-board, or is a key partner for a piled tile) and hold has
 *      capacity → hold it.
 *   4. Else if swap is available and the tray has no useful move → swap.
 *   5. Else if the board has a dominant pile with no incoming partner
 *      and wipe/clear is available → use the targeted helper.
 *   6. Else place the least-bad tile to open the board.
 *   7. After the move, if the state is worse (fewer legal combines) and
 *      undo is available and no discovery fired → undo.
 *
 * Run:  npx tsx src/combine/__tests__/strategic-sim.ts [theme] [games] [maxMoves]
 */

import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import {
  holdCapacity,
  newGame,
  reduce,
  type Action,
  type Event,
  type GameState,
} from "../engine";
import { matchAt, matchOn, type Board } from "../match";
import type { ThemeBundle, ThemeKey } from "../types";

interface CombineOpt {
  action: Action;
  outputId: string;
  recipeSize: number;
  outputBand: number;
  firstFind: boolean;
  isChain: boolean; // output tile would land next to a known partner
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

/** Would placing `tile` at `cell` on `board` set up a follow-up combine? */
function looksChainy(
  bundle: ThemeBundle,
  board: Board,
  cell: number,
  tile: string,
  size: number,
): boolean {
  const simulated = board.slice();
  simulated[cell] = tile;
  // A chain follow-up: does the new tile itself match somewhere adjacent?
  const m = matchAt(bundle, simulated, cell, tile, size);
  return !!m;
}

function enumerateCombines(state: GameState, bundle: ThemeBundle): CombineOpt[] {
  const out: CombineOpt[] = [];
  const empty = listEmpty(state.board);
  const occ = listOcc(state.board);
  const found = new Set(state.found);

  // Tray + hold are both valid sources.
  const sources: Array<{ slot: number; tile: string; source: "tray" | "hold" }> = [];
  for (let s = 0; s < state.tray.length; s++) {
    const t = state.tray[s];
    if (t) sources.push({ slot: s, tile: t, source: "tray" });
  }
  for (let s = 0; s < state.hold.length; s++) {
    const t = state.hold[s];
    if (t) sources.push({ slot: s, tile: t, source: "hold" });
  }

  for (const { slot, tile, source } of sources) {
    for (const i of empty) {
      const m = matchAt(bundle, state.board, i, tile, state.n);
      if (m) {
        out.push({
          action: { type: "place", slot, cell: i, source },
          outputId: m.recipe.out,
          recipeSize: m.recipe.all.length,
          outputBand: m.recipe.band,
          firstFind: !found.has(m.recipe.out),
          isChain: looksChainy(bundle, state.board, i, m.recipe.out, state.n),
        });
      }
    }
    for (const j of occ) {
      const m = matchOn(bundle, state.board, j, tile, state.n);
      if (m) {
        out.push({
          action: { type: "drop-on", slot, cell: j, source },
          outputId: m.recipe.out,
          recipeSize: m.recipe.all.length,
          outputBand: m.recipe.band,
          firstFind: !found.has(m.recipe.out),
          isChain: looksChainy(bundle, state.board, j, m.recipe.out, state.n),
        });
      }
    }
  }
  return out;
}

interface PromoteOpt {
  action: Action;
  cell: number;
  outputs: string[];
  firstFind: boolean;
}

function enumeratePromotes(state: GameState, bundle: ThemeBundle): PromoteOpt[] {
  const out: PromoteOpt[] = [];
  const found = new Set(state.found);
  const occ = listOcc(state.board);
  for (const j of occ) {
    const tile = state.board[j]!;
    const rs = (bundle.byIngredient.get(tile) ?? []).filter((r) => r.all.length === 1);
    if (!rs.length) continue;
    let firstFind = false;
    for (const r of rs) if (!found.has(r.out)) { firstFind = true; break; }
    out.push({
      action: { type: "promote", cell: j },
      cell: j,
      outputs: rs.map((r) => r.out),
      firstFind,
    });
  }
  return out;
}

function scoreCombine(opt: CombineOpt, state: GameState): number {
  let s = 0;
  const currentBand = state.age + 1;
  const d = opt.outputBand - currentBand;
  // On-band first.
  if (d === 0) s += 200;
  else if (d === 1) s += 90;
  else if (d === -1) s += 50;
  else if (d >= 2) s += 15;
  else s += 25;
  if (opt.firstFind) s += 300;
  if (opt.recipeSize >= 2) s += 40;
  if (opt.isChain) s += 80;
  s += Math.random() * 3;
  return s;
}

/** True if a tray tile is worth banking into hold:
 *  - it can promote into an unfound output,
 *  - or it's the sole partner for a piled tile and the tray can't close that right now,
 *  - or every tray move right now is strictly worse (burn-to-raw placements only). */
function worthHolding(
  tile: string,
  state: GameState,
  bundle: ThemeBundle,
): "promote" | "partner" | null {
  // Case 1: promote-later.
  const promoteRecipes = (bundle.byIngredient.get(tile) ?? []).filter((r) => r.all.length === 1);
  const found = new Set(state.found);
  for (const r of promoteRecipes) {
    if (!found.has(r.out)) return "promote";
  }
  // Case 2: this tile partners a piled board tile.
  const counts = new Map<string, number>();
  for (const v of state.board) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  const heavy = [...counts.entries()].filter(([, c]) => c >= 2).map(([id]) => id);
  if (heavy.length) {
    for (const r of bundle.recipes) {
      if (r.all.length < 2) continue;
      if (!r.all.includes(tile)) continue;
      for (const pile of heavy) if (r.all.includes(pile)) return "partner";
    }
  }
  return null;
}

/* ---------- Metrics ---------- */

interface Run {
  seed: number;
  finalAge: number;
  moves: number;
  firstFindMoves: number[];
  discoveries: number;
  made: number;
  endReason: "over" | "stuck" | "max-moves";
  // helper usage
  holds: number;
  swaps: number;
  clears: number;
  hints: number;
  pluck: number;
  shore: number;
  wipes: number;
  undos: number;
  // move composition
  combines: number;
  promotes: number;
  rawPlacements: number;
  // tray history (for repetition metric)
  trayHistory: { move: number; age: number; tiles: string[] }[];
}

interface Policy {
  useHold: boolean;
  useHelpers: boolean;
  useUndo: boolean;
  useLookahead: boolean;
}

const POLICIES: Record<string, Policy> = {
  greedy: { useHold: false, useHelpers: false, useUndo: false, useLookahead: false },
  strategic: { useHold: true, useHelpers: true, useUndo: true, useLookahead: true },
};

function playOne(
  theme: ThemeKey,
  bundle: ThemeBundle,
  seed: number,
  policy: Policy,
  maxMoves: number,
): Run {
  const { state: s0 } = newGame(theme, bundle, { seed });
  let state = s0;
  const run: Run = {
    seed, finalAge: 0, moves: 0, firstFindMoves: [], discoveries: 0, made: 0,
    endReason: "max-moves",
    holds: 0, swaps: 0, clears: 0, hints: 0, pluck: 0, shore: 0, wipes: 0, undos: 0,
    combines: 0, promotes: 0, rawPlacements: 0,
    trayHistory: [
      { move: 0, age: state.age, tiles: state.tray.filter((v): v is string => Boolean(v)).slice().sort() },
    ],
  };

  let lastTraySig = run.trayHistory[0].tiles.join(",");

  const recordTray = () => {
    const tiles = state.tray.filter((v): v is string => Boolean(v)).slice().sort();
    const sig = tiles.join(",");
    if (sig !== lastTraySig) {
      run.trayHistory.push({ move: state.moves, age: state.age, tiles });
      lastTraySig = sig;
    }
  };

  const applyReduce = (act: Action) => {
    const prev = state;
    const r = reduce(prev, bundle, act);
    state = r.state;
    for (const e of r.events) {
      if (e.type === "discovery") run.firstFindMoves.push(state.moves);
      if (e.type === "combine") run.combines++;
      if (e.type === "wipe") run.wipes++;
    }
    return r.events;
  };

  while (!state.over && state.moves < maxMoves) {
    if (state.choosing) {
      // Prefer first-find.
      const opts = state.choosing.options;
      let best = 0, bestScore = -Infinity;
      for (let k = 0; k < opts.length; k++) {
        const r = opts[k];
        const sc = (state.found.includes(r.out) ? 0 : 100) - Math.abs(r.band - (state.age + 1)) * 10;
        if (sc > bestScore) { bestScore = sc; best = k; }
      }
      applyReduce({ type: "choose", outputIndex: best });
      continue;
    }

    const prevState = state;
    const combines = enumerateCombines(state, bundle);
    const promotes = enumeratePromotes(state, bundle);

    let action: Action | null = null;

    // 1. Combine (best scored).
    if (combines.length) {
      combines.sort((a, b) => scoreCombine(b, state) - scoreCombine(a, state));
      action = combines[0].action;
    }
    // 2. Promote for a first-find.
    else if (promotes.some((p) => p.firstFind)) {
      const p = promotes.find((p) => p.firstFind)!;
      action = p.action;
    }
    // 3. Hold a tray tile worth banking (strategic only).
    else if (policy.useHold) {
      const holdSlots = state.hold.filter((v) => v == null).length;
      if (holdSlots > 0) {
        for (let s = 0; s < state.tray.length; s++) {
          const t = state.tray[s];
          if (!t) continue;
          const reason = worthHolding(t, state, bundle);
          if (reason) {
            action = { type: "hold", slot: s };
            break;
          }
        }
      }
    }

    // 4. Swap when nothing in tray combines + no useful hold (strategic).
    if (!action && policy.useHelpers && state.swaps > 0) {
      // Only swap if the tray has no first-find promote option either.
      action = { type: "swap" };
    }

    // 5. Wipe or clear if board is overstuffed with one tile and nothing else works.
    if (!action && policy.useHelpers && state.clears > 0) {
      const counts = new Map<string, number>();
      for (const v of state.board) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
      let worst: { tile: string; count: number; cell: number } | null = null;
      for (const [tile, count] of counts) {
        if (count < 3) continue;
        // Find a cell with that tile.
        for (let i = 0; i < state.board.length; i++) {
          if (state.board[i] === tile) {
            if (!worst || count > worst.count) worst = { tile, count, cell: i };
            break;
          }
        }
      }
      if (worst) action = { type: "clear", cell: worst.cell };
    }

    // 6. Else place something anywhere empty (least-bad burn).
    if (!action) {
      const empty = listEmpty(state.board);
      for (let s = 0; s < state.tray.length; s++) {
        if (state.tray[s] == null) continue;
        if (!empty.length) break;
        action = { type: "place", slot: s, cell: empty[0] };
        run.rawPlacements++;
        break;
      }
    }

    if (!action) { run.endReason = "stuck"; break; }

    // Track counters before applying.
    const preDisc = state.found.length;
    if (action.type === "hold") run.holds++;
    if (action.type === "swap") run.swaps++;
    if (action.type === "clear") run.clears++;
    if (action.type === "hint") run.hints++;
    if (action.type === "promote") run.promotes++;

    const beforeLegal = combines.length;
    applyReduce(action);

    // 7. Undo if strictly worse (strategic only).
    if (
      policy.useUndo &&
      state.undos > 0 &&
      state.lastSnapshot &&
      state.found.length === preDisc
    ) {
      const nextCombines = enumerateCombines(state, bundle);
      if (nextCombines.length < beforeLegal - 1) {
        applyReduce({ type: "undo" });
        run.undos++;
        continue; // try again
      }
    }

    recordTray();
  }

  if (state.over) run.endReason = "over";
  run.finalAge = state.age;
  run.moves = state.moves;
  run.discoveries = state.found.length;
  run.made = state.made;
  return run;
}

/* ---------- Report ---------- */

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function nameOf(bundle: ThemeBundle, id: string): string { return bundle.items.get(id)?.name ?? id; }

function movesToN(runs: Run[], n: number): number {
  const xs: number[] = [];
  for (const r of runs) if (r.firstFindMoves.length >= n) xs.push(r.firstFindMoves[n - 1]);
  if (!xs.length) return NaN;
  return mean(xs);
}

function trayMetrics(trays: { tiles: string[] }[]): {
  distinct: number;
  mostRepeated: number;
  exactRepeats: number;
} {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const sigs = new Map<string, number>();
  let exact = 0;
  for (const t of trays) {
    for (const tile of t.tiles) {
      seen.add(tile);
      counts.set(tile, (counts.get(tile) ?? 0) + 1);
    }
    const sig = t.tiles.join(",");
    const prior = sigs.get(sig) ?? 0;
    if (prior > 0) exact++;
    sigs.set(sig, prior + 1);
  }
  let maxc = 0;
  for (const c of counts.values()) if (c > maxc) maxc = c;
  return { distinct: seen.size, mostRepeated: maxc, exactRepeats: exact };
}

function report(label: string, runs: Run[], bundle: ThemeBundle) {
  console.log(`\n=== ${label}  (n=${runs.length}) ===`);
  const reasons: Record<string, number> = {};
  for (const r of runs) reasons[r.endReason] = (reasons[r.endReason] ?? 0) + 1;
  console.log(
    `  discoveries=${mean(runs.map((r) => r.discoveries)).toFixed(1)}  final-age=${mean(runs.map((r) => r.finalAge)).toFixed(2)}  moves=${mean(runs.map((r) => r.moves)).toFixed(0)}  made=${mean(runs.map((r) => r.made)).toFixed(0)}`,
  );
  console.log(`  end reasons:`, reasons);
  console.log(
    `  moves/N: n=10 ${movesToN(runs, 10).toFixed(0)}  n=20 ${movesToN(runs, 20).toFixed(0)}  n=30 ${movesToN(runs, 30).toFixed(0)}  n=50 ${movesToN(runs, 50).toFixed(0)}  n=75 ${movesToN(runs, 75).toFixed(0)}`,
  );
  console.log(
    `  helpers used: hold=${mean(runs.map((r) => r.holds)).toFixed(1)}  swap=${mean(runs.map((r) => r.swaps)).toFixed(1)}  clear=${mean(runs.map((r) => r.clears)).toFixed(1)}  promote=${mean(runs.map((r) => r.promotes)).toFixed(1)}  undo=${mean(runs.map((r) => r.undos)).toFixed(1)}`,
  );
  console.log(
    `  move mix: combines=${mean(runs.map((r) => r.combines)).toFixed(1)}  promotes=${mean(runs.map((r) => r.promotes)).toFixed(1)}  raw-placements=${mean(runs.map((r) => r.rawPlacements)).toFixed(1)}`,
  );

  // Tray repetition averaged per run.
  const perRun = runs.map((r) => trayMetrics(r.trayHistory));
  console.log(
    `  tray repetition: distinct=${mean(perRun.map((m) => m.distinct)).toFixed(1)}  most-repeated=${mean(perRun.map((m) => m.mostRepeated)).toFixed(1)}  exact-repeats=${mean(perRun.map((m) => m.exactRepeats)).toFixed(1)}  trays-per-run=${mean(runs.map((r) => r.trayHistory.length)).toFixed(1)}`,
  );

  // Per-run tile-frequency histogram vs the full pool.
  const totalPool = bundle.items.size;
  const buckets: Record<string, number> = { "0": 0, "1": 0, "2-3": 0, "4-7": 0, "8-15": 0, "16-31": 0, "32-63": 0, "64+": 0 };
  const uniquePerRun: number[] = [];
  for (const r of runs) {
    const perRunCounts = new Map<string, number>();
    for (const t of r.trayHistory) for (const tile of t.tiles) perRunCounts.set(tile, (perRunCounts.get(tile) ?? 0) + 1);
    uniquePerRun.push(perRunCounts.size);
    for (const id of bundle.items.keys()) {
      const c = perRunCounts.get(id) ?? 0;
      if (c === 0) buckets["0"]++;
      else if (c === 1) buckets["1"]++;
      else if (c <= 3) buckets["2-3"]++;
      else if (c <= 7) buckets["4-7"]++;
      else if (c <= 15) buckets["8-15"]++;
      else if (c <= 31) buckets["16-31"]++;
      else if (c <= 63) buckets["32-63"]++;
      else buckets["64+"]++;
    }
  }
  console.log(`  unique tiles per run: min=${Math.min(...uniquePerRun)}  mean=${mean(uniquePerRun).toFixed(0)}  max=${Math.max(...uniquePerRun)}  (of ${totalPool})`);
  const barMax = Math.max(...Object.values(buckets));
  console.log(`  tile-frequency histogram (per-run avg):`);
  for (const [bucket, count] of Object.entries(buckets)) {
    const bar = "█".repeat(Math.round((count / barMax) * 40));
    console.log(`    appearances = ${bucket.padStart(5)}:  ${(count / runs.length).toFixed(1).padStart(6)} tiles  ${bar}`);
  }
}

/* ---------- Main ---------- */

async function main() {
  const theme = (process.argv[2] as ThemeKey) || "everything";
  const games = parseInt(process.argv[3] ?? "", 10) || 30;
  const maxMoves = parseInt(process.argv[4] ?? "", 10) || 400;

  const kb = loadKnowledgeBase();
  const rows = toRows(kb);
  const snap = buildSnapshot(rows);
  const bundle = buildThemeBundle(snap, theme);
  console.log(`Theme: ${bundle.theme.name}  items=${bundle.items.size}  recipes=${bundle.recipes.length}`);

  for (const [name, policy] of Object.entries(POLICIES)) {
    const runs: Run[] = [];
    for (let i = 0; i < games; i++) {
      const seed = 0xBEEFFACE ^ (i * 2654435761);
      runs.push(playOne(theme, bundle, seed, policy, maxMoves));
    }
    report(`Policy: ${name}`, runs, bundle);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
