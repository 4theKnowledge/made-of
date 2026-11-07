/**
 * Playability metric (T-0162 follow-up).
 *
 * Quantifies three things about a Combine configuration:
 *   1. Ramp — how fast does a sim player cover a fraction of the collection?
 *   2. Long tail — what fraction is reachable at all given enough play?
 *   3. KB-growth robustness — does moves-per-discovery stay stable as the
 *      theme grows, or does it degrade?
 *
 * Playtime is estimated from move count: hours = moves × SEC_PER_PLACEMENT / 3600.
 *
 * Every tunable is a CLI flag or env var. Run with no args for defaults.
 *
 * Examples:
 *   npx tsx src/combine/__tests__/playability.ts
 *   npx tsx src/combine/__tests__/playability.ts --runs 200 --sec 2.5 --cap 80000
 *   npx tsx src/combine/__tests__/playability.ts --policy greedy --growth
 *   SEC_PER_PLACEMENT=4 npx tsx src/combine/__tests__/playability.ts
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
import type { CombineItem, CombineRecipe, ThemeBundle, ThemeKey } from "../types";

/* ======================================================================== *
 * Config
 * ======================================================================== */

interface Config {
  theme: ThemeKey;
  runs: number;
  secPerPlacement: number;
  moveCap: number;
  policy: "greedy" | "strategic";
  targets: {
    rampFractions: number[]; // e.g. [0.4, 0.75, 0.95]
    rampHoursMax: number[];  // same length — max hours to hit each fraction
    unreachableCap: number;  // max items never found by moveCap
  };
  growthCheck: boolean;
  growthFractions: number[]; // e.g. [0.5, 0.75, 1.0]
}

function parseArgs(argv: string[]): Config {
  const cfg: Config = {
    theme: "everything",
    runs: Number(process.env.RUNS) || 100,
    secPerPlacement: Number(process.env.SEC_PER_PLACEMENT) || 3,
    moveCap: Number(process.env.MOVE_CAP) || 50000,
    policy: (process.env.POLICY as "greedy" | "strategic") || "strategic",
    targets: {
      // Realistic collection-game ramp. First-session dopamine ≈ 10-15%,
      // mid-engagement ≈ 30-40%, dedicated-player breadth ≈ 60-70%. The
      // long tail past 70% is open-ended and not time-bounded — the metric
      // reports it separately via the "unreachable" count.
      rampFractions: [0.1, 0.3, 0.6],
      rampHoursMax: [1, 5, 20],
      unreachableCap: Number(process.env.UNREACH_CAP) || 40,
    },
    growthCheck: process.env.GROWTH === "1",
    growthFractions: [0.5, 0.75, 1.0],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--runs") cfg.runs = Number(next);
    else if (a === "--sec") cfg.secPerPlacement = Number(next);
    else if (a === "--cap") cfg.moveCap = Number(next);
    else if (a === "--policy") cfg.policy = next as "greedy" | "strategic";
    else if (a === "--theme") cfg.theme = next as ThemeKey;
    else if (a === "--ramp-fracs") cfg.targets.rampFractions = next.split(",").map(Number);
    else if (a === "--ramp-hours") cfg.targets.rampHoursMax = next.split(",").map(Number);
    else if (a === "--unreach-cap") cfg.targets.unreachableCap = Number(next);
    else if (a === "--growth") cfg.growthCheck = true;
    else if (a === "--growth-fracs") cfg.growthFractions = next.split(",").map(Number);
  }
  return cfg;
}

/* ======================================================================== *
 * Player policies (same shape as strategic-sim.ts; recapped briefly here)
 * ======================================================================== */

interface Policy {
  useHold: boolean;
  useHelpers: boolean;
  useUndo: boolean;
  useLookahead: boolean;
}

const POLICIES: Record<"greedy" | "strategic", Policy> = {
  greedy: { useHold: false, useHelpers: false, useUndo: false, useLookahead: false },
  strategic: { useHold: true, useHelpers: true, useUndo: true, useLookahead: true },
};

interface CombineOpt {
  action: Action;
  recipeSize: number;
  outputBand: number;
  firstFind: boolean;
  isChain: boolean;
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

function enumerateCombines(state: GameState, bundle: ThemeBundle): CombineOpt[] {
  const out: CombineOpt[] = [];
  const empty = listEmpty(state.board);
  const occ = listOcc(state.board);
  const found = new Set(state.found);
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
        const simulated = state.board.slice(); simulated[i] = m.recipe.out;
        const chain = !!matchAt(bundle, simulated, i, m.recipe.out, state.n);
        out.push({
          action: { type: "place", slot, cell: i, source },
          recipeSize: m.recipe.all.length,
          outputBand: m.recipe.band,
          firstFind: !found.has(m.recipe.out),
          isChain: chain,
        });
      }
    }
    for (const j of occ) {
      const m = matchOn(bundle, state.board, j, tile, state.n);
      if (m) {
        const simulated = state.board.slice(); simulated[j] = m.recipe.out;
        const chain = !!matchAt(bundle, simulated, j, m.recipe.out, state.n);
        out.push({
          action: { type: "drop-on", slot, cell: j, source },
          recipeSize: m.recipe.all.length,
          outputBand: m.recipe.band,
          firstFind: !found.has(m.recipe.out),
          isChain: chain,
        });
      }
    }
  }
  return out;
}

function enumeratePromotes(state: GameState, bundle: ThemeBundle): Array<{
  action: Action; firstFind: boolean;
}> {
  const out: Array<{ action: Action; firstFind: boolean }> = [];
  const found = new Set(state.found);
  for (const j of listOcc(state.board)) {
    const tile = state.board[j]!;
    const rs = (bundle.byIngredient.get(tile) ?? []).filter((r) => r.all.length === 1);
    if (!rs.length) continue;
    let firstFind = false;
    for (const r of rs) if (!found.has(r.out)) { firstFind = true; break; }
    out.push({ action: { type: "promote", cell: j }, firstFind });
  }
  return out;
}

function scoreCombine(opt: CombineOpt, state: GameState): number {
  let s = 0;
  const d = opt.outputBand - (state.age + 1);
  if (d === 0) s += 200; else if (d === 1) s += 90; else if (d === -1) s += 50;
  else if (d >= 2) s += 15; else s += 25;
  if (opt.firstFind) s += 300;
  if (opt.recipeSize >= 2) s += 40;
  if (opt.isChain) s += 80;
  s += Math.random() * 3;
  return s;
}

function worthHolding(tile: string, state: GameState, bundle: ThemeBundle): boolean {
  const found = new Set(state.found);
  const promotes = (bundle.byIngredient.get(tile) ?? []).filter((r) => r.all.length === 1);
  for (const r of promotes) if (!found.has(r.out)) return true;
  const counts = new Map<string, number>();
  for (const v of state.board) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  const heavy = [...counts.entries()].filter(([, c]) => c >= 2).map(([id]) => id);
  if (heavy.length) {
    for (const r of bundle.recipes) {
      if (r.all.length < 2) continue;
      if (!r.all.includes(tile)) continue;
      for (const pile of heavy) if (r.all.includes(pile)) return true;
    }
  }
  return false;
}

/* ======================================================================== *
 * One simulated run — returns per-move cumulative-find snapshots
 * ======================================================================== */

interface RunData {
  // moves at which each new discovery happened (move number, discovery count after)
  findsAtMove: Array<{ move: number; count: number; itemId: string }>;
  totalMoves: number;
  finalDiscoveries: number;
}

function playOne(
  bundle: ThemeBundle,
  theme: ThemeKey,
  seed: number,
  policy: Policy,
  moveCap: number,
): RunData {
  const { state: s0 } = newGame(theme, bundle, { seed });
  let state = s0;
  const findsAtMove: RunData["findsAtMove"] = [];
  const seenBefore = new Set<string>();

  const applyReduce = (act: Action) => {
    const r = reduce(state, bundle, act);
    state = r.state;
    for (const id of state.found) {
      if (!seenBefore.has(id)) {
        seenBefore.add(id);
        findsAtMove.push({ move: state.moves, count: seenBefore.size, itemId: id });
      }
    }
  };

  while (!state.over && state.moves < moveCap) {
    if (state.choosing) {
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

    const combines = enumerateCombines(state, bundle);
    const promotes = enumeratePromotes(state, bundle);
    let action: Action | null = null;

    if (combines.length) {
      combines.sort((a, b) => scoreCombine(b, state) - scoreCombine(a, state));
      action = combines[0].action;
    } else if (promotes.some((p) => p.firstFind)) {
      action = promotes.find((p) => p.firstFind)!.action;
    } else if (policy.useHold) {
      const holdSlots = state.hold.filter((v) => v == null).length;
      if (holdSlots > 0) {
        for (let s = 0; s < state.tray.length; s++) {
          const t = state.tray[s];
          if (!t) continue;
          if (worthHolding(t, state, bundle)) { action = { type: "hold", slot: s }; break; }
        }
      }
    }

    if (!action && policy.useHelpers && state.swaps > 0) action = { type: "swap" };
    if (!action && policy.useHelpers && state.clears > 0) {
      const counts = new Map<string, number>();
      for (const v of state.board) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
      let worst: { tile: string; cell: number; count: number } | null = null;
      for (const [tile, count] of counts) {
        if (count < 3) continue;
        for (let i = 0; i < state.board.length; i++) if (state.board[i] === tile) {
          if (!worst || count > worst.count) worst = { tile, cell: i, count };
          break;
        }
      }
      if (worst) action = { type: "clear", cell: worst.cell };
    }
    if (!action) {
      const empty = listEmpty(state.board);
      for (let s = 0; s < state.tray.length; s++) {
        if (state.tray[s] == null) continue;
        if (!empty.length) break;
        action = { type: "place", slot: s, cell: empty[0] }; break;
      }
    }
    if (!action) break;

    const preDisc = state.found.length;
    const beforeLegal = combines.length;
    applyReduce(action);

    if (
      policy.useUndo && state.undos > 0 && state.lastSnapshot &&
      state.found.length === preDisc
    ) {
      const nextCombines = enumerateCombines(state, bundle);
      if (nextCombines.length < beforeLegal - 1) applyReduce({ type: "undo" });
    }
  }

  return { findsAtMove, totalMoves: state.moves, finalDiscoveries: state.found.length };
}

/* ======================================================================== *
 * Aggregation across runs — median moves to reach each fraction
 * ======================================================================== */

function medianMovesToFraction(
  runs: RunData[],
  fraction: number,
  totalItems: number,
): number | null {
  const target = Math.ceil(fraction * totalItems);
  const xs: number[] = [];
  for (const r of runs) {
    // Each run's finds are progressive against its own first-time items. For
    // the collection metric, we want cumulative uniques *across all runs so
    // far* — the same real player plays run 1, then run 2, carrying the
    // collection across runs. Caller passes already-merged data; this fn
    // operates per-run.
    const hit = r.findsAtMove.find((f) => f.count >= target);
    if (hit) xs.push(hit.move);
  }
  if (!xs.length) return null;
  xs.sort((a, b) => a - b);
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

/** Cumulative discoveries across plays (same persistent collection across
 *  games). Returns an array where index k is the move-count-equivalent at
 *  which the k-th play ends, paired with cumulative uniques. */
interface CrossPlayCurve {
  movesSoFar: number[];       // cumulative moves spent at the end of each play
  uniquesSoFar: number[];     // cumulative distinct items discovered
}

function buildCrossPlayCurve(runs: RunData[]): CrossPlayCurve {
  const seen = new Set<string>();
  const curve: CrossPlayCurve = { movesSoFar: [], uniquesSoFar: [] };
  let moves = 0;
  for (const r of runs) {
    for (const f of r.findsAtMove) seen.add(f.itemId);
    moves += r.totalMoves;
    curve.movesSoFar.push(moves);
    curve.uniquesSoFar.push(seen.size);
  }
  return curve;
}

function movesToFractionCrossPlay(curve: CrossPlayCurve, fraction: number, totalItems: number): number | null {
  const target = Math.ceil(fraction * totalItems);
  for (let i = 0; i < curve.uniquesSoFar.length; i++) {
    if (curve.uniquesSoFar[i] >= target) return curve.movesSoFar[i];
  }
  return null;
}

/* ======================================================================== *
 * Theme subsampling for growth check
 * ======================================================================== */

function subsampleBundle(bundle: ThemeBundle, fraction: number, seed: number): ThemeBundle {
  if (fraction >= 1) return bundle;
  // Deterministic shuffle of recipes.
  const rng = (() => {
    let s = seed | 0;
    return () => { s = (s * 1103515245 + 12345) | 0; return ((s >>> 0) % 10000) / 10000; };
  })();
  const shuffled = bundle.recipes.slice().sort(() => rng() - 0.5);
  const keep = Math.max(1, Math.floor(bundle.recipes.length * fraction));
  const keptRecipes = shuffled.slice(0, keep);

  // Re-derive outputs, byIngredient, terminal, items subset.
  const outputs = new Set<string>(keptRecipes.map((r) => r.out));
  const used = new Set<string>();
  for (const r of keptRecipes) for (const x of r.all) used.add(x);
  for (const o of outputs) used.add(o);
  const byIngredient = new Map<string, CombineRecipe[]>();
  for (const r of keptRecipes) for (const x of r.all) {
    let list = byIngredient.get(x); if (!list) { list = []; byIngredient.set(x, list); }
    list.push(r);
  }
  const items = new Map<string, CombineItem>();
  for (const [id, it] of bundle.items) if (used.has(id)) items.set(id, it);
  const base: string[] = [];
  for (const id of used) if (!outputs.has(id)) base.push(id);
  // Terminal = outputs that aren't an ingredient of anything kept.
  const asIng = new Set<string>();
  for (const r of keptRecipes) for (const x of r.all) asIng.add(x);
  const terminal = new Set<string>();
  for (const o of outputs) if (!asIng.has(o)) terminal.add(o);
  // outBand: min band per output.
  const outBand = new Map<string, number>();
  for (const r of keptRecipes) {
    const cur = outBand.get(r.out);
    if (cur == null || r.band < cur) outBand.set(r.out, r.band);
  }
  return {
    ...bundle,
    recipes: keptRecipes,
    outputs,
    base,
    terminal,
    items,
    byIngredient,
    outBand,
  };
}

/* ======================================================================== *
 * Report
 * ======================================================================== */

function nameOf(bundle: ThemeBundle, id: string): string {
  return bundle.items.get(id)?.name ?? id;
}

function formatHours(moves: number, secPerPlacement: number): string {
  const h = (moves * secPerPlacement) / 3600;
  if (h < 1) return `${(h * 60).toFixed(0)} min`;
  return `${h.toFixed(1)} h`;
}

function reportPolicy(cfg: Config, bundle: ThemeBundle, label: string, runs: RunData[]) {
  const totalItems = bundle.items.size;
  const curve = buildCrossPlayCurve(runs);
  const totalMoves = curve.movesSoFar[curve.movesSoFar.length - 1] ?? 0;
  const finalUniques = curve.uniquesSoFar[curve.uniquesSoFar.length - 1] ?? 0;

  console.log(`\n=== ${label}  (${runs.length} runs, ${totalItems} items in theme) ===`);
  console.log(`  total sim moves: ${totalMoves}  (~${formatHours(totalMoves, cfg.secPerPlacement)} play time)`);
  console.log(`  cumulative uniques after ${runs.length} runs: ${finalUniques}/${totalItems} (${((finalUniques / totalItems) * 100).toFixed(1)}%)`);

  console.log(`  mean per-run: moves=${(totalMoves / runs.length).toFixed(0)}  ` +
    `discoveries-this-run=${(runs.reduce((a, b) => a + b.finalDiscoveries, 0) / runs.length).toFixed(1)}`);

  // Ramp targets.
  console.log(`\n  Ramp (cross-play persistent collection):`);
  const fs = cfg.targets.rampFractions;
  const hs = cfg.targets.rampHoursMax;
  const rampResults: Array<{ frac: number; moves: number | null; pass: boolean }> = [];
  for (let i = 0; i < fs.length; i++) {
    const f = fs[i];
    const maxHrs = hs[i];
    const moves = movesToFractionCrossPlay(curve, f, totalItems);
    const hrs = moves != null ? (moves * cfg.secPerPlacement) / 3600 : null;
    const pass = moves != null && hrs! <= maxHrs;
    const status = pass ? "✅" : moves == null ? "❌ (not reached)" : "❌";
    const need = `(target ≤ ${maxHrs}h)`;
    const got = moves == null ? "—" : `${moves} moves  (~${formatHours(moves, cfg.secPerPlacement)})`;
    console.log(`    reach ${(f * 100).toFixed(0)}%: ${got.padEnd(32)} ${status} ${need}`);
    rampResults.push({ frac: f, moves: moves ?? -1, pass });
  }

  // Long tail: unreachable at move cap.
  const seen = new Set<string>();
  for (const r of runs) for (const f of r.findsAtMove) seen.add(f.itemId);
  const unreachable: string[] = [];
  for (const id of bundle.items.keys()) if (!seen.has(id)) unreachable.push(id);
  const unreachablePass = unreachable.length <= cfg.targets.unreachableCap;
  console.log(`\n  Long tail:`);
  console.log(`    unreachable in ${runs.length} runs: ${unreachable.length} items  ` +
    `${unreachablePass ? "✅" : "❌"} (target ≤ ${cfg.targets.unreachableCap})`);
  if (unreachable.length > 0 && unreachable.length <= 25) {
    console.log(`    unreachable list: ${unreachable.map((id) => nameOf(bundle, id)).join(", ")}`);
  } else if (unreachable.length > 25) {
    console.log(`    unreachable sample: ${unreachable.slice(0, 15).map((id) => nameOf(bundle, id)).join(", ")}, …`);
  }

  // Rare-but-reachable: items seen in <20% of runs.
  const perItemRunCount = new Map<string, number>();
  for (const r of runs) {
    const inThisRun = new Set(r.findsAtMove.map((f) => f.itemId));
    for (const id of inThisRun) perItemRunCount.set(id, (perItemRunCount.get(id) ?? 0) + 1);
  }
  const rareThreshold = runs.length * 0.2;
  const rare: string[] = [];
  for (const [id, c] of perItemRunCount) if (c < rareThreshold) rare.push(id);
  console.log(`    rare (<20% of runs): ${rare.length} items`);

  // Pass/fail composite.
  const allPass = rampResults.every((r) => r.pass) && unreachablePass;
  console.log(`\n  Playability: ${allPass ? "✅ PASS" : "❌ FAIL"} (${rampResults.filter((r) => r.pass).length}/${rampResults.length} ramp + unreachable ${unreachablePass ? "✅" : "❌"})`);
}

function reportGrowth(cfg: Config, bundle: ThemeBundle, policy: Policy) {
  console.log(`\n=== Growth robustness (subsampled themes) ===`);
  console.log(`  moves/discovery should stay roughly flat as the KB grows.`);
  const rows: Array<{ frac: number; items: number; movesPerFind: number; movesToHalf: number | null }> = [];
  for (const frac of cfg.growthFractions) {
    const sub = subsampleBundle(bundle, frac, 0xBABECAFE);
    const runs: RunData[] = [];
    // Scale number of runs per subsample so wall-clock stays manageable.
    const subRuns = Math.max(10, Math.floor(cfg.runs / 4));
    for (let i = 0; i < subRuns; i++) {
      runs.push(playOne(sub, cfg.theme, (0xDECAF ^ (i * 2654435761)) >>> 0, policy, cfg.moveCap));
    }
    const curve = buildCrossPlayCurve(runs);
    const totalMoves = curve.movesSoFar[curve.movesSoFar.length - 1] ?? 0;
    const finalUniques = curve.uniquesSoFar[curve.uniquesSoFar.length - 1] ?? 0;
    const mpf = finalUniques > 0 ? totalMoves / finalUniques : Infinity;
    const movesToHalf = movesToFractionCrossPlay(curve, 0.5, sub.items.size);
    rows.push({ frac, items: sub.items.size, movesPerFind: mpf, movesToHalf });
  }
  console.log(`\n  theme-size    items   moves/find   moves-to-50%`);
  for (const r of rows) {
    const half = r.movesToHalf != null ? `${r.movesToHalf} (~${formatHours(r.movesToHalf, cfg.secPerPlacement)})` : "—";
    console.log(`    ${((r.frac * 100).toFixed(0) + "%").padEnd(10)} ${String(r.items).padEnd(7)} ${r.movesPerFind.toFixed(1).padEnd(11)}  ${half}`);
  }

  // Trend: if moves/find grows super-linearly with items, the sampler scales badly.
  if (rows.length >= 2) {
    const first = rows[0], last = rows[rows.length - 1];
    const itemRatio = last.items / first.items;
    const findRatio = last.movesPerFind / first.movesPerFind;
    const scalingExp = Math.log(findRatio) / Math.log(itemRatio);
    console.log(`\n  scaling exponent (moves/find ~ items^k): k=${scalingExp.toFixed(2)}`);
    console.log(`    k < 1.0 → better than linear (good)`);
    console.log(`    k ≈ 1.0 → linear (acceptable)`);
    console.log(`    k > 1.3 → worse than linear (brittle; sampler not scaling)`);
  }
}

/* ======================================================================== *
 * Main
 * ======================================================================== */

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const kb = loadKnowledgeBase();
  const rows = toRows(kb);
  const snap = buildSnapshot(rows);
  const bundle = buildThemeBundle(snap, cfg.theme);

  console.log(`Playability metric`);
  console.log(`  theme: ${cfg.theme}  items: ${bundle.items.size}  recipes: ${bundle.recipes.length}`);
  console.log(`  policy: ${cfg.policy}  runs: ${cfg.runs}  move-cap/run: ${cfg.moveCap}  sec/placement: ${cfg.secPerPlacement}`);
  console.log(`  ramp targets: ${cfg.targets.rampFractions.map((f, i) => `${(f * 100).toFixed(0)}% ≤${cfg.targets.rampHoursMax[i]}h`).join(", ")}`);
  console.log(`  unreachable cap: ${cfg.targets.unreachableCap}`);

  const policy = POLICIES[cfg.policy];
  const runs: RunData[] = [];
  for (let i = 0; i < cfg.runs; i++) {
    const seed = (0xFEEDFACE ^ (i * 2654435761)) >>> 0;
    runs.push(playOne(bundle, cfg.theme, seed, policy, cfg.moveCap));
  }
  reportPolicy(cfg, bundle, `Policy: ${cfg.policy}`, runs);

  if (cfg.growthCheck) reportGrowth(cfg, bundle, policy);
}

main().catch((err) => { console.error(err); process.exit(1); });
