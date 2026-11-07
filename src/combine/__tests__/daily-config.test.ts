import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildAllDailyBundles, buildThemeBundle } from "../data";
import {
  DEFAULT_TARGET_DISCOVERIES,
  normaliseDailyConfig,
  resolveDailyTarget,
} from "../daily-config";
import { newGame } from "../engine";
import { serialiseBundle, hydrateBundle } from "../serialise";

describe("normaliseDailyConfig", () => {
  it("returns null for null / undefined / empty object", () => {
    expect(normaliseDailyConfig(null)).toBeNull();
    expect(normaliseDailyConfig(undefined)).toBeNull();
    expect(normaliseDailyConfig({})).toBeNull();
  });

  it("accepts a well-formed config", () => {
    const cfg = normaliseDailyConfig({
      guestIngredient: { perRun: 2, minBand: 7 },
    });
    expect(cfg).toEqual({
      guestIngredient: { perRun: 2, minBand: 7 },
    });
  });

  it("silently ignores unknown keys (e.g. legacy maxAges on old rows)", () => {
    // Pre-T-0196 configs may still carry maxAges. Normaliser should accept
    // the row without choking — the field is just dropped on read.
    expect(normaliseDailyConfig({ maxAges: 5 })).toBeNull();
    expect(
      normaliseDailyConfig({ maxAges: 5, guestIngredient: { perRun: 1, minBand: 8 } }),
    ).toEqual({ guestIngredient: { perRun: 1, minBand: 8 } });
  });

  it("rejects malformed guestIngredient", () => {
    expect(() => normaliseDailyConfig({ guestIngredient: { perRun: -1, minBand: 1 } })).toThrow();
    expect(() => normaliseDailyConfig({ guestIngredient: { perRun: 1, minBand: 0 } })).toThrow();
  });

  it("accepts a valid targetDiscoveries", () => {
    expect(normaliseDailyConfig({ targetDiscoveries: 10 })).toEqual({
      targetDiscoveries: 10,
    });
  });

  it("rejects out-of-range targetDiscoveries", () => {
    expect(() => normaliseDailyConfig({ targetDiscoveries: 2 })).toThrow();
    expect(() => normaliseDailyConfig({ targetDiscoveries: 51 })).toThrow();
    expect(() => normaliseDailyConfig({ targetDiscoveries: 5.5 })).toThrow();
  });

  it("accepts valid targetByDow and rejects bad keys / values", () => {
    expect(
      normaliseDailyConfig({ targetByDow: { "0": 10, "6": 12 } }),
    ).toEqual({ targetByDow: { "0": 10, "6": 12 } });
    expect(() => normaliseDailyConfig({ targetByDow: { "7": 10 } })).toThrow();
    expect(() => normaliseDailyConfig({ targetByDow: { mon: 10 } })).toThrow();
    expect(() => normaliseDailyConfig({ targetByDow: { "0": 2 } })).toThrow();
  });
});

describe("resolveDailyTarget", () => {
  // 2026-11-08 is a Sunday → getUTCDay() === 0 → key "0".
  // 2026-11-09 is a Monday → key "1".
  it("per-weekday override takes precedence over base", () => {
    expect(
      resolveDailyTarget({ targetDiscoveries: 8, targetByDow: { "0": 12 } }, "2026-11-08"),
    ).toBe(12);
  });
  it("falls back to base when no DOW override matches", () => {
    expect(
      resolveDailyTarget({ targetDiscoveries: 8, targetByDow: { "0": 12 } }, "2026-11-09"),
    ).toBe(8);
  });
  it("falls back to DEFAULT_TARGET_DISCOVERIES when neither set", () => {
    expect(resolveDailyTarget({}, "2026-11-09")).toBe(DEFAULT_TARGET_DISCOVERIES);
    expect(resolveDailyTarget(null, "2026-11-09")).toBe(DEFAULT_TARGET_DISCOVERIES);
  });
});

describe("buildThemeBundle with dailyConfig", () => {
  const snapshot = buildSnapshot(toRows(loadKnowledgeBase()));
  const endless = buildThemeBundle(snapshot, "everything");

  it("endless bundle (no dailyConfig) has no guestPool", () => {
    expect(endless.dailyConfig).toBeNull();
    expect(endless.guestPool).toBeUndefined();
  });

  it("daily with guestIngredient populates guestPool with min-band-or-deeper outputs", () => {
    const daily = buildThemeBundle(snapshot, "everything", 0, "daily", {
      guestIngredient: { perRun: 2, minBand: 5 },
    });
    expect(daily.guestPool).toBeDefined();
    expect(daily.guestPool!.length).toBeGreaterThan(0);
    // Every guest output has a min-band >= 5 (verified via the bundle's
    // outBand map which captures lowest band per output).
    for (const g of daily.guestPool!) {
      const b = daily.outBand.get(g);
      expect(b).toBeDefined();
      expect(b!).toBeGreaterThanOrEqual(5);
    }
  });

  it("perRun=0 omits the guest pool even when guestIngredient is present", () => {
    const daily = buildThemeBundle(snapshot, "everything", 0, "daily", {
      guestIngredient: { perRun: 0, minBand: 5 },
    });
    expect(daily.guestPool).toBeUndefined();
  });

  it("daily recipes include every endless recipe (no banded cap)", () => {
    const daily = buildThemeBundle(snapshot, "everything", 0, "daily", {
      guestIngredient: { perRun: 2, minBand: 5 },
    });
    expect(daily.recipes.length).toBe(endless.recipes.length);
  });

  it("buildAllDailyBundles with null config returns an endless-shaped bundle", () => {
    const d = buildAllDailyBundles(snapshot, {}, { everything: null });
    expect(d.everything.theme.ages.length).toBe(endless.theme.ages.length);
    expect(d.everything.guestPool).toBeUndefined();
  });

  it("serialising + hydrating a daily bundle preserves dailyConfig + guestPool", () => {
    const daily = buildThemeBundle(snapshot, "everything", 0, "daily", {
      guestIngredient: { perRun: 2, minBand: 5 },
    });
    const rehydrated = hydrateBundle(serialiseBundle(daily));
    expect(rehydrated.dailyConfig?.guestIngredient?.perRun).toBe(2);
    expect(rehydrated.guestPool).toEqual(daily.guestPool);
  });

  it("newGame on a daily bundle starts at chapter 0", () => {
    const daily = buildThemeBundle(snapshot, "everything", 0, "daily", {
      guestIngredient: { perRun: 2, minBand: 5 },
    });
    const { state } = newGame("everything", daily, { daily: "2026-01-01", size: 6 });
    expect(state.chapter).toBe(0);
  });
});
