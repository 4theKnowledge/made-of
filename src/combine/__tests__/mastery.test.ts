import { describe, expect, it } from "vitest";
import {
  computeMastery,
  computePreview,
} from "../../components/combine/board-parts/types";
import type { CombineRecipe, ThemeBundle } from "../types";
import type { GameState } from "../engine";

/** Hand-rolled bundle so mastery/preview tests can assert exact shapes
 *  without depending on live knowledge-base content. */
function fakeBundle(
  recipes: CombineRecipe[],
  base: string[] = [],
): ThemeBundle {
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
  const sameIngredients = new Map<string, CombineRecipe[]>();
  for (const r of recipes) {
    const key = [...r.all].sort().join("+");
    const cur = sameIngredients.get(key) ?? [];
    cur.push(r);
    sameIngredients.set(key, cur);
  }
  return {
    theme: { k: "everything", name: "Test", desc: "", ages: ["one"] },
    recipes,
    byIngredient,
    outputs: new Set(recipes.map((r) => r.out)),
    ingredients: new Set(recipes.flatMap((r) => r.all)),
    base,
    mid: [],
    tools: new Set(),
    terminal: new Set(),
    sameIngredients,
    items: new Map(),
    outBand: new Map(recipes.map((r) => [r.out, r.band])),
  };
}

const R = (out: string, all: string[]): CombineRecipe => ({
  out,
  from: all,
  with: [],
  needs: [],
  evolved: [],
  all,
  lvl: 1,
  band: 1,
});

const sig = (all: string[]) => [...all].sort().join("+");

describe("computeMastery", () => {
  it("items with no known-ingredient recipes report available=0 and are not mastered", () => {
    const bundle = fakeBundle([R("z", ["unknown-a", "unknown-b"])], []);
    const m = computeMastery(bundle, "z", new Set(), new Set());
    expect(m).toEqual({ made: 0, available: 0, mastered: false });
  });

  it("single known-ingredient variant, made, is mastered (made=1, available=1)", () => {
    const bundle = fakeBundle([R("z", ["a", "b"])], ["a", "b"]);
    const m = computeMastery(
      bundle,
      "z",
      new Set(["a", "b"]),
      new Set([sig(["a", "b"])]),
    );
    expect(m).toEqual({ made: 1, available: 1, mastered: true });
  });

  it("multiple variants, player made one of them → partial, not mastered", () => {
    const bundle = fakeBundle(
      [R("z", ["a", "b"]), R("z", ["c", "d"]), R("z", ["e", "f"])],
      ["a", "b", "c", "d", "e", "f"],
    );
    const m = computeMastery(
      bundle,
      "z",
      new Set(["a", "b", "c", "d", "e", "f"]),
      new Set([sig(["a", "b"])]),
    );
    expect(m).toEqual({ made: 1, available: 3, mastered: false });
  });

  it("variants with unknown ingredients drop out of the denominator", () => {
    // Player knows only {a,b}. c and d are made-things (not base), so the
    // variant that needs them is invisible until they're in the collection.
    // Even one made recipe masters the item from the player's PoV.
    const bundle = fakeBundle(
      [R("z", ["a", "b"]), R("z", ["c", "d"])],
      ["a", "b"], // c, d are made — not base
    );
    const m = computeMastery(
      bundle,
      "z",
      new Set(["a", "b"]), // c, d not known
      new Set([sig(["a", "b"])]),
    );
    expect(m).toEqual({ made: 1, available: 1, mastered: true });
  });

  it("variants with base ingredients always count as available (base ⊂ known)", () => {
    const bundle = fakeBundle(
      [R("z", ["a", "b"])],
      ["a", "b"], // both in base
    );
    const m = computeMastery(bundle, "z", new Set(), new Set());
    // Base ingredients are considered known even when the known set is empty.
    expect(m).toEqual({ made: 0, available: 1, mastered: false });
  });

  it("alt-output recipes sharing a signature collapse to one variant", () => {
    // Two outputs from same ingredient set — we're asking about z.
    const bundle = fakeBundle(
      [R("z", ["a", "b"]), R("y", ["a", "b"])],
      ["a", "b"],
    );
    const m = computeMastery(
      bundle,
      "z",
      new Set(["a", "b"]),
      new Set([sig(["a", "b"])]),
    );
    // Only the z-producing recipe counts for z's mastery.
    expect(m).toEqual({ made: 1, available: 1, mastered: true });
  });

  it("partial-mastery becomes full-mastery when the final variant is made", () => {
    const bundle = fakeBundle(
      [R("z", ["a", "b"]), R("z", ["c", "d"])],
      ["a", "b", "c", "d"],
    );
    const partial = computeMastery(
      bundle,
      "z",
      new Set(["a", "b", "c", "d"]),
      new Set([sig(["a", "b"])]),
    );
    expect(partial.mastered).toBe(false);
    const full = computeMastery(
      bundle,
      "z",
      new Set(["a", "b", "c", "d"]),
      new Set([sig(["a", "b"]), sig(["c", "d"])]),
    );
    expect(full).toEqual({ made: 2, available: 2, mastered: true });
  });
});

describe("computePreview — truthful +N (only counts known alts)", () => {
  // Build a 2×2 board with three alt-output recipes sharing the same
  // ingredient signature {a,b}: z, y, x. The player is dragging "a" onto
  // an empty cell adjacent to "b".
  const recipes = [R("z", ["a", "b"]), R("y", ["a", "b"]), R("x", ["a", "b"])];
  const bundle = fakeBundle(recipes, ["a", "b"]);
  // Minimal GameState shape used by computePreview — only fields it reads.
  const baseState: Partial<GameState> = {
    mode: "classic",
    board: ["b", null, null, null],
    tray: ["a", null, null],
    hold: [null],
    found: [],
    n: 2,
  };

  it("badge counts only known alternatives (1 known of 3 → no +N)", () => {
    const preview = computePreview(
      bundle,
      { ...baseState, found: ["z"] } as GameState,
      { source: "tray", slot: 0 },
      [], // extraKnown empty
    );
    // Cell 1 (adjacent to b at cell 0) should preview z with n=1.
    const entry = preview.get(1);
    expect(entry).toBeDefined();
    expect(entry!.out).toBe("z");
    expect(entry!.n).toBe(1);
  });

  it("badge counts 2 when the player knows 2 of 3 alternatives", () => {
    const preview = computePreview(
      bundle,
      { ...baseState, found: ["z", "y"] } as GameState,
      { source: "tray", slot: 0 },
      [],
    );
    const entry = preview.get(1);
    expect(entry).toBeDefined();
    // The ghost shows whichever known alt is listed first (determined by
    // altsOf order); n should count both known alts.
    expect(entry!.n).toBe(2);
    expect(["z", "y"]).toContain(entry!.out);
  });

  it("no preview entry when the recipe matches but no alt is known (no leak)", () => {
    const preview = computePreview(
      bundle,
      { ...baseState, found: [] } as GameState,
      { source: "tray", slot: 0 },
      [],
    );
    // Previously would have been `{n: 3}` with no ghost; now cell stays dark
    // entirely so the player doesn't learn "something happens here" by
    // dragging. (The `?` ghost option moved to a follow-up.)
    expect(preview.get(1)).toBeUndefined();
  });

  it("extraKnown (lifetime collection) counts toward the badge", () => {
    const preview = computePreview(
      bundle,
      { ...baseState, found: [] } as GameState,
      { source: "tray", slot: 0 },
      ["z", "x"], // lifetime collection
    );
    const entry = preview.get(1);
    expect(entry).toBeDefined();
    expect(entry!.n).toBe(2);
  });
});
