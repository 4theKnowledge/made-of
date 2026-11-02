/**
 * Grow a group of edge-connected tiles until it holds exactly one recipe's
 * ingredients, and tell callers which recipe matched (if any).
 *
 * Any shape counts: a line, an L, a 3×3, a zig-zag — the only rule is that
 * every tile in the group touches another tile in the group. Tiles out of
 * contact break the group.
 */

import type { CombineRecipe, ThemeBundle } from "./types";

/** A board is a flat array of cell contents. `null` is empty. Each entry
 *  is the item id (slug) of the tile at that cell. */
export type Board = Array<string | null>;

/** The four edge-adjacent cell indices (no diagonals), bounded by the
 *  board size. */
export function edgeNeighbours(i: number, size: number): number[] {
  const r = Math.floor(i / size);
  const c = i % size;
  const out: number[] = [];
  if (r > 0) out.push(i - size);
  if (r < size - 1) out.push(i + size);
  if (c > 0) out.push(i - 1);
  if (c < size - 1) out.push(i + 1);
  return out;
}

/**
 * Grow a group out from `cells` (a prefix of the group) until it holds
 * exactly what's in `need`. Depth-first with backtracking: for each
 * neighbour whose item is still needed, recurse with that cell added and
 * that need removed. Returns the full cell list on success, or null.
 */
export function grow(
  board: Board,
  cells: number[],
  need: string[],
  size: number,
): number[] | null {
  if (need.length === 0) return cells;
  const tried = new Set<number>();
  for (const c of cells) {
    for (const n of edgeNeighbours(c, size)) {
      if (cells.includes(n) || tried.has(n)) continue;
      tried.add(n);
      const v = board[n];
      if (!v) continue;
      const idx = need.indexOf(v);
      if (idx < 0) continue;
      const rest = need.slice(0, idx).concat(need.slice(idx + 1));
      const got = grow(board, [...cells, n], rest, size);
      if (got) return got;
    }
  }
  return null;
}

export interface MatchResult {
  recipe: CombineRecipe;
  /** All cells that make up the group (the seed cell plus the grown ones). */
  cells: number[];
}

/**
 * What happens if item `x` sat at cell `i`? Prefers bigger recipes
 * (byIngredient is already sorted biggest-first). Returns the matching
 * recipe plus the full cell list, or null.
 */
export function matchAt(
  bundle: ThemeBundle,
  board: Board,
  i: number,
  x: string,
  size: number,
): MatchResult | null {
  const rs = bundle.byIngredient.get(x);
  if (!rs) return null;
  for (const r of rs) {
    const need = r.all.filter((y) => y !== x);
    const got = grow(board, [i], need, size);
    if (got) return { recipe: r, cells: got };
  }
  return null;
}

/**
 * What happens if item `x` is dropped on top of cell `j` which already
 * holds item `y`? Both are consumed. Returns the matching recipe + full
 * group of cells involved (including j).
 */
export function matchOn(
  bundle: ThemeBundle,
  board: Board,
  j: number,
  x: string,
  size: number,
): MatchResult | null {
  const y = board[j];
  if (!y || x === y) return null;
  const rs = bundle.byIngredient.get(x);
  if (!rs) return null;
  for (const r of rs) {
    if (!r.all.includes(y)) continue;
    const need = r.all.filter((z) => z !== x && z !== y);
    const got = grow(board, [j], need, size);
    if (got) return { recipe: r, cells: got };
  }
  return null;
}

/** Is there a tile in the tray that combines on *some* empty square (or on
 *  top of an existing tile) right now? */
export function playsInOne(
  bundle: ThemeBundle,
  board: Board,
  tray: Array<string | null>,
  size: number,
): boolean {
  for (const t of tray) {
    if (t == null) continue;
    for (let i = 0; i < board.length; i++) {
      if (board[i]) {
        if (matchOn(bundle, board, i, t, size)) return true;
      } else {
        if (matchAt(bundle, board, i, t, size)) return true;
      }
    }
  }
  return false;
}

/** Is there a pair of distinct tray tiles where placing the first on some
 *  empty cell lets the second combine on an adjacent empty cell? */
export function playsInTwo(
  bundle: ThemeBundle,
  board: Board,
  tray: Array<string | null>,
  size: number,
): boolean {
  for (let a = 0; a < tray.length; a++) {
    for (let b = 0; b < tray.length; b++) {
      if (a === b) continue;
      const ta = tray[a];
      const tb = tray[b];
      if (ta == null || tb == null) continue;
      for (let i = 0; i < board.length; i++) {
        if (board[i]) continue;
        const b2 = board.slice();
        b2[i] = ta;
        for (const j of edgeNeighbours(i, size)) {
          if (b2[j]) continue;
          if (matchAt(bundle, b2, j, tb, size)) return true;
        }
      }
    }
  }
  return false;
}
