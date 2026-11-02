import { describe, expect, it } from "vitest";
import { deriveNumAges } from "../data";

describe("deriveNumAges", () => {
  it("floors at MIN_AGES=3 once the KB can support it", () => {
    expect(deriveNumAges(10, 0)).toBe(3);
    expect(deriveNumAges(50, 0)).toBe(3); // byVolume=2, floor=3
    expect(deriveNumAges(74, 0)).toBe(3); // just below 3 * RECIPES_PER_AGE
  });

  it("grows by one age roughly every RECIPES_PER_AGE=25 recipes", () => {
    expect(deriveNumAges(75, 0)).toBe(3);
    expect(deriveNumAges(100, 0)).toBe(4);
    expect(deriveNumAges(125, 0)).toBe(5);
    expect(deriveNumAges(150, 0)).toBe(6);
    expect(deriveNumAges(250, 0)).toBe(10);
  });

  it("is monotonic: never returns less than prevNumAges", () => {
    expect(deriveNumAges(10, 6)).toBe(6);
    expect(deriveNumAges(0, 8)).toBe(8);
    expect(deriveNumAges(100, 10)).toBe(10);
  });

  it("ticks up by one when the formula overtakes prevNumAges", () => {
    expect(deriveNumAges(124, 4)).toBe(4);
    expect(deriveNumAges(125, 4)).toBe(5);
    expect(deriveNumAges(126, 4)).toBe(5);
  });

  it("sparse-frontier guard: never fabricate ages thinner than MIN_RECIPES_PER_AGE=3", () => {
    // Floor is MIN_AGES=3, but the guard overrides the floor when the KB is
    // too small to populate 3 ages at ≥3 recipes each.
    expect(deriveNumAges(0, 0)).toBe(0); // empty KB
    expect(deriveNumAges(2, 0)).toBe(0); // can't even fill one age
    expect(deriveNumAges(3, 0)).toBe(1); // enough for one age only
    expect(deriveNumAges(5, 0)).toBe(1); // guard still caps below MIN_AGES
    expect(deriveNumAges(6, 0)).toBe(2);
    expect(deriveNumAges(9, 0)).toBe(3); // first time floor can land
    expect(deriveNumAges(10, 0)).toBe(3); // byVolume=0, guard=3, floor=3
  });

  it("stays stable within a band of recipe counts", () => {
    // Everything is currently near this range; it shouldn't flicker on each
    // single-recipe addition.
    const counts = [100, 101, 102, 110, 115, 120, 124];
    for (const c of counts) expect(deriveNumAges(c, 4)).toBe(4);
  });
});
