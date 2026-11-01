import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../data/load";
import { toRows } from "../data/rows";
import { buildSnapshot } from "./snapshot";
import { buildClosedSet, freeplayPar } from "./link";

const rows = toRows(loadKnowledgeBase());
const snap = buildSnapshot(rows);
const closed = buildClosedSet(snap);

const id = (slug: string): string => {
  const n = snap.bySlug.get(slug);
  if (!n) throw new Error(`missing node for slug ${slug}`);
  return n.id;
};

describe("freeplayPar", () => {
  it("returns a positive distance for a solvable pair", () => {
    const par = freeplayPar(snap, id("hydrogen"), id("water"), closed);
    expect(par).not.toBeNull();
    expect(par!).toBeGreaterThan(0);
  });

  it("returns null for identical start and goal", () => {
    const waterId = id("water");
    expect(freeplayPar(snap, waterId, waterId, closed)).toBeNull();
  });

  it("returns null when either item is unknown", () => {
    expect(freeplayPar(snap, "nonsense-xyz", id("water"), closed)).toBeNull();
    expect(freeplayPar(snap, id("water"), "nonsense-xyz", closed)).toBeNull();
  });

  it("lets endpoints be closed hubs even though intermediates can't", () => {
    const closedList = [...closed];
    const anyHub = closedList.find(
      (nid) => snap.nodes.get(nid)?.tier !== "F",
    );
    expect(anyHub).toBeDefined();
    const par = freeplayPar(snap, anyHub!, id("water"), closed);
    if (par === null) {
      const alt = freeplayPar(snap, anyHub!, id("hydrogen"), closed);
      expect(alt).not.toBeNull();
    } else {
      expect(par).toBeGreaterThan(0);
    }
  });
});
