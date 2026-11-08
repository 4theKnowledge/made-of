import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildAllDailyBundles, buildThemeBundle } from "../data";
import { normaliseDailyConfig } from "../daily-config";
import { newGame } from "../engine";
import { serialiseBundle, hydrateBundle } from "../serialise";

describe("normaliseDailyConfig", () => {
  it("returns null for null / undefined / empty object", () => {
    expect(normaliseDailyConfig(null)).toBeNull();
    expect(normaliseDailyConfig(undefined)).toBeNull();
    expect(normaliseDailyConfig({})).toBeNull();
  });

  it("accepts a well-formed guestIngredient config", () => {
    const cfg = normaliseDailyConfig({
      guestIngredient: { perRun: 2, minBand: 7 },
    });
    expect(cfg).toEqual({
      guestIngredient: { perRun: 2, minBand: 7 },
    });
  });

  it("silently ignores unknown keys (e.g. legacy targetDiscoveries / maxAges)", () => {
    // Pre-T-0240 configs may still carry targetDiscoveries or targetByDow
    // in the DB. Normaliser drops them silently so a stale row doesn't
    // choke. Only the known branches are preserved.
    expect(normaliseDailyConfig({ targetDiscoveries: 40 })).toBeNull();
    expect(normaliseDailyConfig({ targetByDow: { "0": 10 } })).toBeNull();
    expect(normaliseDailyConfig({ maxAges: 5 })).toBeNull();
    expect(
      normaliseDailyConfig({
        maxAges: 5,
        targetDiscoveries: 40,
        guestIngredient: { perRun: 1, minBand: 8 },
      }),
    ).toEqual({ guestIngredient: { perRun: 1, minBand: 8 } });
  });

  it("rejects malformed guestIngredient", () => {
    expect(() => normaliseDailyConfig({ guestIngredient: { perRun: -1, minBand: 1 } })).toThrow();
    expect(() => normaliseDailyConfig({ guestIngredient: { perRun: 1, minBand: 0 } })).toThrow();
  });

  // T-0240: manifest branch
  it("accepts a minimal manifest config and fills defaults", () => {
    expect(normaliseDailyConfig({ manifest: { pool: "everything" } })).toEqual({
      manifest: { pool: "everything", size: 8, partnerBias: 0.3 },
    });
  });

  it("accepts a full manifest config with pins", () => {
    expect(
      normaliseDailyConfig({
        manifest: {
          pool: "everyday",
          size: 10,
          pins: ["item-a", "item-b"],
          partnerBias: 0.5,
        },
      }),
    ).toEqual({
      manifest: {
        pool: "everyday",
        size: 10,
        pins: ["item-a", "item-b"],
        partnerBias: 0.5,
      },
    });
  });

  it("rejects malformed manifest", () => {
    expect(() => normaliseDailyConfig({ manifest: {} })).toThrow(/pool/);
    expect(() => normaliseDailyConfig({ manifest: { pool: "" } })).toThrow(/pool/);
    expect(() =>
      normaliseDailyConfig({ manifest: { pool: "x", size: 0 } }),
    ).toThrow(/size/);
    expect(() =>
      normaliseDailyConfig({ manifest: { pool: "x", size: 13 } }),
    ).toThrow(/size/);
    expect(() =>
      normaliseDailyConfig({ manifest: { pool: "x", size: 8, partnerBias: -0.1 } }),
    ).toThrow(/partnerBias/);
    expect(() =>
      normaliseDailyConfig({ manifest: { pool: "x", size: 8, partnerBias: 2.5 } }),
    ).toThrow(/partnerBias/);
  });

  it("rejects pins longer than size", () => {
    expect(() =>
      normaliseDailyConfig({
        manifest: { pool: "x", size: 6, pins: ["a", "b", "c", "d", "e", "f", "g"] },
      }),
    ).toThrow(/pins length/);
  });

  it("rejects duplicate pins", () => {
    expect(() =>
      normaliseDailyConfig({
        manifest: { pool: "x", size: 8, pins: ["a", "b", "a"] },
      }),
    ).toThrow(/unique/);
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
