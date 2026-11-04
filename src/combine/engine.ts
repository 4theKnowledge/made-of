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
 * Blueprints and resting sources are intentionally omitted; they were
 * tried in an earlier design and removed.
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
import type { CombineRecipe, Mode, ThemeBundle, ThemeKey } from "./types";

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
export const HOLD_CAPACITY_BY_AGE: readonly number[] = [2, 4, 6, 8, 10, 12, 14, 16];

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
  /** Play mode. `classic` = age-banded (endless/daily). `fast` = 2-part
   *  recipes only, single band, score-only (no collection unlocks). */
  mode: Mode;
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
  /** How many times each output has been made this run. Powers the
   *  on-board history tray, which shows every make with a ×N count rather
   *  than only terminal items shipped to the shelf. */
  madeCounts: Record<string, number>;
  /** The ingredient list the player actually used the first time they
   *  made each output this run. Lets the info card show "How you made it"
   *  with the right recipe when an item has multiple valid recipes
   *  (e.g. window = glass+wood OR glass+aluminium). */
  howMade: Record<string, string[]>;
  /** 1-based band of the recipe the player first used to make each output.
   *  Different from the output's canonical min-band (`bundle.outBand`): the
   *  dialog groups finds by the age the player *actually* made them in, so
   *  Age-II work doesn't visually land under Age I just because an alt
   *  recipe for the same item exists at a lower band. */
  madeAtBand: Record<string, number>;
  swaps: number;
  clears: number;
  hints: number;
  mv: number;
  shore: number;
  /** Pluck-to-hold charges. Each use lifts one on-board tile into the
   *  first empty hold slot. Scales like the other helpers via
   *  `helperGrants`. */
  pluck: number;
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
  /** Admin-only testing mode. Skips helper counters, enables the debug
   *  actions below, and short-circuits saving so a debug session doesn't
   *  overwrite the real endless save. Session-only — never persisted.
   *  Gated UI-side: the panel only mounts when the server says the user
   *  is admin, so the reducer trusting this flag is fine. */
  debug: boolean;
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
  | { type: "age-up"; age: number; sample: string[]; grants: HelperGrants }
  | { type: "crumble"; cells: number[] }
  | { type: "hold-crumble"; slots: number[]; tiles: string[] }
  | { type: "discovery"; out: string; recipe: string[] }
  | { type: "dealt" }
  | { type: "wipe"; age: number }
  | { type: "over" };

/** Tile source for placement actions. */
export type TileSource = "tray" | "hold";

export type Action =
  | { type: "new-game"; theme: ThemeKey; mode: Mode; daily: string | null; size: number; seed?: number }
  | { type: "place"; slot: number; cell: number; source?: TileSource }
  | { type: "drop-on"; slot: number; cell: number; source?: TileSource }
  | { type: "choose"; outputIndex: number }
  | { type: "swap" }
  | { type: "clear"; cell: number }
  | { type: "hint" }
  | { type: "move"; from: number; to: number }
  | { type: "shore"; cell: number }
  | { type: "hold"; slot: number }
  | { type: "pluck-hold"; cell: number }
  | { type: "wipe-board" }
  | { type: "finish" }
  | { type: "undo" }
  // Debug actions (admin-only). The toggle flips `state.debug`; the others
  // are no-ops unless `state.debug` is already true. UI mounting is gated
  // on an admin session check so these never surface to normal players.
  | { type: "debug-toggle" }
  | { type: "debug-deal"; slot: number; tile: string }
  | { type: "debug-set-age"; age: number }
  | { type: "debug-toggle-over" };

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
    madeCounts: { ...s.madeCounts },
    howMade: { ...s.howMade },
    madeAtBand: { ...s.madeAtBand },
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

/** Fraction of unique on-band items the player must discover before advancing.
 *  40% feels like real exploration without forcing exhaustive clearing — tuned
 *  against Everything (~34 items/age) where 0.4 lands near 13–15 unlocks. */
const UNLOCK_FRACTION = 0.4;

/** Baseline ramp used when the KB is too small for the band-aware floor to
 *  take over: 7, 9, 11, 13, 15, 17. Preserves the test fixtures and keeps
 *  tiny themes playable. */
function baselineNeed(age: number): number {
  return 7 + 2 * age;
}

/** Number of distinct on-band outputs in the age's band. Shared by
 *  `ageNeed` and helper-grant scaling so both reward and demand move
 *  together as the KB (or an admin edit) reshapes a band. */
export function bandSize(age: number, bundle: ThemeBundle): number {
  const targetBand = age + 1;
  let n = 0;
  for (const b of bundle.outBand.values()) {
    if (b === targetBand) n++;
  }
  return n;
}

/** Unique discoveries at the current age's band needed to leave each age.
 *  Only first-time makes of items whose minimum band is `age + 1` count —
 *  see `finishResolve`. Scales with band population so a mature KB demands
 *  more exploration; floors to the baseline so sparse bands stay playable. */
export function ageNeed(age: number, bundle: ThemeBundle): number {
  const scaled = Math.round(bandSize(age, bundle) * UNLOCK_FRACTION);
  return Math.max(baselineNeed(age), scaled);
}

/** Helper grants per age. Each helper gets `floor(bandSize / divisor)`,
 *  clamped to `[min, max]`. Scales with band population so dense ages
 *  (e.g. Everything's band 4/5 at ~95/107 outputs) get proportionally
 *  more help without flooding the player; the caps keep late-game
 *  crumble pressure meaningful. */
export const HELPER_PER_ITEMS = { mv: 10, swap: 15, clear: 20, hint: 20, shore: 15, pluck: 20 } as const;
export const HELPER_MIN = { mv: 2, swap: 1, clear: 1, hint: 1, shore: 1, pluck: 1 } as const;
export const HELPER_MAX = { mv: 8, swap: 5, clear: 3, hint: 4, shore: 4, pluck: 3 } as const;

/** 0-based age at which the wipe-board helper unlocks. The player must be
 *  at this age (or higher) to use it, and each wipe costs one age — so
 *  using it at exactly this age drops them below the threshold and
 *  re-locks it until they climb back up. */
export const WIPE_UNLOCK_AGE = 2;

export type HelperGrants = {
  mv: number;
  swap: number;
  clear: number;
  hint: number;
  shore: number;
  pluck: number;
};

export function helperGrants(age: number, bundle: ThemeBundle): HelperGrants {
  const n = bandSize(age, bundle);
  const grant = (k: keyof typeof HELPER_PER_ITEMS) =>
    Math.min(HELPER_MAX[k], Math.max(HELPER_MIN[k], Math.floor(n / HELPER_PER_ITEMS[k])));
  return {
    mv: grant("mv"),
    swap: grant("swap"),
    clear: grant("clear"),
    hint: grant("hint"),
    shore: grant("shore"),
    pluck: grant("pluck"),
  };
}

function applyHelperGrants(state: GameState, g: HelperGrants): void {
  state.mv += g.mv;
  state.swaps += g.swap;
  state.clears += g.clear;
  state.hints += g.hint;
  state.shore += g.shore;
  state.pluck += g.pluck;
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

  // Fast mode is score-only: no first-find tracking, no discovery events.
  // Players still score and chain, but the collection stays untouched so
  // classic progression is never shortcutted by combo-dense fast runs.
  const uniqueFind = !state.found.includes(recipe.out);
  const first = state.mode !== "fast" && uniqueFind;
  if (first) {
    state.found.push(recipe.out);
    state.howMade[recipe.out] = recipe.all.slice();
    state.madeAtBand[recipe.out] = recipe.band;
    events.push({ type: "discovery", out: recipe.out, recipe: recipe.all });
  }
  state.madeCounts[recipe.out] = (state.madeCounts[recipe.out] ?? 0) + 1;
  // Age progression: count unique first-time makes at the current age's band.
  // `ageNeed` is documented as "unique discoveries at the current age's band
  // needed to leave each age" — duplicates at the same band don't count, so
  // the player can't grind one item to age up. Only the initial player move
  // counts (mult === 1); chain steps are already their own reward.
  // Fast mode has no real ages — `ageMade` is just a stopping condition — so
  // it keeps counting every on-band craft.
  if (recipe.band === state.age + 1 && mult === 1) {
    if (state.mode === "fast" || uniqueFind) state.ageMade++;
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
  if (state.age < totalAges - 1 && state.ageMade >= ageNeed(state.age, bundle)) {
    state.age++;
    state.ageMade = 0;
    state.score += 100 * state.age;
    const grants = helperGrants(state.age, bundle);
    applyHelperGrants(state, grants);
    const A = ageSets(bundle, state.age);
    const sample = [...new Set(A.recipes.filter((r) => r.band === state.age + 1).map((r) => r.out))].slice(0, 4);
    events.push({ type: "age-up", age: state.age, sample, grants });
    // Clear the tray so step 3 re-deals from the new age's pool. Keeps I→II
    // feeling like a transition instead of just a label swap.
    state.tray.fill(null);
  } else if (
    state.age === totalAges - 1 &&
    state.ageMade >= ageNeed(state.age, bundle)
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

  // 4. Game over if the player has no legal action left. A full board is
  //    *not* enough — a `drop-on` can still combine onto an occupied cell,
  //    a `move` can relocate or combine on-board, and spends (`swap`,
  //    `clear`, `hold`) give the player a way forward. See
  //    `hasAnyLegalAction` for the full predicate.
  if (!hasAnyLegalAction(state, bundle)) {
    state.over = true;
    events.push({ type: "over" });
  }
}

/** True if the player can *finish a combine* this turn using only organic
 *  actions — tray/hold → board, no helper spend. Covers `drop-on` that
 *  completes a group and `place`-on-empty that completes a group with its
 *  neighbours. Pure placement on an empty cell that doesn't combine, or
 *  stashing a tray tile into hold, is organic but non-finishing and lives in
 *  `hasOrganicNonFinishingMove`.
 *
 *  Used (with `hasHelperMove`) to detect the "last chance" state: no organic
 *  path finishes, but a helper could still produce one. */
export function hasOrganicFinishingMove(state: GameState, bundle: ThemeBundle): boolean {
  const size = state.n;
  const sources: Array<string | null> = [...state.tray, ...state.hold];
  for (const t of sources) {
    if (t == null) continue;
    for (let j = 0; j < state.board.length; j++) {
      const cell = state.board[j];
      if (cell == null) {
        if (matchAt(bundle, state.board, j, t, size)) return true;
      } else {
        if (matchOn(bundle, state.board, j, t, size)) return true;
      }
    }
  }
  return false;
}

/** Organic actions that keep the game alive but can't score on their own:
 *  placing a tray/hold tile on an empty cell with no combine, or stashing a
 *  tray tile into a free hold slot. Separated from `hasOrganicFinishingMove`
 *  so the "last chance" check can key on *finishing* specifically. */
export function hasOrganicNonFinishingMove(state: GameState): boolean {
  const anyEmpty = state.board.some((v) => v == null);
  const trayHasTile = state.tray.some((t) => t != null);
  const holdHasTile = state.hold.some((t) => t != null);
  if (anyEmpty && (trayHasTile || holdHasTile)) return true;
  if (trayHasTile && state.hold.some((v) => v == null)) return true;
  return false;
}

/** True if the player has at least one helper spend available that opens a
 *  path forward: `mv` (relocate or on-board combine), `swap` (new tray),
 *  `clear` (remove any tile), `pluck` (lift to hold), or `wipe-board` once
 *  `WIPE_UNLOCK_AGE` is reached. Mirrors the helper branches in
 *  `hasAnyLegalAction` — keep in sync if that predicate grows. */
export function hasHelperMove(state: GameState, bundle: ThemeBundle): boolean {
  const size = state.n;
  const anyOccupied = state.board.some((v) => v != null);
  const freeHoldSlot = state.hold.some((v) => v == null);

  if (state.mv > 0 && anyOccupied) {
    for (let i = 0; i < state.board.length; i++) {
      const t = state.board[i];
      if (!t) continue;
      for (const j of edgeNeighbours(i, size)) {
        if (state.board[j] == null) return true;
        if (matchOn(bundle, state.board, j, t, size)) return true;
      }
    }
  }
  if (state.swaps > 0) return true;
  if (state.clears > 0 && anyOccupied) return true;
  if (state.pluck > 0 && anyOccupied && freeHoldSlot) return true;
  if (state.age >= WIPE_UNLOCK_AGE) return true;
  return false;
}

/** True if the player has at least one action available that changes state.
 *  Used to decide game-over: a full board is not game-over as long as a
 *  tray/hold tile can `drop-on`, a `move` is available, or the player has
 *  a `swap` / `clear` / `hold` spend to take.
 *
 *  Does not consider `undo` (reverts rather than progresses) or `shore`
 *  (doesn't open new placements on its own). */
export function hasAnyLegalAction(state: GameState, bundle: ThemeBundle): boolean {
  return (
    hasOrganicNonFinishingMove(state) ||
    hasOrganicFinishingMove(state, bundle) ||
    hasHelperMove(state, bundle)
  );
}

/* ========================================================================
 * Reducer
 * ====================================================================== */

export function newGame(
  theme: ThemeKey,
  bundle: ThemeBundle,
  opts: { mode?: Mode; daily?: string | null; size?: number; seed?: number } = {},
): ReduceResult {
  const daily = opts.daily ?? null;
  const mode: Mode = opts.mode ?? "classic";
  const size = opts.size ?? 6;
  const seed =
    opts.seed ?? (daily ? dailySeed(daily) : freshEndlessSeed());
  const state: GameState = {
    theme,
    mode,
    daily,
    n: size,
    rng: makeRng(seed),
    board: Array(size * size).fill(null),
    tray: [null, null, null],
    score: 0,
    made: 0,
    longest: 0,
    found: [],
    madeCounts: {},
    howMade: {},
    madeAtBand: {},
    swaps: 0,
    clears: 0,
    hints: 0,
    mv: 0,
    shore: 0,
    pluck: 0,
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
    debug: false,
  };

  // Initial helpers scale to age-0's band population — see HELPER_PER_ITEMS.
  applyHelperGrants(state, helperGrants(0, bundle));

  // Seed a few starting tiles that don't already combine. The prototype
  // used fixed cells per board size (lines 3364); we sample positions from
  // the game RNG instead so endless runs don't always start with the same
  // tray layout. Daily stays deterministic because the RNG is seeded from
  // the day key — same shuffle every time for the same day.
  const seedCount = size === 6 ? 5 : 4;
  // Candidate cells: interior-ish positions, avoiding edges that touch each
  // other too tightly. These are a superset of the prototype's hardcoded
  // picks for each board size, so starts stay visually "spread out".
  const candidateCells =
    size === 6
      ? [7, 8, 10, 13, 15, 16, 19, 20, 22, 25, 27, 28]
      : [6, 7, 8, 11, 13, 16, 17, 18];
  const spots = shuffle(state.rng, candidateCells).slice(0, seedCount);
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
  if (prev.over && action.type !== "new-game" && !action.type.startsWith("debug-")) {
    return { state: prev, events: [] };
  }
  const state = cloneState(prev);
  const events: Event[] = [];

  switch (action.type) {
    case "new-game":
      return newGame(action.theme, bundle, {
        mode: action.mode,
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
      if (!state.debug && state.swaps <= 0) return { state: prev, events: [] };
      if (!state.debug) state.swaps--;
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
      if (!state.debug && state.clears <= 0) return { state: prev, events: [] };
      if (state.board[action.cell] == null) return { state: prev, events: [] };
      if (!state.debug) state.clears--;
      state.board[action.cell] = null;
      state.crumb[action.cell] = null;
      state.shored[action.cell] = false;
      return { state, events };
    }

    case "move": {
      if (!state.debug && state.mv <= 0) return { state: prev, events: [] };
      const tile = state.board[action.from];
      if (!tile) return { state: prev, events: [] };
      if (!state.debug) state.mv--;
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
      if (!state.debug && state.hints <= 0) return { state: prev, events: [] };
      if (!state.debug) state.hints--;
      return { state, events };
    }

    case "shore": {
      // Permanently exempt one crumbling tile from the crumble pass. The
      // flag clears automatically when the tile at this cell changes
      // (combine, move, clear, or a new placement on top). Only applies
      // to a tile that's actually counting down — on-age tiles have a
      // null counter and gain nothing.
      if (!state.debug && state.shore <= 0) return { state: prev, events: [] };
      const tile = state.board[action.cell];
      if (!tile) return { state: prev, events: [] };
      const c = state.crumb[action.cell];
      if (!c || c.id !== tile) return { state: prev, events: [] };
      if (!state.debug) state.shore--;
      state.crumb[action.cell] = null;
      state.shored[action.cell] = true;
      return { state, events };
    }

    case "pluck-hold": {
      // Lift a board tile into the first empty hold slot. Not a turn:
      // skips afterMove (no crumble tick, no re-deal), symmetric with
      // the move helper. Crumble counter and shore flag on the source
      // cell clear with the tile.
      if (!state.debug && state.pluck <= 0) return { state: prev, events: [] };
      const tile = state.board[action.cell];
      if (!tile) return { state: prev, events: [] };
      const target = state.hold.findIndex((v) => v == null);
      if (target === -1) return { state: prev, events: [] };
      if (!state.debug) state.pluck--;
      state.board[action.cell] = null;
      state.crumb[action.cell] = null;
      state.shored[action.cell] = false;
      state.hold[target] = tile;
      return { state, events };
    }

    case "wipe-board": {
      // Clear everything on the play surface and spend one age for the
      // privilege. Preserves score, discoveries, shelf, and run history —
      // only the board + hold go. Requires the player to have reached
      // `WIPE_UNLOCK_AGE`; dropping below the threshold re-locks the
      // helper (UI-side), so repeat use costs an age each time.
      if (state.age < WIPE_UNLOCK_AGE) return { state: prev, events: [] };
      state.board.fill(null);
      state.crumb.fill(null);
      state.shored.fill(false);
      state.hold.fill(null);
      state.tray.fill(null);
      state.lastSnapshot = null;
      state.age--;
      state.ageMade = 0;
      // Resize hold to the new (lower) age's capacity. We just zeroed
      // every slot, so a straight length reset is safe.
      const cap = holdCapacity(state.age);
      state.hold.length = 0;
      for (let i = 0; i < cap; i++) state.hold.push(null);
      events.push({ type: "wipe", age: state.age });
      // Re-deal a fresh tray from the current age's pool so the player
      // has something to act on after confirming the wipe.
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

    case "finish": {
      // Player-chosen end-of-run. Only legal when the player can't finish
      // a combine organically but still has helper spends available — i.e.
      // the "last chance" state. Lets them bank the score instead of being
      // forced to burn helpers on a run they'd rather end cleanly.
      //
      // Guarded here so the UI can dispatch freely without re-checking.
      if (hasOrganicFinishingMove(state, bundle)) return { state: prev, events: [] };
      if (!hasHelperMove(state, bundle)) return { state: prev, events: [] };
      state.over = true;
      events.push({ type: "over" });
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

    case "debug-toggle": {
      // Flip the debug flag. The only action that always works regardless
      // of current debug state — turning it on from the panel toggle.
      state.debug = !state.debug;
      return { state, events };
    }

    case "debug-deal": {
      // Place a specific tile into a tray slot. Overwrites whatever was
      // there. No cost, no re-deal; the player can swap afterwards if
      // they want the rest of the tray reshuffled too.
      if (!state.debug) return { state: prev, events: [] };
      if (action.slot < 0 || action.slot >= state.tray.length) {
        return { state: prev, events: [] };
      }
      if (!bundle.items.has(action.tile)) return { state: prev, events: [] };
      state.tray[action.slot] = action.tile;
      return { state, events };
    }

    case "debug-set-age": {
      // Jump straight to the requested age. Clears the board and tray,
      // then re-deals from the new age's pool — same path a real age-up
      // takes, minus the score bump. The age-up event is fired so the
      // UI's age-banner path still runs.
      if (!state.debug) return { state: prev, events: [] };
      const totalAges = bundle.theme.ages.length;
      const target = Math.max(0, Math.min(action.age, totalAges - 1));
      state.age = target;
      state.ageMade = 0;
      state.board.fill(null);
      state.tray.fill(null);
      state.crumb.fill(null);
      state.shored.fill(false);
      state.hold = Array(holdCapacity(target)).fill(null);
      state.choosing = null;
      state.lastSnapshot = null;
      dealTray({
        bundle,
        board: state.board,
        tray: state.tray,
        size: state.n,
        age: state.age,
        rng: state.rng,
        recentTrays: state.recentTrays,
      });
      const A = ageSets(bundle, target);
      const sample = [
        ...new Set(
          A.recipes.filter((r) => r.band === target + 1).map((r) => r.out),
        ),
      ].slice(0, 4);
      // Debug jump mirrors a real age-up's grants so the UI toast renders
      // normally; admin-only path, never reached in prod play.
      const grants = helperGrants(target, bundle);
      applyHelperGrants(state, grants);
      events.push({ type: "age-up", age: target, sample, grants });
      events.push({ type: "dealt" });
      return { state, events };
    }

    case "debug-toggle-over": {
      if (!state.debug) return { state: prev, events: [] };
      state.over = !state.over;
      if (state.over) events.push({ type: "over" });
      return { state, events };
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
