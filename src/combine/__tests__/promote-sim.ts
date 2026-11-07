/**
 * Simulate the real-player experience in bands 1-2: combines when tray allows,
 * falls back to promote on a board tile, uses swap sparingly. Instruments
 * tray-to-tray tile repetition per band so we can quantify the "same tiles
 * over and over" complaint in bands 1-2.
 *
 * Run: npx tsx src/combine/__tests__/promote-sim.ts [theme] [games] [maxMoves]
 * Defaults: theme=everything, games=30, maxMoves=300.
 */

import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { ageSets, buildThemeBundle } from "../data";
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
  priority: number;
  recipeSize: number;
  outputBand: number;
  willShip: boolean;
  firstFind: boolean;
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

/** Enumerate every (tray slot × cell) combine move and every promote move. */
function enumerateMoves(state: GameState, bundle: ThemeBundle): {
  combines: MoveOption[];
  promotes: MoveOption[];
} {
  const combines: MoveOption[] = [];
  const empty = listEmpty(state.board);
  const occ = listOcc(state.board);
  const found = new Set(state.found);

  for (let s = 0; s < state.tray.length; s++) {
    const tile = state.tray[s];
    if (tile == null) continue;

    for (const i of empty) {
      const m = matchAt(bundle, state.board, i, tile, state.n);
      if (m) {
        const band = m.recipe.band;
        combines.push({
          action: { type: "place", slot: s, cell: i },
          priority: 0,
          recipeSize: m.recipe.all.length,
          outputBand: band,
          willShip: bundle.terminal.has(m.recipe.out),
          firstFind: !found.has(m.recipe.out),
        });
      }
    }
    for (const j of occ) {
      const m = matchOn(bundle, state.board, j, tile, state.n);
      if (m) {
        const band = m.recipe.band;
        combines.push({
          action: { type: "drop-on", slot: s, cell: j },
          priority: 0,
          recipeSize: m.recipe.all.length,
          outputBand: band,
          willShip: bundle.terminal.has(m.recipe.out),
          firstFind: !found.has(m.recipe.out),
        });
      }
    }
  }

  const promotes: MoveOption[] = [];
  for (const j of occ) {
    const tile = state.board[j]!;
    const rs = (bundle.byIngredient.get(tile) ?? []).filter((r) => r.all.length === 1);
    if (!rs.length) continue;
    // Pick the first recipe for priority scoring; player will get a picker
    // for multi-output. Treat the lowest-band recipe as the "band" for
    // age-preference.
    let band = 999;
    let firstFind = false;
    for (const r of rs) {
      if (r.band < band) band = r.band;
      if (!found.has(r.out)) firstFind = true;
    }
    promotes.push({
      action: { type: "promote", cell: j },
      priority: 0,
      recipeSize: 1,
      outputBand: band,
      willShip: false,
      firstFind,
    });
  }

  return { combines, promotes };
}

/** Score a move. Prefer first-finds, prefer current/next-band, prefer bigger. */
function scoreMove(opt: MoveOption, state: GameState): number {
  let s = 0;
  const currentBand = state.age + 1;
  const d = opt.outputBand - currentBand;
  if (d === 0) s += 200;
  else if (d === -1) s += 50;
  else if (d === 1) s += 80;
  else if (d >= 2) s += 10;
  else s += 20;
  if (opt.firstFind) s += 300;
  if (opt.recipeSize >= 2) s += 40;
  if (opt.willShip) s += 60;
  s += Math.random() * 3;
  return s;
}

interface TrayObs {
  age: number;        // age at which this tray was dealt
  move: number;       // move count when dealt
  tiles: string[];    // sorted non-null tile ids
}

interface BandStats {
  age: number;
  ageName: string;
  trays: TrayObs[];
  movesInAge: number;
  firstFinds: number;      // unique first-time discoveries while in this age
  promotesInAge: number;
  combinesInAge: number;
}

interface Run {
  seed: number;
  finalAge: number;
  moves: number;
  discoveries: number;
  made: number;
  endReason: "over" | "stuck" | "max-moves";
  bands: BandStats[];
}

function newBandStats(numAges: number, bundle: ThemeBundle): BandStats[] {
  return bundle.theme.ages.map((name, i) => ({
    age: i,
    ageName: name,
    trays: [],
    movesInAge: 0,
    firstFinds: 0,
    promotesInAge: 0,
    combinesInAge: 0,
  }));
}

function playOne(
  theme: ThemeKey,
  bundle: ThemeBundle,
  seed: number,
  maxMoves: number,
): Run {
  const { state: s0 } = newGame(theme, bundle, { seed });
  let state = s0;
  const bands = newBandStats(bundle.theme.ages.length, bundle);
  let endReason: Run["endReason"] = "max-moves";

  // Record the initial tray as the "move 0" observation for the starting age.
  bands[state.age].trays.push({
    age: state.age,
    move: 0,
    tiles: state.tray.filter((v): v is string => Boolean(v)).slice().sort(),
  });
  let lastTraySignature = bands[state.age].trays[0].tiles.join(",");

  while (!state.over && state.moves < maxMoves) {
    if (state.choosing) {
      // Prefer first-find output.
      const opts = state.choosing.options;
      let best = 0;
      let bestScore = -Infinity;
      for (let k = 0; k < opts.length; k++) {
        const r = opts[k];
        const unseen = state.found.includes(r.out) ? 0 : 50;
        const bandDelta = Math.abs(r.band - (state.age + 1));
        const sc = unseen - bandDelta * 10;
        if (sc > bestScore) {
          bestScore = sc;
          best = k;
        }
      }
      const prev = state;
      const r = reduce(prev, bundle, { type: "choose", outputIndex: best });
      state = r.state;
      recordEvents(prev, state, r.events, bands);
      continue;
    }

    const { combines, promotes } = enumerateMoves(state, bundle);
    const all = [...combines, ...promotes];
    let action: Action | null = null;
    if (all.length) {
      all.sort((a, b) => scoreMove(b, state) - scoreMove(a, state));
      action = all[0].action;
    } else if (state.swaps > 0) {
      action = { type: "swap" };
    } else {
      // Try placing something to open the board (match-less placement).
      const empty = listEmpty(state.board);
      let placed: Action | null = null;
      for (let s = 0; s < state.tray.length; s++) {
        if (state.tray[s] == null) continue;
        if (!empty.length) break;
        placed = { type: "place", slot: s, cell: empty[0] };
        break;
      }
      if (placed) action = placed;
      else {
        endReason = "stuck";
        break;
      }
    }

    const prev = state;
    const r = reduce(prev, bundle, action!);
    state = r.state;

    // Track move counts per age.
    bands[prev.age].movesInAge++;
    if (action!.type === "promote") bands[prev.age].promotesInAge++;
    if (action!.type === "place" || action!.type === "drop-on") {
      for (const e of r.events) if (e.type === "combine") bands[prev.age].combinesInAge++;
    }

    recordEvents(prev, state, r.events, bands);

    // Did the tray change? Tray fingerprint.
    const sig = state.tray
      .filter((v): v is string => Boolean(v))
      .slice()
      .sort()
      .join(",");
    if (sig !== lastTraySignature) {
      bands[state.age].trays.push({
        age: state.age,
        move: state.moves,
        tiles: state.tray.filter((v): v is string => Boolean(v)).slice().sort(),
      });
      lastTraySignature = sig;
    }
  }

  if (state.over) endReason = "over";

  return {
    seed,
    finalAge: state.age,
    moves: state.moves,
    discoveries: state.found.length,
    made: state.made,
    endReason,
    bands,
  };
}

function recordEvents(
  prev: GameState,
  _next: GameState,
  events: Event[],
  bands: BandStats[],
): void {
  for (const e of events) {
    if (e.type === "discovery") {
      bands[prev.age].firstFinds++;
    }
  }
}

/* ---------- Metrics ---------- */

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Compute tray repetition metrics for a slice of tray observations. */
function trayMetrics(trays: TrayObs[]): {
  trays: number;
  distinctTiles: number;
  mostRepeatedTile: string;
  mostRepeatedCount: number;
  exactRepeats: number;      // trays whose sorted multiset equals an earlier tray
  heavyOverlapNeighbors: number; // consecutive pairs sharing ≥2 tiles
} {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const t of trays) {
    for (const tile of t.tiles) {
      seen.add(tile);
      counts.set(tile, (counts.get(tile) ?? 0) + 1);
    }
  }
  let mostRepeated = "";
  let mostRepeatedCount = 0;
  for (const [tile, c] of counts) {
    if (c > mostRepeatedCount) {
      mostRepeated = tile;
      mostRepeatedCount = c;
    }
  }
  const sigs = new Map<string, number>();
  let exactRepeats = 0;
  for (const t of trays) {
    const sig = t.tiles.join(",");
    const prior = sigs.get(sig) ?? 0;
    if (prior > 0) exactRepeats++;
    sigs.set(sig, prior + 1);
  }
  let heavyOverlap = 0;
  for (let i = 1; i < trays.length; i++) {
    const a = new Set(trays[i].tiles);
    let shared = 0;
    for (const x of trays[i - 1].tiles) if (a.has(x)) shared++;
    if (shared >= 2) heavyOverlap++;
  }
  return {
    trays: trays.length,
    distinctTiles: seen.size,
    mostRepeatedTile: mostRepeated,
    mostRepeatedCount,
    exactRepeats,
    heavyOverlapNeighbors: heavyOverlap,
  };
}

function nameOf(bundle: ThemeBundle, id: string): string {
  return bundle.items.get(id)?.name ?? id;
}

/* ---------- Report ---------- */

function report(label: string, runs: Run[], bundle: ThemeBundle) {
  console.log(`\n=== ${label}  (n=${runs.length}) ===`);
  console.log(
    `Discoveries mean=${mean(runs.map((r) => r.discoveries)).toFixed(1)}  ` +
      `Final age mean=${mean(runs.map((r) => r.finalAge)).toFixed(2)}  ` +
      `Moves mean=${mean(runs.map((r) => r.moves)).toFixed(0)}  ` +
      `Made mean=${mean(runs.map((r) => r.made)).toFixed(1)}`,
  );
  const reasons: Record<string, number> = {};
  for (const r of runs) reasons[r.endReason] = (reasons[r.endReason] ?? 0) + 1;
  console.log("End reasons:", reasons);

  // Whole-run tile-frequency histogram across all runs.
  const totalPool = bundle.items.size;
  const uniquePerRun: number[] = [];
  const bucketsAll: Record<string, number> = {
    "0": 0, "1": 0, "2-3": 0, "4-7": 0, "8-15": 0, "16-31": 0, "32-63": 0, "64+": 0,
  };
  for (const r of runs) {
    const perRunCounts = new Map<string, number>();
    for (const b of r.bands) for (const t of b.trays) for (const tile of t.tiles) {
      perRunCounts.set(tile, (perRunCounts.get(tile) ?? 0) + 1);
    }
    uniquePerRun.push(perRunCounts.size);
    for (const id of bundle.items.keys()) {
      const c = perRunCounts.get(id) ?? 0;
      if (c === 0) bucketsAll["0"]++;
      else if (c === 1) bucketsAll["1"]++;
      else if (c <= 3) bucketsAll["2-3"]++;
      else if (c <= 7) bucketsAll["4-7"]++;
      else if (c <= 15) bucketsAll["8-15"]++;
      else if (c <= 31) bucketsAll["16-31"]++;
      else if (c <= 63) bucketsAll["32-63"]++;
      else bucketsAll["64+"]++;
    }
  }
  console.log(`\n  unique tiles seen per run: min=${Math.min(...uniquePerRun)}  mean=${mean(uniquePerRun).toFixed(0)}  max=${Math.max(...uniquePerRun)}  (of ${totalPool} total)`);
  console.log(`  per-run tile-frequency histogram (averaged across ${runs.length} runs, over ${totalPool}-item pool):`);
  const barMax = Math.max(...Object.values(bucketsAll));
  for (const [bucket, count] of Object.entries(bucketsAll)) {
    const perRun = count / runs.length;
    const bar = "█".repeat(Math.round((count / barMax) * 40));
    console.log(`    appearances in run = ${bucket.padStart(5)}:  ${perRun.toFixed(1).padStart(6)} tiles  ${bar}`);
  }

  // Band-by-band repetition metrics (ages 0, 1, 2, 3).
  for (let age = 0; age <= 3; age++) {
    const label = bundle.theme.ages[age];
    if (!label) break;

    const allTrays: TrayObs[] = [];
    const movesInAge: number[] = [];
    const firstFinds: number[] = [];
    const promotesInAge: number[] = [];
    const combinesInAge: number[] = [];
    const entered: Run[] = [];
    for (const r of runs) {
      if (r.finalAge < age && r.endReason !== "max-moves") {
        // only include if ever entered this age
        if (age > r.finalAge) continue;
      }
      if (age > r.finalAge && r.bands[age].movesInAge === 0) continue;
      entered.push(r);
      for (const t of r.bands[age].trays) allTrays.push(t);
      movesInAge.push(r.bands[age].movesInAge);
      firstFinds.push(r.bands[age].firstFinds);
      promotesInAge.push(r.bands[age].promotesInAge);
      combinesInAge.push(r.bands[age].combinesInAge);
    }
    if (!entered.length) continue;

    // Aggregate repetition across all runs (treat each run's band as a separate stream).
    const perRunMetrics = entered.map((r) => trayMetrics(r.bands[age].trays));
    const totalTrays = perRunMetrics.reduce((a, b) => a + b.trays, 0);
    const avgTraysPerRun = totalTrays / entered.length;
    const avgDistinct = mean(perRunMetrics.map((m) => m.distinctTiles));
    const avgMostRepeatedCount = mean(perRunMetrics.map((m) => m.mostRepeatedCount));
    const avgExactRepeats = mean(perRunMetrics.map((m) => m.exactRepeats));
    const avgHeavyOverlap = mean(perRunMetrics.map((m) => m.heavyOverlapNeighbors));
    // Most-repeated tiles across all runs.
    const tileCounts = new Map<string, number>();
    for (const t of allTrays) for (const tile of t.tiles) tileCounts.set(tile, (tileCounts.get(tile) ?? 0) + 1);
    const top5 = [...tileCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, c]) => `${nameOf(bundle, id)}(${c})`)
      .join(", ");

    console.log(`\n  age ${age} ${label}:  entered=${entered.length}/${runs.length}`);
    console.log(
      `    trays=${avgTraysPerRun.toFixed(1)}  moves=${mean(movesInAge).toFixed(1)}  ` +
        `combines=${mean(combinesInAge).toFixed(1)}  promotes=${mean(promotesInAge).toFixed(1)}  ` +
        `first-finds=${mean(firstFinds).toFixed(1)}`,
    );
    console.log(
      `    tray repetition: distinct-tiles=${avgDistinct.toFixed(1)}  ` +
        `most-repeated-count=${avgMostRepeatedCount.toFixed(1)}  ` +
        `exact-repeats=${avgExactRepeats.toFixed(1)}  ` +
        `heavy-overlap-neighbors=${avgHeavyOverlap.toFixed(1)}`,
    );
    console.log(`    top tiles dealt: ${top5}`);
  }
}

/* ---------- Main ---------- */

async function main() {
  const theme = (process.argv[2] as ThemeKey) || "everything";
  const games = parseInt(process.argv[3] ?? "", 10) || 30;
  const maxMoves = parseInt(process.argv[4] ?? "", 10) || 300;

  const kb = loadKnowledgeBase();
  const rows = toRows(kb);
  const snap = buildSnapshot(rows);
  const bundle = buildThemeBundle(snap, theme);

  console.log(
    `Theme: ${bundle.theme.name} (${theme})  bands=${bundle.theme.ages.length}  recipes=${bundle.recipes.length}`,
  );

  const runs: Run[] = [];
  for (let i = 0; i < games; i++) {
    const seed = 0xCAFEBABE ^ (i * 2654435761);
    runs.push(playOne(theme, bundle, seed, maxMoves));
  }
  report("Promoting player", runs, bundle);

  // Trace a single run so we can see tray-by-tray what happens in age 0 + 1.
  console.log("\n--- Trace: single run, bands 0 + 1 (seed 0) ---");
  const trace = playOne(theme, bundle, 0xCAFEBABE, maxMoves);
  for (let age = 0; age <= Math.min(1, trace.finalAge); age++) {
    console.log(`\n  age ${age} ${bundle.theme.ages[age]}:  ${trace.bands[age].trays.length} trays`);
    for (let i = 0; i < Math.min(trace.bands[age].trays.length, 20); i++) {
      const t = trace.bands[age].trays[i];
      console.log(
        `    m${String(t.move).padStart(3)} [${t.tiles.map((id) => nameOf(bundle, id)).join(", ")}]`,
      );
    }
    if (trace.bands[age].trays.length > 20) {
      console.log(`    ... and ${trace.bands[age].trays.length - 20} more`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
