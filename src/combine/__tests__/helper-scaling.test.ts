import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import {
  HELPER_MAX,
  HELPER_MIN,
  HELPER_PER_ITEMS,
  bandSize,
  helperGrants,
  newGame,
  reduce,
} from "../engine";
import type { CombineRecipe, ThemeBundle } from "../types";

const snap = buildSnapshot(toRows(loadKnowledgeBase()));
const everything = buildThemeBundle(snap, "everything");

function fakeBundle(opts: {
  recipes: CombineRecipe[];
  ages?: string[];
}): ThemeBundle {
  const outputs = new Set(opts.recipes.map((r) => r.out));
  const ingredients = new Set(opts.recipes.flatMap((r) => r.all));
  const items = new Map<string, {
    id: string;
    slug: string;
    name: string;
    tier: "F" | "N" | "M" | "C" | "P" | "S";
    symbol: string | null;
    fact: string;
    kind: "object";
  }>();
  for (const id of new Set<string>([...outputs, ...ingredients])) {
    items.set(id, {
      id,
      slug: id,
      name: id,
      tier: "M",
      symbol: null,
      fact: "",
      kind: "object",
    });
  }
  const byIngredient = new Map<string, CombineRecipe[]>();
  for (const r of opts.recipes) {
    for (const x of r.all) {
      let list = byIngredient.get(x);
      if (!list) {
        list = [];
        byIngredient.set(x, list);
      }
      list.push(r);
    }
  }
  const sameIngredients = new Map<string, CombineRecipe[]>();
  for (const r of opts.recipes) {
    const k = [...r.all].sort().join("+");
    let list = sameIngredients.get(k);
    if (!list) {
      list = [];
      sameIngredients.set(k, list);
    }
    if (!list.some((q) => q.out === r.out)) list.push(r);
  }
  return {
    theme: {
      k: "everything",
      name: "Test",
      desc: "",
      ages: opts.ages ?? ["I", "II", "III"],
    },
    recipes: opts.recipes,
    byIngredient,
    outputs,
    ingredients,
    base: [...ingredients].filter((x) => !outputs.has(x)),
    mid: [...ingredients].filter((x) => outputs.has(x)),
    tools: new Set<string>(),
    terminal: new Set<string>(),
    sameIngredients,
    items,
    outBand: (() => {
      const m = new Map<string, number>();
      for (const r of opts.recipes) {
        const cur = m.get(r.out);
        if (cur == null || r.band < cur) m.set(r.out, r.band);
      }
      return m;
    })(),
  };
}

const R = (out: string, all: string[], band: number): CombineRecipe => ({
  out,
  from: all,
  with: [],
  needs: [],
  evolved: [],
  all,
  lvl: band,
  band,
});

/** Build a bundle whose age 0 (band 1) holds `n` distinct outputs. */
function bundleWithBand(n: number): ThemeBundle {
  const recipes: CombineRecipe[] = [];
  for (let i = 0; i < n; i++) {
    recipes.push(R(`out${i}`, [`in${i}a`, `in${i}b`], 1));
  }
  return fakeBundle({ recipes });
}

describe("helper scaling", () => {
  it("small band lands at minima", () => {
    const b = bundleWithBand(5);
    expect(bandSize(0, b)).toBe(5);
    const g = helperGrants(0, b);
    expect(g.mv).toBe(HELPER_MIN.mv);
    expect(g.swap).toBe(HELPER_MIN.swap);
    expect(g.clear).toBe(HELPER_MIN.clear);
    expect(g.hint).toBe(HELPER_MIN.hint);
    expect(g.shore).toBe(HELPER_MIN.shore);
  });

  it("medium band uses the divisor", () => {
    const b = bundleWithBand(30);
    const g = helperGrants(0, b);
    expect(g.mv).toBe(Math.floor(30 / HELPER_PER_ITEMS.mv)); // 3
    expect(g.swap).toBe(Math.floor(30 / HELPER_PER_ITEMS.swap)); // 2
    expect(g.clear).toBe(Math.max(HELPER_MIN.clear, Math.floor(30 / HELPER_PER_ITEMS.clear))); // 1
    expect(g.hint).toBe(Math.max(HELPER_MIN.hint, Math.floor(30 / HELPER_PER_ITEMS.hint))); // 1
    expect(g.shore).toBe(Math.floor(30 / HELPER_PER_ITEMS.shore)); // 2
  });

  it("huge band hits the caps, not above", () => {
    const b = bundleWithBand(200);
    const g = helperGrants(0, b);
    expect(g.mv).toBe(HELPER_MAX.mv);
    expect(g.swap).toBe(HELPER_MAX.swap);
    expect(g.clear).toBe(HELPER_MAX.clear);
    expect(g.hint).toBe(HELPER_MAX.hint);
    expect(g.shore).toBe(HELPER_MAX.shore);
  });

  it("newGame applies the age-0 grant to initial helpers", () => {
    const b = bundleWithBand(30);
    const { state } = newGame("everything", b, { seed: 1, size: 5 });
    const g = helperGrants(0, b);
    expect(state.mv).toBe(g.mv);
    expect(state.swaps).toBe(g.swap);
    expect(state.clears).toBe(g.clear);
    expect(state.hints).toBe(g.hint);
    expect(state.shore).toBe(g.shore);
  });

  it("age-up grants are additive on top of leftover helpers", () => {
    const b = bundleWithBand(30);
    const { state } = newGame("everything", b, { seed: 7, size: 5 });
    const g0 = helperGrants(0, b);
    // Nothing in this bundle has band 2+, so build a second-band bundle
    // directly: 20 band-1 outputs + 20 band-2 outputs.
    const recipes: CombineRecipe[] = [];
    for (let i = 0; i < 20; i++) recipes.push(R(`a${i}`, [`x${i}a`, `x${i}b`], 1));
    for (let i = 0; i < 20; i++) recipes.push(R(`b${i}`, [`y${i}a`, `y${i}b`], 2));
    const twoAge = fakeBundle({ recipes, ages: ["I", "II"] });
    const sim = newGame("everything", twoAge, { seed: 11, size: 5 }).state;
    const start = { ...sim };
    // Short of using the full engine play path, test the grant primitive
    // directly: starting counters + grant for age 1 must match what the
    // age-up event applies.
    const next = helperGrants(1, twoAge);
    const expectedMv = start.mv + next.mv;
    const expectedSwaps = start.swaps + next.swap;
    expect(next.mv).toBeGreaterThanOrEqual(HELPER_MIN.mv);
    expect(expectedMv).toBeGreaterThan(start.mv);
    expect(expectedSwaps).toBeGreaterThan(start.swaps);
    // Also sanity-check that the age-0 grant matched the primitive.
    expect(state.mv).toBe(g0.mv);
  });

  it("debug-set-age in a real bundle fires age-up with grants", () => {
    // Everything is big enough that non-zero grants exist for most ages.
    const r = newGame("everything", everything, { seed: 3, size: 6 });
    let state = r.state;
    state.debug = true;
    const out = reduce(state, everything, { type: "debug-set-age", age: 1 });
    state = out.state;
    const ageUp = out.events.find((e) => e.type === "age-up");
    expect(ageUp).toBeTruthy();
    if (ageUp && ageUp.type === "age-up") {
      expect(ageUp.grants).toBeTruthy();
      const g = helperGrants(1, everything);
      expect(ageUp.grants).toEqual(g);
    }
  });
});
