/**
 * Daily-mode overrides for a Combine theme.
 *
 * Daily runs are target-list-ended (fit in ~15 min). The admin sets these
 * on the singleton `combine_daily_config` row; `buildThemeBundle` reads
 * them when the bundle is built for `mode: "daily"`.
 *
 * `guestIngredient` is a deterministic "guest of the day" tile injected
 * into the dealer: per-day RNG picks N tiles from the catalogue at or
 * above band `minBand` (the thematic grouping; later bands = rarer items)
 * and seeds them into the tray on chosen turns. Same for every player so
 * leaderboards stay comparable; purpose is to drip rare items into the
 * lifetime daily collection over time.
 */

export interface DailyConfig {
  /** Guest-ingredient injection. */
  guestIngredient?: {
    /** How many guest tiles to inject per daily run. */
    perRun: number;
    /** Minimum catalogue band (1-based) a guest tile's output lives in.
     *  Higher = rarer / later-era items. The "band" here is the thematic
     *  catalogue grouping (I, II, III…), not a progression gate. */
    minBand: number;
  };
  /** Target discovery count that ends a daily run (win). `null`/missing falls
   *  back to the per-DOW map, then to `DEFAULT_TARGET_DISCOVERIES`. The run
   *  ends either when `found.length >= target` (win) or the board runs out
   *  of legal moves (loss). */
  targetDiscoveries?: number;
  /** Per-weekday overrides for `targetDiscoveries`. Keys are `"0"`–`"6"`
   *  where `"0"` = Sunday (matches `Date#getUTCDay()`). Resolved at schedule-
   *  build time and frozen onto the `DailyPayload`, so admin edits never
   *  retroactively change a day that's already been scheduled. */
  targetByDow?: Record<string, number>;
}

/** Admin-surface default when creating a theme without daily tuning.
 *  Deliberately empty — a theme opts in by setting fields. */
export const DEFAULT_DAILY_CONFIG: DailyConfig = {};

/** Default discovery target when neither `targetByDow[dow]` nor
 *  `targetDiscoveries` is set. Single source of truth for the resolver,
 *  the admin placeholder, and defensive engine fallbacks. */
export const DEFAULT_TARGET_DISCOVERIES = 40;

/** Validate a candidate dailyConfig payload (admin API or seed). Returns a
 *  normalised shape or null if the payload is empty / falsy. Throws on
 *  malformed input. Caller handles the error → HTTP mapping. */
export function normaliseDailyConfig(raw: unknown): DailyConfig | null {
  if (raw == null) return null;
  if (typeof raw !== "object") throw new Error("dailyConfig must be an object");
  const out: DailyConfig = {};
  const r = raw as Record<string, unknown>;
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
  if (r.targetDiscoveries != null) {
    const n = Number(r.targetDiscoveries);
    if (!Number.isInteger(n) || n < 3 || n > 50) {
      throw new Error("dailyConfig.targetDiscoveries must be an integer in [3, 50]");
    }
    out.targetDiscoveries = n;
  }
  if (r.targetByDow != null) {
    if (typeof r.targetByDow !== "object") {
      throw new Error("dailyConfig.targetByDow must be an object");
    }
    const src = r.targetByDow as Record<string, unknown>;
    const out2: Record<string, number> = {};
    for (const [k, v] of Object.entries(src)) {
      if (!/^[0-6]$/.test(k)) {
        throw new Error("dailyConfig.targetByDow keys must be \"0\"–\"6\" (Sun=0)");
      }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 3 || n > 50) {
        throw new Error(`dailyConfig.targetByDow[${k}] must be an integer in [3, 50]`);
      }
      out2[k] = n;
    }
    if (Object.keys(out2).length) out.targetByDow = out2;
  }
  return Object.keys(out).length ? out : null;
}

/** Resolve the discovery target for a specific daily day. Precedence:
 *  per-weekday override > base `targetDiscoveries` > `DEFAULT_TARGET_DISCOVERIES`.
 *  `dayKey` is `YYYY-MM-DD` in UTC; the weekday is taken via `getUTCDay()`
 *  so the number is stable regardless of the admin's local timezone. */
export function resolveDailyTarget(
  config: DailyConfig | null | undefined,
  dayKey: string,
): number {
  if (!config) return DEFAULT_TARGET_DISCOVERIES;
  const dow = new Date(`${dayKey}T00:00:00Z`).getUTCDay().toString();
  return (
    config.targetByDow?.[dow] ??
    config.targetDiscoveries ??
    DEFAULT_TARGET_DISCOVERIES
  );
}
