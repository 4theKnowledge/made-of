import { describe, expect, it } from "vitest";
import { hydrateGame, type StoredGame } from "../storage";

/** `StoredGame` carries an explicit `mode` field since v7 (fast runs
 *  needed their own slot). `hydrateGame` just echoes it through — this
 *  test locks that round-trip so a future refactor can't silently
 *  reintroduce mode-from-daily inference. */
function base(partial: Partial<StoredGame> = {}): StoredGame {
  return {
    v: 7,
    theme: "everything",
    mode: "endless",
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

describe("hydrateGame mode", () => {
  it("endless save hydrates to mode=endless", () => {
    const s = hydrateGame(base({ mode: "endless" }));
    expect(s.mode).toBe("endless");
  });

  it("daily save hydrates to mode=daily", () => {
    const s = hydrateGame(base({ mode: "daily", daily: "2026-11-05" }));
    expect(s.mode).toBe("daily");
  });

  it("fast save hydrates to mode=fast", () => {
    const s = hydrateGame(base({ mode: "fast" }));
    expect(s.mode).toBe("fast");
  });
});
