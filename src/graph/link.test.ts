import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../data/load";
import { toRows } from "../data/rows";
import { buildSnapshot } from "./snapshot";
import { buildClosedSet, freeplayPar } from "./link";

const rows = toRows(loadKnowledgeBase());
const snap = buildSnapshot(rows);
const closed = buildClosedSet(snap);

describe("freeplayPar", () => {
  it("returns a positive distance for a solvable pair", () => {
    const par = freeplayPar(snap, "hydrogen", "water", closed);
    expect(par).not.toBeNull();
    expect(par!).toBeGreaterThan(0);
  });

  it("returns null for identical start and goal", () => {
    expect(freeplayPar(snap, "water", "water", closed)).toBeNull();
  });

  it("returns null when either item is unknown", () => {
    expect(freeplayPar(snap, "nonsense-xyz", "water", closed)).toBeNull();
    expect(freeplayPar(snap, "water", "nonsense-xyz", closed)).toBeNull();
  });

  it("lets endpoints be closed hubs even though intermediates can't", () => {
    const closedList = [...closed];
    const anyHub = closedList.find(
      (id) => snap.nodes.get(id)?.tier !== "F",
    );
    expect(anyHub).toBeDefined();
    // Using a hub as the start should not immediately return null — the hub
    // itself is reachable because we exempt endpoints from CLOSED.
    const par = freeplayPar(snap, anyHub!, "water", closed);
    // Some hub/water pairs may be legitimately unreachable under the
    // confidence filter; what matters is the function doesn't short-circuit
    // on the hub itself. If this specific pair has no path, pick again.
    if (par === null) {
      // Try another water-adjacent target.
      const alt = freeplayPar(snap, anyHub!, "hydrogen", closed);
      expect(alt).not.toBeNull();
    } else {
      expect(par).toBeGreaterThan(0);
    }
  });
});
