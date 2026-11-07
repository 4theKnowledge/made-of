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
import { newGame, type Action, type GameState } from "../engine";
import type { ThemeBundle } from "../types";

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
    byIngredient: new Map(),
    outBand: new Map(),
    sameIngredients: new Map(),
    ageSets: [{ use: new Set(), make: new Set() }],
    dailyConfig: null,
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
