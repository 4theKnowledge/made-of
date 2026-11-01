import { describe, expect, it } from "vitest";
import {
  computeCombineStats,
  type CombineRow,
  type CombineRun,
} from "./combine";

function row(itemId: string, tier: CombineRow["tier"], iso: string): CombineRow {
  return { itemId, tier, firstFoundAt: new Date(iso) };
}

function run(ref: string, score: number, extras: Partial<CombineRun["result"]> = {}): CombineRun {
  return {
    ref,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    result: { score, made: 10, age: 1, ...extras },
  };
}

describe("computeCombineStats", () => {
  it("returns zeros for no rows", () => {
    const s = computeCombineStats([]);
    expect(s.totalDiscovered).toBe(0);
    expect(s.byTier).toEqual({ F: 0, N: 0, M: 0, C: 0, P: 0, S: 0 });
    expect(s.firstEver).toBeNull();
    expect(s.latest).toBeNull();
  });

  it("counts total discoveries", () => {
    const s = computeCombineStats([
      row("a", "F", "2026-01-01T00:00:00Z"),
      row("b", "N", "2026-01-02T00:00:00Z"),
      row("c", "M", "2026-01-03T00:00:00Z"),
    ]);
    expect(s.totalDiscovered).toBe(3);
  });

  it("groups by tier", () => {
    const s = computeCombineStats([
      row("a", "F", "2026-01-01T00:00:00Z"),
      row("b", "F", "2026-01-02T00:00:00Z"),
      row("c", "N", "2026-01-03T00:00:00Z"),
    ]);
    expect(s.byTier.F).toBe(2);
    expect(s.byTier.N).toBe(1);
    expect(s.byTier.M).toBe(0);
  });

  it("picks earliest and latest timestamps", () => {
    const s = computeCombineStats([
      row("a", "F", "2026-03-01T00:00:00Z"),
      row("b", "F", "2026-01-01T00:00:00Z"),
      row("c", "F", "2026-02-01T00:00:00Z"),
    ]);
    expect(s.firstEver?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(s.latest?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("returns empty run stats when no runs are passed", () => {
    const s = computeCombineStats([row("a", "F", "2026-01-01T00:00:00Z")]);
    expect(s.totalRuns).toBe(0);
    expect(s.bestScoreEver).toBe(0);
    expect(s.bestByTheme).toEqual({});
  });

  it("aggregates run bests per theme and overall", () => {
    const s = computeCombineStats(
      [],
      [
        run("everyday", 46),
        run("everyday", 120),
        run("everyday", 80),
        run("everything", 300),
      ],
    );
    expect(s.totalRuns).toBe(4);
    expect(s.bestScoreEver).toBe(300);
    expect(s.bestByTheme.everyday).toEqual({
      bestScore: 120,
      totalRuns: 3,
      totalScore: 246,
    });
    expect(s.bestByTheme.everything).toEqual({
      bestScore: 300,
      totalRuns: 1,
      totalScore: 300,
    });
  });
});
