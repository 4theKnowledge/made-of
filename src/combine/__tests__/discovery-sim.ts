/**
 * Long-horizon discovery sim: can a motivated player eventually discover
 * everything in a theme by playing many games? Run with:
 *
 *   npx tsx src/combine/__tests__/discovery-sim.ts [theme] [games] [seed]
 *
 * Reports:
 *   - per-game discovery distribution (how much a single run reveals)
 *   - cumulative collection growth (how many games to reach 50%, 90%, 100%)
 *   - items that are stubbornly hard to find (missed by most players)
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
import { matchAt, matchOn } from "../match";
import type { CombineRecipe, ThemeBundle, ThemeKey } from "../types";

/** Score a candidate move: strongly prefer discoveries and current-band
 *  progress, with mild preferences otherwise. Represents a motivated
 *  player who's actively trying to find new things. */
function scoreMove(
  state: GameState,
  recipe: CombineRecipe,
  bundle: ThemeBundle,
): number {
  let score = 0;
  const first = !state.found.includes(recipe.out);
  if (first) score += 500; // discoveries dominate.
  // Prefer current-band combines so the age bar advances.
  const d = recipe.band - (state.age + 1);
  if (d === 0) score += 100;
  else if (d === 1) score += 60;
  else if (d === -1) score += 20;
  else if (d === -2) score += 10;
  // Larger recipes = more variety per move + chain potential.
  score += recipe.all.length * 15;
  if (bundle.terminal.has(recipe.out)) score += 30;
  return score;
}

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

function playOne(
  theme: ThemeKey,
  bundle: ThemeBundle,
  seed: number,
  maxMoves = 300,
): Set<string> {
  const { state: s0 } = newGame(theme, bundle, { seed });
  let state = s0;
  // Keep a Set view of found items so scoring stays O(1) per lookup.
  let foundSet = new Set(state.found);
  const foundRecipe = (id: string) => foundSet.has(id);

  const localScore = (recipe: CombineRecipe): number => {
    let score = 0;
    if (!foundRecipe(recipe.out)) score += 500;
    const d = recipe.band - (state.age + 1);
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
        const bandDelta = Math.abs(r.band - (state.age + 1));
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

    const r = reduce(state, bundle, action);
    state = r.state;
    foundSet = new Set(state.found);
  }

  return new Set(state.found);
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

function run(theme: ThemeKey, nGames: number, baseSeed: number) {
  const kb = loadKnowledgeBase();
  const snap = buildSnapshot(toRows(kb));
  const bundle = buildThemeBundle(snap, theme);

  const totalOutputs = bundle.outputs.size;
  console.log(`\n== ${theme} ==`);
  console.log(`Theme has ${totalOutputs} unique outputs (ingredients + terminals).`);
  console.log(`Running ${nGames} games…`);

  const perGameDiscoveries: number[] = [];
  const cumulative = new Set<string>();
  const cumulativeOverTime: number[] = []; // cumulative size after each game
  const firstSeenAtGame = new Map<string, number>(); // itemId → game index when first discovered
  const timesSeen = new Map<string, number>();

  for (let i = 0; i < nGames; i++) {
    const seed = (baseSeed ^ (i * 2654435761)) | 0;
    const found = playOne(theme, bundle, seed);
    perGameDiscoveries.push(found.size);
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
}

const theme = (process.argv[2] as ThemeKey) || "everything";
const nGames = parseInt(process.argv[3] ?? "", 10) || 1000;
const baseSeed = parseInt(process.argv[4] ?? "", 10) || 0xC0FFEE;
run(theme, nGames, baseSeed);
