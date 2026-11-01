import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import {
  edgeNeighbours,
  grow,
  matchAt,
  matchOn,
  playsInOne,
  playsInTwo,
  type Board,
} from "../match";
import type { CombineRecipe, ThemeBundle } from "../types";

/** Hand-rolled bundle so match tests can assert exact shapes without
 *  depending on live knowledge-base counts. */
function fakeBundle(recipes: CombineRecipe[]): ThemeBundle {
  const byIngredient = new Map<string, CombineRecipe[]>();
  for (const r of recipes) {
    for (const x of r.all) {
      let list = byIngredient.get(x);
      if (!list) {
        list = [];
        byIngredient.set(x, list);
      }
      list.push(r);
    }
  }
  for (const list of byIngredient.values()) {
    list.sort((a, b) => b.all.length - a.all.length);
  }
  return {
    theme: {
      k: "everything",
      name: "Test",
      desc: "",
      ages: ["one"],
    },
    recipes,
    byIngredient,
    outputs: new Set(recipes.map((r) => r.out)),
    ingredients: new Set(recipes.flatMap((r) => r.all)),
    base: [],
    mid: [],
    tools: new Set(),
    terminal: new Set(),
    sameIngredients: new Map(),
    items: new Map(),
  };
}

const R = (out: string, all: string[]): CombineRecipe => ({
  out,
  from: all,
  with: [],
  all,
  lvl: 1,
  band: 1,
});

describe("edgeNeighbours", () => {
  it("corner cell has 2 neighbours", () => {
    expect(edgeNeighbours(0, 5).sort((a, b) => a - b)).toEqual([1, 5]);
    expect(edgeNeighbours(4, 5).sort((a, b) => a - b)).toEqual([3, 9]);
    expect(edgeNeighbours(20, 5).sort((a, b) => a - b)).toEqual([15, 21]);
    expect(edgeNeighbours(24, 5).sort((a, b) => a - b)).toEqual([19, 23]);
  });

  it("edge cell has 3 neighbours", () => {
    expect(edgeNeighbours(2, 5).sort((a, b) => a - b)).toEqual([1, 3, 7]);
  });

  it("interior cell has 4 neighbours", () => {
    expect(edgeNeighbours(6, 5).sort((a, b) => a - b)).toEqual([1, 5, 7, 11]);
  });
});

describe("grow (shape coverage)", () => {
  const size = 5;
  // 5×5 board, place things at specific cells for each test.
  const empty = (): Board => Array(25).fill(null);

  it("line of 3 (horizontal)", () => {
    const b = empty();
    b[0] = "a";
    b[1] = "b";
    b[2] = "c";
    const got = grow(b, [0], ["b", "c"], size);
    expect(got).not.toBeNull();
    expect(got!.sort((x, y) => x - y)).toEqual([0, 1, 2]);
  });

  it("line of 3 (vertical)", () => {
    const b = empty();
    b[0] = "a";
    b[5] = "b";
    b[10] = "c";
    const got = grow(b, [0], ["b", "c"], size);
    expect(got).not.toBeNull();
    expect(got!.sort((x, y) => x - y)).toEqual([0, 5, 10]);
  });

  it("L-shape", () => {
    const b = empty();
    b[0] = "a";
    b[1] = "b";
    b[6] = "c";
    const got = grow(b, [0], ["b", "c"], size);
    expect(got).not.toBeNull();
    expect(got!.sort((x, y) => x - y)).toEqual([0, 1, 6]);
  });

  it("3×3 block (9 cells)", () => {
    const b = empty();
    const cells = [0, 1, 2, 5, 6, 7, 10, 11, 12];
    const need = ["b", "c", "d", "e", "f", "g", "h", "i"];
    b[0] = "a";
    cells.slice(1).forEach((c, k) => (b[c] = need[k]));
    const got = grow(b, [0], need, size);
    expect(got).not.toBeNull();
    expect(got!.length).toBe(9);
  });

  it("zig-zag", () => {
    const b = empty();
    // 0 - 1 - 6 - 7 — all edge-adjacent via (0-1), (1-6), (6-7).
    b[0] = "a";
    b[1] = "b";
    b[6] = "c";
    b[7] = "d";
    const got = grow(b, [0], ["b", "c", "d"], size);
    expect(got).not.toBeNull();
    expect(got!.length).toBe(4);
  });

  it("fails when one tile is out of contact", () => {
    const b = empty();
    // a at 0, b at 1, c at 10 (not adjacent to 0 or 1).
    b[0] = "a";
    b[1] = "b";
    b[10] = "c";
    const got = grow(b, [0], ["b", "c"], size);
    expect(got).toBeNull();
  });

  it("fails when needed item isn't on the board", () => {
    const b = empty();
    b[0] = "a";
    b[1] = "b";
    const got = grow(b, [0], ["b", "c"], size);
    expect(got).toBeNull();
  });
});

describe("matchAt", () => {
  const size = 5;
  const bundle = fakeBundle([
    R("bread", ["flour", "water", "oven"]),
    R("dough", ["flour", "water"]),
  ]);

  it("prefers the bigger recipe when both fit", () => {
    const b: Board = Array(25).fill(null);
    b[0] = "flour";
    b[1] = "water";
    b[2] = "oven";
    const m = matchAt(bundle, b, 0, "flour", size);
    expect(m).not.toBeNull();
    expect(m!.recipe.out).toBe("bread");
    expect(m!.cells.length).toBe(3);
  });

  it("falls back to the smaller recipe when the big one can't form", () => {
    const b: Board = Array(25).fill(null);
    b[0] = "flour";
    b[1] = "water";
    const m = matchAt(bundle, b, 0, "flour", size);
    expect(m).not.toBeNull();
    expect(m!.recipe.out).toBe("dough");
  });

  it("returns null when no recipe fits", () => {
    const b: Board = Array(25).fill(null);
    b[0] = "flour";
    const m = matchAt(bundle, b, 0, "flour", size);
    expect(m).toBeNull();
  });
});

describe("matchOn (drop-on-top)", () => {
  const size = 5;
  const bundle = fakeBundle([R("dough", ["flour", "water"])]);

  it("works when the target holds the other ingredient", () => {
    const b: Board = Array(25).fill(null);
    b[0] = "water";
    const m = matchOn(bundle, b, 0, "flour", size);
    expect(m).not.toBeNull();
    expect(m!.recipe.out).toBe("dough");
    // Group includes the target cell.
    expect(m!.cells.includes(0)).toBe(true);
  });

  it("returns null when target doesn't match", () => {
    const b: Board = Array(25).fill(null);
    b[0] = "oven";
    expect(matchOn(bundle, b, 0, "flour", size)).toBeNull();
  });

  it("returns null when dropping the same item on itself", () => {
    const b: Board = Array(25).fill(null);
    b[0] = "flour";
    expect(matchOn(bundle, b, 0, "flour", size)).toBeNull();
  });

  it("returns null when dropping on an empty cell", () => {
    const b: Board = Array(25).fill(null);
    expect(matchOn(bundle, b, 0, "flour", size)).toBeNull();
  });
});

describe("playsInOne / playsInTwo", () => {
  const size = 5;
  const bundle = fakeBundle([R("dough", ["flour", "water"])]);

  it("playsInOne: tray tile combines with existing board tile", () => {
    const b: Board = Array(25).fill(null);
    b[0] = "water";
    expect(playsInOne(bundle, b, ["flour", null, null], size)).toBe(true);
  });

  it("playsInOne: false when nothing combines", () => {
    const b: Board = Array(25).fill(null);
    b[0] = "water";
    expect(playsInOne(bundle, b, ["cheese", null, null], size)).toBe(false);
  });

  it("playsInTwo: two tray tiles make something when placed adjacent", () => {
    const b: Board = Array(25).fill(null);
    expect(playsInTwo(bundle, b, ["flour", "water", null], size)).toBe(true);
  });

  it("playsInTwo: false when tray can't form a recipe", () => {
    const b: Board = Array(25).fill(null);
    expect(playsInTwo(bundle, b, ["cheese", "milk", null], size)).toBe(false);
  });
});

describe("integration with live bundle", () => {
  const snap = buildSnapshot(toRows(loadKnowledgeBase()));
  const bundle = buildThemeBundle(snap, "everything");
  const size = 5;

  it("matches a known recipe end-to-end", () => {
    // Pick a small recipe to test. "wheel" from steel + wood is a
    // plausible 2-ingredient recipe; we probe the bundle for one.
    const smallRecipe = bundle.recipes.find((r) => r.all.length === 2);
    expect(smallRecipe).toBeDefined();
    const [p, q] = smallRecipe!.all;
    const b: Board = Array(25).fill(null);
    b[0] = p;
    b[1] = q;
    const m = matchAt(bundle, b, 0, p, size);
    expect(m).not.toBeNull();
    // The result may be a bigger recipe that also fits (p + q + something
    // that happens not to be on the board) — matchAt prefers bigger. But
    // for an empty board the only recipe that can form is a 2-ingredient
    // one. So the matched recipe must have all its parts present.
    for (const partId of m!.recipe.all) {
      expect([p, q]).toContain(partId);
    }
  });
});
