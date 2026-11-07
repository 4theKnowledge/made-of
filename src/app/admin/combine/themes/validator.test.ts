import { describe, it, expect } from "vitest";
import { validateTheme, type ValidatorInput } from "./validator";

function run(input: ValidatorInput) {
  return validateTheme(input);
}

describe("validateTheme", () => {
  it("accepts a theme where every item is reachable from base", () => {
    const result = run({
      items: [
        { id: "a", name: "a", isCombineExcluded: false },
        { id: "b", name: "b", isCombineExcluded: false },
        { id: "c", name: "c", isCombineExcluded: false },
      ],
      recipes: [
        { id: "r1", itemId: "c", parts: ["a", "b"] },
      ],
      themeMembers: new Set(["a", "b", "c"]),
    });
    expect(result.broken).toHaveLength(0);
    // a and b are dealt-base (ingredients of r1, not outputs); c is built.
    expect(result.buildableCount).toBe(3);
    expect(result.baseCount).toBe(2);
  });

  it("flags an item whose recipe needs a non-theme ingredient", () => {
    const result = run({
      items: [
        { id: "a", name: "a", isCombineExcluded: false },
        { id: "b", name: "b", isCombineExcluded: false },
        { id: "sink", name: "sink", isCombineExcluded: false },
        { id: "outside", name: "outside", isCombineExcluded: false },
      ],
      recipes: [
        { id: "r1", itemId: "b", parts: ["a", "outside"] }, // broken: outside not in theme
        { id: "r2", itemId: "sink", parts: ["a"] }, // keeps 'a' usable as base
      ],
      themeMembers: new Set(["a", "b", "sink"]),
    });
    expect(result.broken).toHaveLength(1);
    const broken = result.broken[0];
    expect(broken.itemId).toBe("b");
    expect(broken.reason.kind).toBe("unreachable");
    if (broken.reason.kind === "unreachable") {
      expect(broken.reason.missingDeps).toEqual(["outside"]);
    }
  });

  it("prefers the recipe with the fewest missing deps for the error message", () => {
    const result = run({
      items: [
        { id: "a", name: "a", isCombineExcluded: false },
        { id: "x", name: "x", isCombineExcluded: false },
        { id: "y", name: "y", isCombineExcluded: false },
        { id: "target", name: "target", isCombineExcluded: false },
      ],
      recipes: [
        { id: "r1", itemId: "target", parts: ["x", "y"] },
        { id: "r2", itemId: "target", parts: ["a", "x"] },
      ],
      themeMembers: new Set(["a", "target"]),
    });
    const broken = result.broken.find((b) => b.itemId === "target");
    expect(broken).toBeDefined();
    if (broken && broken.reason.kind === "unreachable") {
      // r2 misses only "x"; r1 misses two.
      expect(broken.reason.missingDeps).toEqual(["x"]);
    }
  });

  it("closes transitively: a→b→c where each step is in-theme", () => {
    const result = run({
      items: [
        { id: "a", name: "a", isCombineExcluded: false },
        { id: "b", name: "b", isCombineExcluded: false },
        { id: "c", name: "c", isCombineExcluded: false },
      ],
      recipes: [
        { id: "r1", itemId: "b", parts: ["a"] },
        { id: "r2", itemId: "c", parts: ["b"] },
      ],
      themeMembers: new Set(["a", "b", "c"]),
    });
    expect(result.broken).toHaveLength(0);
    expect(result.buildableCount).toBe(3);
  });

  it("flags an item that is both in the theme and isCombineExcluded", () => {
    const result = run({
      items: [{ id: "a", name: "a", isCombineExcluded: true }],
      recipes: [],
      themeMembers: new Set(["a"]),
    });
    expect(result.broken[0]?.reason.kind).toBe("excluded-and-member");
  });

  it("treats n and e parts as combinable (same as runtime)", () => {
    // The runtime's isPlayableRecipe/collectRecipeParts considers all four
    // link types; the validator receives the already-assembled parts list,
    // so what matters here is that the loader passes n/e-based parts
    // through. Simulate that: a recipe whose parts come from a `needs`
    // link in the DB must still make its owner buildable.
    const result = run({
      items: [
        { id: "sun", name: "sun", isCombineExcluded: false },
        { id: "plant", name: "plant", isCombineExcluded: false },
      ],
      // `plant` needs `sun` — upstream loader collapsed f/w/n/e into parts.
      recipes: [{ id: "r1", itemId: "plant", parts: ["sun"] }],
      themeMembers: new Set(["sun", "plant"]),
    });
    expect(result.broken).toHaveLength(0);
    expect(result.buildableCount).toBe(2);
  });

  it("flags an isolated member (nothing uses it, no recipe produces it)", () => {
    // 'orphan' isn't an output of any surviving recipe and isn't an
    // ingredient of any surviving recipe. The runtime would silently skip
    // it — reporting as broken is correct.
    const result = run({
      items: [
        { id: "a", name: "a", isCombineExcluded: false },
        { id: "b", name: "b", isCombineExcluded: false },
        { id: "orphan", name: "orphan", isCombineExcluded: false },
      ],
      recipes: [
        { id: "r1", itemId: "b", parts: ["a"] },
      ],
      themeMembers: new Set(["a", "b", "orphan"]),
    });
    const brokenIds = result.broken.map((b) => b.itemId);
    expect(brokenIds).toContain("orphan");
  });

  it("members with non-in-theme recipes are treated as dealt-base", () => {
    // Case: 'carbon' has a recipe in the DB (comes from stars) but neither
    // 'star' nor any of carbon's recipe parts are in the biology theme.
    // Carbon IS an ingredient of 'amino_acids' in-theme. Runtime deals
    // carbon directly; validator should mirror that.
    const result = run({
      items: [
        { id: "carbon", name: "carbon", isCombineExcluded: false },
        { id: "amino_acids", name: "amino_acids", isCombineExcluded: false },
        { id: "star", name: "star", isCombineExcluded: false },
      ],
      recipes: [
        { id: "r1", itemId: "carbon", parts: ["star"] }, // star NOT in theme → recipe dropped
        { id: "r2", itemId: "amino_acids", parts: ["carbon"] }, // all in theme → survives
      ],
      themeMembers: new Set(["carbon", "amino_acids"]),
    });
    expect(result.broken).toHaveLength(0);
    expect(result.baseCount).toBe(1); // carbon
    expect(result.buildableCount).toBe(2);
  });
});
