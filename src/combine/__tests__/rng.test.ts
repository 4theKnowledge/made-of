import { describe, expect, it } from "vitest";
import {
  dailySeed,
  fnv1a,
  makeRng,
  pick,
  rand,
  randInt,
  shuffle,
} from "../rng";

describe("rand", () => {
  it("returns a float in [0, 1)", () => {
    const r = makeRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rand(r);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("is deterministic for a given seed", () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    for (let i = 0; i < 100; i++) {
      expect(rand(a)).toBe(rand(b));
    }
  });

  it("mutates the state so successive calls return different values", () => {
    const r = makeRng(1);
    const first = rand(r);
    const second = rand(r);
    expect(first).not.toBe(second);
  });

  it("different seeds produce different sequences", () => {
    const a = makeRng(1);
    const b = makeRng(2);
    const seqA = Array.from({ length: 20 }, () => rand(a));
    const seqB = Array.from({ length: 20 }, () => rand(b));
    expect(seqA).not.toEqual(seqB);
  });

  it("resumes exactly from a saved state", () => {
    const r = makeRng(777);
    for (let i = 0; i < 50; i++) rand(r);
    const saved = r.rs;
    const continued = rand(r);
    const resumed = makeRng(saved);
    expect(rand(resumed)).toBe(continued);
  });
});

describe("randInt", () => {
  it("stays in [0, n)", () => {
    const r = makeRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = randInt(r, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it("covers the full range given enough draws", () => {
    const r = makeRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(randInt(r, 5));
    expect(seen.size).toBe(5);
  });
});

describe("pick", () => {
  it("returns an element from the array", () => {
    const r = makeRng(5);
    const arr = ["a", "b", "c", "d"] as const;
    for (let i = 0; i < 50; i++) {
      const v = pick(r, arr);
      expect(arr.includes(v!)).toBe(true);
    }
  });

  it("returns undefined for an empty array", () => {
    const r = makeRng(5);
    expect(pick(r, [])).toBeUndefined();
  });
});

describe("shuffle", () => {
  it("returns an array of the same length and multiset", () => {
    const r = makeRng(7);
    const out = shuffle(r, ["a", "b", "c", "d", "e"]);
    expect(out.length).toBe(5);
    expect([...out].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("does not mutate the input", () => {
    const r = makeRng(7);
    const input = ["a", "b", "c", "d"];
    const copy = input.slice();
    shuffle(r, input);
    expect(input).toEqual(copy);
  });

  it("is deterministic for a given state", () => {
    const a = shuffle(makeRng(42), ["a", "b", "c", "d", "e"]);
    const b = shuffle(makeRng(42), ["a", "b", "c", "d", "e"]);
    expect(a).toEqual(b);
  });

  it("different seeds generally produce different orders", () => {
    const base = shuffle(makeRng(1), ["a", "b", "c", "d", "e"]).join(",");
    const diverged = [2, 3, 4, 5, 6, 7, 8]
      .map((s) => shuffle(makeRng(s), ["a", "b", "c", "d", "e"]).join(","))
      .some((o) => o !== base);
    expect(diverged).toBe(true);
  });

  it("handles empty and single-element arrays", () => {
    expect(shuffle(makeRng(1), [])).toEqual([]);
    expect(shuffle(makeRng(1), ["x"])).toEqual(["x"]);
  });
});

describe("fnv1a", () => {
  it("is deterministic", () => {
    expect(fnv1a("hello")).toBe(fnv1a("hello"));
  });

  it("differs for different strings", () => {
    expect(fnv1a("foo")).not.toBe(fnv1a("bar"));
  });

  it("hashes the empty string to the FNV offset basis", () => {
    // FNV-1a offset basis is 2166136261 = 0x811c9dc5, but we `| 0` so the
    // top bit flips to negative in the signed 32-bit view.
    expect(fnv1a("") | 0).toBe(2166136261 | 0);
  });
});

describe("dailySeed", () => {
  it("same date → same seed", () => {
    expect(dailySeed("2026-11-01")).toBe(dailySeed("2026-11-01"));
  });

  it("different dates → different seeds", () => {
    expect(dailySeed("2026-11-01")).not.toBe(dailySeed("2026-11-02"));
  });
});
