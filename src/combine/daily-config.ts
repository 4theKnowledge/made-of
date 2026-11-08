/**
 * Daily-mode overrides for a Combine theme.
 *
 * Daily is a manifest run (T-0237 / T-0240). Every daily is won by making
 * every item on a per-day, server-generated **manifest** (`string[]` of
 * item ids). `guestIngredient` is kept as the generic "drip rare tiles
 * into the tray" scaffolding; the manifest config layers on top with its
 * own pool.
 *
 * `guestIngredient` is a deterministic "guest of the day" tile injected
 * into the dealer: per-day RNG picks N tiles from the catalogue at or
 * above band `minBand` and seeds them into the tray on chosen turns.
 * Same for every player so leaderboards stay comparable.
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
  /** Manifest / find-list config (T-0237). When an admin has an active
   *  daily, this field is REQUIRED — target-count dailies were removed
   *  along with the pre-manifest playerbase (user decision 2026-11-08).
   *
   *  The concrete per-day list is built at schedule-build time by the
   *  solver (T-0242) from `pool`'s members, respecting pins, and frozen
   *  onto `DailyPayload.manifest`. Mid-week admin edits don't shift
   *  already-scheduled days.
   *
   *  Daily-only. Endless and fast never read this field. */
  manifest?: {
    /** `combine_themes.code` whose membership sets the pool the generator
     *  samples from. The API handler (not this normaliser) checks the
     *  code exists — keeping this file sync + pure. */
    pool: string;
    /** Manifest size (number of items the player must find). 6–12 so the
     *  grid fits a 4×2 pictogram display on narrow widths without scroll. */
    size: number;
    /** Admin-pinned item ids. Length ≤ `size`, unique. Pins are placed
     *  first; the generator fills the rest from the pool. Each pin is
     *  validated for reachability at save-time (admin API) and at
     *  schedule-build time (payload builder). */
    pins?: string[];
    /** Dealer weight multiplier for tiles that are direct partners of
     *  unfound manifest items (`1 + partnerBias` on the dealer pass).
     *  0 disables the bias. Range [0, 2]; default 0.3. Ignored by the
     *  dealer until T-0245 lands. */
    partnerBias?: number;
  };
}

/** Admin-surface default when creating a theme without daily tuning.
 *  Deliberately empty — a theme opts in by setting fields. */
export const DEFAULT_DAILY_CONFIG: DailyConfig = {};

/** Default manifest size when the admin opts in without specifying one. */
export const DEFAULT_MANIFEST_SIZE = 8;
/** Default dealer partner-bias multiplier for unfound manifest items. */
export const DEFAULT_MANIFEST_PARTNER_BIAS = 0.3;

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
  if (r.manifest != null) {
    if (typeof r.manifest !== "object") {
      throw new Error("dailyConfig.manifest must be an object");
    }
    const m = r.manifest as Record<string, unknown>;
    if (typeof m.pool !== "string" || m.pool.length === 0) {
      throw new Error("dailyConfig.manifest.pool must be a non-empty string");
    }
    const size =
      m.size == null ? DEFAULT_MANIFEST_SIZE : Number(m.size);
    if (!Number.isInteger(size) || size < 6 || size > 12) {
      throw new Error("dailyConfig.manifest.size must be an integer in [6, 12]");
    }
    let pins: string[] | undefined;
    if (m.pins != null) {
      if (!Array.isArray(m.pins)) {
        throw new Error("dailyConfig.manifest.pins must be an array of item ids");
      }
      pins = [];
      for (const p of m.pins) {
        if (typeof p !== "string" || p.length === 0) {
          throw new Error("dailyConfig.manifest.pins entries must be non-empty strings");
        }
        pins.push(p);
      }
      if (pins.length > size) {
        throw new Error(
          `dailyConfig.manifest.pins length (${pins.length}) exceeds size (${size})`,
        );
      }
      if (new Set(pins).size !== pins.length) {
        throw new Error("dailyConfig.manifest.pins must be unique");
      }
    }
    let partnerBias = DEFAULT_MANIFEST_PARTNER_BIAS;
    if (m.partnerBias != null) {
      const pb = Number(m.partnerBias);
      if (!Number.isFinite(pb) || pb < 0 || pb > 2) {
        throw new Error("dailyConfig.manifest.partnerBias must be a number in [0, 2]");
      }
      partnerBias = pb;
    }
    out.manifest = { pool: m.pool, size, partnerBias };
    if (pins && pins.length > 0) out.manifest.pins = pins;
  }
  return Object.keys(out).length ? out : null;
}
