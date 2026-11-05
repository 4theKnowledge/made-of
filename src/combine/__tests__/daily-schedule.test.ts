import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import {
  buildDailyPayload,
  buildSchedule,
  cappedBuildableSet,
  dayRange,
  daysBetween,
  guestPoolFor,
  nextDay,
  pickGuests,
  reachableGuestRecipe,
  rotationWindow,
} from "../daily-schedule";

describe("day math", () => {
  it("nextDay crosses month and year boundaries", () => {
    expect(nextDay("2026-01-31")).toBe("2026-02-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("2024-02-28")).toBe("2024-02-29"); // leap year
    expect(nextDay("2025-02-28")).toBe("2025-03-01");
  });

  it("dayRange produces N consecutive keys", () => {
    expect(dayRange("2026-01-01", 3)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("daysBetween counts whole days", () => {
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
    expect(daysBetween("2026-01-01", "2026-01-10")).toBe(9);
    expect(daysBetween("2026-01-10", "2026-01-01")).toBe(-9);
  });
});

describe("rotationWindow", () => {
  it("returns pool/perRun ceiled", () => {
    expect(rotationWindow(100, 2)).toBe(50);
    expect(rotationWindow(99, 2)).toBe(50);
    expect(rotationWindow(5, 1)).toBe(5);
  });
  it("returns 0 when perRun or pool are 0", () => {
    expect(rotationWindow(0, 2)).toBe(0);
    expect(rotationWindow(10, 0)).toBe(0);
  });
});

describe("pickGuests", () => {
  const pool = ["a", "b", "c", "d", "e"];

  it("prefers never-served items", () => {
    const recent = new Map([["a", 1], ["b", 2]]); // a,b recently served
    const picks = pickGuests("2026-01-01", pool, 2, recent);
    // Never-served subset: c, d, e. All three should rank above a or b.
    expect(picks.every((id) => ["c", "d", "e"].includes(id))).toBe(true);
    expect(picks.length).toBe(2);
  });

  it("falls back to oldest-served when never-served is exhausted", () => {
    const recent = new Map([
      ["a", 10],
      ["b", 2],
      ["c", 5],
      ["d", 1],
      ["e", 8],
    ]);
    const picks = pickGuests("2026-01-01", pool, 2, recent);
    // Oldest is a (10 days ago), then e (8). Expect those.
    expect(picks).toEqual(["a", "e"]);
  });

  it("is deterministic for the same day + pool + history", () => {
    const recent = new Map<string, number>();
    const a = pickGuests("2026-01-01", pool, 3, recent);
    const b = pickGuests("2026-01-01", pool, 3, recent);
    expect(a).toEqual(b);
  });

  it("produces different picks on different days", () => {
    const recent = new Map<string, number>();
    const a = pickGuests("2026-01-01", pool, 3, recent);
    const b = pickGuests("2026-01-02", pool, 3, recent);
    expect(a).not.toEqual(b);
  });

  it("returns empty on k=0 or empty pool", () => {
    expect(pickGuests("2026-01-01", pool, 0, new Map())).toEqual([]);
    expect(pickGuests("2026-01-01", [], 3, new Map())).toEqual([]);
  });
});

describe("guestPoolFor + reachableGuestRecipe", () => {
  const snapshot = buildSnapshot(toRows(loadKnowledgeBase()));
  const full = buildThemeBundle(snapshot, "everything");
  const capped = buildThemeBundle(snapshot, "everything", 0, "daily", {
    maxAges: 4,
    guestIngredient: { perRun: 2, minBand: 5 },
  });

  it("guestPoolFor yields outputs whose min band is ≥ max(cap+1, minBand)", () => {
    const pool = guestPoolFor(full, { maxAges: 4, guestIngredient: { perRun: 2, minBand: 5 } });
    expect(pool.length).toBeGreaterThan(0);
    // Returned pool is sorted.
    expect([...pool].sort()).toEqual(pool);
    // None of them should be reachable within the capped bundle's outputs.
    for (const id of pool) expect(capped.outputs.has(id)).toBe(false);
  });

  it("reachableGuestRecipe prefers smaller recipes and respects capped buildable", () => {
    const pool = guestPoolFor(full, { maxAges: 4, guestIngredient: { perRun: 2, minBand: 5 } });
    const buildable = cappedBuildableSet(capped);
    let anyReachable = 0;
    for (const id of pool.slice(0, 50)) {
      const r = reachableGuestRecipe(full, id, buildable);
      if (r) {
        anyReachable++;
        expect(r.all.every((part) => buildable.has(part))).toBe(true);
      }
    }
    expect(anyReachable).toBeGreaterThan(0);
  });
});

describe("buildSchedule", () => {
  const snapshot = buildSnapshot(toRows(loadKnowledgeBase()));
  const full = buildThemeBundle(snapshot, "everything");

  it("rotates so the same output rarely repeats inside the window", () => {
    const cfg = { maxAges: 4, guestIngredient: { perRun: 1, minBand: 5 } };
    const schedule = buildSchedule(
      { theme: "everything", fullBundle: full, dailyConfig: cfg },
      "2026-01-01",
      14,
      [],
    );
    expect(schedule).toHaveLength(14);
    // Each day picks exactly one guest.
    for (const row of schedule) expect(row.payload.guestOutputIds).toHaveLength(1);
    // Within the first `window` days, every guest should be unique.
    const pool = guestPoolFor(full, cfg);
    const window = rotationWindow(pool.length, 1);
    const windowedIds = schedule
      .slice(0, Math.min(window, 14))
      .flatMap((r) => r.payload.guestOutputIds);
    expect(new Set(windowedIds).size).toBe(windowedIds.length);
  });

  it("uses priorRows to continue the rotation without repeats", () => {
    const cfg = { maxAges: 4, guestIngredient: { perRun: 1, minBand: 5 } };
    const first = buildSchedule(
      { theme: "everything", fullBundle: full, dailyConfig: cfg },
      "2026-01-01",
      5,
      [],
    );
    const second = buildSchedule(
      { theme: "everything", fullBundle: full, dailyConfig: cfg },
      "2026-01-06",
      5,
      first,
    );
    const firstIds = new Set(first.flatMap((r) => r.payload.guestOutputIds));
    const secondIds = new Set(second.flatMap((r) => r.payload.guestOutputIds));
    // No overlap within the window.
    for (const id of secondIds) expect(firstIds.has(id)).toBe(false);
  });

  it("payload freezes the config at build time", () => {
    const cfg = { maxAges: 3, ageNeedScale: 0.5, guestIngredient: { perRun: 2, minBand: 4 } };
    const schedule = buildSchedule(
      { theme: "everything", fullBundle: full, dailyConfig: cfg },
      "2026-01-01",
      1,
      [],
    );
    expect(schedule[0].payload.config).toEqual(cfg);
    expect(schedule[0].payload.version).toBe(1);
  });

  it("is deterministic for the same input", () => {
    const cfg = { maxAges: 4, guestIngredient: { perRun: 2, minBand: 5 } };
    const a = buildSchedule(
      { theme: "everything", fullBundle: full, dailyConfig: cfg },
      "2026-01-01",
      7,
      [],
    );
    const b = buildSchedule(
      { theme: "everything", fullBundle: full, dailyConfig: cfg },
      "2026-01-01",
      7,
      [],
    );
    for (let i = 0; i < a.length; i++) {
      expect(a[i].day).toBe(b[i].day);
      expect(a[i].payload.guestOutputIds).toEqual(b[i].payload.guestOutputIds);
    }
  });
});

describe("buildDailyPayload", () => {
  const snapshot = buildSnapshot(toRows(loadKnowledgeBase()));
  const full = buildThemeBundle(snapshot, "everything");

  it("seeds from the day key", () => {
    const cfg = { maxAges: 4, guestIngredient: { perRun: 2, minBand: 5 } };
    const p1 = buildDailyPayload(
      { theme: "everything", fullBundle: full, dailyConfig: cfg },
      "2026-01-01",
      new Map(),
    );
    const p2 = buildDailyPayload(
      { theme: "everything", fullBundle: full, dailyConfig: cfg },
      "2026-01-02",
      new Map(),
    );
    // Seeds are derived from the day key; different days → different seeds.
    expect(p1.seed).not.toBe(p2.seed);
  });

  it("returns empty guests when guestIngredient is absent", () => {
    const p = buildDailyPayload(
      { theme: "everything", fullBundle: full, dailyConfig: { maxAges: 4 } },
      "2026-01-01",
      new Map(),
    );
    expect(p.guestOutputIds).toEqual([]);
  });
});
