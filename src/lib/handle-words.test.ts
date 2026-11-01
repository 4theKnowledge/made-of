import { describe, expect, it } from "vitest";
import {
  ADJECTIVES,
  HANDLE_PATTERN,
  NOUNS,
  isValidHandle,
  randomHandleCandidate,
} from "./handle-words";

describe("handle-words", () => {
  it("has a large enough pool for signups", () => {
    // Birthday-paradox collisions start to get painful below ~10k combos.
    expect(ADJECTIVES.length * NOUNS.length).toBeGreaterThan(10_000);
  });

  it("accepts well-formed candidates from the pool", () => {
    expect(isValidHandle("swift-quartz")).toBe(true);
    expect(isValidHandle("warm-fern")).toBe(true);
  });

  it("rejects uppercase, spaces, and extra parts", () => {
    expect(isValidHandle("Swift-Quartz")).toBe(false);
    expect(isValidHandle("swift quartz")).toBe(false);
    expect(isValidHandle("swift-quartz-extra")).toBe(false);
    expect(isValidHandle("swift")).toBe(false);
    expect(isValidHandle("")).toBe(false);
  });

  it("rejects shape-valid strings whose parts aren't in the word lists", () => {
    expect(HANDLE_PATTERN.test("foo-bar")).toBe(true);
    expect(isValidHandle("foo-bar")).toBe(false);
    // Known adjective but unknown noun.
    expect(isValidHandle("swift-notaword")).toBe(false);
  });

  it("generates candidates that validate", () => {
    for (let i = 0; i < 50; i++) {
      const candidate = randomHandleCandidate();
      expect(isValidHandle(candidate)).toBe(true);
    }
  });
});
