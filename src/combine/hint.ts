/**
 * Pick the most actionable hint we can offer right now. Three tiers,
 * best first:
 *
 *   1. "ready"    — a tray or hold tile dropped on an existing cell
 *                   completes a recipe this moment.
 *   2. "one-move" — placing a tray or hold tile on some empty cell
 *                   completes a recipe with the adjacent board tiles.
 *   3. "teach"    — nothing is reachable in one placement; fall back
 *                   to a recipe from the current age that overlaps
 *                   what the player already has.
 *
 * Within each tier we prefer recipes whose output the player hasn't
 * found yet — hints that unlock progression beat hints that only
 * replay what they already know.
 */

import { ageSets } from "./data";
import { type Board, matchAt, matchOn } from "./match";
import type { ThemeBundle } from "./types";

export type HintKind = "ready" | "one-move" | "teach";

export interface HintResult {
  out: string;
  recipe: string[];
  kind: HintKind;
  /** Tray or hold tile the player should use. Unset for the teach tier. */
  using?: string;
  /** Board cells involved in the completed group. Unset for the teach tier. */
  cells?: number[];
}

export interface HintInput {
  board: Board;
  size: number;
  tray: Array<string | null>;
  hold: Array<string | null>;
  age: number;
  /** Items the player has already discovered (lifetime + this run). */
  found: Set<string>;
}

export function findHint(
  bundle: ThemeBundle,
  input: HintInput,
): HintResult | null {
  const { board, size, tray, hold, age, found } = input;

  const sources: string[] = [];
  for (const t of tray) if (t) sources.push(t);
  for (const h of hold) if (h) sources.push(h);

  // Tier 1 — ready-on-board.
  const ready = scanReady(bundle, board, size, sources, found);
  if (ready) return ready;

  // Tier 2 — one placement away.
  const oneMove = scanOneMove(bundle, board, size, sources, found);
  if (oneMove) return oneMove;

  // Tier 3 — teach a recipe from the current age.
  return teach(bundle, age, sources, found);
}

function scanReady(
  bundle: ThemeBundle,
  board: Board,
  size: number,
  sources: string[],
  found: Set<string>,
): HintResult | null {
  let fallback: HintResult | null = null;
  for (const x of sources) {
    for (let j = 0; j < board.length; j++) {
      if (!board[j]) continue;
      const m = matchOn(bundle, board, j, x, size);
      if (!m) continue;
      const hit: HintResult = {
        out: m.recipe.out,
        recipe: m.recipe.all,
        kind: "ready",
        using: x,
        cells: m.cells,
      };
      if (!found.has(m.recipe.out)) return hit;
      if (!fallback) fallback = hit;
    }
  }
  return fallback;
}

function scanOneMove(
  bundle: ThemeBundle,
  board: Board,
  size: number,
  sources: string[],
  found: Set<string>,
): HintResult | null {
  let fallback: HintResult | null = null;
  for (const x of sources) {
    for (let i = 0; i < board.length; i++) {
      if (board[i]) continue;
      const m = matchAt(bundle, board, i, x, size);
      if (!m) continue;
      const hit: HintResult = {
        out: m.recipe.out,
        recipe: m.recipe.all,
        kind: "one-move",
        using: x,
        cells: m.cells,
      };
      if (!found.has(m.recipe.out)) return hit;
      if (!fallback) fallback = hit;
    }
  }
  return fallback;
}

function teach(
  bundle: ThemeBundle,
  age: number,
  sources: string[],
  found: Set<string>,
): HintResult | null {
  const A = ageSets(bundle, age);
  const has = new Set(sources);
  const scored = A.recipes
    .map((r) => {
      const touches = r.all.some((x) => has.has(x));
      const unfound = !found.has(r.out);
      return { r, score: (touches ? 2 : 0) + (unfound ? 1 : 0) };
    })
    .sort((a, b) => b.score - a.score);
  const pick = scored[0]?.r;
  if (!pick) return null;
  return { out: pick.out, recipe: pick.all, kind: "teach" };
}
