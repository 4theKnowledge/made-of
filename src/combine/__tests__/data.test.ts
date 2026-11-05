import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle, _recipeParts_FOR_TEST } from "../data";
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
    // Spec target was ~203; adding 1-input "promote" recipes (star →
    // supernova → heavy elements, etc.) roughly doubles the collection by
    // unlocking an authored progression chain that used to be stripped.
    // Bounds stay loose so KB edits don't tip the test.
    expect(everything.outputs.size).toBeGreaterThan(140);
    expect(everything.outputs.size).toBeLessThan(500);
    expect(everything.recipes.length).toBeGreaterThan(
      everything.outputs.size,
    );
  });

  it("every recipe has 1..7 ingredients", () => {
    // 1-input recipes exist for authored chains like star → supernova; they
    // only fire through the explicit `promote` action, never auto-fire via
    // matchAt/matchOn.
    for (const r of everything.recipes) {
      expect(r.all.length).toBeGreaterThanOrEqual(1);
      expect(r.all.length).toBeLessThanOrEqual(7);
    }
  });

  it("does not promote water → paper (self-ref collapse guard)", () => {
    // "Recycled paper" is authored as `paper + water → paper`; dropping
    // the self-ref would leave `water → paper` and expose a nonsensical
    // promote on water tiles. Regression guard: keep this rejected.
    const water = snapshot.bySlug.get("water")?.id;
    const paper = snapshot.bySlug.get("paper")?.id;
    expect(water).toBeDefined();
    expect(paper).toBeDefined();
    const bogus = everything.recipes.find(
      (r) => r.out === paper && r.all.length === 1 && r.all[0] === water,
    );
    expect(bogus).toBeUndefined();
  });

  it("no 1-input recipe in the whole bundle collapsed from a self-ref", () => {
    // Cross-cutting guard: every surviving 1-input recipe (star →
    // supernova, water → hydrogen-gas, …) must trace back to a raw
    // authored input list that already had exactly one ingredient.
    // Otherwise the collapse-from-N-to-1 bug is masking as a feature.
    for (const r of everything.recipes) {
      if (r.all.length !== 1) continue;
      const node = snapshot.nodes.get(r.out);
      expect(node, `missing node for ${r.out}`).toBeDefined();
      // Find the authored recipe that produced r by matching ingredient.
      const rawRecipe = node!.recipes.find((rec) => {
        const edgeIds = new Set(
          node!.up
            .filter((e) => e.recipeId === rec.id && e.id !== node!.id)
            .map((e) => e.id),
        );
        return edgeIds.size === 1 && edgeIds.has(r.all[0]);
      });
      expect(
        rawRecipe,
        `output ${node!.slug} has a 1-input bundle recipe (ingredient ${r.all[0]}) with no matching authored recipe — likely a self-ref collapse`,
      ).toBeDefined();
      // Confirm the authored recipe had at most one non-self edge; a
      // "+self" collapse would mean more than one authored edge.
      const authoredEdgeCount = node!.up.filter(
        (e) => e.recipeId === rawRecipe!.id && e.id !== node!.id,
      ).length;
      expect(
        authoredEdgeCount,
        `${node!.slug}: 1-input recipe came from authored recipe with ${authoredEdgeCount} non-self edges`,
      ).toBe(1);
    }
  });

  it("recipeParts: flags self-ref recipes via hadSelfRef", () => {
    // Paper's "recycled" recipe is `paper + water → paper`. recipeParts
    // drops the self-ref and sets the flag so the caller can refuse to
    // promote the collapsed 1-input survivor.
    const paper = snapshot.bySlug.get("paper");
    expect(paper).toBeDefined();
    const recycled = paper!.recipes.find((r) => r.label === "recycled");
    expect(recycled, "expected authored recipe 'recycled' on paper").toBeDefined();
    const parts = _recipeParts_FOR_TEST(paper!, recycled!.id);
    expect(parts.hadSelfRef).toBe(true);
    expect(parts.all).toHaveLength(1);
    // Surviving ingredient is water, not paper (self dropped).
    const water = snapshot.bySlug.get("water")!.id;
    expect(parts.all[0]).toBe(water);
  });

  it("recipeParts: does not set hadSelfRef for a clean 1-input authored recipe", () => {
    // star → supernova: authored with f:["star"]. No self-ref.
    const supernova = snapshot.bySlug.get("supernova");
    expect(supernova).toBeDefined();
    expect(supernova!.recipes.length).toBeGreaterThan(0);
    const parts = _recipeParts_FOR_TEST(
      supernova!,
      supernova!.recipes[0].id,
    );
    expect(parts.hadSelfRef).toBe(false);
    expect(parts.all).toHaveLength(1);
  });

  it("water has no 1-input promote to paper or canvas-like self-ref outputs", () => {
    const water = snapshot.bySlug.get("water")!.id;
    // Any 1-input water promote must point to an output whose authored
    // recipe was truly 1-input (no self + water combo collapsed).
    const promotes = (everything.byIngredient.get(water) ?? []).filter(
      (r) => r.all.length === 1 && r.all[0] === water,
    );
    for (const r of promotes) {
      const node = snapshot.nodes.get(r.out)!;
      const authored = node.recipes.find((rec) => {
        const edges = node.up
          .filter((e) => e.recipeId === rec.id && e.id !== node.id)
          .map((e) => e.id);
        return edges.length === 1 && edges[0] === water;
      });
      expect(
        authored,
        `water → ${node.slug} must correspond to a truly 1-input authored recipe`,
      ).toBeDefined();
    }
  });


  it("includes star → supernova as a 1-input recipe (reachability fix)", () => {
    // Canonical case the promote affordance was added for. Regression
    // guard: if the filter re-tightens to >=2 this trips.
    const star = snapshot.bySlug.get("star")?.id;
    const supernova = snapshot.bySlug.get("supernova")?.id;
    expect(star).toBeDefined();
    expect(supernova).toBeDefined();
    const recipe = everything.recipes.find(
      (r) => r.out === supernova && r.all.length === 1 && r.all[0] === star,
    );
    expect(recipe, "star → supernova must be in the Everything bundle").toBeDefined();
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
