import { describe, expect, it } from "vitest";
import { buildPlan } from "../plan";
import type { BulkPack, KbIndex } from "../types";

function kb(partial?: Partial<KbIndex>): KbIndex {
  return {
    itemByName: new Map(),
    itemBySlug: new Map(),
    existingSourceCodes: new Set(),
    existingKindCodes: new Set(["element", "mineral", "object", "cosmic"]),
    ...partial,
  };
}

function pack(partial?: Partial<BulkPack>): BulkPack {
  return {
    items: [],
    evidenceLinks: [],
    sources: {},
    ...partial,
  };
}

describe("buildPlan — schema validation", () => {
  it("rejects an unknown tier", () => {
    const plan = buildPlan(
      pack({
        items: [{ name: "foo", tier: "Z" as never, kind: "element" }],
      }),
      kb(),
    );
    expect(plan.issues.find((i) => i.code === "item_bad_tier")).toBeDefined();
    expect(plan.items).toHaveLength(0);
  });

  it("rejects an unknown kind", () => {
    const plan = buildPlan(
      pack({
        items: [{ name: "foo", tier: "N", kind: "zzz-not-a-kind" }],
      }),
      kb(),
    );
    expect(plan.issues.find((i) => i.code === "item_bad_kind")).toBeDefined();
    expect(plan.items).toHaveLength(0);
  });

  it("rejects an `s` key in a recipe (s is item-level only)", () => {
    const plan = buildPlan(
      pack({
        items: [
          {
            name: "foo",
            tier: "N",
            kind: "element",
            recipes: [{ f: ["hydrogen"], s: ["earth"] } as never],
          },
        ],
      }),
      kb({
        itemByName: new Map([
          ["hydrogen", { id: "h1", slug: "hydrogen", name: "hydrogen" }],
          ["earth", { id: "e1", slug: "earth", name: "earth" }],
        ]),
      }),
    );
    expect(
      plan.issues.find((i) => i.code === "recipe_has_item_level_link"),
    ).toBeDefined();
  });

  it("rejects a malformed evidence id", () => {
    const plan = buildPlan(
      pack({
        evidenceLinks: [
          { ids: ["not-a-valid-id"], confidence: "established" },
        ],
      }),
      kb(),
    );
    expect(plan.issues.find((i) => i.code === "evidence_bad_id")).toBeDefined();
  });
});

describe("buildPlan — intra-pack validation", () => {
  it("flags duplicate names in the pack", () => {
    const plan = buildPlan(
      pack({
        items: [
          { name: "foo", tier: "N", kind: "element" },
          { name: "foo", tier: "N", kind: "element" },
        ],
      }),
      kb(),
    );
    expect(
      plan.issues.find((i) => i.code === "duplicate_name_in_pack"),
    ).toBeDefined();
  });

  it("flags unresolved recipe ingredients", () => {
    const plan = buildPlan(
      pack({
        items: [
          {
            name: "foo",
            tier: "N",
            kind: "element",
            recipes: [{ f: ["ghost ingredient"] }],
          },
        ],
      }),
      kb(),
    );
    expect(
      plan.issues.find((i) => i.code === "unresolved_recipe_ingredient"),
    ).toBeDefined();
  });

  it("resolves recipe ingredients against other pack items", () => {
    const plan = buildPlan(
      pack({
        items: [
          { name: "atom", tier: "N", kind: "element" },
          {
            name: "molecule",
            tier: "N",
            kind: "element",
            recipes: [{ f: ["atom"] }],
          },
        ],
      }),
      kb(),
    );
    expect(
      plan.issues.find((i) => i.code === "unresolved_recipe_ingredient"),
    ).toBeUndefined();
  });

  it("flags unknown source codes referenced by evidence", () => {
    const plan = buildPlan(
      pack({
        evidenceLinks: [
          {
            ids: ["foo<f<bar"],
            confidence: "established",
            evidence: [
              {
                type: "x",
                stance: "supports",
                summary: "yes",
                sources: ["src:missing"],
              },
            ],
          },
        ],
        items: [
          { name: "foo", tier: "N", kind: "element" },
          { name: "bar", tier: "N", kind: "element" },
        ],
      }),
      kb(),
    );
    expect(plan.issues.find((i) => i.code === "unknown_source")).toBeDefined();
  });
});

describe("buildPlan — item disposition", () => {
  it("classifies a fresh item as new → insert", () => {
    const plan = buildPlan(
      pack({ items: [{ name: "foo", tier: "N", kind: "element" }] }),
      kb(),
    );
    expect(plan.items[0].disposition.kind).toBe("new");
    expect(plan.items[0].decision).toBe("insert");
  });

  it("classifies a name collision → default merge", () => {
    const plan = buildPlan(
      pack({ items: [{ name: "iron", tier: "N", kind: "element" }] }),
      kb({
        itemByName: new Map([
          ["iron", { id: "fe1", slug: "iron", name: "iron" }],
        ]),
        itemBySlug: new Map([
          ["iron", { id: "fe1", slug: "iron", name: "iron" }],
        ]),
      }),
    );
    expect(plan.items[0].disposition.kind).toBe("name_collision");
    expect(plan.items[0].decision).toBe("merge");
  });

  it("classifies a slug collision under a different name → default skip", () => {
    // "Red Oak" slugifies to "red-oak", which collides with existing
    // "red oak". The planner shouldn't blind-insert — it would hit the
    // unique index. Default to skip; admin can flip to merge.
    const plan = buildPlan(
      pack({ items: [{ name: "Red Oak", tier: "N", kind: "element" }] }),
      kb({
        itemByName: new Map([
          ["red oak", { id: "r1", slug: "red-oak", name: "red oak" }],
        ]),
        itemBySlug: new Map([
          ["red-oak", { id: "r1", slug: "red-oak", name: "red oak" }],
        ]),
      }),
    );
    expect(plan.items[0].disposition.kind).toBe("slug_collision");
    expect(plan.items[0].decision).toBe("skip");
  });

  it("classifies a normalised-key fuzzy match as a merge candidate", () => {
    // Different enough strings that neither name nor slug collide, but the
    // normalised form matches — "red-oak-tree" vs "redoak tree". Both
    // normalise to "redoaktree".
    const plan = buildPlan(
      pack({ items: [{ name: "red-oak-tree", tier: "N", kind: "element" }] }),
      kb({
        itemByName: new Map([
          [
            "redoak tree",
            { id: "r1", slug: "redoak-tree", name: "redoak tree" },
          ],
        ]),
        itemBySlug: new Map([
          [
            "redoak-tree",
            { id: "r1", slug: "redoak-tree", name: "redoak tree" },
          ],
        ]),
      }),
    );
    expect(plan.items[0].disposition.kind).toBe("fuzzy_match");
    expect(plan.items[0].decision).toBe("insert");
  });
});

describe("buildPlan — counts", () => {
  it("counts links and evidence rows that would be inserted", () => {
    const plan = buildPlan(
      pack({
        items: [
          {
            name: "a",
            tier: "N",
            kind: "element",
            recipes: [{ f: ["b", "c"] }],
          },
          { name: "b", tier: "N", kind: "element" },
          { name: "c", tier: "N", kind: "element" },
        ],
        evidenceLinks: [
          {
            ids: ["a<f<b", "a<f<c"],
            confidence: "established",
            evidence: [
              { type: "x", stance: "supports", summary: "a" },
              { type: "y", stance: "supports", summary: "b" },
            ],
          },
        ],
      }),
      kb(),
    );
    expect(plan.linkCount).toBe(2); // two recipe-f links on item "a"
    expect(plan.evidenceCount).toBe(4); // 2 ids × 2 entries
  });

  it("drops link counts for items the admin skips (via default decision)", () => {
    // A slug-collision defaults to skip. Its linkCount contribution is 0.
    const plan = buildPlan(
      pack({
        items: [
          {
            name: "Red Oak",
            tier: "N",
            kind: "element",
            recipes: [{ f: ["acorn"] }],
          },
          { name: "acorn", tier: "N", kind: "element" },
        ],
      }),
      kb({
        itemByName: new Map([
          ["red oak", { id: "r1", slug: "red-oak", name: "red oak" }],
        ]),
        itemBySlug: new Map([
          ["red-oak", { id: "r1", slug: "red-oak", name: "red oak" }],
        ]),
      }),
    );
    const redOak = plan.items.find((i) => i.name === "Red Oak")!;
    expect(redOak.decision).toBe("skip");
    expect(plan.linkCount).toBe(0);
  });
});

describe("buildPlan — pictograms", () => {
  it("rejects a bad pictogram on an item", () => {
    const plan = buildPlan(
      pack({
        items: [
          {
            name: "foo",
            tier: "N",
            kind: "element",
            pictogram: '<script>alert(1)</script>',
          },
        ],
      }),
      kb(),
    );
    expect(
      plan.issues.find((i) => i.code === "item_bad_pictogram"),
    ).toBeDefined();
  });

  it("accepts a canonical pictogram", () => {
    const plan = buildPlan(
      pack({
        items: [
          {
            name: "foo",
            tier: "N",
            kind: "element",
            pictogram: '<circle class="b" cx="16" cy="16" r="6"/>',
          },
        ],
      }),
      kb(),
    );
    expect(
      plan.issues.find((i) => i.code === "item_bad_pictogram"),
    ).toBeUndefined();
    expect(plan.items).toHaveLength(1);
  });

  it("allows an item to reference a kind defined in the pack", () => {
    const plan = buildPlan(
      pack({
        items: [{ name: "foo", tier: "N", kind: "fossil" }],
        kinds: {
          fossil: {
            label: "Fossil",
            pictogram: '<circle class="b" cx="16" cy="16" r="10"/>',
          },
        },
      }),
      kb(),
    );
    expect(plan.issues.find((i) => i.code === "item_bad_kind")).toBeUndefined();
    expect(plan.items).toHaveLength(1);
  });

  it("rejects a bad kind pictogram", () => {
    const plan = buildPlan(
      pack({
        kinds: {
          fossil: {
            pictogram: '<circle class="danger" cx="1" cy="1" r="1"/>',
          },
        },
      }),
      kb(),
    );
    expect(
      plan.issues.find((i) => i.code === "kind_bad_pictogram"),
    ).toBeDefined();
  });

  it("rejects a kind code that isn't lowercase-hyphenated", () => {
    const plan = buildPlan(
      pack({ kinds: { "Bad Kind": {} } }),
      kb(),
    );
    expect(plan.issues.find((i) => i.code === "kind_bad_code")).toBeDefined();
  });
});

describe("buildPlan — sources", () => {
  it("marks new vs existing source codes", () => {
    const plan = buildPlan(
      pack({
        sources: {
          "src:new": { kind: "paper", title: "new" },
          "src:old": { kind: "paper", title: "old" },
        },
      }),
      kb({ existingSourceCodes: new Set(["src:old"]) }),
    );
    const bycode = Object.fromEntries(plan.sources.map((s) => [s.code, s.disposition]));
    expect(bycode["src:new"]).toBe("new");
    expect(bycode["src:old"]).toBe("exists");
  });
});
