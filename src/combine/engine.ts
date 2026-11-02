/**
 * The Combine engine: a pure reducer over game state.
 *
 * The engine takes a state and an action, returns the next state plus a
 * list of events the UI/audio layer can animate. No DOM, no timers, no
 * randomness outside the state's `rng` — this is what lets saved games
 * resume exactly and the daily game be identical across players.
 *
 * The prototype's imperative async flow (cbPlace → cbResolve → cbAbsorb →
 * cbAfterMove) is flattened into straight-line state transitions. The one
 * place that needed asyncness — the "pick what to make" prompt — becomes a
 * `choosing` state the engine stops at, resumable by a `choose(k)` action.
 *
 * Ports the game rules from legacy/made-of.html lines 3453–3604, with the
 * two tried-and-removed features (blueprints, resting sources) left out
 * per the spec.
 */

import { ageSets, buildThemeBundle } from "./data";
import {
  edgeNeighbours,
  matchAt,
  matchOn,
  playsInOne,
  playsInTwo,
  type Board,
} from "./match";
import { dealTray } from "./deal";
import { dailySeed, freshEndlessSeed, makeRng, pick, shuffle, type RngState } from "./rng";
import type { CombineRecipe, ThemeBundle, ThemeKey } from "./types";

/* ========================================================================
 * State + actions
 * ====================================================================== */

export const TIER_VALUE: Record<string, number> = {
  F: 1,
  N: 1,
  M: 2,
  C: 3,
  P: 4,
  S: 5,
};

/** Turns a stranded tile hangs on before it crumbles (see spec: 4th tick
 *  removes). */
export const CRUMBLE_TTL = 3;

/** Hold-zone capacity per age. Index is the 0-based age; capacity grows
 *  one slot per age. Flatten to all-1s to turn the growth off during
 *  playtesting. The array extends to cover more ages than any theme
 *  actually ships. */
export const HOLD_CAPACITY_BY_AGE: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];

export function holdCapacity(age: number): number {
  return HOLD_CAPACITY_BY_AGE[Math.min(age, HOLD_CAPACITY_BY_AGE.length - 1)] ?? 1;
}

/** A crumble counter for cell `i`: counts ticks since the tile stopped
 *  being "useful" in the current age. */
export interface CrumbleCounter {
  /** The tile id this count is for. If the tile at `i` changes, the counter
   *  resets. */
  id: string;
  n: number;
}

/** A pending "which output?" prompt. The engine stops here and the UI must
 *  send a `choose(k)` action to resume. */
export interface ChoosingState {
  /** Alternative outputs for the matched ingredient set. */
  options: CombineRecipe[];
  /** Cells involved in the match (the whole group). */
  cells: number[];
  /** Chain multiplier at the time the group formed. */
  mult: number;
}

export interface GameState {
  theme: ThemeKey;
  daily: string | null;
  n: number;
  rng: RngState;
  board: Board;
  tray: Array<string | null>;
  score: number;
  made: number;
  longest: number;
  /** Items first-found during this game. */
  found: string[];
  /** The ingredient list the player actually used the first time they
   *  made each output this run. Lets the info card show "How you made it"
   *  with the right recipe when an item has multiple valid recipes
   *  (e.g. window = glass+wood OR glass+aluminium). */
  howMade: Record<string, string[]>;
  swaps: number;
  clears: number;
  hints: number;
  mv: number;
  shore: number;
  over: boolean;
  newBest: boolean;
  moves: number;
  shelf: string[];
  /** Held tiles. Length is the current age's capacity (see
   *  `HOLD_CAPACITY_BY_AGE`). Commit-until-used: a stored tile only leaves
   *  by being placed on the board or crumbling. */
  hold: Array<string | null>;
  /** 0-based age index. */
  age: number;
  /** Count of makes in the current age (used for the age bar). */
  ageMade: number;
  /** Per-cell crumble counters. Null means useful / no counter. */
  crumb: Array<CrumbleCounter | null>;
  /** Per-cell shore flag. A shored tile is exempt from crumble for as long
   *  as it stays in that cell (combine, move, clear, or a new placement
   *  on top of it all clear the flag). */
  shored: boolean[];
  closeCalls: number;
  /** Short memory of recently-dealt trays as sorted multisets, newest first.
   *  Lets the dealer detect "the user keeps getting the same tray". */
  recentTrays: string[][];
  /** Non-null while the engine is waiting for the player to pick an
   *  output. */
  choosing: ChoosingState | null;
  /** Undo charges remaining this run. Rewinds the last board-modifying
   *  action (`place` / `drop-on` / `move`), but only if that action did
   *  not unlock a new discovery — that keeps the daily collection
   *  scope safe from unlock-then-undo gaming (see CLAUDE.md on daily
   *  isolation). Not serialised: undo is session-only. */
  undos: number;
  /** Snapshot taken right before the last board-modifying action, or
   *  null when there's nothing to undo (fresh game, after a discovery,
   *  after undo has already fired). Not serialised. */
  lastSnapshot: GameState | null;
}

/* Events — fire-and-forget notifications for the UI/audio layer. */
export type Event =
  | { type: "placed"; at: number; tile: string }
  | { type: "nope"; at: number }
  | {
      type: "combine";
      cells: number[];
      /** Ingredient tile ids in the same order as `cells`. The UI uses these
       *  to overlay the ingredients during the fuse pulse, since the engine
       *  has already consumed them by the time the UI applies this state. */
      inputs: string[];
      /** Cell the output tile landed on. */
      at: number;
      out: string;
      pts: number;
      mult: number;
      close: number;
    }
  | { type: "shipped"; at: number; out: string; bonus: number }
  | { type: "age-up"; age: number; sample: string[] }
  | { type: "crumble"; cells: number[] }
  | { type: "hold-crumble"; slots: number[]; tiles: string[] }
  | { type: "discovery"; out: string; recipe: string[] }
  | { type: "dealt" }
  | { type: "over" };

/** Tile source for placement actions. */
export type TileSource = "tray" | "hold";

export type Action =
  | { type: "new-game"; theme: ThemeKey; daily: string | null; size: number; seed?: number }
  | { type: "place"; slot: number; cell: number; source?: TileSource }
  | { type: "drop-on"; slot: number; cell: number; source?: TileSource }
  | { type: "choose"; outputIndex: number }
  | { type: "swap" }
  | { type: "clear"; cell: number }
  | { type: "hint" }
  | { type: "move"; from: number; to: number }
  | { type: "shore"; cell: number }
  | { type: "hold"; slot: number }
  | { type: "undo" };

export interface ReduceResult {
  state: GameState;
  events: Event[];
}

/* ========================================================================
 * Internal helpers
 * ====================================================================== */

function cloneBoard(b: Board): Board {
  return b.slice();
}
function cloneTray(t: Array<string | null>): Array<string | null> {
  return t.slice();
}
function cloneCrumb(c: Array<CrumbleCounter | null>): Array<CrumbleCounter | null> {
  return c.map((x) => (x ? { ...x } : null));
}
function cloneState(s: GameState): GameState {
  return {
    ...s,
    rng: { ...s.rng },
    board: cloneBoard(s.board),
    tray: cloneTray(s.tray),
    found: [...s.found],
    howMade: { ...s.howMade },
    shelf: [...s.shelf],
    hold: s.hold.slice(),
    crumb: cloneCrumb(s.crumb),
    shored: s.shored.slice(),
    recentTrays: s.recentTrays.map((t) => t.slice()),
    choosing: s.choosing
      ? { options: [...s.choosing.options], cells: [...s.choosing.cells], mult: s.choosing.mult }
      : null,
    // Snapshots are frozen captures — pass the reference through. We
    // explicitly null their own `lastSnapshot` at capture time so this
    // never nests more than one level deep.
    lastSnapshot: s.lastSnapshot,
  };
}

/** Deep copy a state for the undo buffer. Flattens `lastSnapshot` to
 *  null so a captured snapshot can't itself be undone recursively. */
function snapshotState(s: GameState): GameState {
  const c = cloneState(s);
  c.lastSnapshot = null;
  return c;
}

/** How full is the board, in [0, 1]? */
function fullness(board: Board): number {
  return board.filter(Boolean).length / board.length;
}

/** Unique discoveries at the current age's band needed to leave each age
 *  (0-based): 7, 9, 11, 13, 15, 17. Only first-time makes of items whose
 *  minimum band is `age + 1` count — see `finishResolve`. */
function ageNeed(age: number): number {
  return 7 + 2 * age;
}

/** Tier value for scoring. Falls back to M=2 for unknown tiers. */
function tierOf(bundle: ThemeBundle, id: string): number {
  const t = bundle.items.get(id)?.tier ?? "M";
  return TIER_VALUE[t] ?? 2;
}

/** All alternatives for a recipe's ingredient set (self included). */
function alternatives(bundle: ThemeBundle, r: CombineRecipe): CombineRecipe[] {
  const key = [...r.all].sort().join("+");
  return bundle.sameIngredients.get(key) ?? [r];
}

/** Order recipe-picker options so already-found outputs come first (in
 *  their natural `alternatives` order — stable, so a player who knows
 *  the right answer isn't punished) and unknown outputs are shuffled by
 *  the game RNG. Shuffling unknowns prevents muscle-memorising "the
 *  second ? is always wood", which would let the player game the
 *  picker. Using `state.rng` keeps daily puzzles identical across
 *  players. */
function orderChoosingOptions(
  state: GameState,
  options: readonly CombineRecipe[],
): CombineRecipe[] {
  const foundSet = new Set(state.found);
  const found: CombineRecipe[] = [];
  const unknown: CombineRecipe[] = [];
  for (const r of options) (foundSet.has(r.out) ? found : unknown).push(r);
  return [...found, ...shuffle(state.rng, unknown)];
}

/* ========================================================================
 * Resolve: a match forms, consume ingredients, maybe chain again.
 * ====================================================================== */

/**
 * Run one combine, picking an output automatically (chain steps, dealer
 * auto-made starts). Mutates `state` in place; appends to `events`.
 *
 * If the match has multiple possible outputs AND this is the player's own
 * move (`mult === 1 && !auto`), returns `{ needsChoice: true }` so the
 * caller can set `state.choosing` and bail. The engine resumes on `choose`.
 */
function resolveMatch(
  state: GameState,
  bundle: ThemeBundle,
  seed: { recipe: CombineRecipe; cells: number[]; mult: number; auto: boolean },
  events: Event[],
): { needsChoice: boolean } {
  const alts = alternatives(bundle, seed.recipe);
  let recipe = seed.recipe;
  if (alts.length > 1) {
    if (!seed.auto && seed.mult === 1) {
      return { needsChoice: true };
    }
    // Auto-pick an unfound alternative if any, else any.
    const fresh = alts.filter((q) => !state.found.includes(q.out));
    const pool = fresh.length ? fresh : alts;
    recipe = pick(state.rng, pool) ?? recipe;
  }
  finishResolve(state, bundle, recipe, seed.cells, seed.mult, events);
  return { needsChoice: false };
}

/** The non-choice tail of a resolve: consume cells, place the new tile,
 *  score, chain. */
function finishResolve(
  state: GameState,
  bundle: ThemeBundle,
  recipe: CombineRecipe,
  cells: number[],
  mult: number,
  events: Event[],
): void {
  const fullBefore = fullness(state.board);
  // Snapshot the ingredient tiles before we consume them; the UI uses these
  // to animate a brief fuse pulse on the input cells (which are already
  // nulled by the time the UI applies this state).
  const inputs = cells.map((j) => state.board[j] ?? "");
  // Every cell in the group is consumed (tools too — Combine does not keep
  // "made with" items). Clear any shore flags on the consumed cells.
  for (const j of cells) {
    state.board[j] = null;
    state.shored[j] = false;
  }

  // The new tile lands where it can keep combining if possible, else first.
  const spots = cells.slice();
  // Any newly-free neighbouring cell (for the "flow outward" fallback).
  const fallback = [...new Set(cells.flatMap((c) => edgeNeighbours(c, state.n)))].filter(
    (j) => !state.board[j] && !cells.includes(j),
  );
  const choice =
    spots.find((j) => matchAt(bundle, state.board, j, recipe.out, state.n)) ??
    spots[0] ??
    fallback[0];
  if (choice == null) return;
  state.board[choice] = recipe.out;
  state.made++;
  state.longest = Math.max(state.longest, mult);

  const pts = Math.round(
    20 * tierOf(bundle, recipe.out) * mult * (1 + 0.5 * (recipe.all.length - 2)),
  );
  state.score += pts;

  const close =
    cells.length - 1 >= 3 && fullBefore >= 0.8
      ? Math.round(30 * (cells.length - 1) * (1 + (fullBefore - 0.8) * 5))
      : 0;
  if (close) {
    state.score += close;
    state.closeCalls++;
  }

  const first = !state.found.includes(recipe.out);
  if (first) {
    state.found.push(recipe.out);
    state.howMade[recipe.out] = recipe.all.slice();
    // Age bar tracks unique discoveries whose min band is the current age's
    // band, so the "N/need" counter matches the tiles shown in the Ages
    // dialog for this age. Later-band discoveries belong to a future age.
    const minBand = bundle.outBand.get(recipe.out);
    if (minBand === state.age + 1) state.ageMade++;
    events.push({ type: "discovery", out: recipe.out, recipe: recipe.all });
  }
  events.push({
    type: "combine",
    cells: cells.slice(),
    inputs,
    at: choice,
    out: recipe.out,
    pts,
    mult,
    close,
  });

  // Terminal (finished thing): ship to the shelf.
  if (bundle.terminal.has(recipe.out)) {
    const bonus = Math.round(40 * tierOf(bundle, recipe.out) * mult);
    state.board[choice] = null;
    state.score += bonus;
    state.shelf.push(recipe.out);
    events.push({ type: "shipped", at: choice, out: recipe.out, bonus });
    return;
  }

  // Non-terminal: might chain if the new tile matches at its new cell.
  const next = matchAt(bundle, state.board, choice, recipe.out, state.n);
  if (next) {
    const chainCells = [choice, ...next.cells];
    // Chain steps auto-pick.
    resolveMatch(
      state,
      bundle,
      { recipe: next.recipe, cells: chainCells, mult: mult + 1, auto: true },
      events,
    );
  }
}

/* ========================================================================
 * After a move: age bar, crumble, deal, game over.
 * ====================================================================== */

function afterMove(
  state: GameState,
  bundle: ThemeBundle,
  events: Event[],
): void {
  // 1. Age up?
  const totalAges = bundle.theme.ages.length;
  if (state.age < totalAges - 1 && state.ageMade >= ageNeed(state.age)) {
    state.age++;
    state.ageMade = 0;
    state.score += 100 * state.age;
    state.mv++;
    const A = ageSets(bundle, state.age);
    const sample = [...new Set(A.recipes.filter((r) => r.band === state.age + 1).map((r) => r.out))].slice(0, 4);
    events.push({ type: "age-up", age: state.age, sample });
    // Clear the tray so step 3 re-deals from the new age's pool. Keeps I→II
    // feeling like a transition instead of just a label swap.
    state.tray.fill(null);
  } else if (
    state.age === totalAges - 1 &&
    state.ageMade >= ageNeed(state.age)
  ) {
    // Final-age victory: once the player has made enough on-band things in
    // the last era, end the run with a flourish rather than letting the
    // board clog. Playtests showed the final age soaking 70% of total
    // moves with diminishing returns — this gives a satisfying stop.
    state.over = true;
    events.push({ type: "over" });
    return;
  }

  // 2. Crumble.
  const A = ageSets(bundle, state.age);
  const gone: number[] = [];
  for (let i = 0; i < state.board.length; i++) {
    const v = state.board[i];
    if (!v || A.USE.has(v)) {
      state.crumb[i] = null;
      continue;
    }
    // Shored tiles are permanently exempt from crumble until the tile at
    // this cell changes (which clears the flag at the mutation site).
    if (state.shored[i]) {
      state.crumb[i] = null;
      continue;
    }
    const cur = state.crumb[i];
    const c = cur && cur.id === v ? cur : (state.crumb[i] = { id: v, n: 0 });
    c.n++;
    if (c.n > CRUMBLE_TTL) gone.push(i);
  }
  if (gone.length) {
    events.push({ type: "crumble", cells: gone.slice() });
    for (const i of gone) {
      state.board[i] = null;
      state.crumb[i] = null;
      state.shored[i] = false;
    }
  }

  // 2b. Hold-zone crumble + resize.
  // Capacity grows one slot per age. Any held tile that's no longer useful
  // in the new age (i.e. not in `A.USE`) crumbles — this is what keeps the
  // hold slot from becoming a free long-term stash.
  const cap = holdCapacity(state.age);
  const holdGone: number[] = [];
  const holdGoneTiles: string[] = [];
  for (let i = 0; i < state.hold.length; i++) {
    const v = state.hold[i];
    if (v && !A.USE.has(v)) {
      holdGone.push(i);
      holdGoneTiles.push(v);
      state.hold[i] = null;
    }
  }
  if (state.hold.length < cap) {
    while (state.hold.length < cap) state.hold.push(null);
  } else if (state.hold.length > cap) {
    // Only shrinks if the config is reduced during a run — we keep the
    // first `cap` slots and drop the rest (crumble any tiles in them so
    // nothing is silently lost).
    for (let i = cap; i < state.hold.length; i++) {
      const v = state.hold[i];
      if (v) {
        holdGone.push(i);
        holdGoneTiles.push(v);
      }
    }
    state.hold.length = cap;
  }
  if (holdGone.length) {
    events.push({ type: "hold-crumble", slots: holdGone, tiles: holdGoneTiles });
  }

  // 3. Deal if the tray is empty.
  if (state.tray.every((t) => t == null)) {
    dealTray({
      bundle,
      board: state.board,
      tray: state.tray,
      size: state.n,
      age: state.age,
      rng: state.rng,
      recentTrays: state.recentTrays,
    });
    events.push({ type: "dealt" });
  }

  // 4. Game over if the board has no empty cell.
  if (state.board.every((v) => v != null)) {
    state.over = true;
    events.push({ type: "over" });
  }
}

/* ========================================================================
 * Reducer
 * ====================================================================== */

export function newGame(
  theme: ThemeKey,
  bundle: ThemeBundle,
  opts: { daily?: string | null; size?: number; seed?: number } = {},
): ReduceResult {
  const daily = opts.daily ?? null;
  const size = opts.size ?? 6;
  const seed =
    opts.seed ?? (daily ? dailySeed(daily) : freshEndlessSeed());
  const state: GameState = {
    theme,
    daily,
    n: size,
    rng: makeRng(seed),
    board: Array(size * size).fill(null),
    tray: [null, null, null],
    score: 0,
    made: 0,
    longest: 0,
    found: [],
    howMade: {},
    swaps: 2,
    clears: 1,
    hints: 2,
    mv: 2,
    shore: 2,
    over: false,
    newBest: false,
    moves: 0,
    shelf: [],
    hold: Array(holdCapacity(0)).fill(null),
    age: 0,
    ageMade: 0,
    crumb: Array(size * size).fill(null),
    shored: Array(size * size).fill(false),
    closeCalls: 0,
    recentTrays: [],
    choosing: null,
    undos: 1,
    lastSnapshot: null,
  };

  // Seed a few starting tiles that don't already combine. The prototype
  // uses fixed cells per board size (lines 3364).
  const spots = size === 6 ? [7, 10, 19, 25, 28] : [6, 8, 16, 18];
  const A0 = ageSets(bundle, 0);
  const seedTiles: string[] = [];
  const events: Event[] = [];
  // Top up with random base tiles until we have enough, bounded so a tiny
  // age-0 set doesn't lock us in a loop. We only want up to `spots.length`
  // seed tiles and the base pool is small.
  for (let k = 0; seedTiles.length < spots.length && k < 50; k++) {
    const x = pick(state.rng, A0.BASE);
    if (x && !seedTiles.includes(x) && !bundle.tools.has(x)) {
      seedTiles.push(x);
    }
  }
  seedTiles.forEach((x, k) => {
    const cell = spots[k];
    if (cell == null) return;
    // Skip if placing would already combine with the existing seeds.
    const m = matchAt(bundle, state.board, cell, x, size);
    if (!m) state.board[cell] = x;
  });

  dealTray({
    bundle,
    board: state.board,
    tray: state.tray,
    size: state.n,
    age: state.age,
    rng: state.rng,
    recentTrays: state.recentTrays,
  });
  events.push({ type: "dealt" });

  return { state, events };
}

/** Reduce one action. Pure: returns a new state and the event list without
 *  mutating the input. */
export function reduce(
  prev: GameState,
  bundle: ThemeBundle,
  action: Action,
): ReduceResult {
  if (prev.over && action.type !== "new-game") {
    return { state: prev, events: [] };
  }
  const state = cloneState(prev);
  const events: Event[] = [];

  switch (action.type) {
    case "new-game":
      return newGame(action.theme, bundle, {
        daily: action.daily,
        size: action.size,
        seed: action.seed,
      });

    case "choose": {
      if (!state.choosing) return { state: prev, events: [] };
      const choice = state.choosing.options[action.outputIndex];
      if (!choice) return { state: prev, events: [] };
      const seedCells = state.choosing.cells;
      const mult = state.choosing.mult;
      state.choosing = null;
      finishResolve(state, bundle, choice, seedCells, mult, events);
      afterMove(state, bundle, events);
      sealIfDiscovered(state, events);
      return { state, events };
    }

    case "place": {
      const src = action.source ?? "tray";
      const srcArr = src === "hold" ? state.hold : state.tray;
      const t = srcArr[action.slot];
      if (t == null) return { state: prev, events: [] };
      if (state.board[action.cell] != null) return { state: prev, events: [] };
      state.lastSnapshot = snapshotState(prev);
      srcArr[action.slot] = null;
      state.moves++;
      state.score += 1;
      state.board[action.cell] = t;
      state.shored[action.cell] = false;
      events.push({ type: "placed", at: action.cell, tile: t });

      const m = matchAt(bundle, state.board, action.cell, t, state.n);
      if (m) {
        const cells = [action.cell, ...m.cells];
        const r = resolveMatch(
          state,
          bundle,
          { recipe: m.recipe, cells, mult: 1, auto: false },
          events,
        );
        if (r.needsChoice) {
          state.choosing = {
            options: orderChoosingOptions(state, alternatives(bundle, m.recipe)),
            cells,
            mult: 1,
          };
          return { state, events };
        }
      }
      afterMove(state, bundle, events);
      sealIfDiscovered(state, events);
      return { state, events };
    }

    case "drop-on": {
      const src = action.source ?? "tray";
      const srcArr = src === "hold" ? state.hold : state.tray;
      const t = srcArr[action.slot];
      if (t == null) return { state: prev, events: [] };
      const y = state.board[action.cell];
      if (y == null) return { state: prev, events: [] };
      const m = matchOn(bundle, state.board, action.cell, t, state.n);
      if (!m) {
        events.push({ type: "nope", at: action.cell });
        return { state, events };
      }
      state.lastSnapshot = snapshotState(prev);
      srcArr[action.slot] = null;
      state.moves++;
      state.score += 1;
      const cells = m.cells.slice(); // includes the target cell
      const r = resolveMatch(
        state,
        bundle,
        { recipe: m.recipe, cells, mult: 1, auto: false },
        events,
      );
      if (r.needsChoice) {
        state.choosing = {
          options: orderChoosingOptions(state, alternatives(bundle, m.recipe)),
          cells,
          mult: 1,
        };
        return { state, events };
      }
      afterMove(state, bundle, events);
      sealIfDiscovered(state, events);
      return { state, events };
    }

    case "hold": {
      // Move a tray tile into the first empty hold slot. Commit-until-used:
      // once stored, the tile only leaves by being placed or by crumbling
      // on age-up. Counts as a move (afterMove runs below).
      const t = state.tray[action.slot];
      if (t == null) return { state: prev, events: [] };
      const target = state.hold.findIndex((v) => v == null);
      if (target === -1) return { state: prev, events: [] };
      state.tray[action.slot] = null;
      state.hold[target] = t;
      state.moves++;
      afterMove(state, bundle, events);
      return { state, events };
    }

    case "swap": {
      if (state.swaps <= 0) return { state: prev, events: [] };
      state.swaps--;
      state.tray = [null, null, null];
      dealTray({
        bundle,
        board: state.board,
        tray: state.tray,
        size: state.n,
        age: state.age,
        rng: state.rng,
        recentTrays: state.recentTrays,
      });
      events.push({ type: "dealt" });
      return { state, events };
    }

    case "clear": {
      if (state.clears <= 0) return { state: prev, events: [] };
      if (state.board[action.cell] == null) return { state: prev, events: [] };
      state.clears--;
      state.board[action.cell] = null;
      state.crumb[action.cell] = null;
      state.shored[action.cell] = false;
      return { state, events };
    }

    case "move": {
      const tile = state.board[action.from];
      if (!tile) return { state: prev, events: [] };
      // Moving onto an empty cell: relocate, then check for a combine at
      // the new cell (symmetric with `place`). The shore flag follows the
      // tile — a shored tile stays shored when the player relocates it.
      if (state.board[action.to] == null) {
        state.lastSnapshot = snapshotState(prev);
        const wasShored = state.shored[action.from];
        state.board[action.from] = null;
        state.crumb[action.from] = null;
        state.shored[action.from] = false;
        state.board[action.to] = tile;
        state.shored[action.to] = wasShored;
        const m = matchAt(bundle, state.board, action.to, tile, state.n);
        if (m) {
          const cells = [action.to, ...m.cells];
          const r = resolveMatch(
            state,
            bundle,
            { recipe: m.recipe, cells, mult: 1, auto: false },
            events,
          );
          if (r.needsChoice) {
            state.choosing = {
              options: orderChoosingOptions(state, alternatives(bundle, m.recipe)),
              cells,
              mult: 1,
            };
            return { state, events };
          }
        }
        sealIfDiscovered(state, events);
        return { state, events };
      }
      // Moving onto a tile: try drop-on-top.
      const m = matchOn(bundle, state.board, action.to, tile, state.n);
      if (!m) {
        events.push({ type: "nope", at: action.to });
        return { state, events };
      }
      state.lastSnapshot = snapshotState(prev);
      state.board[action.from] = null;
      state.crumb[action.from] = null;
      state.shored[action.from] = false;
      // The cells involved come from matchOn and already include the target.
      const cells = m.cells.slice();
      const r = resolveMatch(
        state,
        bundle,
        { recipe: m.recipe, cells, mult: 1, auto: false },
        events,
      );
      if (r.needsChoice) {
        state.choosing = {
          options: orderChoosingOptions(state, alternatives(bundle, m.recipe)),
          cells,
          mult: 1,
        };
        return { state, events };
      }
      // Move helpers skip the after-turn step (no crumble, no deal).
      sealIfDiscovered(state, events);
      return { state, events };
    }

    case "hint": {
      // Phase 2 engine doesn't yet pre-plan hint content; just decrement
      // if a hint is available. The UI/engine integration lands with the
      // overlays in Phase 4.
      if (state.hints <= 0) return { state: prev, events: [] };
      state.hints--;
      return { state, events };
    }

    case "shore": {
      // Permanently exempt one crumbling tile from the crumble pass. The
      // flag clears automatically when the tile at this cell changes
      // (combine, move, clear, or a new placement on top). Only applies
      // to a tile that's actually counting down — on-age tiles have a
      // null counter and gain nothing.
      if (state.shore <= 0) return { state: prev, events: [] };
      const tile = state.board[action.cell];
      if (!tile) return { state: prev, events: [] };
      const c = state.crumb[action.cell];
      if (!c || c.id !== tile) return { state: prev, events: [] };
      state.shore--;
      state.crumb[action.cell] = null;
      state.shored[action.cell] = true;
      return { state, events };
    }

    case "undo": {
      // One-charge rewind of the last board-modifying action. Snapshot
      // captured in `place` / `drop-on` / `move`; blocked when the
      // previous turn produced a discovery (keeps daily collection
      // scope safe from unlock-then-undo). The restored state keeps
      // the charge counter minus one — undoing itself is not undoable.
      if (state.undos <= 0) return { state: prev, events: [] };
      if (!prev.lastSnapshot) return { state: prev, events: [] };
      const restored = cloneState(prev.lastSnapshot);
      restored.undos = prev.undos - 1;
      restored.lastSnapshot = null;
      return { state: restored, events: [] };
    }
  }
}

/** Clear `lastSnapshot` when a reduce path produced a discovery event,
 *  so a `discovery` fired by this turn can't be undone away later. */
function sealIfDiscovered(state: GameState, events: readonly Event[]): void {
  if (events.some((e) => e.type === "discovery")) {
    state.lastSnapshot = null;
  }
}

/* --- Convenience exports for the UI / tests --------------------------- */
export { buildThemeBundle, playsInOne, playsInTwo };
