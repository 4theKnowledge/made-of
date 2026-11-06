/**
 * Unit tests for `auditGraph` with hand-built mini snapshots.
 *
 * The scenarios are intentionally tiny so an authoring regression that
 * breaks one invariant jumps out by name. The integration-level
 * big-bang / dead-end-raw checks against the real KB live in
 * `src/combine/__tests__/dead-end-raw.test.ts` and exercise the same code
 * path.
 */

import { describe, it, expect } from "vitest";
import { buildSnapshot } from "../../graph/snapshot";
import { toRows } from "../rows";
import { auditGraph, formatAudit } from "../invariants";
import type {
  LoadedItem,
  LoadedKnowledgeBase,
  LoadedRecipe,
} from "../types";

function item(
  name: string,
  overrides: Partial<LoadedItem> = {},
): LoadedItem {
  const slug = name.replace(/\s+/g, "-");
  return {
    name,
    slug,
    tier: "F",
    kind: "cosmic",
    firstAppeared: null,
    firstAppearedYears: null,
    symbol: null,
    fact: "",
    recipes: [],
    itemLinks: { n: [], s: [] },
    // Default to excluded from Combine so a hand-built big-bang-only
    // scenario doesn't light up the dead-end-raw check. Tests that want
    // combine membership override this explicitly.
    isCombineExcluded: true,
    tags: [],
    ...overrides,
  };
}

function combineItem(
  name: string,
  overrides: Partial<LoadedItem> = {},
): LoadedItem {
  return item(name, { isCombineExcluded: false, ...overrides });
}

function recipe(overrides: Partial<LoadedRecipe> = {}): LoadedRecipe {
  return { label: null, f: [], w: [], n: [], e: [], ...overrides };
}

function kb(items: LoadedItem[]): LoadedKnowledgeBase {
  return { items, evidenceLinks: [], sources: [] };
}

function snapshotFor(items: LoadedItem[]) {
  return buildSnapshot(toRows(kb(items)));
}

describe("auditGraph", () => {
  it("passes a trivial chain to big bang", () => {
    const snap = snapshotFor([
      item("big bang"),
      combineItem("hydrogen", { recipes: [recipe({ e: ["big bang"] })] }),
    ]);
    const audit = auditGraph(snap);
    expect(audit.orphans).toEqual([]);
    expect(audit.deadEndRaws).toEqual([]);
  });

  it("reports an orphaned island", () => {
    const snap = snapshotFor([
      item("big bang"),
      combineItem("hydrogen", { recipes: [recipe({ e: ["big bang"] })] }),
      combineItem("mystery", { tier: "C", kind: "object" }),
    ]);
    const audit = auditGraph(snap);
    expect(audit.orphans.map((o) => o.name)).toEqual(["mystery"]);
  });

  it("reports a chain of orphans anchored off-root", () => {
    // `b` → `a` → nothing. Neither reaches big bang; both are orphaned.
    const snap = snapshotFor([
      item("big bang"),
      combineItem("a", { tier: "N", kind: "element" }),
      combineItem("b", {
        tier: "M",
        kind: "mineral",
        recipes: [recipe({ f: ["a"] })],
      }),
    ]);
    const audit = auditGraph(snap);
    expect(audit.orphans.map((o) => o.name).sort()).toEqual(["a", "b"]);
  });

  it("reports everything as orphaned when big bang is missing", () => {
    const snap = snapshotFor([
      combineItem("hydrogen", { tier: "F", kind: "element" }),
      combineItem("helium", {
        tier: "F",
        kind: "element",
        recipes: [recipe({ e: ["hydrogen"] })],
      }),
    ]);
    const audit = auditGraph(snap);
    expect(audit.orphans.map((o) => o.name).sort()).toEqual([
      "helium",
      "hydrogen",
    ]);
  });

  it("flags a dead-end raw whose only use is a 1-input promote", () => {
    // `dust` is an input to Combine (it has no incoming recipes in any
    // theme) but its only use is the 1-input promote recipe that makes
    // `rock`. Combine can't deal it as a participatable tile.
    const snap = snapshotFor([
      item("big bang"),
      combineItem("hydrogen", {
        tier: "F",
        kind: "element",
        recipes: [recipe({ e: ["big bang"] })],
      }),
      combineItem("oxygen", {
        tier: "F",
        kind: "element",
        recipes: [recipe({ e: ["big bang"] })],
      }),
      // dust itself has an upstream link to big bang (so it isn't an
      // orphan) but is only *used* as a 1-input promote for `rock`.
      combineItem("dust", {
        tier: "N",
        kind: "mineral",
        itemLinks: { n: [], s: ["big bang"] },
      }),
      combineItem("rock", {
        tier: "N",
        kind: "mineral",
        recipes: [recipe({ f: ["dust"] })],
      }),
      // Also give hydrogen/oxygen a real multi-input combine so they
      // aren't themselves dead-end raws.
      combineItem("water", {
        tier: "N",
        kind: "mineral",
        recipes: [recipe({ f: ["hydrogen", "oxygen"] })],
      }),
    ]);
    const audit = auditGraph(snap);
    expect(audit.deadEndRaws.map((d) => d.name)).toContain("dust");
  });

  it("is clean when the raw also participates in a multi-input recipe", () => {
    const snap = snapshotFor([
      item("big bang"),
      combineItem("hydrogen", {
        tier: "F",
        kind: "element",
        recipes: [recipe({ e: ["big bang"] })],
      }),
      combineItem("oxygen", {
        tier: "F",
        kind: "element",
        recipes: [recipe({ e: ["big bang"] })],
      }),
      combineItem("water", {
        tier: "N",
        kind: "mineral",
        recipes: [recipe({ f: ["hydrogen", "oxygen"] })],
      }),
    ]);
    const audit = auditGraph(snap);
    expect(audit.deadEndRaws).toEqual([]);
  });

  it("excludes isCombineExcluded items from the raw check but not the orphan check", () => {
    const snap = snapshotFor([
      item("big bang"),
      // Not in any combine theme, so the dead-end-raw pass ignores it.
      // Still has to chain to big bang.
      item("lore", {
        tier: "F",
        kind: "information",
        recipes: [recipe({ e: ["big bang"] })],
      }),
    ]);
    const audit = auditGraph(snap);
    expect(audit.orphans).toEqual([]);
    expect(audit.deadEndRaws).toEqual([]);
  });
});

describe("formatAudit", () => {
  it("renders orphan + dead-end-raw sections together", () => {
    const msg = formatAudit({
      orphans: [{ id: "x", name: "stray", tier: "C", kind: "object" }],
      deadEndRaws: [
        { theme: "everything", id: "y", name: "seed", outputs: ["sprout"] },
      ],
    });
    expect(msg).toMatch(/upstream path to "big bang"/);
    expect(msg).toMatch(/stray \(C\/object\)/);
    expect(msg).toMatch(/dead-end raw item/);
    expect(msg).toMatch(/"seed" is only used in 1-input promotes to: sprout/);
  });
});
