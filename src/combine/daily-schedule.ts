/**
 * Precomputed daily schedule. One `DailyPayload` per (theme, day); stored
 * in `combine_dailies.payload` as frozen jsonb. Admin + cron use the pure
 * functions here; the runtime just reads the row and hands it to the
 * bundle builder.
 */

import { dailySeed } from "./rng";
import { resolveDailyTarget, type DailyConfig } from "./daily-config";
import type { CombineRecipe, ThemeBundle, ThemeKey } from "./types";

/** Frozen snapshot of what today's daily looks like for one theme. */
export interface DailyPayload {
  version: 1;
  /** Copy of the theme's `dailyConfig` at generation time. Past dailies
   *  stay stable even if the admin later edits the theme's config. */
  config: DailyConfig;
  /** Output ids resolved for this day's guest ingredients. Order is
   *  stable (newest-recipe-first → tie-break by band ↑, then by id). */
  guestOutputIds: string[];
  /** Game RNG seed. Stable across players for the same day. For now this
   *  is just `dailySeed(day)`; keeping it in the payload lets us change
   *  the seed policy later without rewriting history. */
  seed: number;
  /** Discovery target that ends the run (win). Resolved from
   *  `config.targetByDow[dow] ?? config.targetDiscoveries ?? DEFAULT`
   *  at build time and frozen here so mid-week admin edits never shift
   *  a scheduled day. Optional for backwards-compat with rows written
   *  before the target-list feature shipped. */
  targetDiscoveries?: number;
  /** When this payload was produced. Informational only. */
  generatedAt: string;
}

/** Everything the scheduler needs to produce a payload. The bundle is the
 *  theme's FULL (non-daily) bundle — we read band info off it to learn
 *  which outputs are "above cap" and find their recipes. */
export interface ScheduleInput {
  theme: ThemeKey;
  fullBundle: ThemeBundle;
  dailyConfig: DailyConfig;
}

/** How many days of rotation memory to use when excluding recent picks.
 *  Computed so each guest output sits out roughly a full cycle before it
 *  can repeat (poolSize / perRun). Caller can override for tests. */
export function rotationWindow(poolSize: number, perRun: number): number {
  if (perRun <= 0 || poolSize <= 0) return 0;
  return Math.max(1, Math.ceil(poolSize / perRun));
}

/** Resolve the guest output pool for a config: outputs whose *minimum*
 *  band (in the full bundle) is at or above the configured min-band.
 *  Mirrors `buildThemeBundle`'s guest-pool logic but reads from the full
 *  bundle rather than the capped one. */
export function guestPoolFor(fullBundle: ThemeBundle, config: DailyConfig): string[] {
  if (!config.guestIngredient || config.guestIngredient.perRun <= 0) return [];
  if (config.maxAges == null) return [];
  const minBand = Math.max(config.guestIngredient.minBand, config.maxAges + 1);
  const minBandByOutput = new Map<string, number>();
  for (const r of fullBundle.recipes) {
    const cur = minBandByOutput.get(r.out);
    if (cur == null || r.band < cur) minBandByOutput.set(r.out, r.band);
  }
  const pool: string[] = [];
  for (const [out, b] of minBandByOutput) {
    if (b >= minBand) pool.push(out);
  }
  // Stable alpha-by-id order so sampling is deterministic.
  pool.sort();
  return pool;
}

/** For a guest output, find the cheapest recipe (fewest ingredients) in
 *  the full bundle whose ingredients are all buildable within the capped
 *  bundle — i.e. every ingredient is either a capped-bundle output or a
 *  capped-bundle base. If none exists, the output is unreachable and gets
 *  skipped. */
export function reachableGuestRecipe(
  fullBundle: ThemeBundle,
  output: string,
  cappedBuildable: Set<string>,
): CombineRecipe | null {
  const candidates = fullBundle.recipes.filter((r) => r.out === output);
  let best: CombineRecipe | null = null;
  for (const r of candidates) {
    if (!r.all.every((x) => cappedBuildable.has(x))) continue;
    if (!best || r.all.length < best.all.length) best = r;
  }
  return best;
}

/** Build the set of ids the capped bundle can produce or draw (outputs ∪
 *  base). Used to decide guest reachability. */
export function cappedBuildableSet(cappedBundle: ThemeBundle): Set<string> {
  const s = new Set<string>(cappedBundle.outputs);
  for (const b of cappedBundle.base) s.add(b);
  return s;
}

/** FNV-1a 32-bit string hash. Stable across runs. */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic 2^32 PRNG step. Same mulberry32 the daily uses, inlined
 *  to avoid circular deps. */
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick `k` output ids out of `pool`, deterministic for (day, pool).
 *
 *  Weighted sampling: items *never served in the rotation window* beat
 *  items served longer ago, which beat recent ones. Within each weight
 *  tier, the day-seeded RNG shuffles.
 *
 *  `recentByOutput` maps outputId → days-since-last-served (or `null` if
 *  never served in the window). Items absent from the map are treated as
 *  "never served." */
export function pickGuests(
  day: string,
  pool: string[],
  k: number,
  recentByOutput: Map<string, number>,
): string[] {
  if (k <= 0 || pool.length === 0) return [];
  // Three buckets: never-served, served-with-known-staleness, and a
  // fallback (should be empty given how we build recentByOutput).
  const never: string[] = [];
  const served: Array<{ id: string; stale: number }> = [];
  for (const id of pool) {
    const r = recentByOutput.get(id);
    if (r == null) never.push(id);
    else served.push({ id, stale: r });
  }
  const rand = mulberry32(hashStr(`guests:${day}`));
  const shuffle = <T,>(xs: T[]): T[] => {
    const out = xs.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  // Prefer never-served (shuffled). If more picks needed, drain `served`
  // from oldest to newest, breaking ties with the RNG.
  const neverShuffled = shuffle(never);
  served.sort((a, b) => b.stale - a.stale); // oldest first
  // Break ties within equal-stale groups deterministically.
  const servedGrouped: string[] = [];
  let i = 0;
  while (i < served.length) {
    let j = i;
    while (j < served.length && served[j].stale === served[i].stale) j++;
    const group = served.slice(i, j).map((s) => s.id);
    servedGrouped.push(...shuffle(group));
    i = j;
  }
  const ordered = [...neverShuffled, ...servedGrouped];
  return ordered.slice(0, Math.min(k, ordered.length));
}

/** Build a single day's payload. `recentByOutput` reflects the rotation
 *  history visible at generation time; callers compose it from prior
 *  rows. */
export function buildDailyPayload(
  input: ScheduleInput,
  day: string,
  recentByOutput: Map<string, number>,
): DailyPayload {
  const pool = guestPoolFor(input.fullBundle, input.dailyConfig);
  const perRun = input.dailyConfig.guestIngredient?.perRun ?? 0;
  const guests = pickGuests(day, pool, perRun, recentByOutput);
  return {
    version: 1,
    config: input.dailyConfig,
    guestOutputIds: guests,
    seed: dailySeed(day),
    targetDiscoveries: resolveDailyTarget(input.dailyConfig, day),
    generatedAt: new Date().toISOString(),
  };
}

/** Advance a date-key by one day. Both inputs and outputs are yyyy-mm-dd.
 *  Uses UTC internally so day boundaries stay consistent regardless of
 *  the server timezone. */
export function nextDay(day: string): string {
  // Parse yyyy-mm-dd as UTC, add 24h, format back.
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Produce a sequence of day keys starting at `startDay` (inclusive) of
 *  length `count`. */
export function dayRange(startDay: string, count: number): string[] {
  const out: string[] = [];
  let cur = startDay;
  for (let i = 0; i < count; i++) {
    out.push(cur);
    cur = nextDay(cur);
  }
  return out;
}

/** Build a full N-day schedule, respecting rotation. `priorRows` are the
 *  payloads already in the DB for this theme (any day) — the function
 *  reads only the most recent N days before `startDay` from them.
 *
 *  Days already present in `priorRows` and >= startDay are *replaced* by
 *  this run; the caller (API handler) decides whether to upsert or skip
 *  per row. */
export function buildSchedule(
  input: ScheduleInput,
  startDay: string,
  days: number,
  priorRows: Array<{ day: string; payload: DailyPayload }>,
): Array<{ day: string; payload: DailyPayload }> {
  const pool = guestPoolFor(input.fullBundle, input.dailyConfig);
  const window = rotationWindow(pool.length, input.dailyConfig.guestIngredient?.perRun ?? 0);

  // Sort prior rows oldest-first so we can accumulate rotation state.
  const history = priorRows
    .filter((r) => r.day < startDay)
    .slice()
    .sort((a, b) => a.day.localeCompare(b.day));

  // Walking map: outputId → day it was last served.
  const lastServed = new Map<string, string>();
  for (const row of history) {
    for (const id of row.payload.guestOutputIds) {
      lastServed.set(id, row.day);
    }
  }

  const schedule: Array<{ day: string; payload: DailyPayload }> = [];
  const range = dayRange(startDay, days);
  for (const day of range) {
    // Build the recent-by-output map scoped to the rotation window.
    const recent = new Map<string, number>();
    for (const [id, served] of lastServed) {
      const delta = daysBetween(served, day);
      if (delta <= window) recent.set(id, delta);
    }
    const payload = buildDailyPayload(input, day, recent);
    schedule.push({ day, payload });
    // Advance history so the *next* day sees today's picks.
    for (const id of payload.guestOutputIds) lastServed.set(id, day);
  }
  return schedule;
}

/** Whole-day delta between two yyyy-mm-dd keys (UTC). Positive means `b`
 *  is after `a`. */
export function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / 86400000);
}
