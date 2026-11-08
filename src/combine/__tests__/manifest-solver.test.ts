import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { buildThemeBundle } from "../data";
import {
  buildManifestForDay,
  isReachable,
  reachableOutputs,
  resolveManifestPool,
  simulateReachable,
  UnreachablePin,
} from "../manifest-solver";

const snapshot = buildSnapshot(toRows(loadKnowledgeBase()));
const bundle = buildThemeBundle(snapshot, "everything");

describe("isReachable", () => {
  it("every base ingredient is trivially reachable", () => {
    const cache = new Map<string, boolean>();
    for (const id of bundle.base) {
      expect(isReachable(id, bundle, cache)).toBe(true);
    }
  });

  it("a totally-unrelated id is unreachable", () => {
    expect(isReachable("made-of-nothing-xyz", bundle)).toBe(false);
  });

  it("the everything bundle has a healthy reachable pool for manifest sampling", () => {
    // We only need ~50 reachable items for a size-8 manifest to have
    // genuine variety day over day. In practice the current data has
    // 300+ reachable outputs — plenty of headroom. Threshold is a
    // smoke test, not a content quality gate.
    const outs = reachableOutputs(bundle);
    expect(outs.length).toBeGreaterThan(50);
  });

  it("memoises per bundle via the shared cache", () => {
    const cache = new Map<string, boolean>();
    const outs = [...bundle.outputs].slice(0, 20);
    for (const id of outs) isReachable(id, bundle, cache);
    // Cache contains at least those ids (+ their recipe inputs).
    for (const id of outs) expect(cache.has(id)).toBe(true);
  });
});

describe("resolveManifestPool", () => {
  it("returns the intersection of pool members and bundle outputs, sorted", () => {
    const some = [...bundle.outputs].slice(0, 5);
    const unrelated = ["bogus-id-1", "bogus-id-2"];
    const got = resolveManifestPool([...some, ...unrelated], bundle);
    expect(got).toEqual([...some].sort());
  });
});

describe("simulateReachable", () => {
  it("returns 0 for an empty manifest", () => {
    expect(simulateReachable([], bundle, "everything", "2026-11-08", 100)).toBe(0);
  });

  it("gives up and returns null for a manifest with an unreachable member", () => {
    // Pure invented id — the solver will never produce it. The greedy
    // player cycles until the budget runs out, then returns null.
    const got = simulateReachable(
      ["totally-made-up-item-abc"],
      bundle,
      "everything",
      "2026-11-08",
      40,
    );
    expect(got).toBeNull();
  });
});

describe("buildManifestForDay", () => {
  it("throws UnreachablePin for a pin that cannot be built", () => {
    expect(() =>
      buildManifestForDay({
        cappedBundle: bundle,
        theme: "everything",
        config: { pool: "x", size: 8, pins: ["totally-made-up-abc"] },
        day: "2026-11-08",
        pool: [...bundle.outputs].slice(0, 10),
        rotation: new Map(),
      }),
    ).toThrow(UnreachablePin);
  });
});
