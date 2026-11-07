/**
 * Server-side wrapper around the Combine engine (T-0175).
 *
 * The engine (`reduce`, `newGame`) is pure — safe to import on the
 * server. This module adds the bits a server-authoritative run needs:
 *
 * - Loading the right bundle for a (mode, theme, dailyKey) tuple.
 * - Minting a fresh seed on the server.
 * - Replaying a batch of events against a stored state for checkpoint
 *   validation.
 *
 * The client reducer and the server reducer are *the same code*. That's
 * the whole gift: no drift between the two paths, no second
 * implementation to keep in sync. The server simply re-runs the pure
 * reducer with the same inputs the client claims it used, and rejects
 * anything that doesn't match.
 *
 * Deterministic requirements (so server & client agree):
 * - Same bundle (built from the same live snapshot).
 * - Same seed.
 * - Same action sequence.
 * The checkpoint protocol ships the action sequence; bundle + seed come
 * from the DB row.
 */

import { randomInt } from "node:crypto";
import { buildThemeBundle, buildAllDailyBundles } from "./data";
import { getActiveDaily } from "./daily-config-db";
import { getDailyPayload, resolveGuestRecipes } from "./daily-schedule-db";
import { loadAllSeasons } from "./season";
import { getLiveSnapshot } from "@/graph/live";
import { newGame, reduce, type Action, type Event, type GameState } from "./engine";
import { dailySeed } from "./rng";
import type { ThemeBundle, ThemeKey, Mode } from "./types";

export type ServerMode = "endless" | "fast" | "daily";

/** Build the bundle a server run should play against. Matches the
 *  bundle-construction path in `CombinePageBody.tsx` so client and
 *  server start from identical content. */
export async function bundleForRun(
  mode: ServerMode,
  theme: ThemeKey,
  dailyKey: string | null,
): Promise<ThemeBundle> {
  const live = await getLiveSnapshot();
  const prev = await loadAllSeasons();
  if (mode === "fast") {
    return buildThemeBundle(live.snapshot, theme, prev[theme] ?? 0, "fast");
  }
  if (mode === "endless") {
    return buildThemeBundle(live.snapshot, theme, prev[theme] ?? 0, "endless");
  }
  // Daily: pull the active daily config + today's guest recipes so the
  // bundle matches what the page body ships.
  const activeDaily = await getActiveDaily();
  if (!activeDaily || activeDaily.themeCode !== theme) {
    // Daily on a theme that isn't the active host — fall back to the
    // theme's plain daily (capped by any config it may carry).
    return buildThemeBundle(live.snapshot, theme, prev[theme] ?? 0, "daily");
  }
  const todaysPayload = dailyKey
    ? await getDailyPayload(activeDaily.themeCode, dailyKey)
    : null;
  const guestRecipes: Record<string, ReturnType<typeof resolveGuestRecipes>["extensions"] | null> = {};
  if (todaysPayload && todaysPayload.guestOutputIds.length > 0) {
    const full = buildThemeBundle(
      live.snapshot,
      activeDaily.themeCode,
      prev[activeDaily.themeCode] ?? 0,
    );
    const capped = buildThemeBundle(
      live.snapshot,
      activeDaily.themeCode,
      prev[activeDaily.themeCode] ?? 0,
      "daily",
      activeDaily.config,
    );
    const resolved = resolveGuestRecipes(full, capped, todaysPayload.guestOutputIds);
    guestRecipes[activeDaily.themeCode] = resolved.extensions;
  }
  const bundles = buildAllDailyBundles(
    live.snapshot,
    prev,
    { [activeDaily.themeCode]: activeDaily.config },
    guestRecipes,
    [theme],
  );
  const built = bundles[theme];
  if (!built) {
    throw new Error(`failed to build daily bundle for theme=${theme}`);
  }
  return built;
}

/** Target discovery count for today's daily, or null for modes/days
 *  that don't carry one. Routed from the daily payload so server-side
 *  `newGame` can set `state.target` the same way the client does. */
export async function dailyTargetForRun(
  theme: ThemeKey,
  dailyKey: string | null,
): Promise<number | null> {
  if (!dailyKey) return null;
  const payload = await getDailyPayload(theme, dailyKey);
  return payload?.targetDiscoveries ?? null;
}

/** Mint a seed for a new server run. Daily runs are keyed by day so
 *  every player gets the same deal; endless/fast get a fresh server
 *  seed each run so RNG can't be grinded. */
export function mintSeed(mode: ServerMode, dailyKey: string | null): number {
  if (mode === "daily" && dailyKey) return dailySeed(dailyKey);
  // crypto.randomInt is a non-biased 32-bit int. Matches the engine's
  // seed space (see rng.ts — only the low 32 bits matter).
  return randomInt(0, 2 ** 31 - 1);
}

/** Build a fresh initial state for a server run. Thin wrapper over
 *  `newGame` that picks sensible defaults and routes `target` for
 *  daily runs. */
export function newServerGame(opts: {
  mode: ServerMode;
  theme: ThemeKey;
  dailyKey: string | null;
  seed: number;
  bundle: ThemeBundle;
  target: number | null;
}): GameState {
  const { state } = newGame(opts.theme, opts.bundle, {
    mode: opts.mode as Mode,
    daily: opts.dailyKey,
    size: 6,
    seed: opts.seed,
    target: opts.target,
  });
  return state;
}

export interface ReplayResult {
  state: GameState;
  events: Event[];
  appliedCount: number;
}

/** Replay a batch of actions against a stored state. Returns the new
 *  state and the events each action produced. Throws on an action that
 *  the reducer couldn't apply (over state hit before the batch ran out,
 *  or a debug action from a non-admin — see `validateAction`). */
export function replayActions(
  state: GameState,
  bundle: ThemeBundle,
  actions: Action[],
  opts: { allowDebug?: boolean } = {},
): ReplayResult {
  let cur = state;
  const events: Event[] = [];
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    // Debug actions are gated on the request's admin flag, not on the
    // stored run — a player can't flip to debug mid-run by posting one.
    if (action.type.startsWith("debug-") && !opts.allowDebug) {
      throw new ReplayError(`debug action rejected: ${action.type}`, i);
    }
    const result = reduce(cur, bundle, action);
    cur = result.state;
    for (const e of result.events) events.push(e);
    // If the engine terminated the run, drop any trailing actions —
    // a client that keeps posting after `over` is confused or hostile.
    if (cur.over && action.type !== "finish") {
      return { state: cur, events, appliedCount: i + 1 };
    }
  }
  return { state: cur, events, appliedCount: actions.length };
}

export class ReplayError extends Error {
  constructor(message: string, public readonly atIndex: number) {
    super(message);
    this.name = "ReplayError";
  }
}

/** Shallow-validate an action parsed off the wire. Doesn't check the
 *  action is *legal* against a state — the reducer handles that by
 *  returning an unchanged state — only that the shape is one the
 *  reducer knows about. Prevents rubbish like `{ type: "DROP TABLE" }`
 *  from reaching the switch at all. */
export function validateActionShape(a: unknown): a is Action {
  if (!a || typeof a !== "object") return false;
  const t = (a as { type?: unknown }).type;
  if (typeof t !== "string") return false;
  const known: ReadonlySet<string> = new Set([
    "new-game",
    "place",
    "drop-on",
    "choose",
    "cancel-choice",
    "swap",
    "clear",
    "hint",
    "move",
    "promote",
    "shore",
    "hold",
    "pluck-hold",
    "wipe-board",
    "finish",
    "undo",
    "debug-toggle",
    "debug-deal",
    "debug-set-age",
    "debug-toggle-over",
  ]);
  return known.has(t);
}
