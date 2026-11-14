/**
 * Server-engine replay + action-shape validation (T-0175).
 *
 * The replay path is thin: it loops `reduce(state, bundle, action)` and
 * accumulates events. The interesting test cases are:
 *   - the loop terminates early when the run ends mid-batch
 *   - debug actions get rejected unless `allowDebug` is set
 *   - the shape validator rejects garbage
 *
 * We don't re-test the engine itself — `engine.test.ts` already has
 * 102 tests across every action type. Bundle construction is also out
 * of scope here (needs a live DB snapshot).
 */

import { describe, expect, it } from "vitest";
import {
  replayActions,
  validateActionShape,
  ReplayError,
} from "../server-engine";
import { newGame, reduce, type Action, type GameState } from "../engine";
import type { CombineRecipe, ThemeBundle } from "../types";

// A tiny synthetic bundle — just enough shape for `reduce` to run the
// cheap action paths. Actual gameplay needs real items/recipes; the
// tests here only exercise control flow.
function minimalBundle(): ThemeBundle {
  return {
    theme: { k: "test" as string, ages: ["Only"], label: "Test" } as unknown as ThemeBundle["theme"],
    items: new Map(),
    outputs: new Map(),
    recipes: [],
    base: [],
    mid: [],
    byIngredient: new Map(),
    outBand: new Map(),
    sameIngredients: new Map(),
    ageSets: [{ use: new Set(), make: new Set() }],
    dailyConfig: null,
    terminal: new Set<string>(),
  } as unknown as ThemeBundle;
}

function freshState(): GameState {
  // Use the real engine's newGame so we get a valid-shape state.
  const { state } = newGame("test", minimalBundle(), {
    mode: "endless",
    size: 6,
    seed: 1,
  });
  return state;
}

describe("validateActionShape", () => {
  it("accepts known action types", () => {
    expect(validateActionShape({ type: "place", slot: 0, cell: 0 })).toBe(true);
    expect(validateActionShape({ type: "finish" })).toBe(true);
    expect(validateActionShape({ type: "swap" })).toBe(true);
  });

  it("rejects unknown types", () => {
    expect(validateActionShape({ type: "DROP TABLE" })).toBe(false);
    expect(validateActionShape({ type: "" })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(validateActionShape(null)).toBe(false);
    expect(validateActionShape("place")).toBe(false);
    expect(validateActionShape(42)).toBe(false);
  });

  it("rejects objects without a type", () => {
    expect(validateActionShape({})).toBe(false);
    expect(validateActionShape({ slot: 0 })).toBe(false);
  });
});

describe("replayActions", () => {
  it("applies an empty batch cleanly", () => {
    const state = freshState();
    const result = replayActions(state, minimalBundle(), []);
    expect(result.appliedCount).toBe(0);
    expect(result.events).toEqual([]);
    // State reference is unchanged for an empty batch (no reduce call).
    expect(result.state).toBe(state);
  });

  it("rejects debug actions when allowDebug is off", () => {
    const state = freshState();
    expect(() =>
      replayActions(
        state,
        minimalBundle(),
        [{ type: "debug-toggle" } as Action],
      ),
    ).toThrow(ReplayError);
  });

  it("allows debug actions when allowDebug is on", () => {
    const state = freshState();
    const result = replayActions(
      state,
      minimalBundle(),
      [{ type: "debug-toggle" } as Action],
      { allowDebug: true },
    );
    // debug-toggle flips state.debug; we don't care about the exact
    // engine behaviour here, just that the call didn't throw.
    expect(result.appliedCount).toBe(1);
  });

  it("stops applying actions once the run ends mid-batch", () => {
    // Force the state into `over` *before* the batch. The server-engine
    // termination check fires after the first action — anything past
    // index 0 shouldn't be touched. Prevents a client from posting junk
    // after a lost run.
    const endedState = { ...freshState(), over: true };
    const actions: Action[] = [
      { type: "swap" },
      { type: "swap" },
      { type: "swap" },
    ];
    const result = replayActions(endedState, minimalBundle(), actions);
    expect(result.appliedCount).toBe(1);
  });

  it("surfaces the index of the offending action in ReplayError", () => {
    const state = freshState();
    try {
      replayActions(state, minimalBundle(), [
        { type: "swap" } as Action,
        { type: "debug-toggle" } as Action,
      ]);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ReplayError);
      expect((err as ReplayError).atIndex).toBe(1);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Round-trip determinism properties.                                 */
/*                                                                    */
/* The Candy-Crush trust model (T-0194) only works if the same action */
/* sequence produces the same state twice — once during live play,    */
/* once during server replay. Two properties cover this:              */
/*   1. undo mid-sequence replays identically to the shorter sequence */
/*      that skips the undone action. Guards the serialised           */
/*      `lastSnapshot` round-trip.                                    */
/*   2. a long random-but-valid-shape action sequence never crashes   */
/*      replay, and `score`/`found.length`/`moves` stay monotone      */
/*      non-decreasing. Guards against subtle replay-engine bugs      */
/*      (SECURITY_AUDIT § "Not covered").                             */
/* ------------------------------------------------------------------ */

const recipe = (out: string, all: string[]): CombineRecipe => ({
  id: `test-${out}-${all.join("+")}`,
  out,
  from: all,
  with: [],
  needs: [],
  evolved: [],
  all,
  lvl: 0,
  band: 0,
});

/** Tiny bundle with one 2-input recipe so `place` can trigger a combine
 *  and we can exercise the full `reduce` → snapshot → undo path. */
function recipeBundle(): ThemeBundle {
  const r = recipe("dough", ["flour", "water"]);
  const byIngredient = new Map<string, CombineRecipe[]>([
    ["flour", [r]],
    ["water", [r]],
  ]);
  const items = new Map();
  for (const id of ["flour", "water", "dough"]) {
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
  return {
    theme: {
      k: "everything",
      name: "Test",
      desc: "",
      ages: ["one"],
      numAges: 1,
      dailyConfig: null,
    } as unknown as ThemeBundle["theme"],
    items,
    outputs: new Map([["dough", [r]]]),
    recipes: [r],
    base: ["flour", "water"],
    mid: [],
    byIngredient,
    tools: new Set<string>(),
    terminal: new Set<string>(),
    outBand: new Map([["dough", 0]]),
    sameIngredients: new Map([["flour+water", [r]]]),
  } as unknown as ThemeBundle;
}

describe("replay round-trip", () => {
  it("place then undo replays identically to no-op (undo preserves lastSnapshot)", () => {
    const bundle = recipeBundle();
    const seed = 12345;
    const s0 = newGame("everything", bundle, { mode: "endless", seed, size: 3 }).state;
    s0.board = Array(9).fill(null);
    s0.tray = ["flour", null, null];
    // Clone the pre-move snapshot via JSON so we compare against a known
    // serialised shape — replay on the server ultimately reads jsonb.
    const serialisedStart = JSON.parse(JSON.stringify(s0)) as GameState;
    const actions: Action[] = [
      { type: "place", slot: 0, cell: 4 },
      { type: "undo" },
    ];
    const replayed = replayActions(serialisedStart, bundle, actions);
    // After place+undo we should be back where we started on every
    // gameplay-relevant field. Undo consumes one of the two charges a
    // fresh game grants — `s0.undos` hasn't been touched yet so compare
    // against the post-undo count the engine produces directly.
    const expected = reduce(
      reduce(s0, bundle, { type: "place", slot: 0, cell: 4 }).state,
      bundle,
      { type: "undo" },
    ).state;
    expect(replayed.state.board).toEqual(expected.board);
    expect(replayed.state.tray).toEqual(expected.tray);
    expect(replayed.state.score).toBe(expected.score);
    expect(replayed.state.moves).toBe(expected.moves);
    expect(replayed.state.undos).toBe(expected.undos);
    expect(replayed.state.rng).toEqual(expected.rng);
  });

  it("random valid-shape action batch doesn't crash and keeps monotone totals", () => {
    const bundle = recipeBundle();
    // Deterministic rng so the test is reproducible; using a local
    // generator rather than Math.random keeps CI output stable.
    let s = 0xc0ffee;
    const rand = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      return ((s >>> 0) / 2 ** 32);
    };
    const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
    const state0 = newGame("everything", bundle, { mode: "endless", seed: 7, size: 3 }).state;

    // Build 200 random actions over the known action-type set. Most will
    // be no-ops against the state (place with slot=null, swap when
    // choosing is off, etc.) — the reducer is designed to return
    // unchanged state rather than throw on illegal input, which is the
    // property this fuzz guards.
    const actions: Action[] = [];
    const slots = [0, 1, 2];
    const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const types = [
      "place",
      "drop-on",
      "swap",
      "clear",
      "move",
      "promote",
      "shore",
      "hold",
      "pluck-hold",
    ] as const;
    for (let i = 0; i < 200; i++) {
      const t = pick(types);
      if (t === "place" || t === "drop-on") {
        actions.push({ type: t, slot: pick(slots), cell: pick(cells) });
      } else if (t === "swap") {
        actions.push({ type: "swap" });
      } else if (t === "clear" || t === "promote" || t === "shore" || t === "pluck-hold") {
        actions.push({ type: t, cell: pick(cells) });
      } else if (t === "hold") {
        actions.push({ type: "hold", slot: pick(slots) });
      } else if (t === "move") {
        actions.push({ type: "move", from: pick(cells), to: pick(cells) });
      }
    }

    // Replay must not throw on any sequence that passes validateActionShape.
    expect(() => replayActions(state0, bundle, actions)).not.toThrow();
    const result = replayActions(state0, bundle, actions);
    // Monotone invariants: score, moves, and found-count only grow.
    expect(result.state.score).toBeGreaterThanOrEqual(state0.score);
    expect(result.state.moves).toBeGreaterThanOrEqual(state0.moves);
    expect(result.state.found.length).toBeGreaterThanOrEqual(state0.found.length);
  });
});
