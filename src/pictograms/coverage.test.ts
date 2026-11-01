import { describe, expect, it } from "vitest";
import { ITEMS } from "@/data/items.data";
import { PICTO } from "./data";

const picto = PICTO as Record<string, string>;

describe("pictogram coverage", () => {
  it("every non-element item has a specific pictogram", () => {
    const missing = ITEMS.filter(
      (i) => i.kind !== "element" && !picto[i.name],
    ).map((i) => `${i.kind}:${i.name}`);
    expect(missing).toEqual([]);
  });

  it("every element without a symbol has a specific pictogram", () => {
    const missing = ITEMS.filter(
      (i) => i.kind === "element" && !i.symbol && !picto[i.name],
    ).map((i) => i.name);
    expect(missing).toEqual([]);
  });

  it("no pictogram entries are orphaned", () => {
    const names = new Set(ITEMS.map((i) => i.name));
    const allowOrphans = new Set(["electricity", "internet", "lightning", "sunlight"]);
    const orphans = Object.keys(picto).filter(
      (k) => !names.has(k) && !allowOrphans.has(k),
    );
    expect(orphans).toEqual([]);
  });
});
