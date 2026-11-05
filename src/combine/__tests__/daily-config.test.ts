import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildAllDailyBundles, buildThemeBundle } from "../data";
import { normaliseDailyConfig } from "../daily-config";
import { ageNeed, newGame } from "../engine";
import { serialiseBundle, hydrateBundle } from "../serialise";

describe("normaliseDailyConfig", () => {
  it("returns null for null / undefined / empty object", () => {
    expect(normaliseDailyConfig(null)).toBeNull();
    expect(normaliseDailyConfig(undefined)).toBeNull();
    expect(normaliseDailyConfig({})).toBeNull();
  });

  it("accepts a well-formed config", () => {
    const cfg = normaliseDailyConfig({
      maxAges: 6,
      ageNeedScale: 0.5,
      guestIngredient: { perRun: 2, minBand: 7 },
    });
    expect(cfg).toEqual({
      maxAges: 6,
      ageNeedScale: 0.5,
      guestIngredient: { perRun: 2, minBand: 7 },
    });
  });

  it("rejects out-of-range maxAges", () => {
    expect(() => normaliseDailyConfig({ maxAges: 0 })).toThrow();
    expect(() => normaliseDailyConfig({ maxAges: 31 })).toThrow();
    expect(() => normaliseDailyConfig({ maxAges: 2.5 })).toThrow();
  });

  it("rejects out-of-range ageNeedScale", () => {
    expect(() => normaliseDailyConfig({ ageNeedScale: 0 })).toThrow();
    expect(() => normaliseDailyConfig({ ageNeedScale: 2.5 })).toThrow();
  });

  it("rejects malformed guestIngredient", () => {
    expect(() => normaliseDailyConfig({ guestIngredient: { perRun: -1, minBand: 1 } })).toThrow();
    expect(() => normaliseDailyConfig({ guestIngredient: { perRun: 1, minBand: 0 } })).toThrow();
  });
});

describe("buildThemeBundle with dailyConfig", () => {
  const snapshot = buildSnapshot(toRows(loadKnowledgeBase()));
  const endless = buildThemeBundle(snapshot, "everything");
  const fullAges = endless.theme.ages.length;

  it("endless bundle (no dailyConfig) includes all ages", () => {
    expect(endless.dailyConfig).toBeNull();
    expect(endless.guestPool).toBeUndefined();
    expect(fullAges).toBeGreaterThan(5);
  });

  it("maxAges caps the ages list and drops above-cap recipes", () => {
    const daily = buildThemeBundle(snapshot, "everything", 0, "daily", {
      maxAges: 4,
    });
    expect(daily.theme.ages.length).toBe(4);
    expect(daily.recipes.every((r) => r.band <= 4)).toBe(true);
    // The capped theme should still have a non-trivial recipe set.
    expect(daily.recipes.length).toBeGreaterThan(20);
  });

  it("guestIngredient populates guestPool with above-cap outputs", () => {
    const daily = buildThemeBundle(snapshot, "everything", 0, "daily", {
      maxAges: 4,
      guestIngredient: { perRun: 2, minBand: 5 },
    });
    expect(daily.guestPool).toBeDefined();
    expect(daily.guestPool!.length).toBeGreaterThan(0);
    // Guest outputs are *not* in the capped bundle's outputs set.
    for (const g of daily.guestPool!) {
      expect(daily.outputs.has(g)).toBe(false);
    }
  });

  it("perRun=0 omits the guest pool even when guestIngredient is present", () => {
    const daily = buildThemeBundle(snapshot, "everything", 0, "daily", {
      maxAges: 4,
      guestIngredient: { perRun: 0, minBand: 5 },
    });
    expect(daily.guestPool).toBeUndefined();
  });

  it("ageNeedScale lowers ageNeed across every age", () => {
    const daily = buildThemeBundle(snapshot, "everything", 0, "daily", {
      maxAges: 4,
      ageNeedScale: 0.5,
    });
    for (let age = 0; age < daily.theme.ages.length; age++) {
      const scaled = ageNeed(age, daily);
      const unscaled = ageNeed(age, endless);
      expect(scaled).toBeLessThanOrEqual(unscaled);
    }
  });

  it("buildAllDailyBundles with null config returns an endless-shaped bundle", () => {
    const d = buildAllDailyBundles(snapshot, {}, { everything: null });
    expect(d.everything.theme.ages.length).toBe(endless.theme.ages.length);
    expect(d.everything.guestPool).toBeUndefined();
  });

  it("buildAllDailyBundles with a config produces a capped bundle", () => {
    const d = buildAllDailyBundles(
      snapshot,
      {},
      { everything: { maxAges: 3, ageNeedScale: 0.5 } },
    );
    expect(d.everything.theme.ages.length).toBe(3);
    expect(d.everything.dailyConfig?.maxAges).toBe(3);
  });

  it("serialising + hydrating a daily bundle preserves dailyConfig + guestPool", () => {
    const daily = buildThemeBundle(snapshot, "everything", 0, "daily", {
      maxAges: 4,
      guestIngredient: { perRun: 2, minBand: 5 },
    });
    const rehydrated = hydrateBundle(serialiseBundle(daily));
    expect(rehydrated.dailyConfig?.maxAges).toBe(4);
    expect(rehydrated.guestPool).toEqual(daily.guestPool);
  });

  it("newGame on a capped daily bundle respects the cap (ages array)", () => {
    const daily = buildThemeBundle(snapshot, "everything", 0, "daily", {
      maxAges: 3,
    });
    const { state } = newGame("everything", daily, { daily: "2026-01-01", size: 6 });
    // The game has access to the capped bundle's full age pool.
    expect(daily.theme.ages.length).toBe(3);
    // Starting age is always 0; what matters is that the engine can't climb
    // above the cap because the dealer only sees band ≤ 3 recipes.
    expect(state.age).toBe(0);
    expect(daily.recipes.every((r) => r.band <= 3)).toBe(true);
  });
});
