import { describe, expect, it } from "vitest";
import { loadKnowledgeBase } from "../data/load";
import { toRows } from "../data/rows";
import {
  ancestors,
  buildSnapshot,
  distancesFrom,
  recipeNeighbourhood,
  shortestPath,
} from "./snapshot";

const rows = toRows(loadKnowledgeBase());
const snap = buildSnapshot(rows);

/** Resolve a slug to its uuid id. Tests prefer slugs for readability. */
const id = (slug: string): string => {
  const n = snap.bySlug.get(slug);
  if (!n) throw new Error(`missing node for slug ${slug}`);
  return n.id;
};

const hasSlug = (slug: string): boolean => snap.bySlug.has(slug);

/* Cases chosen from the prototype, so the ported snapshot must agree. */

describe("buildSnapshot", () => {
  it("has one node per item", () => {
    expect(snap.nodes.size).toBe(rows.items.length);
  });

  it("every node's up and down edges are self-consistent", () => {
    for (const n of snap.nodes.values()) {
      for (const e of n.up) {
        const target = snap.nodes.get(e.id);
        expect(target).toBeDefined();
        expect(target!.down.some((d) => d.id === n.id && d.type === e.type)).toBe(
          true,
        );
      }
    }
  });
});

describe("ancestors", () => {
  it("hydrogen ancestor chain reaches the big bang", () => {
    const anc = ancestors(snap, id("hydrogen"));
    expect(anc.has(id("big-bang"))).toBe(true);
    expect(anc.has(id("hydrogen"))).toBe(false);
  });

  it("water is ultimately made of fundamentals from the big bang", () => {
    const anc = ancestors(snap, id("water"));
    expect(anc.has(id("hydrogen"))).toBe(true);
    expect(anc.has(id("oxygen"))).toBe(true);
    expect(anc.has(id("big-bang"))).toBe(true);
  });

  it("humans have hundreds of ancestors through evolution", () => {
    const anc = ancestors(snap, id("humans"));
    expect(anc.has(id("primates"))).toBe(true);
    expect(anc.has(id("mammals"))).toBe(true);
    expect(anc.has(id("luca"))).toBe(true);
    expect(anc.has(id("big-bang"))).toBe(true);
  });
});

describe("shortestPath (undirected)", () => {
  it("big bang to hydrogen is one step", () => {
    const p = shortestPath(snap, id("big-bang"), id("hydrogen"));
    expect(p).not.toBeNull();
    expect(p!.map((s) => s.id)).toEqual([id("big-bang"), id("hydrogen")]);
  });

  it("hydrogen to oxygen passes through a shared neighbour", () => {
    const p = shortestPath(snap, id("hydrogen"), id("oxygen"));
    expect(p).not.toBeNull();
    expect(p!.length).toBeGreaterThanOrEqual(2);
    expect(p![0].id).toBe(id("hydrogen"));
    expect(p![p!.length - 1].id).toBe(id("oxygen"));
  });

  it("returns a trivial path for identical endpoints", () => {
    const waterId = id("water");
    const p = shortestPath(snap, waterId, waterId);
    expect(p).toEqual([{ id: waterId, edge: null }]);
  });

  it("returns null when either endpoint is unknown", () => {
    expect(shortestPath(snap, id("water"), "nope")).toBeNull();
    expect(shortestPath(snap, "nope", id("water"))).toBeNull();
  });
});

describe("distancesFrom", () => {
  it("agrees with shortestPath on hop count", () => {
    const dists = distancesFrom(snap, id("big-bang"));
    const p = shortestPath(snap, id("big-bang"), id("humans"));
    expect(dists.get(id("humans"))).toBe(p!.length - 1);
  });

  it("respects a closed set", () => {
    const dists = distancesFrom(
      snap,
      id("big-bang"),
      new Set([id("hydrogen"), id("helium")]),
    );
    expect(dists.has(id("hydrogen"))).toBe(false);
    expect(dists.has(id("helium"))).toBe(false);
  });
});

describe("recipeNeighbourhood", () => {
  it("filters up edges to the selected recipe plus item-level links", () => {
    if (!hasSlug("rna")) return; // skip if content changed
    const rna = snap.bySlug.get("rna")!;
    expect(rna.recipes.length).toBeGreaterThanOrEqual(2);
    const r0 = rna.recipes[0].id;
    const r1 = rna.recipes[1].id;
    const nb0 = recipeNeighbourhood(snap, rna.id, r0);
    const nb1 = recipeNeighbourhood(snap, rna.id, r1);
    for (const e of nb0.up)
      expect(e.recipeId === r0 || e.recipeId === null).toBe(true);
    for (const e of nb1.up)
      expect(e.recipeId === r1 || e.recipeId === null).toBe(true);
    const idsA = nb0.up.map((e) => e.id).sort().join(",");
    const idsB = nb1.up.map((e) => e.id).sort().join(",");
    expect(idsA).not.toBe(idsB);
  });
});
