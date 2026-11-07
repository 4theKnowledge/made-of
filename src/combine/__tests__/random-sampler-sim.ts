/**
 * Thought-experiment sim: what if the Combine dealer sampled randomly from
 * the FULL theme item pool (ignoring bands), and progression was simply
 * "number of unique discoveries so far"? This tests the user's hypothesis
 * that removing the band=age gate + letting the board stay mixed naturally
 * produces discovery variety.
 *
 * We bypass deal.ts entirely with a custom dealer that:
 *   - Picks from ALL items in the theme (BASE ∪ outputs) uniformly OR
 *     from a "board-aware but band-free" pool (still prefers tiles that
 *     combine with the current board).
 *   - Accepts a tray as long as some tile combines within two placements,
 *     checked against the full recipe set (not band-filtered).
 *
 * The engine still runs as-is; we just replace the tray fill between moves.
 *
 * Reports:
 *   - Discoveries over time (unique finds vs. moves) — the "age counter"
 *     if ages become unique-count buckets.
 *   - Tray repetition the same way promote-sim measures it.
 *   - Combine success rate: what fraction of moves actually fire a combine?
 *
 * Run: npx tsx src/combine/__tests__/random-sampler-sim.ts [theme] [games] [maxMoves]
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
import { matchAt, matchOn, playsInOne, playsInTwo, type Board } from "../match";
import { pick, rand, type RngState } from "../rng";
import type { ThemeBundle, ThemeKey } from "../types";

type SamplerMode = "uniform" | "board-aware" | "found-aware";

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

/** Pick a tile from the full theme pool (no band gating). */
function pickRandomTile(
  bundle: ThemeBundle,
  mode: SamplerMode,
  board: Board,
  tray: Array<string | null>,
  rng: RngState,
  found: Set<string>,
  recentTrayTiles: Map<string, number>,
): string | null {
  // Candidate pool = everything playable in the theme that isn't a tool
  // we already have out, and isn't duplicated on the tray.
  const inTray = new Set(tray.filter((v): v is string => Boolean(v)));
  const onBoard = new Set(board.filter((v): v is string => Boolean(v)));
  const toolsOut = board.filter((x) => x != null && bundle.tools.has(x)).length;
  const MAX_TOOLS = 4;

  const base: string[] = [];
  for (const [id, item] of bundle.items) {
    if (bundle.tools.has(id)) {
      if (onBoard.has(id) || inTray.has(id) || toolsOut >= MAX_TOOLS) continue;
    }
    if (inTray.has(id)) continue;
    base.push(id);
  }
  if (!base.length) return null;

  if (mode === "uniform") {
    return pick(rng, base) ?? null;
  }

  if (mode === "board-aware") {
    // Prefer tiles that complete some recipe with a tile on the board.
    const partners: string[] = [];
    for (const r of bundle.recipes) {
      if (r.all.length < 2) continue;
      // Any ingredient already on-board?
      let hasOnBoard = false;
      for (const x of r.all) if (onBoard.has(x)) { hasOnBoard = true; break; }
      if (!hasOnBoard) continue;
      for (const x of r.all) {
        if (onBoard.has(x)) continue;
        if (inTray.has(x)) continue;
        if (bundle.tools.has(x) && (onBoard.has(x) || toolsOut >= MAX_TOOLS)) continue;
        partners.push(x);
      }
    }
    // 70% chance pick a partner, 30% pick raw (so we keep introducing new tiles).
    if (partners.length && rand(rng) < 0.7) return pick(rng, partners) ?? null;
    return pick(rng, base) ?? null;
  }

  // found-aware: like board-aware but strongly prefers UNFOUND outputs of candidate recipes.
  if (mode === "found-aware") {
    const toUnfound: string[] = [];
    const partners: string[] = [];
    for (const r of bundle.recipes) {
      if (r.all.length < 2) continue;
      let hasOnBoard = false;
      for (const x of r.all) if (onBoard.has(x)) { hasOnBoard = true; break; }
      if (!hasOnBoard) continue;
      const unfound = !found.has(r.out);
      for (const x of r.all) {
        if (onBoard.has(x)) continue;
        if (inTray.has(x)) continue;
        if (bundle.tools.has(x) && (onBoard.has(x) || toolsOut >= MAX_TOOLS)) continue;
        partners.push(x);
        if (unfound) toUnfound.push(x);
      }
    }
    if (toUnfound.length && rand(rng) < 0.6) return pick(rng, toUnfound) ?? null;
    if (partners.length && rand(rng) < 0.6) return pick(rng, partners) ?? null;
    // Dampen heavy-repeat tiles.
    const dampened = base.filter((x) => (recentTrayTiles.get(x) ?? 0) < 4);
    const pool = dampened.length ? dampened : base;
    return pick(rng, pool) ?? null;
  }

  return pick(rng, base) ?? null;
}

/** Custom tray filler. Writes next tray into `state.tray` in place.
 *  Checks that the resulting tray has at least a two-placement path to a
 *  combine; if 40 attempts fail, falls back to whatever it had. */
function fillTrayRandomly(
  state: GameState,
  bundle: ThemeBundle,
  mode: SamplerMode,
  recentTrayTiles: Map<string, number>,
): void {
  const found = new Set(state.found);
  const emptySlots: number[] = [];
  for (let i = 0; i < state.tray.length; i++) if (state.tray[i] == null) emptySlots.push(i);
  if (!emptySlots.length) return;

  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate: Array<string | null> = state.tray.slice();
    for (const slot of emptySlots) {
      candidate[slot] = pickRandomTile(
        bundle,
        mode,
        state.board,
        candidate,
        state.rng,
        found,
        recentTrayTiles,
      );
    }
    // Keep if the tray has a combine within two placements against this board.
    if (
      playsInOne(bundle, state.board, candidate, state.n) ||
      playsInTwo(bundle, state.board, candidate, state.n)
    ) {
      for (let i = 0; i < state.tray.length; i++) state.tray[i] = candidate[i];
      return;
    }
  }
  // Give up: use last attempt even if no combine.
  const candidate: Array<string | null> = state.tray.slice();
  for (const slot of emptySlots) {
    candidate[slot] = pickRandomTile(
      bundle,
      mode,
      state.board,
      candidate,
      state.rng,
      found,
      recentTrayTiles,
    );
  }
  for (let i = 0; i < state.tray.length; i++) state.tray[i] = candidate[i];
}

interface MoveOpt {
  action: Action;
  firstFind: boolean;
  recipeSize: number;
}

function enumerateMoves(state: GameState, bundle: ThemeBundle): MoveOpt[] {
  const out: MoveOpt[] = [];
  const empty = listEmpty(state.board);
  const occ = listOcc(state.board);
  const found = new Set(state.found);
  for (let s = 0; s < state.tray.length; s++) {
    const t = state.tray[s];
    if (t == null) continue;
    for (const i of empty) {
      const m = matchAt(bundle, state.board, i, t, state.n);
      if (m) out.push({
        action: { type: "place", slot: s, cell: i },
        firstFind: !found.has(m.recipe.out),
        recipeSize: m.recipe.all.length,
      });
    }
    for (const j of occ) {
      const m = matchOn(bundle, state.board, j, t, state.n);
      if (m) out.push({
        action: { type: "drop-on", slot: s, cell: j },
        firstFind: !found.has(m.recipe.out),
        recipeSize: m.recipe.all.length,
      });
    }
  }
  for (const j of occ) {
    const tile = state.board[j]!;
    const rs = (bundle.byIngredient.get(tile) ?? []).filter((r) => r.all.length === 1);
    if (!rs.length) continue;
    let firstFind = false;
    for (const r of rs) if (!found.has(r.out)) { firstFind = true; break; }
    out.push({ action: { type: "promote", cell: j }, firstFind, recipeSize: 1 });
  }
  return out;
}

interface RunResult {
  seed: number;
  mode: SamplerMode;
  moves: number;
  firstFindMoves: number[];  // move numbers at which each unique discovery happened
  discoveries: number;
  combines: number;
  promotes: number;
  noComboMoves: number;      // moves where no combine OR promote was available
  trayHistory: { tiles: string[]; move: number }[];
  endReason: "over" | "stuck" | "max-moves";
}

function playOne(
  theme: ThemeKey,
  bundle: ThemeBundle,
  seed: number,
  mode: SamplerMode,
  maxMoves: number,
): RunResult {
  const { state: s0 } = newGame(theme, bundle, { seed });
  let state = s0;

  // Replace the opening tray with our sampler's.
  for (let i = 0; i < state.tray.length; i++) state.tray[i] = null;
  const recentTrayTiles = new Map<string, number>();
  fillTrayRandomly(state, bundle, mode, recentTrayTiles);

  const result: RunResult = {
    seed,
    mode,
    moves: 0,
    firstFindMoves: [],
    discoveries: 0,
    combines: 0,
    promotes: 0,
    noComboMoves: 0,
    trayHistory: [
      {
        move: 0,
        tiles: state.tray.filter((v): v is string => Boolean(v)).slice().sort(),
      },
    ],
    endReason: "max-moves",
  };

  const bumpRecent = (tray: Array<string | null>) => {
    // Decay all counts.
    for (const [k, v] of recentTrayTiles) {
      const nv = v - 1;
      if (nv <= 0) recentTrayTiles.delete(k);
      else recentTrayTiles.set(k, nv);
    }
    for (const t of tray) if (t) recentTrayTiles.set(t, (recentTrayTiles.get(t) ?? 0) + 3);
  };
  bumpRecent(state.tray);

  let lastSig = state.tray.filter((v): v is string => Boolean(v)).slice().sort().join(",");

  while (!state.over && state.moves < maxMoves) {
    if (state.choosing) {
      const opts = state.choosing.options;
      let best = 0;
      let bestScore = -Infinity;
      const foundSet = new Set(state.found);
      for (let k = 0; k < opts.length; k++) {
        const r = opts[k];
        const sc = foundSet.has(r.out) ? 0 : 100;
        if (sc > bestScore) { bestScore = sc; best = k; }
      }
      const r = reduce(state, bundle, { type: "choose", outputIndex: best });
      state = r.state;
      for (const e of r.events) if (e.type === "discovery") {
        result.firstFindMoves.push(state.moves);
      }
      continue;
    }

    const moves = enumerateMoves(state, bundle);
    let action: Action | null = null;
    if (moves.length) {
      // Score: prefer first-find, else bigger recipe, else promote last.
      moves.sort((a, b) => {
        const sa = (a.firstFind ? 100 : 0) + a.recipeSize * 10 + (a.action.type === "promote" ? -5 : 0);
        const sb = (b.firstFind ? 100 : 0) + b.recipeSize * 10 + (b.action.type === "promote" ? -5 : 0);
        return sb - sa;
      });
      action = moves[0].action;
    } else {
      result.noComboMoves++;
      // Place anywhere empty to get past this tray.
      const empty = listEmpty(state.board);
      let placed = false;
      for (let s = 0; s < state.tray.length; s++) {
        if (state.tray[s] == null) continue;
        if (!empty.length) break;
        action = { type: "place", slot: s, cell: empty[0] };
        placed = true;
        break;
      }
      if (!placed) { result.endReason = "stuck"; break; }
    }

    const prev = state;
    const r = reduce(prev, bundle, action!);
    state = r.state;

    if (action!.type === "promote") result.promotes++;
    for (const e of r.events) {
      if (e.type === "combine") result.combines++;
      if (e.type === "discovery") result.firstFindMoves.push(state.moves);
    }

    // After the engine's own dealer fills the tray, OVERRIDE with our sampler.
    // The engine always refills tray slots that are null post-move, so we
    // reset first then re-fill.
    // (Only override if the tray actually changed vs our custom-filled.)
    // Detect: the engine's dealTray ran, so clear and re-pick.
    for (let i = 0; i < state.tray.length; i++) state.tray[i] = null;
    fillTrayRandomly(state, bundle, mode, recentTrayTiles);
    bumpRecent(state.tray);

    const sig = state.tray.filter((v): v is string => Boolean(v)).slice().sort().join(",");
    if (sig !== lastSig) {
      result.trayHistory.push({
        move: state.moves,
        tiles: state.tray.filter((v): v is string => Boolean(v)).slice().sort(),
      });
      lastSig = sig;
    }
  }

  if (state.over) result.endReason = "over";
  result.moves = state.moves;
  result.discoveries = state.found.length;
  return result;
}

/* ---------- Metrics ---------- */

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function nameOf(bundle: ThemeBundle, id: string): string {
  return bundle.items.get(id)?.name ?? id;
}

/** Moves needed to reach N discoveries, averaged across runs. */
function movesToNDiscoveries(runs: RunResult[], n: number): number {
  const xs: number[] = [];
  for (const r of runs) {
    if (r.firstFindMoves.length >= n) xs.push(r.firstFindMoves[n - 1]);
  }
  if (!xs.length) return NaN;
  return mean(xs);
}

function trayRepetition(trays: { tiles: string[] }[]): {
  distinctTiles: number;
  mostRepeatedCount: number;
  exactRepeats: number;
} {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const t of trays) for (const tile of t.tiles) {
    seen.add(tile);
    counts.set(tile, (counts.get(tile) ?? 0) + 1);
  }
  let mostRep = 0;
  for (const c of counts.values()) if (c > mostRep) mostRep = c;
  const sigs = new Map<string, number>();
  let exact = 0;
  for (const t of trays) {
    const sig = t.tiles.join(",");
    const prior = sigs.get(sig) ?? 0;
    if (prior > 0) exact++;
    sigs.set(sig, prior + 1);
  }
  return { distinctTiles: seen.size, mostRepeatedCount: mostRep, exactRepeats: exact };
}

function report(label: string, runs: RunResult[], bundle: ThemeBundle) {
  console.log(`\n=== ${label}  (n=${runs.length}) ===`);
  console.log(
    `  mean discoveries=${mean(runs.map((r) => r.discoveries)).toFixed(1)}  ` +
    `moves=${mean(runs.map((r) => r.moves)).toFixed(0)}  ` +
    `combines=${mean(runs.map((r) => r.combines)).toFixed(1)}  ` +
    `promotes=${mean(runs.map((r) => r.promotes)).toFixed(1)}  ` +
    `no-combo-moves=${mean(runs.map((r) => r.noComboMoves)).toFixed(1)}  ` +
    `combo-move-rate=${(
      (mean(runs.map((r) => r.combines + r.promotes))) /
      Math.max(1, mean(runs.map((r) => r.moves)))
    ).toFixed(2)}`,
  );
  const reasons: Record<string, number> = {};
  for (const r of runs) reasons[r.endReason] = (reasons[r.endReason] ?? 0) + 1;
  console.log("  end reasons:", reasons);

  // Moves to reach discovery milestones.
  const milestones = [5, 10, 20, 30, 50, 75, 100];
  const row: string[] = [];
  for (const m of milestones) {
    const v = movesToNDiscoveries(runs, m);
    row.push(`n=${m}: ${isNaN(v) ? "—" : v.toFixed(0)}`);
  }
  console.log("  moves to reach n discoveries:", row.join("  "));

  // Repetition metrics averaged across runs.
  const perRun = runs.map((r) => trayRepetition(r.trayHistory));
  console.log(
    `  tray repetition: distinct=${mean(perRun.map((m) => m.distinctTiles)).toFixed(1)}  ` +
    `most-repeated=${mean(perRun.map((m) => m.mostRepeatedCount)).toFixed(1)}  ` +
    `exact-repeats=${mean(perRun.map((m) => m.exactRepeats)).toFixed(1)}  ` +
    `trays-per-run=${mean(runs.map((r) => r.trayHistory.length)).toFixed(1)}`,
  );

  // Top tiles dealt across all runs.
  const tileCounts = new Map<string, number>();
  for (const r of runs) for (const t of r.trayHistory) for (const tile of t.tiles) {
    tileCounts.set(tile, (tileCounts.get(tile) ?? 0) + 1);
  }
  const totalPool = bundle.items.size;
  const seenTiles = tileCounts.size;
  console.log(`  tile coverage: ${seenTiles}/${totalPool} items seen across all ${runs.length} runs (${((seenTiles / totalPool) * 100).toFixed(0)}%)`);
  const top = [...tileCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([id, c]) => `${nameOf(bundle, id)}(${c})`).join(", ");
  console.log(`  top tiles: ${top}`);

  // Per-run histogram: how many times does each tile appear in trays over
  // a single game? Average per-tile count, bucketed by frequency.
  // Also reports the distribution of unique-tiles-seen per run.
  const uniquePerRun: number[] = [];
  const bucketsAllRuns: Record<string, number> = {
    "0": 0, "1": 0, "2-3": 0, "4-7": 0, "8-15": 0, "16-31": 0, "32-63": 0, "64+": 0,
  };
  for (const r of runs) {
    const perRunCounts = new Map<string, number>();
    for (const t of r.trayHistory) for (const tile of t.tiles) {
      perRunCounts.set(tile, (perRunCounts.get(tile) ?? 0) + 1);
    }
    uniquePerRun.push(perRunCounts.size);
    // Count tiles across the ENTIRE theme pool, including 0-count tiles.
    for (const id of bundle.items.keys()) {
      const c = perRunCounts.get(id) ?? 0;
      if (c === 0) bucketsAllRuns["0"]++;
      else if (c === 1) bucketsAllRuns["1"]++;
      else if (c <= 3) bucketsAllRuns["2-3"]++;
      else if (c <= 7) bucketsAllRuns["4-7"]++;
      else if (c <= 15) bucketsAllRuns["8-15"]++;
      else if (c <= 31) bucketsAllRuns["16-31"]++;
      else if (c <= 63) bucketsAllRuns["32-63"]++;
      else bucketsAllRuns["64+"]++;
    }
  }
  console.log(`  unique tiles seen per run: min=${Math.min(...uniquePerRun)}  mean=${mean(uniquePerRun).toFixed(0)}  max=${Math.max(...uniquePerRun)}  (of ${totalPool} total)`);
  // Normalize bucket counts to per-run averages.
  console.log(`  per-run tile-frequency histogram (averaged across ${runs.length} runs, over ${totalPool}-item pool):`);
  const barMax = Math.max(...Object.values(bucketsAllRuns));
  for (const [bucket, count] of Object.entries(bucketsAllRuns)) {
    const perRun = count / runs.length;
    const bar = "█".repeat(Math.round((count / barMax) * 40));
    console.log(`    appearances in run = ${bucket.padStart(5)}:  ${perRun.toFixed(1).padStart(6)} tiles  ${bar}`);
  }
}

/* ---------- Main ---------- */

async function main() {
  const theme = (process.argv[2] as ThemeKey) || "everything";
  const games = parseInt(process.argv[3] ?? "", 10) || 20;
  const maxMoves = parseInt(process.argv[4] ?? "", 10) || 400;

  const kb = loadKnowledgeBase();
  const rows = toRows(kb);
  const snap = buildSnapshot(rows);
  const bundle = buildThemeBundle(snap, theme);

  console.log(
    `Theme: ${bundle.theme.name}  items=${bundle.items.size}  recipes=${bundle.recipes.length}  outputs=${bundle.outputs.size}`,
  );

  const modes: SamplerMode[] = ["uniform", "board-aware", "found-aware"];
  for (const mode of modes) {
    const runs: RunResult[] = [];
    for (let i = 0; i < games; i++) {
      const seed = 0xDECAFBAD ^ (i * 2654435761);
      runs.push(playOne(theme, bundle, seed, mode, maxMoves));
    }
    report(`Mode: ${mode}`, runs, bundle);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
