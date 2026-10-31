import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import { newGame, reduce, type Action, type GameState } from "../engine";
import type { CombineRecipe, ThemeBundle } from "../types";

const snap = buildSnapshot(toRows(loadKnowledgeBase()));
const everyday = buildThemeBundle(snap, "everyday");

/* Hand-rolled bundle used by the unit tests that need exact shapes. */
function fakeBundle(opts: {
  recipes: CombineRecipe[];
  tools?: string[];
  terminal?: string[];
  tiers?: Record<string, string>;
}): ThemeBundle {
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
  for (const list of byIngredient.values()) {
    list.sort((a, b) => b.all.length - a.all.length);
  }
  const outputs = new Set(opts.recipes.map((r) => r.out));
  const ingredients = new Set(opts.recipes.flatMap((r) => r.all));
  const items = new Map<string, {
    id: string;
    name: string;
    tier: "F" | "N" | "M" | "C" | "P" | "S";
    symbol: string | null;
    fact: string;
    kind: "object";
  }>();
  const touched = new Set<string>([...outputs, ...ingredients]);
  for (const id of touched) {
    const tier = (opts.tiers?.[id] ?? "M") as "M";
    items.set(id, {
      id,
      name: id,
      tier,
      symbol: null,
      fact: "",
      kind: "object",
    });
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
      ages: ["one", "two", "three"],
    },
    recipes: opts.recipes,
    byIngredient,
    outputs,
    ingredients,
    base: [...ingredients].filter((x) => !outputs.has(x)),
    mid: [...ingredients].filter((x) => outputs.has(x)),
    tools: new Set(opts.tools ?? []),
    terminal: new Set(opts.terminal ?? []),
    sameIngredients,
    items,
  };
}

const R = (out: string, all: string[]): CombineRecipe => ({
  out,
  from: all,
  with: [],
  all,
  lvl: 1,
  band: 1,
});

describe("newGame", () => {
  it("fills the tray and seeds a few starting tiles", () => {
    const { state, events } = newGame("everyday", everyday, { seed: 1, size: 5 });
    expect(state.tray.filter((t) => t != null).length).toBe(3);
    expect(state.board.filter(Boolean).length).toBeGreaterThan(0);
    expect(state.score).toBe(0);
    expect(state.over).toBe(false);
    expect(events.some((e) => e.type === "dealt")).toBe(true);
  });

  it("is deterministic for a given seed", () => {
    const a = newGame("everyday", everyday, { seed: 42, size: 5 });
    const b = newGame("everyday", everyday, { seed: 42, size: 5 });
    expect(a.state.board).toEqual(b.state.board);
    expect(a.state.tray).toEqual(b.state.tray);
  });

  it("daily seed → identical start for everyone", () => {
    const a = newGame("everyday", everyday, { daily: "2026-11-01" });
    const b = newGame("everyday", everyday, { daily: "2026-11-01" });
    expect(a.state.board).toEqual(b.state.board);
    expect(a.state.tray).toEqual(b.state.tray);
    expect(a.state.n).toBe(5);
  });
});

describe("place (unique output recipe)", () => {
  const bundle = fakeBundle({
    recipes: [R("dough", ["flour", "water"])],
  });
  const makeState = (): GameState => {
    const s = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    // Manually arrange the board for this test.
    s.board = Array(9).fill(null);
    s.board[0] = "water";
    s.tray = ["flour", null, null];
    return s;
  };

  it("placing on an empty adjacent cell matches and produces the output", () => {
    const s0 = makeState();
    const { state, events } = reduce(s0, bundle, { type: "place", slot: 0, cell: 1 });
    expect(state.board[1]).toBe("dough");
    expect(state.board[0]).toBeNull();
    // The tray slot was consumed, but the dealer refills an empty tray at
    // the end of the move, so slot 0 may hold a fresh tile — we assert the
    // move happened via `made`/events rather than reading the tray slot.
    expect(state.made).toBe(1);
    expect(state.ageMade).toBe(1);
    expect(events.some((e) => e.type === "placed")).toBe(true);
    expect(events.some((e) => e.type === "combine")).toBe(true);
    expect(events.some((e) => e.type === "discovery")).toBe(true);
    expect(state.found).toContain("dough");
  });

  it("rejects placement on an occupied cell", () => {
    const s0 = makeState();
    const action: Action = { type: "place", slot: 0, cell: 0 };
    const { state, events } = reduce(s0, bundle, action);
    expect(state).toBe(s0);
    expect(events).toEqual([]);
  });

  it("plain placement with no match scores +1 and leaves the tile on the board", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.tray = ["flour", null, null];
    const { state } = reduce(s0, bundle, { type: "place", slot: 0, cell: 4 });
    expect(state.board[4]).toBe("flour");
    expect(state.score).toBe(1);
    expect(state.made).toBe(0);
  });
});

describe("place with alternatives → choosing state", () => {
  // steel + wood could make a saw OR a wheel.
  const bundle = fakeBundle({
    recipes: [R("saw", ["steel", "wood"]), R("wheel", ["steel", "wood"])],
  });
  const makeState = (): GameState => {
    const s = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s.board = Array(9).fill(null);
    s.board[0] = "wood";
    s.tray = ["steel", null, null];
    return s;
  };

  it("stops at a choosing state when the player's own move has alternatives", () => {
    const s0 = makeState();
    const { state } = reduce(s0, bundle, { type: "place", slot: 0, cell: 1 });
    expect(state.choosing).not.toBeNull();
    expect(state.choosing!.options.length).toBe(2);
    // The ingredients are still on the board — the match hasn't resolved yet.
    expect(state.board[0]).toBe("wood");
    expect(state.board[1]).toBe("steel");
  });

  it("resumes on choose", () => {
    const s0 = makeState();
    const { state: paused } = reduce(s0, bundle, { type: "place", slot: 0, cell: 1 });
    const { state: resumed } = reduce(paused, bundle, {
      type: "choose",
      outputIndex: 1,
    });
    expect(resumed.choosing).toBeNull();
    // One of saw/wheel landed on the board.
    const landed = resumed.board.filter((v) => v === "saw" || v === "wheel");
    expect(landed.length).toBe(1);
  });
});

describe("drop-on-top", () => {
  const bundle = fakeBundle({
    recipes: [R("dough", ["flour", "water"])],
  });

  it("dropping flour on water matches and both consume", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.board[4] = "water";
    s0.tray = ["flour", null, null];
    const { state, events } = reduce(s0, bundle, { type: "drop-on", slot: 0, cell: 4 });
    expect(state.board[4]).toBe("dough");
    // Dealer refills tray after the move, so we don't assert tray[0] is null.
    expect(state.made).toBe(1);
    expect(events.some((e) => e.type === "combine")).toBe(true);
  });

  it("dropping on a non-matching target emits 'nope' and does not spend the tile", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.board[4] = "oven";
    s0.tray = ["flour", null, null];
    const { state, events } = reduce(s0, bundle, { type: "drop-on", slot: 0, cell: 4 });
    expect(state.tray[0]).toBe("flour");
    expect(state.score).toBe(0);
    expect(events.some((e) => e.type === "nope")).toBe(true);
  });
});

describe("scoring", () => {
  it("concrete-sized recipe: round(20 * tier * 1 * (1 + 0.5*(n-2)))", () => {
    const bundle = fakeBundle({
      recipes: [R("concrete", ["cement", "sand", "gravel", "water"])],
      tiers: { concrete: "M" },
    });
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.board[0] = "cement";
    s0.board[1] = "sand";
    s0.board[3] = "gravel";
    s0.tray = ["water", null, null];
    // Place at cell 4 — adjacent to 1 and 3; the group grows to {0,1,3,4}.
    const { state } = reduce(s0, bundle, { type: "place", slot: 0, cell: 4 });
    // +1 for the place, +80 for the combine = 81.
    // 20 * tier(M=2) * 1 * (1 + 0.5*(4-2)) = 20 * 2 * 1 * 2 = 80.
    expect(state.score).toBe(81);
  });

  it("chain adds mult +1", () => {
    // Chain: a + b -> c (band 1), c + d -> e (also matches at the new cell).
    const bundle = fakeBundle({
      recipes: [R("c", ["a", "b"]), R("e", ["c", "d"])],
      tiers: { c: "M", e: "M" },
    });
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    // Lay out: d at 0, a at 3, b at 4. Placing nothing new; use drop-on? Easier:
    // Place a at 4 adjacent to b at 1, c lands at 4 next to d at 7.
    s0.board[0] = "d";
    s0.board[1] = "b";
    s0.tray = ["a", null, null];
    // Place a at 2 — adjacent to b at 1; group {1,2} makes c at cell 2 (first consumed).
    // Then c should chain with d at 0? Not adjacent. Try different layout:
    s0.board = Array(9).fill(null);
    s0.board[1] = "b";
    s0.board[2] = "d";
    s0.tray = ["a", null, null];
    // Place a at 0 — adjacent to b at 1. Group {0,1} → c lands at 0 or 1.
    // The engine prefers a cell where the new tile would combine; cell 1 is
    // adjacent to d at 2, so c lands at 1 and chains with d.
    const { state, events } = reduce(s0, bundle, { type: "place", slot: 0, cell: 0 });
    expect(state.longest).toBeGreaterThanOrEqual(2);
    const combines = events.filter((e) => e.type === "combine");
    expect(combines.length).toBe(2);
    // The chain step runs at mult=2.
    expect(combines[1]).toMatchObject({ mult: 2, out: "e" });
  });
});

describe("terminal outputs ship to the shelf", () => {
  const bundle = fakeBundle({
    recipes: [R("teacup", ["clay", "glaze"])],
    terminal: ["teacup"],
  });

  it("the terminal item hits the shelf and the cell empties", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.board[0] = "clay";
    s0.tray = ["glaze", null, null];
    const { state, events } = reduce(s0, bundle, { type: "place", slot: 0, cell: 1 });
    expect(state.shelf).toContain("teacup");
    expect(state.board.includes("teacup")).toBe(false);
    expect(events.some((e) => e.type === "shipped")).toBe(true);
  });
});

describe("age up + crumble + deal", () => {
  it("game-over fires when the board is full", () => {
    const bundle = fakeBundle({ recipes: [R("x", ["a", "b"])] });
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill("a");
    s0.board[8] = null;
    s0.tray = ["b", null, null];
    // b at 7 is adjacent to a's at 4,6,8 — but matchAt may form {7,...}.
    // We want to force a non-match so the board fills. Use a non-combining tile.
    s0.tray = ["z", null, null];
    const { state, events } = reduce(s0, bundle, { type: "place", slot: 0, cell: 8 });
    expect(state.over).toBe(true);
    expect(events.some((e) => e.type === "over")).toBe(true);
  });
});

describe("helpers (swap, clear, move)", () => {
  const bundle = fakeBundle({ recipes: [R("dough", ["flour", "water"])] });

  it("swap replaces the tray and decrements the count", () => {
    // Swap on the real Everyday bundle so there are enough recipes for the
    // dealer to populate three slots.
    const s0 = newGame("everyday", everyday, { seed: 2, size: 5 }).state;
    const beforeSwaps = s0.swaps;
    const { state } = reduce(s0, everyday, { type: "swap" });
    expect(state.swaps).toBe(beforeSwaps - 1);
    expect(state.tray.filter((t) => t != null).length).toBeGreaterThan(0);
  });

  it("clear removes a specific cell and decrements the count", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.board[4] = "flour";
    const { state } = reduce(s0, bundle, { type: "clear", cell: 4 });
    expect(state.board[4]).toBeNull();
    expect(state.clears).toBe(0);
  });

  it("move onto an empty cell relocates the tile", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.board[0] = "flour";
    const { state } = reduce(s0, bundle, { type: "move", from: 0, to: 8 });
    expect(state.board[0]).toBeNull();
    expect(state.board[8]).toBe("flour");
  });

  it("move onto a matching tile combines", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.board[0] = "flour";
    s0.board[8] = "water";
    const { state } = reduce(s0, bundle, { type: "move", from: 0, to: 8 });
    expect(state.board[8]).toBe("dough");
    expect(state.board[0]).toBeNull();
  });
});

describe("purity (no shared references with input)", () => {
  it("reduce does not mutate the previous state", () => {
    const bundle = fakeBundle({ recipes: [R("dough", ["flour", "water"])] });
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.board[0] = "water";
    s0.tray = ["flour", null, null];
    const snapshot = JSON.parse(JSON.stringify(s0));
    reduce(s0, bundle, { type: "place", slot: 0, cell: 1 });
    expect(s0).toEqual(snapshot);
  });
});
