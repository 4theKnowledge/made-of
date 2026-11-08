import { describe, expect, it } from "vitest";
import { findHint } from "../hint";
import type { Board } from "../match";
import type { CombineRecipe, ThemeBundle } from "../types";

/** Hand-rolled bundle so hint tests can assert exact shapes without
 *  depending on live knowledge-base counts. Mirrors the pattern in
 *  match.test.ts. */
function fakeBundle(recipes: CombineRecipe[]): ThemeBundle {
  const byIngredient = new Map<string, CombineRecipe[]>();
  for (const r of recipes) {
    for (const x of r.all) {
      let list = byIngredient.get(x);
      if (!list) {
        list = [];
        byIngredient.set(x, list);
      }
      list.push(r);
    }
  }
  for (const list of byIngredient.values()) {
    list.sort((a, b) => b.all.length - a.all.length);
  }
  return {
    theme: {
      k: "everything",
      name: "Test",
      desc: "",
      ages: ["one", "two"],
      collectionVersion: 0,
    },
    recipes,
    byIngredient,
    outputs: new Set(recipes.map((r) => r.out)),
    ingredients: new Set(recipes.flatMap((r) => r.all)),
    base: [],
    mid: [],
    tools: new Set(),
    terminal: new Set(),
    sameIngredients: new Map(),
    items: new Map(),
    outBand: (() => {
      const m = new Map<string, number>();
      for (const r of recipes) {
        const cur = m.get(r.out);
        if (cur == null || r.band < cur) m.set(r.out, r.band);
      }
      return m;
    })(),
  };
}

const R = (out: string, all: string[], band = 1): CombineRecipe => ({
  id: `test-${out}-${all.join("+")}`,
  out,
  from: all,
  with: [],
  needs: [],
  evolved: [],
  all,
  lvl: 1,
  band,
});

const size = 5;
const empty = (): Board => Array(25).fill(null);

describe("findHint — tier 1: ready", () => {
  const bundle = fakeBundle([R("dough", ["flour", "water"])]);

  it("flags a tray tile that completes a combination on the board", () => {
    const board = empty();
    board[0] = "flour";
    const h = findHint(bundle, {
      board,
      size,
      tray: ["water", null, null],
      hold: [],
      age: 0,
      found: new Set(),
    });
    expect(h).not.toBeNull();
    expect(h!.kind).toBe("ready");
    expect(h!.out).toBe("dough");
    expect(h!.using).toBe("water");
    expect(h!.cells!.sort((a, b) => a - b)).toEqual([0]);
  });

  it("also works with hold tiles", () => {
    const board = empty();
    board[0] = "flour";
    const h = findHint(bundle, {
      board,
      size,
      tray: [null, null, null],
      hold: ["water"],
      age: 0,
      found: new Set(),
    });
    expect(h?.kind).toBe("ready");
    expect(h?.using).toBe("water");
  });

  it("returns null-tier when no source tile combines right now", () => {
    const board = empty();
    board[0] = "flour";
    // Stone doesn't go with flour in any recipe here.
    const h = findHint(bundle, {
      board,
      size,
      tray: ["stone", null, null],
      hold: [],
      age: 0,
      found: new Set(),
    });
    // Falls through to the teach tier.
    expect(h?.kind).toBe("teach");
  });
});

describe("findHint — tier 2: one-move", () => {
  const bundle = fakeBundle([R("bread", ["flour", "water", "oven"])]);

  it("flags a placement that completes with adjacent board tiles", () => {
    const board = empty();
    // flour@0 and oven@2 — not adjacent to each other, so matchOn
    // on either cell can't reach the third ingredient. But placing
    // water at 1 bridges them (0-1-2 line).
    board[0] = "flour";
    board[2] = "oven";
    const h = findHint(bundle, {
      board,
      size,
      tray: ["water", null, null],
      hold: [],
      age: 0,
      found: new Set(),
    });
    expect(h?.kind).toBe("one-move");
    expect(h?.out).toBe("bread");
    expect(h?.using).toBe("water");
  });

  it("returns teach tier when no placement completes a combination", () => {
    const board = empty();
    // flour@0 and oven@12 — too far apart to connect via a single
    // placed water tile (no cell is edge-adjacent to both).
    board[0] = "flour";
    board[12] = "oven";
    const h = findHint(bundle, {
      board,
      size,
      tray: ["water", null, null],
      hold: [],
      age: 0,
      found: new Set(),
    });
    expect(h?.kind).toBe("teach");
  });
});

describe("findHint — tier priority", () => {
  const bundle = fakeBundle([
    R("dough", ["flour", "water"]),
    R("bread", ["flour", "water", "oven"]),
  ]);

  it("ready beats one-move when both are available", () => {
    const board = empty();
    // flour@0 + oven@1 adjacent. Water in tray:
    //   - matchOn(water, cell 0) can grow to bread (water+flour+oven) → ready.
    //   - matchAt(water, empty cell 5) could also complete a one-move.
    // Ready wins.
    board[0] = "flour";
    board[1] = "oven";
    const h = findHint(bundle, {
      board,
      size,
      tray: ["water", null, null],
      hold: [],
      age: 0,
      found: new Set(),
    });
    expect(h?.kind).toBe("ready");
  });
});

describe("findHint — unfound preference", () => {
  const bundle = fakeBundle([
    R("dough", ["flour", "water"]),
    R("mud", ["dirt", "water"]),
  ]);

  it("within a tier, prefers a recipe whose output isn't found yet", () => {
    const board = empty();
    board[0] = "flour";
    board[10] = "dirt";
    // Water combines with both flour (dough) and dirt (mud). Dough is
    // already found; mud is not. Hint should pick mud.
    const h = findHint(bundle, {
      board,
      size,
      tray: ["water", null, null],
      hold: [],
      age: 0,
      found: new Set(["dough"]),
    });
    expect(h?.kind).toBe("ready");
    expect(h?.out).toBe("mud");
  });

  it("falls back to a found output when nothing unfound is reachable", () => {
    const bundle = fakeBundle([R("dough", ["flour", "water"])]);
    const board = empty();
    board[0] = "flour";
    const h = findHint(bundle, {
      board,
      size,
      tray: ["water", null, null],
      hold: [],
      age: 0,
      found: new Set(["dough"]),
    });
    // Still useful: shows the ready combo even though the output is known.
    expect(h?.kind).toBe("ready");
    expect(h?.out).toBe("dough");
  });
});

describe("findHint — board-tile relocation", () => {
  it("suggests moving a board tile when it completes a group", () => {
    const bundle = fakeBundle([R("bread", ["flour", "water", "oven"])]);
    const board = empty();
    // flour@0, water@1 adjacent. oven sits off in a corner (@24).
    // No tray/hold moves help; the win is to relocate oven onto one of
    // the existing tiles — that's a "ready" match (drop-on) using the
    // board tile as the mover.
    board[0] = "flour";
    board[1] = "water";
    board[24] = "oven";
    const h = findHint(bundle, {
      board,
      size,
      tray: [null, null, null],
      hold: [],
      age: 0,
      found: new Set(),
    });
    expect(h?.kind).toBe("ready");
    expect(h?.out).toBe("bread");
    expect(h?.moveFrom).toBe(24);
    expect(h?.using).toBe("oven");
  });

  it("suggests a one-move relocation when no ready drop exists", () => {
    // Two tiles exist but can't pair directly, and dropping one on the
    // other doesn't complete a recipe either. The win is relocating a
    // third tile to an empty cell that bridges them into contact.
    const bundle = fakeBundle([R("alpha", ["a", "b", "c"])]);
    const board = empty();
    // a@0, b@2 — too far to pair directly; c@24 is the mover. Placing
    // c at cell 1 bridges them into alpha. matchOn(c, 0) would need
    // b to be adjacent to cell 0 — it isn't (b is at 2). Likewise
    // matchOn(c, 2) needs a adjacent to 2 — nope. So no ready; only
    // the one-move at cell 1 works.
    board[0] = "a";
    board[2] = "b";
    board[24] = "c";
    const h = findHint(bundle, {
      board,
      size,
      tray: [null, null, null],
      hold: [],
      age: 0,
      found: new Set(),
    });
    expect(h?.kind).toBe("one-move");
    expect(h?.out).toBe("alpha");
    expect(h?.moveFrom).toBe(24);
  });

  it("prefers a tray move over a board relocation when both complete", () => {
    const bundle = fakeBundle([R("dough", ["flour", "water"])]);
    const board = empty();
    // flour@0, water@24: dropping tray water on flour@0 is ready via a
    // tray source. Relocating board water would also work; tray should
    // win because off-board sources are scanned first.
    board[0] = "flour";
    board[24] = "water";
    const h = findHint(bundle, {
      board,
      size,
      tray: ["water", null, null],
      hold: [],
      age: 0,
      found: new Set(),
    });
    expect(h?.kind).toBe("ready");
    expect(h?.moveFrom).toBeUndefined();
    expect(h?.using).toBe("water");
  });

  it("picks the shortest path — relocates straight onto the partner", () => {
    // water@0 + fire@24 with no off-board tiles. The cleanest completion
    // is to pick up water and drop it on fire (ready, drop-on), rather
    // than any longer sequence.
    const bundle = fakeBundle([R("steam", ["water", "fire"])]);
    const board = empty();
    board[0] = "water";
    board[24] = "fire";
    const h = findHint(bundle, {
      board,
      size,
      tray: [null, null, null],
      hold: [],
      age: 0,
      found: new Set(),
    });
    expect(h?.kind).toBe("ready");
    expect(h?.out).toBe("steam");
    expect(h?.moveFrom).not.toBeUndefined();
  });
});

describe("findHint — tier 3: teach", () => {
  const bundle = fakeBundle([
    R("dough", ["flour", "water"], 1),
    R("bread", ["flour", "water", "oven"], 1),
    R("cake", ["dough", "sugar"], 2),
  ]);

  it("suggests a current-age recipe when nothing is placeable", () => {
    const h = findHint(bundle, {
      board: empty(),
      size,
      tray: ["flour", null, null],
      hold: [],
      age: 0,
      found: new Set(),
    });
    expect(h?.kind).toBe("teach");
    // Picks a recipe that overlaps with the tray tile.
    expect(h!.recipe).toContain("flour");
    expect(h?.using).toBeUndefined();
    expect(h?.cells).toBeUndefined();
  });

  // Removed: "returns null when the current age has no recipes" asserted
  // banded semantics. In soft mode teach picks from the reachable pool
  // regardless of chapter; the null-tier is now reserved for truly empty
  // bundles (covered implicitly by hint.ts's bundle.recipes fallback).
});
