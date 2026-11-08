/**
 * Daily playability sim (T-0180).
 *
 * Walks a window of consecutive daily seeds, plays each one with the
 * strategic player, reports:
 *  - per-day: moves to hit target, discoveries made, finished-in-budget %.
 *  - weekly / window cross-day coverage: unique items across the window.
 *  - variance: hardest vs easiest day.
 *  - target feasibility: seeds where the target is not reached even uncapped.
 *
 * Daily differs from endless in:
 *  - Deterministic seed per day (same for every player).
 *  - Fixed target discovery count (`state.target`).
 *  - Short play budget (~10-15 min ≈ 200-300 moves at 3s/placement).
 *  - Catalogue scope is separate (daily discoveries don't mix with endless).
 *
 * Run:
 *   npx tsx src/combine/__tests__/daily-playability.ts
 *   npx tsx src/combine/__tests__/daily-playability.ts --days 30 --time-budget 300 --target 20
 *   CB_OVERRIDES='mode=soft' npx tsx src/combine/__tests__/daily-playability.ts
 */

import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import {
  newGame,
  reduce,
  type Action,
  type GameState,
} from "../engine";
import { matchAt, matchOn, type Board } from "../match";
import type { ThemeBundle, ThemeKey } from "../types";

/* ======================================================================== *
 * Config
 * ======================================================================== */

interface Config {
  theme: ThemeKey;
  days: number;
  startDate: string; // YYYY-MM-DD
  target: number;    // daily discovery goal (overrides bundle default)
  timeBudgetMoves: number; // moves per player per day
  uncappedMoves: number;   // hard cap for feasibility check (per day)
  secPerPlacement: number;
}

function parseArgs(argv: string[]): Config {
  const cfg: Config = {
    theme: "everything",
    days: 14,
    startDate: todayISO(),
    target: Number(process.env.DAILY_TARGET) || 15,
    timeBudgetMoves: Number(process.env.DAILY_BUDGET) || 300,
    uncappedMoves: Number(process.env.DAILY_UNCAPPED) || 2000,
    secPerPlacement: Number(process.env.SEC_PER_PLACEMENT) || 3,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === "--days") cfg.days = Number(v);
    else if (a === "--start") cfg.startDate = v;
    else if (a === "--target") cfg.target = Number(v);
    else if (a === "--time-budget") cfg.timeBudgetMoves = Number(v);
    else if (a === "--uncapped") cfg.uncappedMoves = Number(v);
    else if (a === "--sec") cfg.secPerPlacement = Number(v);
    else if (a === "--theme") cfg.theme = v as ThemeKey;
  }
  return cfg;
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(iso: string, delta: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ======================================================================== *
 * Strategic player (lifted/trimmed from playability.ts)
 * ======================================================================== */

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

interface CombineOpt {
  action: Action;
  recipeSize: number;
  outputBand: number;
  firstFind: boolean;
  isChain: boolean;
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
        const sim = state.board.slice(); sim[i] = m.recipe.out;
        const chain = !!matchAt(bundle, sim, i, m.recipe.out, state.n);
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
        const sim = state.board.slice(); sim[j] = m.recipe.out;
        const chain = !!matchAt(bundle, sim, j, m.recipe.out, state.n);
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
    let ff = false;
    for (const r of rs) if (!found.has(r.out)) { ff = true; break; }
    out.push({ action: { type: "promote", cell: j }, firstFind: ff });
  }
  return out;
}

function scoreCombine(opt: CombineOpt, state: GameState): number {
  let s = 0;
  const d = opt.outputBand - (state.chapter + 1);
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
 * Single-day play
 * ======================================================================== */

interface DayResult {
  day: string;
  target: number;
  discoveries: number;
  firstFindMoves: number[];    // move counts at each new discovery
  movesToTarget: number | null; // null if target not reached inside uncapped
  movesSpent: number;
  finishedInBudget: boolean;    // target reached by timeBudgetMoves
  feasible: boolean;            // target reached at all inside uncappedMoves
  endReason: "target" | "stuck" | "over" | "uncapped-cap";
  uniqueItems: Set<string>;     // for cross-day coverage
}

function playDay(
  theme: ThemeKey,
  bundle: ThemeBundle,
  dayKey: string,
  target: number,
  uncappedMoves: number,
): DayResult {
  // Sim keeps its own `target` for reporting; the engine no longer carries
  // it (T-0240). Discovery count is read off `state.found.length`.
  void target;
  const { state: s0 } = newGame(theme, bundle, {
    mode: "daily",
    daily: dayKey,
  });
  let state = s0;
  const firstFindMoves: number[] = [];
  const seen = new Set<string>();
  const uniqueItems = new Set<string>();
  for (const id of state.found) {
    seen.add(id);
    uniqueItems.add(id);
  }
  let endReason: DayResult["endReason"] = "uncapped-cap";
  let movesToTarget: number | null = null;

  const applyReduce = (act: Action) => {
    const r = reduce(state, bundle, act);
    state = r.state;
    for (const id of state.found) {
      if (!seen.has(id)) {
        seen.add(id);
        uniqueItems.add(id);
        firstFindMoves.push(state.moves);
      }
    }
    if (movesToTarget == null && state.found.length >= target) {
      movesToTarget = state.moves;
    }
  };

  while (!state.over && state.moves < uncappedMoves) {
    if (state.choosing) {
      const opts = state.choosing.options;
      let best = 0, bestScore = -Infinity;
      for (let k = 0; k < opts.length; k++) {
        const r = opts[k];
        const sc = (state.found.includes(r.out) ? 0 : 100) - Math.abs(r.band - (state.chapter + 1)) * 10;
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
    } else if (state.hold.filter((v) => v == null).length > 0) {
      for (let s = 0; s < state.tray.length; s++) {
        const t = state.tray[s];
        if (!t) continue;
        if (worthHolding(t, state, bundle)) { action = { type: "hold", slot: s }; break; }
      }
    }
    if (!action && state.swaps > 0) action = { type: "swap" };
    if (!action && state.clears > 0) {
      const counts = new Map<string, number>();
      for (const v of state.board) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
      let worst: { tile: string; cell: number; count: number } | null = null;
      for (const [tile, c] of counts) {
        if (c < 3) continue;
        for (let i = 0; i < state.board.length; i++) if (state.board[i] === tile) {
          if (!worst || c > worst.count) worst = { tile, cell: i, count: c };
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
    if (!action) { endReason = "stuck"; break; }

    const preDisc = state.found.length;
    const beforeLegal = combines.length;
    applyReduce(action);

    if (state.undos > 0 && state.lastSnapshot && state.found.length === preDisc) {
      const nextCombines = enumerateCombines(state, bundle);
      if (nextCombines.length < beforeLegal - 1) applyReduce({ type: "undo" });
    }
  }

  if (state.over) endReason = state.found.length >= target ? "target" : "over";

  return {
    day: dayKey,
    target,
    discoveries: state.found.length,
    firstFindMoves,
    movesToTarget,
    movesSpent: state.moves,
    finishedInBudget: movesToTarget != null, // compared below
    feasible: movesToTarget != null,
    endReason,
    uniqueItems,
  };
}

/* ======================================================================== *
 * Report
 * ======================================================================== */

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function pct(x: number): string { return (x * 100).toFixed(0) + "%"; }
function formatPlaytime(moves: number, sec: number): string {
  const h = (moves * sec) / 3600;
  if (h < 1) return `${(h * 60).toFixed(0)} min`;
  return `${h.toFixed(1)} h`;
}

function report(cfg: Config, bundle: ThemeBundle, results: DayResult[]) {
  console.log(`\n=== Daily playability — ${bundle.theme.name} ===`);
  console.log(`  days: ${results.length}  target: ${cfg.target}  time-budget: ${cfg.timeBudgetMoves} moves (${formatPlaytime(cfg.timeBudgetMoves, cfg.secPerPlacement)})  uncapped-cap: ${cfg.uncappedMoves}`);
  console.log(`  sec/placement: ${cfg.secPerPlacement}`);

  // Feasibility counts.
  const feasible = results.filter((r) => r.feasible).length;
  const inBudget = results.filter((r) => r.movesToTarget != null && r.movesToTarget <= cfg.timeBudgetMoves).length;
  console.log(`\n  Target feasibility:`);
  console.log(`    reached at all (within ${cfg.uncappedMoves} moves):   ${feasible}/${results.length}  (${pct(feasible / results.length)})`);
  console.log(`    reached in budget (${cfg.timeBudgetMoves} moves):       ${inBudget}/${results.length}  (${pct(inBudget / results.length)})`);

  // Per-day table.
  console.log(`\n  Per-day (first 10):`);
  console.log(`    ${"day".padEnd(12)}${"finds".padStart(7)}${"m→target".padStart(11)}${"playtime".padStart(11)}  status`);
  for (const r of results.slice(0, 10)) {
    const mt = r.movesToTarget != null ? String(r.movesToTarget) : "—";
    const pt = r.movesToTarget != null ? formatPlaytime(r.movesToTarget, cfg.secPerPlacement) : "—";
    const status = r.movesToTarget == null
      ? "infeasible"
      : r.movesToTarget <= cfg.timeBudgetMoves
        ? "in-budget"
        : "over-budget";
    console.log(`    ${r.day.padEnd(12)}${String(r.discoveries).padStart(7)}${mt.padStart(11)}${pt.padStart(11)}  ${status}`);
  }
  if (results.length > 10) console.log(`    … and ${results.length - 10} more`);

  // Variance.
  const hardestFeasible = [...results].filter((r) => r.movesToTarget != null).sort((a, b) => b.movesToTarget! - a.movesToTarget!);
  const easiest = [...results].filter((r) => r.movesToTarget != null).sort((a, b) => a.movesToTarget! - b.movesToTarget!);
  if (hardestFeasible.length) {
    const avg = mean(results.filter((r) => r.movesToTarget != null).map((r) => r.movesToTarget!));
    console.log(`\n  Variance (feasible days only):`);
    console.log(`    easiest: ${easiest[0].day} @ ${easiest[0].movesToTarget} moves (${formatPlaytime(easiest[0].movesToTarget!, cfg.secPerPlacement)})`);
    console.log(`    hardest: ${hardestFeasible[0].day} @ ${hardestFeasible[0].movesToTarget} moves (${formatPlaytime(hardestFeasible[0].movesToTarget!, cfg.secPerPlacement)})`);
    console.log(`    mean:    ${avg.toFixed(0)} moves (${formatPlaytime(avg, cfg.secPerPlacement)})`);
  }

  // Cross-day collection coverage.
  const collection = new Set<string>();
  for (const r of results) for (const id of r.uniqueItems) collection.add(id);
  const totalItems = bundle.items.size;
  console.log(`\n  Cross-day coverage (${results.length}-day window):`);
  console.log(`    unique items discovered: ${collection.size}/${totalItems}  (${pct(collection.size / totalItems)})`);
  const perDayNew: number[] = [];
  const seenSoFar = new Set<string>();
  for (const r of results) {
    let newToday = 0;
    for (const id of r.uniqueItems) if (!seenSoFar.has(id)) { seenSoFar.add(id); newToday++; }
    perDayNew.push(newToday);
  }
  console.log(`    new items per day: mean=${mean(perDayNew).toFixed(1)}  max=${Math.max(...perDayNew)}  min=${Math.min(...perDayNew)}`);
}

/* ======================================================================== *
 * Main
 * ======================================================================== */

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const kb = loadKnowledgeBase();
  const rows = toRows(kb);
  const snap = buildSnapshot(rows);
  // Daily uses the endless bundle; the `daily: dayKey` flag + `target` on
  // newGame opts drive the deterministic seed + target-list ending. No
  // dailyConfig specialisation here — we're measuring the default dealer.
  const bundle = buildThemeBundle(snap, cfg.theme);
  console.log(`Daily playability sim`);
  console.log(`  theme: ${cfg.theme}  items: ${bundle.items.size}  recipes: ${bundle.recipes.length}`);
  const results: DayResult[] = [];
  for (let d = 0; d < cfg.days; d++) {
    const dayKey = addDays(cfg.startDate, d);
    const r = playDay(cfg.theme, bundle, dayKey, cfg.target, cfg.uncappedMoves);
    results.push(r);
  }
  report(cfg, bundle, results);
}

main().catch((err) => { console.error(err); process.exit(1); });
