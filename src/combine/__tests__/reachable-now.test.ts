import { describe, expect, it } from "vitest";
import { reachableNow } from "../progression";
import type { CombineRecipe, ThemeBundle } from "../types";

function fakeBundle(recipes: CombineRecipe[], base: string[] = []): ThemeBundle {
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
  return {
    theme: {
      k: "test",
      name: "Test",
      desc: "",
      ages: ["one"],
      collectionVersion: 0,
    },
    recipes,
    byIngredient,
    outputs: new Set(recipes.map((r) => r.out)),
    ingredients: new Set(recipes.flatMap((r) => r.all)),
    base,
    mid: [],
    tools: new Set(),
    terminal: new Set(),
    sameIngredients: new Map(),
    items: new Map(),
    outBand: new Map(recipes.map((r) => [r.out, r.band])),
  };
}

const R = (out: string, all: string[], band = 1): CombineRecipe => ({
  id: `test-${out}-${all.join("+")}`,
  out,
  from: all,
  with: [],
  needs: [],
  evolved: [],
  all,
  lvl: band,
  band,
});

describe("reachableNow", () => {
  it("returns recipes whose ingredients are all on the board", () => {
    const bundle = fakeBundle([R("wood", ["stick", "stick"]), R("fire", ["stick", "stone"])], [
      "stick",
      "stone",
    ]);
    const board = ["stick", "stick", null, null];
    const got = reachableNow(bundle, board, [null, null, null], [null, null], []);
    expect(got.map((r) => r.out)).toEqual(["wood"]);
  });

  it("is multiset-aware (needs two stick for wood)", () => {
    const bundle = fakeBundle([R("wood", ["stick", "stick"])], ["stick"]);
    // Only one stick on the board → not reachable
    const only1 = reachableNow(bundle, ["stick"], [null, null, null], [null, null], []);
    expect(only1).toHaveLength(0);
    // Two sticks (board + tray) → reachable
    const both = reachableNow(bundle, ["stick"], ["stick", null, null], [null, null], []);
    expect(both.map((r) => r.out)).toEqual(["wood"]);
  });

  it("counts tiles across board, tray, and hold", () => {
    const bundle = fakeBundle([R("fire", ["stick", "stone"])], ["stick", "stone"]);
    const got = reachableNow(bundle, ["stick"], [null, null, null], ["stone"], []);
    expect(got.map((r) => r.out)).toEqual(["fire"]);
  });

  it("excludes recipes whose ingredients aren't yet known (reachable gate)", () => {
    // 'ember' is not a base ingredient and hasn't been discovered → the
    // recipe 'flame = ember+ember' is NOT reachable even if two embers
    // somehow showed up on the board (the pool wouldn't contain it).
    const bundle = fakeBundle([R("flame", ["ember", "ember"])], ["stick"]);
    const got = reachableNow(bundle, ["ember", "ember"], [null, null, null], [null, null], []);
    expect(got).toHaveLength(0);
  });

  it("returns empty when inventory is empty", () => {
    const bundle = fakeBundle([R("wood", ["stick", "stick"])], ["stick"]);
    const got = reachableNow(
      bundle,
      [null, null, null, null],
      [null, null, null],
      [null, null],
      [],
    );
    expect(got).toHaveLength(0);
  });
});
