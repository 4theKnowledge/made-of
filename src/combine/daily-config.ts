/**
 * Daily-mode overrides for a Combine theme.
 *
 * Endless and daily both play the `classic` mode, but a daily run should fit
 * in ~15 min while endless can run as long as the player wants. The admin
 * sets these on the singleton `combine_daily_config` row; `buildThemeBundle`
 * reads them when the bundle is built for `mode: "daily"`.
 *
 * `guestIngredient` is a deterministic "guest of the day" tile injected
 * into the dealer: per-day RNG picks N tiles from bands at or above
 * `minBand` and seeds them into the tray on chosen turns. Same for every
 * player so leaderboards stay comparable; its purpose is to drip rare
 * items into the lifetime daily collection over time.
 */

export interface DailyConfig {
  /** Cap total ages for a daily run to this many (1..authored pool length).
   *  The bundle builder clamps the authored age slice to this value when
   *  building for daily. Null / missing → no cap. */
  maxAges?: number;
  /** Scale `UNLOCK_FRACTION` for daily-only ageNeed. 1.0 = same as endless.
   *  0.5 = half as many first-finds required to advance each age. */
  ageNeedScale?: number;
  /** Guest-ingredient injection. */
  guestIngredient?: {
    /** How many guest tiles to inject per daily run. */
    perRun: number;
    /** Minimum band (1-based) a guest tile's output lives in. Must be above
     *  the daily's effective max band so guests surface items the player
     *  wouldn't normally meet in a capped daily. */
    minBand: number;
  };
}

/** Admin-surface default when creating a theme without daily tuning.
 *  Deliberately empty — a theme opts in by setting fields. */
export const DEFAULT_DAILY_CONFIG: DailyConfig = {};

/** Validate a candidate dailyConfig payload (admin API or seed). Returns a
 *  normalised shape or null if the payload is empty / falsy. Throws on
 *  malformed input. Caller handles the error → HTTP mapping. */
export function normaliseDailyConfig(raw: unknown): DailyConfig | null {
  if (raw == null) return null;
  if (typeof raw !== "object") throw new Error("dailyConfig must be an object");
  const out: DailyConfig = {};
  const r = raw as Record<string, unknown>;
  if (r.maxAges != null) {
    const n = Number(r.maxAges);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      throw new Error("dailyConfig.maxAges must be an integer in [1, 30]");
    }
    out.maxAges = n;
  }
  if (r.ageNeedScale != null) {
    const n = Number(r.ageNeedScale);
    if (!Number.isFinite(n) || n <= 0 || n > 2) {
      throw new Error("dailyConfig.ageNeedScale must be in (0, 2]");
    }
    out.ageNeedScale = n;
  }
  if (r.guestIngredient != null) {
    const g = r.guestIngredient as Record<string, unknown>;
    const perRun = Number(g.perRun);
    const minBand = Number(g.minBand);
    if (!Number.isInteger(perRun) || perRun < 0 || perRun > 10) {
      throw new Error("dailyConfig.guestIngredient.perRun must be in [0, 10]");
    }
    if (!Number.isInteger(minBand) || minBand < 1 || minBand > 30) {
      throw new Error("dailyConfig.guestIngredient.minBand must be in [1, 30]");
    }
    out.guestIngredient = { perRun, minBand };
  }
  return Object.keys(out).length ? out : null;
}
