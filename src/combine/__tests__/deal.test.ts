import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import { dealTray, pickOne, type DealerView } from "../deal";
import { playsInOne, playsInTwo, type Board } from "../match";
import { makeRng } from "../rng";

const snap = buildSnapshot(toRows(loadKnowledgeBase()));
const everything = buildThemeBundle(snap, "everything");

function emptyBoard(size: number): Board {
  return Array(size * size).fill(null);
}

function freshView(size: number, seed: number): DealerView {
  return {
    bundle: everything,
    board: emptyBoard(size),
    tray: [null, null, null],
    size,
    age: 0,
    rng: makeRng(seed),
  };
}

describe("pickOne", () => {
  it("returns an item id from the bundle", () => {
    const v = freshView(5, 1);
    const x = pickOne(v);
    expect(x).not.toBeNull();
    expect(everything.ingredients.has(x!) || everything.outputs.has(x!)).toBe(
      true,
    );
  });

  it("is deterministic for a given seed", () => {
    const a = pickOne(freshView(5, 42));
    const b = pickOne(freshView(5, 42));
    expect(a).toBe(b);
  });
});

describe("dealTray", () => {
  it("fills three slots with non-null values on an empty board", () => {
    const v = freshView(5, 100);
    const tray = dealTray(v);
    expect(tray).toHaveLength(3);
    for (const t of tray) expect(t).not.toBeNull();
  });

  it("is deterministic for a given seed", () => {
    const a = dealTray(freshView(5, 7));
    const b = dealTray(freshView(5, 7));
    expect(a).toEqual(b);
  });

  it("guarantees a play within two placements (single tray, empty board)", () => {
    const v = freshView(5, 777);
    const tray = dealTray(v);
    const one = playsInOne(everything, v.board, tray, 5);
    const two = playsInTwo(everything, v.board, tray, 5);
    expect(one || two).toBe(true);
  });
});

describe("dealing guarantee (bot simulation, Everything 6×6)", () => {
  it("≥98% of trays on empty boards have a play within two placements", () => {
    let total = 0;
    let solvable = 0;
    const size = 6;
    for (let i = 0; i < 100; i++) {
      const v: DealerView = {
        bundle: everything,
        board: emptyBoard(size),
        tray: [null, null, null],
        size,
        age: 0,
        rng: makeRng(5000 + i),
      };
      const tray = dealTray(v);
      const ok =
        playsInOne(everything, v.board, tray, size) ||
        playsInTwo(everything, v.board, tray, size);
      total++;
      if (ok) solvable++;
    }
    const pct = solvable / total;
    expect(pct).toBeGreaterThanOrEqual(0.98);
  });
});
