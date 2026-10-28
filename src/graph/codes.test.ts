import { describe, expect, it } from "vitest";
import { buildCodeMap, isValidCode } from "./codes";

describe("buildCodeMap", () => {
  it("round-trips every id", () => {
    const ids = ["big-bang", "hydrogen", "water", "rna", "humans"];
    const m = buildCodeMap(ids, "fixed-seed");
    for (const id of ids) {
      const code = m.toCode(id);
      expect(code).toBeDefined();
      expect(isValidCode(code!)).toBe(true);
      expect(m.toId(code!)).toBe(id);
    }
  });

  it("is deterministic for a given seed", () => {
    const ids = ["a", "b", "c"];
    const a = buildCodeMap(ids, "seed-1");
    const b = buildCodeMap(ids, "seed-1");
    for (const id of ids) expect(a.toCode(id)).toBe(b.toCode(id));
  });

  it("returns undefined for unknown codes", () => {
    const m = buildCodeMap<string>(["x"], "s");
    expect(m.toId("abcdefgh")).toBeUndefined();
    expect(m.toCode("y")).toBeUndefined();
  });

  it("validates code format", () => {
    expect(isValidCode("abcdefgh")).toBe(true);
    expect(isValidCode("abc")).toBe(false);
    expect(isValidCode("ABCDEFGH")).toBe(false); // uppercase rejected
    expect(isValidCode("abcdefg!")).toBe(false);
  });
});
