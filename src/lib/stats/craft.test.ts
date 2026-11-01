import { describe, expect, it } from "vitest";
import { computeCraftStats, type CraftRow } from "./craft";

function row(ref: string, moves: number, par: number, extras: Partial<CraftRow["result"]> = {}): CraftRow {
  return {
    ref,
    createdAt: new Date("2026-11-01T00:00:00Z"),
    result: {
      moves,
      par,
      hints: 0,
      timeMs: 60_000,
      stars: 3,
      points: 1000,
      badHides: 0,
      ...extras,
    },
  };
}

describe("computeCraftStats", () => {
  it("returns zeros for no rows", () => {
    const s = computeCraftStats([]);
    expect(s.totalSolves).toBe(0);
    expect(s.uniqueTargets).toBe(0);
    expect(s.atOrUnderPar).toBe(0);
    expect(s.threeStarSolves).toBe(0);
    expect(s.bestByTarget).toEqual({});
  });

  it("counts total vs unique targets", () => {
    const s = computeCraftStats([
      row("water", 5, 5),
      row("water", 7, 5),
      row("fire", 3, 3),
    ]);
    expect(s.totalSolves).toBe(3);
    expect(s.uniqueTargets).toBe(2);
  });

  it("tracks at-or-under-par and three-star counts", () => {
    const s = computeCraftStats([
      row("a", 5, 5, { stars: 3 }), // at par
      row("b", 4, 6, { stars: 3 }), // under par (shouldn't happen in practice, but math works)
      row("c", 8, 5, { stars: 2 }), // over par, 2-star
    ]);
    expect(s.atOrUnderPar).toBe(2);
    expect(s.threeStarSolves).toBe(2);
  });

  it("keeps the best moves / stars / time per target across replays", () => {
    const s = computeCraftStats([
      row("water", 10, 5, { timeMs: 90_000, stars: 1 }),
      row("water", 6, 5, { timeMs: 40_000, stars: 3 }),
      row("water", 8, 5, { timeMs: 50_000, stars: 2 }),
    ]);
    expect(s.bestByTarget.water).toEqual({
      bestMoves: 6,
      bestTimeMs: 40_000,
      bestStars: 3,
      bestScore: 1000,
    });
  });

  it("ignores zero timeMs when computing best time", () => {
    // Older rows missing a timer should not win the "fastest" slot.
    const s = computeCraftStats([
      row("water", 5, 5, { timeMs: 0 }),
      row("water", 7, 5, { timeMs: 30_000 }),
    ]);
    expect(s.bestByTarget.water.bestTimeMs).toBe(30_000);
  });

  it("tracks best and total score across every solve", () => {
    const s = computeCraftStats([
      row("water", 5, 5, { points: 820 }),
      row("water", 7, 5, { points: 940 }),
      row("fire", 3, 3, { points: 1000 }),
    ]);
    expect(s.bestScore).toBe(1000);
    expect(s.totalScore).toBe(2760);
    expect(s.bestByTarget.water.bestScore).toBe(940);
    expect(s.bestByTarget.fire.bestScore).toBe(1000);
  });
});
