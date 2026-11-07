import { describe, it, expect } from "vitest";
import { computeClosure, isClosureEnabled, type ClosureItem, type ClosureRecipe } from "../closure";

function it_(
  id: string,
  tier = "C",
  tags: string[] = [],
  excluded = false,
  kind = "stuff",
): ClosureItem {
  return { id, tier, kind, tags, isCombineExcluded: excluded };
}
function rc(id: string, itemId: string, parts: string[], partTypes?: ("f" | "w" | "n" | "e")[]): ClosureRecipe {
  return { id, itemId, parts, partTypes };
}

describe("isClosureEnabled", () => {
  it("null/undefined = off", () => {
    expect(isClosureEnabled(null)).toBe(false);
    expect(isClosureEnabled(undefined)).toBe(false);
  });
  it("empty object = on (defaults)", () => {
    expect(isClosureEnabled({})).toBe(true);
  });
  it("any set field = on", () => {
    expect(isClosureEnabled({ stopAtTiers: ["F"] })).toBe(true);
    expect(isClosureEnabled({ maxDepth: 2 })).toBe(true);
  });
});

describe("computeClosure", () => {
  it("adds direct ingredients", () => {
    const items = [it_("bread"), it_("flour"), it_("water")];
    const recipes = [rc("r1", "bread", ["flour", "water"])];
    const { members, added } = computeClosure({ items, recipes, seeds: ["bread"], config: {} });
    expect(members).toEqual(new Set(["bread", "flour", "water"]));
    expect(added).toEqual(["flour", "water"]);
  });

  it("chains transitively to true primitives", () => {
    const items = [it_("c", "C"), it_("b", "M"), it_("a", "F"), it_("x", "F")];
    const recipes = [
      rc("r1", "c", ["b"]),
      rc("r2", "b", ["a", "x"]),
    ];
    const { members } = computeClosure({ items, recipes, seeds: ["c"], config: {} });
    expect(members).toEqual(new Set(["c", "b", "a", "x"]));
  });

  it("stopAtTiers: adds tier-F items as members but doesn't recurse into them", () => {
    const items = [
      it_("bread", "C"),
      it_("flour", "M"),
      it_("wheat", "N"),
      it_("sun", "F"),
      it_("soil", "F"),
    ];
    const recipes = [
      rc("r1", "bread", ["flour"]),
      rc("r2", "flour", ["wheat"]),
      rc("r3", "wheat", ["sun", "soil"]),
      rc("r4", "sun", ["helium_that_should_not_be_pulled"]),
    ];
    const res = computeClosure({ items, recipes, seeds: ["bread"], config: { stopAtTiers: ["F"] } });
    expect(res.members).toEqual(new Set(["bread", "flour", "wheat", "sun", "soil"]));
    expect(res.stoppedAt).toEqual(["soil", "sun"]);
  });

  it("stopAtKinds: kind match stops recursion", () => {
    const items = [
      it_("egg", "C", [], false, "food"),
      it_("chicken", "N", [], false, "animal"),
      it_("feed", "N", [], false, "food"),
    ];
    const recipes = [
      { id: "r1", itemId: "egg", parts: ["chicken"] },
      { id: "r2", itemId: "chicken", parts: ["feed"] },
    ];
    const res = computeClosure({ items, recipes, seeds: ["egg"], config: { stopAtKinds: ["animal"] } });
    expect(res.members).toEqual(new Set(["egg", "chicken"]));
    expect(res.stoppedAt).toEqual(["chicken"]);
  });

  it("stopAtTags: tag match stops recursion", () => {
    const items = [
      it_("x", "C"),
      it_("y", "C", ["primitive"]),
      it_("z", "C"),
    ];
    const recipes = [
      rc("r1", "x", ["y"]),
      rc("r2", "y", ["z"]),
    ];
    const res = computeClosure({ items, recipes, seeds: ["x"], config: { stopAtTags: ["primitive"] } });
    expect(res.members).toEqual(new Set(["x", "y"]));
    expect(res.stoppedAt).toEqual(["y"]);
  });

  it("isCombineExcluded parts are skipped entirely and reported", () => {
    const items = [it_("a"), it_("b"), it_("bad", "C", [], true)];
    const recipes = [rc("r1", "a", ["b", "bad"])];
    const res = computeClosure({ items, recipes, seeds: ["a"], config: {} });
    expect(res.members).toEqual(new Set(["a", "b"]));
    expect(res.blockedByExcluded).toEqual(["bad"]);
  });

  it("excluded seed is itself skipped", () => {
    const items = [it_("bad", "C", [], true), it_("ok")];
    const recipes = [rc("r1", "bad", ["ok"])];
    const res = computeClosure({ items, recipes, seeds: ["bad", "ok"], config: {} });
    expect(res.members).toEqual(new Set(["ok"]));
    expect(res.blockedByExcluded).toEqual(["bad"]);
  });

  it("maxDepth caps recursion", () => {
    const items = [it_("a"), it_("b"), it_("c"), it_("d")];
    const recipes = [
      rc("r1", "a", ["b"]),
      rc("r2", "b", ["c"]),
      rc("r3", "c", ["d"]),
    ];
    const res = computeClosure({ items, recipes, seeds: ["a"], config: { maxDepth: 1 } });
    // a (depth 0) walks → adds b (depth 1). b hits depth cap, doesn't walk.
    expect(res.members).toEqual(new Set(["a", "b"]));
    expect(res.stoppedAt).toContain("b");
  });

  it("maxDepth=0 means seeds only", () => {
    const items = [it_("a"), it_("b")];
    const recipes = [rc("r1", "a", ["b"])];
    const res = computeClosure({ items, recipes, seeds: ["a"], config: { maxDepth: 0 } });
    expect(res.members).toEqual(new Set(["a"]));
    expect(res.stoppedAt).toContain("a");
  });

  it("followLinkTypes filters which recipe parts the closure follows", () => {
    const items = [it_("cake"), it_("flour"), it_("oven")];
    // cake made from flour (f) with oven (w). Follow only 'f' → skip oven.
    const recipes = [rc("r1", "cake", ["flour", "oven"], ["f", "w"])];
    const res = computeClosure({ items, recipes, seeds: ["cake"], config: { followLinkTypes: ["f"] } });
    expect(res.members).toEqual(new Set(["cake", "flour"]));
  });

  it("stop rules don't apply to seeds (author-added is always walked)", () => {
    // Author adds 'sun' (tier F) directly. Even with stopAtTiers=['F'],
    // sun should still have its own recipes walked once because it's a seed.
    const items = [it_("sun", "F"), it_("helium", "F")];
    const recipes = [rc("r1", "sun", ["helium"])];
    const res = computeClosure({ items, recipes, seeds: ["sun"], config: { stopAtTiers: ["F"] } });
    expect(res.members).toEqual(new Set(["sun", "helium"]));
    // helium was added via recursion, matches stop rule → recorded.
    expect(res.stoppedAt).toContain("helium");
  });

  it("union of all playable recipes — follows every recipe not just cheapest", () => {
    const items = [it_("x"), it_("a"), it_("b"), it_("c")];
    // x has two recipes: {a,b} and {a,c}. Both walked.
    const recipes = [rc("r1", "x", ["a", "b"]), rc("r2", "x", ["a", "c"])];
    const res = computeClosure({ items, recipes, seeds: ["x"], config: {} });
    expect(res.members).toEqual(new Set(["x", "a", "b", "c"]));
  });

  it("deterministic output: added list is sorted", () => {
    const items = [it_("x"), it_("zebra"), it_("alpha"), it_("mango")];
    const recipes = [rc("r1", "x", ["zebra", "alpha", "mango"])];
    const res = computeClosure({ items, recipes, seeds: ["x"], config: {} });
    expect(res.added).toEqual(["alpha", "mango", "zebra"]);
  });

  it("handles cycles without infinite loop", () => {
    const items = [it_("a"), it_("b")];
    // a needs b, b needs a (only possible if authored, but validator-level
    // check doesn't prevent this; closure must terminate).
    const recipes = [rc("r1", "a", ["b"]), rc("r2", "b", ["a"])];
    const res = computeClosure({ items, recipes, seeds: ["a"], config: {} });
    expect(res.members).toEqual(new Set(["a", "b"]));
  });

  it("drops self-ref parts (a's recipe listing a as part)", () => {
    const items = [it_("a"), it_("b")];
    const recipes = [rc("r1", "a", ["a", "b"])]; // pre-validated upstream, but defensive
    const res = computeClosure({ items, recipes, seeds: ["a"], config: {} });
    expect(res.members).toEqual(new Set(["a", "b"]));
  });

  it("missing-item references are ignored (loader filtered them out)", () => {
    const items = [it_("a")];
    const recipes = [rc("r1", "a", ["ghost"])];
    const res = computeClosure({ items, recipes, seeds: ["a"], config: {} });
    expect(res.members).toEqual(new Set(["a"]));
  });
});
