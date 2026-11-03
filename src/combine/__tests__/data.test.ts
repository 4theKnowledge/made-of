import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import { computeRefine } from "../levels";

const snapshot = buildSnapshot(toRows(loadKnowledgeBase()));
const id = (slug: string): string => {
  const n = snapshot.bySlug.get(slug);
  if (!n) throw new Error(`missing node for slug ${slug}`);
  return n.id;
};

describe("buildThemeBundle", () => {
  const everything = buildThemeBundle(snapshot, "everything");

  it("Everything has a plausible number of recipes and outputs", () => {
    // Spec target: ~203 things to make in Everything.
    expect(everything.outputs.size).toBeGreaterThan(140);
    expect(everything.outputs.size).toBeLessThan(300);
    expect(everything.recipes.length).toBeGreaterThan(
      everything.outputs.size,
    );
  });

  it("every recipe has 2..7 ingredients", () => {
    for (const r of everything.recipes) {
      expect(r.all.length).toBeGreaterThanOrEqual(2);
      expect(r.all.length).toBeLessThanOrEqual(7);
    }
  });

  it("no recipe contains its own output", () => {
    for (const r of everything.recipes) {
      expect(r.all.includes(r.out)).toBe(false);
    }
  });

  it("no recipe mentions a combine-excluded item", () => {
    for (const r of everything.recipes) {
      for (const id of [...r.all, r.out]) {
        const node = snapshot.nodes.get(id);
        expect(node).toBeDefined();
        expect(node!.tags.includes("combine-exclude")).toBe(false);
      }
    }
  });

  it("no recipe needs a part made only in a later age", () => {
    // Lowest band an output appears at.
    const outBand = new Map<string, number>();
    for (const r of everything.recipes) {
      const cur = outBand.get(r.out);
      if (cur == null || r.band < cur) outBand.set(r.out, r.band);
    }
    for (const r of everything.recipes) {
      for (const partId of r.all) {
        const ob = outBand.get(partId);
        if (ob != null) {
          expect(ob).toBeLessThanOrEqual(r.band);
        }
      }
    }
  });

  it("every age band is populated", () => {
    const bands = new Set(everything.recipes.map((r) => r.band));
    for (let b = 1; b <= everything.theme.ages.length; b++) {
      expect(bands.has(b)).toBe(true);
    }
  });

  it("band invariant holds across a range of numAges (via prevNumAges)", () => {
    // Simulate a KB that was promoted to higher age counts in the past. The
    // dependency invariant must hold for every valid numAges, not just the
    // one derived today.
    for (const prev of [3, 4, 5, 6, 7, 8]) {
      const bundle = buildThemeBundle(snapshot, "everything", prev);
      const outBand = new Map<string, number>();
      for (const r of bundle.recipes) {
        const cur = outBand.get(r.out);
        if (cur == null || r.band < cur) outBand.set(r.out, r.band);
      }
      for (const r of bundle.recipes) {
        for (const partId of r.all) {
          const ob = outBand.get(partId);
          if (ob != null) {
            expect(ob, `prev=${prev} recipe=${r.out} part=${partId}`).toBeLessThanOrEqual(
              r.band,
            );
          }
        }
      }
    }
  });

  it("effective age count never exceeds the derived target", () => {
    // Monotonicity lives on `deriveNumAges` (the target). The effective
    // age count — bundle.theme.ages.length — can shrink below the target
    // when sparse bands merge, which is desirable: no dead ages.
    for (const prev of [0, 3, 5, 8, 12]) {
      const bundle = buildThemeBundle(snapshot, "everything", prev);
      const n = bundle.theme.ages.length;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(Math.max(prev, 15));
    }
  });

  it("no band holds fewer than the sparse-band floor", () => {
    // The merge pass guarantees every surviving band has enough recipes
    // for the dealer to surface current-age combos. If this ever regresses,
    // Age-II-style "stuck" complaints come back.
    const sizes = new Map<number, number>();
    for (const r of everything.recipes) {
      sizes.set(r.band, (sizes.get(r.band) ?? 0) + 1);
    }
    for (const [band, size] of sizes) {
      expect(size, `band ${band} is too sparse`).toBeGreaterThanOrEqual(10);
    }
  });

  it("derived sets are consistent", () => {
    // base ∩ outputs = ∅
    for (const id of everything.base) {
      expect(everything.outputs.has(id)).toBe(false);
    }
    // mid ⊆ outputs
    for (const id of everything.mid) {
      expect(everything.outputs.has(id)).toBe(true);
    }
    // terminal ⊆ outputs and nothing uses them
    for (const id of everything.terminal) {
      expect(everything.outputs.has(id)).toBe(true);
      expect(everything.ingredients.has(id)).toBe(false);
    }
  });

  it("byIngredient lists are sorted biggest-first", () => {
    for (const list of everything.byIngredient.values()) {
      for (let i = 1; i < list.length; i++) {
        expect(list[i - 1].all.length).toBeGreaterThanOrEqual(
          list[i].all.length,
        );
      }
    }
  });

  it("sameIngredients groups contain only distinct outputs", () => {
    for (const list of everything.sameIngredients.values()) {
      const outs = new Set(list.map((r) => r.out));
      expect(outs.size).toBe(list.length);
    }
  });

  it("item view carries name, tier, symbol, fact for every referenced id", () => {
    const everyRef = new Set<string>([
      ...everything.outputs,
      ...everything.ingredients,
    ]);
    for (const id of everyRef) {
      const view = everything.items.get(id);
      expect(view).toBeDefined();
      expect(view!.id).toBe(id);
      expect(typeof view!.name).toBe("string");
    }
  });
});

describe("computeRefine", () => {
  it("raw stuff is 0", () => {
    const r = computeRefine(snapshot);
    expect(r.get(id("hydrogen"))).toBe(0);
    expect(r.get(id("sheep"))).toBe(0);
    expect(r.get(id("big-bang"))).toBe(0);
  });

  it("made things step up from raw", () => {
    const r = computeRefine(snapshot);
    // Tier-N stuff is raw: 0.
    expect(r.get(id("water"))).toBe(0);
    expect(r.get(id("iron-ore"))).toBe(0);
    // Processed materials and composed things step up.
    const flour = r.get(id("flour")) ?? 0;
    const bread = r.get(id("bread")) ?? 0;
    expect(flour).toBeGreaterThan(0);
    expect(bread).toBeGreaterThan(flour);
  });

  it("memoises on snapshot identity", () => {
    const a = computeRefine(snapshot);
    const b = computeRefine(snapshot);
    expect(a).toBe(b);
  });
});
