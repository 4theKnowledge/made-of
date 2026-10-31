/**
 * Pick tiles and build fresh trays, with a one-or-two-play guarantee.
 *
 * The dealer biases toward tiles that already fit the board, so games keep
 * moving. Every tray is checked before it is dealt: ~3 in 4 trays have a
 * tile that combines straight away, the rest need one set-up move.
 *
 * Ports `cbPick` + `cbDeal` from legacy/made-of.html lines 3377–3449.
 */

import { ageSets } from "./data";
import { matchAt, playsInOne, playsInTwo, type Board } from "./match";
import { pick, rand, type RngState } from "./rng";
import type { ThemeBundle } from "./types";

/** How many tools may sit on the board at once. The prototype's limit at
 *  cbPick line 3380–3381. */
const MAX_TOOLS_ON_BOARD = 4;

/** The dealer only knows about the state it needs — not the whole game. */
export interface DealerView {
  bundle: ThemeBundle;
  board: Board;
  tray: Array<string | null>;
  size: number;
  /** 0-based age index. */
  age: number;
  rng: RngState;
}

/** Pick ONE tile for the tray. Prefers tiles that fit the board; falls
 *  through weighted strategies on each roll. */
export function pickOne(view: DealerView): string | null {
  const A = ageSets(view.bundle, view.age);
  const onBoard = new Set(view.board.filter((v): v is string => Boolean(v)));
  const inTray = new Set(
    view.tray.filter((v): v is string => Boolean(v)),
  );
  const toolsOut = view.board.filter(
    (x) => x != null && view.bundle.tools.has(x),
  ).length;

  const okTool = (x: string): boolean =>
    !view.bundle.tools.has(x) ||
    (!onBoard.has(x) && !inTray.has(x) && toolsOut < MAX_TOOLS_ON_BOARD);

  const roll = rand(view.rng);

  // 0. If something is piling up on the board, pick a partner for it.
  const counts = new Map<string, number>();
  for (const v of view.board) {
    if (!v) continue;
    if (view.bundle.tools.has(v)) continue;
    if (!A.USE.has(v)) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const pile = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (pile && pile[1] >= 2 && roll >= 0.45 && roll < 0.6) {
    const need: string[] = [];
    for (const r of A.recipes) {
      if (!r.all.includes(pile[0])) continue;
      for (const x of r.all) {
        if (x === pile[0]) continue;
        if (!okTool(x)) continue;
        if (inTray.has(x)) continue;
        if (onBoard.has(x) && view.bundle.tools.has(x)) continue;
        need.push(x);
      }
    }
    if (need.length) return pick(view.rng, need) ?? null;
  }

  // 1. Something that would combine right now on some empty cell.
  if (roll < 0.45) {
    const cands: string[] = [];
    for (const x of A.ING) {
      if (!okTool(x)) continue;
      if (inTray.has(x)) continue;
      // Does it combine somewhere?
      let fits = false;
      for (let i = 0; i < view.board.length; i++) {
        if (view.board[i]) continue;
        if (matchAt(view.bundle, view.board, i, x, view.size)) {
          fits = true;
          break;
        }
      }
      if (fits) cands.push(x);
    }
    if (cands.length) return pick(view.rng, cands) ?? null;
  }

  // 2. A partner for something already on the board.
  if (roll < 0.8) {
    const helpful: string[] = [];
    for (const r of A.recipes) {
      if (!r.all.some((x) => onBoard.has(x))) continue;
      for (const x of r.all) {
        if (onBoard.has(x)) continue;
        if (!okTool(x)) continue;
        if (inTray.has(x)) continue;
        helpful.push(x);
      }
    }
    if (helpful.length) return pick(view.rng, helpful) ?? null;
  }

  // 3. A made thing from this age — starts a chain next time.
  if (roll < 0.88 && A.MID.length) {
    return pick(view.rng, A.MID) ?? null;
  }

  // 4. A raw thing for this age; occasionally allow tools too.
  const base = A.BASE.filter(
    (x) => okTool(x) && !view.bundle.tools.has(x),
  );
  const pool =
    rand(view.rng) < 0.25 ? A.BASE.filter((x) => okTool(x)) : base;
  if (pool.length) return pick(view.rng, pool) ?? null;
  return pick(view.rng, [...A.ING]) ?? null;
}

/**
 * Fill the tray with three tiles so that at least one combine is reachable
 * within two placements. Target distribution: ~75% of trays have a move
 * on the first placement; the rest need one set-up move.
 *
 * Writes the result in-place into `view.tray` (so callers that share the
 * tray array see the changes), then returns the same array.
 */
export function dealTray(view: DealerView): Array<string | null> {
  const writeTray = (next: Array<string | null>): Array<string | null> => {
    for (let i = 0; i < view.tray.length; i++) view.tray[i] = next[i];
    return view.tray;
  };
  const wantOne = rand(view.rng) < 0.75;
  let fallback: Array<string | null> | null = null;

  for (let k = 0; k < 60; k++) {
    const next: Array<string | null> = [];
    for (let s = 0; s < 3; s++) next.push(pickOne({ ...view, tray: next }));
    writeTray(next);

    // Avoid trays of three-of-the-same for the first 40 tries.
    const nonNull = next.filter((v): v is string => Boolean(v));
    if (k < 40 && new Set(nonNull).size < nonNull.length) continue;

    const one = playsInOne(view.bundle, view.board, next, view.size);
    if (one && (wantOne || k > 30)) return view.tray;
    if (!one && playsInTwo(view.bundle, view.board, next, view.size)) {
      if (!wantOne) return view.tray;
      if (!fallback) fallback = next.slice();
    }
  }

  if (fallback) {
    return writeTray(fallback);
  }

  // Last resort: hand over both halves of a two-ingredient recipe from the
  // current age plus one pick.
  const A = ageSets(view.bundle, view.age);
  const twos = A.recipes.filter((r) => r.all.length === 2).slice();
  // Fisher-Yates with our RNG so order stays deterministic.
  for (let i = twos.length - 1; i > 0; i--) {
    const j = Math.floor(rand(view.rng) * (i + 1));
    [twos[i], twos[j]] = [twos[j], twos[i]];
  }
  for (const r of twos) {
    const extra = pickOne({ ...view, tray: [r.all[0], r.all[1], null] });
    const trial: Array<string | null> = [r.all[0], r.all[1], extra];
    if (
      playsInOne(view.bundle, view.board, trial, view.size) ||
      playsInTwo(view.bundle, view.board, trial, view.size)
    ) {
      // Shuffle so the two halves aren't always in slots 0/1.
      for (let i = trial.length - 1; i > 0; i--) {
        const j = Math.floor(rand(view.rng) * (i + 1));
        [trial[i], trial[j]] = [trial[j], trial[i]];
      }
      return writeTray(trial);
    }
  }

  // Give up — the board must be nearly full.
  return view.tray;
}
