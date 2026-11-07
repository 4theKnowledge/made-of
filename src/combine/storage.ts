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
import type { Mode, ThemeBundle, ThemeKey } from "./types";

/** Bump when the StoredGame shape changes so older saves fall through to
 *  a fresh game instead of hydrating into a broken state. v5: derived
 *  ages + sparse-band merge changed the band layout and age count. A
 *  pre-v5 save at age=4 under 9 ages can't be hydrated into a 6-age
 *  bundle without warping to "Final age" nonsense.
 *  v7: fast runs now persist to their own slot. Added `mode` to the
 *  stored shape so hydrate doesn't have to infer from `daily`. */
const SAVE_VERSION = 7;

/** Bump to force every player who has already finished today's daily to
 *  be able to play it again. Stamped into DailyResult + the review save
 *  slot on write and checked on read — a mismatch drops both, so the UI
 *  shows the daily as unplayed. Does NOT touch in-progress saves (mid-run
 *  players are unaffected). */
const DAILY_EPOCH = 1;

const ENDLESS_KEY = "madeof:cbsave";
const DAILY_KEY = "madeof:cbsave:daily";
const FAST_KEY = "madeof:cbsave:fast";
const BEST_PREFIX = "madeof:cbbest:";
const DAILY_DONE_KEY = "madeof:cbdaily";
const FOUND_KEY = "madeof:cbfound";
const SEEN_AGES_PREFIX = "madeof:cbseenages:";
const MUSIC_KEY = "madeof:music";
const SFX_KEY = "madeof:sfx";
const SFX_PACK_KEY = "madeof:sfxpack";
const VOL_KEY = "madeof:vol";
// Pointer to the slot the player was last actively in. Three saves live
// in parallel (endless/fast/daily) and without this pointer `loadGame` on
// mount can't tell which one is the "current" run — the old resume path
// hard-coded fast > endless > daily, so a stale fast save hijacked refresh
// after the player had moved on.
const LAST_MODE_KEY = "madeof:cblastmode";

export type MusicTrack =
  | "piano"
  | "chimes"
  | "drift"
  | "hearth"
  | "rainfall"
  | "off";
export type SfxPack = "classic" | "wood" | "chime" | "off";
export interface SoundSettings {
  music: MusicTrack;
  sfxPack: SfxPack;
  vol: number; // 0..100
}

const SOUND_DEFAULT: SoundSettings = {
  music: "piano",
  sfxPack: "classic",
  vol: 80,
};

export interface StoredGame {
  v: number;
  theme: ThemeKey;
  mode: Mode;
  daily: string | null;
  n: number;
  /** RNG state as a 32-bit int. */
  rs: number;
  /** Initial RNG seed the run started with. Daily runs only — endless/fast
   *  omit this. On resume, `loadGame` compares this against today's current
   *  payload seed; a mismatch means the admin reset today's daily mid-run,
   *  so the stale save is dropped and the player starts fresh. */
  initialSeed?: number;
  board: Array<string | null>;
  tray: Array<string | null>;
  score: number;
  made: number;
  longest: number;
  found: string[];
  madeCounts?: Record<string, number>;
  howMade?: Record<string, string[]>;
  madeAtBand?: Record<string, number>;
  discoveredAtChapter?: Record<string, number>;
  swaps: number;
  clears: number;
  hints: number;
  mv: number;
  shore: number;
  pluck: number;
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
    mode: state.mode,
    daily: state.daily,
    n: state.n,
    rs: state.rng.rs,
    initialSeed: state.initialSeed ?? undefined,
    board: state.board.slice(),
    tray: state.tray.slice(),
    score: state.score,
    made: state.made,
    longest: state.longest,
    found: state.found.slice(),
    madeCounts: { ...state.madeCounts },
    howMade: { ...state.howMade },
    madeAtBand: { ...state.madeAtBand },
    discoveredAtChapter: { ...state.discoveredAtChapter },
    swaps: state.swaps,
    clears: state.clears,
    hints: state.hints,
    mv: state.mv,
    shore: state.shore,
    pluck: state.pluck,
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

function keyForMode(state: GameState): string {
  if (state.mode === "fast") return FAST_KEY;
  if (state.daily) return DAILY_KEY;
  return ENDLESS_KEY;
}

export function saveGame(state: GameState): void {
  if (typeof window === "undefined") return;
  // Debug sessions never persist — a cheat run shouldn't overwrite the
  // player's real endless save, and on reload we want to hydrate the
  // real save instead of the debug one.
  if (state.debug) return;
  try {
    const key = keyForMode(state);
    if (state.over && !state.daily) {
      // A finished endless or fast game has nothing to resume into. Daily
      // keeps its final state as a review slot (see startDaily).
      window.localStorage.removeItem(key);
      // Clear the pointer if it still pointed at this slot — on next mount
      // the resume path should fall through to its default instead of
      // trying to load an empty slot.
      if (loadLastMode() === state.mode) clearLastMode();
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(toStored(state)));
    saveLastMode(state.mode);
  } catch {
    // Quota or privacy mode: silently ignore.
  }
}

/** Load the pointer to the player's last-active mode. Returns null if
 *  unset (first visit, or cleared because the last run finished). The
 *  resume path on mount uses this to pick which of the three save slots
 *  to hydrate from. */
export function loadLastMode(): Mode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_MODE_KEY);
    if (raw === "endless" || raw === "fast" || raw === "daily") return raw;
    return null;
  } catch {
    return null;
  }
}

export function saveLastMode(mode: Mode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_MODE_KEY, mode);
  } catch {
    // ignore
  }
}

export function clearLastMode(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LAST_MODE_KEY);
  } catch {
    // ignore
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
    // v6 → v7 migration: v6 had no explicit `mode` field (fast didn't
    // persist, so endless vs. daily was inferable from `daily`). Stamp a
    // mode and upgrade the version in-place so returning players don't
    // lose their endless/daily save to the version bump.
    if (parsed.v === 6 && !parsed.mode) {
      parsed.mode = parsed.daily ? "daily" : "endless";
      parsed.v = SAVE_VERSION;
    }
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
 *  theme/day and all its tiles still exist in the bundle. `mode` defaults
 *  to "endless" when `daily` is null; pass `"fast"` to read the fast slot. */
export function loadGame(
  bundle: ThemeBundle,
  opts: { daily: string | null; mode?: Mode; expectedSeed?: number | null },
): StoredGame | null {
  const mode: Mode = opts.mode ?? (opts.daily ? "daily" : "endless");
  const key = mode === "fast" ? FAST_KEY : opts.daily ? DAILY_KEY : ENDLESS_KEY;
  const s = readStored(key);
  if (!s) return null;
  // Theme must match (endless/fast can be stored under either theme; both
  // bundles ship so this check is per-save).
  if (s.theme !== bundle.theme.k) return null;
  // Mode must match the slot — guards against a stale save from before the
  // mode field existed landing in the wrong resume path.
  if (s.mode !== mode) return null;
  // Daily: the save must belong to today's puzzle.
  if (mode === "daily" && s.daily !== opts.daily) return null;
  // Daily: if caller provided today's expected seed, drop the save when it
  // doesn't match. This is the resume-after-admin-reset-today path — the
  // seed on the current payload is fresh, but the save's initialSeed still
  // reflects the pre-reset puzzle. A missing initialSeed field (older save
  // written before this field existed) also drops, forcing one fresh run.
  if (
    mode === "daily" &&
    typeof opts.expectedSeed === "number" &&
    s.initialSeed !== opts.expectedSeed &&
    !s.over
  ) {
    window.localStorage.removeItem(DAILY_KEY);
    return null;
  }
  // Endless/fast: a finished game is nothing to resume.
  if (mode !== "daily" && s.over) return null;
  // A finished daily save is a frozen review board — stale tile ids and
  // out-of-range ages are inert because nothing runs through the reducer.
  // Skip the content-drift guards so content edits between the finish and
  // the review tap don't nuke the player's result.
  if (mode === "daily" && s.over) return s;
  // All referenced tiles must still exist (the knowledge base may have
  // shifted between runs).
  for (const v of s.board) if (v && !bundle.items.has(v)) return null;
  for (const v of s.tray) if (v && !bundle.items.has(v)) return null;
  if (Array.isArray(s.hold)) {
    for (const v of s.hold) if (v && !bundle.items.has(v)) return null;
  }
  // Age must fit inside the current bundle's age layout. If the KB evolved
  // (merge collapsed a sparse band, admin removed content) and the stored
  // age is past the current last age, drop the save — hydrating would land
  // the player on "Final age" with a nonsensical "step N+1 of N" header.
  // Fast mode is single-band (ages.length is 1), so this still holds.
  if (s.age < 0 || s.age >= bundle.theme.ages.length) return null;
  return s;
}

/** Rebuild a full GameState from the stored projection.
 *
 *  `target` is session-only (not persisted — daily payloads drift day to
 *  day, and only today's payload is authoritative). Callers resuming a
 *  daily within the same day should pass the current payload's resolved
 *  `targetDiscoveries` here. Omitting it falls back to the legacy
 *  age-progression end condition for that one resume. */
export function hydrateGame(s: StoredGame, opts: { target?: number | null } = {}): GameState {
  return {
    theme: s.theme,
    mode: s.mode,
    daily: s.daily,
    n: s.n,
    rng: { rs: s.rs | 0 },
    board: s.board.slice(),
    tray: s.tray.slice(),
    score: s.score,
    made: s.made,
    longest: s.longest,
    found: s.found.slice(),
    // Older saves predate madeCounts: seed the tray with each found item
    // at ×1 so a resumed game isn't missing history for prior finds. New
    // makes this session increment from there.
    madeCounts: s.madeCounts
      ? { ...s.madeCounts }
      : Object.fromEntries(s.found.map((id) => [id, 1])),
    howMade: s.howMade ? { ...s.howMade } : {},
    madeAtBand: s.madeAtBand ? { ...s.madeAtBand } : {},
    discoveredAtChapter: s.discoveredAtChapter ? { ...s.discoveredAtChapter } : {},
    swaps: s.swaps,
    clears: s.clears,
    hints: s.hints,
    mv: s.mv,
    shore: s.shore,
    pluck: s.pluck ?? 0,
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
    // Debug mode is session-only and never persisted — any save we
    // hydrate from is a real player save, so start clean.
    debug: false,
    target: s.mode === "daily" ? opts.target ?? null : null,
    initialSeed: s.mode === "daily" ? s.initialSeed ?? null : null,
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

/** Best score for the given theme. Fast mode uses a separate key so its
 *  score curve (shorter, higher throughput) doesn't inflate the classic
 *  best for the same theme. Legacy entries (no `:mode`) remain classic. */
function bestKey(theme: ThemeKey, mode?: Mode): string {
  return mode === "fast" ? `${BEST_PREFIX}${theme}:fast` : BEST_PREFIX + theme;
}

export function loadBest(theme: ThemeKey, mode?: Mode): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.localStorage.getItem(bestKey(theme, mode)) ?? 0) || 0;
  } catch {
    return 0;
  }
}

export function saveBest(theme: ThemeKey, score: number, mode?: Mode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(bestKey(theme, mode), String(score));
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
    const sfxPack = window.localStorage.getItem(SFX_PACK_KEY);
    const legacySfx = window.localStorage.getItem(SFX_KEY);
    const vol = window.localStorage.getItem(VOL_KEY);
    // "handpan" was the earlier name for "chimes" — migrate silently so
    // old saves don't silently fall back to "off".
    const musicNormalised = music === "handpan" ? "chimes" : music;
    // Sfx pack migration:
    // - If the new key exists and is valid, use it.
    // - Else if the legacy boolean key exists, promote it (true → classic,
    //   false → off). The legacy key stays in storage; we just stop reading
    //   it once the new key is written.
    // - Else fall through to the default.
    let resolvedPack: SfxPack = SOUND_DEFAULT.sfxPack;
    if (
      sfxPack === "classic" ||
      sfxPack === "wood" ||
      sfxPack === "chime" ||
      sfxPack === "off"
    ) {
      resolvedPack = sfxPack;
    } else if (legacySfx != null) {
      resolvedPack = legacySfx === "1" ? "classic" : "off";
    }
    return {
      music:
        musicNormalised === "piano" ||
        musicNormalised === "chimes" ||
        musicNormalised === "drift" ||
        musicNormalised === "hearth" ||
        musicNormalised === "rainfall" ||
        musicNormalised === "off"
          ? (musicNormalised as MusicTrack)
          : SOUND_DEFAULT.music,
      sfxPack: resolvedPack,
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
    window.localStorage.setItem(SFX_PACK_KEY, s.sfxPack);
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

/** "New to your collection" badge state — item ids the player has just
 *  unlocked and hasn't yet acknowledged (by opening the DetailCard or
 *  the Collection book for that item). Scoped `endless` | `daily` so
 *  the two collections stay visually separate. Persists across reloads;
 *  cleared per-id when the player views the item.
 *
 *  Not security-sensitive — purely a "what should sparkle next" hint.
 *  OK to be lossy if localStorage is unavailable.
 */
const NEW_UNLOCKS_PREFIX = "madeof:cbnew:";

export function loadNewUnlocks(scope: "endless" | "daily"): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(NEW_UNLOCKS_PREFIX + scope);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function saveNewUnlocks(
  scope: "endless" | "daily",
  ids: Set<string>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      NEW_UNLOCKS_PREFIX + scope,
      JSON.stringify([...ids]),
    );
  } catch {
    // ignore
  }
}

/** Add new badge entries. Returns the ids that were actually added
 *  (dedupe against the current set) so callers can decide whether to
 *  fire a UI effect. */
export function addNewUnlocks(
  scope: "endless" | "daily",
  ids: Iterable<string>,
): string[] {
  const cur = loadNewUnlocks(scope);
  const added: string[] = [];
  for (const id of ids) {
    if (!cur.has(id)) {
      cur.add(id);
      added.push(id);
    }
  }
  if (added.length) saveNewUnlocks(scope, cur);
  return added;
}

/** Clear a specific id's new-unlock badge when the player acknowledges
 *  it by viewing the item. Returns true if the set changed. */
export function clearNewUnlock(
  scope: "endless" | "daily",
  id: string,
): boolean {
  const cur = loadNewUnlocks(scope);
  if (!cur.delete(id)) return false;
  saveNewUnlocks(scope, cur);
  return true;
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
