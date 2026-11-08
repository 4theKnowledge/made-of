import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import { hasAnyLegalAction, newGame, reduce, type Action, type GameState } from "../engine";
import type { CombineRecipe, ThemeBundle } from "../types";

const snap = buildSnapshot(toRows(loadKnowledgeBase()));
const everything = buildThemeBundle(snap, "everything");

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
    slug: string;
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
      slug: id,
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
      collectionVersion: 0,
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

const R = (out: string, all: string[]): CombineRecipe => ({
  id: `test-${out}-${all.join("+")}`,
  out,
  from: all,
  with: [],
  needs: [],
  evolved: [],
  all,
  lvl: 1,
  band: 1,
});

describe("newGame", () => {
  it("fills the tray and seeds a few starting tiles", () => {
    const { state, events } = newGame("everything", everything, { seed: 1, size: 5 });
    expect(state.tray.filter((t) => t != null).length).toBe(3);
    expect(state.board.filter(Boolean).length).toBeGreaterThan(0);
    expect(state.score).toBe(0);
    expect(state.over).toBe(false);
    expect(events.some((e) => e.type === "dealt")).toBe(true);
  });

  it("is deterministic for a given seed", () => {
    const a = newGame("everything", everything, { seed: 42, size: 5 });
    const b = newGame("everything", everything, { seed: 42, size: 5 });
    expect(a.state.board).toEqual(b.state.board);
    expect(a.state.tray).toEqual(b.state.tray);
  });

  it("daily seed → identical start for everyone", () => {
    const a = newGame("everything", everything, { daily: "2026-11-01" });
    const b = newGame("everything", everything, { daily: "2026-11-01" });
    expect(a.state.board).toEqual(b.state.board);
    expect(a.state.tray).toEqual(b.state.tray);
    expect(a.state.n).toBe(6);
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
    expect(events.some((e) => e.type === "placed")).toBe(true);
    expect(events.some((e) => e.type === "combine")).toBe(true);
    expect(events.some((e) => e.type === "discovery")).toBe(true);
    expect(state.found).toContain("dough");
    // Mastery: the combine event carries the sorted-ingredient signature so
    // the client can tag the discovery with the exact variant used.
    const combineEv = events.find((e) => e.type === "combine");
    expect(combineEv && "inputSignature" in combineEv ? combineEv.inputSignature : "").toBe("flour+water");
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

// ageMade describe block deleted — banded "on-band first-find" counter
// no longer exists; chapter progression is driven by state.found.length.
// Discovery semantics covered by `found` assertions elsewhere.

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
  it("a full board alone is not game-over if the player can still act", () => {
    // Full board, but tray tiles exist and the player has spends. The player
    // can still `drop-on`, `move`, `swap`, etc., so the run continues.
    const bundle = fakeBundle({ recipes: [R("x", ["a", "b"])] });
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill("a");
    s0.board[8] = null;
    s0.tray = ["z", null, null]; // non-combining
    // Keep default spends: mv=2, swaps=2, clears=1, hold capacity=1.
    const { state, events } = reduce(s0, bundle, { type: "place", slot: 0, cell: 8 });
    expect(state.board.every((v) => v != null)).toBe(true);
    expect(state.over).toBe(false);
    expect(events.some((e) => e.type === "over")).toBe(false);
  });

  it("hasAnyLegalAction: dead-end full board returns false", () => {
    // Full board of a tile that isn't in any recipe, empty tray and hold,
    // all spends at 0 — truly nothing the player can do.
    const bundle = fakeBundle({ recipes: [R("x", ["a", "b"])] });
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill("z"); // "z" is not an ingredient of any recipe
    s0.tray = [null, null, null];
    s0.hold = [];
    s0.swaps = 0;
    s0.clears = 0;
    s0.mv = 0;
    expect(hasAnyLegalAction(s0, bundle)).toBe(false);
  });

  it("hasAnyLegalAction: full board + drop-on match returns true", () => {
    // Full board, no spends, no hold, but a tray tile combines onto an
    // occupied cell. That `drop-on` is a legal action, so not game-over.
    const bundle = fakeBundle({ recipes: [R("x", ["a", "b"])] });
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill("a");
    s0.tray = ["b", null, null]; // `b` drop-on any `a` combines
    s0.hold = [];
    s0.swaps = 0;
    s0.clears = 0;
    s0.mv = 0;
    expect(hasAnyLegalAction(s0, bundle)).toBe(true);
  });

  it("hasAnyLegalAction: full board + swap remaining returns true", () => {
    // Full board of a dead tile, empty tray/hold, but `swaps > 0` means
    // the player can still reroll. Not game-over.
    const bundle = fakeBundle({ recipes: [R("x", ["a", "b"])] });
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill("z");
    s0.tray = [null, null, null];
    s0.hold = [];
    s0.swaps = 1;
    s0.clears = 0;
    s0.mv = 0;
    expect(hasAnyLegalAction(s0, bundle)).toBe(true);
  });

  it("hasAnyLegalAction: full board + mv but no empty neighbour returns false", () => {
    // `mv > 0` only rescues when a move can either relocate to an empty
    // cell or combine with a neighbour. Full board of a non-recipe tile
    // means neither applies.
    const bundle = fakeBundle({ recipes: [R("x", ["a", "b"])] });
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill("z");
    s0.tray = [null, null, null];
    s0.hold = [];
    s0.swaps = 0;
    s0.clears = 0;
    s0.mv = 5;
    expect(hasAnyLegalAction(s0, bundle)).toBe(false);
  });

  it("hasAnyLegalAction: full board of same tile + mv returns false", () => {
    // Even if the tile is part of a recipe, `matchOn` needs distinct tiles,
    // and no cell is empty for relocation.
    const bundle = fakeBundle({ recipes: [R("x", ["a", "b"])] });
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill("a");
    s0.tray = [null, null, null];
    s0.hold = [];
    s0.swaps = 0;
    s0.clears = 0;
    s0.mv = 5;
    expect(hasAnyLegalAction(s0, bundle)).toBe(false);
  });

  it("hasAnyLegalAction: full board + clears > 0 returns true", () => {
    // `clear` removes a cell — always legal when the board has any tile
    // and the player has a clear left.
    const bundle = fakeBundle({ recipes: [R("x", ["a", "b"])] });
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill("z");
    s0.tray = [null, null, null];
    s0.hold = [];
    s0.swaps = 0;
    s0.clears = 1;
    s0.mv = 0;
    expect(hasAnyLegalAction(s0, bundle)).toBe(true);
  });

  it("hasAnyLegalAction: full board + hold capacity + tray tile returns true", () => {
    // A tray tile can always move into a free hold slot. Legal action.
    const bundle = fakeBundle({ recipes: [R("x", ["a", "b"])] });
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill("z");
    s0.tray = ["z", null, null];
    s0.hold = [null]; // capacity 1, empty
    s0.swaps = 0;
    s0.clears = 0;
    s0.mv = 0;
    expect(hasAnyLegalAction(s0, bundle)).toBe(true);
  });
});

describe("helpers (swap, clear, move)", () => {
  const bundle = fakeBundle({ recipes: [R("dough", ["flour", "water"])] });

  it("swap replaces the tray and decrements the count", () => {
    // Swap on the real Everything bundle so there are enough recipes for the
    // dealer to populate three slots.
    const s0 = newGame("everything", everything, { seed: 2, size: 5 }).state;
    const beforeSwaps = s0.swaps;
    const { state } = reduce(s0, everything, { type: "swap" });
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

  it("shore marks the tile permanently exempt from crumble", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.board[4] = "flour";
    s0.crumb[4] = { id: "flour", n: 2 };
    const beforeShore = s0.shore;
    const beforeMoves = s0.moves;
    const { state } = reduce(s0, bundle, { type: "shore", cell: 4 });
    expect(state.crumb[4]).toBeNull();
    expect(state.shored[4]).toBe(true);
    expect(state.board[4]).toBe("flour");
    expect(state.shore).toBe(beforeShore - 1);
    expect(state.moves).toBe(beforeMoves);
  });

  it("shore refuses tiles with no crumble counter", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.board[4] = "flour";
    s0.crumb[4] = null;
    const beforeShore = s0.shore;
    const { state } = reduce(s0, bundle, { type: "shore", cell: 4 });
    expect(state.shore).toBe(beforeShore);
    expect(state).toEqual(s0);
  });

  it("shore refuses empty cells", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    const beforeShore = s0.shore;
    const { state } = reduce(s0, bundle, { type: "shore", cell: 4 });
    expect(state.shore).toBe(beforeShore);
  });

  it("shore refuses when the counter is zero", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.board[4] = "flour";
    s0.crumb[4] = { id: "flour", n: 2 };
    s0.shore = 0;
    const { state } = reduce(s0, bundle, { type: "shore", cell: 4 });
    expect(state.crumb[4]).not.toBeNull();
    expect(state.shore).toBe(0);
  });

  it("a shored tile survives repeated age-advancement crumble ticks", () => {
    // Place a stale tile (not useful in the current age), shore it, then
    // make a bunch of unrelated moves. The counter never re-arms and the
    // tile never falls off the board.
    const b = fakeBundle({
      recipes: [R("dough", ["flour", "water"])],
    });
    const s0 = newGame("everything", b, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    // "stone" isn't used by any recipe → it's crumble-eligible immediately.
    s0.board[4] = "stone";
    s0.crumb[4] = { id: "stone", n: 1 };
    const afterShore = reduce(s0, b, { type: "shore", cell: 4 }).state;
    expect(afterShore.shored[4]).toBe(true);

    // Do many placements (any no-op action that triggers afterMove's crumble
    // pass is enough; we simulate turns by placing + removing).
    let s = afterShore;
    for (let i = 0; i < 10; i++) {
      s.tray = ["flour", null, null];
      s = reduce(s, b, { type: "place", slot: 0, cell: 0 }).state;
      s.board[0] = null;
    }
    expect(s.board[4]).toBe("stone");
    expect(s.shored[4]).toBe(true);
  });

  it("clearing a shored tile drops the shore flag", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.board[4] = "flour";
    s0.crumb[4] = { id: "flour", n: 2 };
    s0.clears = 1;
    const afterShore = reduce(s0, bundle, { type: "shore", cell: 4 }).state;
    expect(afterShore.shored[4]).toBe(true);
    const afterClear = reduce(afterShore, bundle, { type: "clear", cell: 4 }).state;
    expect(afterClear.board[4]).toBeNull();
    expect(afterClear.shored[4]).toBe(false);
  });

  it("moving a shored tile carries the shore flag to the new cell", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.board[4] = "flour";
    s0.crumb[4] = { id: "flour", n: 2 };
    const afterShore = reduce(s0, bundle, { type: "shore", cell: 4 }).state;
    const afterMove = reduce(afterShore, bundle, {
      type: "move",
      from: 4,
      to: 0,
    }).state;
    expect(afterMove.board[0]).toBe("flour");
    expect(afterMove.shored[0]).toBe(true);
    expect(afterMove.shored[4]).toBe(false);
  });
});

describe("hold zone", () => {
  // Age-0 recipe (band 1) plus a band-3 recipe so some tiles stop being
  // useful once the player ages up past band 1.
  const bundle = fakeBundle({
    recipes: [
      R("dough", ["flour", "water"]),
      // "future" sits in band 3; its ingredients aren't in `USE` for ages
      // 0 or 1 (which see bands [0,1,2] and [1,2,3] respectively), so a
      // held "future-tool" tile should crumble when ageing from 0 → 1.
      { id: "test-warp-spice", out: "warp", from: ["spice"], with: [], needs: [], evolved: [], all: ["spice"], lvl: 1, band: 3 },
    ],
  });

  function state0() {
    const s = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s.board = Array(9).fill(null);
    return s;
  }

  it("hold stashes a tray tile and clears the tray slot", () => {
    const s0 = state0();
    s0.tray = ["flour", "water", null];
    const { state } = reduce(s0, bundle, { type: "hold", slot: 0 });
    expect(state.hold[0]).toBe("flour");
    // Dealer refills the tray at the end of the move; just assert the
    // specific slot that was consumed is no longer "flour".
    expect(state.tray[0]).not.toBe("flour");
  });

  it("hold counts as a move (increments moves and triggers afterMove)", () => {
    const s0 = state0();
    s0.tray = ["flour", null, null];
    const before = s0.moves;
    const { state } = reduce(s0, bundle, { type: "hold", slot: 0 });
    expect(state.moves).toBe(before + 1);
  });

  it("hold is a no-op when all hold slots are full", () => {
    const s0 = state0();
    s0.tray = ["flour", null, null];
    s0.hold = ["water"]; // age-0 capacity is 1 and it's full
    const { state, events } = reduce(s0, bundle, { type: "hold", slot: 0 });
    expect(state).toBe(s0);
    expect(events).toEqual([]);
  });

  it("hold is a no-op when the tray slot is empty", () => {
    const s0 = state0();
    s0.tray = [null, null, null];
    const { state, events } = reduce(s0, bundle, { type: "hold", slot: 0 });
    expect(state).toBe(s0);
    expect(events).toEqual([]);
  });

  it("placing from hold combines like placing from the tray", () => {
    const s0 = state0();
    s0.board[0] = "water";
    s0.hold = ["flour"];
    s0.tray = [null, null, null];
    const { state, events } = reduce(s0, bundle, {
      type: "place",
      slot: 0,
      cell: 1,
      source: "hold",
    });
    expect(state.board[1]).toBe("dough");
    expect(state.hold[0]).toBeNull();
    expect(events.some((e) => e.type === "combine")).toBe(true);
  });

  it("drop-on from hold combines like drop-on from the tray", () => {
    const s0 = state0();
    s0.board[4] = "water";
    s0.hold = ["flour"];
    s0.tray = [null, null, null];
    const { state } = reduce(s0, bundle, {
      type: "drop-on",
      slot: 0,
      cell: 4,
      source: "hold",
    });
    expect(state.board[4]).toBe("dough");
    expect(state.hold[0]).toBeNull();
  });

  // Banded age-up + hold-crumble tests removed — replaced by
  // chapter-based progression. New coverage lands in phase 7.
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

describe("recipe picker ordering", () => {
  // Four outputs sharing one ingredient set — enough recipes that a
  // random shuffle will almost always visibly reorder them.
  const bundle = fakeBundle({
    recipes: [
      R("saw", ["steel", "wood"]),
      R("wheel", ["steel", "wood"]),
      R("axle", ["steel", "wood"]),
      R("gear", ["steel", "wood"]),
    ],
  });

  function paused(found: string[] = [], seed = 1) {
    const s = newGame("everything", bundle, { seed, size: 3 }).state;
    s.board = Array(9).fill(null);
    s.board[0] = "wood";
    s.tray = ["steel", null, null];
    s.found = [...found];
    const { state } = reduce(s, bundle, { type: "place", slot: 0, cell: 1 });
    return state;
  }

  it("found outputs appear before never-seen ones", () => {
    const state = paused(["wheel", "axle"]);
    const opts = state.choosing!.options.map((r) => r.out);
    const firstTwo = new Set(opts.slice(0, 2));
    const lastTwo = new Set(opts.slice(2));
    expect(firstTwo).toEqual(new Set(["wheel", "axle"]));
    expect(lastTwo).toEqual(new Set(["saw", "gear"]));
  });

  it("found outputs preserve the natural (stable) order from alternatives", () => {
    // Found both wheel and axle — their relative order should match the
    // recipe list ordering, so a player who memorised "wheel is above
    // axle" doesn't get punished.
    const a = paused(["wheel", "axle"], 1);
    const b = paused(["wheel", "axle"], 999);
    const foundA = a.choosing!.options.slice(0, 2).map((r) => r.out);
    const foundB = b.choosing!.options.slice(0, 2).map((r) => r.out);
    expect(foundA).toEqual(foundB);
  });

  it("unknown outputs are shuffled by state.rng (deterministic for a given seed)", () => {
    // Same seed → same order.
    const a = paused([], 1);
    const b = paused([], 1);
    expect(a.choosing!.options.map((r) => r.out)).toEqual(
      b.choosing!.options.map((r) => r.out),
    );
  });

  it("unknown shuffle produces different orders for different seeds", () => {
    // At least one of a few seeds should diverge from seed=1 — otherwise
    // the "shuffle" is not actually randomising. We test the invariant
    // rather than a specific permutation (keeps the test robust to RNG
    // tweaks).
    const base = paused([], 1).choosing!.options.map((r) => r.out).join(",");
    const alt = [2, 3, 4, 5, 6, 7, 8]
      .map((s) => paused([], s).choosing!.options.map((r) => r.out).join(","))
      .some((o) => o !== base);
    expect(alt).toBe(true);
  });

  it("all alternatives still appear in the picker (nothing dropped)", () => {
    const state = paused(["wheel"], 1);
    const outs = new Set(state.choosing!.options.map((r) => r.out));
    expect(outs).toEqual(new Set(["saw", "wheel", "axle", "gear"]));
  });
});

describe("undo", () => {
  const bundle = fakeBundle({ recipes: [R("dough", ["flour", "water"])] });

  function base() {
    const s = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s.board = Array(9).fill(null);
    return s;
  }

  it("starts with one undo charge and no snapshot on a fresh game", () => {
    const s0 = base();
    expect(s0.undos).toBe(1);
    expect(s0.lastSnapshot).toBeNull();
  });

  it("a plain place captures a snapshot of the pre-move state", () => {
    const s0 = base();
    s0.tray = ["flour", null, null];
    const { state } = reduce(s0, bundle, { type: "place", slot: 0, cell: 4 });
    expect(state.lastSnapshot).not.toBeNull();
    // The snapshot is of the pre-move state — board was empty.
    expect(state.lastSnapshot!.board.every((v) => v == null)).toBe(true);
  });

  it("undo rewinds the last placement and consumes a charge", () => {
    const s0 = base();
    s0.tray = ["flour", null, null];
    const { state: afterPlace } = reduce(s0, bundle, {
      type: "place",
      slot: 0,
      cell: 4,
    });
    expect(afterPlace.board[4]).toBe("flour");
    const { state: undone } = reduce(afterPlace, bundle, { type: "undo" });
    expect(undone.board[4]).toBeNull();
    expect(undone.tray[0]).toBe("flour");
    expect(undone.score).toBe(0);
    expect(undone.moves).toBe(0);
    expect(undone.undos).toBe(0);
    expect(undone.lastSnapshot).toBeNull();
  });

  it("undo is blocked when the previous turn produced a discovery", () => {
    const s0 = base();
    s0.board[0] = "water";
    s0.tray = ["flour", null, null];
    const { state } = reduce(s0, bundle, { type: "place", slot: 0, cell: 1 });
    expect(state.found).toContain("dough"); // discovery fired
    expect(state.lastSnapshot).toBeNull();
    // Attempting undo is a no-op.
    const { state: tried, events } = reduce(state, bundle, { type: "undo" });
    expect(tried).toBe(state);
    expect(events).toEqual([]);
    // Charge not consumed.
    expect(tried.undos).toBe(1);
  });

  it("undo is a no-op when there is no snapshot", () => {
    const s0 = base();
    expect(s0.lastSnapshot).toBeNull();
    const { state, events } = reduce(s0, bundle, { type: "undo" });
    expect(state).toBe(s0);
    expect(events).toEqual([]);
  });

  it("undo is a no-op when charges are exhausted", () => {
    const s0 = base();
    s0.undos = 0;
    s0.tray = ["flour", null, null];
    const { state: afterPlace } = reduce(s0, bundle, {
      type: "place",
      slot: 0,
      cell: 4,
    });
    // A snapshot was captured, but undos is 0 so undo refuses.
    expect(afterPlace.lastSnapshot).not.toBeNull();
    const { state: tried } = reduce(afterPlace, bundle, { type: "undo" });
    expect(tried).toBe(afterPlace);
  });

  it("only one undo is allowed per run (can't undo twice from one charge)", () => {
    const s0 = base();
    s0.tray = ["flour", null, null];
    const { state: a } = reduce(s0, bundle, { type: "place", slot: 0, cell: 4 });
    const { state: b } = reduce(a, bundle, { type: "undo" });
    expect(b.undos).toBe(0);
    // Now place again and try to undo — no charges left.
    b.tray = ["flour", null, null];
    const { state: c } = reduce(b, bundle, { type: "place", slot: 0, cell: 4 });
    const { state: d } = reduce(c, bundle, { type: "undo" });
    expect(d).toBe(c);
  });

  it("undo also rewinds a drop-on that did not discover anything", () => {
    const s0 = base();
    s0.board[4] = "water";
    s0.tray = ["flour", null, null];
    // Pre-seed so the resulting dough is NOT a new discovery.
    s0.found = ["dough"];
    const { state: afterDrop } = reduce(s0, bundle, {
      type: "drop-on",
      slot: 0,
      cell: 4,
    });
    expect(afterDrop.board[4]).toBe("dough");
    const { state: undone } = reduce(afterDrop, bundle, { type: "undo" });
    expect(undone.board[4]).toBe("water");
    expect(undone.tray[0]).toBe("flour");
    expect(undone.undos).toBe(0);
  });

  it("undo rewinds a non-matching move (just a relocation)", () => {
    const s0 = base();
    s0.board[0] = "flour";
    s0.mv = 1;
    const { state: afterMove } = reduce(s0, bundle, {
      type: "move",
      from: 0,
      to: 4,
    });
    expect(afterMove.board[0]).toBeNull();
    expect(afterMove.board[4]).toBe("flour");
    const { state: undone } = reduce(afterMove, bundle, { type: "undo" });
    expect(undone.board[0]).toBe("flour");
    expect(undone.board[4]).toBeNull();
    expect(undone.undos).toBe(0);
  });

  it("undo after a non-matching 'nope' drop is a no-op (snapshot not taken)", () => {
    const s0 = base();
    s0.board[4] = "stone"; // doesn't combine with flour
    s0.tray = ["flour", null, null];
    const { state } = reduce(s0, bundle, { type: "drop-on", slot: 0, cell: 4 });
    expect(state.lastSnapshot).toBeNull();
    const { state: tried } = reduce(state, bundle, { type: "undo" });
    expect(tried).toBe(state);
  });

  it("undo does not resurrect a snapshot (the restored state has no further snapshot)", () => {
    const s0 = base();
    s0.tray = ["flour", null, null];
    const { state: afterPlace } = reduce(s0, bundle, {
      type: "place",
      slot: 0,
      cell: 4,
    });
    const { state: undone } = reduce(afterPlace, bundle, { type: "undo" });
    expect(undone.lastSnapshot).toBeNull();
  });
});

describe("move helper spends a charge", () => {
  const bundle = fakeBundle({ recipes: [R("dough", ["flour", "water"])] });

  it("move decrements state.mv on success", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.board[0] = "flour";
    const before = s0.mv;
    const { state } = reduce(s0, bundle, { type: "move", from: 0, to: 8 });
    expect(state.mv).toBe(before - 1);
  });

  it("move refuses when state.mv is 0 and leaves state untouched", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.board[0] = "flour";
    s0.mv = 0;
    const { state } = reduce(s0, bundle, { type: "move", from: 0, to: 8 });
    expect(state).toBe(s0);
    expect(state.board[0]).toBe("flour");
    expect(state.board[8]).toBeNull();
  });
});

describe("debug mode", () => {
  const bundle = fakeBundle({ recipes: [R("dough", ["flour", "water"])] });

  function debugGame(): GameState {
    const s = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s.debug = true;
    s.board = Array(9).fill(null);
    return s;
  }

  it("debug-toggle flips the flag", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    expect(s0.debug).toBe(false);
    const { state: on } = reduce(s0, bundle, { type: "debug-toggle" });
    expect(on.debug).toBe(true);
    const { state: off } = reduce(on, bundle, { type: "debug-toggle" });
    expect(off.debug).toBe(false);
  });

  it("swap does not consume a charge in debug mode", () => {
    const s0 = newGame("everything", everything, { seed: 2, size: 5 }).state;
    s0.debug = true;
    s0.swaps = 0;
    const { state } = reduce(s0, everything, { type: "swap" });
    expect(state.swaps).toBe(0);
    expect(state.tray.filter(Boolean).length).toBeGreaterThan(0);
  });

  it("clear works with no charges in debug mode", () => {
    const s0 = debugGame();
    s0.clears = 0;
    s0.board[4] = "flour";
    const { state } = reduce(s0, bundle, { type: "clear", cell: 4 });
    expect(state.clears).toBe(0);
    expect(state.board[4]).toBeNull();
  });

  it("hint works with no charges in debug mode", () => {
    const s0 = debugGame();
    s0.hints = 0;
    const { state } = reduce(s0, bundle, { type: "hint" });
    expect(state.hints).toBe(0);
    expect(state).not.toBe(s0);
  });

  it("move works with no charges in debug mode", () => {
    const s0 = debugGame();
    s0.mv = 0;
    s0.board[0] = "flour";
    const { state } = reduce(s0, bundle, { type: "move", from: 0, to: 8 });
    expect(state.mv).toBe(0);
    expect(state.board[0]).toBeNull();
    expect(state.board[8]).toBe("flour");
  });

  it("shore works with no charges in debug mode", () => {
    const s0 = debugGame();
    s0.shore = 0;
    s0.board[4] = "flour";
    s0.crumb[4] = { id: "flour", n: 2 };
    const { state } = reduce(s0, bundle, { type: "shore", cell: 4 });
    expect(state.shore).toBe(0);
    expect(state.shored[4]).toBe(true);
  });

  it("debug-deal places a specific tile into the given slot", () => {
    const s0 = debugGame();
    s0.tray = [null, null, null];
    const { state } = reduce(s0, bundle, {
      type: "debug-deal",
      slot: 1,
      tile: "flour",
    });
    expect(state.tray[1]).toBe("flour");
  });

  it("debug-deal is a no-op when not in debug mode", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.tray = [null, null, null];
    const { state } = reduce(s0, bundle, {
      type: "debug-deal",
      slot: 0,
      tile: "flour",
    });
    expect(state).toBe(s0);
  });

  it("debug-deal rejects a tile not in the bundle", () => {
    const s0 = debugGame();
    const { state } = reduce(s0, bundle, {
      type: "debug-deal",
      slot: 0,
      tile: "unobtainium",
    });
    expect(state).toBe(s0);
  });

  it("debug-set-age jumps age, clears board, re-deals the tray", () => {
    const s0 = newGame("everything", everything, { seed: 2, size: 5 }).state;
    s0.debug = true;
    s0.chapter = 0;
    s0.board.fill("flour");
    const { state, events } = reduce(s0, everything, {
      type: "debug-set-chapter",
      chapter: 2,
    });
    expect(state.chapter).toBe(2);
    expect(state.board.every((c) => c == null)).toBe(true);
    expect(state.tray.filter(Boolean).length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "chapter-up")).toBe(true);
    expect(events.some((e) => e.type === "dealt")).toBe(true);
  });

  it("debug-set-age clamps to the last available age", () => {
    const s0 = newGame("everything", everything, { seed: 2, size: 5 }).state;
    s0.debug = true;
    const last = everything.theme.ages.length - 1;
    const { state } = reduce(s0, everything, {
      type: "debug-set-chapter",
      chapter: 999,
    });
    expect(state.chapter).toBe(last);
  });

  it("debug-set-age is a no-op when not in debug mode", () => {
    const s0 = newGame("everything", everything, { seed: 2, size: 5 }).state;
    const { state } = reduce(s0, everything, {
      type: "debug-set-chapter",
      chapter: 2,
    });
    expect(state).toBe(s0);
  });
});

describe("pluck-to-hold", () => {
  const bundle = fakeBundle({
    recipes: [R("dough", ["flour", "water"])],
  });

  function state0() {
    const s = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s.board = Array(9).fill(null);
    return s;
  }

  it("lifts a board tile into the first empty hold slot and spends a charge", () => {
    const s0 = state0();
    s0.board[4] = "flour";
    s0.hold = [null, null];
    s0.pluck = 2;
    const { state } = reduce(s0, bundle, { type: "pluck-hold", cell: 4 });
    expect(state.board[4]).toBeNull();
    expect(state.hold[0]).toBe("flour");
    expect(state.pluck).toBe(1);
  });

  it("is a no-op when the target cell is empty", () => {
    const s0 = state0();
    s0.pluck = 1;
    s0.hold = [null];
    const { state, events } = reduce(s0, bundle, { type: "pluck-hold", cell: 0 });
    expect(state).toBe(s0);
    expect(events).toEqual([]);
  });

  it("is a no-op when hold has no free slot", () => {
    const s0 = state0();
    s0.board[4] = "flour";
    s0.pluck = 1;
    s0.hold = ["water"]; // capacity 1 at age 0, full
    const { state, events } = reduce(s0, bundle, { type: "pluck-hold", cell: 4 });
    expect(state).toBe(s0);
    expect(events).toEqual([]);
  });

  it("is a no-op when the player has no pluck charges", () => {
    const s0 = state0();
    s0.board[4] = "flour";
    s0.hold = [null];
    s0.pluck = 0;
    const { state, events } = reduce(s0, bundle, { type: "pluck-hold", cell: 4 });
    expect(state).toBe(s0);
    expect(events).toEqual([]);
  });

  it("clears the shore flag on the source cell", () => {
    const s0 = state0();
    s0.board[4] = "flour";
    s0.shored[4] = true;
    s0.hold = [null];
    s0.pluck = 1;
    const { state } = reduce(s0, bundle, { type: "pluck-hold", cell: 4 });
    expect(state.shored[4]).toBe(false);
  });
});

describe("wipe-board", () => {
  // A longer-reach bundle so we can get to age 2 for the unlock tests.
  const bundle = fakeBundle({
    recipes: [
      R("dough", ["flour", "water"]),
      { id: "test-bread", out: "bread", from: ["dough", "fire"], with: [], needs: [], evolved: [], all: ["dough", "fire"], lvl: 2, band: 2 },
      { id: "test-feast", out: "feast", from: ["bread", "spice"], with: [], needs: [], evolved: [], all: ["bread", "spice"], lvl: 3, band: 3 },
    ],
  });

  function state0() {
    const s = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s.board = Array(9).fill(null);
    return s;
  }

  it("is a no-op below the unlock age", () => {
    const s0 = state0();
    s0.chapter = 1;
    s0.board[0] = "flour";
    const { state, events } = reduce(s0, bundle, { type: "wipe-board" });
    expect(state).toBe(s0);
    expect(events).toEqual([]);
  });

  it("clears the board, hold, crumb, and shored flags when unlocked", () => {
    const s0 = state0();
    s0.chapter = 2;
    s0.board[0] = "flour";
    s0.board[4] = "water";
    s0.hold = [null, null, "dough"];
    s0.shored[0] = true;
    s0.crumb[4] = { id: "water", n: 2 };
    const { state } = reduce(s0, bundle, { type: "wipe-board" });
    expect(state.board.every((c) => c == null)).toBe(true);
    // Hold resizes to the new (lower) age's capacity and is empty.
    expect(state.hold.every((v) => v == null)).toBe(true);
    expect(state.shored.every((v) => !v)).toBe(true);
    expect(state.crumb.every((c) => c == null)).toBe(true);
  });

  it("drops the player back one age and resets ageMade", () => {
    const s0 = state0();
    s0.chapter = 2;
    const { state } = reduce(s0, bundle, { type: "wipe-board" });
    expect(state.chapter).toBe(1);
  });

  it("preserves score, discoveries, shelf, and run history", () => {
    const s0 = state0();
    s0.chapter = 2;
    s0.score = 1234;
    s0.made = 7;
    s0.longest = 3;
    s0.found = ["dough", "bread"];
    s0.shelf = ["bread"];
    s0.madeCounts = { dough: 4, bread: 2 };
    s0.howMade = { bread: ["dough", "fire"] };
    const { state } = reduce(s0, bundle, { type: "wipe-board" });
    expect(state.score).toBe(1234);
    expect(state.made).toBe(7);
    expect(state.longest).toBe(3);
    expect(state.found).toEqual(["dough", "bread"]);
    expect(state.shelf).toEqual(["bread"]);
    expect(state.madeCounts.dough).toBe(4);
    expect(state.howMade.bread).toEqual(["dough", "fire"]);
  });

  it("deals a fresh tray after wiping", () => {
    const s0 = state0();
    s0.chapter = 2;
    s0.tray = ["flour", "water", "spice"];
    const { state, events } = reduce(s0, bundle, { type: "wipe-board" });
    expect(state.tray.some((t) => t != null)).toBe(true);
    expect(events.some((e) => e.type === "wipe")).toBe(true);
    expect(events.some((e) => e.type === "dealt")).toBe(true);
  });

  it("re-locks itself when the age cost drops the player below the unlock threshold", () => {
    // At the unlock age exactly, one wipe drops you below it. A second
    // wipe should be a no-op without climbing back up.
    const s0 = state0();
    s0.chapter = 2;
    const { state: afterOne } = reduce(s0, bundle, { type: "wipe-board" });
    expect(afterOne.chapter).toBe(1);
    const { state: afterTwo, events } = reduce(afterOne, bundle, {
      type: "wipe-board",
    });
    expect(afterTwo).toBe(afterOne);
    expect(events).toEqual([]);
  });

  it("clears the lastSnapshot so a run can't be undone back across a wipe", () => {
    const s0 = state0();
    s0.chapter = 2;
    s0.lastSnapshot = cloneForTest(s0);
    const { state } = reduce(s0, bundle, { type: "wipe-board" });
    expect(state.lastSnapshot).toBeNull();
  });
});

describe("finish (player-chosen end-of-run)", () => {
  const bundle = fakeBundle({
    recipes: [R("dough", ["flour", "water"])],
  });

  it("endless + score > 0 → ends the run", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.score = 12;
    const { state, events } = reduce(s0, bundle, { type: "finish" });
    expect(state.over).toBe(true);
    expect(events).toContainEqual({ type: "over" });
  });

  it("endless + score 0 → no-op (prevents misclick zero-score runs)", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.score = 0;
    const { state, events } = reduce(s0, bundle, { type: "finish" });
    expect(state).toBe(s0);
    expect(events).toEqual([]);
  });

  it("daily + score > 0 but no last-chance state → no-op", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3, mode: "daily", daily: "2026-01-01" }).state;
    s0.score = 50;
    const { state, events } = reduce(s0, bundle, { type: "finish" });
    expect(state).toBe(s0);
    expect(events).toEqual([]);
  });

  it("already over → no-op", () => {
    const s0 = newGame("everything", bundle, { seed: 1, size: 3 }).state;
    s0.score = 12;
    s0.over = true;
    const { state, events } = reduce(s0, bundle, { type: "finish" });
    expect(state).toBe(s0);
    expect(events).toEqual([]);
  });
});

describe("promote (1-input recipes)", () => {
  // Minimal bundle with a 1-input chain (a → b → c) plus a sibling
  // 1-input (a → d) so we can exercise the choosing path too. The
  // dummy 2-input recipe at the end keeps ingredients from being
  // empty — otherwise newGame would refuse to deal.
  const bundle = fakeBundle({
    recipes: [
      R("b", ["a"]),
      R("c", ["b"]),
      R("d", ["a"]),
      R("ab", ["a", "x"]),
    ],
  });

  function seedState(): GameState {
    const s = newGame("everything", bundle, { seed: 1, size: 5 }).state;
    s.board.fill(null);
    s.crumb.fill(null);
    s.shored.fill(false);
    s.tray.fill(null);
    s.hold.fill(null);
    s.found = [];
    s.score = 0;
    s.moves = 0;
    s.made = 0;
    return s;
  }

  // Separate bundle with only ONE 1-input recipe for "c" so the
  // immediate-fire + unknown-reveal cases exercise cleanly without being
  // steered into `choosing`.
  const bundleC = fakeBundle({
    recipes: [R("y", ["c"]), R("ab", ["a", "x"])],
  });
  function seedStateC(): GameState {
    const s = newGame("everything", bundleC, { seed: 1, size: 5 }).state;
    s.board.fill(null);
    s.crumb.fill(null);
    s.shored.fill(false);
    s.tray.fill(null);
    s.hold.fill(null);
    s.found = [];
    s.score = 0;
    s.moves = 0;
    s.made = 0;
    return s;
  }

  it("fires a sole 1-input recipe even when the output is unknown (discovery via promote)", () => {
    const s = seedStateC();
    s.board[0] = "c";
    // y is NOT in found — the player hasn't discovered it yet. Promote
    // should still fire (option A: discovery via play).
    const { state } = reduce(s, bundleC, { type: "promote", cell: 0 });
    expect(state.board[0]).toBe("y");
    // y should now be in `found` as a discovery.
    expect(state.found).toContain("y");
    expect(state.moves).toBe(1);
  });

  it("fires immediately when there's only one 1-input recipe (known or not)", () => {
    const s = seedStateC();
    s.board[0] = "c";
    s.found.push("y"); // known this time — same outcome, no choosing.
    const { state } = reduce(s, bundleC, { type: "promote", cell: 0 });
    expect(state.board[0]).toBe("y");
    expect(state.choosing).toBeNull();
  });

  it("multiple 1-input recipes → choosing state regardless of `found`", () => {
    const s = seedState();
    s.board[0] = "a";
    // Neither b nor d are known; both are still offered (A: no gating).
    const { state } = reduce(s, bundle, { type: "promote", cell: 0 });
    expect(state.board[0]).toBe("a");
    expect(state.choosing).not.toBeNull();
    expect(state.choosing!.options.map((r) => r.out).sort()).toEqual([
      "b",
      "d",
    ]);
  });

  it("no-op when the target cell is empty", () => {
    const s = seedStateC();
    const { state, events } = reduce(s, bundleC, { type: "promote", cell: 5 });
    expect(state.board[5]).toBeNull();
    expect(state.moves).toBe(0);
    expect(events).toEqual([]);
  });

  it("no-op when the tile has no 1-input recipe", () => {
    const s = seedState();
    s.board[0] = "x"; // x has no 1-input recipe in `bundle`.
    const { state, events } = reduce(s, bundle, { type: "promote", cell: 0 });
    expect(state.board[0]).toBe("x");
    expect(state.moves).toBe(0);
    expect(events).toEqual([]);
  });

  it("howMade updates to the most recently used recipe, not just the first", () => {
    // Bundle: two paths to `hg` — a 2-input (ng + w) and a 1-input (w).
    // Mirrors water → hydrogen-gas in the real KB.
    const b2 = fakeBundle({
      recipes: [R("hg", ["ng", "w"]), R("hg", ["w"])],
    });
    let s = newGame("everything", b2, { seed: 1, size: 5 }).state;
    s.board.fill(null);
    s.crumb.fill(null);
    s.shored.fill(false);
    s.hold.fill(null);
    s.tray = ["w", null, null];
    s.board[1] = "ng";
    // First make via 2-input: howMade = [ng, w].
    s = reduce(s, b2, { type: "place", slot: 0, cell: 0 }).state;
    expect(s.found).toContain("hg");
    expect(s.howMade["hg"]?.sort()).toEqual(["ng", "w"]);
    // Clear the board, put a `w` down, promote it: howMade should
    // overwrite to [w] (the most recent path).
    s.board.fill(null);
    s.board[0] = "w";
    s = reduce(s, b2, { type: "promote", cell: 0 }).state;
    expect(s.howMade["hg"]).toEqual(["w"]);
  });

  it("promote picker is cancellable; cancel-choice rolls back cleanly", () => {
    const s = seedState();
    s.board[0] = "a";
    const { state: paused } = reduce(s, bundle, { type: "promote", cell: 0 });
    expect(paused.choosing?.cancellable).toBe(true);
    expect(paused.moves).toBe(1); // bumped by promote
    const { state: rolled } = reduce(paused, bundle, { type: "cancel-choice" });
    // Restored to pre-promote state: tile still "a", moves reset, no picker.
    expect(rolled.choosing).toBeNull();
    expect(rolled.board[0]).toBe("a");
    expect(rolled.moves).toBe(0);
  });

  it("promote is a no-op when the run is over", () => {
    const s = seedState();
    s.board[0] = "a";
    s.over = true;
    const before = { board: s.board.slice(), moves: s.moves };
    const { state, events } = reduce(s, bundle, { type: "promote", cell: 0 });
    expect(state.board).toEqual(before.board);
    expect(state.moves).toBe(before.moves);
    expect(events).toEqual([]);
  });

it("promote in fast mode makes the tile and populates run-local history", () => {
    const b2 = fakeBundle({ recipes: [R("b", ["a"]), R("ab", ["a", "x"])] });
    const s = newGame("everything", b2, { seed: 1, size: 5 }).state;
    s.board.fill(null);
    s.crumb.fill(null);
    s.shored.fill(false);
    s.tray.fill(null);
    s.hold.fill(null);
    s.mode = "fast";
    s.found = [];
    s.board[0] = "a";
    const { state } = reduce(s, b2, { type: "promote", cell: 0 });
    // Tile transformed; run-local history is populated so the shelf
    // renders. Lifetime collection (discovery event) stays untouched in
    // fast mode.
    expect(state.board[0]).toBe("b");
    expect(state.found).toContain("b");
    expect(state.howMade["b"]).toEqual(["a"]);
  });

  it("promote scoring: 1-input yields the formula's 0.5× pair-match points", () => {
    // Points = round(20 * tier * mult * (1 + 0.5 * (len - 2))). Tier M
    // is 2 (TIER_VALUE["M"] = 2); for a 1-input recipe at mult=1:
    // 20 * 2 * 1 * 0.5 = 20. Plus the fixed +1 the promote action
    // awards on start = 21.
    const b2 = fakeBundle({
      recipes: [R("b", ["a"])],
      tiers: { a: "M", b: "M" },
    });
    const s = newGame("everything", b2, { seed: 1, size: 5 }).state;
    s.board.fill(null);
    s.crumb.fill(null);
    s.shored.fill(false);
    s.tray.fill(null);
    s.hold.fill(null);
    s.found = [];
    s.score = 0;
    s.board[0] = "a";
    const { state } = reduce(s, b2, { type: "promote", cell: 0 });
    expect(state.score).toBe(1 + 20);
  });

  it("cancel-choice is a no-op on non-cancellable pickers (place/drop-on)", () => {
    // Using a 2-input recipe with alternatives to force a non-cancellable
    // `choosing` state from `place`.
    const b2 = fakeBundle({
      recipes: [R("out1", ["p", "q"]), R("out2", ["p", "q"])],
    });
    const s = newGame("everything", b2, { seed: 1, size: 5 }).state;
    s.board.fill(null);
    s.crumb.fill(null);
    s.shored.fill(false);
    s.hold.fill(null);
    s.tray = ["p", null, null];
    s.board[1] = "q";
    const { state: paused } = reduce(s, b2, {
      type: "place",
      slot: 0,
      cell: 0,
    });
    expect(paused.choosing).not.toBeNull();
    expect(paused.choosing!.cancellable).toBeFalsy();
    const { state: after, events } = reduce(paused, b2, {
      type: "cancel-choice",
    });
    // No change; picker stays up.
    expect(after).toBe(paused);
    expect(events).toEqual([]);
  });
});

describe("1-input recipes don't auto-fire on placement (matchAt guard)", () => {
  // `a` has a 1-input recipe to `b`. Placing `a` must NOT auto-transform
  // to `b`; promote is the only path. Pair with `x` to make sure the
  // tray deal has a legal move in a real-world setup.
  const bundle = fakeBundle({
    recipes: [R("b", ["a"]), R("ab", ["a", "x"])],
  });

  it("placing a 1-input tile on an empty cell leaves it as-is", () => {
    const s = newGame("everything", bundle, { seed: 1, size: 5 }).state;
    s.board.fill(null);
    s.tray = ["a", null, null];
    const { state } = reduce(s, bundle, { type: "place", slot: 0, cell: 0 });
    expect(state.board[0]).toBe("a");
  });
});

// Shallow clone utility used by the wipe tests — the engine's internal
// `cloneState` isn't exported, and these tests only need a distinct
// object to confirm `lastSnapshot` is cleared.
function cloneForTest(s: GameState): GameState {
  return { ...s };
}

describe("daily target-list end conditions", () => {
  const bundle = fakeBundle({
    recipes: [
      R("dough", ["flour", "water"]),
      R("cake", ["dough", "sugar"]),
      R("bread", ["dough", "heat"]),
    ],
  });

  it("daily run ends with a win when found.length hits target", () => {
    const s0 = newGame("everything", bundle, {
      mode: "daily",
      daily: "2026-11-08",
      size: 3,
      seed: 1,
      target: 2,
    }).state;
    // Hand-arrange: make `dough` twice shouldn't count (unique only). Make
    // dough, then cake → 2 unique discoveries → win.
    s0.board = Array(9).fill(null);
    s0.tray = ["flour", "water", "sugar"];
    const s1 = reduce(s0, bundle, { type: "place", slot: 0, cell: 0 });
    // flour on empty — placed only. We need both adjacent.
    expect(s1.state.board[0]).toBe("flour");
    const s2 = reduce(s1.state, bundle, { type: "place", slot: 1, cell: 1 });
    // flour + water adjacent → dough produced. One discovery.
    expect(s2.state.found).toContain("dough");
    expect(s2.state.over).toBe(false);
    // Now combine dough + sugar → cake (second discovery). Target hit.
    const doughCell = s2.state.board.indexOf("dough");
    // Put sugar adjacent to dough. Find a free adjacent cell.
    const n = s2.state.n;
    const neighbours = [doughCell - 1, doughCell + 1, doughCell - n, doughCell + n]
      .filter((c) => c >= 0 && c < n * n)
      .filter((c) => s2.state.board[c] == null);
    expect(neighbours.length).toBeGreaterThan(0);
    const sugarCell = neighbours[0];
    // tray slot 2 still holds sugar (we never consumed it).
    const s3 = reduce(s2.state, bundle, { type: "place", slot: 2, cell: sugarCell });
    expect(s3.state.found).toContain("cake");
    expect(s3.state.over).toBe(true);
    expect(s3.events.some((e) => e.type === "over")).toBe(true);
  });

  it("daily age-progression victory is disabled", () => {
    // Build a daily with only 1 age (the "final age") and a tiny ageNeed.
    // Normally this would fire the final-age victory; for daily it must not.
    const singleAgeBundle: ThemeBundle = {
      ...bundle,
      theme: { ...bundle.theme, ages: ["only"] },
    };
    const s0 = newGame("everything", singleAgeBundle, {
      mode: "daily",
      daily: "2026-11-08",
      size: 3,
      seed: 1,
      target: 10, // unreachable with this tiny recipe set
    }).state;
    s0.board = Array(9).fill(null);
    s0.tray = ["flour", "water", null];
    // Trigger a make → ageMade increments; with a 1-age theme the
    // final-age check would fire for endless. Daily must skip it.
    const s1 = reduce(s0, bundle, { type: "place", slot: 0, cell: 0 });
    const s2 = reduce(s1.state, bundle, { type: "place", slot: 1, cell: 1 });
    expect(s2.state.made).toBeGreaterThan(0);
    expect(s2.state.over).toBe(false);
  });

  it("endless mode ignores target even if set (defensive)", () => {
    const s0 = newGame("everything", bundle, {
      mode: "endless",
      size: 3,
      seed: 1,
      // target passed but mode is endless — newGame should null it out.
      target: 1,
    }).state;
    expect(s0.target).toBeNull();
  });

  it("legacy daily (no target) still runs — target stays null, engine falls through", () => {
    const s = newGame("everything", bundle, {
      mode: "daily",
      daily: "2026-11-08",
      size: 3,
      seed: 1,
      // no target in opts
    }).state;
    expect(s.target).toBeNull();
    expect(s.over).toBe(false);
  });
});
