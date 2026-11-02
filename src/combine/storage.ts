/**
 * localStorage saves for Combine.
 *
 * Two slots: one endless game (keyed by theme), one daily (keyed by date).
 * The stored shape is a plain-JSON projection of GameState — Sets and Maps
 * are expanded to arrays/objects. Loading rebuilds the richer shape.
 *
 * Writes happen after every settled action (not during animation). Loads
 * are strict: any mismatch (unknown theme, stale daily date, finished
 * endless, tile ids that no longer exist in the knowledge base) → the save
 * is dropped.
 */

import type { CrumbleCounter, GameState } from "./engine";
import type { ThemeBundle, ThemeKey } from "./types";

/** Bump when the StoredGame shape changes so older saves fall through to
 *  a fresh game instead of hydrating into a broken state. */
const SAVE_VERSION = 4;

/** Bump to force every player who has already finished today's daily to
 *  be able to play it again. Stamped into DailyResult + the review save
 *  slot on write and checked on read — a mismatch drops both, so the UI
 *  shows the daily as unplayed. Does NOT touch in-progress saves (mid-run
 *  players are unaffected). */
const DAILY_EPOCH = 1;

const ENDLESS_KEY = "madeof:cbsave";
const DAILY_KEY = "madeof:cbsave:daily";
const BEST_PREFIX = "madeof:cbbest:";
const DAILY_DONE_KEY = "madeof:cbdaily";
const FOUND_KEY = "madeof:cbfound";
const SEEN_AGES_PREFIX = "madeof:cbseenages:";
const MUSIC_KEY = "madeof:music";
const SFX_KEY = "madeof:sfx";
const VOL_KEY = "madeof:vol";

export type MusicTrack = "piano" | "chimes" | "drift" | "off";
export interface SoundSettings {
  music: MusicTrack;
  sfx: boolean;
  vol: number; // 0..100
}

const SOUND_DEFAULT: SoundSettings = { music: "off", sfx: false, vol: 80 };

export interface StoredGame {
  v: number;
  theme: ThemeKey;
  daily: string | null;
  n: number;
  /** RNG state as a 32-bit int. */
  rs: number;
  board: Array<string | null>;
  tray: Array<string | null>;
  score: number;
  made: number;
  longest: number;
  found: string[];
  howMade?: Record<string, string[]>;
  swaps: number;
  clears: number;
  hints: number;
  mv: number;
  shore: number;
  over: boolean;
  newBest: boolean;
  moves: number;
  shelf: string[];
  hold: Array<string | null>;
  age: number;
  ageMade: number;
  crumb: Array<CrumbleCounter | null>;
  shored?: boolean[];
  closeCalls: number;
  recentTrays: string[][];
}

export interface DailyResult {
  key: string;
  score: number;
  age: number;
  ageName: string;
  made: number;
  /** Top-tier output on the shelf, or null. */
  top: string | null;
  /** New discoveries made in this run. Optional for forward-compat with
   *  older saves. */
  found?: number;
  /** Longest chain this run (×). */
  longest?: number;
  /** Finished things shipped to the shelf. */
  shelf?: number;
  /** DAILY_EPOCH stamp at save time. A mismatch at read time means a
   *  global reset was shipped — the result is dropped and the player can
   *  play today again. Older saves without this field also fail the
   *  check and are treated as pre-reset. */
  epoch?: number;
}

/* ========================================================================
 * Save
 * ====================================================================== */

function toStored(state: GameState): StoredGame {
  return {
    v: SAVE_VERSION,
    theme: state.theme,
    daily: state.daily,
    n: state.n,
    rs: state.rng.rs,
    board: state.board.slice(),
    tray: state.tray.slice(),
    score: state.score,
    made: state.made,
    longest: state.longest,
    found: state.found.slice(),
    howMade: { ...state.howMade },
    swaps: state.swaps,
    clears: state.clears,
    hints: state.hints,
    mv: state.mv,
    shore: state.shore,
    over: state.over,
    newBest: state.newBest,
    moves: state.moves,
    shelf: state.shelf.slice(),
    hold: state.hold.slice(),
    age: state.age,
    ageMade: state.ageMade,
    crumb: state.crumb.map((c) => (c ? { ...c } : null)),
    shored: state.shored.slice(),
    closeCalls: state.closeCalls,
    recentTrays: state.recentTrays.map((t) => t.slice()),
  };
}

export function saveGame(state: GameState): void {
  if (typeof window === "undefined") return;
  try {
    const key = state.daily ? DAILY_KEY : ENDLESS_KEY;
    if (state.over && !state.daily) {
      // A finished endless game has nothing to resume into.
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(toStored(state)));
  } catch {
    // Quota or privacy mode: silently ignore.
  }
}

/* ========================================================================
 * Load
 * ====================================================================== */

function readStored(key: string): StoredGame | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredGame;
    if (!parsed) return null;
    // Any schema mismatch (version, missing or wrong-shape board/tray) →
    // drop the entry and start fresh. The version check is the primary
    // guard; the shape checks are belt-and-braces in case someone writes
    // to the key manually.
    if (
      parsed.v !== SAVE_VERSION ||
      parsed.n !== 6 ||
      !Array.isArray(parsed.board) ||
      parsed.board.length !== parsed.n * parsed.n ||
      !Array.isArray(parsed.tray) ||
      parsed.tray.length !== 3
    ) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Load the saved game for the given mode, if one is valid for the given
 *  theme/day and all its tiles still exist in the bundle. */
export function loadGame(
  bundle: ThemeBundle,
  opts: { daily: string | null },
): StoredGame | null {
  const key = opts.daily ? DAILY_KEY : ENDLESS_KEY;
  const s = readStored(key);
  if (!s) return null;
  // Theme must match (endless can be stored under either theme; both bundles
  // ship so this check is per-save).
  if (s.theme !== bundle.theme.k) return null;
  // Daily: the save must belong to today's puzzle.
  if (opts.daily && s.daily !== opts.daily) return null;
  // Endless: a finished game is nothing to resume.
  if (!opts.daily && s.over) return null;
  // All referenced tiles must still exist (the knowledge base may have
  // shifted between runs).
  for (const v of s.board) if (v && !bundle.items.has(v)) return null;
  for (const v of s.tray) if (v && !bundle.items.has(v)) return null;
  if (Array.isArray(s.hold)) {
    for (const v of s.hold) if (v && !bundle.items.has(v)) return null;
  }
  return s;
}

/** Rebuild a full GameState from the stored projection. */
export function hydrateGame(s: StoredGame): GameState {
  return {
    theme: s.theme,
    daily: s.daily,
    n: s.n,
    rng: { rs: s.rs | 0 },
    board: s.board.slice(),
    tray: s.tray.slice(),
    score: s.score,
    made: s.made,
    longest: s.longest,
    found: s.found.slice(),
    howMade: s.howMade ? { ...s.howMade } : {},
    swaps: s.swaps,
    clears: s.clears,
    hints: s.hints,
    mv: s.mv,
    shore: s.shore,
    over: s.over,
    newBest: s.newBest,
    moves: s.moves,
    shelf: s.shelf.slice(),
    hold: Array.isArray(s.hold) ? s.hold.slice() : [null],
    age: s.age,
    ageMade: s.ageMade,
    crumb: s.crumb.map((c) => (c ? { ...c } : null)),
    shored:
      Array.isArray(s.shored) && s.shored.length === s.n * s.n
        ? s.shored.slice()
        : Array(s.n * s.n).fill(false),
    closeCalls: s.closeCalls,
    recentTrays: (s.recentTrays ?? []).map((t) => t.slice()),
    choosing: null,
    // Undo is session-only (not persisted). Resuming a save gets a
    // fresh charge; there's no snapshot to undo back to on reload.
    undos: 1,
    lastSnapshot: null,
  };
}

/* ========================================================================
 * Side tables
 * ====================================================================== */

/** Daily result for the given day, if played. */
export function loadDailyDone(dayKey: string): DailyResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DAILY_DONE_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as DailyResult;
    if (r?.key !== dayKey) return null;
    // Global reset: bump DAILY_EPOCH to invalidate every finished daily
    // and let players replay today. Also clears the paired review save so
    // startDaily can create a fresh run instead of hydrating the old
    // finished state.
    if ((r.epoch ?? 0) !== DAILY_EPOCH) {
      window.localStorage.removeItem(DAILY_DONE_KEY);
      window.localStorage.removeItem(DAILY_KEY);
      return null;
    }
    return r;
  } catch {
    return null;
  }
}

export function saveDailyDone(r: DailyResult): void {
  if (typeof window === "undefined") return;
  try {
    const stamped: DailyResult = { ...r, epoch: DAILY_EPOCH };
    window.localStorage.setItem(DAILY_DONE_KEY, JSON.stringify(stamped));
    // Keep the final daily save around so "review" can reload the finished
    // board state. Starting a fresh daily on the same day is blocked at the
    // caller (CombineBoard.startDaily) — the save stays until the day rolls
    // over, at which point loadGame drops it as stale.
  } catch {
    // ignore
  }
}

/** Best score for the given theme. */
export function loadBest(theme: ThemeKey): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.localStorage.getItem(BEST_PREFIX + theme) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function saveBest(theme: ThemeKey, score: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BEST_PREFIX + theme, String(score));
  } catch {
    // ignore
  }
}

/** Highest numAges the player has already been shown for a theme. Used to
 *  decide whether the "a new age has emerged" banner should fire. Device-
 *  local — a cross-device replay of a promotion shows the banner twice,
 *  which is a mild annoyance and not worth a server round-trip. */
export function loadSeenAges(theme: ThemeKey): number {
  if (typeof window === "undefined") return 0;
  try {
    return (
      Number(window.localStorage.getItem(SEEN_AGES_PREFIX + theme) ?? 0) || 0
    );
  } catch {
    return 0;
  }
}

export function saveSeenAges(theme: ThemeKey, numAges: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEEN_AGES_PREFIX + theme, String(numAges));
  } catch {
    // ignore
  }
}

export function loadSound(): SoundSettings {
  if (typeof window === "undefined") return SOUND_DEFAULT;
  try {
    const music = window.localStorage.getItem(MUSIC_KEY);
    const sfx = window.localStorage.getItem(SFX_KEY);
    const vol = window.localStorage.getItem(VOL_KEY);
    // "handpan" was the earlier name for "chimes" — migrate silently so
    // old saves don't silently fall back to "off".
    const musicNormalised = music === "handpan" ? "chimes" : music;
    return {
      music:
        musicNormalised === "piano" ||
        musicNormalised === "chimes" ||
        musicNormalised === "drift" ||
        musicNormalised === "off"
          ? (musicNormalised as MusicTrack)
          : SOUND_DEFAULT.music,
      sfx: sfx == null ? SOUND_DEFAULT.sfx : sfx === "1",
      vol: vol == null ? SOUND_DEFAULT.vol : Math.max(0, Math.min(100, Number(vol))),
    };
  } catch {
    return SOUND_DEFAULT;
  }
}

export function saveSound(s: SoundSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MUSIC_KEY, s.music);
    window.localStorage.setItem(SFX_KEY, s.sfx ? "1" : "0");
    window.localStorage.setItem(VOL_KEY, String(Math.round(s.vol)));
  } catch {
    // ignore
  }
}

/** Items ever found by this device, across games, keyed by item id with the
 *  epoch-ms of first discovery. Used to show "X ago" badges on collection
 *  tiles and to persist discoveries across games for signed-in users.
 *
 *  Shape on disk is `Record<string, number>`. We tolerate the older
 *  `string[]` shape (pre-timestamp) by falling back to 0 for each id, which
 *  the UI renders as an undated find. */
export function loadFound(): Map<string, number> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(FOUND_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, number> | string[];
    if (Array.isArray(parsed)) {
      return new Map(parsed.map((id) => [id, 0]));
    }
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

export function saveFound(found: Map<string, number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FOUND_KEY,
      JSON.stringify(Object.fromEntries(found)),
    );
  } catch {
    // ignore
  }
}

export function clearFound(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(FOUND_KEY);
  } catch {
    // ignore
  }
}

/** Add new discoveries to the stored collection, stamping each with `now`.
 *  Existing entries keep their original timestamp. */
export function markFound(ids: Iterable<string>, now: number = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    const cur = loadFound();
    let changed = false;
    for (const id of ids) {
      if (!cur.has(id)) {
        cur.set(id, now);
        changed = true;
      }
    }
    if (changed) saveFound(cur);
  } catch {
    // ignore
  }
}
