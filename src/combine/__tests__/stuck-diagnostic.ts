/**
 * Why doesn't the age counter move?
 *
 * Diagnostic for the "I made lots of things but didn't progress" complaint.
 * Plays many Combine games with a reasonable-player heuristic and classifies
 * every combo event by band offset from the age it fired in. Also reports:
 *
 *   - how often the dealer leaves the player with no current-age combo
 *     available on the next move,
 *   - how many combos resolved at a non-current band *even though* their
 *     ingredient set had a current-age alt available (missed opportunity),
 *   - chain-step share (chains don't count toward age progression after
 *     the Option-A rule change — this quantifies the loss).
 *
 * Pure analysis — no fixes applied. Use the output to decide which lever
 * (dealer bias / chooser default / UI visibility) is dominant.
 *
 * Run: npx tsx src/combine/__tests__/stuck-diagnostic.ts [games] [maxMoves]
 */

import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import { newGame, reduce, type Action, type Event, type GameState } from "../engine";
import { matchAt, matchOn, type Board } from "../match";
import type { CombineRecipe, ThemeBundle } from "../types";

/* ---------- Move enumeration ---------- */

interface Move {
  action: Action;
  ingredients: string[];   // the pre-match tile set (incl. the placed tile)
  recipeBand: number;      // band of the recipe this move would fire
  recipeOut: string;
  bestAltBand: number;     // min band across alts for this ingredient set
  altAtCurrent: boolean;   // does an alt exist at current age?
  size: number;
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

function altsFor(bundle: ThemeBundle, r: CombineRecipe): CombineRecipe[] {
  const k = [...r.all].sort().join("+");
  return bundle.sameIngredients.get(k) ?? [r];
}

function annotate(
  bundle: ThemeBundle,
  state: GameState,
  action: Action,
  recipe: CombineRecipe,
): Move {
  const alts = altsFor(bundle, recipe);
  const bestAltBand = Math.min(...alts.map((a) => a.band));
  const altAtCurrent = alts.some((a) => a.band === state.chapter + 1);
  return {
    action,
    ingredients: recipe.all.slice(),
    recipeBand: recipe.band,
    recipeOut: recipe.out,
    bestAltBand,
    altAtCurrent,
    size: recipe.all.length,
  };
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
      if (m) out.push(annotate(bundle, state, { type: "place", slot: s, cell: i }, m.recipe));
    }
    for (const j of occ) {
      const m = matchOn(bundle, state.board, j, tile, state.n);
      if (m) out.push(annotate(bundle, state, { type: "drop-on", slot: s, cell: j }, m.recipe));
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

/* ---------- Player heuristic ---------- */

/** Reasonable player: prefer current-age combos, then anything that combos,
 *  then a safe placement. Mirrors the simulate.ts policy with the
 *  "preferCurrentAge" knob on. */
function pickMove(moves: Move[]): Move | null {
  if (moves.length === 0) return null;
  moves.sort((a, b) => {
    // Prefer alts at the current band (combo will advance progression)
    if (a.altAtCurrent !== b.altAtCurrent) return a.altAtCurrent ? -1 : 1;
    // Prefer larger recipes (more tiles cleared)
    if (a.size !== b.size) return b.size - a.size;
    return 0;
  });
  return moves[0];
}

/* ---------- Diagnostic counters ---------- */

interface AgeDiag {
  age: number;
  moves: number;
  // Per-move classification: did the move's chosen recipe fire at current band?
  playerMoves: number;
  comboMoves: number;        // of playerMoves, produced a combine event
  comboAtCurrent: number;    // combo event mult=1 and recipe.band == current
  comboBelow: number;        // combo event mult=1 and recipe.band < current
  comboAbove: number;        // combo event mult=1 and recipe.band > current
  chainSteps: number;        // combo events with mult > 1
  // Did a current-age alt exist for this ingredient set, but we fired below?
  missedCurrentAlt: number;
  // Trays with no current-age combo possible
  traysNoCurrentCombo: number;
  trayChecks: number;
  // Did age-up fire?
  advanced: boolean;
}

interface GameDiag {
  seed: number;
  endReason: "over" | "stuck" | "max-moves";
  finalAge: number;
  totalMoves: number;
  totalComboEvents: number;
  totalChainSteps: number;
  perAge: AgeDiag[];
}

function emptyAge(a: number): AgeDiag {
  return {
    age: a, moves: 0, playerMoves: 0, comboMoves: 0,
    comboAtCurrent: 0, comboBelow: 0, comboAbove: 0,
    chainSteps: 0, missedCurrentAlt: 0,
    traysNoCurrentCombo: 0, trayChecks: 0, advanced: false,
  };
}

function playOne(bundle: ThemeBundle, seed: number, maxMoves: number): GameDiag {
  const { state: s0 } = newGame("everything", bundle, { seed });
  let state = s0;
  const numAges = bundle.theme.ages.length;
  const perAge: AgeDiag[] = Array.from({ length: numAges }, (_, i) => emptyAge(i));
  const diag: GameDiag = {
    seed, endReason: "max-moves", finalAge: 0,
    totalMoves: 0, totalComboEvents: 0, totalChainSteps: 0, perAge,
  };

  while (!state.over && state.moves < maxMoves) {
    const age = state.chapter;
    const ageDiag = perAge[age];

    // Check what current-age combos exist in the current tray
    const combines = enumerateCombines(state, bundle);
    ageDiag.trayChecks += 1;
    const anyCurrent = combines.some((m) => m.altAtCurrent);
    if (!anyCurrent) ageDiag.traysNoCurrentCombo += 1;

    // Handle choice prompt
    if (state.choosing) {
      // Prefer a current-age alt if one exists; else nearest band
      const opts = state.choosing.options;
      let bestIdx = 0;
      let bestD = Infinity;
      for (let k = 0; k < opts.length; k++) {
        const d = Math.abs(opts[k].band - (age + 1));
        if (d < bestD) { bestD = d; bestIdx = k; }
      }
      const prev = state;
      const r = reduce(prev, bundle, { type: "choose", outputIndex: bestIdx });
      state = r.state;
      ingestEvents(r.events, prev.chapter, perAge, diag);
      ageDiag.moves += 1;
      continue;
    }

    // Pick a move
    let picked: Move | null = null;
    let action: Action | null = null;
    if (combines.length) {
      picked = pickMove(combines);
      action = picked?.action ?? null;
    } else {
      // No combo available: try to place somewhere (opens the board)
      const placements = enumeratePlacements(state);
      if (placements.length === 0) {
        diag.endReason = "stuck";
        break;
      }
      action = placements[0];
    }

    if (!action) {
      diag.endReason = "stuck";
      break;
    }

    const prev = state;
    const r = reduce(prev, bundle, action);
    state = r.state;
    ageDiag.moves += 1;
    ageDiag.playerMoves += 1;
    diag.totalMoves += 1;

    // Record what fired. If the move was a combo move, see what band it
    // resolved at. We know *what the player tried* (picked) and the actual
    // combo events from r.events.
    const combosHere = r.events.filter(
      (e): e is Extract<Event, { type: "combine" }> => e.type === "combine",
    );
    if (combosHere.length) {
      ageDiag.comboMoves += 1;
      diag.totalComboEvents += combosHere.length;
      for (const e of combosHere) {
        if (e.mult > 1) {
          ageDiag.chainSteps += 1;
          diag.totalChainSteps += 1;
          continue;
        }
        // Initial player move. Classify by band offset.
        // Resolve band from the output.
        const band = bundle.outBand.get(e.out) ?? -1;
        // But we need the specific recipe band, not outBand. Reconstruct
        // via sameIngredients from the player's chosen ingredients + out.
        const key = [...e.inputs].sort().join("+");
        const alts = bundle.sameIngredients.get(key) ?? [];
        const matched = alts.find((a) => a.out === e.out);
        const firedBand = matched?.band ?? band;
        const current = prev.chapter + 1;
        if (firedBand === current) ageDiag.comboAtCurrent += 1;
        else if (firedBand < current) {
          ageDiag.comboBelow += 1;
          // Did a current-age alt exist for this ingredient set?
          if (alts.some((a) => a.band === current)) {
            ageDiag.missedCurrentAlt += 1;
          }
        }
        else ageDiag.comboAbove += 1;
      }
    }

    // Detect age-up event
    for (const e of r.events) {
      if (e.type === "age-up") {
        perAge[prev.chapter].advanced = true;
      }
    }
  }

  if (state.over) diag.endReason = "over";
  diag.finalAge = state.chapter;
  return diag;
}

function ingestEvents(events: Event[], _age: number, _perAge: AgeDiag[], _diag: GameDiag) {
  // Reserved for choice-path combo events — currently handled in the main
  // loop since we immediately re-enter and detect from `prev` state.
  // Intentionally empty for now.
  void events;
}

/* ---------- Reporting ---------- */

function pct(num: number, den: number): string {
  if (!den) return "   —";
  return (100 * num / den).toFixed(1).padStart(5) + "%";
}
function pad(s: string | number, n: number): string {
  return String(s).padStart(n);
}

function report(runs: GameDiag[], bundle: ThemeBundle) {
  const n = runs.length;
  const ages = bundle.theme.ages;

  console.log(`\n=== Stuck Diagnostic — ${n} games, Everything, ${ages.length} ages ===\n`);

  // End-reason distribution
  const ends: Record<string, number> = { over: 0, stuck: 0, "max-moves": 0 };
  for (const r of runs) ends[r.endReason] += 1;
  console.log(`End reasons:  over=${ends.over}  stuck=${ends.stuck}  max-moves=${ends["max-moves"]}\n`);

  // Final age distribution
  const reach = Array(ages.length).fill(0);
  for (const r of runs) {
    for (let a = 0; a <= r.finalAge; a++) reach[a] += 1;
  }
  console.log("Reach:");
  for (let a = 0; a < ages.length; a++) {
    console.log(`  ${pad(ages[a], 4)}  reached by ${pct(reach[a], n)}`);
  }
  console.log();

  // Per-age combo mix
  console.log("Combo band distribution per age (player moves only, excludes chain steps):");
  console.log("  Age | playerMoves | combos | atCurrent | below(missedAlt) | above | noCurrent/trays");
  for (let a = 0; a < ages.length; a++) {
    let pm = 0, cm = 0, cur = 0, bel = 0, miss = 0, abv = 0, noCur = 0, trays = 0;
    for (const r of runs) {
      const d = r.perAge[a];
      pm += d.playerMoves; cm += d.comboMoves;
      cur += d.comboAtCurrent; bel += d.comboBelow; abv += d.comboAbove;
      miss += d.missedCurrentAlt;
      noCur += d.traysNoCurrentCombo; trays += d.trayChecks;
    }
    if (pm === 0) continue;
    console.log(
      `  ${pad(ages[a], 3)} | ${pad(pm, 11)} | ${pad(cm, 6)} | ${pct(cur, cm)} | ${pct(bel, cm)} (${pct(miss, bel)}) | ${pct(abv, cm)} | ${pct(noCur, trays)}`,
    );
  }
  console.log();

  // Chain share
  let totalCombos = 0, totalChain = 0;
  for (const r of runs) { totalCombos += r.totalComboEvents; totalChain += r.totalChainSteps; }
  console.log(`Chain steps: ${totalChain} of ${totalCombos} combo events (${pct(totalChain, totalCombos)}) — these never count toward age progression after Option A.`);
  console.log();

  // Age-up pacing: for players who entered age A, how many moves did they
  // spend there before advancing (or getting stuck)?
  console.log("Moves spent in age (median across games that entered the age):");
  for (let a = 0; a < ages.length; a++) {
    const samples = runs
      .filter((r) => r.finalAge >= a)
      .map((r) => r.perAge[a].moves)
      .sort((x, y) => x - y);
    if (samples.length === 0) continue;
    const med = samples[Math.floor(samples.length / 2)];
    const advanced = runs.filter((r) => r.perAge[a].advanced).length;
    console.log(`  ${pad(ages[a], 3)}  median=${pad(med, 4)} moves   advanced:${pct(advanced, samples.length)} of entrants`);
  }
}

/* ---------- Entry ---------- */

const games = Number(process.argv[2] ?? 50);
const maxMoves = Number(process.argv[3] ?? 300);
const kb = loadKnowledgeBase();
const snap = buildSnapshot(toRows(kb));
const bundle = buildThemeBundle(snap, "everything");

const runs: GameDiag[] = [];
for (let i = 0; i < games; i++) {
  runs.push(playOne(bundle, 1000 + i, maxMoves));
}
report(runs, bundle);
