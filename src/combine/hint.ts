/**
 * Pick the most actionable hint we can offer right now. Three tiers,
 * best first:
 *
 *   1. "ready"    — a tray, hold, or already-placed board tile dropped
 *                   on an existing cell completes a recipe this moment.
 *   2. "one-move" — placing a tray, hold, or relocated board tile on
 *                   some empty cell completes a recipe with the
 *                   adjacent board tiles.
 *   3. "teach"    — nothing is reachable in one placement; fall back
 *                   to a recipe from the current chapter that overlaps
 *                   what the player already has.
 *
 * Within each tier we prefer recipes whose output the player hasn't
 * found yet — hints that unlock progression beat hints that only
 * replay what they already know.
 */

import { softPool } from "./progression";
import { type Board, matchAt, matchOn } from "./match";
import type { ThemeBundle } from "./types";

export type HintKind = "ready" | "one-move" | "teach";

export interface HintResult {
  out: string;
  recipe: string[];
  kind: HintKind;
  /** Item id the player should use. Unset for the teach tier. */
  using?: string;
  /** Board cells involved in the completed group. Unset for the teach tier. */
  cells?: number[];
  /** Board cell to pick the mover from, when the suggested move relocates
   *  an already-placed tile. Unset when the mover comes from tray/hold. */
  moveFrom?: number;
}

export interface HintInput {
  board: Board;
  size: number;
  tray: Array<string | null>;
  hold: Array<string | null>;
  chapter: number;
  /** Items the player has already discovered (lifetime + this run). */
  found: Set<string>;
}

/** A tile the player can move this turn. `from` is the board cell index
 *  when the mover is relocated from the board; undefined when it comes
 *  from tray or hold. */
interface Source {
  item: string;
  from?: number;
}

export function findHint(
  bundle: ThemeBundle,
  input: HintInput,
): HintResult | null {
  const { board, size, tray, hold, chapter, found } = input;

  const offBoard: Source[] = [];
  for (const t of tray) if (t) offBoard.push({ item: t });
  for (const h of hold) if (h) offBoard.push({ item: h });

  const onBoard: Source[] = [];
  for (let k = 0; k < board.length; k++) {
    const v = board[k];
    if (v) onBoard.push({ item: v, from: k });
  }

  const sources = [...offBoard, ...onBoard];

  // Tier 1 — ready-on-board.
  const ready = scanReady(bundle, board, size, sources, found);
  if (ready) return ready;

  // Tier 2 — one placement away.
  const oneMove = scanOneMove(bundle, board, size, sources, found);
  if (oneMove) return oneMove;

  // Tier 3 — teach a recipe from the current chapter. Tray/hold items are
  // the natural "stuff you have off-board"; board tiles don't count as
  // teach inputs because the teach tier is about what to aim for next.
  return teach(
    bundle,
    chapter,
    offBoard.map((s) => s.item),
    found,
  );
}

/** Vacate the source cell when the mover comes from the board, so
 *  grow() doesn't re-count the tile we're picking up. For off-board
 *  sources the original board is returned unchanged. */
function boardFor(board: Board, from: number | undefined): Board {
  if (from == null) return board;
  const b2 = board.slice();
  b2[from] = null;
  return b2;
}

function scanReady(
  bundle: ThemeBundle,
  board: Board,
  size: number,
  sources: Source[],
  found: Set<string>,
): HintResult | null {
  let fallback: HintResult | null = null;
  for (const s of sources) {
    const b = boardFor(board, s.from);
    for (let j = 0; j < b.length; j++) {
      if (j === s.from) continue;
      if (!b[j]) continue;
      const m = matchOn(bundle, b, j, s.item, size);
      if (!m) continue;
      const hit: HintResult = {
        out: m.recipe.out,
        recipe: m.recipe.all,
        kind: "ready",
        using: s.item,
        cells: m.cells,
        ...(s.from != null ? { moveFrom: s.from } : {}),
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
  sources: Source[],
  found: Set<string>,
): HintResult | null {
  let fallback: HintResult | null = null;
  for (const s of sources) {
    const b = boardFor(board, s.from);
    for (let i = 0; i < b.length; i++) {
      if (b[i]) continue;
      const m = matchAt(bundle, b, i, s.item, size);
      if (!m) continue;
      const hit: HintResult = {
        out: m.recipe.out,
        recipe: m.recipe.all,
        kind: "one-move",
        using: s.item,
        cells: m.cells,
        ...(s.from != null ? { moveFrom: s.from } : {}),
      };
      if (!found.has(m.recipe.out)) return hit;
      if (!fallback) fallback = hit;
    }
  }
  return fallback;
}

function teach(
  bundle: ThemeBundle,
  _chapter: number,
  sources: string[],
  found: Set<string>,
): HintResult | null {
  const sp = softPool(bundle, [...found]);
  // Prefer recipes the player is close to firing; fall back to any recipe
  // so sparse bundles (tests, early game with no `base`) still return
  // something rather than silently giving up on the hint tier.
  const pool = sp.reachableRecipes.length ? sp.reachableRecipes : bundle.recipes;
  const has = new Set(sources);
  const scored = pool
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
