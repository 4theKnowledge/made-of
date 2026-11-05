import { describe, expect, it } from "vitest";
import { hydrateGame, type StoredGame } from "../storage";

/** Pre-mode-split saves wrote only `theme`/`daily` (no `mode` field). The
 *  `StoredGame` shape doesn't carry mode today — `hydrateGame` derives it
 *  from the presence of a daily key. This test locks that derivation so a
 *  future refactor can't silently regress the save/load contract. */
function base(partial: Partial<StoredGame> = {}): StoredGame {
  return {
    v: 6,
    theme: "everything",
    daily: null,
    n: 6,
    rs: 1,
    board: Array(36).fill(null),
    tray: [null, null, null],
    score: 0,
    made: 0,
    longest: 0,
    found: [],
    swaps: 0,
    clears: 0,
    hints: 0,
    mv: 0,
    shore: 0,
    pluck: 0,
    over: false,
    newBest: false,
    moves: 0,
    shelf: [],
    hold: [null, null],
    age: 0,
    ageMade: 0,
    crumb: Array(36).fill(null),
    closeCalls: 0,
    recentTrays: [],
    ...partial,
  };
}

describe("hydrateGame mode derivation", () => {
  it("endless save (daily=null) hydrates to mode=endless", () => {
    const s = hydrateGame(base({ daily: null }));
    expect(s.mode).toBe("endless");
  });

  it("daily save (daily=<dayKey>) hydrates to mode=daily", () => {
    const s = hydrateGame(base({ daily: "2026-11-05" }));
    expect(s.mode).toBe("daily");
  });
});
