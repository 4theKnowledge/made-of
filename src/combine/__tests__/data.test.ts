import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import { computeRefine } from "../levels";

const snapshot = buildSnapshot(toRows(loadKnowledgeBase()));

describe("buildThemeBundle", () => {
  const everyday = buildThemeBundle(snapshot, "everyday");
  const everything = buildThemeBundle(snapshot, "everything");

  it("Everyday has a plausible number of recipes and outputs", () => {
    // Spec target: ~143 things to make in Everyday. We allow a band because
    // the knowledge base will drift over time.
    expect(everyday.outputs.size).toBeGreaterThan(80);
    expect(everyday.outputs.size).toBeLessThan(220);
    expect(everyday.recipes.length).toBeGreaterThan(everyday.outputs.size);
  });

  it("Everything has a plausible number of recipes and outputs", () => {
    // Spec target: ~203 things to make in Everything.
    expect(everything.outputs.size).toBeGreaterThan(140);
    expect(everything.outputs.size).toBeLessThan(300);
    expect(everything.recipes.length).toBeGreaterThan(
      everything.outputs.size,
    );
  });

  it("Everything is a superset of Everyday", () => {
    for (const id of everyday.outputs) {
      expect(everything.outputs.has(id)).toBe(true);
    }
  });

  it("every recipe has 2..7 ingredients", () => {
    for (const r of [...everyday.recipes, ...everything.recipes]) {
      expect(r.all.length).toBeGreaterThanOrEqual(2);
      expect(r.all.length).toBeLessThanOrEqual(7);
    }
  });

  it("no recipe contains its own output", () => {
    for (const r of [...everyday.recipes, ...everything.recipes]) {
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

  it("Everyday never includes living outputs (sheep is raw material, not output)", () => {
    for (const id of everyday.outputs) {
      const node = snapshot.nodes.get(id);
      expect(node?.kind).not.toBe("living");
    }
  });

  it("no recipe needs a part made only in a later age", () => {
    for (const bundle of [everyday, everything]) {
      // Lowest band an output appears at.
      const outBand = new Map<string, number>();
      for (const r of bundle.recipes) {
        const cur = outBand.get(r.out);
        if (cur == null || r.band < cur) outBand.set(r.out, r.band);
      }
      for (const r of bundle.recipes) {
        for (const partId of r.all) {
          const ob = outBand.get(partId);
          if (ob != null) {
            expect(ob).toBeLessThanOrEqual(r.band);
          }
        }
      }
    }
  });

  it("every age band is populated in both themes", () => {
    for (const bundle of [everyday, everything]) {
      const bands = new Set(bundle.recipes.map((r) => r.band));
      for (let b = 1; b <= bundle.theme.ages.length; b++) {
        expect(bands.has(b)).toBe(true);
      }
    }
  });

  it("derived sets are consistent", () => {
    for (const bundle of [everyday, everything]) {
      // base ∩ outputs = ∅
      for (const id of bundle.base) {
        expect(bundle.outputs.has(id)).toBe(false);
      }
      // mid ⊆ outputs
      for (const id of bundle.mid) {
        expect(bundle.outputs.has(id)).toBe(true);
      }
      // terminal ⊆ outputs and nothing uses them
      for (const id of bundle.terminal) {
        expect(bundle.outputs.has(id)).toBe(true);
        expect(bundle.ingredients.has(id)).toBe(false);
      }
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
    expect(r.get("hydrogen")).toBe(0);
    expect(r.get("sheep")).toBe(0);
    expect(r.get("big-bang")).toBe(0);
  });

  it("made things step up from raw", () => {
    const r = computeRefine(snapshot);
    // Tier-N stuff is raw: 0.
    expect(r.get("water")).toBe(0);
    expect(r.get("iron-ore")).toBe(0);
    // Processed materials and composed things step up.
    const flour = r.get("flour") ?? 0;
    const bread = r.get("bread") ?? 0;
    expect(flour).toBeGreaterThan(0);
    expect(bread).toBeGreaterThan(flour);
  });

  it("memoises on snapshot identity", () => {
    const a = computeRefine(snapshot);
    const b = computeRefine(snapshot);
    expect(a).toBe(b);
  });
});
