/**
 * Central playtest-override system for Combine (T-0165).
 *
 * One URL param (`?gp_override=`) carries all experimental toggles so each
 * experiment doesn't invent its own flag. Format: comma-separated
 * `key=value` pairs; shorthand `key:value` also accepted.
 *
 *   ?gp_override=mode=soft,tray=4
 *   ?gp_override=mode:flat
 *
 * Persisted to localStorage; URL param takes precedence and overwrites.
 * Clear with `?gp_override=none` or `?gp_override=` (empty).
 *
 * Node / sim path: reads `process.env.CB_OVERRIDES` with the same string
 * format. Example: `CB_OVERRIDES='mode=soft,tray=4'`.
 */

export type ProgressionMode = "banded" | "flat" | "soft";

export interface GpOverrides {
  /** Progression mode. `banded` is the production default. */
  mode: ProgressionMode;
  /** Tray size. 3 is the production default; 4 is experimental. */
  traySize: 3 | 4;
}

const DEFAULTS: GpOverrides = {
  mode: "banded",
  traySize: 3,
};

const STORAGE_KEY = "combine_gp_overrides";

function parseString(raw: string): Partial<GpOverrides> {
  if (!raw || raw === "none") return {};
  const out: Partial<GpOverrides> = {};
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const sep = part.includes("=") ? "=" : part.includes(":") ? ":" : null;
    if (!sep) continue;
    const [kRaw, vRaw] = part.split(sep);
    const k = kRaw.trim();
    const v = (vRaw ?? "").trim();
    if (k === "mode") {
      if (v === "banded" || v === "flat" || v === "soft") out.mode = v;
    } else if (k === "tray") {
      const n = Number(v);
      if (n === 3 || n === 4) out.traySize = n;
    }
    // Unknown keys silently ignored for forward compatibility; could log in
    // dev if that turns out to be useful.
  }
  return out;
}

let cached: GpOverrides | null = null;
let cachedSource = "";

export function getGpOverrides(): GpOverrides {
  // SSR / Node.
  if (typeof window === "undefined") {
    const src = process.env.CB_OVERRIDES ?? "";
    if (cached && cachedSource === `env:${src}`) return cached;
    cached = { ...DEFAULTS, ...parseString(src) };
    cachedSource = `env:${src}`;
    return cached;
  }

  // Browser: URL wins and persists.
  try {
    const params = new URLSearchParams(window.location.search);
    const urlVal = params.get("gp_override");
    if (urlVal !== null) {
      if (urlVal === "" || urlVal === "none") {
        window.localStorage.removeItem(STORAGE_KEY);
      } else {
        window.localStorage.setItem(STORAGE_KEY, urlVal);
      }
    }
    const stored = window.localStorage.getItem(STORAGE_KEY) ?? "";
    if (cached && cachedSource === `ls:${stored}`) return cached;
    cached = { ...DEFAULTS, ...parseString(stored) };
    cachedSource = `ls:${stored}`;
    return cached;
  } catch {
    return DEFAULTS;
  }
}

/** Write a single override and persist. Browser only. Clears the cache so
 *  the next `getGpOverrides()` call returns the new value. */
export function setGpOverride<K extends keyof GpOverrides>(
  key: K,
  value: GpOverrides[K],
): void {
  if (typeof window === "undefined") return;
  try {
    const current = getGpOverrides();
    const next: GpOverrides = { ...current, [key]: value };
    const parts: string[] = [];
    if (next.mode !== DEFAULTS.mode) parts.push(`mode=${next.mode}`);
    if (next.traySize !== DEFAULTS.traySize) parts.push(`tray=${next.traySize}`);
    const str = parts.join(",");
    if (str) window.localStorage.setItem(STORAGE_KEY, str);
    else window.localStorage.removeItem(STORAGE_KEY);
    cached = null;
    cachedSource = "";
  } catch {}
}

/** Playtest env flag — when "1", surface the in-game experiments toggle.
 *  Prod builds unset this; `NEXT_PUBLIC_*` is inlined at build time so no
 *  runtime fetch required. */
export function isPlaytestEnabled(): boolean {
  return process.env.NEXT_PUBLIC_COMBINE_PLAYTEST === "1";
}

/** Serialise active overrides for analytics event props. Empty object when
 *  all defaults (no playtest set) so it doesn't bloat every event. */
export function getActivePlaytestProps(): Record<string, string | number> {
  const o = getGpOverrides();
  const out: Record<string, string | number> = {};
  if (o.mode !== DEFAULTS.mode) out.playtest_mode = o.mode;
  if (o.traySize !== DEFAULTS.traySize) out.playtest_tray = o.traySize;
  return out;
}

/** Reset cache — tests only. */
export function _resetOverridesForTest(): void {
  cached = null;
  cachedSource = "";
}
