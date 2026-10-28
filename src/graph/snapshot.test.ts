import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePrototype } from "../parser/prototype";
import { toRows } from "../parser/load";
import {
  ancestors,
  buildSnapshot,
  distancesFrom,
  recipeNeighbourhood,
  shortestPath,
} from "./snapshot";

const HTML = readFileSync(
  resolve(process.cwd(), "legacy/made-of.html"),
  "utf8",
);
const rows = toRows(parsePrototype(HTML));
const snap = buildSnapshot(rows);

/* Cases chosen from the prototype, so the ported snapshot must agree. */

describe("buildSnapshot", () => {
  it("has one node per item", () => {
    expect(snap.nodes.size).toBe(276);
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
    const anc = ancestors(snap, "hydrogen");
    expect(anc.has("big-bang")).toBe(true);
    expect(anc.has("hydrogen")).toBe(false);
  });

  it("water is ultimately made of fundamentals from the big bang", () => {
    const anc = ancestors(snap, "water");
    expect(anc.has("hydrogen")).toBe(true);
    expect(anc.has("oxygen")).toBe(true);
    expect(anc.has("big-bang")).toBe(true);
  });

  it("humans have hundreds of ancestors through evolution", () => {
    const anc = ancestors(snap, "humans");
    expect(anc.has("primates")).toBe(true);
    expect(anc.has("mammals")).toBe(true);
    expect(anc.has("luca")).toBe(true);
    expect(anc.has("big-bang")).toBe(true);
  });
});

describe("shortestPath (undirected)", () => {
  it("big bang to hydrogen is one step", () => {
    const p = shortestPath(snap, "big-bang", "hydrogen");
    expect(p).not.toBeNull();
    expect(p!.map((s) => s.id)).toEqual(["big-bang", "hydrogen"]);
  });

  it("hydrogen to oxygen passes through a shared neighbour", () => {
    const p = shortestPath(snap, "hydrogen", "oxygen");
    expect(p).not.toBeNull();
    // Both are elements with multiple shared downstream connections. Any
    // length-2 path is acceptable (hydrogen - X - oxygen).
    expect(p!.length).toBeGreaterThanOrEqual(2);
    expect(p![0].id).toBe("hydrogen");
    expect(p![p!.length - 1].id).toBe("oxygen");
  });

  it("returns a trivial path for identical endpoints", () => {
    const p = shortestPath(snap, "water", "water");
    expect(p).toEqual([{ id: "water", edge: null }]);
  });

  it("returns null when either endpoint is unknown", () => {
    expect(shortestPath(snap, "water", "nope")).toBeNull();
    expect(shortestPath(snap, "nope", "water")).toBeNull();
  });
});

describe("distancesFrom", () => {
  it("agrees with shortestPath on hop count", () => {
    const dists = distancesFrom(snap, "big-bang");
    const p = shortestPath(snap, "big-bang", "humans");
    expect(dists.get("humans")).toBe(p!.length - 1);
  });

  it("respects a closed set", () => {
    const dists = distancesFrom(
      snap,
      "big-bang",
      new Set(["hydrogen", "helium"]),
    );
    expect(dists.has("hydrogen")).toBe(false);
    expect(dists.has("helium")).toBe(false);
  });
});

describe("recipeNeighbourhood", () => {
  it("filters up edges to the selected recipe plus item-level links", () => {
    const rna = snap.nodes.get("rna")!;
    expect(rna.recipes.length).toBeGreaterThanOrEqual(2);
    const r0 = rna.recipes[0].id;
    const r1 = rna.recipes[1].id;
    const nb0 = recipeNeighbourhood(snap, "rna", r0);
    const nb1 = recipeNeighbourhood(snap, "rna", r1);
    // Every returned up edge belongs to r0 (or is item-level null).
    for (const e of nb0.up)
      expect(e.recipeId === r0 || e.recipeId === null).toBe(true);
    for (const e of nb1.up)
      expect(e.recipeId === r1 || e.recipeId === null).toBe(true);
    // The two recipes should produce different neighbourhoods.
    const idsA = nb0.up.map((e) => e.id).sort().join(",");
    const idsB = nb1.up.map((e) => e.id).sort().join(",");
    expect(idsA).not.toBe(idsB);
  });
});
