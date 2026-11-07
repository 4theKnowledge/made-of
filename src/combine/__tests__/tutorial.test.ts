import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import { dealTray, type DealerView } from "../deal";
import { type Board } from "../match";
import { makeRng } from "../rng";
import {
  TUTORIAL_DECK_SLUGS,
  TUTORIAL_STEPS,
  nextStep,
  resolveTip,
  resolveTutorialDeck,
  tutorialPlayableOn,
} from "../tutorial";
import { newGame, reduce } from "../engine";

const snap = buildSnapshot(toRows(loadKnowledgeBase()));
const everything = buildThemeBundle(snap, "everything");
const TUTORIAL_DECK = resolveTutorialDeck(everything);

function emptyBoard(size: number): Board {
  return Array(size * size).fill(null);
}

function scriptedView(script: string[]): DealerView {
  return {
    bundle: everything,
    board: emptyBoard(6),
    tray: [null, null, null],
    size: 6,
    rng: makeRng(1),
    found: [],
    scripted: script,
  };
}

describe("scripted dealer", () => {
  it("consumes scripted tiles from the front of the queue in order", () => {
    const script = TUTORIAL_DECK.slice(0, 3);
    const view = scriptedView([...script]);
    const tray = dealTray(view);
    expect(tray).toEqual(script);
    // The caller's script array is consumed in place.
    expect(view.scripted).toEqual([]);
  });

  it("falls back to normal picks once the script runs out", () => {
    const first = TUTORIAL_DECK[0];
    const view = scriptedView([first]);
    const tray = dealTray(view);
    expect(tray[0]).toBe(first);
    // Remaining slots should be populated by the normal dealer, not null.
    expect(tray[1]).not.toBeNull();
    expect(tray[2]).not.toBeNull();
  });

  it("is deterministic across identical scripts", () => {
    const script = () => TUTORIAL_DECK.slice(0, 3);
    const a = dealTray(scriptedView(script()));
    const b = dealTray(scriptedView(script()));
    expect(a).toEqual(b);
  });
});

describe("tutorial deck validity", () => {
  it("every scripted slug resolves to an id in the everything bundle", () => {
    expect(tutorialPlayableOn(everything)).toBe(true);
    expect(TUTORIAL_DECK.length).toBe(TUTORIAL_DECK_SLUGS.length);
    for (const id of TUTORIAL_DECK) {
      expect(everything.items.has(id)).toBe(true);
    }
  });
});

describe("tutorial step FSM", () => {
  it("stays on welcome until a combine happens", () => {
    const state = newGame("everything", everything, {
      mode: "tutorial",
      size: 6,
      scripted: [...TUTORIAL_DECK],
    }).state;
    // Placing a tile without combining doesn't advance — the player
    // should keep placing until something combines.
    const next = nextStep(
      "welcome",
      [{ type: "placed", at: 0, tile: TUTORIAL_DECK[0] }],
      state,
    );
    expect(next).toBe("welcome");
  });

  it("advances welcome → firstCombine on a `dealt` event (tray refilled after emptying)", () => {
    const state = newGame("everything", everything, {
      mode: "tutorial",
      size: 6,
      scripted: [...TUTORIAL_DECK],
    }).state;
    const next = nextStep("welcome", [{ type: "dealt" }], state);
    expect(next).toBe("firstCombine");
  });

  it("stays on welcome while the tray still has tiles", () => {
    const state = newGame("everything", everything, {
      mode: "tutorial",
      size: 6,
      scripted: [...TUTORIAL_DECK],
    }).state;
    // Even if a combine event fires, don't leave welcome until the tray
    // is actually empty — step 1 copy says "drag all three".
    const next = nextStep(
      "welcome",
      [
        {
          type: "combine",
          cells: [0, 1],
          inputs: [TUTORIAL_DECK[0], TUTORIAL_DECK[1]],
          inputSignature: "sig",
          at: 1,
          out: "x",
          pts: 1,
          mult: 1,
          close: 0,
        },
      ],
      state,
    );
    expect(next).toBe("welcome");
  });

  it("goes to done when the game is over", () => {
    const state = {
      ...newGame("everything", everything, { mode: "tutorial", size: 6 }).state,
      over: true,
    };
    const next = nextStep("firstCombine", [], state);
    expect(next).toBe("done");
  });

  it("every step has copy", () => {
    for (const id of ["welcome", "firstCombine", "secondCombine", "done"] as const) {
      const resolved = resolveTip(TUTORIAL_STEPS[id], { lastOutName: "star" });
      expect(resolved.length).toBeGreaterThan(0);
    }
  });

  it("firstCombine tip interpolates the output name", () => {
    const withName = resolveTip(TUTORIAL_STEPS.firstCombine, { lastOutName: "sun" });
    expect(withName).toContain("sun");
    const withoutName = resolveTip(TUTORIAL_STEPS.firstCombine, { lastOutName: null });
    expect(withoutName).not.toContain("null");
    expect(withoutName.length).toBeGreaterThan(0);
  });

  it("full tutorial flow via real engine actions: welcome → firstCombine", () => {
    // Boot a tutorial run exactly like startTutorial does.
    let { state } = newGame("everything", everything, {
      mode: "tutorial",
      size: 6,
      scripted: [...TUTORIAL_DECK],
    });
    let step = "welcome" as ReturnType<typeof nextStep>;
    expect(state.tray).toEqual(TUTORIAL_DECK.slice(0, 3));

    // Helper: find an empty cell (non-combining placement).
    const findEmpty = (): number => {
      for (let i = 0; i < 36; i++) if (state.board[i] == null) return i;
      throw new Error("no empty cell");
    };

    // Place all three tray tiles on empty, spread-out cells. Picker may
    // open along the way — resolve it to let the combine fire. Step
    // advances only when the tray is empty.
    for (let slot = 0; slot < 3; slot++) {
      const cell = findEmpty();
      const r = reduce(state, everything, { type: "place", slot, cell, source: "tray" });
      step = nextStep(step, r.events, r.state);
      state = r.state;
      if (state.choosing) {
        const rc = reduce(state, everything, { type: "choose", outputIndex: 0 });
        step = nextStep(step, rc.events, rc.state);
        state = rc.state;
      }
      // While any tile remains in the tray we must still be on welcome.
      if (slot < 2) expect(step).toBe("welcome");
    }
    // Tray emptied — a fresh deal fired in afterMove, so we should now
    // be past firstCombine too (combine in the batch + empty tray).
    // The FSM at minimum must have left welcome.
    expect(step).not.toBe("welcome");
  });

  it("a single `dealt` event only advances one step — doesn't skip firstCombine", () => {
    // Important: welcome → firstCombine is triggered by `dealt`. If we
    // also used `dealt` to advance firstCombine → done, a single event
    // would skip firstCombine's "You made a {X}" copy entirely. The FSM
    // consumes each event by at most one transition.
    const state = newGame("everything", everything, {
      mode: "tutorial",
      size: 6,
      scripted: [...TUTORIAL_DECK],
    }).state;
    const next = nextStep("welcome", [{ type: "dealt" }], state);
    expect(next).toBe("firstCombine");
  });

  it("second `dealt` advances firstCombine → secondCombine", () => {
    const state = newGame("everything", everything, {
      mode: "tutorial",
      size: 6,
      scripted: [...TUTORIAL_DECK],
    }).state;
    const next = nextStep("firstCombine", [{ type: "dealt" }], state);
    expect(next).toBe("secondCombine");
  });

  it("third `dealt` advances secondCombine → done", () => {
    const state = newGame("everything", everything, {
      mode: "tutorial",
      size: 6,
      scripted: [...TUTORIAL_DECK],
    }).state;
    const next = nextStep("secondCombine", [{ type: "dealt" }], state);
    expect(next).toBe("done");
  });

  it("three `dealt` events in one batch cascade welcome → firstCombine → secondCombine → done", () => {
    // Pathological case — three trays emptied in one reducer call is
    // nearly impossible in practice, but the FSM should handle it
    // without skipping any step's copy visibly.
    const state = newGame("everything", everything, {
      mode: "tutorial",
      size: 6,
      scripted: [...TUTORIAL_DECK],
    }).state;
    const next = nextStep(
      "welcome",
      [{ type: "dealt" }, { type: "dealt" }, { type: "dealt" }],
      state,
    );
    expect(next).toBe("done");
  });
});

describe("tutorial engine integration", () => {
  it("newGame with mode='tutorial' preserves the scripted queue on state", () => {
    const r = newGame("everything", everything, {
      mode: "tutorial",
      size: 6,
      scripted: [...TUTORIAL_DECK],
    });
    expect(r.state.mode).toBe("tutorial");
    // After the initial dealTray in newGame, the first three script entries
    // were consumed into the opening tray. The remainder is still queued.
    expect(r.state.scripted?.length).toBe(TUTORIAL_DECK.length - 3);
    // Opening tray should be exactly the first three scripted tiles.
    expect(r.state.tray).toEqual(TUTORIAL_DECK.slice(0, 3));
  });

  it("subsequent deals (via swap) continue consuming the script", () => {
    const start = newGame("everything", everything, {
      mode: "tutorial",
      size: 6,
      scripted: [...TUTORIAL_DECK],
      // Debug flag lets us swap without the helper check.
    }).state;
    // Force a swap via the reducer: set swaps to 1 first.
    const primed = { ...start, swaps: 1 };
    const r = reduce(primed, everything, { type: "swap" });
    expect(r.state.tray).toEqual(TUTORIAL_DECK.slice(3, 6));
  });
});
