import { describe, it, expect } from "vitest";
import { validateTheme, type ValidatorInput } from "./validator";

function run(input: ValidatorInput) {
  return validateTheme(input);
}

describe("validateTheme", () => {
  it("accepts a theme where every item is reachable from base", () => {
    const result = run({
      items: [
        { id: "a", name: "a", tags: [] },
        { id: "b", name: "b", tags: [] },
        { id: "c", name: "c", tags: [] },
      ],
      recipes: [
        { id: "r1", itemId: "c", parts: ["a", "b"] },
      ],
      themeMembers: new Set(["a", "b", "c"]),
    });
    expect(result.broken).toHaveLength(0);
    expect(result.buildableCount).toBe(3);
    expect(result.baseCount).toBe(2);
  });

  it("flags an item whose recipe needs a non-theme ingredient", () => {
    const result = run({
      items: [
        { id: "a", name: "a", tags: [] },
        { id: "b", name: "b", tags: [] },
        { id: "outside", name: "outside", tags: [] },
      ],
      recipes: [
        { id: "r1", itemId: "b", parts: ["a", "outside"] },
      ],
      themeMembers: new Set(["a", "b"]),
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
        { id: "a", name: "a", tags: [] },
        { id: "x", name: "x", tags: [] },
        { id: "y", name: "y", tags: [] },
        { id: "target", name: "target", tags: [] },
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
        { id: "a", name: "a", tags: [] },
        { id: "b", name: "b", tags: [] },
        { id: "c", name: "c", tags: [] },
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

  it("flags an item that is both in the theme and tagged combine-exclude", () => {
    const result = run({
      items: [{ id: "a", name: "a", tags: ["combine-exclude"] }],
      recipes: [],
      themeMembers: new Set(["a"]),
    });
    expect(result.broken[0]?.reason.kind).toBe("excluded-and-member");
  });

  it("warns on an orphan base ingredient nothing in the theme uses", () => {
    const result = run({
      items: [
        { id: "a", name: "a", tags: [] },
        { id: "b", name: "b", tags: [] },
        { id: "orphan", name: "orphan", tags: [] },
      ],
      recipes: [
        { id: "r1", itemId: "b", parts: ["a"] },
      ],
      themeMembers: new Set(["a", "b", "orphan"]),
    });
    expect(result.broken).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].itemId).toBe("orphan");
  });
});
