/**
 * Pick tiles and build fresh trays, with a one-or-two-play guarantee.
 *
 * The dealer biases toward tiles that already fit the board, so games keep
 * moving. Every tray is checked before it is dealt: ~3 in 4 trays have a
 * tile that combines straight away, the rest need one set-up move.
 *
 * Four congestion-breaking rules:
 *   1. Pile detection widens with pile size — a pile of 4 is 3x more likely
 *      to trigger partner-picking than a pile of 2.
 *   2. Layer 2 prefers recipes that actually consume the heaviest pile tile.
 *   3. The dealer remembers the last few trays and rejects obvious repeats.
 *   4. A pathological-pile escape hatch forces a diversifying pick when the
 *      recent trays have all been pile-adjacent.
 */

import { ageSets } from "./data";
import { getGpOverrides } from "./gp-overrides";
import { matchAt, playsInOne, playsInTwo, type Board } from "./match";
import { pick, rand, type RngState } from "./rng";
import { DISCOVERED_WEIGHT, softPool, type SoftPool } from "./soft-bands";
import type { ThemeBundle } from "./types";

/** How many tools may sit on the board at once. The prototype's limit at
 *  cbPick line 3380–3381. */
const MAX_TOOLS_ON_BOARD = 4;

/** How many trays back the dealer remembers for anti-repetition. */
const RECENT_TRAY_WINDOW = 2;

/** The dealer only knows about the state it needs — not the whole game. */
export interface DealerView {
  bundle: ThemeBundle;
  board: Board;
  tray: Array<string | null>;
  size: number;
  /** 0-based age index. */
  age: number;
  rng: RngState;
  /** Short memory of recent trays as sorted multisets, newest first. The
   *  caller owns this array; `dealTray` reads and mutates it in place. */
  recentTrays?: string[][];
  /** Items the player has discovered this run. Threaded through for the
   *  soft-bands sampler (T-0163); banded-mode ignores it. */
  found?: string[];
  /** Internal: non-null when the current pick should avoid partners of
   *  this piled tile. Set by the escape hatch. */
  _diversifyAway?: string | null;
}

/** Count how many of each in-age, non-tool tile are on the board. */
function tallyBoard(view: DealerView): Map<string, number> {
  const mode = getGpOverrides().mode;
  // In soft mode, all known/reachable tiles are "in use" for pile-detection
  // purposes. In banded mode, use the age window's USE set.
  const inUse: Set<string> =
    mode === "soft" && view.found
      ? softPool(view.bundle, view.found).pool
      : ageSets(view.bundle, view.age).USE;
  const counts = new Map<string, number>();
  for (const v of view.board) {
    if (!v) continue;
    if (view.bundle.tools.has(v)) continue;
    if (!inUse.has(v)) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}

/** Weighted pick for soft mode: already-discovered tiles get `DISCOVERED_WEIGHT`,
 *  undiscovered ones get 1.0. Reduces tray dominance of exhausted items so
 *  the player sees fresh things more often, without removing ingredients
 *  that may still be needed for future combos. Pure function; uses the
 *  provided RNG state for determinism. */
function pickWeighted(
  rng: RngState,
  arr: readonly string[],
  found: Set<string>,
): string | undefined {
  if (arr.length === 0) return undefined;
  let total = 0;
  for (const x of arr) total += found.has(x) ? DISCOVERED_WEIGHT : 1;
  if (total <= 0) return pick(rng, arr); // all weights zero — fall back to uniform
  let r = rand(rng) * total;
  for (const x of arr) {
    const w = found.has(x) ? DISCOVERED_WEIGHT : 1;
    r -= w;
    if (r <= 0) return x;
  }
  return arr[arr.length - 1];
}

/** Mode-aware pick. In soft mode (and with `found` threaded through the
 *  DealerView), applies the discovered-tile down-weight. In banded mode,
 *  falls back to uniform pick so existing behaviour is preserved bit-for-bit. */
function pickMaybeWeighted(
  view: DealerView,
  arr: readonly string[],
  mode: "banded" | "flat" | "soft",
): string | undefined {
  if (mode !== "soft" || !view.found) return pick(view.rng, arr);
  return pickWeighted(view.rng, arr, new Set(view.found));
}

/** The heaviest pile on the board, or null if nothing is piling. */
function heaviestPile(view: DealerView): { tile: string; count: number } | null {
  const counts = tallyBoard(view);
  let best: { tile: string; count: number } | null = null;
  for (const [tile, count] of counts) {
    if (count < 2) continue;
    if (!best || count > best.count) best = { tile, count };
  }
  return best;
}

/** Pick ONE tile for the tray. Prefers tiles that fit the board; falls
 *  through weighted strategies on each roll. */
export function pickOne(view: DealerView): string | null {
  const mode = getGpOverrides().mode;
  // Mode selects the sampling universe. Banded (default) uses age-indexed
  // ING/BASE/MID; soft uses the reachability pool from soft-bands; both
  // hand the dealer the same shape so the layers below don't branch.
  let ING: Set<string>;
  let BASE: string[];
  let MID: string[];
  let recipes;
  if (mode === "soft" && view.found) {
    const sp = softPool(view.bundle, view.found);
    ING = sp.pool;
    BASE = sp.basePool;
    MID = sp.midPool;
    recipes = sp.reachableRecipes.length ? sp.reachableRecipes : view.bundle.recipes;
  } else {
    const banded = ageSets(view.bundle, view.age);
    ING = banded.ING;
    BASE = banded.BASE;
    MID = banded.MID;
    recipes = banded.recipes;
  }
  const A = { ING, BASE, MID, recipes }; // shape-compat for layers below
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
  const pile = heaviestPile(view);

  // Escape hatch (diversify): the caller detected a pathological pile and
  // flagged this pick to avoid anything that touches it. Fall straight to
  // Layer 4-style raw/base picks, skipping anything from a recipe that
  // includes the piled tile.
  const divAway = view._diversifyAway ?? null;
  if (divAway) {
    const forbidden = new Set<string>([divAway]);
    for (const r of A.recipes) {
      if (!r.all.includes(divAway)) continue;
      for (const x of r.all) forbidden.add(x);
    }
    const safe = A.BASE.filter(
      (x) => okTool(x) && !view.bundle.tools.has(x) && !forbidden.has(x) && !inTray.has(x),
    );
    if (safe.length) return pickMaybeWeighted(view, safe, mode) ?? null;
    const safeAny = [...A.ING].filter((x) => okTool(x) && !forbidden.has(x) && !inTray.has(x));
    if (safeAny.length) return pickMaybeWeighted(view, safeAny, mode) ?? null;
    // Nothing diversifying available — fall through to normal picks.
  }

  // 0. If something is piling up on the board, pick a partner for it. The
  //    trigger window widens with pile size: pile 2 keeps the original ~15%
  //    window, pile 3 doubles it, pile 4+ triples it. Larger piles are
  //    more disruptive and the dealer should push harder to clear them.
  if (pile && pile.count >= 2) {
    const windowSize = pile.count >= 4 ? 0.45 : pile.count === 3 ? 0.30 : 0.15;
    const windowStart = 0.45;
    if (roll >= windowStart && roll < windowStart + windowSize) {
      const need: string[] = [];
      for (const r of A.recipes) {
        if (!r.all.includes(pile.tile)) continue;
        for (const x of r.all) {
          if (x === pile.tile) continue;
          if (!okTool(x)) continue;
          if (inTray.has(x)) continue;
          if (onBoard.has(x) && view.bundle.tools.has(x)) continue;
          need.push(x);
        }
      }
      if (need.length) return pickMaybeWeighted(view, need, mode) ?? null;
    }
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
    if (cands.length) return pickMaybeWeighted(view, cands, mode) ?? null;
  }

  // 2. A partner for something already on the board. When there is a pile,
  //    prefer recipes that *consume the piled tile specifically* over
  //    recipes that merely share any ingredient with the board — otherwise
  //    the pool is dominated by irrelevant partners that keep the pile
  //    stuck.
  if (roll < 0.8) {
    const pileFirst: string[] = [];
    const otherOnBoard: string[] = [];
    for (const r of A.recipes) {
      const includesPile = pile ? r.all.includes(pile.tile) : false;
      const touchesBoard = r.all.some((x) => onBoard.has(x));
      if (!includesPile && !touchesBoard) continue;
      for (const x of r.all) {
        if (onBoard.has(x)) continue;
        if (!okTool(x)) continue;
        if (inTray.has(x)) continue;
        if (includesPile) pileFirst.push(x);
        else otherOnBoard.push(x);
      }
    }
    // If there's a pile and we've got pile-combining partners, weight
    // heavily toward them (3:1) rather than all-or-nothing — occasional
    // "wrong" partners still help by introducing variety.
    if (pileFirst.length && otherOnBoard.length && rand(view.rng) < 0.75) {
      return pickMaybeWeighted(view, pileFirst, mode) ?? null;
    }
    if (pileFirst.length) return pickMaybeWeighted(view, pileFirst, mode) ?? null;
    if (otherOnBoard.length) return pickMaybeWeighted(view, otherOnBoard, mode) ?? null;
  }

  // 3. A made thing from this age — starts a chain next time.
  if (roll < 0.88 && A.MID.length) {
    return pickMaybeWeighted(view, A.MID, mode) ?? null;
  }

  // 4. A raw thing for this age; occasionally allow tools too.
  const base = A.BASE.filter(
    (x) => okTool(x) && !view.bundle.tools.has(x),
  );
  const pool =
    rand(view.rng) < 0.25 ? A.BASE.filter((x) => okTool(x)) : base;
  if (pool.length) return pickMaybeWeighted(view, pool, mode) ?? null;
  return pickMaybeWeighted(view, [...A.ING], mode) ?? null;
}

/** Canonical fingerprint for a tray — sorted multiset of non-null tiles. */
function trayKey(tray: Array<string | null>): string[] {
  return tray.filter((v): v is string => Boolean(v)).sort();
}

/** Two tray fingerprints match exactly? */
function sameTray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Should we trigger the pathological-pile escape hatch? Fires when:
 *   - a pile of ≥4 is on the board, and
 *   - every tray in `recentTrays` was pile-adjacent (contained the pile
 *     tile or one of its partners).
 *  In that case, at least one slot in the next tray will be a diversifying
 *  pick that avoids the pile's recipe graph. */
function shouldDiversify(
  view: DealerView,
  pile: { tile: string; count: number } | null,
): boolean {
  if (!pile || pile.count < 4) return false;
  const recent = view.recentTrays ?? [];
  if (recent.length < RECENT_TRAY_WINDOW) return false;
  const A = ageSets(view.bundle, view.age);
  const partners = new Set<string>([pile.tile]);
  for (const r of A.recipes) {
    if (!r.all.includes(pile.tile)) continue;
    for (const x of r.all) partners.add(x);
  }
  return recent.every((t) => t.some((id) => partners.has(id)));
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
  const recordTray = (final: Array<string | null>): void => {
    if (!view.recentTrays) return;
    view.recentTrays.unshift(trayKey(final));
    while (view.recentTrays.length > RECENT_TRAY_WINDOW) view.recentTrays.pop();
  };
  const wantOne = rand(view.rng) < 0.75;
  const pile = heaviestPile(view);
  const diversify = shouldDiversify(view, pile);
  let fallback: Array<string | null> | null = null;

  for (let k = 0; k < 60; k++) {
    const next: Array<string | null> = [];
    for (let s = 0; s < 3; s++) {
      // On diversify runs, force the first slot off the pile's recipe
      // graph. The remaining slots pick normally so the tray still has
      // some board-aware tiles.
      const diversifyAway = diversify && s === 0 && pile ? pile.tile : null;
      next.push(
        pickOne({ ...view, tray: next, _diversifyAway: diversifyAway }),
      );
    }
    writeTray(next);

    // Avoid trays of three-of-the-same for the first 40 tries.
    const nonNull = next.filter((v): v is string => Boolean(v));
    if (k < 40 && new Set(nonNull).size < nonNull.length) continue;

    // Avoid obvious repeats of recent trays for the first 40 tries.
    if (k < 40 && view.recentTrays?.length) {
      const key = trayKey(next);
      if (view.recentTrays.some((t) => sameTray(t, key))) continue;
    }

    const one = playsInOne(view.bundle, view.board, next, view.size);
    if (one && (wantOne || k > 30)) {
      recordTray(next);
      return view.tray;
    }
    if (!one && playsInTwo(view.bundle, view.board, next, view.size)) {
      if (!wantOne) {
        recordTray(next);
        return view.tray;
      }
      if (!fallback) fallback = next.slice();
    }
  }

  if (fallback) {
    writeTray(fallback);
    recordTray(fallback);
    return view.tray;
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
      writeTray(trial);
      recordTray(trial);
      return view.tray;
    }
  }

  // Give up — the board must be nearly full.
  return view.tray;
}
