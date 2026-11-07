import { describe, it, expect } from "vitest";
import {
  collectRecipeParts,
  isCombinableLinkType,
  isPlayableRecipe,
} from "../parts";

describe("isCombinableLinkType", () => {
  it("accepts f, w, n, e", () => {
    for (const t of ["f", "w", "n", "e"]) expect(isCombinableLinkType(t)).toBe(true);
  });
  it("rejects s and unknowns", () => {
    expect(isCombinableLinkType("s")).toBe(false);
    expect(isCombinableLinkType("x")).toBe(false);
    expect(isCombinableLinkType("")).toBe(false);
  });
});

describe("collectRecipeParts", () => {
  it("includes all four recipe-scoped link types", () => {
    const { all, hadSelfRef } = collectRecipeParts(
      [
        { type: "f", targetId: "a" },
        { type: "w", targetId: "b" },
        { type: "n", targetId: "c" },
        { type: "e", targetId: "d" },
      ],
      "out",
    );
    expect(hadSelfRef).toBe(false);
    expect(all.sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("drops the item's self-reference and flags hadSelfRef", () => {
    const { all, hadSelfRef } = collectRecipeParts(
      [
        { type: "f", targetId: "paper" },
        { type: "f", targetId: "water" },
      ],
      "paper",
    );
    expect(hadSelfRef).toBe(true);
    expect(all).toEqual(["water"]);
  });

  it("ignores non-combinable types like s (comes-from)", () => {
    const { all } = collectRecipeParts(
      [
        { type: "s", targetId: "lab" },
        { type: "f", targetId: "a" },
      ],
      "out",
    );
    expect(all).toEqual(["a"]);
  });

  it("dedups repeated parts", () => {
    const { all } = collectRecipeParts(
      [
        { type: "f", targetId: "a" },
        { type: "w", targetId: "a" },
      ],
      "out",
    );
    expect(all).toEqual(["a"]);
  });
});

describe("isPlayableRecipe", () => {
  it("keeps 1-input recipes (promote action)", () => {
    expect(isPlayableRecipe({ all: ["a"], hadSelfRef: false })).toBe(true);
  });
  it("keeps 2–7 part recipes", () => {
    for (let n = 2; n <= 7; n++) {
      const parts = Array.from({ length: n }, (_, i) => `p${i}`);
      expect(isPlayableRecipe({ all: parts, hadSelfRef: false })).toBe(true);
    }
  });
  it("rejects 0-part and >7-part recipes", () => {
    expect(isPlayableRecipe({ all: [], hadSelfRef: false })).toBe(false);
    expect(
      isPlayableRecipe({ all: ["a", "b", "c", "d", "e", "f", "g", "h"], hadSelfRef: false }),
    ).toBe(false);
  });
  it("rejects self-ref collapses to <2 parts", () => {
    expect(isPlayableRecipe({ all: ["water"], hadSelfRef: true })).toBe(false);
  });
  it("keeps self-ref recipes that still have >=2 parts", () => {
    expect(isPlayableRecipe({ all: ["water", "pulp"], hadSelfRef: true })).toBe(true);
  });
});
